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
  | { type: 'thinking'; thinking: string; signature?: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string | AnthropicContentBlock[]; is_error?: boolean }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

export type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | OpenAIContentPart[] | null;
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
  const rawMessages: OpenAIMessage[] = [];

  // ── System ──────────────────────────────────────────────────────────────
  const systemText = extractSystemText(body.system);
  if (systemText) {
    rawMessages.push({ role: 'system', content: systemText });
  }

  // ── Messages ────────────────────────────────────────────────────────────
  for (const msg of body.messages) {
    if (typeof msg.content === 'string') {
      rawMessages.push({ role: msg.role, content: msg.content });
      continue;
    }

    // Process structured content blocks
    const userParts: OpenAIContentPart[] = [];

    for (const block of msg.content) {
      switch (block.type) {
        case 'text':
          if (msg.role === 'user') {
            userParts.push({ type: 'text', text: block.text });
          } else {
            rawMessages.push({ role: msg.role, content: block.text });
          }
          break;

        case 'image':
          userParts.push({
            type: 'image_url',
            image_url: {
              url: `data:${block.source.media_type};base64,${block.source.data}`,
            },
          });
          break;

        case 'thinking':
          // Thinking block from Claude 3.7 - translate to text note if needed
          if (block.thinking) {
            rawMessages.push({ role: 'assistant', content: block.thinking });
          }
          break;

        case 'tool_use':
          rawMessages.push({
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
            rawMessages.push({
              role: 'user',
              content: JSON.stringify({
                functionResponse: {
                  name: block.tool_use_id,
                  response: { result: content }
                }
              })
            });
          } else {
            rawMessages.push({
              role: 'tool',
              tool_call_id: block.tool_use_id,
              content,
            });
          }
          break;
      }
    }

    if (userParts.length > 0) {
      if (userParts.length === 1 && userParts[0].type === 'text') {
        rawMessages.push({ role: 'user', content: userParts[0].text });
      } else {
        rawMessages.push({ role: 'user', content: userParts });
      }
    }
  }

  // ── Auto-merge consecutive assistant messages & user parts ───────────────
  const messages = mergeAssistantMessages(rawMessages);

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
      // Merge content: prefer non-null string concatenation
      if (typeof m.content === 'string') {
        last.content = (typeof last.content === 'string' ? last.content : '') + (last.content ? '\n' : '') + m.content;
      }
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
