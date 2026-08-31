// ─────────────────────────────────────────────────────────────────────────────
// Aura Enables — tests for config.ts persistence & runtime discovery file
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadConfig, saveConfig, loadRuntime, saveRuntime, clearRuntime } from '../config.js';

let tmpDir: string;
let cfgFile: string;

describe('config persistence', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enables-cfg-'));
    cfgFile = path.join(tmpDir, 'config.json');
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('round-trips provider keys/models in the providers map', () => {
    saveConfig({ provider: 'groq', port: 8080 }, cfgFile);
    saveConfig({ providers: { groq: { apiKey: 'gsk_x', model: 'llama-3.3-70b-versatile' } } }, cfgFile);

    const cfg = loadConfig(cfgFile);
    assert.equal(cfg.provider, 'groq');
    assert.equal(cfg.port, 8080);
    assert.equal(cfg.providers?.groq?.apiKey, 'gsk_x');
  });

  it('preserves the providers map across unrelated partial saves', () => {
    saveConfig({ providers: { google: { apiKey: 'AIza' } }, failover: true }, cfgFile);
    saveConfig({ port: 9090 }, cfgFile);

    const cfg = loadConfig(cfgFile);
    assert.equal(cfg.providers?.google?.apiKey, 'AIza', 'providers survives a partial save');
    assert.equal(cfg.port, 9090);
    assert.equal(cfg.failover, true);
  });

  it('never writes explicit undefined values over stored fields', () => {
    saveConfig({ provider: 'deepseek', providers: { deepseek: { apiKey: 'sk' } } }, cfgFile);
    saveConfig({ providerName: undefined, providers: undefined } as Partial<import('../config.js').EnablesConfig>, cfgFile);

    const cfg = loadConfig(cfgFile);
    assert.equal(cfg.provider, 'deepseek');
    assert.equal(cfg.providers?.deepseek?.apiKey, 'sk', 'undefined does not clobber providers');
    assert.equal(cfg.providerName, undefined);
  });

  it('loadConfig returns {} for missing/corrupt files', () => {
    assert.deepEqual(loadConfig(path.join(tmpDir, 'missing.json')), {});
    fs.writeFileSync(path.join(tmpDir, 'bad.json'), 'not json{');
    assert.deepEqual(loadConfig(path.join(tmpDir, 'bad.json')), {});
  });
});

describe('runtime discovery file', () => {
  let rtFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enables-rt-'));
    rtFile = path.join(tmpDir, 'runtime.json');
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('save/load/clear round-trips', () => {
    assert.equal(loadRuntime(rtFile), undefined);
    saveRuntime({ port: 8123, pid: 4242, provider: 'groq', startedAt: 'now' }, rtFile);
    const info = loadRuntime(rtFile);
    assert.equal(info?.port, 8123);
    assert.equal(info?.pid, 4242);
    clearRuntime(rtFile);
    assert.equal(loadRuntime(rtFile), undefined);
  });

  it('clear is a no-op on a missing file', () => {
    clearRuntime(path.join(tmpDir, 'nope.json'));
  });
});
