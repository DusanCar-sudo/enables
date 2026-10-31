import { describe, it, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as http from 'http';
import { sendOnce, chatCompletionsUrl, buildHeaders } from '../upstream.js';
import type { Candidate } from '../failover.js';

const cand = (baseUrl: string): Candidate => ({
  id: 'test', name: 'Test', adapter: 'openai', baseUrl,
  url: new URL(baseUrl), apiKey: 'k', model: 'm', keySource: 'env',
});

let srv: http.Server;
let port: number;
const sockets: import('net').Socket[] = [];

beforeEach(async () => {
  srv = http.createServer();
  srv.on('connection', s => { sockets.push(s); });
  port = await new Promise<number>(r => srv.listen(0, '127.0.0.1', () => r((srv.address() as { port: number }).port)));
});

afterEach(async () => {
  for (const s of sockets) s.destroy();
  sockets.length = 0;
  await new Promise<void>(r => srv.close(() => r()));
});

describe('sendOnce connect budget', () => {
  test('succeeds when the response headers arrive after the 15s connect budget', { timeout: 30_000 }, async () => {
    // The regression: the budget was a de-facto response-header deadline, so a
    // healthy but slow provider (NVIDIA: connected in ~60ms, headers after 30s+)
    // was destroyed at 15s and reported as a 'network' failure.
    srv.on('request', (_req, res) => {
      setTimeout(() => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); }, 16_000);
    });

    const r = await sendOnce(cand(`http://127.0.0.1:${port}/v1`), chatCompletionsUrl(`http://127.0.0.1:${port}/v1`), '{}', 60_000);

    assert.equal(r.ok, true, `expected success, got ${r.ok ? '' : r.err.message}`);
    assert.equal(r.ok && r.res.statusCode, 200);
  });

  test('still gives up quickly when the host never accepts the connection', { timeout: 40_000 }, async () => {
    // 203.0.113.0/24 is TEST-NET-3 (RFC 5737): guaranteed non-routable, so the
    // TCP handshake cannot complete and the budget must still fire.
    const r = await sendOnce(cand('http://203.0.113.1:9/v1'), chatCompletionsUrl('http://203.0.113.1:9/v1'), '{}', 300_000);

    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.err.message, /connect budget/);
  });
});

describe('upstream url + headers', () => {
  it('appends /chat/completions exactly once', () => {
    assert.equal(chatCompletionsUrl('https://x.test/v1').toString(), 'https://x.test/v1/chat/completions');
    assert.equal(chatCompletionsUrl('https://x.test/v1/').toString(), 'https://x.test/v1/chat/completions');
    assert.equal(chatCompletionsUrl('https://x.test/v1/chat/completions').toString(), 'https://x.test/v1/chat/completions');
  });

  it('sends bearer auth for openai adapters and x-api-key for anthropic', () => {
    const o = cand('https://x.test/v1');
    assert.equal(buildHeaders(o).authorization, 'Bearer k');
    assert.equal(buildHeaders({ ...o, adapter: 'anthropic' })['x-api-key'], 'k');
  });
});
