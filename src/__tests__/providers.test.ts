// ─────────────────────────────────────────────────────────────────────────────
// Aura Enables — tests for provider catalog definitions
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS } from '../providers.js';

describe('PROVIDERS catalog', () => {
  it('defines google provider with a live default model', () => {
    const google = PROVIDERS.find(p => p.id === 'google');
    assert.ok(google, 'Google provider should exist in catalog');
    // gemini-2.0-flash was retired and 404s; verified live 2026-09-29 that
    // gemini-3.5-flash answers on the OpenAI-compatible endpoint.
    assert.equal(google.defaultModel, 'gemini-3.5-flash');
    assert.ok(google.models.includes('gemini-3.5-flash'));
    assert.ok(google.models.includes('gemini-flash-latest'));
    assert.ok(google.models.includes('gemini-2.0-flash'));
    assert.ok(google.models.includes('gemini-2.0-flash-lite'));
    assert.ok(google.models.includes('gemini-2.0-pro-exp-02-05'));
    assert.ok(google.models.includes('gemini-2.0-flash-thinking-exp-01-21'));
    assert.ok(google.models.includes('gemini-2.5-pro'));
    assert.ok(google.models.includes('gemini-3-pro-preview'));
    assert.ok(google.models.includes('gemini-3.1-pro-preview'));
    assert.ok(google.models.includes('gemini-3.5-flash'));
    assert.ok(!google.models.includes('gemini-2.5-flash'), 'gemini-2.5-flash is unavailable and must not be listed');
  });

  it('lists each provider defaultModel in its own models array', () => {
    // A default that is not in the models list is a silent misconfiguration:
    // /v1/models advertises one set while the request path sends another.
    for (const p of PROVIDERS) {
      if (!p.defaultModel || p.isCustom) continue;
      assert.ok(
        p.models.length === 0 || p.models.includes(p.defaultModel),
        `${p.id}: defaultModel '${p.defaultModel}' is not in its models list`,
      );
    }
  });

  it('keeps the NVIDIA default on a model that was verified live', () => {
    // The retired nemotron-3.5-lightning-30b-a3b 404s; pinning the verified
    // replacement stops the regression coming back.
    const nvidia = PROVIDERS.find(p => p.id === 'nvidia');
    assert.ok(nvidia);
    assert.equal(nvidia.defaultModel, 'deepseek-ai/deepseek-v4.1-flash');
  });

  it('lists all current OpenRouter free models', () => {
    const openrouter = PROVIDERS.find(p => p.id === 'openrouter');
    assert.ok(openrouter, 'OpenRouter provider should exist');
    assert.equal(openrouter.defaultModel, 'openrouter/free');
    // Every free text model verified live on 2026-09-21 must be present.
    const free = [
      'openrouter/free',
      'cohere/north-mini-code:free',
      'inclusionai/ling-3.0-flash-fin:free',
      'inclusionai/ling-3.0-flash-sante:free',
      'liquid/lfm-2.5-2.6b:free',
      'nvidia/nemotron-3-super-120b-a12b:free',
      'nvidia/nemotron-3-ultra-550b-a55b:free',
      'nvidia/nemotron-3.5-lightning:free',
      'poolside/laguna-s-2.1:free',
      'poolside/laguna-xs-2.1:free',
      'z-ai/glm-5.2:free',
    ];
    for (const m of free) {
      assert.ok(openrouter.models.includes(m), `OpenRouter should list free model ${m}`);
    }
  });

  it('lists current DeepSeek models', () => {
    const deepseek = PROVIDERS.find(p => p.id === 'deepseek');
    assert.ok(deepseek, 'DeepSeek provider should exist');
    assert.equal(deepseek.defaultModel, 'deepseek-v4-pro');
    assert.ok(deepseek.models.includes('deepseek-v4-pro'));
    assert.ok(deepseek.models.includes('deepseek-flash'));
    assert.ok(deepseek.models.includes('deepseek-reasoner'));
    assert.ok(!deepseek.models.includes('deepseek-chat'), 'deepseek-chat retired');
  });

  it('lists current OpenCode Zen free models', () => {
    const zen = PROVIDERS.find(p => p.id === 'opencode-zen');
    assert.ok(zen, 'OpenCode Zen provider should exist');
    assert.equal(zen.baseUrl, 'https://opencode.ai/zen/v1');
    assert.equal(zen.defaultModel, 'nemotron-3.5-lightning-free');
    for (const m of [
      'big-pickle', 'ling-3.0-flash-fin-free', 'mimo-v2.5-free',
      'muse-spark-1.2-contributor-free', 'muse-spark-1.3-contributor-free',
      'nemotron-3-ultra-free', 'nemotron-3.5-lightning-free', 'jev-1.13-free',
    ]) {
      assert.ok(zen.models.includes(m), `OpenCode Zen should list ${m}`);
    }
  });

  it('drops discontinued MiMo v2 models', () => {
    for (const id of ['mimo-token', 'mimo-payg']) {
      const mimo = PROVIDERS.find(p => p.id === id);
      assert.ok(mimo, `${id} provider should exist`);
      assert.ok(!mimo.models.includes('mimo-v2-flash'), 'mimo-v2-flash discontinued');
      assert.ok(mimo.models.includes('mimo-v2.5'), 'mimo-v2.5 is current');
    }
  });

  it('lists MiMo v2.6 models on both MiMo providers', () => {
    for (const id of ['mimo-token', 'mimo-payg']) {
      const mimo = PROVIDERS.find(p => p.id === id);
      assert.ok(mimo, `${id} provider should exist`);
      for (const m of ['mimo-v2.6-pro', 'mimo-v2.6-flash']) {
        assert.ok(mimo.models.includes(m), `${id} should list ${m}`);
      }
    }
  });

  it('drops retired GitHub Models from the free chain', async () => {
    const { FREE_TIER_CHAIN } = await import('../providers.js');
    assert.ok(!FREE_TIER_CHAIN.includes('github-models'), 'GitHub Models retired');
  });
});
