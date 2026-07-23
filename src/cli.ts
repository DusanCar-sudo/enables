// ─────────────────────────────────────────────────────────────────────────────
// Aura Enables — CLI menu system, prompts, display helpers
// ─────────────────────────────────────────────────────────────────────────────

import * as readline from 'readline';
import { PROVIDERS } from './providers.js';
import type { ProviderDef } from './providers.js';

// ── ANSI colors ─────────────────────────────────────────────────────────────
export const R = '\x1b[0m';
export const B = '\x1b[1m';
export const G = '\x1b[32m';
export const Y = '\x1b[33m';
export const K = '\x1b[90m';
export const H = '\x1b[1;38;2;196;60;60m';
export const CLR = '\x1b[2J\x1b[H';
export const O = '\x1b[?25h';

// ── Menu ────────────────────────────────────────────────────────────────────

export async function menu(
  items: { label: string; note?: string }[],
  prompt: string,
  sel = 0,
  opts: { back?: boolean } = {},
): Promise<number> {
  try { process.stdin.setRawMode(false); } catch {}
  process.stdout.write(O);
  console.log(R + '  ' + prompt + R + '\n');
  for (let i = 0; i < items.length; i++) {
    const prefix = i === sel ? '  > ' : '    ';
    const note = items[i].note ? ' ' + K + items[i].note + R : '';
    console.log(prefix + `${i + 1}. ` + items[i].label + note);
  }
  if (opts.back) {
    console.log('    0. Back');
  }
  console.log('');
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const askChoice = () => {
      const suffix = opts.back ? ` [${sel + 1}, 0 back]` : ` [${sel + 1}]`;
      rl.question(`  Select${suffix}: `, answer => {
        const trimmed = answer.trim().toLowerCase();
        if (trimmed === 'q') { rl.close(); process.exit(0); }
        if (opts.back && (trimmed === '0' || trimmed === 'b' || trimmed === 'back')) {
          rl.close();
          resolve(-1);
          return;
        }
        if (!trimmed) { rl.close(); resolve(sel); return; }
        const choice = Number(trimmed);
        if (Number.isInteger(choice) && choice >= 1 && choice <= items.length) {
          rl.close();
          resolve(choice - 1);
          return;
        }
        console.log('  ' + Y + `Enter a number from 1 to ${items.length}${opts.back ? ', 0 to go back' : ''}, or q to quit.` + R);
        askChoice();
      });
    };
    askChoice();
  });
}

// ── Secret input (hidden) ───────────────────────────────────────────────────

export async function secret(p: string, fallback = ''): Promise<string> {
  try { process.stdin.setRawMode(false); } catch {}
  process.stdout.write(O);
  return new Promise(r => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ow = process.stdout.write.bind(process.stdout);
    process.stdout.write('  ' + p);
    (process.stdout as any).write = () => {};
    rl.question('', a => { (process.stdout as any).write = ow; process.stdout.write('\n'); rl.close(); r(a.trim() || fallback); });
  });
}

// ── Plain text input ────────────────────────────────────────────────────────

export async function ask(p: string, fallback = ''): Promise<string> {
  try { process.stdin.setRawMode(false); } catch {}
  process.stdout.write(O);
  return new Promise(r => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const label = fallback ? `  ${p} (${fallback}): ` : `  ${p}: `;
    rl.question(label, a => { rl.close(); r(a.trim() || fallback); });
  });
}

// ── Provider helpers ────────────────────────────────────────────────────────

export function providerGroupName(provider: ProviderDef): string {
  return provider.group || provider.name;
}

export function providerVariantName(provider: ProviderDef): string {
  return provider.variant || provider.name;
}

export function providerGroups(): { name: string; providers: ProviderDef[] }[] {
  const groups = new Map<string, ProviderDef[]>();
  for (const provider of PROVIDERS) {
    const name = providerGroupName(provider);
    groups.set(name, [...(groups.get(name) || []), provider]);
  }
  return [...groups.entries()].map(([name, providers]) => ({ name, providers }));
}

export function providerDisplayName(cfg: any): string {
  if (cfg.providerGroup && cfg.providerVariant && cfg.providerGroup !== cfg.providerVariant) {
    return `${cfg.providerGroup} / ${cfg.providerVariant}`;
  }
  return cfg.providerName || cfg.provider || 'Unknown provider';
}

// ── Display helpers ─────────────────────────────────────────────────────────

export function printBanner(): void {
  console.log('');
  console.log('      ' + K + '◢◤' + R + '                               ' + K + '◢◤' + R);
  console.log('   ' + K + '╭─────────────────────────────────────────────────╮' + R);
  console.log('   ' + K + '│' + R + '   ' + H + 'AURA' + R + '   ' + B + 'CODE' + R + '   ' + K + '│' + R);
  console.log('   ' + K + '│' + R + '        ' + G + 'E N A B L E S' + R + '              ' + K + '│' + R);
  console.log('   ' + K + '│' + R + '    ' + K + 'local gateway for Claude Code' + R + '     ' + K + '│' + R);
  console.log('   ' + K + '╰─────────────────────────────────────────────────╯' + R);
  console.log('      ' + K + '◥◣' + R + '                               ' + K + '◥◣' + R);
  console.log('');
}

export function printProxyStatus(cfg: any) {
  console.log('\n  ' + G + '\u2713  Proxy on port ' + (cfg.port || 8080) + R);
  console.log('  ' + B + 'Provider:' + R + ' ' + providerDisplayName(cfg));
  console.log('  ' + B + 'Model:' + R + '    ' + (cfg.bigModel || 'unknown'));
  console.log('  ' + B + 'Endpoint:' + R + ' ' + (cfg.targetBaseUrl || 'unknown') + '\n');
  console.log('  ' + B + 'Token Saver:' + R + ' ' + K + 'tracking request tokens, provider cache hits, and session savings' + R);
  console.log('  ' + B + 'Claude Code:' + R + '  ' + K + 'ANTHROPIC_BASE_URL=http://localhost:' + (cfg.port || 8080) + ' ANTHROPIC_API_KEY=dummy' + R + '\n');
}

// ── API key prompt ──────────────────────────────────────────────────────────

export async function promptApiKey(provider: ProviderDef): Promise<string> {
  if (provider.id === 'ollama') return 'local';

  const envKey = provider.keyEnvVar ? process.env[provider.keyEnvVar] || '' : '';
  console.log('\n  ' + B + provider.name + R);
  console.log('  ' + K + provider.keyHint + R);
  if (envKey) {
    console.log('  ' + K + `Press Enter to use ${provider.keyEnvVar}, or paste a different key.` + R + '\n');
    const apiKey = await secret(provider.keyPrompt + ' (hidden): ', envKey);
    console.log('  ' + G + 'API key saved.' + R);
    return apiKey;
  }

  console.log('');
  const apiKey = await secret(provider.keyPrompt + ' (hidden): ');
  if (!apiKey) { process.exit(1); }
  console.log('  ' + G + 'API key saved.' + R);
  return apiKey;
}

// ── Full provider configuration flow ────────────────────────────────────────

export async function configureProvider(): Promise<any> {
  while (true) {
    printBanner();
    console.log('  ' + K + 'Make any model work with Claude Code.' + R + '\n');

    const groups = providerGroups();
    const pi = await menu(groups.map(g => ({
      label: g.name,
      note: g.providers.length > 1 ? `${g.providers.length} options` : (g.providers[0].notes || ''),
    })), 'Choose your AI provider:');
    const group = groups[pi];
    let provider = group.providers[0];

    if (group.providers.length > 1) {
      process.stdout.write(CLR);
      const vi = await menu(group.providers.map(p => ({
        label: providerVariantName(p),
        note: p.notes || p.baseUrl,
      })), `${group.name}:`, 0, { back: true });
      if (vi === -1) { process.stdout.write(CLR); continue; }
      provider = group.providers[vi];
    }

    process.stdout.write(CLR);
    const apiKey = await promptApiKey(provider);

    let baseUrl = provider.baseUrl;
    if (provider.isCustom) {
      console.log('\n  ' + B + provider.name + R);
      console.log('  ' + K + 'Example: https://api.example.com/v1' + R + '\n');
      baseUrl = await ask('OpenAI-compatible base URL');
      if (!baseUrl) { process.exit(1); }
    }

    let model = provider.defaultModel;
    if (provider.isCustom) {
      model = await ask('Model name');
      if (!model) { process.exit(1); }
    } else if (provider.models.length > 1) {
      const mi = await menu(provider.models.map(m => ({ label: m, note: m === provider.defaultModel ? '(default)' : '' })), 'Model:', 0, { back: true });
      if (mi === -1) { process.stdout.write(CLR); continue; }
      model = provider.models[mi];
      process.stdout.write(CLR);
    }

    return {
      provider: provider.id,
      providerName: provider.name,
      providerGroup: providerGroupName(provider),
      providerVariant: providerVariantName(provider),
      adapter: provider.adapter,
      targetBaseUrl: baseUrl,
      targetApiKey: apiKey,
      keyEnvVar: provider.keyEnvVar,
      bigModel: model,
      smallModel: provider.models[0] || model,
      port: 8080,
    };
  }
}

// ── Launch Claude Code in terminal ──────────────────────────────────────────

export function launchClaude(cfg: any) {
  const port = cfg.port || 8080;
  const isAnthropic = (cfg.targetBaseUrl || '').includes('anthropic.com');
  const key = isAnthropic ? cfg.targetApiKey : 'dummy';
  const envStr = 'ANTHROPIC_BASE_URL=http://localhost:' + port + ' ANTHROPIC_API_KEY=' + key;
  try {
    require('child_process').execSync('which konsole 2>/dev/null', { stdio: 'ignore' });
    require('child_process').spawn('konsole', ['--hold', '-e', 'env', envStr, 'claude'], { detached: true, stdio: 'ignore' }).unref();
    console.log('\n  ' + G + 'Claude Code launched in new window.' + R + '\n');
    return;
  } catch {}
  try {
    require('child_process').execSync('which x-terminal-emulator 2>/dev/null', { stdio: 'ignore' });
    require('child_process').spawn('x-terminal-emulator', ['-e', 'bash', '-c', 'export ' + envStr + '; claude'], { detached: true, stdio: 'ignore' }).unref();
    console.log('\n  ' + G + 'Claude Code launched in new window.' + R + '\n');
    return;
  } catch {}
  console.log('\n  ' + Y + 'Open another terminal and run:' + R);
  console.log('  ' + K + envStr + ' claude' + R + '\n');
}
