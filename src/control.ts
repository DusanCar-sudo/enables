// ─────────────────────────────────────────────────────────────────────────────
// Aura Enables — control-plane client: `enables status / switch / next`
// Talks to the /__enables/* endpoints of a running proxy, discovered via
// ~/.enables-runtime.json (written by the proxy at startup).
// Zero deps — plain Node http.
// ─────────────────────────────────────────────────────────────────────────────

import * as http from 'http';
import { loadRuntime } from './config.js';
import { R, B, G, Y, K } from './cli.js';
import type { StatusPayload } from './failover.js';

export interface ControlResponse {
  status: number;
  json: any;
}

export function controlRequest(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  port?: number,
): Promise<ControlResponse> {
  const targetPort = port ?? resolveProxyPort();
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: targetPort,
      path,
      method,
      headers: { 'content-type': 'application/json' },
    }, (res) => {
      let d = '';
      res.on('data', (c: Buffer) => { d += c.toString(); });
      res.on('end', () => {
        let json: any = null;
        try { json = JSON.parse(d); } catch { /* non-JSON body */ }
        resolve({ status: res.statusCode || 0, json });
      });
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

/** Proxy port discovery: explicit > runtime file > 8080 default. */
export function resolveProxyPort(explicit?: number): number {
  if (explicit) return explicit;
  const rt = loadRuntime();
  if (rt?.port) return rt.port;
  return 8080;
}

export function printStatus(p: StatusPayload): void {
  console.log('');
  console.log('  ' + B + 'Enables proxy status' + R + '  ' + K + '(pid ' + p.pid + ', started ' + p.startedAt + ')' + R);
  console.log('  ' + G + '✓ Active provider: ' + p.activeProvider + (p.override ? K + ' (manually switched)' + R : R));
  console.log('  ' + B + 'Requests:' + R + ' ' + p.counters.requests + '   '
    + B + 'Failovers:' + R + ' ' + p.counters.failovers + '   '
    + B + 'Exhausted:' + R + ' ' + p.counters.exhausted);
  console.log('');
  console.log('  ' + B + 'Failover chain:' + R);
  for (const c of p.chain) {
    const active = c.id === p.activeProvider;
    const keyTag = c.keyAvailable ? K + c.keySource + R : Y + 'no key' + R;
    const stat = p.perProvider[c.id];
    const errs = stat?.failures ? Y + ` ${stat.failures} failed` + R : '';
    const marker = active ? G + '✓' + R : ' ';
    console.log('    ' + marker + ' ' + (active ? B + c.id + R : c.id)
      + '  ' + K + c.model + R + '  ' + keyTag + errs);
  }
  console.log('');
}

export function printProxyNotRunning(): void {
  console.log('\n  ' + Y + 'No running enables proxy found.' + R);
  console.log('  ' + K + 'Start one with: enables' + R + '\n');
}
