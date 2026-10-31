#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Aura Enables — entry point
// One command: enables → pick provider → enter key → start claude
// ─────────────────────────────────────────────────────────────────────────────

import { spawn } from 'child_process';
import { loadConfig, saveConfig } from './config.js';
import type { EnablesConfig } from './config.js';
import { startProxy } from './server.js';
import { controlRequest, resolveProxyPort, printStatus, printProxyNotRunning } from './control.js';
import {
  menu, ask, printBanner, printProxyStatus, configureProvider,
  providerDisplayName, parseCliArgs, printHelp, printVersion, CLR, R, K, G, B, Y,
} from './cli.js';

process.on('uncaughtException', (e: any) => {
  if (e?.code === 'EADDRINUSE') { console.log('\nPort in use.\n'); process.exit(1); }
  console.error('[enables] uncaughtException:', e?.message || e);
});

async function runWithProxy(cfg: EnablesConfig, claudeArgs: string[] = []) {
  await startProxy(cfg);
  printProxyStatus(cfg);
  const isAnthropic = (cfg.targetBaseUrl || '').includes('anthropic.com');
  const key = isAnthropic ? (cfg.targetApiKey || 'dummy') : 'dummy';

  setTimeout(() => {
    const c = spawn('claude', claudeArgs, {
      stdio: 'inherit',
      env: {
        ...process.env,
        ANTHROPIC_BASE_URL: 'http://localhost:' + (cfg.port || 8080),
        ANTHROPIC_API_KEY: key,
      },
    });
    c.on('error', (err: any) => {
      if (err.code === 'ENOENT') {
        console.error('\n  ' + Y + 'Error: "claude" CLI is not found in PATH.' + R);
        console.log('  ' + K + 'Install Claude Code with: npm install -g @anthropic-ai/claude-code' + R + '\n');
      } else {
        console.error('\n  [enables] Error launching Claude Code:', err.message || err);
      }
    });
    c.on('exit', (code) => {
      console.log('\n' + K + `Claude closed (exit code ${code ?? 0}). Proxy still running. Press Ctrl+C to stop.` + R + '\n');
    });
  }, 1000);
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const parsed = parseCliArgs(rawArgs);

  if (parsed.mode === 'help') {
    printHelp();
    return;
  }

  if (parsed.mode === 'version') {
    printVersion();
    return;
  }

  // ── Control-plane subcommands: talk to a running proxy, no config needed ──
  if (parsed.mode === 'status' || parsed.mode === 'switch' || parsed.mode === 'next') {
    try {
      const port = resolveProxyPort();
      const res = parsed.mode === 'status'
        ? await controlRequest('GET', '/__enables/status', undefined, port)
        : parsed.mode === 'switch'
          ? await controlRequest('POST', '/__enables/switch', { provider: parsed.controlArg }, port)
          : await controlRequest('POST', '/__enables/next', {}, port);
      if (res.status === 0) {
        printProxyNotRunning();
        process.exit(1);
      }
      if (parsed.mode === 'status' && res.status === 200) {
        printStatus(res.json);
        return;
      }
      if (res.status === 200) {
        console.log('\n  ' + G + '✓ Active provider: ' + B + res.json.activeProvider + R + '\n');
        return;
      }
      const err = res.json?.error;
      const msg = typeof err === 'string' ? err : JSON.stringify(err ?? ('HTTP ' + res.status));
      console.error('\n  ' + Y + 'Error: ' + msg + R);
      process.exit(1);
    } catch {
      printProxyNotRunning();
      process.exit(1);
    }
  }

  let saved = loadConfig();

  if (parsed.mode === 'setup') {
    process.stdout.write(CLR);
    const config = await configureProvider();
    saveConfig(config);
    saved = loadConfig();
    console.log('\n  ' + G + '✓  Configured' + R + '  ' + B + providerDisplayName(config) + R + '  ' + config.bigModel + '\n');
    return;
  }

  if (parsed.mode === 'run') {
    // Run-scoped failover flags
    if (parsed.noFailover) saved.failover = false;
    if (parsed.chain) saved.failoverChain = parsed.chain.split(',').map(s => s.trim()).filter(Boolean);
    if (!saved.targetBaseUrl || !saved.targetApiKey) {
      process.stdout.write(CLR);
      console.log('\n  ' + Y + 'No saved provider configuration found. Let\'s configure it first:' + R + '\n');
      const config = await configureProvider();
      saveConfig(config);
      saved = loadConfig();
    }
    await runWithProxy(saved, parsed.claudeArgs);
    return;
  }

  // Interactive Menu
  process.stdout.write(CLR);

  if (saved.targetBaseUrl && saved.targetApiKey) {
    printBanner();
    console.log('  ' + B + providerDisplayName(saved) + R + ' ' + K + (saved.bigModel || '') + R);
    console.log('');

    const i = await menu([
      { label: '▶  Start Claude Code', note: 'new session' },
      { label: '↺  Continue last session', note: 'claude -c' },
      { label: '⧉  Resume session by ID', note: 'claude --resume [id]' },
      { label: '◇  Change provider / API key', note: '' },
      { label: '✕  Quit', note: '' },
    ], 'What now?');

    process.stdout.write(CLR);

    if (i === 0) {
      await runWithProxy(saved, []);
      return;
    } else if (i === 1) {
      await runWithProxy(saved, ['--continue']);
      return;
    } else if (i === 2) {
      console.log('\n  ' + B + 'Resume Claude Code Session' + R);
      console.log('  ' + K + 'Enter session UUID, or leave blank for interactive selector.' + R + '\n');
      const sessionId = await ask('Session ID', '');
      const resumeArgs = sessionId ? ['--resume', sessionId] : ['--resume'];
      await runWithProxy(saved, resumeArgs);
      return;
    } else if (i === 3) {
      const config = await configureProvider();
      saveConfig(config);
      saved = loadConfig();
      process.stdout.write(CLR);
      console.log('\n  ' + G + '✓  Configured' + R + '  ' + B + providerDisplayName(saved) + R + '  ' + saved.bigModel + '\n');
      await runWithProxy(saved, []);
      return;
    } else {
      process.exit(0);
    }
  }

  while (true) {
    const config = await configureProvider();
    saveConfig(config);
    saved = loadConfig();
    process.stdout.write(CLR);
    console.log('\n  ' + G + '✓  Configured' + R + '  ' + B + providerDisplayName(config) + R + '  ' + config.bigModel + '\n');

    const si = await menu([
      { label: '▶  Start Claude Code now', note: '' },
      { label: '✕  Quit', note: '' },
    ], 'Ready?', 0, { back: true });

    process.stdout.write(CLR);
    if (si === -1) { continue; }

    if (si === 0) {
      await runWithProxy(saved, []);
    } else {
      console.log('\n  ' + K + 'Run "enables" or "enables --resume <id>" to start later.' + R + '\n');
    }
    return;
  }
}

main();
