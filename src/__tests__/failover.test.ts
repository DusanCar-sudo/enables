// ─────────────────────────────────────────────────────────────────────────────
// Aura Enables — tests for failover.ts (classification, chain building, state)
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyFailure,
  isRetryable,
  buildChain,
  createFailoverState,
  requestOrder,
  recordAttempt,
  recordFailover,
  recordExhausted,
  switchProvider,
  nextProvider,
  statusSnapshot,
} from '../failover.js';
import type { EnablesConfig } from '../config.js';

// Env vars that could leak in from the developer's shell and skew buildChain.
const KEY_ENV_VARS = [
  'GROQ_API_KEY', 'OPENROUTER_API_KEY', 'GOOGLE_API_KEY', 'NVIDIA_API_KEY',
  'GITHUB_MODELS_API_KEY', 'GITHUB_TOKEN', 'CEREBRAS_API_KEY',
  'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'MISTRAL_API_KEY',
  'OPENCODE_ZEN_API_KEY', 'MODELSCOPE_API_KEY', 'LLM7_API_KEY',
  'DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'XAI_API_KEY', 'TOGETHER_API_KEY',
  'FIREWORKS_API_KEY', 'PERPLEXITY_API_KEY', 'SAMBANOVA_API_KEY',
  'COHERE_API_KEY', 'ZHIPU_API_KEY', 'DASHSCOPE_API_KEY', 'MOONSHOT_API_KEY',
  'BAICHUAN_API_KEY', 'ANTHROPIC_API_KEY',
];

describe('classifyFailure', () => {
  it('maps status codes to failure kinds', () => {
    assert.equal(classifyFailure({ statusCode: 401, body: 'unauthorized' }).kind, 'auth');
    assert.equal(classifyFailure({ statusCode: 403, body: 'forbidden' }).kind, 'auth');
    assert.equal(classifyFailure({ statusCode: 402, body: 'payment required' }).kind, 'quota');
    assert.equal(classifyFailure({ statusCode: 429, body: 'too many requests' }).kind, 'rate_limit');
    assert.equal(classifyFailure({ statusCode: 500, body: 'oops' }).kind, 'server');
    assert.equal(classifyFailure({ statusCode: 503, body: '' }).kind, 'server');
    assert.equal(classifyFailure({ statusCode: 400, body: 'bad request' }).kind, 'non_retryable');
    assert.equal(classifyFailure({ statusCode: 404, body: 'nope' }).kind, 'non_retryable');
  });

  it('classifies network errors and timeouts', () => {
    const err = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), { code: 'ECONNREFUSED' });
    assert.equal(classifyFailure({ err }).kind, 'network');
    assert.equal(classifyFailure({ timedOut: true, err }).kind, 'timeout');
    assert.equal(classifyFailure({ timedOut: true }).kind, 'timeout');
  });

  it('sniffs quota errors from the body regardless of status', () => {
    const f = classifyFailure({ statusCode: 400, body: '{"error":{"message":"insufficient_quota: you exceeded your quota"}}' });
    assert.equal(f.kind, 'quota');
  });

  it('sniffs model errors from the body', () => {
    const f = classifyFailure({ statusCode: 404, body: '{"error":{"code":"model_not_found","message":"The model does not exist"}}' });
    assert.equal(f.kind, 'model');
  });

  it('treats HTTP 200 with an error body as body_error', () => {
    const f = classifyFailure({ statusCode: 200, body: '{"error":{"message":"upstream exploded"}}' });
    assert.equal(f.kind, 'body_error');
  });
});

describe('isRetryable', () => {
  it('retries every transient class and passes through non-retryable', () => {
    for (const kind of ['auth', 'quota', 'rate_limit', 'server', 'network', 'timeout', 'model', 'body_error'] as const) {
      assert.equal(isRetryable({ kind, message: '', body: '' }), true, kind);
    }
    assert.equal(isRetryable({ kind: 'non_retryable', statusCode: 400, message: '', body: '' }), false);
  });
});

describe('buildChain', () => {
  beforeEach(() => {
    for (const v of KEY_ENV_VARS) delete process.env[v];
  });
  afterEach(() => {
    for (const v of KEY_ENV_VARS) delete process.env[v];
  });

  it('puts the configured provider first, then free tier order', () => {
    process.env.GROQ_API_KEY = 'g';
    process.env.OPENROUTER_API_KEY = 'o';
    process.env.GOOGLE_API_KEY = 'k';
    const cfg: EnablesConfig = { provider: 'groq' };
    const chain = buildChain(cfg);
    assert.equal(chain[0].id, 'groq');
    const rest = chain.slice(1).map(c => c.id);
    assert.ok(rest.indexOf('openrouter') < rest.indexOf('google'), 'openrouter before google');
    assert.ok(chain.every(c => c.apiKey.length > 0 || c.keySource !== 'none'), 'every candidate has a key');
  });

  it('silently drops providers without keys', () => {
    process.env.GROQ_API_KEY = 'g';
    const cfg: EnablesConfig = {};
    const chain = buildChain(cfg);
    const ids = chain.map(c => c.id);
    assert.ok(ids.includes('groq'));
    assert.ok(!ids.includes('deepseek'), 'deepseek has no key — dropped');
    assert.ok(!ids.includes('cloudflare-workers-ai'), 'cloudflare needs key + account id — dropped');
  });

  it('honors an explicit failoverChain override verbatim', () => {
    process.env.DEEPSEEK_API_KEY = 'd';
    process.env.GROQ_API_KEY = 'g';
    const cfg: EnablesConfig = { failoverChain: ['deepseek', 'groq'] };
    const chain = buildChain(cfg);
    assert.deepEqual(chain.map(c => c.id), ['deepseek', 'groq']);
  });

  it('uses per-provider model overrides', () => {
    process.env.GROQ_API_KEY = 'g';
    const cfg: EnablesConfig = { providers: { groq: { model: 'llama-3.1-8b-instant' } } };
    const chain = buildChain(cfg);
    const groq = chain.find(c => c.id === 'groq');
    assert.equal(groq?.model, 'llama-3.1-8b-instant');
  });

  it('synthesizes a candidate for unknown ids that carry a baseUrl', () => {
    const cfg: EnablesConfig = {
      failoverChain: ['stub'],
      providers: { stub: { baseUrl: 'http://127.0.0.1:59999/v1', model: 'stub-model', apiKey: 'sk-test' } },
    };
    const chain = buildChain(cfg);
    assert.equal(chain.length, 1);
    assert.equal(chain[0].id, 'stub');
    assert.equal(chain[0].model, 'stub-model');
    assert.equal(chain[0].apiKey, 'sk-test');
  });

  it('honors targetBaseUrl/bigModel for the active provider instead of built-in defaults', () => {
    // Regression: resolveCandidate() ignored cfg.targetBaseUrl and always used def.baseUrl, so a
    // valid token-plan key was sent to dashscope-intl and rejected with 401 (enables looked dead).
    const cfg: EnablesConfig = {
      provider: 'dashscope',
      adapter: 'openai',
      targetBaseUrl: 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
      targetApiKey: 'sk-sp-testkey',
      bigModel: 'qwen3.7-plus',
      smallModel: 'qwen3.6-flash',
    };
    const chain = buildChain(cfg);
    const ds = chain.find((c) => c.id === 'dashscope');
    assert.ok(ds, 'active provider must appear in the chain');
    if (!ds) return;
    assert.equal(ds.baseUrl, cfg.targetBaseUrl);
    assert.ok(!/dashscope-intl/.test(ds.baseUrl), 'built-in endpoint must not override config');
    assert.equal(ds.model, 'qwen3.7-plus');
    assert.equal(ds.apiKey, 'sk-sp-testkey');

    assert.equal(ds.adapter, 'openai');
  });

  it('keeps built-in defaults for providers other than the active one', () => {
    // Guards against cfg.targetBaseUrl leaking down the failover chain: only the active provider
    // may have its endpoint/model overridden by top-level config.
    process.env.GROQ_API_KEY = 'g';
    const cfg: EnablesConfig = {
      provider: 'dashscope',
      targetBaseUrl: 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
      targetApiKey: 'sk-sp-testkey',
      bigModel: 'qwen3.7-plus',
      failoverChain: ['dashscope', 'groq'],
    };
    const chain = buildChain(cfg);
    const groq = chain.find((c) => c.id === 'groq');
    assert.ok(groq, 'groq should resolve when a key is present');
    if (!groq) return;
    assert.notEqual(groq.baseUrl, cfg.targetBaseUrl);
    assert.notEqual(groq.model, 'qwen3.7-plus');
  });

  it('dedupes by id keeping first occurrence', () => {
    process.env.GROQ_API_KEY = 'g';
    const cfg: EnablesConfig = { provider: 'groq', failoverChain: ['groq', 'openrouter'] };
    process.env.OPENROUTER_API_KEY = 'o';
    const chain = buildChain(cfg);
    assert.equal(chain.filter(c => c.id === 'groq').length, 1);
    assert.equal(chain[0].id, 'groq');
  });
});

describe('failover state & control ops', () => {
  const cfg: EnablesConfig = {
    provider: 'groq',
    failoverChain: ['groq', 'deepseek'],
    providers: { groq: { apiKey: 'g' }, deepseek: { apiKey: 'd' } },
  };

  it('requestOrder puts the override first', () => {
    const st = createFailoverState(cfg);
    assert.equal(st.activeId, 'groq');
    assert.deepEqual(requestOrder(st).map(c => c.id), ['groq', 'deepseek']);
    assert.equal(switchProvider(st, 'deepseek'), true);
    assert.deepEqual(requestOrder(st).map(c => c.id), ['deepseek', 'groq']);
  });

  it('switchProvider rejects unknown ids', () => {
    const st = createFailoverState(cfg);
    assert.equal(switchProvider(st, 'nonexistent'), false);
    assert.equal(st.override, null);
  });

  it('nextProvider cycles and returns null for a single-provider chain', () => {
    const st = createFailoverState(cfg);
    assert.equal(nextProvider(st), 'deepseek');
    assert.equal(nextProvider(st), 'groq');

    const single = createFailoverState({ provider: 'groq', failoverChain: ['groq'] });
    assert.equal(nextProvider(single), null);
  });

  it('records attempts, failovers and exhaustion; snapshot reflects them', () => {
    const st = createFailoverState(cfg);
    recordAttempt(st, 'groq', false, classifyFailure({ statusCode: 429, body: 'rate limited' }));
    recordFailover(st);
    recordAttempt(st, 'deepseek', true);
    recordExhausted(st);

    assert.equal(st.counters, st.counters); // reference sanity
    assert.equal(st.counters.requests, 2);
    assert.equal(st.counters.failovers, 1);
    assert.equal(st.counters.exhausted, 1);
    assert.equal(st.perProvider['groq'].failures, 1);
    assert.equal(st.perProvider['groq'].lastError?.kind, 'rate_limit');
    assert.equal(st.perProvider['deepseek'].successes, 1);

    const snap = statusSnapshot(st);
    assert.equal(snap.activeProvider, 'groq');
    assert.equal(snap.chain.length, 2);
    assert.equal(snap.chain[0].id, 'groq');
    assert.equal(snap.counters.failovers, 1);
    assert.equal(typeof snap.pid, 'number');
  });
});
