// ─────────────────────────────────────────────────────────────────────────────
// Aura Enables — tests for CLI argument parser and session resuming
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCliArgs } from '../cli.js';

describe('parseCliArgs', () => {
  it('returns menu mode when no arguments are passed', () => {
    const res = parseCliArgs([]);
    assert.equal(res.mode, 'menu');
    assert.deepEqual(res.claudeArgs, []);
  });

  it('detects --help and -h flags', () => {
    assert.equal(parseCliArgs(['--help']).mode, 'help');
    assert.equal(parseCliArgs(['-h']).mode, 'help');
  });

  it('detects --version and -v flags', () => {
    assert.equal(parseCliArgs(['--version']).mode, 'version');
    assert.equal(parseCliArgs(['-v']).mode, 'version');
  });

  it('detects --setup and --config flags', () => {
    assert.equal(parseCliArgs(['--setup']).mode, 'setup');
    assert.equal(parseCliArgs(['--config']).mode, 'setup');
  });

  it('parses --resume with explicit session ID', () => {
    const res = parseCliArgs(['--resume', 'f46bd1a5-bd3d-4ac7-87ca-8365ae6f978b']);
    assert.equal(res.mode, 'run');
    assert.deepEqual(res.claudeArgs, ['--resume', 'f46bd1a5-bd3d-4ac7-87ca-8365ae6f978b']);
  });

  it('parses -r shorthand with explicit session ID', () => {
    const res = parseCliArgs(['-r', 'f46bd1a5-bd3d-4ac7-87ca-8365ae6f978b']);
    assert.equal(res.mode, 'run');
    assert.deepEqual(res.claudeArgs, ['--resume', 'f46bd1a5-bd3d-4ac7-87ca-8365ae6f978b']);
  });

  it('parses --resume=<id> format', () => {
    const res = parseCliArgs(['--resume=f46bd1a5-bd3d-4ac7-87ca-8365ae6f978b']);
    assert.equal(res.mode, 'run');
    assert.deepEqual(res.claudeArgs, ['--resume', 'f46bd1a5-bd3d-4ac7-87ca-8365ae6f978b']);
  });

  it('parses --resume without ID for interactive selector in Claude Code', () => {
    const res = parseCliArgs(['--resume']);
    assert.equal(res.mode, 'run');
    assert.deepEqual(res.claudeArgs, ['--resume']);
  });

  it('parses --continue and -c to continue last session', () => {
    assert.deepEqual(parseCliArgs(['--continue']).claudeArgs, ['--continue']);
    assert.deepEqual(parseCliArgs(['-c']).claudeArgs, ['--continue']);
  });

  it('forwards arbitrary Claude Code options and flags', () => {
    const res = parseCliArgs(['--verbose', '-p', 'write a function']);
    assert.equal(res.mode, 'run');
    assert.deepEqual(res.claudeArgs, ['--verbose', '-p', 'write a function']);
  });

  it('parses the status subcommand', () => {
    const res = parseCliArgs(['status']);
    assert.equal(res.mode, 'status');
    assert.deepEqual(res.claudeArgs, []);
  });

  it('parses the next subcommand', () => {
    assert.equal(parseCliArgs(['next']).mode, 'next');
  });

  it('parses switch with a provider id', () => {
    const res = parseCliArgs(['switch', 'groq']);
    assert.equal(res.mode, 'switch');
    assert.equal(res.controlArg, 'groq');
  });

  it('falls back to help when switch has no provider id', () => {
    assert.equal(parseCliArgs(['switch']).mode, 'help');
  });

  it('parses --no-failover without leaking it to claude args', () => {
    const res = parseCliArgs(['--no-failover', '-c']);
    assert.equal(res.mode, 'run');
    assert.equal(res.noFailover, true);
    assert.deepEqual(res.claudeArgs, ['--continue']);
  });

  it('parses --chain in both space and equals forms', () => {
    const a = parseCliArgs(['--chain', 'groq,openrouter,deepseek']);
    assert.equal(a.mode, 'run');
    assert.equal(a.chain, 'groq,openrouter,deepseek');
    assert.deepEqual(a.claudeArgs, []);

    const b = parseCliArgs(['--chain=groq,deepseek']);
    assert.equal(b.chain, 'groq,deepseek');
    assert.deepEqual(b.claudeArgs, []);
  });
});
