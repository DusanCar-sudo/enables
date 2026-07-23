# Enables v0.1.0

Initial public release of Enables, a local Anthropic-compatible proxy for using Claude Code with multiple upstream AI providers.

## Changes

- Added the initial Enables CLI and local proxy server.
- Added Anthropic Messages API request handling for Claude Code.
- Added OpenAI-compatible provider request translation and response conversion.
- Added provider presets for OpenAI, Anthropic, OpenRouter, Groq, xAI, Gemini OpenAI-compatible endpoints, Ollama, Mistral, Together, Fireworks, Perplexity, Cerebras, NVIDIA NIM, Alibaba DashScope, Moonshot/Kimi, Baichuan, DeepSeek, OpenCode, Xiaomi MiMo, Zhipu GLM, and custom OpenAI-compatible endpoints.
- Added interactive provider selection, API key prompts, saved local config, and automatic Claude Code launch environment setup.
- Added streaming response conversion back to Anthropic SSE format.
- Added tool-call translation between Anthropic and OpenAI-compatible formats.
- Added terminal banner branding.
- Added README logo assets and reduced the README hero logo display size.
- Fixed Anthropic request typing.
