#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Aura Enables — headless provider probe
//
// Boots the real proxy (startProxy) once per provider id, sends a genuine
// Anthropic /v1/messages request through it, and reports whether the round
// trip produced real assistant text. Nothing is mocked: the request goes out
// over the network to the provider's real base URL with the real key.
//
// Usage:  node --import tsx scripts/probe-providers.ts [id ...]
//          node --import tsx scripts/probe-providers.ts --models <id> <model> ...
// Env:    PROBE_MODELS="<id>:<model> <id>:<model>"  extra model overrides
//         PROBE_TIMEOUT_MS=45000  per-attempt socket budget
//         PROBE_MODELS_ONLY=1      skip the round trip, only assert the chain builds
// ─────────────────────────────────────────────────────────────────────────────

import { startProxy, stopProxy } from '../src/server.js';
import { buildChain } from '../src/failover.js';
import { findProvider, PROVIDERS } from '../src/providers.js';
import type { EnablesConfig } from '../src/config.js';

const TIMEOUT_MS = parseInt(process.env.PROBE_TIMEOUT_MS || '45000', 10);
const MODELS_ONLY = process.env.PROBE_MODELS_ONLY === '1';

// Free tiers first (what the shipped chain tries before it spends money),
// then everything else that has a key available in this environment.
const FREE_FIRST = ['opencode-zen', 'opencode-go', 'openrouter', 'google', 'moonshot', 'groq', 'cerebras', 'nvidia', 'mistral', 'github-models'];

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};
const rest = argv.filter((a, i) => !a.startsWith('--') && !((i > 0) && argv[i - 1].startsWith('--') && argv[i - 1] !== '--models'));

interface ProbeResult {
  id: string;
  ok: boolean;
  status: string;
  model: string;
  text: string;
  ms: number;
  keySource: string;
  detail?: string;
}

function modelOverrides(): Map<string, string> {
  const m = new Map<string, string>();
  const raw = (process.env.PROBE_MODELS || '').trim();
  if (raw) for (const pair of raw.split(/\s+/)) {
    const [id, ...rest] = pair.split(':');
    if (id && rest.length) m.set(id, rest.join(':'));
  }
  const single = flag('--models');
  if (single && rest[0]) m.set(single, rest[0]);
  return m;
}

async function post(port: number, body: unknown, timeoutMs: number): Promise<{ status: number; text: string }> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'probe', 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    return { status: r.status, text: await r.text() };
  } finally {
    clearTimeout(t);
  }
}

function extractText(text: string): { out: string; err?: string } {
  let o: any;
  try { o = JSON.parse(text); } catch { return { out: '', err: `non-JSON response: ${text.slice(0, 160)}` }; }
  if (o?.error) {
    const e = o.error;
    return { out: '', err: `[${e.type ?? 'error'}] ${e.message ?? JSON.stringify(e).slice(0, 160)}` };
  }
  const parts = Array.isArray(o?.content)
    ? o.content.filter((b: any) => b?.type === 'text' && typeof b.text === 'string').map((b: any) => b.text)
    : [];
  const out = parts.join('').trim();
  if (!out) return { out: '', err: `no text blocks in response: ${text.slice(0, 160)}` };
  return { out };
}

async function probe(id: string, modelOverride?: string): Promise<ProbeResult> {
  const def = findProvider(id);
  const cfg: EnablesConfig = {
    provider: id,
    providerGroup: def?.name ?? id,
    bigModel: modelOverride ?? def?.defaultModel ?? '',
    // Pin the chain to exactly this provider: no failover, so the verdict
    // describes *this* provider and not whichever one saved the request.
    failoverChain: [id],
    failover: false,
    upstreamTimeoutMs: TIMEOUT_MS,
  };

  const started = Date.now();
  let port = 0;
  try {
    const chain = buildChain(cfg);
    if (chain.length === 0) {
      return { id, ok: false, status: 'no-key', model: cfg.bigModel ?? '', text: '', ms: 0, keySource: 'none', detail: 'no key resolvable from env or config — provider skipped by buildChain' };
    }
    const cand = chain[0];
    const keySource = cand.keySource;
    const model = cand.model;

    if (MODELS_ONLY) {
      return { id, ok: true, status: 'chain-ok', model, text: '', ms: Date.now() - started, keySource, detail: `url ${cand.url}` };
    }

    port = await startProxy(cfg, { runtimeFile: null });
    const res = await post(port, {
      model,
      max_tokens: parseInt(process.env.PROBE_MAX_TOKENS || "1024", 10),
      messages: [{ role: 'user', content: 'Reply with exactly: pong' }],
    }, TIMEOUT_MS + 5000);
    const { out, err } = extractText(res.text);
    const ok = res.status === 200 && out.length > 0;
    return {
      id, ok, status: ok ? 'OK' : (res.status === 200 ? 'empty' : `HTTP ${res.status}`),
      model, text: out.slice(0, 80), ms: Date.now() - started, keySource,
      detail: err ?? (ok ? undefined : `body: ${res.text.slice(0, 160)}`),
    };
  } catch (e) {
    return { id, ok: false, status: 'error', model: cfg.bigModel ?? '', text: '', ms: Date.now() - started, keySource: 'n/a', detail: e instanceof Error ? e.message : String(e) };
  } finally {
    if (port) { try { await stopProxy(); } catch { /* already closed */ } }
  }
}

const ids = rest.length ? rest : (() => {
  const out = [...FREE_FIRST];
  for (const p of PROVIDERS) if (!out.includes(p.id)) out.push(p.id);
  return out;
})();

async function main(): Promise<void> {
  const overrides = modelOverrides();
  const results: ProbeResult[] = [];
  for (const id of ids) {
    process.stdout.write(`probing ${id} … `);
    const r = await probe(id, overrides.get(id));
    results.push(r);
    console.log(`${r.ok ? 'OK ' : 'FAIL'} ${r.status} ${r.ms}ms key=${r.keySource} model=${r.model}${r.text ? ` text=${JSON.stringify(r.text)}` : ''}${r.detail ? `\n    ${r.detail}` : ''}`);
  }

  const pass = results.filter(r => r.ok).length;
  console.log(`\n── ${pass}/${results.length} providers responded with real text ──`);
  for (const r of results.filter(x => !x.ok)) console.log(`  FAIL ${r.id.padEnd(22)} ${r.status.padEnd(10)} ${r.detail ?? ''}`);
  process.exit(0);
}

main().catch(e => { console.error('probe crashed:', e); process.exit(1); });
