import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = path.join(path.dirname(new URL(import.meta.url).pathname), 'preflight.mjs');

function run(cwd, args = []) {
  const result = spawnSync('node', [SCRIPT, ...args], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH } });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Temp host: file tracker, one environment, no network; `extra` is merged into the config. */
function makeHost(extra = {}, files = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ft-preflight-')));
  fs.mkdirSync(path.join(dir, '.claude', 'functional-test'), { recursive: true });
  const config = {
    version: 1,
    language: 'en',
    tracker: { type: 'file' },
    environments: { local: { branch: 'main', channels: { front: { url: 'http://localhost:3000' } } } },
    delivery: { mode: 'none' },
    ...extra,
  };
  fs.writeFileSync(path.join(dir, '.claude', 'functional-test', 'config.json'), JSON.stringify(config));
  fs.writeFileSync(path.join(dir, '.gitignore'), '.env\n.auth/\n');
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('preflight.mjs is ready on a host with a file tracker and no session', () => {
  const host = makeHost();
  try {
    const result = run(host.dir, ['--env', 'local']);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /^OK — configuration valid$/m);
    assert.match(result.stdout, /^--- ready$/m);
    assert.equal(run(host.dir).code, 0, 'the first environment is the default');
  } finally {
    host.cleanup();
  }
});

test('preflight.mjs is blocked and names an MCP server missing from .mcp.json', () => {
  const host = makeHost(
    { sessions: { front: { mode: 'external', mcpServer: 'my-browser' } }, environments: { local: { branch: 'main', channels: { front: { url: 'http://localhost:3000', session: 'front' } } } } },
    { '.mcp.json': JSON.stringify({ mcpServers: {} }) },
  );
  try {
    const result = run(host.dir, ['--env', 'local']);
    assert.equal(result.code, 1);
    assert.match(result.stdout, /^KO — MCP server "my-browser" missing from \.mcp\.json$/m);
    assert.match(result.stdout, /^--- blocked$/m);
  } finally {
    host.cleanup();
  }
});

test('preflight.mjs reports a missing required variable by name, never a value, and skips the login', () => {
  const host = makeHost({
    auth: { agency: { preset: 'password-login', loginPath: '/login', usernameEnv: 'API_USER', passwordEnv: 'API_PASS' } },
    environments: { local: { branch: 'main', channels: { api: { url: 'http://127.0.0.1:9', auth: 'agency' } } } },
  }, { '.env': 'API_USER=someone\n' });
  try {
    const result = run(host.dir, ['--env', 'local']);
    assert.equal(result.code, 1);
    assert.match(result.stdout, /^KO — required variables missing from \.env: API_PASS$/m);
    assert.doesNotMatch(result.stdout, /someone/);
    assert.doesNotMatch(result.stdout, /authentication/, 'no login attempted without the variables');
  } finally {
    host.cleanup();
  }
});

test('preflight.mjs prints a KO line when the login cannot reach the server', () => {
  const host = makeHost({
    auth: { agency: { preset: 'password-login', loginPath: '/login', usernameEnv: 'API_USER', passwordEnv: 'API_PASS' } },
    environments: { local: { branch: 'main', channels: { api: { url: 'http://127.0.0.1:9', auth: 'agency' } } } },
  }, { '.env': 'API_USER=someone\nAPI_PASS=hunter2-secret\n' });
  try {
    const result = run(host.dir, ['--env', 'local']);
    assert.equal(result.code, 1);
    assert.match(result.stdout, /^KO — authentication "agency" refused on local: /m);
    assert.doesNotMatch(result.stdout, /hunter2-secret/);
  } finally {
    host.cleanup();
  }
});

test('preflight.mjs exits 2 without a host project and on an unknown environment', () => {
  const empty = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ft-preflight-empty-')));
  const host = makeHost();
  try {
    const none = run(empty);
    assert.equal(none.code, 2);
    assert.match(none.stdout, /no host project found/);
    const unknown = run(host.dir, ['--env', 'nowhere']);
    assert.equal(unknown.code, 2);
    assert.match(unknown.stderr, /unknown environment: nowhere \(expected: local\)/);
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
    host.cleanup();
  }
});

test('preflight.mjs reports an invalid configuration as one KO line, in the configured language', () => {
  const host = makeHost({ language: 'fr', tracker: { type: 'nope' } });
  try {
    const result = run(host.dir);
    assert.equal(result.code, 1);
    assert.match(result.stdout, /^KO — configuration invalide : tracker\.type/m);
    assert.match(result.stdout, /^--- bloqué$/m);
  } finally {
    host.cleanup();
  }
});
