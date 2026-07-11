#!/usr/bin/env node
// Enables - make any model work with Claude Code
// One command: enables -> pick provider -> enter key -> start claude

import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import { spawn } from 'child_process';
import { PROVIDERS } from './providers.js';
import type { ProviderDef } from './providers.js';
import { translateToOpenAI, mergeAssistantMessages } from './translate.js';
import { reverseStream, reverseNonStreaming } from './reverse.js';
import type { AnthropicRequest } from './translate.js';

const CFG = path.join(os.homedir(), '.enables.json');

const R = '\x1b[0m';
const B = '\x1b[1m';
const G = '\x1b[32m';
const Y = '\x1b[33m';
const K = '\x1b[90m';
const H = '\x1b[1;38;2;196;60;60m';
const C = '\x1b[2J\x1b[H';
const O = '\x1b[?25h';

process.on('uncaughtException', (e: any) => {
  if (e?.code === 'EADDRINUSE') { console.log('\nPort in use.\n'); process.exit(1); }
});

async function menu(
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

async function secret(p: string, fallback = ''): Promise<string> {
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

async function ask(p: string, fallback = ''): Promise<string> {
  try { process.stdin.setRawMode(false); } catch {}
  process.stdout.write(O);
  return new Promise(r => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const label = fallback ? `  ${p} (${fallback}): ` : `  ${p}: `;
    rl.question(label, a => { rl.close(); r(a.trim() || fallback); });
  });
}

function load(): any { try { return JSON.parse(fs.readFileSync(CFG, 'utf8')); } catch { return {}; } }
function save(c: any) { const e = load(); fs.writeFileSync(CFG, JSON.stringify({ ...e, ...c }, null, 2), 'utf8'); }

function providerGroupName(provider: ProviderDef): string {
  return provider.group || provider.name;
}

function providerVariantName(provider: ProviderDef): string {
  return provider.variant || provider.name;
}

function providerGroups(): { name: string; providers: ProviderDef[] }[] {
  const groups = new Map<string, ProviderDef[]>();
  for (const provider of PROVIDERS) {
    const name = providerGroupName(provider);
    groups.set(name, [...(groups.get(name) || []), provider]);
  }
  return [...groups.entries()].map(([name, providers]) => ({ name, providers }));
}

function chatCompletionsUrl(baseUrl: string): URL {
  const clean = baseUrl.replace(/\/+$/, '');
  return new URL(clean.endsWith('/chat/completions') ? clean : clean + '/chat/completions');
}

function anthropicMessagesUrl(baseUrl: string): URL {
  const clean = baseUrl.replace(/\/+$/, '');
  return new URL(clean.endsWith('/messages') ? clean : clean + '/messages');
}

function providerDisplayName(cfg: any): string {
  if (cfg.providerGroup && cfg.providerVariant && cfg.providerGroup !== cfg.providerVariant) {
    return `${cfg.providerGroup} / ${cfg.providerVariant}`;
  }
  return cfg.providerName || cfg.provider || 'Unknown provider';
}

function printBanner(): void {
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

function printProxyStatus(cfg: any) {
  console.log('\n  ' + G + '\u2713  Proxy on port ' + (cfg.port || 8080) + R);
  console.log('  ' + B + 'Provider:' + R + ' ' + providerDisplayName(cfg));
  console.log('  ' + B + 'Model:' + R + '    ' + (cfg.bigModel || 'unknown'));
  console.log('  ' + B + 'Endpoint:' + R + ' ' + (cfg.targetBaseUrl || 'unknown') + '\n');
  console.log('  ' + B + 'Claude Code:' + R + '  ' + K + 'ANTHROPIC_BASE_URL=http://localhost:' + (cfg.port || 8080) + ' ANTHROPIC_API_KEY=dummy' + R + '\n');
}

async function promptApiKey(provider: ProviderDef): Promise<string> {
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

async function configureProvider(): Promise<any> {
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
      process.stdout.write(C);
      const vi = await menu(group.providers.map(p => ({
        label: providerVariantName(p),
        note: p.notes || p.baseUrl,
      })), `${group.name}:`, 0, { back: true });
      if (vi === -1) { process.stdout.write(C); continue; }
      provider = group.providers[vi];
    }

    process.stdout.write(C);
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
      if (mi === -1) { process.stdout.write(C); continue; }
      model = provider.models[mi];
      process.stdout.write(C);
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

function launchClaude(cfg: any) {
  const port = cfg.port || 8080;
  const isAnthropic = (cfg.targetBaseUrl || "").includes("anthropic.com");
  const key = isAnthropic ? cfg.targetApiKey : "dummy";
  const envStr = "ANTHROPIC_BASE_URL=http://localhost:" + port + " ANTHROPIC_API_KEY=" + key;
  try {
    require("child_process").execSync("which konsole 2>/dev/null", { stdio: "ignore" });
    require("child_process").spawn("konsole", ["--hold", "-e", "env", envStr, "claude"], { detached: true, stdio: "ignore" }).unref();
    console.log("\n  " + G + "Claude Code launched in new window." + R + "\n");
    return;
  } catch {}
  try {
    require("child_process").execSync("which x-terminal-emulator 2>/dev/null", { stdio: "ignore" });
    require("child_process").spawn("x-terminal-emulator", ["-e", "bash", "-c", "export " + envStr + "; claude"], { detached: true, stdio: "ignore" }).unref();
    console.log("\n  " + G + "Claude Code launched in new window." + R + "\n");
    return;
  } catch {}
  console.log("\n  " + Y + "Open another terminal and run:" + R);
  console.log("  " + K + envStr + " claude" + R + "\n");
}

function startProxy(cfg: any): Promise<void> {
  return new Promise(resolve => {
    const pd = PROVIDERS.find(p => p.id === cfg.provider);
    const ak = cfg.targetApiKey || process.env[pd?.keyEnvVar || ''] || '';
    const srv = http.createServer(async (req, res) => {
      if (req.method !== 'POST' || req.url !== '/v1/messages') { res.writeHead(404); res.end(''); return; }
      try {
        const chunks: Buffer[] = [];
        req.on('data', (b: Buffer) => chunks.push(b));
        req.on('end', async () => {
          const rawBody = Buffer.concat(chunks).toString();
          const body = JSON.parse(rawBody) as AnthropicRequest;
          const tm = cfg.bigModel || 'deepseek-chat';
          const adapter = cfg.adapter || pd?.adapter || 'openai';
          const tu = adapter === 'anthropic'
            ? anthropicMessagesUrl(cfg.targetBaseUrl)
            : chatCompletionsUrl(cfg.targetBaseUrl);
          const tr = tu.protocol === 'https:' ? https : http;

          if (adapter === 'anthropic') {
            const anthropicBody = JSON.stringify({ ...body, model: tm });
            const pr = tr.request({
              hostname: tu.hostname, port: tu.port || (tu.protocol === 'https:' ? 443 : 80),
              path: tu.pathname + (tu.search || ''), method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': ak,
                'anthropic-version': req.headers['anthropic-version'] || '2023-06-01',
                'Content-Length': Buffer.byteLength(anthropicBody).toString(),
              },
            }, (pr2) => {
              res.writeHead(pr2.statusCode || 502, {
                'Content-Type': pr2.headers['content-type'] || (body.stream ? 'text/event-stream' : 'application/json'),
                'Cache-Control': pr2.headers['cache-control'] || 'no-cache',
              });
              pr2.pipe(res);
            });
            pr.on('error', () => { if (!res.headersSent) { res.writeHead(502); res.end('{}'); } });
            pr.write(anthropicBody); pr.end();
            return;
          }

          let oai = translateToOpenAI(body, tm);
          oai.messages = mergeAssistantMessages(oai.messages);
          if (body.stream) { oai.stream = true; oai.stream_options = { include_usage: true }; }
          const rb = JSON.stringify(oai);
          const pr = tr.request({
            hostname: tu.hostname, port: tu.port || (tu.protocol === 'https:' ? 443 : 80),
            path: tu.pathname + (tu.search || ''), method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ak, 'Content-Length': Buffer.byteLength(rb).toString() },
          }, (pr2) => {
            if (body.stream) {
              if (pr2.statusCode !== 200) { let d = ''; pr2.on('data', (b: Buffer) => d += b.toString()); pr2.on('end', () => { res.writeHead(502); res.end(d); }); return; }
              res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
              reverseStream(pr2, (ev, d) => res.write('event: ' + ev + '\ndata: ' + d + '\n\n'), tm).catch(() => {}).finally(() => { try { res.end(); } catch {} });
            } else {
              let d = ''; pr2.on('data', (b: Buffer) => d += b.toString()); pr2.on('end', () => {
                try { const o = JSON.parse(d); if (o.error) { res.writeHead(502); res.end(JSON.stringify(o.error)); return; } res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(reverseNonStreaming(o, tm))); }
                catch { res.writeHead(502); res.end(d); }
              });
            }
          });
          pr.on('error', () => { if (!res.headersSent) { res.writeHead(502); res.end('{}'); } });
          pr.write(rb); pr.end();
        });
      } catch { if (!res.headersSent) { res.writeHead(500); res.end('{}'); } }
    });
    srv.listen(cfg.port || 8080, () => resolve());
  });
}

async function main() {
  const saved = load();
  process.stdout.write(C);

  if (saved.targetBaseUrl && saved.targetApiKey) {
    printBanner();
    console.log('  ' + B + providerDisplayName(saved) + R + ' ' + K + (saved.bigModel || '') + R);
    console.log('');

    const i = await menu([
      { label: '\u25b6  Start Claude Code', note: 'uses saved API key' },
      { label: '\u25c7  Change provider / API key', note: '' },
      { label: '\u2715  Quit', note: '' },
    ], 'What now?');

    process.stdout.write(C);

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
    save(config);
    process.stdout.write(C);
    console.log('\n  ' + G + '\u2713  Configured' + R + '  ' + B + providerDisplayName(config) + R + '  ' + config.bigModel + '\n');

    const si = await menu([{ label: '\u25b6  Start Claude Code now', note: '' }, { label: '\u2715  Quit', note: '' }], 'Ready?', 0, { back: true });
    process.stdout.write(C);
    if (si === -1) { continue; }

    if (si === 0) {
      const cfg = load();
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
