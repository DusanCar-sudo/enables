// ─────────────────────────────────────────────────────────────────────────────
// Aura Enables — single upstream attempt: URL building, headers, request.
// Extracted from server.ts so the failover loop can re-send the same body
// to different candidates. `sendOnce` never throws — it resolves with a result.
// ─────────────────────────────────────────────────────────────────────────────

import * as http from 'http';
import * as https from 'https';
import type { Candidate } from './failover.js';

/** Short budget for establishing a connection so dead hosts fail over fast. */
const CONNECT_BUDGET_MS = 15_000;

export type SendResult =
  | { ok: true; res: http.IncomingMessage }
  | { ok: false; err: Error; timedOut: boolean };

export function chatCompletionsUrl(baseUrl: string): URL {
  const clean = baseUrl.replace(/\/+$/, '');
  return new URL(clean.endsWith('/chat/completions') ? clean : clean + '/chat/completions');
}

export function anthropicMessagesUrl(baseUrl: string): URL {
  const clean = baseUrl.replace(/\/+$/, '');
  return new URL(clean.endsWith('/messages') ? clean : clean + '/messages');
}

export function upstreamUrlFor(cand: Candidate): URL {
  return cand.adapter === 'anthropic'
    ? anthropicMessagesUrl(cand.baseUrl)
    : chatCompletionsUrl(cand.baseUrl);
}

export function buildHeaders(cand: Candidate): http.OutgoingHttpHeaders {
  if (cand.adapter === 'anthropic') {
    return {
      'content-type': 'application/json',
      'x-api-key': cand.apiKey,
      'anthropic-version': '2023-06-01',
    };
  }
  return {
    'content-type': 'application/json',
    'authorization': 'Bearer ' + cand.apiKey,
  };
}

export function sendOnce(cand: Candidate, url: URL, body: string, timeoutMs: number): Promise<SendResult> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (r: SendResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      resolve(r);
    };

    const tr = url.protocol === 'https:' ? https : http;
    const req = tr.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: buildHeaders(cand),
      timeout: timeoutMs,
    }, (res) => done({ ok: true, res }));

    req.on('timeout', () => {
      req.destroy();
      done({ ok: false, err: new Error(`socket idle for ${timeoutMs}ms`), timedOut: true });
    });
    req.on('error', (err) => done({ ok: false, err, timedOut: false }));

    // Connect budget: if the host hasn't even connected, bail out quickly
    // instead of hanging for the full (potentially minutes-long) timeout.
    const connectTimer = setTimeout(() => {
      req.destroy(new Error(`connect budget of ${CONNECT_BUDGET_MS}ms exceeded`));
      done({ ok: false, err: new Error(`connect budget of ${CONNECT_BUDGET_MS}ms exceeded`), timedOut: false });
    }, CONNECT_BUDGET_MS);

    req.write(body);
    req.end();
  });
}

export function readBody(res: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let d = '';
    res.on('data', (b: Buffer) => { d += b.toString(); });
    res.on('end', () => resolve(d));
    res.on('error', reject);
  });
}
