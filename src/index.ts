#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Aura Enables — entry point
// One command: enables → pick provider → enter key → start claude
// ─────────────────────────────────────────────────────────────────────────────

import { spawn } from 'child_process';
import { loadConfig, saveConfig } from './config.js';
import { startProxy } from './server.js';
import {
  menu, printBanner, printProxyStatus, configureProvider,
  providerDisplayName, launchClaude, CLR, R, K, G, B,
} from './cli.js';

process.on('uncaughtException', (e: any) => {
  if (e?.code === 'EADDRINUSE') { console.log('\nPort in use.\n'); process.exit(1); }
  console.error('[enables] uncaughtException:', e?.message || e);
});

async function main() {
  const saved = loadConfig();
  process.stdout.write(CLR);

  if (saved.targetBaseUrl && saved.targetApiKey) {
    printBanner();
    console.log('  ' + B + providerDisplayName(saved) + R + ' ' + K + (saved.bigModel || '') + R);
    console.log('');

    const i = await menu([
      { label: '\u25b6  Start Claude Code', note: 'uses saved API key' },
      { label: '\u25c7  Change provider / API key', note: '' },
      { label: '\u2715  Quit', note: '' },
    ], 'What now?');

    process.stdout.write(CLR);

    if (i === 0) {
      await startProxy(saved);
      printProxyStatus(saved);
      setTimeout(() => {
        const c = spawn('claude', [], { stdio: 'inherit', env: { ...process.env, ANTHROPIC_BASE_URL: 'http://localhost:' + (saved.port || 8080), ANTHROPIC_API_KEY: 'dummy' } });
        c.on('error', () => {});
        c.on('exit', () => console.log('\n' + K + 'Claude closed. Proxy still running. Ctrl+C to stop.' + R + '\n'));
      }, 1500);
      return;
    } else if (i !== 1) { process.exit(0); }
  }

  while (true) {
    const config = await configureProvider();
    saveConfig(config);
    process.stdout.write(CLR);
    console.log('\n  ' + G + '\u2713  Configured' + R + '  ' + B + providerDisplayName(config) + R + '  ' + config.bigModel + '\n');

    const si = await menu([{ label: '\u25b6  Start Claude Code now', note: '' }, { label: '\u2715  Quit', note: '' }], 'Ready?', 0, { back: true });
    process.stdout.write(CLR);
    if (si === -1) { continue; }

    if (si === 0) {
      const cfg = loadConfig();
      await startProxy(cfg);
      printProxyStatus(cfg);
      setTimeout(() => {
        const c = spawn('claude', [], { stdio: 'inherit', env: { ...process.env, ANTHROPIC_BASE_URL: 'http://localhost:' + (cfg.port || 8080), ANTHROPIC_API_KEY: 'dummy' } });
        c.on('error', () => {});
        c.on('exit', () => console.log('\n' + K + 'Claude closed. Proxy still running. Ctrl+C to stop.' + R + '\n'));
      }, 1500);
    } else { console.log('\n  ' + K + 'Run "enables" to start later.' + R + '\n'); }
    return;
  }
}

main();
