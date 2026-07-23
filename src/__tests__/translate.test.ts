// ─────────────────────────────────────────────────────────────────────────────
// Aura Enables — tests for translate.ts and reverse.ts
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { translateToOpenAI, mergeAssistantMessages } from '../translate.js';
import { reverseNonStreaming } from '../reverse.js';

// ── translateToOpenAI ──────────────────────────────────────────────────────

describe('translateToOpenAI', () => {
  it('converts a simple text message', () => {
    const result = translateToOpenAI({
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'Hello' }],
    }, 'deepseek-chat');

    assert.equal(result.model, 'deepseek-chat');
    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0].role, 'user');
    assert.equal(result.messages[0].content, 'Hello');
  });

  it('moves system prompt to messages[0]', () => {
    const result = translateToOpenAI({
      model: 'claude-sonnet-4-20250514',
      system: 'You are a helpful assistant',
      messages: [{ role: 'user', content: 'Hi' }],
    }, 'gpt-4o');

    assert.equal(result.messages[0].role, 'system');
    assert.equal(result.messages[0].content, 'You are a helpful assistant');
    assert.equal(result.messages[1].role, 'user');
    assert.equal(result.messages[1].content, 'Hi');
  });

  it('handles system as array of content blocks', () => {
    const result = translateToOpenAI({
      model: 'claude-sonnet-4-20250514',
      system: [{ type: 'text', text: 'Rule 1' }, { type: 'text', text: 'Rule 2' }],
      messages: [{ role: 'user', content: 'Hi' }],
    }, 'gpt-4o');

    assert.equal(result.messages[0].role, 'system');
    assert.equal(result.messages[0].content, 'Rule 1\nRule 2');
  });

  it('converts tool_use blocks to OpenAI tool_calls', () => {
    const result = translateToOpenAI({
      model: 'claude-sonnet-4-20250514',
      messages: [{
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tool_1', name: 'get_weather', input: { city: 'Paris' } },
        ],
      }],
    }, 'deepseek-chat');

    const assistantMsg = result.messages[0];
    assert.equal(assistantMsg.role, 'assistant');
    assert.equal(assistantMsg.content, null);
    assert.equal(assistantMsg.tool_calls!.length, 1);
    assert.equal(assistantMsg.tool_calls![0].id, 'tool_1');
    assert.equal(assistantMsg.tool_calls![0].function.name, 'get_weather');
    assert.equal(assistantMsg.tool_calls![0].function.arguments, '{"city":"Paris"}');
  });

  it('converts tool_result blocks to OpenAI tool messages', () => {
    const result = translateToOpenAI({
      model: 'claude-sonnet-4-20250514',
      messages: [{
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tool_1', content: '{"temp": 22}' },
        ],
      }],
    }, 'deepseek-chat');

    const toolMsg = result.messages[0];
    assert.equal(toolMsg.role, 'tool');
    assert.equal(toolMsg.tool_call_id, 'tool_1');
    assert.equal(toolMsg.content, '{"temp": 22}');
  });

  it('converts tools to OpenAI function format', () => {
    const result = translateToOpenAI({
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'Hi' }],
      tools: [{
        name: 'get_weather',
        description: 'Get weather for a city',
        input_schema: { type: 'object', properties: { city: { type: 'string' } } },
      }],
    }, 'deepseek-chat');

    assert.equal(result.tools!.length, 1);
    assert.equal(result.tools![0].type, 'function');
    assert.equal(result.tools![0].function.name, 'get_weather');
    assert.equal(result.tools![0].function.description, 'Get weather for a city');
    assert.deepEqual(result.tools![0].function.parameters, { type: 'object', properties: { city: { type: 'string' } } });
  });

  it('sets max_tokens default to 8192 when not provided', () => {
    const result = translateToOpenAI({
      messages: [{ role: 'user', content: 'Hi' }],
    }, 'deepseek-chat');

    assert.equal(result.max_tokens, 8192);
  });

  it('passes through max_tokens when provided', () => {
    const result = translateToOpenAI({
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 4096,
    }, 'deepseek-chat');

    assert.equal(result.max_tokens, 4096);
  });
});

// ── mergeAssistantMessages ─────────────────────────────────────────────────

describe('mergeAssistantMessages', () => {
  it('merges adjacent assistant messages', () => {
    const result = mergeAssistantMessages([
      { role: 'assistant', content: 'Hello' },
      { role: 'assistant', content: ' world' },
    ]);

    assert.equal(result.length, 1);
    assert.equal(result[0].content, 'Hello world');
  });

  it('merges adjacent assistant tool_calls', () => {
    const result = mergeAssistantMessages([
      { role: 'assistant', content: null, tool_calls: [{ id: '1', type: 'function', function: { name: 'a', arguments: '{}' } }] },
      { role: 'assistant', content: null, tool_calls: [{ id: '2', type: 'function', function: { name: 'b', arguments: '{}' } }] },
    ]);

    assert.equal(result.length, 1);
    assert.equal(result[0].tool_calls!.length, 2);
    assert.equal(result[0].tool_calls![0].id, '1');
    assert.equal(result[0].tool_calls![1].id, '2');
  });

  it('does not merge non-adjacent assistant messages', () => {
    const result = mergeAssistantMessages([
      { role: 'assistant', content: 'A' },
      { role: 'user', content: 'B' },
      { role: 'assistant', content: 'C' },
    ]);

    assert.equal(result.length, 3);
  });

  it('preserves user messages unchanged', () => {
    const result = mergeAssistantMessages([
      { role: 'user', content: 'Hello' },
    ]);

    assert.equal(result.length, 1);
    assert.equal(result[0].role, 'user');
    assert.equal(result[0].content, 'Hello');
  });
});

// ── reverseNonStreaming ────────────────────────────────────────────────────

describe('reverseNonStreaming', () => {
  it('converts a text response', () => {
    const result = reverseNonStreaming({
      choices: [{ message: { content: 'Hello world' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }, 'deepseek-chat') as any;

    assert.equal(result.type, 'message');
    assert.equal(result.role, 'assistant');
    assert.equal(result.model, 'deepseek-chat');
    assert.equal(result.stop_reason, 'end_turn');
    assert.equal(result.content.length, 1);
    assert.equal(result.content[0].type, 'text');
    assert.equal(result.content[0].text, 'Hello world');
    assert.equal(result.usage.input_tokens, 10);
    assert.equal(result.usage.output_tokens, 5);
  });

  it('converts tool_calls', () => {
    const result = reverseNonStreaming({
      choices: [{
        message: {
          content: null,
          tool_calls: [{ id: 'tc_1', function: { name: 'search', arguments: '{"q":"test"}' } }],
        },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }, 'gpt-4o') as any;

    assert.equal(result.content.length, 1);
    assert.equal(result.content[0].type, 'tool_use');
    assert.equal(result.content[0].id, 'tc_1');
    assert.equal(result.content[0].name, 'search');
    assert.deepEqual(result.content[0].input, { q: 'test' });
    assert.equal(result.stop_reason, 'tool_use');
  });

  it('maps length finish_reason to max_tokens', () => {
    const result = reverseNonStreaming({
      choices: [{ message: { content: 'Truncated' }, finish_reason: 'length' }],
    }, 'deepseek-chat') as any;

    assert.equal(result.stop_reason, 'max_tokens');
  });

  it('generates a msg_ id', () => {
    const result = reverseNonStreaming({
      choices: [{ message: { content: 'Hi' }, finish_reason: 'stop' }],
    }, 'deepseek-chat') as any;

    assert.ok(result.id.startsWith('msg_'));
  });

  it('handles empty response gracefully', () => {
    const result = reverseNonStreaming({
      choices: [{ message: {}, finish_reason: 'stop' }],
    }, 'deepseek-chat') as any;

    assert.equal(result.content.length, 0);
    assert.equal(result.stop_reason, 'end_turn');
  });
});
