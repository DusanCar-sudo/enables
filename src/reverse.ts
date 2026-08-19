// ─────────────────────────────────────────────────────────────────────────────
// Aura Enables — OpenAI Chat Completions → Anthropic Messages streaming reverse
// ─────────────────────────────────────────────────────────────────────────────
//
// Consumes an OpenAI streaming response and emits Anthropic‑format SSE events
// line by line through a callback.  This is called by the server as it reads
// the upstream response body.

export type SseWriter = (event: string, data: string) => void;

export interface ReverseStats {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/**
 * Convert an OpenAI Chat Completions byte stream (text/event-stream) into
 * Anthropic Messages API SSE events, feeding them via `writeSse`.
 *
 * Returns collected usage stats.
 */
export async function reverseStream(
  openaiStream: ReadableStream<Uint8Array> | NodeJS.ReadableStream,
  writeSse: SseWriter,
  targetModel: string,
): Promise<ReverseStats> {
  const decoder = new TextDecoder();
  let buffer = '';
  let stats: ReverseStats = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  let lastPromptTokens = 0;
  let lastCompletionTokens = 0;
  let lastCachedTokens = 0;

  // State machine
  let contentIndex = 0;       // next available content block index
  let inTextBlock = false;
  let inThinkingBlock = false;
  let textBlockIndex = -1;
  let thinkingBlockIndex = -1;
  let hasSentMessageStart = false;

  // Track each tool call by its OpenAI tool call index -> Anthropic content block index
  const toolCallBuilders = new Map<number, { id: string; name: string; blockIndex: number; stopped: boolean }>();

  function sendMessageStart() {
    if (hasSentMessageStart) return;
    hasSentMessageStart = true;
    const msg = {
      type: 'message_start',
      message: {
        id: `msg_${Date.now()}`,
        type: 'message',
        role: 'assistant',
        content: [] as unknown[],
        model: targetModel,
        stop_reason: null as string | null,
        stop_sequence: null as string | null,
        usage: { input_tokens: 0, output_tokens: 1 },
      },
    };
    writeSse('message_start', JSON.stringify(msg));
  }

  function closeThinkingBlock() {
    if (inThinkingBlock) {
      writeSse('content_block_stop', JSON.stringify({ type: 'content_block_stop', index: thinkingBlockIndex }));
      inThinkingBlock = false;
    }
  }

  function closeTextBlock() {
    if (inTextBlock) {
      writeSse('content_block_stop', JSON.stringify({ type: 'content_block_stop', index: textBlockIndex }));
      inTextBlock = false;
    }
  }

  function closeAllToolBlocks() {
    for (const [_, builder] of toolCallBuilders) {
      if (!builder.stopped) {
        writeSse('content_block_stop', JSON.stringify({ type: 'content_block_stop', index: builder.blockIndex }));
        builder.stopped = true;
      }
    }
  }

  function closeAllBlocks() {
    closeThinkingBlock();
    closeTextBlock();
    closeAllToolBlocks();
  }

  async function processLine(line: string) {
    if (!line.startsWith('data: ')) return;
    const payload = line.slice(6).trim();
    if (payload === '[DONE]') return;

    let chunk: any;
    try { chunk = JSON.parse(payload); } catch { return; }

    const choice = chunk.choices?.[0];
    if (!choice) {
      // Usage-only chunk (trailing)
      if (chunk.usage) {
        if (chunk.usage.prompt_tokens !== undefined) {
          stats.inputTokens += chunk.usage.prompt_tokens - lastPromptTokens;
          lastPromptTokens = chunk.usage.prompt_tokens;
        }
        if (chunk.usage.completion_tokens !== undefined) {
          stats.outputTokens += chunk.usage.completion_tokens - lastCompletionTokens;
          lastCompletionTokens = chunk.usage.completion_tokens;
        }
        if (chunk.usage.prompt_tokens_details?.cached_tokens !== undefined) {
          stats.cacheReadTokens += chunk.usage.prompt_tokens_details.cached_tokens - lastCachedTokens;
          lastCachedTokens = chunk.usage.prompt_tokens_details.cached_tokens;
        }
      }
      return;
    }

    const delta = choice.delta;

    // ── First chunk: sends message_start ─────────────────────────────────
    if (delta?.role === 'assistant') {
      sendMessageStart();
    }

    // ── Reasoning / Thinking delta (DeepSeek-R1, QwQ, etc.) ─────────────
    const reasoningText = delta?.reasoning_content ?? delta?.reasoning;
    if (reasoningText) {
      if (!hasSentMessageStart) sendMessageStart();
      closeTextBlock();
      if (!inThinkingBlock) {
        thinkingBlockIndex = contentIndex++;
        inThinkingBlock = true;
        writeSse('content_block_start', JSON.stringify({
          type: 'content_block_start',
          index: thinkingBlockIndex,
          content_block: { type: 'thinking', thinking: '' },
        }));
      }
      writeSse('content_block_delta', JSON.stringify({
        type: 'content_block_delta',
        index: thinkingBlockIndex,
        delta: { type: 'thinking_delta', thinking: reasoningText },
      }));
    }

    // ── Text delta ────────────────────────────────────────────────────────
    if (delta?.content) {
      if (!hasSentMessageStart) sendMessageStart();
      closeThinkingBlock();
      if (!inTextBlock) {
        textBlockIndex = contentIndex++;
        inTextBlock = true;
        writeSse('content_block_start', JSON.stringify({
          type: 'content_block_start',
          index: textBlockIndex,
          content_block: { type: 'text', text: '' },
        }));
      }
      writeSse('content_block_delta', JSON.stringify({
        type: 'content_block_delta',
        index: textBlockIndex,
        delta: { type: 'text_delta', text: delta.content },
      }));
    }

    // ── Tool call deltas ─────────────────────────────────────────────────
    for (const tc of delta?.tool_calls ?? []) {
      if (!hasSentMessageStart) sendMessageStart();
      closeThinkingBlock();
      closeTextBlock();

      let builder = toolCallBuilders.get(tc.index);
      if (!builder) {
        // First chunk for this tool call
        const id = tc.id || `toolu_${Date.now()}_${tc.index}`;
        const name = tc.function?.name || '';
        const blockIndex = contentIndex++;
        builder = { id, name, blockIndex, stopped: false };
        toolCallBuilders.set(tc.index, builder);
        writeSse('content_block_start', JSON.stringify({
          type: 'content_block_start',
          index: blockIndex,
          content_block: { type: 'tool_use', id, name, input: {} },
        }));
      }

      if (tc.function?.arguments) {
        writeSse('content_block_delta', JSON.stringify({
          type: 'content_block_delta',
          index: builder.blockIndex,
          delta: { type: 'input_json_delta', partial_json: tc.function.arguments },
        }));
      }
    }

    // ── Finish ────────────────────────────────────────────────────────────
    if (choice.finish_reason) {
      closeAllBlocks();

      // Map finish_reason
      let stopReason: string;
      switch (choice.finish_reason) {
        case 'tool_calls': stopReason = 'tool_use'; break;
        case 'length':     stopReason = 'max_tokens'; break;
        default:           stopReason = 'end_turn';
      }

      stats.outputTokens = chunk.usage?.completion_tokens ?? stats.outputTokens;
      stats.inputTokens = chunk.usage?.prompt_tokens ?? stats.inputTokens;
      stats.cacheReadTokens = chunk.usage?.prompt_tokens_details?.cached_tokens ?? stats.cacheReadTokens;

      writeSse('message_delta', JSON.stringify({
        type: 'message_delta',
        delta: { stop_reason: stopReason, stop_sequence: null },
        usage: { output_tokens: stats.outputTokens },
      }));

      writeSse('message_stop', JSON.stringify({ type: 'message_stop' }));
    }
  }

  // Read from the Node.js Readable stream using events (works across all Node versions)
  const stream = openaiStream as NodeJS.ReadableStream;
  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => {
      const decoded = decoder.decode(chunk, { stream: true });
      buffer += decoded;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        processLine(line).catch(reject);
      }
    });
    stream.on('end', () => {
      if (buffer.trim()) {
        processLine(buffer).catch(reject);
      }
      resolve();
    });
    stream.on('error', (err) => {
      console.error('[reverseStream] error:', err.message);
      reject(err);
    });
    // Resume the stream if it's in paused mode (Node.js http.IncomingMessage)
    stream.resume();
  });

  if (!hasSentMessageStart) {
    // Empty response guard
    sendMessageStart();
    closeAllBlocks();
    writeSse('message_delta', JSON.stringify({
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: stats.outputTokens || 1 },
    }));
    writeSse('message_stop', JSON.stringify({ type: 'message_stop' }));
  }

  return stats;
}

/**
 * Convert a non-streaming OpenAI response to an Anthropic response body.
 */
export function reverseNonStreaming(
  oaiBody: any,
  targetModel: string,
): object {
  const choice = oaiBody.choices?.[0];
  const content: any[] = [];

  // Reasoning content
  const reasoning = choice?.message?.reasoning_content ?? choice?.message?.reasoning;
  if (reasoning) {
    content.push({ type: 'thinking', thinking: reasoning });
  }

  // Text content
  if (choice?.message?.content) {
    content.push({ type: 'text', text: choice.message.content });
  }

  // Tool calls
  for (const tc of choice?.message?.tool_calls ?? []) {
    let input: Record<string, unknown>;
    try { input = JSON.parse(tc.function.arguments); } catch { input = {}; }
    content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input });
  }

  const finish = choice?.finish_reason;
  const stopReason =
    finish === 'tool_calls' ? 'tool_use' :
    finish === 'length' ? 'max_tokens' : 'end_turn';

  const usage = oaiBody.usage || {};
  return {
    id: `msg_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    content,
    model: targetModel,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: usage.prompt_tokens ?? 0, output_tokens: usage.completion_tokens ?? 0 },
  };
}
