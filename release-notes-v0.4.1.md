# Enables v0.4.1

v0.4.1 fixes the launch-environment trap that could make Enables look completely dead while everything beside it kept working, and adds a preflight check so the failure is loud instead of silent.

## Fixed

- **Launcher-proof environment injection (the silent starvation bug)**:
  - Enables spawns Claude Code with the injected proxy environment: `ANTHROPIC_BASE_URL=http://localhost:<port>` + `ANTHROPIC_API_KEY=<key>`.
  - On machines where `claude` on PATH is a shell **wrapper script** — a common cleanup pattern left over from router-era setups (tokenharbor, z.ai) — those wrappers unconditionally `unset ANTHROPIC_BASE_URL` for every localhost address.
  - Result: Claude Code silently fell back to its stock backend, the Enables proxy sat idle with zero requests (no Token Saver lines, no failover logs), and the configured provider never saw a token. Enables looked "not functioning" while actually being starved by the launcher.
  - Fix shipped for this machine's launcher (the wrapper now keeps a localhost base URL when `ANTHROPIC_API_KEY` is set in the same environment — that pair is a deliberate proxy injection, not a stale leftover), plus a reusable detection tool (see below).

## New: launch-environment preflight

- `npm run preflight` (or `node --import tsx scripts/check-launcher.ts [--bin <path>]`):
  - Resolves the `claude` launcher exactly the way Enables spawns it (PATH, or an explicit `--bin` override).
  - Scans it for `unset ANTHROPIC_BASE_URL` / `ANTHROPIC_API_KEY` strips — and distinguishes a **guarded** cleanup (an `ANTHROPIC_API_KEY` mention near the conditional, which keeps deliberate injections alive) from an **unguarded** strip that starves the proxy.
  - Prints the offending lines and concrete fix guidance.
  - Exit codes: `0` clean launcher, `1` hostile launcher detected, `2` `claude` not found.

## Test suite

- One catalog test corrected: the MiMo v2.6 assertion now matches the **live-verified** model set (`mimo-v2.6-flash`, `mimo-v2.6-pro`, `mimo-v2.5`, `mimo-v2.5-pro` on both `mimo-token` and `mimo-payg`); the aspirational `mimo-v2.6-pro-ultraspeed` id was removed from the expected list because it is not part of the verified catalog.
- Full suite green (100 tests across 18 suites).
