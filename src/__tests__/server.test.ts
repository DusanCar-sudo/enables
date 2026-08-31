// ─────────────────────────────────────────────────────────────────────────────
// Aura Enables — tests for startProxy and port fallback
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as net from 'net';
import { startProxy, stopProxy } from '../server.js';
import type { EnablesConfig } from '../config.js';

import * as http from 'http';

describe('startProxy port selection & models endpoint', () => {
  it('returns models list containing Claude models and provider models', async () => {
    const cfg: EnablesConfig = {
      provider: 'openai',
      bigModel: 'gpt-4o',
      port: 59160,
    };

    try {
      const port = await startProxy(cfg);
      const resData = await new Promise<string>((resolve, reject) => {
        http.get(`http://127.0.0.1:${port}/v1/models`, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => resolve(data));
        }).on('error', reject);
      });

      const json = JSON.parse(resData);
      assert.ok(Array.isArray(json.data));
      const modelIds = json.data.map((m: any) => m.id);
      assert.ok(modelIds.includes('claude-sonnet-4-6'));
      assert.ok(modelIds.includes('claude-opus-4-8'));
      assert.ok(modelIds.includes('gpt-4o'));
    } finally {
      await stopProxy();
    }
  });

  it('handles query parameters on endpoints like /v1/messages?beta=true', async () => {
    const cfg: EnablesConfig = {
      provider: 'openai',
      bigModel: 'gpt-4o',
      port: 59170,
    };

    try {
      const port = await startProxy(cfg);
      const resData = await new Promise<string>((resolve, reject) => {
        const req = http.request(`http://127.0.0.1:${port}/v1/messages/count_tokens?beta=true`, { method: 'POST' }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.write(JSON.stringify({ messages: [{ role: 'user', content: 'Hello world, this is a test with some tokens.' }] }));
        req.end();
      });

      const parsed = JSON.parse(resData);
      assert.ok(parsed.input_tokens > 0, 'Expected positive input_tokens count');
    } finally {
      await stopProxy();
    }
  });

  it('binds to an available port when preferred port is occupied', async () => {
    const preferredPort = 59150;

    // Occupy the preferred port
    const blocker = net.createServer();
    await new Promise<void>((res) => blocker.listen(preferredPort, '127.0.0.1', () => res()));

    const cfg: EnablesConfig = {
      provider: 'openai',
      targetBaseUrl: 'http://localhost:9999',
      port: preferredPort,
    };

    try {
      const actualPort = await startProxy(cfg);
      assert.ok(actualPort > preferredPort, `Expected actualPort > ${preferredPort}, got ${actualPort}`);
      assert.equal(cfg.port, actualPort);
    } finally {
      await stopProxy();
      await new Promise<void>((res) => blocker.close(() => res()));
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Failover integration tests — stub upstreams + the proxy's real chain logic
// ─────────────────────────────────────────────────────────────────────────────

interface StubStep { status: number; body?: any; stream?: boolean }

interface StubUpstream { port: number; requests: string[]; close(): Promise<void> }

let stubPortCounter = 59200;

async function createStubUpstream(steps: StubStep[]): Promise<StubUpstream> {
  const requests: string[] = [];
  const port = ++stubPortCounter;
  let stepIdx = 0;
  const server = net.createServer((socket) => {
    let raw = '';
    // Respond as soon as the full request body has arrived — the proxy's
    // keep-alive agent never sends FIN, so waiting on socket 'end' hangs.
    const maybeRespond = (): void => {
      const headerEnd = raw.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const m = /content-length: (\d+)/i.exec(raw.slice(0, headerEnd));
      const need = m ? parseInt(m[1], 10) : 0;
      if (raw.length - (headerEnd + 4) < need) return;
      socket.removeAllListeners('data');
      requests.push(raw.slice(headerEnd + 4));
      const step = steps[Math.min(stepIdx, steps.length - 1)];
      stepIdx++;
      const bodyStr = typeof step.body === 'string' ? step.body : JSON.stringify(step.body ?? {});
      if (step.stream) {
        socket.end(`HTTP/1.1 ${step.status} OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n${bodyStr}`);
      } else {
        socket.end(`HTTP/1.1 ${step.status} OK\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(bodyStr)}\r\nConnection: close\r\n\r\n${bodyStr}`);
      }
    };
    socket.on('data', (b: Buffer) => { raw += b.toString(); maybeRespond(); });
  });
  await new Promise<void>((res) => server.listen(port, '127.0.0.1', () => res()));
  return {
    port,
    requests,
    close: () => new Promise<void>((res) => server.close(() => res())),
  };
}

const OPENAI_OK = {
  choices: [{ message: { content: 'hello from stub' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 3, completion_tokens: 4 },
};

const OPENAI_SSE = 'data: ' + JSON.stringify({ choices: [{ delta: { content: 'stream!' } }] }) + '\n\ndata: [DONE]\n\n';

function stubChainCfg(a: number, b: number, extra: Partial<EnablesConfig> = {}): EnablesConfig {
  return {
    failoverChain: ['stub-a', 'stub-b'],
    providers: {
      'stub-a': { baseUrl: `http://127.0.0.1:${a}/v1`, model: 'model-a', apiKey: 'key-a' },
      'stub-b': { baseUrl: `http://127.0.0.1:${b}/v1`, model: 'model-b', apiKey: 'key-b' },
    },
    ...extra,
  } as EnablesConfig;
}

function post(port: number, path: string, body: any, headers: Record<string, string> = {}): Promise<{ status: number | undefined; text: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers }, (res) => {
      let data = '';
      res.on('data', (c: Buffer) => data += c.toString());
      res.on('end', () => resolve({ status: res.statusCode, text: data }));
    });
    req.on('error', reject);
    req.end(typeof body === 'string' ? body : JSON.stringify(body));
  });
}

function get(port: number, path: string): Promise<{ status: number | undefined; text: string }> {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${path}`, (res) => {
      let data = '';
      res.on('data', (c: Buffer) => data += c.toString());
      res.on('end', () => resolve({ status: res.statusCode, text: data }));
    }).on('error', reject);
  });
}

const CHAT_REQ = { model: 'claude-sonnet-4-6', max_tokens: 64, messages: [{ role: 'user', content: 'hi' }] };

describe('failover proxy integration', () => {
  it('retries a 429 on the next provider and returns a translated 200', async () => {
    const a = await createStubUpstream([{ status: 429, body: { error: { message: 'rate limited' } } }]);
    const b = await createStubUpstream([{ status: 200, body: OPENAI_OK }]);
    const cfg = stubChainCfg(a.port, b.port, { port: 59301 });

    try {
      const port = await startProxy(cfg, { runtimeFile: null });
      const res = await post(port, '/v1/messages', CHAT_REQ);
      assert.equal(res.status, 200);
      const json = JSON.parse(res.text);
      assert.equal(json.type, 'message');
      assert.deepEqual(json.content, [{ type: 'text', text: 'hello from stub' }]);
      assert.equal(json.model, 'model-b');

      const status = JSON.parse((await get(port, '/__enables/status')).text);
      assert.equal(status.counters.failovers, 1);
      assert.equal(status.perProvider['stub-a'].failures, 1);
      assert.equal(status.perProvider['stub-a'].lastError.kind, 'rate_limit');
      assert.equal(status.perProvider['stub-b'].successes, 1);
    } finally {
      await stopProxy();
      await a.close();
      await b.close();
    }
  });

  it('retries a 401 (auth) and succeeds on the next provider', async () => {
    const a = await createStubUpstream([{ status: 401, body: { error: { message: 'bad key' } } }]);
    const b = await createStubUpstream([{ status: 200, body: OPENAI_OK }]);
    const cfg = stubChainCfg(a.port, b.port, { port: 59302 });

    try {
      const port = await startProxy(cfg, { runtimeFile: null });
      const res = await post(port, '/v1/messages', CHAT_REQ);
      assert.equal(res.status, 200);
      assert.equal(a.requests.length, 1);
      assert.equal(b.requests.length, 1);
    } finally {
      await stopProxy();
      await a.close();
      await b.close();
    }
  });

  it('returns 502 naming the last provider when the chain is exhausted', async () => {
    const a = await createStubUpstream([{ status: 500, body: { error: { message: 'boom' } } }]);
    const b = await createStubUpstream([{ status: 500, body: { error: { message: 'boom too' } } }]);
    const cfg = stubChainCfg(a.port, b.port, { port: 59303 });

    try {
      const port = await startProxy(cfg, { runtimeFile: null });
      const res = await post(port, '/v1/messages', CHAT_REQ);
      assert.equal(res.status, 502);
      assert.ok(res.text.includes('stub-b'), 'error mentions last provider');
      const status = JSON.parse((await get(port, '/__enables/status')).text);
      assert.equal(status.counters.exhausted, 1);
    } finally {
      await stopProxy();
      await a.close();
      await b.close();
    }
  });

  it('does not fail over on non-retryable errors (400)', async () => {
    const a = await createStubUpstream([{ status: 400, body: { error: { message: 'invalid request' } } }]);
    const b = await createStubUpstream([{ status: 200, body: OPENAI_OK }]);
    const cfg = stubChainCfg(a.port, b.port, { port: 59304 });

    try {
      const port = await startProxy(cfg, { runtimeFile: null });
      const res = await post(port, '/v1/messages', CHAT_REQ);
      assert.equal(res.status, 400);
      assert.equal(b.requests.length, 0, 'second provider never contacted');
    } finally {
      await stopProxy();
      await a.close();
      await b.close();
    }
  });

  it('fails over on HTTP 200 bodies containing an error object', async () => {
    const a = await createStubUpstream([{ status: 200, body: { error: { message: 'insufficient_quota: balance empty' } } }]);
    const b = await createStubUpstream([{ status: 200, body: OPENAI_OK }]);
    const cfg = stubChainCfg(a.port, b.port, { port: 59305 });

    try {
      const port = await startProxy(cfg, { runtimeFile: null });
      const res = await post(port, '/v1/messages', CHAT_REQ);
      assert.equal(res.status, 200);
      assert.equal(JSON.parse(res.text).content[0].text, 'hello from stub');
      const status = JSON.parse((await get(port, '/__enables/status')).text);
      assert.equal(status.perProvider['stub-a'].lastError.kind, 'quota');
    } finally {
      await stopProxy();
      await a.close();
      await b.close();
    }
  });

  it('fails over on a streaming request before any bytes are sent', async () => {
    const a = await createStubUpstream([{ status: 500, body: { error: { message: 'overloaded' } } }]);
    const b = await createStubUpstream([{ status: 200, stream: true, body: OPENAI_SSE }]);
    const cfg = stubChainCfg(a.port, b.port, { port: 59306 });

    try {
      const port = await startProxy(cfg, { runtimeFile: null });
      const res = await post(port, '/v1/messages', { ...CHAT_REQ, stream: true });
      assert.equal(res.status, 200);
      assert.ok(res.text.includes('event: message_start'), 'got anthropic SSE');
      assert.ok(res.text.includes('stream!'), 'streamed content came through');
    } finally {
      await stopProxy();
      await a.close();
      await b.close();
    }
  });

  it('fails over after an upstream timeout when upstreamTimeoutMs is short', async () => {
    const port = ++stubPortCounter;
    const hanging = net.createServer((socket) => { socket.on('data', () => { /* never respond */ }); });
    await new Promise<void>((res) => hanging.listen(port, '127.0.0.1', () => res()));
    const b = await createStubUpstream([{ status: 200, body: OPENAI_OK }]);
    const cfg = stubChainCfg(port, b.port, { port: 59307, upstreamTimeoutMs: 300 });

    try {
      const started = Date.now();
      const proxyPort = await startProxy(cfg, { runtimeFile: null });
      const res = await post(proxyPort, '/v1/messages', CHAT_REQ);
      assert.equal(res.status, 200);
      assert.ok(Date.now() - started < 10000, 'timed out quickly instead of hanging');
      assert.equal(b.requests.length, 1);
    } finally {
      await stopProxy();
      hanging.close();
      await b.close();
    }
  });

  it('honors failover: false by using only the first candidate', async () => {
    const a = await createStubUpstream([{ status: 500, body: { error: { message: 'boom' } } }]);
    const b = await createStubUpstream([{ status: 200, body: OPENAI_OK }]);
    const cfg = stubChainCfg(a.port, b.port, { port: 59308, failover: false });

    try {
      const port = await startProxy(cfg, { runtimeFile: null });
      const res = await post(port, '/v1/messages', CHAT_REQ);
      assert.equal(res.status, 500);
      assert.equal(b.requests.length, 0);
    } finally {
      await stopProxy();
      await a.close();
      await b.close();
    }
  });

  it('supports manual switching via /__enables/switch and /__enables/next', async () => {
    const a = await createStubUpstream([{ status: 200, body: OPENAI_OK }]);
    const b = await createStubUpstream([{ status: 200, body: OPENAI_OK }]);
    const cfg = stubChainCfg(a.port, b.port, { port: 59309 });

    try {
      const port = await startProxy(cfg, { runtimeFile: null });

      // switch to stub-b
      const sw = await post(port, '/__enables/switch', { provider: 'stub-b' });
      assert.equal(sw.status, 200);
      assert.equal(JSON.parse(sw.text).activeProvider, 'stub-b');

      // next request goes to stub-b first
      await post(port, '/v1/messages', CHAT_REQ);
      assert.equal(b.requests.length, 1);
      assert.equal(a.requests.length, 0);

      // unknown provider → 404
      const bad = await post(port, '/__enables/switch', { provider: 'nope' });
      assert.equal(bad.status, 404);

      // next → cycles back to stub-a
      const nxt = await post(port, '/__enables/next', {});
      assert.equal(nxt.status, 200);
      assert.equal(JSON.parse(nxt.text).activeProvider, 'stub-a');

      // status shape
      const status = JSON.parse((await get(port, '/__enables/status')).text);
      assert.equal(status.chain.length, 2);
      assert.equal(status.chain[0].id, 'stub-a');
      assert.equal(status.counters.requests, 1);
    } finally {
      await stopProxy();
      await a.close();
      await b.close();
    }
  });

  it('exposes chain models on /v1/models and activeProvider on /health', async () => {
    const a = await createStubUpstream([{ status: 200, body: OPENAI_OK }]);
    const b = await createStubUpstream([{ status: 200, body: OPENAI_OK }]);
    const cfg = stubChainCfg(a.port, b.port, { port: 59310 });

    try {
      const port = await startProxy(cfg, { runtimeFile: null });
      const models = JSON.parse((await get(port, '/v1/models')).text);
      const ids = models.data.map((m: any) => m.id);
      assert.ok(ids.includes('model-a'));
      assert.ok(ids.includes('model-b'));

      const health = JSON.parse((await get(port, '/health')).text);
      assert.equal(health.activeProvider, 'stub-a');
      assert.equal(health.failover, true);
      assert.equal(health.chainLength, 2);
    } finally {
      await stopProxy();
      await a.close();
      await b.close();
    }
  });

  it('writes and clears the runtime discovery file', async () => {
    const os = await import('os');
    const fs = await import('fs');
    const path = await import('path');
    const a = await createStubUpstream([{ status: 200, body: OPENAI_OK }]);
    const cfg = stubChainCfg(a.port, a.port, { port: 59311 });
    const rtFile = path.join(os.tmpdir(), `enables-rt-test-${Date.now()}.json`);

    try {
      const port = await startProxy(cfg, { runtimeFile: rtFile });
      const info = JSON.parse(fs.readFileSync(rtFile, 'utf8'));
      assert.equal(info.port, port);
      assert.equal(typeof info.pid, 'number');
      await stopProxy();
      assert.equal(fs.existsSync(rtFile), false, 'runtime file removed on shutdown');
    } finally {
      await a.close();
      fs.rmSync(rtFile, { force: true });
    }
  });
});
