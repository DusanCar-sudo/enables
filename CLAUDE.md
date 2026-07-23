# Enables — CLAUDE.md

## What it is
A local HTTP proxy that translates Claude Code's Anthropic Messages API
calls into OpenAI Chat Completions format, allowing Claude Code to work
with any OpenAI-compatible model (DeepSeek, GLM, MiMo, Ollama, etc.).

## How to use
```bash
# Start proxy
TARGET_BASE_URL=https://api.deepseek.com/v1 \
TARGET_API_KEY=sk-xxx \
node dist/index.js

# Point Claude Code at it
ANTHROPIC_BASE_URL=http://localhost:8080 \
ANTHROPIC_API_KEY=dummy \
claude
```

## Commands
- Build: `npm run build`
- Dev: `npm run dev`
- Setup: `npm run setup`
- Link globally: `npm run global`

## Tech Stack
- TypeScript 5.8, Node.js 22, zero runtime dependencies
- `tsc` for build, `tsx` for dev mode

## Architecture
- `src/index.ts` — Entry point, CLI menu flow
- `src/server.ts` — HTTP server, proxy routing, /health, /v1/models
- `src/cli.ts` — CLI menu system, prompts, display helpers, ANSI colors
- `src/config.ts` — Config persistence (~/.enables.json)
- `src/translate.ts` — Anthropic → OpenAI request translation
- `src/reverse.ts` — OpenAI → Anthropic streaming SSE converter
- `src/providers.ts` — Provider catalog (22 providers)
- `src/tokenSaver.ts` — Token usage tracking

## Key conversion details
- Anthropic `content[]` blocks → OpenAI `content` / `tool_calls`
- Anthropic `input_schema` → OpenAI `function.parameters`
- Tool streaming: `input_json_delta` → OpenAI `tool_calls.function.arguments`
- Images: converted to text placeholder (no image support yet)
- System: Anthropic `system[]` → OpenAI `messages[0]` role:system

## Endpoints
- `GET /health` — Proxy status (provider, model)
- `GET /v1/models` — Model list (OpenAI-compatible format)
- `POST /v1/messages` — Main proxy endpoint (Anthropic → provider)

## Code Conventions
- No runtime dependencies — pure Node.js stdlib
- ANSI escape codes for terminal UI (single-letter constants: R, B, G, Y, K, H)
- `async/await` with Promises for stream handling
- Provider adapter pattern: `openai` or `anthropic` (in providers.ts)
- Config stored in `~/.enables.json`

## Boundaries
- Never add npm runtime dependencies
- Never hardcode API keys or secrets
- Never commit `~/.enables.json` or `.env` files
- Always check `res.headersSent` before writing error responses
- Always wrap `JSON.parse` in try/catch
- Always add timeout to upstream HTTP requests
