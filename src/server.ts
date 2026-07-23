// ─────────────────────────────────────────────────────────────────────────────
// Aura Enables — HTTP server, proxy routing, /health, /v1/models
// ─────────────────────────────────────────────────────────────────────────────

import * as http from 'http';
import * as https from 'https';
import { PROVIDERS } from './providers.js';
import { translateToOpenAI, mergeAssistantMessages } from './translate.js';
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
import { R, G, B, K } from './cli.js';
import type { EnablesConfig } from './config.js';
import { findAvailablePort } from './port.js';

const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MB
const UPSTREAM_TIMEOUT_MS = 300_000;      // 5 minutes

let activeServer: http.Server | null = null;

export function stopProxy(): Promise<void> {
  return new Promise((resolve) => {
    if (activeServer) {
      const srv = activeServer;
      activeServer = null;
      srv.close(() => resolve());
    } else {
      resolve();
    }
  });
}

function chatCompletionsUrl(baseUrl: string): URL {
  const clean = baseUrl.replace(/\/+$/, '');
  return new URL(clean.endsWith('/chat/completions') ? clean : clean + '/chat/completions');
}

function anthropicMessagesUrl(baseUrl: string): URL {
  const clean = baseUrl.replace(/\/+$/, '');
  return new URL(clean.endsWith('/messages') ? clean : clean + '/messages');
}

export async function startProxy(cfg: EnablesConfig): Promise<number> {
  const pd = PROVIDERS.find(p => p.id === cfg.provider);
  const ak = cfg.targetApiKey || process.env[pd?.keyEnvVar || ''] || '';
  const tokenSaver = createTokenSaverSession();

  const reportTokenSaver = (estimatedInputTokens: number, usage: Partial<TokenSaverUsage>) => {
    recordTokenSaverUsage(tokenSaver, estimatedInputTokens, usage);
    console.log('  ' + G + 'Token Saver' + R + '  ' + K + tokenSaverLine(usage, tokenSaver, estimatedInputTokens) + R);
  };

  const port = await findAvailablePort(cfg.port || 8080);

  return new Promise((resolve, reject) => {
    const srv = http.createServer(async (req, res) => {
      const rawUrl = req.url || '';
      const pathname = rawUrl.split('?')[0];

      // ── GET /health ──────────────────────────────────────────────────────
      if (req.method === 'GET' && pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', provider: cfg.providerGroup || cfg.provider, model: cfg.bigModel }));
        return;
      }
      // ── GET /v1/models ───────────────────────────────────────────────────
      if (req.method === 'GET' && (pathname === '/v1/models' || pathname === '/models')) {
        const providerModels = pd?.models?.length ? pd.models : [cfg.bigModel || 'unknown'];
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
          ...providerModels,
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
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ input_tokens: 100 }));
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
          const tm = cfg.bigModel || 'deepseek-chat';
          const adapter = cfg.adapter || pd?.adapter || 'openai';
          const tu = adapter === 'anthropic'
            ? anthropicMessagesUrl(cfg.targetBaseUrl || '')
            : chatCompletionsUrl(cfg.targetBaseUrl || '');
          const tr = tu.protocol === 'https:' ? https : http;

          if (adapter === 'anthropic') {
            const anthropicBody = JSON.stringify({ ...body, model: tm });
            const pr = tr.request({
              hostname: tu.hostname, port: tu.port || (tu.protocol === 'https:' ? 443 : 80),
              path: tu.pathname + tu.search, method: 'POST',
              headers: {
                'content-type': 'application/json',
                'x-api-key': ak,
                'anthropic-version': '2023-06-01',
              },
            }, (pr2) => {
              if (body.stream) {
                if (pr2.statusCode !== 200) { let d = ''; pr2.on('data', (b: Buffer) => d += b.toString()); pr2.on('end', () => { res.writeHead(502); res.end(d); }); return; }
                res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
                pr2.pipe(res);
                let fullOutput = '';
                pr2.on('data', (b: Buffer) => { fullOutput += b.toString(); });
                pr2.on('end', () => {
                  reportTokenSaver(estimatedInputTokens, extractAnthropicUsage(fullOutput));
                });
              } else {
                let d = ''; pr2.on('data', (b: Buffer) => d += b.toString()); pr2.on('end', () => {
                  try {
                    res.writeHead(pr2.statusCode || 200, { 'Content-Type': 'application/json' });
                    res.end(d);
                    const parsed = JSON.parse(d);
                    reportTokenSaver(estimatedInputTokens, extractAnthropicUsage(parsed));
                  } catch { res.writeHead(502); res.end(d); }
                });
              }
            });
            pr.on('error', () => { if (!res.headersSent) { res.writeHead(502); res.end('{}'); } });
            pr.on('timeout', () => { pr.destroy(); if (!res.headersSent) { res.writeHead(504, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ type: 'error', error: { type: 'timeout_error', message: 'Upstream provider did not respond within 300s' } })); } });
            pr.write(anthropicBody); pr.end();
            return;
          }

          const oaiReq = translateToOpenAI(body, tm);
          const rb = JSON.stringify(oaiReq);
          const pr = tr.request({
            hostname: tu.hostname, port: tu.port || (tu.protocol === 'https:' ? 443 : 80),
            path: tu.pathname + tu.search, method: 'POST',
            headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + ak },
          }, (pr2) => {
            if (body.stream) {
              if (pr2.statusCode !== 200) { let d = ''; pr2.on('data', (b: Buffer) => d += b.toString()); pr2.on('end', () => { res.writeHead(502); res.end(d); }); return; }
              res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
              reverseStream(pr2, (ev, d) => res.write('event: ' + ev + '\ndata: ' + d + '\n\n'), tm)
                .then(stats => reportTokenSaver(estimatedInputTokens, stats))
                .catch(() => {})
                .finally(() => { try { res.end(); } catch {} });
            } else {
              let d = ''; pr2.on('data', (b: Buffer) => d += b.toString()); pr2.on('end', () => {
                try {
                  const o = JSON.parse(d);
                  if (o.error) { res.writeHead(502); res.end(JSON.stringify(o.error)); return; }
                  res.writeHead(200, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify(reverseNonStreaming(o, tm)));
                  reportTokenSaver(estimatedInputTokens, extractOpenAIUsage(o));
                }
                catch { res.writeHead(502); res.end(d); }
              });
            }
          });
          pr.on('error', () => { if (!res.headersSent) { res.writeHead(502); res.end('{}'); } });
          pr.on('timeout', () => { pr.destroy(); if (!res.headersSent) { res.writeHead(504, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ type: 'error', error: { type: 'timeout_error', message: 'Upstream provider did not respond within 300s' } })); } });
          pr.write(rb); pr.end();
        });
      } catch { if (!res.headersSent) { res.writeHead(500); res.end('{}'); } }
    });

    activeServer = srv;

    // ── Graceful shutdown ────────────────────────────────────────────────────
    const shutdown = () => {
      console.log('\n  Shutting down proxy...');
      srv.close(() => process.exit(0));
      setTimeout(() => process.exit(1), 3000).unref();
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);

    srv.once('error', (err) => reject(err));
    srv.listen(port, '127.0.0.1', () => {
      cfg.port = port;
      resolve(port);
    });
  });
}
