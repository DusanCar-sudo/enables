# enables v0.4.3

## Fixed

- **Fail over on any upstream status while nothing has streamed.** Dead or
  retired gateways (e.g. OpenCode Go's `/go/v1`, which now answers `405` with an
  empty body) were previously passed straight through to Claude Code as
  "API Error: 405 (no body)". The proxy now tries the next provider in the
  failover chain instead. Single-provider chains still pass the raw upstream
  error through untouched.
- **Fixed `/v1/v1/messages` double-prefix bug** for Anthropic-adapter base URLs
  that already end in `/v1` (e.g. the built-in Anthropic provider) — these now
  resolve to `/v1/messages` instead of a guaranteed 404.

## Changed

- `opencode-go` provider marked RETIRED (endpoint removed upstream; OpenCode now
  requires a paid Go subscription via the Zen endpoint) and removed from the
  default free-tier chain.
