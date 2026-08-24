# Enables v0.3.0

Release v0.3.0 brings full session resumption support, DeepSeek V4 models, CLI utility flags, and passthrough argument forwarding to Claude Code.

## Highlights & New Features

- **Session Resumption Support**:
  - `enables --resume <session-id>` or `enables -r <session-id>`: Directly resume any specific Claude Code session by its UUID.
  - `enables --continue` or `enables -c`: Continue the most recent conversation in the current working directory.
  - `enables --resume` / `enables -r`: Open Claude Code's interactive session selector.
  - Interactive Terminal Menu: Added dedicated options for `2. Continue last session` and `3. Resume session by ID`.
- **DeepSeek V4 Models**:
  - Added `deepseek-v4-pro` and `deepseek-v4-flash` to the DeepSeek provider catalog and model selector.
- **CLI Utility Flags & Passthrough**:
  - `--help` / `-h`: Displays formatted usage instructions and command-line examples.
  - `--version` / `-v`: Displays current Enables version.
  - `--setup` / `--config`: Quick shortcut to configure AI provider and API key.
  - Direct argument forwarding: Any custom flags or prompt arguments passed to `enables` are forwarded directly to the spawned Claude Code instance.
- **Comprehensive Test Suite**:
  - Expanded unit test coverage to 44 passing tests across 9 test suites, covering all CLI parsing and resume options.
