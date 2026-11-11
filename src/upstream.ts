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
  // Z.ai and Anthropic both use /v1/messages
  if (clean.endsWith('/v1/messages')) return new URL(clean);
  if (clean.endsWith('/messages')) return new URL(clean.replace(/\/messages$/, '/v1/messages'));
  // A base URL that already ends in /v1 (e.g. https://api.anthropic.com/v1)
  // must not become /v1/v1/messages.
  if (clean.endsWith('/v1')) return new URL(clean + '/messages');
  return new URL(clean + '/v1/messages');
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

    // Connect budget: if the host hasn't even completed the TCP/TLS handshake,
    // bail out quickly instead of hanging for the full (potentially
    // minutes-long) timeout. The budget must be cleared on 'socket' — a real
    // handshake — and NOT on the response: providers legitimately take longer
    // than the budget to produce response headers (NVIDIA streams nothing for
    // 30s+), and killing those here made a healthy provider look like a
    // 'network' failure, so failover burned the budget on every attempt.
    const connectTimer = setTimeout(() => {
      req.destroy(new Error(`connect budget of ${CONNECT_BUDGET_MS}ms exceeded`));
      done({ ok: false, err: new Error(`connect budget of ${CONNECT_BUDGET_MS}ms exceeded`), timedOut: false });
    }, CONNECT_BUDGET_MS);
    req.on('socket', (sock) => {
      if ((sock as unknown as { connecting: boolean }).connecting) {
        sock.once('connect', () => clearTimeout(connectTimer));
      } else {
        clearTimeout(connectTimer);   // reused keep-alive socket: already connected
      }
    });

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

/**
 * GET the provider's own model catalog (e.g. OpenRouter's /v1/models, which
 * lists every model it can route — 100s of ids, not just the free tier).
 * Never throws; returns null on any failure so callers can fall back to the
 * static catalog baked into the provider definition.
 */
export async function fetchUpstreamModels(cand: Candidate, timeoutMs: number): Promise<any | null> {
  const url = cand.adapter === 'anthropic'
    ? anthropicModelsUrl(cand.baseUrl)
    : openaiModelsUrl(cand.baseUrl);
  if (!url) return null;
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: any) => { if (settled) return; settled = true; clearTimeout(connectTimer); resolve(v); };
    const tr = url.protocol === 'https:' ? https : http;
    const req = tr.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'GET',
      headers: buildHeaders(cand),
      timeout: timeoutMs,
    }, async (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        res.resume();
        return done(null);
      }
      try {
        const text = await readBody(res);
        const parsed = JSON.parse(text);
        done(Array.isArray(parsed?.data) ? parsed : null);
      } catch { done(null); }
    });
    req.on('timeout', () => { req.destroy(); done(null); });
    req.on('error', () => done(null));
    const connectTimer = setTimeout(() => { req.destroy(); done(null); }, Math.min(timeoutMs, 8000));
    req.end();
  });
}

function anthropicModelsUrl(baseUrl: string): URL | null {
  try {
    const u = new URL(baseUrl.endsWith('/') ? baseUrl + 'models' : baseUrl + '/models');
    // Anthropic's models endpoint lives at /v1/models; ensure the path has it.
    if (!/\/v1\/models$/i.test(u.pathname)) u.pathname = u.pathname.replace(/\/?$/, '/v1/models');
    return u;
  } catch { return null; }
}

function openaiModelsUrl(baseUrl: string): URL | null {
  try {
    const u = new URL(baseUrl.endsWith('/') ? baseUrl + 'models' : baseUrl + '/models');
    if (!/\/v1\/models$/i.test(u.pathname)) u.pathname = u.pathname.replace(/\/?$/, '/v1/models');
    return u;
  } catch { return null; }
}
