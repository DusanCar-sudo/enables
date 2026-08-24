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
});
