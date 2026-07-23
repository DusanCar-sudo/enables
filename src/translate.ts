// ─────────────────────────────────────────────────────────────────────────────
// Aura Enables — Anthropic Messages API → OpenAI Chat Completions translator
// ─────────────────────────────────────────────────────────────────────────────
// Converts every semantically relevant field so the target OAI‑compatible
// endpoint sees a valid request, and the response can be reversed faithfully.

export interface AnthropicRequest {
  model?: string;
  system?: string | { type: 'text'; text: string }[];
  messages: AnthropicMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  tools?: AnthropicTool[];
  tool_choice?: { type: 'auto' | 'any' | 'tool'; name?: string };
  stream?: boolean;
  metadata?: Record<string, unknown>;
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string | AnthropicContentBlock[]; is_error?: boolean }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
  name?: string;
}

interface OpenAIStreamOption {
  include_usage?: boolean;
}

interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  stream_options?: OpenAIStreamOption;
  tools?: OpenAITool[];
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
}

/** Main entry: translate the full Anthropic request body into an OpenAI body. */
export function translateToOpenAI(
  body: AnthropicRequest,
  targetModel: string,
): OpenAIChatRequest {
  const messages: OpenAIMessage[] = [];

  // ── System ──────────────────────────────────────────────────────────────
  const systemText = extractSystemText(body.system);
  if (systemText) {
    messages.push({ role: 'system', content: systemText });
  }

  // ── Messages ────────────────────────────────────────────────────────────
  for (const msg of body.messages) {
    if (typeof msg.content === 'string') {
      messages.push({ role: msg.role, content: msg.content });
      continue;
    }
    // Array of content blocks
    for (const block of msg.content) {
      switch (block.type) {
        case 'text':
          messages.push({ role: msg.role, content: block.text });
          break;

        case 'tool_use':
          messages.push({
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: block.id,
              type: 'function',
              function: { name: block.name, arguments: JSON.stringify(block.input) },
            }],
          });
          break;

        case 'tool_result':
          const content = typeof block.content === 'string'
            ? block.content
            : block.content.map(c => c.type === 'text' ? c.text : '').join('\n');
          const isGoogle = targetModel.toLowerCase().includes('gemini');
          if (isGoogle) {
            messages.push({
              role: 'user',
              content: JSON.stringify({
                functionResponse: {
                  name: block.tool_use_id,
                  response: { result: content }
                }
              })
            });
          } else {
            messages.push({
              role: 'tool',
              tool_call_id: block.tool_use_id,
              content,
            });
          }
          break;

        case 'image':
          // Add image as a user message (will merge with previous if needed)
          messages.push({
            role: msg.role,
            content: `[Image: ${block.source.media_type} (base64, ${block.source.data.length} bytes)]`,
          });
          break;
      }
    }
  }

  // ── Tools ────────────────────────────────────────────────────────────────
  const tools: OpenAITool[] | undefined = body.tools?.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));

  // ── tool_choice ─────────────────────────────────────────────────────────
  let toolChoice: OpenAIChatRequest['tool_choice'];
  if (body.tool_choice) {
    if (body.tool_choice.type === 'any' && body.tool_choice.name) {
      toolChoice = { type: 'function', function: { name: body.tool_choice.name } };
    } else if (body.tool_choice.type === 'tool' && body.tool_choice.name) {
      toolChoice = { type: 'function', function: { name: body.tool_choice.name } };
    } else {
      toolChoice = 'auto';
    }
  }

  return {
    model: targetModel,
    messages,
    max_tokens: body.max_tokens ?? 8192,
    temperature: body.temperature,
    top_p: body.top_p,
    stream: body.stream,
    stream_options: body.stream ? { include_usage: true } : undefined,
    tools: tools && tools.length > 0 ? tools : undefined,
    tool_choice: toolChoice,
  };
}

/** Merge adjacent assistant messages with the same role — OpenAI expects one assistant message per turn. */
export function mergeAssistantMessages(msgs: OpenAIMessage[]): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];
  for (const m of msgs) {
    const last = out[out.length - 1];
    if (last && last.role === 'assistant' && m.role === 'assistant') {
      // Merge content: prefer non-null
      if (m.content) last.content = (last.content ?? '') + m.content;
      // Merge tool_calls
      if (m.tool_calls) {
        last.tool_calls = [...(last.tool_calls ?? []), ...m.tool_calls];
      }
    } else {
      out.push(m);
    }
  }
  return out;
}

function extractSystemText(system: AnthropicRequest['system']): string {
  if (!system) return '';
  if (typeof system === 'string') return system;
  return system.map(b => b.text).join('\n');
}
