// ─────────────────────────────────────────────────────────────────────────────
// Aura Enables — config persistence
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export const CFG = path.join(os.homedir(), '.enables.json');
export const RUNTIME_FILE = path.join(os.homedir(), '.enables-runtime.json');

export interface ProviderConfig {
  apiKey?: string;
  model?: string;
  baseUrl?: string;          // Overrides the catalog baseUrl (e.g. Cloudflare {account})
  adapter?: 'openai' | 'anthropic';
}

export interface EnablesConfig {
  provider?: string;
  providerName?: string;
  providerGroup?: string;
  providerVariant?: string;
  adapter?: 'openai' | 'anthropic';
  targetBaseUrl?: string;
  targetApiKey?: string;
  keyEnvVar?: string;
  bigModel?: string;
  smallModel?: string;
  port?: number;
  providers?: Record<string, ProviderConfig>;  // Per-provider keys/models for failover
  failover?: boolean;                          // Enable automatic provider failover (default true)
  failoverChain?: string[];                    // Explicit provider order override
  upstreamTimeoutMs?: number;                  // Upstream socket timeout (default 300_000)
}

export function loadConfig(filePath: string = CFG): EnablesConfig {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return {}; }
}

export function saveConfig(c: Partial<EnablesConfig>, filePath: string = CFG): void {
  const existing = loadConfig(filePath);
  // Drop explicit undefined values so a partial save never clobbers stored fields.
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(c)) {
    if (v !== undefined) patch[k] = v;
  }
  fs.writeFileSync(filePath, JSON.stringify({ ...existing, ...patch }, null, 2), 'utf8');
}

// ── Runtime discovery: lets `enables status/switch/next` find the running proxy ──

export interface RuntimeInfo {
  port: number;
  pid: number;
  provider: string;
  startedAt: string;
}

export function loadRuntime(runtimeFile: string = RUNTIME_FILE): RuntimeInfo | undefined {
  try { return JSON.parse(fs.readFileSync(runtimeFile, 'utf8')); } catch { return undefined; }
}

export function saveRuntime(info: RuntimeInfo, runtimeFile: string = RUNTIME_FILE): void {
  try { fs.writeFileSync(runtimeFile, JSON.stringify(info, null, 2), 'utf8'); } catch { /* best effort */ }
}

export function clearRuntime(runtimeFile: string = RUNTIME_FILE): void {
  try { fs.unlinkSync(runtimeFile); } catch { /* best effort */ }
}
