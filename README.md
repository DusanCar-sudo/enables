# Enables

**Make Claude Code work with almost any AI provider.**

Enables is a small local proxy that lets Claude Code sign in through an Anthropic-compatible local endpoint while routing the actual model requests to your chosen provider. Pick a provider, enter the API key, choose the model, and Enables handles the endpoint and request translation.

Built by Lean Progress IQ and Dusan Milosevic, builder of Aura Code and Aura Pulse. Enables follows the same practical direction: lightweight tooling, direct workflows, and useful infrastructure for people who want more control over the models behind their coding agents.

![GitHub release](https://img.shields.io/github/v/release/DusanCar-sudo/enables)
![License](https://img.shields.io/github/license/DusanCar-sudo/enables)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)
![Node](https://img.shields.io/badge/Node-22-green)
![Dependencies](https://img.shields.io/badge/dependencies-0-success)

## Why

Claude Code expects the Anthropic Messages API. Many useful models are exposed through OpenAI-compatible APIs instead. Enables bridges that gap:

- Claude Code talks to `http://localhost:8080/v1/messages`.
- Enables translates Anthropic Messages requests to the selected provider.
- The provider response is translated back into Claude Code's expected format.
- You keep the Claude Code workflow while choosing the upstream model.

## Quick Start

```bash
# Install globally
npm install -g .

# Or run directly
npm run dev

# Pick a provider, paste your API key, choose a model
# Then point Claude Code at the proxy:
ANTHROPIC_BASE_URL=http://localhost:8080 \
ANTHROPIC_API_KEY=dummy \
claude
```

## Features

- **Interactive provider menu** — pick from DeepSeek, GLM, MiMo, Ollama, OpenAI, Anthropic, and 16+ more.
- **Submenus for multi-plan providers** — when a provider has several endpoints, you pick which one.
- **Hidden API key prompt** with environment variable fallback (`DEEPSEEK_API_KEY`, `GLM_API_KEY`, etc).
- **Saved local config** in `~/.enables.json` — no global state to manage.
- **OpenAI-compatible provider adapter** — works with any Chat Completions endpoint.
- **Native Anthropic pass-through adapter** — for Anthropic models with header-based auth.
- **Streaming response conversion** — translates SSE between formats in real time.
- **Tool-call translation** — converts Anthropic `tool_use` blocks to OpenAI `tool_calls` and back.
- **Custom OpenAI-compatible providers** — point at any OpenAI-shaped endpoint.
- **Automatic Claude Code launch** with the correct `ANTHROPIC_BASE_URL` environment variables.
- **Startup status panel** — shows real provider, endpoint, and model in use.
- **Token Saver session meter** — tracks request tokens, output tokens, provider cache hits, and cumulative savings.
- **Terminal banner** with Aura Code branding.
- **Graceful shutdown** — Ctrl+C cleanly closes the proxy.

## Commands

```bash
npm run dev      # development mode (tsx)
npm run build    # compile to dist/
npm run start    # run compiled version
npm run setup    # alias for start
npm run global   # build + npm link globally
npm test         # run test suite
```

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/v1/messages` | Main proxy endpoint (Anthropic → provider) |
| `GET` | `/health` | Proxy status — provider, model |
| `GET` | `/v1/models` | OpenAI-compatible model list |

## Architecture

- `src/index.ts` — Entry point, CLI menu flow
- `src/server.ts` — HTTP server, proxy routing, endpoints
- `src/cli.ts` — CLI menu, prompts, display helpers, ANSI colors
- `src/config.ts` — Config persistence (`~/.enables.json`)
- `src/translate.ts` — Anthropic → OpenAI request translation
- `src/reverse.ts` — OpenAI → Anthropic streaming SSE converter
- `src/providers.ts` — Provider catalog
- `src/tokenSaver.ts` — Token usage tracking

## Tech Stack

- TypeScript 5.8, Node.js 22
- Zero runtime dependencies
- `tsc` for build, `tsx` for dev

## License

MIT — see [LICENSE](LICENSE).

## Author

Built by **Dušan Milosavljević** — see [OWNERSHIP.md](OWNERSHIP.md).
