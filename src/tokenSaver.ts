export interface TokenSaverUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface TokenSaverSession {
  requests: number;
  estimatedInputTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export function createTokenSaverSession(): TokenSaverSession {
  return {
    requests: 0,
    estimatedInputTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
}

export function estimateTokensFromText(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export function recordTokenSaverUsage(
  session: TokenSaverSession,
  estimatedInputTokens: number,
  usage: Partial<TokenSaverUsage>,
): TokenSaverSession {
  session.requests += 1;
  session.estimatedInputTokens += estimatedInputTokens;
  session.inputTokens += usage.inputTokens || 0;
  session.outputTokens += usage.outputTokens || 0;
  session.cacheReadTokens += usage.cacheReadTokens || 0;
  session.cacheWriteTokens += usage.cacheWriteTokens || 0;
  return session;
}

export function tokenSaverLine(
  usage: Partial<TokenSaverUsage>,
  session: TokenSaverSession,
  estimatedInputTokens: number,
): string {
  const inputTokens = usage.inputTokens || 0;
  const outputTokens = usage.outputTokens || 0;
  const cacheReadTokens = usage.cacheReadTokens || 0;
  const cacheWriteTokens = usage.cacheWriteTokens || 0;
  const savedPercent = inputTokens > 0 ? Math.round((cacheReadTokens / inputTokens) * 100) : 0;
  const parts = [
    `request in:${inputTokens || '~' + estimatedInputTokens} out:${outputTokens || '?'}`,
  ];

  if (cacheReadTokens || cacheWriteTokens) {
    parts.push(`cache read:${cacheReadTokens} write:${cacheWriteTokens}`);
    parts.push(`saved:${savedPercent}%`);
  } else {
    parts.push('cache: provider did not report savings');
  }

  parts.push(`session saved:${session.cacheReadTokens}`);
  return parts.join(' | ');
}

export function extractOpenAIUsage(body: any): TokenSaverUsage {
  const usage = body?.usage || {};
  const promptDetails = usage.prompt_tokens_details || {};
  return {
    inputTokens: Number(usage.prompt_tokens || 0),
    outputTokens: Number(usage.completion_tokens || 0),
    cacheReadTokens: Number(promptDetails.cached_tokens || 0),
    cacheWriteTokens: 0,
  };
}

export function extractAnthropicUsage(body: any): TokenSaverUsage {
  const usage = body?.usage || {};
  return {
    inputTokens: Number(usage.input_tokens || 0),
    outputTokens: Number(usage.output_tokens || 0),
    cacheReadTokens: Number(usage.cache_read_input_tokens || 0),
    cacheWriteTokens: Number(usage.cache_creation_input_tokens || 0),
  };
}
