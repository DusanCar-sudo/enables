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
  let contentIndex = 0;       // which content block are we on
  let inTextBlock = false;
  let inToolBlock = false;
  let hasSentMessageStart = false;
  let hasSentFirstContent = false;

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

  function startTextBlock() {
    if (inTextBlock) return;
    closeBlock();
    inTextBlock = true;
    const block = { type: 'content_block_start', index: contentIndex, content_block: { type: 'text', text: '' } };
    writeSse('content_block_start', JSON.stringify(block));
  }

  function startToolBlock(id: string, name: string) {
    closeBlock();
    inToolBlock = true;
    const block = {
      type: 'content_block_start',
      index: contentIndex,
      content_block: { type: 'tool_use', id, name, input: {} },
    };
    writeSse('content_block_start', JSON.stringify(block));
  }

  function closeBlock() {
    if (inTextBlock || inToolBlock) {
      writeSse('content_block_stop', JSON.stringify({ type: 'content_block_stop', index: contentIndex }));
      contentIndex++;
      inTextBlock = false;
      inToolBlock = false;
    }
  }

  // Accumulate tool call args per index across chunks
  const toolCallBuilders = new Map<number, { id: string; name: string }>();

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

    // ── Text delta ────────────────────────────────────────────────────────
    if (delta?.content) {
      if (!hasSentMessageStart) sendMessageStart();
      if (!inTextBlock) startTextBlock();
      writeSse('content_block_delta', JSON.stringify({
        type: 'content_block_delta',
        index: contentIndex,
        delta: { type: 'text_delta', text: delta.content },
      }));
    }

    // ── Tool call deltas ─────────────────────────────────────────────────
    for (const tc of delta?.tool_calls ?? []) {
      if (!hasSentMessageStart) sendMessageStart();

      const builder = toolCallBuilders.get(tc.index);
      if (!builder) {
        // First chunk for this tool call
        const id = tc.id || `toolu_${Date.now()}_${tc.index}`;
        const name = tc.function?.name || '';
        toolCallBuilders.set(tc.index, { id, name });
        startToolBlock(id, name);
      }

      if (tc.function?.arguments) {
        writeSse('content_block_delta', JSON.stringify({
          type: 'content_block_delta',
          index: contentIndex,
          delta: { type: 'input_json_delta', partial_json: tc.function.arguments },
        }));
      }
    }

    // ── Finish ────────────────────────────────────────────────────────────
    if (choice.finish_reason) {
      closeBlock();

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
  })

  if (!hasSentMessageStart) {
    // Empty response guard
    sendMessageStart();
    closeBlock();
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
