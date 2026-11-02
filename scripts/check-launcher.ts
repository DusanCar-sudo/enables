#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Aura Enables — launch-environment preflight (v0.4.1)
//
// Claude Code is spawned with the injected proxy environment:
//   ANTHROPIC_BASE_URL=http://localhost:<port>   ANTHROPIC_API_KEY=<key>
// If `claude` on PATH is a shell wrapper script that unsets ANTHROPIC_BASE_URL
// for localhost addresses (a cleanup pattern left over from router-era setups —
// tokenharbor, z.ai), the injection dies before Claude Code starts: the proxy
// sits idle, no Token Saver lines appear, and Claude answers from the stock
// backend instead of the Enables provider.
//
// This preflight scans the resolved `claude` launcher for that pattern and
// reports it before a session is wasted. Exit codes:
//   0 — launcher looks clean
//   1 — launcher strips the injected base URL (hostile to Enables)
//   2 — `claude` not found on PATH
//
// Usage:  node --import tsx scripts/check-launcher.ts [--bin <path>]
//         npm run preflight
// Env:    ENABLES_CLAUDE_BIN  — launcher path override (same as --bin)
// ─────────────────────────────────────────────────────────────────────────────

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { isAbsolute, resolve } from 'path';

const argv: string[] = process.argv.slice(2);

const flagValue = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};

function resolveLauncher(argv2: string[]): string | null {
  const override = argv2 ?? process.env.ENABLES_CLAUDE_BIN;
  if (override) return resolve(override);
  try {
    const out = execSync('command -v claude', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
      .split('\n')
      .filter(Boolean)[0];
    return out || null;
  } catch {
    return null;
  }
}

function readLauncherFile(path: string): string | null {
  try {
    const buf = readFileSync(path);
    if (buf.slice(0, 4).some(b => b === 0)) return null; // binary (e.g. official claude executable)
    return buf.toString('utf8');
  } catch {
    return null;
  }
}

interface Finding {
  kind: string;
  lines: number[];
}

function scanForStripping(text: string): Finding[] {
  const findings: Finding[] = [];
  const lines = text.split('\n');

  const isUnset = /^\s*unset\s+ANTHROPIC_/;
  const guarded = (idx: number): boolean =>
    lines.slice(Math.max(0, idx - 5), idx + 6).some(l => /ANTHROPIC_API_KEY/.test(l));

  const findingsFor = (varName: string, base: string): number[] => {
    const hits = lines.reduce<number[]>((acc, l, i) => {
      if (l.includes(base) && isUnset.test(l)) acc.push(i);
      else if (lineIncludes(l, base) && new RegExp(`^\\s*unset\\s+(.+\\s)?${base}($|\\s)`).test(l)) acc.push(i);
      return acc;
    }, []);
    return hits;
  };
  const lineIncludes = (l: string, s: string): boolean => l.includes(s);

  // A guarded unset (an ANTHROPIC_API_KEY mention near the conditional) keeps the
  // deliberate proxy injection alive — only unguarded strips are hostile.
  const base = findingsFor('BASE', 'ANTHROPIC_BASE_URL').reduce<number[]>((acc, i) => (!guarded(i) ? (acc.push(i + 1), acc) : acc), []);
  if (base.length) findings.push({ kind: 'unset ANTHROPIC_BASE_URL', lines: base });

  const api = findingsFor('KEY', 'ANTHROPIC_API_KEY').reduce<number[]>((acc, i) => (!guarded(i) ? (acc.push(i + 1), acc) : acc), []);
  if (api.length) findings.push({ kind: 'unset ANTHROPIC_API_KEY', lines: api });

  const token = findingsFor('TOKEN', 'ANTHROPIC_AUTH_TOKEN').reduce<number[]>((acc, i) => (!guarded(i) ? (acc.push(i + 1), acc) : acc), []);
  if (token.length) findings.push({ kind: 'unset ANTHROPIC_AUTH_TOKEN', lines: token });

  return findings;
}

const hostPatterns = ['127\\.0\\.0\\.1', 'localhost', 'tokenharbor', 'z\\.ai'];

const main = (): number => {
  const launcher = resolveLauncher(flagValue('--bin'));
  if (!launcher) {
    console.error('  ✗  `claude` not found on PATH (set --bin / ENABLES_CLAUDE_BIN to override)');
    return 2;
  }

  console.log('  ✓  claude resolves to: ' + launcher);

  const text = readLauncherFile(launcher);
  if (text === null) {
    console.log('  ✓  binary launcher — no script stripping to check');
    return 0;
  }

  const hostLines = hostPatterns
    .filter(h => new RegExp(h).test(text));

  const findings = scanForStripping(text);
  if (!findings.length) {
    console.log('  ✓  launcher does not unset the injected proxy environment');
    return 0;
  }

  const stripsBase = findings.some(f => f.kind === 'unset ANTHROPIC_BASE_URL');
  for (const f of findings) {
    const sev = f.kind === 'unset ANTHROPIC_BASE_URL' ? '✗ strips base URL' : (hostLines.length ? '✗' : '· note');
    console.log(`  ${sev}  ${launcher}: ${f.kind} (line${f.lines.length === 1 ? '' : 's'} ${f.lines.join(', ')})`);
  }

  if (stripsBase) {
    console.log('');
    console.log('  This launcher unsets ANTHROPIC_BASE_URL. When Enables injects');
    console.log('  ANTHROPIC_BASE_URL=http://localhost:<port>, the injection is removed and');
    console.log('  Claude Code answers from its stock backend while the Enables proxy sits idle.');
    console.log('');
    console.log('  Fix: in the launcher, keep a localhost base URL set together with an API key —');
    console.log('  that pair is a deliberate proxy injection, not a stale leftover. Example:');
    console.log('');
    console.log('    if [[ -n "$ANTHROPIC_API_KEY" && "$ANTHROPIC_BASE_URL" =~ (127\\.0\\.0\\.1|localhost) ]]; then');
    console.log('      :');
    console.log('    elif [[ -n "$ANTHROPIC_BASE_URL" ]]; then');
    console.log('      unset ANTHROPIC_BASE_URL');
    console.log('    fi');
    return 1;
  }

  return 0;
};

process.exit(main());
