// ─────────────────────────────────────────────────────────────────────────────
// Aura Enables — tests for translate.ts and reverse.ts
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { translateToOpenAI, mergeAssistantMessages } from '../translate.js';
import { reverseNonStreaming, reverseStream } from '../reverse.js';
import { extractAnthropicUsage } from '../tokenSaver.js';

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

  it('converts base64 image blocks to OpenAI image_url format', () => {
    const result = translateToOpenAI({
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Analyze this image' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUg==' } },
        ],
      }],
    }, 'gpt-4o');

    assert.equal(result.messages.length, 1);
    const userMsg = result.messages[0];
    assert.equal(userMsg.role, 'user');
    assert.ok(Array.isArray(userMsg.content));
    assert.equal(userMsg.content.length, 2);
    assert.equal(userMsg.content[0].type, 'text');
    assert.equal(userMsg.content[0].text, 'Analyze this image');
    assert.equal(userMsg.content[1].type, 'image_url');
    assert.equal(userMsg.content[1].image_url.url, 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==');
  });

  it('automatically merges consecutive assistant messages and tool calls', () => {
    const result = translateToOpenAI({
      messages: [{
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me run that command for you.' },
          { type: 'tool_use', id: 'tool_call_123', name: 'bash', input: { command: 'ls -la' } },
        ],
      }],
    }, 'gpt-4o');

    assert.equal(result.messages.length, 1);
    const assistantMsg = result.messages[0];
    assert.equal(assistantMsg.role, 'assistant');
    assert.equal(assistantMsg.content, 'Let me run that command for you.');
    assert.equal(assistantMsg.tool_calls!.length, 1);
    assert.equal(assistantMsg.tool_calls![0].id, 'tool_call_123');
    assert.equal(assistantMsg.tool_calls![0].function.name, 'bash');
  });

  it('drops unnamed tool calls and their results from history', () => {
    const result = translateToOpenAI({
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tool_1', name: '', input: { command: 'ls' } }],
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'tool_1', content: 'Error: no such tool' }],
        },
        { role: 'user', content: 'continue' },
      ],
    }, 'mimo-v2.6-pro');

    assert.ok(!result.messages.some(m => m.role === 'tool'), 'orphan tool result dropped');
    assert.ok(!result.messages.some(m => (m.tool_calls ?? []).length > 0), 'invalid tool call dropped');
    assert.ok(
      result.messages.some(m => m.role === 'assistant' && String(m.content).includes('unnamed tool')),
      'dropped call kept as text note',
    );
    assert.equal(result.messages[result.messages.length - 1].content, 'continue');
  });

  it('drops tool calls to tools missing from the toolset', () => {
    const result = translateToOpenAI({
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'tool_1', name: 'Bash', input: { command: 'ls' } },
            { type: 'tool_use', id: 'tool_2', name: 'get_weather', input: { city: 'Paris' } },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tool_1', content: 'ok' },
            { type: 'tool_result', tool_use_id: 'tool_2', content: '{"temp": 22}' },
          ],
        },
      ],
      tools: [{ name: 'get_weather', input_schema: { type: 'object' } }],
    }, 'mimo-v2.6-pro');

    const toolMsgs = result.messages.filter(m => m.role === 'tool');
    assert.equal(toolMsgs.length, 1);
    assert.equal(toolMsgs[0].tool_call_id, 'tool_2');
    const calls = result.messages.flatMap(m => m.tool_calls ?? []);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].function.name, 'get_weather');
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
    assert.equal(result[0].content, 'Hello\n world');
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

  it('converts reasoning_content to thinking content block', () => {
    const result = reverseNonStreaming({
      choices: [{
        message: {
          content: 'The answer is 42',
          reasoning_content: 'Let me think step by step...',
        },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 20, completion_tokens: 15 },
    }, 'deepseek-reasoner') as any;

    assert.equal(result.content.length, 2);
    assert.equal(result.content[0].type, 'thinking');
    assert.equal(result.content[0].thinking, 'Let me think step by step...');
    assert.equal(result.content[1].type, 'text');
    assert.equal(result.content[1].text, 'The answer is 42');
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

  it('converts unnamed tool calls to a text fallback', () => {
    const result = reverseNonStreaming({
      choices: [{
        message: {
          content: null,
          tool_calls: [
            { id: 'tc_1', function: { name: '', arguments: '{"x":1}' } },
            { function: { name: 'search', arguments: '{"q":"t"}' } },
          ],
        },
        finish_reason: 'tool_calls',
      }],
    }, 'mimo-v2.6-pro') as any;

    assert.equal(result.content.length, 2);
    assert.equal(result.content[0].type, 'text');
    assert.ok(result.content[0].text.includes('unnamed tool'));
    assert.ok(result.content[0].text.includes('{"x":1}'));
    assert.equal(result.content[1].type, 'tool_use');
    assert.equal(result.content[1].name, 'search');
    assert.ok(result.content[1].id, 'missing tool_call id is synthesized');
    assert.equal(result.stop_reason, 'tool_use');
  });
});

describe('extractAnthropicUsage', () => {
  it('extracts usage from JSON object', () => {
    const usage = extractAnthropicUsage({
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 20 },
    });
    assert.equal(usage.inputTokens, 100);
    assert.equal(usage.outputTokens, 50);
    assert.equal(usage.cacheReadTokens, 20);
  });

  it('extracts usage from SSE string body', () => {
    const sse = [
      'event: message_start',
      'data: {"type":"message_start","message":{"usage":{"input_tokens":120,"output_tokens":1}}}',
      'event: message_delta',
      'data: {"type":"message_delta","usage":{"output_tokens":45}}',
    ].join('\n');

    const usage = extractAnthropicUsage(sse);
    assert.equal(usage.inputTokens, 120);
    assert.equal(usage.outputTokens, 45);
  });
});

// ── reverseStream ──────────────────────────────────────────────────────────

describe('reverseStream', () => {
  it('streams reasoning content as thinking blocks', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"role":"assistant","reasoning_content":"Thinking deeply..."}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Here is the answer."}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":8}}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = Readable.from(chunks.map(c => Buffer.from(c)));
    const events: { event: string; data: any }[] = [];

    const stats = await reverseStream(
      stream,
      (event, data) => { events.push({ event, data: JSON.parse(data) }); },
      'deepseek-reasoner',
    );

    assert.equal(stats.inputTokens, 10);
    assert.equal(stats.outputTokens, 8);

    // Verify thinking block start, delta, and stop
    const thinkingStart = events.find(e => e.event === 'content_block_start' && e.data.content_block?.type === 'thinking');
    assert.ok(thinkingStart, 'Should have emitted thinking block start');

    const thinkingDelta = events.find(e => e.event === 'content_block_delta' && e.data.delta?.type === 'thinking_delta');
    assert.ok(thinkingDelta, 'Should have emitted thinking delta');
    assert.equal(thinkingDelta.data.delta.thinking, 'Thinking deeply...');

    // Verify text block start and delta
    const textStart = events.find(e => e.event === 'content_block_start' && e.data.content_block?.type === 'text');
    assert.ok(textStart, 'Should have emitted text block start');

    const textDelta = events.find(e => e.event === 'content_block_delta' && e.data.delta?.type === 'text_delta');
    assert.ok(textDelta, 'Should have emitted text delta');
    assert.equal(textDelta.data.delta.text, 'Here is the answer.');
  });

  it('streams parallel tool calls with consistent block indexing', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"tc_0","function":{"name":"read_file","arguments":""}},{"index":1,"id":"tc_1","function":{"name":"search","arguments":""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"path\\": \\"index.ts\\"}"}},{"index":1,"function":{"arguments":"{\\"query\\": \\"test\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":15,"completion_tokens":12}}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = Readable.from(chunks.map(c => Buffer.from(c)));
    const events: { event: string; data: any }[] = [];

    await reverseStream(
      stream,
      (event, data) => { events.push({ event, data: JSON.parse(data) }); },
      'gpt-4o',
    );

    const toolStarts = events.filter(e => e.event === 'content_block_start' && e.data.content_block?.type === 'tool_use');
    assert.equal(toolStarts.length, 2);
    assert.equal(toolStarts[0].data.content_block.name, 'read_file');
    assert.equal(toolStarts[1].data.content_block.name, 'search');
    assert.notEqual(toolStarts[0].data.index, toolStarts[1].data.index);

    const toolDeltas = events.filter(e => e.event === 'content_block_delta' && e.data.delta?.type === 'input_json_delta');
    assert.equal(toolDeltas.length, 2);
    assert.equal(toolDeltas[0].data.index, toolStarts[0].data.index);
    assert.equal(toolDeltas[1].data.index, toolStarts[1].data.index);
  });

  it('recovers tool names that arrive after the first chunk', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"tc_0","function":{"name":"","arguments":""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"read_file"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"path\\": \\"a.ts\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":5,"completion_tokens":4}}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = Readable.from(chunks.map(c => Buffer.from(c)));
    const events: { event: string; data: any }[] = [];
    await reverseStream(
      stream,
      (event, data) => { events.push({ event, data: JSON.parse(data) }); },
      'mimo-v2.6-pro',
    );

    const toolStarts = events.filter(e => e.event === 'content_block_start' && e.data.content_block?.type === 'tool_use');
    assert.equal(toolStarts.length, 1);
    assert.equal(toolStarts[0].data.content_block.name, 'read_file');

    const toolDeltas = events.filter(e => e.event === 'content_block_delta' && e.data.delta?.type === 'input_json_delta');
    assert.equal(toolDeltas.length, 1);
    assert.equal(toolDeltas[0].data.delta.partial_json, '{"path": "a.ts"}');
  });

  it('falls back to text for tool calls that never get a name', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"tc_0","function":{"name":"","arguments":"{\\"x\\": 1}"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":5,"completion_tokens":4}}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = Readable.from(chunks.map(c => Buffer.from(c)));
    const events: { event: string; data: any }[] = [];
    await reverseStream(
      stream,
      (event, data) => { events.push({ event, data: JSON.parse(data) }); },
      'mimo-v2.6-pro',
    );

    const toolStarts = events.filter(e => e.event === 'content_block_start' && e.data.content_block?.type === 'tool_use');
    assert.equal(toolStarts.length, 0, 'no empty-name tool_use is emitted');

    const textStarts = events.filter(e => e.event === 'content_block_start' && e.data.content_block?.type === 'text');
    assert.equal(textStarts.length, 1);
    const textDelta = events.find(e => e.event === 'content_block_delta' && e.data.delta?.type === 'text_delta');
    assert.ok(textDelta, 'fallback text delta emitted');
    assert.ok(String(textDelta.data.delta.text).includes('{"x": 1}'));

    const stop = events.find(e => e.event === 'message_delta');
    assert.ok(stop, 'message_delta emitted');
    assert.equal(stop.data.delta.stop_reason, 'end_turn');
  });
});
