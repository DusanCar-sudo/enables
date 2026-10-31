#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Aura Enables — headless model discovery
//
// Lists the models each provider actually serves right now, so the shipped
// defaultModel in src/providers.ts can be checked against reality instead of
// guessed. Reads keys from the environment only; prints no key material.
// ─────────────────────────────────────────────────────────────────────────────

import * as https from 'https';
import { findProvider, PROVIDERS } from '../src/providers.js';
import { resolveKey } from '../src/failover.js';
import type { EnablesConfig } from '../src/config.js';

const TIMEOUT_MS = 20000;

function getJson(url: string, headers: Record<string, string>): Promise<{ status: number; text: string }> {
  return new Promise(resolve => {
    let done = false;
    const finish = (r: { status: number; text: string }): void => { if (!done) { done = true; resolve(r); } };
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, port: 443, path: u.pathname + u.search, method: 'GET', headers,
    }, res => {
      let d = '';
      res.on('data', c => { d += c.toString(); });
      res.on('end', () => finish({ status: res.statusCode ?? 0, text: d }));
    });
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('timeout')));
    req.on('error', e => finish({ status: 0, text: e.message }));
    req.end();
  });
}

interface Row { id: string; name: string; base: string; envVar: string; status: number; count: number; sample: string[]; note: string; }

async function inspect(id: string): Promise<Row> {
  const def = findProvider(id);
  const empty: Row = { id, name: def?.name ?? id, base: def?.baseUrl ?? '', envVar: def?.keyEnvVar ?? '', status: 0, count: 0, sample: [], note: '' };
  if (!def) return { ...empty, note: 'not in catalog' };
  if (def.baseUrl.includes('{account}')) return { ...empty, note: 'needs CLOUDFLARE_ACCOUNT_ID' };
  if (def.noKeyRequired) return { ...empty, note: 'no key required' };

  const { key, source } = resolveKey({} as EnablesConfig, id, def);
  if (!key) return { ...empty, note: `no key in env (${def.keyEnvVar || 'n/a'})` };

  const u = def.baseUrl.replace(/\/$/, '');
  const headers: Record<string, string> = def.adapter === 'anthropic'
    ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
    : { authorization: 'Bearer ' + key };
  const res = await getJson(u + '/models', headers);
  if (res.status !== 200) return { ...empty, status: res.status, note: res.text.slice(0, 120) };

  let ids: string[] = [];
  try {
    const o = JSON.parse(res.text) as any;
    ids = Array.isArray(o?.data) ? o.data.map((m: any) => String(m.id)) : Array.isArray(o?.models) ? o.models.map((m: any) => String(m)) : [];
  } catch { return { ...empty, status: res.status, note: 'non-JSON models response' }; }
  return { ...empty, status: 200, count: ids.length, sample: ids.slice(0, 6) };
}

async function main(): Promise<void> {
  const want = process.argv.slice(2);
  const ids = want.length ? want : PROVIDERS.map(p => p.id);
  for (const id of ids) {
    const r = await inspect(id);
    const shipped = findProvider(id)?.defaultModel ?? '';
    const flag = r.status === 200 && shipped && !r.sample.includes(shipped) ? '  <-- shipped default NOT in live list' : '';
    console.log(`${r.id.padEnd(24)} key=${r.envVar.padEnd(24)} ${String(r.status).padEnd(5)} models=${String(r.count).padEnd(5)} default=${shipped}${flag}`);
    if (r.sample.length) console.log(`${' '.repeat(24)} live: ${r.sample.join(', ')}`);
    if (r.note) console.log(`${' '.repeat(24)} note: ${r.note}`);
  }
}

main().catch(e => { console.error('discovery failed:', e); process.exit(1); });
