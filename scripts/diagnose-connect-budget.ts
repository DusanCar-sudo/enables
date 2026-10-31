#!/usr/bin/env node
// Isolates the connect-budget bug: does the upstream send response headers
// promptly, or does sendOnce's 15s connectTimer kill a healthy-but-slow model?
// A correct implementation must not report "connect budget exceeded" when the
// socket connected fine and the provider is still thinking.

import * as https from 'https';
import { findProvider } from '../src/providers.js';
import { resolveKey } from '../src/failover.js';

const id = process.argv[2] || 'nvidia';
const model = process.argv[3] || '';

function headersOnly(url: URL, key: string, body: string, budgetMs: number): Promise<{ ms: number; status: number | null; event: string }> {
  return new Promise(resolve => {
    const started = Date.now();
    let settled = false;
    const finish = (status: number | null, event: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      resolve({ ms: Date.now() - started, status, event });
    };
    const req = https.request({
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key, 'content-length': Buffer.byteLength(body) },
    }, res => {
      // Headers arrived: this is the event the connect timer is waiting for.
      res.resume();
      finish(res.statusCode ?? null, 'response-headers');
    });
    req.on('error', e => finish(null, 'error: ' + e.message));
    req.on('socket', s => {
      s.on('connect', () => console.log(`  socket connected at ${Date.now() - started}ms`));
    });
    const t = setTimeout(() => { req.destroy(); finish(null, `connect-budget ${budgetMs}ms exceeded`); }, budgetMs);
    req.write(body);
    req.end();
  });
}

async function main(): Promise<void> {
  const def = findProvider(id);
  if (!def) throw new Error('unknown provider ' + id);
  const { key } = resolveKey({} as any, id, def);
  if (!key) throw new Error('no key for ' + id);
  const url = new URL(def.baseUrl.replace(/\/+$/, '') + '/chat/completions');
  const body = JSON.stringify({
    model: model || def.defaultModel,
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Reply with exactly: pong' }],
  });
  for (const budget of [15000, 60000]) {
    console.log(`${id} budget=${budget}ms`);
    const r = await headersOnly(url, key, body, budget);
    console.log(`  → ${r.event} status=${r.status} after ${r.ms}ms\n`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
