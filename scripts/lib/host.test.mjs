import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findHostRoot, hostPaths } from './host.mjs';

function tmp() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ft-host-')));
}

test('findHostRoot returns the directory holding .claude/functional-test/config.json from a nested cwd', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, '.claude', 'functional-test'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'functional-test', 'config.json'), '{}');
  const nested = path.join(root, 'a', 'b', 'c');
  fs.mkdirSync(nested, { recursive: true });
  assert.equal(findHostRoot(nested), root);
  assert.equal(findHostRoot(root), root);
});

test('findHostRoot returns null when no ancestor has the config', () => {
  const root = tmp();
  const nested = path.join(root, 'x', 'y');
  fs.mkdirSync(nested, { recursive: true });
  assert.equal(findHostRoot(nested), null);
});

test('hostPaths builds the expected absolute paths', () => {
  const root = path.resolve('/some/host');
  const p = hostPaths(root);
  assert.equal(p.root, root);
  assert.equal(p.configDir, path.join(root, '.claude', 'functional-test'));
  assert.ok(p.config.endsWith(path.join('.claude', 'functional-test', 'config.json')));
  assert.ok(p.pitfallsDefault.endsWith(path.join('functional-test', 'pitfalls.md')));
  assert.ok(p.excludedDefault.endsWith(path.join('functional-test', 'excluded.json')));
  assert.ok(p.mcp.endsWith('.mcp.json'));
  assert.ok(p.authDir.endsWith('.auth'));
  assert.equal(p.env, path.join(root, '.env'));
  assert.equal(p.envExample, path.join(root, '.env.example'));
  assert.equal(p.gitignore, path.join(root, '.gitignore'));
  for (const v of Object.values(p)) assert.ok(path.isAbsolute(v));
});
