// ─────────────────────────────────────────────────────────────────────────────
// Aura Enables — CLI menu system, prompts, display helpers
// ─────────────────────────────────────────────────────────────────────────────

import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
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

// ── chelper (Z.ai official CLI) detection ───────────────────────────────────

const CHELPER_CONFIG_PATH = path.join(os.homedir(), '.chelper', 'config.yaml');

export interface ChelperConfig {
  lang?: string;
  plan?: 'glm_coding_plan_global' | 'glm_coding_plan_china';
  api_key?: string;
}

export function loadChelperConfig(): ChelperConfig | null {
  try {
    if (!fs.existsSync(CHELPER_CONFIG_PATH)) return null;
    const content = fs.readFileSync(CHELPER_CONFIG_PATH, 'utf8');
    // Simple YAML parsing for our known keys
    const config: ChelperConfig = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('plan:')) config.plan = trimmed.slice(5).trim() as any;
      else if (trimmed.startsWith('api_key:')) config.api_key = trimmed.slice(8).trim();
      else if (trimmed.startsWith('lang:')) config.lang = trimmed.slice(5).trim();
    }
    return config.api_key ? config : null;
  } catch {
    return null;
  }
}

export function getChelperBaseUrl(plan?: string): string {
  return plan === 'glm_coding_plan_china'
    ? 'https://open.bigmodel.cn/api/anthropic'
    : 'https://api.z.ai/api/anthropic';
}

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
  const failover = cfg.failover === false ? K + 'off' + R : G + 'on' + R;
  const chainLen = Array.isArray(cfg.failoverChain) && cfg.failoverChain.length
    ? cfg.failoverChain.length
    : undefined;
  console.log('  ' + B + 'Failover:' + R + ' ' + failover + (chainLen ? '  ' + K + `chain of ${chainLen}` + R : ''));
  console.log('  ' + K + 'Switch anytime (even mid-session, from Claude Code): enables status | enables next | enables switch <provider>' + R + '\n');
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
  // Check for existing chelper (Z.ai official CLI) config
  const chelperConfig = loadChelperConfig();
  if (chelperConfig) {
    const baseUrl = getChelperBaseUrl(chelperConfig.plan);
    console.log('\n  ' + G + '✓  Found Z.ai GLM Coding Plan config from chelper (~/.chelper/config.yaml)' + R);
    console.log('  ' + K + 'Plan: ' + (chelperConfig.plan || 'glm_coding_plan_global') + R);
    console.log('  ' + K + 'Endpoint: ' + baseUrl + R);
    const useIt = await ask('Import this config for Enables? [Y/n]', 'y');
    if (useIt.toLowerCase() !== 'n') {
      return {
        provider: 'z-ai-official',
        providerName: 'Z.ai GLM Coding Plan (Official)',
        providerGroup: 'Z.ai',
        providerVariant: 'Official (Anthropic endpoint)',
        adapter: 'anthropic',
        targetBaseUrl: baseUrl,
        targetApiKey: chelperConfig.api_key!,
        keyEnvVar: 'ZAI_CODING_PLAN_API_KEY',
        bigModel: 'glm-5.3-flash',
        smallModel: 'glm-5.3-flash',
        port: 8080,
      };
    }
    console.log('');
  }

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

// ── CLI Argument Parsing & Passthrough ──────────────────────────────────────

export interface ParsedArgs {
  mode: 'run' | 'help' | 'version' | 'setup' | 'menu' | 'status' | 'switch' | 'next';
  claudeArgs: string[];
  controlArg?: string;   // provider id for `switch`
  noFailover?: boolean;  // --no-failover
  chain?: string;        // --chain a,b,c
}

export function parseCliArgs(rawArgs: string[]): ParsedArgs {
  if (!rawArgs || rawArgs.length === 0) {
    return { mode: 'menu', claudeArgs: [] };
  }

  // Help & Version checks
  if (rawArgs.some(a => a === '-h' || a === '--help')) {
    return { mode: 'help', claudeArgs: [] };
  }
  if (rawArgs.some(a => a === '-v' || a === '--version')) {
    return { mode: 'version', claudeArgs: [] };
  }
  if (rawArgs.some(a => a === '--setup' || a === '--config')) {
    return { mode: 'setup', claudeArgs: [] };
  }

  // Control-plane subcommands (talk to a running proxy)
  if (rawArgs[0] === 'status') {
    return { mode: 'status', claudeArgs: [] };
  }
  if (rawArgs[0] === 'next') {
    return { mode: 'next', claudeArgs: [] };
  }
  if (rawArgs[0] === 'switch') {
    if (!rawArgs[1]) {
      console.error('Usage: enables switch <provider-id>');
      return { mode: 'help', claudeArgs: [] };
    }
    return { mode: 'switch', controlArg: rawArgs[1], claudeArgs: [] };
  }

  // Parse arguments and normalize resume / continue flags
  const claudeArgs: string[] = [];
  let noFailover = false;
  let chain: string | undefined;
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === '--no-failover') {
      noFailover = true;
    } else if (arg === '--chain') {
      chain = rawArgs[++i];
    } else if (arg.startsWith('--chain=')) {
      chain = arg.slice('--chain='.length);
    } else if (arg === '--resume' || arg === '-r') {
      claudeArgs.push('--resume');
      if (i + 1 < rawArgs.length && !rawArgs[i + 1].startsWith('-')) {
        claudeArgs.push(rawArgs[++i]);
      }
    } else if (arg.startsWith('--resume=')) {
      const sessionId = arg.slice('--resume='.length);
      claudeArgs.push('--resume');
      if (sessionId) {
        claudeArgs.push(sessionId);
      }
    } else if (arg.startsWith('-r=')) {
      const sessionId = arg.slice('-r='.length);
      claudeArgs.push('--resume');
      if (sessionId) {
        claudeArgs.push(sessionId);
      }
    } else if (arg === '-c' || arg === '--continue') {
      claudeArgs.push('--continue');
    } else {
      claudeArgs.push(arg);
    }
  }

  return { mode: 'run', claudeArgs, noFailover, chain };
}

export function printHelp(): void {
  printBanner();
  console.log(`  ${B}Usage:${R}
    enables [options] [claude arguments...]
    enables status | next | switch <provider-id>

  ${B}Options:${R}
    --resume, -r [id]    Resume a Claude Code session by ID (or open interactive picker)
    --continue, -c       Continue the most recent Claude Code session in current directory
    --setup, --config    Configure AI provider, API key, and model
    --no-failover        Disable automatic provider failover for this run
    --chain a,b,c        Override the failover provider order for this run
    -v, --version        Display Enables version
    -h, --help           Show this help message

  ${B}Control a running proxy:${R}
    enables status            Show active provider, failover chain, and counters
    enables switch <id>       Switch the active provider (persists for new requests)
    enables next              Advance to the next provider in the chain
    Tip: run these from Claude Code's Bash tool to change providers mid-session.

  ${B}Examples:${R}
    enables                                    # Interactive menu
    enables --resume f46bd1a5-bd3d-4ac7-...    # Resume specific session by ID
    enables -r                                 # Interactive session picker in Claude Code
    enables -c                                 # Continue last session in current directory
    enables --setup                            # Reconfigure provider and model
    enables --chain groq,openrouter,deepseek   # Custom failover order for this run
`);
}

export function printVersion(): void {
  console.log('enables v0.4.1');
}

// ── Launch Claude Code in terminal ──────────────────────────────────────────

export function launchClaude(cfg: any, claudeArgs: string[] = []) {
  const port = cfg.port || 8080;
  const isAnthropic = (cfg.targetBaseUrl || '').includes('/anthropic') || (cfg.adapter === 'anthropic');
  const key = isAnthropic ? cfg.targetApiKey : 'dummy';
  const envStr = 'ANTHROPIC_BASE_URL=http://localhost:' + port + ' ANTHROPIC_API_KEY=' + key;
  const argsStr = claudeArgs.length ? ' ' + claudeArgs.join(' ') : '';
  try {
    require('child_process').execSync('which konsole 2>/dev/null', { stdio: 'ignore' });
    require('child_process').spawn('konsole', ['--hold', '-e', 'bash', '-c', `env ${envStr} claude${argsStr}`], { detached: true, stdio: 'ignore' }).unref();
    console.log('\n  ' + G + 'Claude Code launched in new window.' + R + '\n');
    return;
  } catch {}
  try {
    require('child_process').execSync('which x-terminal-emulator 2>/dev/null', { stdio: 'ignore' });
    require('child_process').spawn('x-terminal-emulator', ['-e', 'bash', '-c', 'export ' + envStr + '; claude' + argsStr], { detached: true, stdio: 'ignore' }).unref();
    console.log('\n  ' + G + 'Claude Code launched in new window.' + R + '\n');
    return;
  } catch {}
  console.log('\n  ' + Y + 'Open another terminal and run:' + R);
  console.log('  ' + K + envStr + ' claude' + argsStr + R + '\n');
}

