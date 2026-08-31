// ─────────────────────────────────────────────────────────────────────────────
// Aura Enables — HTTP server, proxy routing, failover loop, /health, /v1/models
// ─────────────────────────────────────────────────────────────────────────────

import * as http from 'http';
import { translateToOpenAI } from './translate.js';
import { reverseStream, reverseNonStreaming } from './reverse.js';
import type { AnthropicRequest } from './translate.js';
import {
  createTokenSaverSession,
  estimateTokensFromText,
  extractAnthropicUsage,
  extractOpenAIUsage,
  recordTokenSaverUsage,
  tokenSaverLine,
} from './tokenSaver.js';
import type { TokenSaverUsage } from './tokenSaver.js';
import { R, G, B, K, Y } from './cli.js';
import type { EnablesConfig } from './config.js';
import { RUNTIME_FILE, saveRuntime, clearRuntime } from './config.js';
import { findAvailablePort } from './port.js';
import {
  createFailoverState,
  requestOrder,
  recordAttempt,
  recordFailover,
  recordExhausted,
  switchProvider,
  nextProvider,
  statusSnapshot,
  classifyFailure,
  isRetryable,
} from './failover.js';
import type { FailoverState, Failure, Candidate } from './failover.js';
import { sendOnce, readBody, upstreamUrlFor } from './upstream.js';

const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MB
const UPSTREAM_TIMEOUT_MS = 300_000;      // 5 minutes

let activeServer: http.Server | null = null;
let activeRuntimeFile: string | null = null;

export function stopProxy(): Promise<void> {
  return new Promise((resolve) => {
    if (activeServer) {
      const srv = activeServer;
      activeServer = null;
      if (activeRuntimeFile) {
        clearRuntime(activeRuntimeFile);
        activeRuntimeFile = null;
      }
      srv.close(() => resolve());
    } else {
      resolve();
    }
  });
}

export interface StartProxyOptions {
  /** Path of the runtime discovery file; `null` disables writing it (tests). */
  runtimeFile?: string | null;
}

export async function startProxy(cfg: EnablesConfig, opts: StartProxyOptions = {}): Promise<number> {
  const st = createFailoverState(cfg);
  const tokenSaver = createTokenSaverSession();

  const reportTokenSaver = (estimatedInputTokens: number, usage: Partial<TokenSaverUsage>) => {
    recordTokenSaverUsage(tokenSaver, estimatedInputTokens, usage);
    console.log('  ' + G + 'Token Saver' + R + '  ' + K + tokenSaverLine(usage, tokenSaver, estimatedInputTokens) + R);
  };

  const failoverLog = (cand: Candidate, f: Failure, nextId: string | undefined) => {
    const where = nextId ? K + ' → trying ' + nextId + R : K + ' → no providers left' + R;
    console.log('  ' + Y + '[failover]' + R + ' ' + B + cand.id + R + ' '
      + (f.statusCode ? f.statusCode + ' ' : '') + f.kind + where);
  };

  const port = await findAvailablePort(cfg.port || 8080);

  return new Promise((resolve, reject) => {
    const srv = http.createServer(async (req, res) => {
      const rawUrl = req.url || '';
      const pathname = rawUrl.split('?')[0];

      // ── GET /health ──────────────────────────────────────────────────────
      if (req.method === 'GET' && pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          provider: cfg.providerGroup || cfg.provider,
          model: cfg.bigModel,
          activeProvider: st.activeId,
          failover: cfg.failover !== false,
          chainLength: st.chain.length,
        }));
        return;
      }
      // ── GET /__enables/status ────────────────────────────────────────────
      if (req.method === 'GET' && pathname === '/__enables/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(statusSnapshot(st)));
        return;
      }
      // ── POST /__enables/switch ───────────────────────────────────────────
      if (req.method === 'POST' && pathname === '/__enables/switch') {
        const chunks: Buffer[] = [];
        req.on('data', (b: Buffer) => chunks.push(b));
        req.on('end', () => {
          let providerId = '';
          try { providerId = JSON.parse(Buffer.concat(chunks).toString()).provider || ''; } catch { /* fallthrough */ }
          if (!providerId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'missing "provider" field' }));
            return;
          }
          if (!switchProvider(st, providerId)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: `unknown provider "${providerId}" (not in failover chain)` }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, activeProvider: st.activeId }));
        });
        return;
      }
      // ── POST /__enables/next ─────────────────────────────────────────────
      if (req.method === 'POST' && pathname === '/__enables/next') {
        const id = nextProvider(st);
        if (!id) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'failover chain has fewer than 2 providers' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, activeProvider: id }));
        return;
      }
      // ── GET /v1/models ───────────────────────────────────────────────────
      if (req.method === 'GET' && (pathname === '/v1/models' || pathname === '/models')) {
        const chainModels = st.chain.flatMap(c => [c.model]);
        const allModelIds = Array.from(new Set([
          'claude-sonnet-4-6',
          'claude-opus-4-8',
          'claude-opus-4-6',
          'claude-sonnet-4-5',
          'claude-haiku-4-5',
          'claude-3-7-sonnet-20250219',
          'claude-3-5-sonnet-20241022',
          'claude-3-5-sonnet-20240620',
          'claude-3-5-haiku-20241022',
          'claude-3-opus-20240229',
          'claude-3-sonnet-20240229',
          'claude-3-haiku-20240307',
          ...chainModels,
          ...(cfg.bigModel ? [cfg.bigModel] : []),
        ]));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          object: 'list',
          data: allModelIds.map(m => ({
            id: m,
            object: 'model',
            type: 'model',
            display_name: m,
            created_at: 1700000000,
            owned_by: 'enables',
          })),
          has_more: false,
          first_id: allModelIds[0],
          last_id: allModelIds[allModelIds.length - 1],
        }));
        return;
      }
      // ── POST /v1/messages/count_tokens ───────────────────────────────────
      if (req.method === 'POST' && (pathname === '/v1/messages/count_tokens' || pathname === '/messages/count_tokens')) {
        const countChunks: Buffer[] = [];
        req.on('data', (b: Buffer) => { countChunks.push(b); });
        req.on('end', () => {
          const rawBody = Buffer.concat(countChunks).toString();
          const count = estimateTokensFromText(rawBody);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ input_tokens: count || 100 }));
        });
        return;
      }
      // ── POST /v1/messages ────────────────────────────────────────────────
      if (req.method !== 'POST' || (pathname !== '/v1/messages' && pathname !== '/messages')) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'Not Found' } }));
        return;
      }
      try {
        const chunks: Buffer[] = [];
        let bodyLen = 0;
        req.on('data', (b: Buffer) => { bodyLen += b.length; if (bodyLen > MAX_BODY_BYTES) { req.destroy(); if (!res.headersSent) { res.writeHead(413, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Request body exceeds 10 MB limit' } })); } return; } chunks.push(b); });
        req.on('end', async () => {
          const rawBody = Buffer.concat(chunks).toString();
          const estimatedInputTokens = estimateTokensFromText(rawBody);
          let body: AnthropicRequest;
          try { body = JSON.parse(rawBody) as AnthropicRequest; } catch {
            if (!res.headersSent) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Malformed JSON in request body' } })); }
            return;
          }

          const timeoutMs = cfg.upstreamTimeoutMs ?? UPSTREAM_TIMEOUT_MS;
          const order = cfg.failover === false ? requestOrder(st).slice(0, 1) : requestOrder(st);
          let hasSentHeaders = false;
          let lastCand: Candidate | undefined;
          let lastFailure: Failure | undefined;
          let lastStatus: number | undefined;
          let lastBody: string | undefined;

          for (const cand of order) {
            const url = upstreamUrlFor(cand);
            const bodyStr = cand.adapter === 'anthropic'
              ? JSON.stringify({ ...body, model: cand.model })
              : JSON.stringify(translateToOpenAI(body, cand.model));

            const r = await sendOnce(cand, url, bodyStr, timeoutMs);

            // ── network / timeout ──────────────────────────────────────────
            if (!r.ok) {
              const f = classifyFailure({ err: r.err, timedOut: r.timedOut });
              recordAttempt(st, cand.id, false, f);
              lastCand = cand; lastFailure = f;
              if (!hasSentHeaders) {
                failoverLog(cand, f, order[order.indexOf(cand) + 1]?.id);
                recordFailover(st);
                continue;
              }
              if (!res.headersSent) res.writeHead(502);
              res.end('{}');
              return;
            }

            // ── non-200 status ─────────────────────────────────────────────
            if (r.res.statusCode !== 200) {
              const text = await readBody(r.res);
              const f = classifyFailure({ statusCode: r.res.statusCode, body: text });
              recordAttempt(st, cand.id, false, f);
              lastCand = cand; lastFailure = f; lastStatus = r.res.statusCode; lastBody = text;
              if (isRetryable(f) && !hasSentHeaders) {
                failoverLog(cand, f, order[order.indexOf(cand) + 1]?.id);
                recordFailover(st);
                continue;
              }
              res.writeHead(r.res.statusCode || 502, { 'Content-Type': 'application/json' });
              hasSentHeaders = true;
              res.end(text);
              return;
            }

            // ── 200 non-streaming: buffer, so 200-with-error can fail over ─
            if (!body.stream) {
              const text = await readBody(r.res);
              if (cand.adapter === 'anthropic') {
                try {
                  const parsed = JSON.parse(text);
                  if (parsed && parsed.error) {
                    const f = classifyFailure({ statusCode: 200, body: text });
                    recordAttempt(st, cand.id, false, f);
                    lastCand = cand; lastFailure = f;
                    if (isRetryable(f) && !hasSentHeaders) {
                      failoverLog(cand, f, order[order.indexOf(cand) + 1]?.id);
                      recordFailover(st);
                      continue;
                    }
                    res.writeHead(502, { 'Content-Type': 'application/json' });
                    hasSentHeaders = true;
                    res.end(JSON.stringify(parsed.error));
                    return;
                  }
                  recordAttempt(st, cand.id, true);
                  res.writeHead(200, { 'Content-Type': 'application/json' });
                  hasSentHeaders = true;
                  res.end(text); // native anthropic response — pass through
                  reportTokenSaver(estimatedInputTokens, extractAnthropicUsage(parsed));
                } catch {
                  recordAttempt(st, cand.id, true);
                  res.writeHead(200, { 'Content-Type': 'application/json' });
                  hasSentHeaders = true;
                  res.end(text);
                }
                return;
              }
              try {
                const o = JSON.parse(text);
                if (o.error) {
                  const f = classifyFailure({ statusCode: 200, body: text });
                  recordAttempt(st, cand.id, false, f);
                  lastCand = cand; lastFailure = f;
                  if (isRetryable(f) && !hasSentHeaders) {
                    failoverLog(cand, f, order[order.indexOf(cand) + 1]?.id);
                    recordFailover(st);
                    continue;
                  }
                  res.writeHead(502, { 'Content-Type': 'application/json' });
                  hasSentHeaders = true;
                  res.end(JSON.stringify(o.error));
                  return;
                }
                recordAttempt(st, cand.id, true);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                hasSentHeaders = true;
                res.end(JSON.stringify(reverseNonStreaming(o, cand.model)));
                reportTokenSaver(estimatedInputTokens, extractOpenAIUsage(o));
              } catch {
                recordAttempt(st, cand.id, true);
                res.writeHead(502);
                hasSentHeaders = true;
                res.end(text);
              }
              return;
            }

            // ── 200 streaming: the point of no return ──────────────────────
            recordAttempt(st, cand.id, true);
            res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
            hasSentHeaders = true;
            const pingInterval = setInterval(() => {
              if (!res.writableEnded) {
                try { res.write(': ping\n\n'); } catch { /* client gone */ }
              }
            }, 15000);
            res.on('close', () => clearInterval(pingInterval));
            if (cand.adapter === 'anthropic') {
              r.res.pipe(res);
              let fullOutput = '';
              r.res.on('data', (b: Buffer) => { fullOutput += b.toString(); });
              r.res.on('end', () => {
                clearInterval(pingInterval);
                reportTokenSaver(estimatedInputTokens, extractAnthropicUsage(fullOutput));
              });
            } else {
              reverseStream(r.res, (ev, d) => res.write('event: ' + ev + '\ndata: ' + d + '\n\n'), cand.model)
                .then(stats => reportTokenSaver(estimatedInputTokens, stats))
                .catch(() => { /* mid-stream failures can no longer fail over */ })
                .finally(() => {
                  clearInterval(pingInterval);
                  try { res.end(); } catch { /* already closed */ }
                });
            }
            return;
          }

          // ── chain exhausted ──────────────────────────────────────────────
          recordExhausted(st);
          // No failover happened (single candidate / failover disabled): pass
          // the upstream error through untouched instead of wrapping it.
          if (order.length === 1 && lastStatus !== undefined) {
            res.writeHead(lastStatus, { 'Content-Type': 'application/json' });
            res.end(lastBody);
            return;
          }
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            type: 'error',
            error: {
              type: 'api_error',
              message: 'All providers in the failover chain failed'
                + (lastCand ? ` (last: ${lastCand.id})` : '')
                + (lastFailure ? `: ${lastFailure.message}` : ''),
            },
          }));
        });
      } catch { if (!res.headersSent) { res.writeHead(500); res.end('{}'); } }
    });

    activeServer = srv;

    // ── Graceful shutdown ────────────────────────────────────────────────────
    const runtimeFile = opts.runtimeFile === undefined ? RUNTIME_FILE : opts.runtimeFile;
    activeRuntimeFile = runtimeFile;
    const shutdown = () => {
      console.log('\n  Shutting down proxy...');
      if (runtimeFile) clearRuntime(runtimeFile);
      srv.close(() => process.exit(0));
      setTimeout(() => process.exit(1), 3000).unref();
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);

    srv.once('error', (err) => reject(err));
    srv.listen(port, '127.0.0.1', () => {
      cfg.port = port;
      if (runtimeFile) {
        saveRuntime({ port, pid: process.pid, provider: st.activeId || cfg.provider || '', startedAt: st.startedAt }, runtimeFile);
      }
      resolve(port);
    });
  });
}
