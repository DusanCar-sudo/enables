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
      const statusCode = await new Promise<number>((resolve, reject) => {
        const req = http.request(`http://127.0.0.1:${port}/v1/messages/count_tokens?beta=true`, { method: 'POST' }, (res) => {
          resolve(res.statusCode || 0);
        });
        req.on('error', reject);
        req.end();
      });

      assert.equal(statusCode, 200);
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
