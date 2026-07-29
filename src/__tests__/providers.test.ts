// ─────────────────────────────────────────────────────────────────────────────
// Aura Enables — tests for provider catalog definitions
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS } from '../providers.js';

describe('PROVIDERS catalog', () => {
  it('defines google provider with gemini-2.0-flash as default model', () => {
    const google = PROVIDERS.find(p => p.id === 'google');
    assert.ok(google, 'Google provider should exist in catalog');
    assert.equal(google.defaultModel, 'gemini-2.0-flash');
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

  it('updates openrouter google models', () => {
    const openrouter = PROVIDERS.find(p => p.id === 'openrouter');
    assert.ok(openrouter, 'OpenRouter provider should exist');
    assert.ok(openrouter.models.includes('google/gemini-2.0-flash'));
    assert.ok(!openrouter.models.includes('google/gemini-2.5-flash'));
  });
});
