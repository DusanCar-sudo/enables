// ─────────────────────────────────────────────────────────────────────────────
// Aura Enables — port scanner & free port generator
// ─────────────────────────────────────────────────────────────────────────────

import * as net from 'net';

/**
 * Checks whether a TCP port is available on localhost (127.0.0.1).
 */
export function isPortAvailable(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => {
      resolve(false);
    });
    server.once('listening', () => {
      server.once('close', () => resolve(true)).close();
    });
    server.listen(port, host);
  });
}

/**
 * Async generator that yields available TCP ports starting from `startPort`.
 */
export async function* freePortGenerator(startPort = 8080, maxAttempts = 100): AsyncGenerator<number, void, unknown> {
  const endPort = Math.min(startPort + maxAttempts, 65535);
  for (let port = startPort; port <= endPort; port++) {
    if (await isPortAvailable(port)) {
      yield port;
    }
  }
}

/**
 * Finds the first available TCP port starting at `preferredPort`.
 */
export async function findAvailablePort(preferredPort = 8080, maxAttempts = 100): Promise<number> {
  for await (const port of freePortGenerator(preferredPort, maxAttempts)) {
    return port;
  }
  throw new Error(`No free port found in range ${preferredPort}–${preferredPort + maxAttempts}`);
}
