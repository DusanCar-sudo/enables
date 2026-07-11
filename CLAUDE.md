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

## Architecture
- `src/index.ts` — HTTP server with POST /v1/messages + GET /health
- `src/translate.ts` — Anthropic → OpenAI request translation
- `src/reverse.ts` — OpenAI → Anthropic streaming SSE converter
- `src/models.ts` — Model name mapping
- `src/config.ts` — Environment config

## Key conversion details
- Anthropic `content[]` blocks → OpenAI `content` / `tool_calls`
- Anthropic `input_schema` → OpenAI `function.parameters`
- Tool streaming: `input_json_delta` → OpenAI `tool_calls.function.arguments`
- Images: converted to text placeholder (no image support yet)
- System: Anthropic `system[]` → OpenAI `messages[0] role:system`
