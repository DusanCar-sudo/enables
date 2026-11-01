// ─────────────────────────────────────────────────────────────────────────────
// Aura Enables — provider failover: failure classification, chain building,
// and in-memory failover state.
// Pure module: no http imports, fully unit-testable.
// ─────────────────────────────────────────────────────────────────────────────

import { PROVIDERS, FREE_TIER_CHAIN, PAID_TAIL_CHAIN, findProvider, hasAccountPlaceholder } from './providers.js';
import type { ProviderDef } from './providers.js';
import type { EnablesConfig } from './config.js';

// ── Failure classification ───────────────────────────────────────────────────

export type FailureKind =
  | 'auth'           // 401 / 403 — bad or missing key
  | 'quota'          // 402, insufficient balance / credits / quota exceeded
  | 'rate_limit'     // 429
  | 'server'         // 5xx
  | 'network'        // connection refused / reset / DNS ...
  | 'timeout'
  | 'model'          // model not found / unknown model on this provider
  | 'body_error'     // HTTP 200 but body contains an error object
  | 'non_retryable'; // 400 / 404 / 413 / 422 ... — our request is the problem

export interface Failure {
  kind: FailureKind;
  statusCode?: number;
  message: string;
  body: string;       // first 2 KB of upstream body for diagnostics
}

const BODY_SNIFF_LIMIT = 2048;

const QUOTA_RE = /insufficient|quota|balance|credit|exceeded/i;
const MODEL_RE = /model_not_found|does not exist|unknown model|invalid model|not a valid model/i;

export function classifyFailure(input: {
  statusCode?: number;
  body?: string;
  err?: NodeJS.ErrnoException;
  timedOut?: boolean;
}): Failure {
  const body = (input.body || '').slice(0, BODY_SNIFF_LIMIT);
  const message = firstLine(body) || input.err?.message || 'upstream failure';

  if (input.timedOut) return { kind: 'timeout', message, body };
  if (input.err) return { kind: 'network', message: input.err.message, body };

  const sc = input.statusCode;

  // Body sniffing wins over the status code: some providers wrap quota/model
  // errors in generic 4xx responses.
  if (body && QUOTA_RE.test(body)) return { kind: 'quota', statusCode: sc, message, body };
  if (body && MODEL_RE.test(body)) return { kind: 'model', statusCode: sc, message, body };

  if (sc === 401 || sc === 403) return { kind: 'auth', statusCode: sc, message, body };
  if (sc === 402) return { kind: 'quota', statusCode: sc, message, body };
  if (sc === 429) return { kind: 'rate_limit', statusCode: sc, message, body };
  if (sc !== undefined && sc >= 500) return { kind: 'server', statusCode: sc, message, body };
  if (sc === 200) return { kind: 'body_error', statusCode: sc, message, body };
  if (sc !== undefined) return { kind: 'non_retryable', statusCode: sc, message, body };

  return { kind: 'non_retryable', message, body };
}

function firstLine(s: string): string {
  const line = s.split('\n').find(l => l.trim().length > 0) || '';
  return line.trim().slice(0, 200);
}

export const RETRYABLE: FailureKind[] = [
  'auth', 'quota', 'rate_limit', 'server', 'network', 'timeout', 'model', 'body_error',
];

export function isRetryable(f: Failure): boolean {
  return RETRYABLE.includes(f.kind);
}

// ── Candidate resolution ─────────────────────────────────────────────────────

export interface Candidate {
  id: string;
  name: string;
  adapter: 'openai' | 'anthropic';
  baseUrl: string;
  url: URL;             // fully resolved upstream endpoint (account placeholder applied)
  apiKey: string;
  model: string;
  keySource: 'config' | 'env' | 'none';
}

export function resolveKey(cfg: EnablesConfig, id: string, def?: ProviderDef): { key: string; source: 'config' | 'env' | 'none' } {
  const pcKey = cfg.providers?.[id]?.apiKey;
  if (pcKey) return { key: pcKey, source: 'config' };
  if (cfg.provider === id && cfg.targetApiKey) return { key: cfg.targetApiKey, source: 'config' };
  const envKey = def?.keyEnvVar ? process.env[def.keyEnvVar] : undefined;
  if (envKey) return { key: envKey, source: 'env' };
  return { key: '', source: 'none' };
}

export function buildChain(cfg: EnablesConfig): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();

  const push = (id: string): void => {
    if (seen.has(id)) return;
    const cand = resolveCandidate(cfg, id);
    if (cand) {
      seen.add(id);
      out.push(cand);
    }
  };

  // 1. The configured provider always goes first.
  if (cfg.provider) push(cfg.provider);

  // 2. Explicit override, verbatim order — else free tiers first, paid last.
  if (cfg.failoverChain?.length) {
    for (const id of cfg.failoverChain) push(id);
  } else {
    for (const id of FREE_TIER_CHAIN) push(id);
    for (const id of PAID_TAIL_CHAIN) push(id);
  }

  return out;
}

function resolveCandidate(cfg: EnablesConfig, id: string): Candidate | undefined {
  const def = findProvider(id);
  const pc = cfg.providers?.[id];
  const { key, source } = resolveKey(cfg, id, def);

  if (def) {
    if (def.isCustom) return undefined;               // needs interactive setup
    if (hasAccountPlaceholder(def)) {
      const account = process.env.CLOUDFLARE_ACCOUNT_ID;
      if (!account) return undefined;                 // cannot resolve {account}
      if (!key && !def.noKeyRequired) return undefined;
      const baseUrl = def.baseUrl.replace('{account}', account);
      return makeCandidate(id, def.name, pc?.adapter || def.adapter, baseUrl, key, source, pc?.model || def.defaultModel);
    }
    if (!key && !def.noKeyRequired) return undefined; // silently skip keyless providers
    const active = cfg.provider === id;
    const model = pc?.model || (active && cfg.bigModel ? cfg.bigModel : def.defaultModel);
    // For the active provider the user's config must win over built-in defaults: a custom endpoint
    // (token-plan / regional host) silently replaced by def.baseUrl breaks auth for valid keys.
    const baseUrl = pc?.baseUrl || (active && cfg.targetBaseUrl ? cfg.targetBaseUrl : def.baseUrl);
    const adapter = pc?.adapter || (active && cfg.adapter ? cfg.adapter : def.adapter);
    return makeCandidate(id, def.name, adapter, baseUrl, key, source, model);
  }

  // Unknown id: usable only if the user supplied a baseUrl (and a model).
  if (pc?.baseUrl && pc.model) {
    return makeCandidate(id, id, pc.adapter || 'openai', pc.baseUrl, key, source, pc.model);
  }
  return undefined;
}

function makeCandidate(
  id: string, name: string, adapter: 'openai' | 'anthropic',
  baseUrl: string, apiKey: string, keySource: 'config' | 'env' | 'none', model: string,
): Candidate {
  return {
    id, name, adapter, baseUrl,
    url: new URL(baseUrl),
    apiKey: apiKey || (keySource === 'none' ? 'local' : ''),
    keySource,
    model,
  };
}

// Catalog ids that appear in no default chain but can still be switched to.
export const ALL_CHAINABLE_IDS: string[] = Array.from(new Set([
  ...FREE_TIER_CHAIN,
  ...PAID_TAIL_CHAIN,
  ...PROVIDERS.filter(p => !p.isCustom).map(p => p.id),
]));

// ── In-memory failover state ─────────────────────────────────────────────────

export interface ProviderStat {
  keyAvailable: boolean;
  keySource: 'config' | 'env' | 'none';
  requests: number;
  successes: number;
  failures: number;
  lastError?: { kind: FailureKind; statusCode?: number; message: string; at: string };
}

export interface FailoverState {
  chain: Candidate[];
  activeId: string;
  override: string | null;
  counters: { requests: number; failovers: number; exhausted: number };
  perProvider: Record<string, ProviderStat>;
  startedAt: string;
}

export function createFailoverState(cfg: EnablesConfig): FailoverState {
  const chain = buildChain(cfg);
  const perProvider: Record<string, ProviderStat> = {};
  for (const c of chain) {
    perProvider[c.id] = {
      keyAvailable: c.keySource !== 'none' || !!c.apiKey,
      keySource: c.keySource,
      requests: 0, successes: 0, failures: 0,
    };
  }
  return {
    chain,
    activeId: chain[0]?.id || '',
    override: null,
    counters: { requests: 0, failovers: 0, exhausted: 0 },
    perProvider,
    startedAt: new Date().toISOString(),
  };
}

/** Candidates in attempt order for the next request: active first, rest in chain order. */
export function requestOrder(st: FailoverState): Candidate[] {
  if (!st.override) return st.chain;
  const active = st.chain.find(c => c.id === st.override);
  const rest = st.chain.filter(c => c.id !== st.override);
  return active ? [active, ...rest] : rest;
}

export function recordAttempt(st: FailoverState, id: string, ok: boolean, f?: Failure): void {
  st.counters.requests++;
  const stat = st.perProvider[id] || (st.perProvider[id] = { keyAvailable: true, keySource: 'none', requests: 0, successes: 0, failures: 0 });
  stat.requests++;
  if (ok) {
    stat.successes++;
  } else {
    stat.failures++;
    stat.lastError = { kind: f?.kind || 'non_retryable', statusCode: f?.statusCode, message: f?.message || 'unknown', at: new Date().toISOString() };
  }
}

export function recordFailover(st: FailoverState): void {
  st.counters.failovers++;
}

export function recordExhausted(st: FailoverState): void {
  st.counters.exhausted++;
}

export function switchProvider(st: FailoverState, id: string): boolean {
  if (!st.chain.some(c => c.id === id)) return false;
  st.override = id;
  st.activeId = id;
  return true;
}

export function nextProvider(st: FailoverState): string | null {
  if (st.chain.length < 2) return null;
  const idx = st.chain.findIndex(c => c.id === (st.override || st.activeId));
  const next = st.chain[(idx + 1) % st.chain.length];
  st.override = next.id;
  st.activeId = next.id;
  return next.id;
}

export interface StatusPayload {
  activeProvider: string;
  override: string | null;
  chain: {
    id: string; name: string; model: string; adapter: string;
    keyAvailable: boolean; keySource: string;
  }[];
  counters: FailoverState['counters'];
  perProvider: Record<string, ProviderStat>;
  startedAt: string;
  pid: number;
}

export function statusSnapshot(st: FailoverState): StatusPayload {
  return {
    activeProvider: st.activeId,
    override: st.override,
    chain: st.chain.map(c => ({
      id: c.id, name: c.name, model: c.model, adapter: c.adapter,
      keyAvailable: c.keySource !== 'none', keySource: c.keySource,
    })),
    counters: st.counters,
    perProvider: st.perProvider,
    startedAt: st.startedAt,
    pid: process.pid,
  };
}
