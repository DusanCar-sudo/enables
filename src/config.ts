// ─────────────────────────────────────────────────────────────────────────────
// Aura Enables — config persistence
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export const CFG = path.join(os.homedir(), '.enables.json');

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
}

export function loadConfig(): EnablesConfig {
  try { return JSON.parse(fs.readFileSync(CFG, 'utf8')); } catch { return {}; }
}

export function saveConfig(c: Partial<EnablesConfig>): void {
  const existing = loadConfig();
  fs.writeFileSync(CFG, JSON.stringify({ ...existing, ...c }, null, 2), 'utf8');
}
