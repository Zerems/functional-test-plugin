import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = path.join(path.dirname(new URL(import.meta.url).pathname), 'session.mjs');
const example = JSON.parse(fs.readFileSync(new URL('../templates/config.example.json', import.meta.url), 'utf8'));
const HOST = 'https://bo-testing.example.com';

function run(cwd, args) {
  const result = spawnSync('node', [SCRIPT, ...args], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH, CI: 'true' } });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Temp host whose `bo` session runs `boCommand` (default: write a valid state file via write-state.mjs). */
function makeHost({ boCommand, language = 'en' } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ft-session-')));
  fs.mkdirSync(path.join(dir, '.claude', 'functional-test'), { recursive: true });
  // Records the origin it was asked for and the variables it received, then writes a state for that host.
  fs.writeFileSync(
    path.join(dir, 'write-state.mjs'),
    `import fs from 'node:fs';
fs.mkdirSync('.auth', { recursive: true });
fs.writeFileSync('.auth/bo.json', JSON.stringify({ cookies: [{ domain: 'bo-testing.example.com', expires: -1, value: 'SECRET-COOKIE' }], origins: [] }));
fs.writeFileSync('seen.json', JSON.stringify({ ci: 'CI' in process.env, env: process.env.FT_ENV, bo: process.env.FT_BO_URL }));
`,
  );
  fs.writeFileSync(path.join(dir, 'fail.mjs'), 'console.log("setup stdout line"); process.exit(3);\n');
  const config = structuredClone(example);
  config.language = language;
  config.sessions.bo.command = boCommand ?? `node ${path.join(dir, 'write-state.mjs')}`;
  fs.writeFileSync(path.join(dir, '.claude', 'functional-test', 'config.json'), JSON.stringify(config));
  return { dir, state: path.join(dir, '.auth', 'bo.json'), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const parse = (stdout) => JSON.parse(stdout.trim());

test('session.mjs persistent-profile creates the profile folder and reports valid', () => {
  const host = makeHost();
  try {
    const result = run(host.dir, ['--env', 'testing', '--session', 'front']);
    assert.equal(result.code, 0, result.stderr);
    const out = parse(result.stdout);
    const dir = path.join(host.dir, '.auth', 'profiles', 'front');
    assert.deepEqual(out, {
      state: 'valid',
      mode: 'persistent-profile',
      mcpServer: 'playwright',
      host: 'https://app-testing.example.com',
      profileDir: dir,
      setupRan: false,
    });
    assert.ok(fs.statSync(dir).isDirectory());
    assert.equal(run(host.dir, ['--env', 'testing', '--session', 'front']).code, 0, 'idempotent');
  } finally {
    host.cleanup();
  }
});

test('session.mjs reports an external session without touching anything', () => {
  const host = makeHost();
  try {
    const configPath = path.join(host.dir, '.claude', 'functional-test', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config.sessions.front.mode = 'external';
    fs.writeFileSync(configPath, JSON.stringify(config));
    const result = run(host.dir, ['--env', 'testing', '--session', 'front']);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(parse(result.stdout), {
      state: 'external',
      mode: 'external',
      mcpServer: 'playwright',
      host: 'https://app-testing.example.com',
      setupRan: false,
    });
    assert.equal(fs.existsSync(path.join(host.dir, '.auth')), false);
  } finally {
    host.cleanup();
  }
});

test('session.mjs storage-state runs the setup command when the file is absent, then reports valid', () => {
  const host = makeHost();
  try {
    const result = run(host.dir, ['--env', 'testing', '--session', 'bo']);
    assert.equal(result.code, 0, result.stderr);
    const out = parse(result.stdout);
    assert.deepEqual(out, {
      state: 'valid',
      mode: 'storage-state',
      mcpServer: 'playwright-bo',
      host: HOST,
      file: host.state,
      setupRan: true,
    });
    assert.match(result.stderr, /no session file/);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(host.dir, 'seen.json'), 'utf8')), { ci: false, env: 'testing', bo: HOST });
    assert.equal(result.stdout.includes('SECRET-COOKIE'), false);
    assert.equal(result.stderr.includes('SECRET-COOKIE'), false);
  } finally {
    host.cleanup();
  }
});

test('session.mjs storage-state does not rerun a valid session unless --force', () => {
  const host = makeHost();
  try {
    assert.equal(run(host.dir, ['--env', 'testing', '--session', 'bo']).code, 0);
    fs.rmSync(path.join(host.dir, 'seen.json'));
    const again = run(host.dir, ['--env', 'testing', '--session', 'bo']);
    assert.equal(parse(again.stdout).setupRan, false);
    assert.equal(fs.existsSync(path.join(host.dir, 'seen.json')), false);
    const forced = run(host.dir, ['--env', 'testing', '--session', 'bo', '--force']);
    assert.equal(forced.code, 0, forced.stderr);
    assert.equal(parse(forced.stdout).setupRan, true);
    assert.match(forced.stderr, /forced/);
    assert.ok(fs.existsSync(path.join(host.dir, 'seen.json')));
  } finally {
    host.cleanup();
  }
});

test('session.mjs storage-state reruns a session recorded for another host and says why', () => {
  const host = makeHost();
  try {
    fs.mkdirSync(path.dirname(host.state), { recursive: true });
    fs.writeFileSync(host.state, JSON.stringify({ cookies: [{ domain: 'bo-demo.example.com', value: 'OTHER-SECRET' }], origins: [] }));
    const result = run(host.dir, ['--env', 'testing', '--session', 'bo']);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stderr, /recorded for bo-demo\.example\.com, not for https:\/\/bo-testing\.example\.com/);
    assert.equal(result.stderr.includes('OTHER-SECRET'), false);
  } finally {
    host.cleanup();
  }
});

test('session.mjs storage-state treats an unreadable file as invalid', () => {
  const host = makeHost({ boCommand: 'node fail.mjs' });
  try {
    fs.mkdirSync(path.dirname(host.state), { recursive: true });
    fs.writeFileSync(host.state, '{"cookies": [ SECRET-PARTIAL');
    const result = run(host.dir, ['--env', 'testing', '--session', 'bo']);
    assert.equal(result.code, 1);
    assert.match(parse(result.stdout).reason, /unreadable/);
    assert.equal(parse(result.stdout).reasonCode, 'unreadable');
    assert.equal(result.stdout.includes('SECRET-PARTIAL'), false);
    assert.equal(result.stderr.includes('SECRET-PARTIAL'), false);
  } finally {
    host.cleanup();
  }
});

test('session.mjs storage-state exits 1 with a reason when the setup command fails', () => {
  const host = makeHost({ boCommand: 'node fail.mjs' });
  try {
    const result = run(host.dir, ['--env', 'testing', '--session', 'bo']);
    assert.equal(result.code, 1);
    assert.deepEqual(parse(result.stdout), {
      state: 'invalid',
      mode: 'storage-state',
      mcpServer: 'playwright-bo',
      host: HOST,
      file: host.state,
      setupRan: true,
      reason: 'no session file',
      reasonCode: 'absent',
    });
    assert.match(result.stderr, /setup command did not complete: 3/);
    assert.match(result.stderr, /setup stdout line/); // the command's stdout is forwarded to stderr, stdout stays one JSON line
    assert.equal(result.stdout.trim().split('\n').length, 1);
  } finally {
    host.cleanup();
  }
});

test('session.mjs reports a setup command that cannot start', () => {
  const host = makeHost({ boCommand: 'definitely-not-a-command-ft' });
  try {
    const result = run(host.dir, ['--env', 'testing', '--session', 'bo']);
    assert.equal(result.code, 1);
    assert.equal(parse(result.stdout).setupRan, true);
    assert.match(result.stderr, /ENOENT/);
  } finally {
    host.cleanup();
  }
});

test('session.mjs messages follow the configured language', () => {
  const host = makeHost({ language: 'fr', boCommand: 'node fail.mjs' });
  try {
    const result = run(host.dir, ['--env', 'testing', '--session', 'bo']);
    assert.equal(parse(result.stdout).reason, 'aucun fichier de session');
    assert.match(result.stderr, /rejeu de sa commande de setup/);
  } finally {
    host.cleanup();
  }
});

test('session.mjs usage and configuration errors exit 2', () => {
  const host = makeHost();
  try {
    assert.equal(run(host.dir, []).code, 2);
    assert.equal(run(host.dir, ['--env', 'testing']).code, 2);
    assert.equal(run(host.dir, ['--session', 'bo']).code, 2);
    assert.equal(run(host.dir, ['--env', 'testing', '--session', 'bo', '--nope']).code, 2);
    const unknownEnv = run(host.dir, ['--env', 'nope', '--session', 'bo']);
    assert.equal(unknownEnv.code, 2);
    assert.match(unknownEnv.stderr, /unknown environment: nope \(expected: testing, demo\)/);
    const unknownSession = run(host.dir, ['--env', 'testing', '--session', 'nope']);
    assert.equal(unknownSession.code, 2);
    assert.match(unknownSession.stderr, /nope/);
    assert.equal(unknownSession.stdout, '');
  } finally {
    host.cleanup();
  }
});

test('session.mjs exits 2 outside a host project', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ft-session-nohost-')));
  try {
    const result = run(dir, ['--env', 'testing', '--session', 'bo']);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /no host project found/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
