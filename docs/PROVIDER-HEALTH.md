# Provider health — verified live 2026-09-29

Every row below was measured by sending a real Anthropic `/v1/messages`
request through the running proxy (`scripts/probe-providers.ts`), with the
real key and the real base URL. Nothing is mocked.

## Working now

| provider | model used | latency |
| --- | --- | --- |
| moonshot (Kimi Code) | `kimi-k2.7-code` | 1.2s |
| groq | `qwen/qwen3.8-27b` | 0.3s |
| nvidia | `deepseek-ai/deepseek-v4.1-flash` | 2.2s |
| deepseek | `deepseek-v4-pro` | 1.5s |
| openrouter | `openrouter/free` | 1.4s (intermittent 429) |
| google | `gemini-3.5-flash` | intermittent 503 "high demand" |

## Broken — needs a key, a top-up, or a model change

| provider | verdict |
| --- | --- |
| opencode-zen | 403 "free tier can only be used from within OpenCode" — not usable as a headless API |
| opencode-go | 404, host `opencode.ai/go/v1` serves no API |
| cerebras | 402 insufficient credits |
| xai | 403 team has no credits or licences |
| sambanova | 401 incorrect API key |
| dashscope | 400 arrearage, account not in good standing |
| zhipu | 403 no permission for `glm-5.3-flash` |
| llm7 | 400 `gpt-4o-mini` unavailable |
| mistral, together, fireworks, perplexity, cohere, baichuan, modelscope, cloudflare | no key in env, skipped by `buildChain` |
| ollama | no local server on :11434 |

## Code bugs found and fixed

1. **`connectTimer` was a response-header deadline, not a connect budget.**
   `src/upstream.ts` started a 15s timer and only cleared it when the
   response arrived. A real socket handshake does not clear it. NVIDIA
   connected in 62ms and was then destroyed at exactly 15007ms, so a healthy
   provider was reported as a `network` failure. Fixed by clearing the timer
   on the socket `connect` event. NVIDIA now returns a real answer.
   Regression test: `src/__tests__/upstream.test.ts`.

2. **Two dead default models shipped in `src/providers.ts`.**
   - `nvidia` defaulted to `nvidia/nemotron-3.5-lightning-30b-a3b` (404).
   - `google` defaulted to `gemini-2.0-flash` (404, retired).
   Both now point at models verified live, and a new test asserts every
   `defaultModel` appears in its own `models` list.
