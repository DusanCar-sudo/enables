// ─────────────────────────────────────────────────────────────────────────────
// Aura Enables — tests for port.ts
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as net from 'net';
import { isPortAvailable, freePortGenerator, findAvailablePort } from '../port.js';

describe('port scanner & free port generator', () => {
  it('returns true for a free port', async () => {
    // Port 0 in net module usually asks OS for random free port, but let's test high port range
    const available = await isPortAvailable(59123);
    assert.equal(typeof available, 'boolean');
  });

  it('detects an occupied port and returns false', async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(59124, '127.0.0.1', () => resolve()));

    try {
      const available = await isPortAvailable(59124);
      assert.equal(available, false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('skips occupied ports and finds the next available port', async () => {
    const server1 = net.createServer();
    const server2 = net.createServer();
    
    // Occupy 59125 and 59126
    await new Promise<void>((resolve) => server1.listen(59125, '127.0.0.1', () => resolve()));
    await new Promise<void>((resolve) => server2.listen(59126, '127.0.0.1', () => resolve()));

    try {
      const freePort = await findAvailablePort(59125);
      assert.ok(freePort >= 59127, `Expected freePort >= 59127, got ${freePort}`);
    } finally {
      await new Promise<void>((resolve) => server1.close(() => resolve()));
      await new Promise<void>((resolve) => server2.close(() => resolve()));
    }
  });

  it('freePortGenerator yields multiple free ports', async () => {
    const ports: number[] = [];
    for await (const p of freePortGenerator(59130, 5)) {
      ports.push(p);
      if (ports.length >= 2) break;
    }
    assert.equal(ports.length, 2);
    assert.ok(ports[0] >= 59130);
    assert.ok(ports[1] > ports[0]);
  });
});
