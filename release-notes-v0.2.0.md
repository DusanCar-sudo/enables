# Enables v0.2.0

Release v0.2.0 introduces major architectural enhancements to Enables, expanding support for multimodal vision, reasoning models, parallel tool calling synchronization, keep-alive connections, and dynamic context token counting.

## Highlights & New Features

- **Multimodal Vision Support**: Base64 images and screenshots sent by Claude Code (`type: 'image'`) are now translated directly into OpenAI-compatible `image_url` data URLs (`data:${media_type};base64,...`).
- **Reasoning / Thinking Delta Streaming**: Live reasoning content from DeepSeek-R1, QwQ, and o3-mini (`delta.reasoning_content`) is dynamically translated into Anthropic `thinking` content blocks and streamed in real-time.
- **Parallel Tool Call Synchronization**: Dedicated state machine tracks parallel tool invocations by tool index (`tc.index`), preventing content index collisions and SSE stream desynchronization.
- **Automatic Assistant Message Consolidation**: Consecutive assistant text and tool-use turns are automatically merged into single compliant messages before forwarding to upstream providers.
- **Dynamic Context Token Counting**: `POST /v1/messages/count_tokens` dynamically estimates token counts from request payloads to enable Claude Code context compaction.
- **SSE Keep-Alive Heartbeats**: Sends periodic `: ping\n\n` comments every 15 seconds during active streams to prevent connection timeouts during long-running tool executions.
- **Comprehensive Test Suite**: Expanded unit test coverage across translation, reasoning extraction, streaming, and token estimation.
