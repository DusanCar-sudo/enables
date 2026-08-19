# Enables

**Make Claude Code work with almost any AI provider.**

Enables is a lightweight, high-performance local proxy that lets Claude Code sign in through an Anthropic-compatible local endpoint while routing model requests to your chosen upstream provider (DeepSeek, Google Gemini, OpenAI, Groq, Ollama, OpenRouter, xAI, Mistral, and more).

Built by **Lean Progress IQ** and **Dusan Milosavljevic**, builder of **Aura Code** and **Aura Pulse**. Enables gives developers complete freedom to select, swap, and control the models behind their coding agents.

<p align="center">
  <a href="https://github.com/DusanCar-sudo/enables/releases"><img src="https://img.shields.io/github/v/release/DusanCar-sudo/enables?color=238636&logo=github&logoColor=white" alt="GitHub release" /></a>
  <a href="https://github.com/DusanCar-sudo/enables/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?logo=open-source-initiative&logoColor=white" alt="License: MIT" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white" alt="TypeScript 5.8" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-%3E%3D22-339933?logo=nodedotjs&logoColor=white" alt="Node.js >= 22" /></a>
  <a href="https://github.com/DusanCar-sudo/enables"><img src="https://img.shields.io/badge/dependencies-0%20runtime-success?logo=npm&logoColor=white" alt="Dependencies: 0 runtime" /></a>
  <a href="https://github.com/DusanCar-sudo/enables"><img src="https://img.shields.io/badge/tests-33%20passed-brightgreen?logo=nodedotjs&logoColor=white" alt="Tests: 33 passed" /></a>
</p>

---

<p align="center">
  <img src="assets/enables-logo.svg" alt="Enables logo" width="220" />
</p>

```text
      ◢◤                               ◢◤
   ╭─────────────────────────────────────────────────╮
   │   AURA   CODE                                   │
   │        E N A B L E S                            │
   │    local gateway for Claude Code                │
   ╰─────────────────────────────────────────────────╯
      ◥◣                               ◥◣
```

---

<p align="center">
  <img src="assets/screenshot.png" alt="Aura Enables — Claude Code proxy dashboard screenshot" width="90%" />
</p>

---

## Quickstart & User Manual

### 1. Installation

Build from source or link locally:

```bash
git clone https://github.com/DusanCar-sudo/enables.git
cd enables
npm install
npm run build
npm run global # or: npx tsx src/index.ts
```

---

### 2. Running Enables

Start Enables from your terminal:

```bash
enables
```

You will see the interactive terminal menu:

1. **Select Provider**: Choose from DeepSeek, Google Gemini, OpenAI, Ollama, OpenRouter, Groq, xAI, Xiaomi MiMo, Zhipu GLM, or a custom OpenAI-compatible endpoint.
2. **Enter API Key**: Paste your provider API key (hidden prompt) or rely on environment variables (e.g. `DEEPSEEK_API_KEY`, `GOOGLE_API_KEY`, `OPENAI_API_KEY`).
3. **Select Target Model**: Choose the model you want to power Claude Code (e.g., `gemini-2.0-flash`, `deepseek-chat`, `gpt-4o`, `qwen2.5-coder:32b`).
4. **Start Proxy**: Enables automatically scans for an open TCP port (starting at `8080`, falling back to `8081`, `8082`, etc. if occupied) and launches Claude Code with the local proxy configured.

---

### 3. Connecting Claude Code to Enables

When Claude Code launches through Enables, follow these steps during initial login:

#### Step A: Choose Login Method in Claude Code

When Claude Code prompts:

```text
Select login method:
  1. Claude account with subscription · Pro, Max, Team, or Enterprise
❯ 2. Anthropic Console account · API usage billing
  3. 3rd-party platform · Amazon Bedrock, Microsoft Foundry, or Vertex AI
```

👉 **Select `2. Anthropic Console account · API usage billing`**.

> **Why?** Option 1 (subscription login) attempts web OAuth authentication through Anthropic servers. Option 2 instructs Claude Code to use API Key authentication, which routes through your local Enables proxy endpoint (`ANTHROPIC_BASE_URL=http://localhost:<port>`).

#### Step B: API Key Prompt in Claude Code

When Claude Code prompts for an API Key, press **Enter** or type `dummy`. Enables manages your real provider API key securely in your local configuration (`~/.enables.json`).

#### Step C: Choosing a Model in Claude Code (`/model`)

Inside Claude Code, you can run `/model` or keep the default selection:

👉 **Select `Sonnet` (default)**.

> **Why?** Enables automatically advertises standard Claude model identifiers (`claude-sonnet-4-6`, `claude-opus-4-8`, `claude-3-7-sonnet-20250219`, etc.) on the `/v1/models` endpoint to satisfy Claude Code's model validation. When requests arrive at the proxy, Enables transparently translates and routes the request to your configured upstream model (e.g., Google Gemini 2.0 Flash, DeepSeek V3, GPT-4o).

---

### 4. Automatic Free Port Detection

Enables includes an integrated port scanner and generator. If port `8080` is currently used by another process or proxy instance, Enables will:
1. Scan ports starting from `8080` (e.g. `8081`, `8082`, ...).
2. Bind to the first free TCP port automatically.
3. Update the `ANTHROPIC_BASE_URL` environment variable passed to Claude Code.

You will never encounter `EADDRINUSE` or `Port in use` crashes.

---

### 5. Token Saver & Real-Time Cache Tracking

Enables includes **Token Saver**, a real-time request tracking meter that monitors:
- Input request tokens & output tokens.
- Provider prompt cache hits (e.g., DeepSeek / Gemini prompt caching).
- Cumulative session token savings directly in terminal output.

---

### 6. Advanced Gateway Capabilities (v0.2.0)

- **Multimodal Vision Support**: Base64 images passed by Claude Code (screenshots, diagrams, UI wireframes) are automatically translated into standard OpenAI `image_url` data URLs (`data:${media_type};base64,...`) for vision-capable models (e.g. GPT-4o, Gemini 2.0/2.5).
- **Reasoning / Thinking Delta Streaming**: Live reasoning content from models like DeepSeek-R1, QwQ, and o3-mini (`delta.reasoning_content`) is dynamically translated into Anthropic `thinking` content blocks.
- **Parallel Tool Call Synchronization**: Dedicated state machine tracks parallel tool invocations and ensures interleaved argument chunks never desynchronize Anthropic SSE stream blocks.
- **Automatic Message Consolidation**: Auto-merges consecutive assistant turns (text + tool_use) into single compliant messages to satisfy strict OpenAI/Mistral validation schemas.
- **Dynamic Context Budgeting**: `/v1/messages/count_tokens` computes real token estimates from payload content so Claude Code accurately manages context compaction.
- **SSE Keep-Alive Heartbeats**: Sends periodic `: ping\n\n` SSE comments every 15 seconds during long-running tool executions to prevent idle connection resets (`ECONNRESET`).

---

## Supported Providers & Presets

| Provider | Preset ID | Default Model | Adapter |
|---|---|---|---|
| **DeepSeek** | `deepseek` | `deepseek-chat` / `deepseek-reasoner` | OpenAI-compatible |
| **Google Gemini** | `google` | `gemini-2.0-flash` | OpenAI-compatible |
| **OpenAI** | `openai` | `gpt-4o` / `o3-mini` | OpenAI-compatible |
| **OpenRouter** | `openrouter` | `deepseek-chat` | OpenAI-compatible |
| **Groq** | `groq` | `llama-3.3-70b-versatile` | OpenAI-compatible |
| **xAI (Grok)** | `xai` | `grok-3` | OpenAI-compatible |
| **Ollama (Local)** | `ollama` | `gemma3:12b` | OpenAI-compatible |
| **OpenCode** | `opencode-zen` / `opencode-go` | `opencode-zen` | OpenAI-compatible |
| **Xiaomi MiMo** | `mimo-token` / `mimo-payg` | `mimo-v2-flash` | OpenAI-compatible |
| **Zhipu GLM** | `zhipu` | `glm-4-flash` | OpenAI-compatible |
| **Mistral AI** | `mistral` | `mistral-large-latest` | OpenAI-compatible |
| **Together AI** | `together` | `Llama-3.3-70B-Instruct-Turbo` | OpenAI-compatible |
| **Fireworks AI** | `fireworks` | `llama-v3p3-70b-instruct` | OpenAI-compatible |
| **Perplexity** | `perplexity` | `sonar-pro` | OpenAI-compatible |
| **Cerebras** | `cerebras` | `llama-3.3-70b` | OpenAI-compatible |
| **NVIDIA NIM** | `nvidia` | `meta/llama-3.3-70b-instruct` | OpenAI-compatible |
| **Alibaba DashScope** | `dashscope` | `qwen-max` | OpenAI-compatible |
| **Moonshot (Kimi)** | `moonshot` | `kimi-k2-0711-preview` | OpenAI-compatible |
| **Baichuan** | `baichuan` | `Baichuan4` | OpenAI-compatible |
| **Anthropic** | `anthropic` | `claude-sonnet-4-20250514` | Native pass-through |
| **Custom Endpoint** | `custom` | *User specified* | OpenAI-compatible |

---

## Environment Variable Fallbacks

You can pre-configure API keys in your shell profile (`~/.bashrc`, `~/.zshrc`):

```bash
export DEEPSEEK_API_KEY=sk-...
export GOOGLE_API_KEY=AIza...
export OPENAI_API_KEY=sk-proj-...
export OPENROUTER_API_KEY=sk-or-...
export GROQ_API_KEY=gsk_...
export XIAOMI_API_KEY=tp-...
```

---

## Architecture

```text
Claude Code CLI
  └─► Anthropic Messages API Request (localhost:<port>)
        └─► Enables Local Gateway Proxy
              ├─► Port Scanner / Auto Free Port Resolver
              ├─► Request Translator (Anthropic ◄► OpenAI Format + Vision data URLs)
              ├─► Upstream Provider API (DeepSeek, Gemini, OpenAI, Ollama, etc.)
              └─► Response Stream Converter (SSE ◄► Anthropic SSE + Thinking Blocks)
                    ├─► SSE Keep-Alive Heartbeat (: ping)
                    └─► Anthropic-compatible SSE Response to Claude Code
```

---

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/v1/messages` | Main proxy endpoint (Anthropic → provider with streaming) |
| `POST` | `/v1/messages/count_tokens` | Dynamic token counter for context budgeting |
| `GET` | `/health` | Proxy status — provider, model |
| `GET` | `/v1/models` | OpenAI/Anthropic model validation list |

---

## Development & Testing

```bash
# Install dependencies
npm install

# Build TypeScript to dist/
npm run build

# Run unit test suite
npm test
```

---

## Credits & Philosophy

Enables is built by **Lean Progress IQ** and **Dusan Milosavljevic**.

Dusan Milosavljevic is the creator of **Aura Code** and **Aura Pulse**. Enables reflects our core mission: practical, developer-centric infrastructure that puts developers in complete control of their AI models, tooling, and workflows.
