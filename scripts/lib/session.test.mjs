import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ConfigError } from './config.mjs';
import { profileDir, sessionPlan, setupCommand, validateStorageState } from './session.mjs';

const now = new Date('2026-10-23T12:00:00Z');
const recent = new Date('2026-10-23T11:00:00Z');
const HOST = 'https://app-testing.example.com';
const state = (origin) => ({ cookies: [], origins: [{ origin, localStorage: [] }] });

test('validateStorageState: absent state', () => {
  assert.deepEqual(validateStorageState(null, HOST, now, recent), { valid: false, reason: 'absent' });
});

test('validateStorageState: recorded for another host', () => {
  const result = validateStorageState(state('https://app-demo.example.com'), HOST, now, recent);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'wrong-host');
  assert.deepEqual(result.known, ['https://app-demo.example.com']);
  assert.equal(result.host, HOST);
});

test('validateStorageState: nothing recorded at all lists no known host', () => {
  const result = validateStorageState({ cookies: [], origins: [] }, HOST, now, recent);
  assert.deepEqual([result.reason, result.known], ['wrong-host', []]);
});

test('validateStorageState: too old (default 8 h, configurable)', () => {
  const old = new Date('2026-10-23T02:00:00Z');
  assert.deepEqual(validateStorageState(state(HOST), HOST, now, old), { valid: false, reason: 'too-old', hours: 8 });
  assert.equal(validateStorageState(state(HOST), HOST, now, old, 12).valid, true);
  assert.deepEqual(validateStorageState(state(HOST), HOST, now, recent, 0.5), { valid: false, reason: 'too-old', hours: 0.5 });
});

test('validateStorageState: valid', () => {
  assert.deepEqual(validateStorageState(state(HOST), HOST, now, recent), { valid: true, reason: '' });
});

test('validateStorageState: a cookie bound to the host is enough, without recorded origin', () => {
  const bo = { cookies: [{ domain: 'bo-demo.example.com', expires: -1 }, { domain: 'bo-demo.example.com', expires: 1792000000 }], origins: [] };
  assert.deepEqual(validateStorageState(bo, 'https://bo-demo.example.com', now, recent), { valid: true, reason: '' });
  const other = validateStorageState(bo, 'https://bo-testing.example.com', now, recent);
  assert.equal(other.valid, false);
  assert.equal(other.reason, 'wrong-host');
  assert.deepEqual(other.known, ['bo-demo.example.com']);
});

test('validateStorageState: a parent-domain cookie does not identify the environment', () => {
  const front = { cookies: [{ domain: '.example.com', expires: 1792000000 }], origins: [] };
  assert.equal(validateStorageState(front, HOST, now, recent).valid, false);
});

test('validateStorageState: host cookies all expired → invalid', () => {
  const bo = { cookies: [{ domain: 'bo-demo.example.com', expires: 1 }], origins: [] };
  assert.deepEqual(validateStorageState(bo, 'https://bo-demo.example.com', now, recent), { valid: false, reason: 'cookies-expired' });
});

test('profileDir path', () => {
  assert.equal(profileDir('/work/host', 'front'), path.join('/work/host', '.auth', 'profiles', 'front'));
});

test('profileDir sanitises the session name', () => {
  assert.equal(profileDir('/work/host', '../../etc/pa ss'), path.join('/work/host', '.auth', 'profiles', '.._.._etc_pa_ss'));
  assert.equal(path.dirname(profileDir('/work/host', '../x')), path.join('/work/host', '.auth', 'profiles'));
});

const config = {
  environments: {
    testing: {
      branch: 'testing',
      channels: {
        api: { url: 'https://api-testing.example.com', auth: 'agency' },
        front: { url: 'https://app-testing.example.com/login?x=1', session: 'front' },
        'front-b': { url: 'https://other-testing.example.com', session: 'front' },
        bo: { url: 'https://bo-testing.example.com', session: 'bo' },
      },
    },
    empty: { branch: 'x', channels: { api: { url: 'https://api.example.com' } } },
  },
  sessions: {
    front: { mode: 'persistent-profile', mcpServer: 'playwright' },
    bo: { mode: 'storage-state', mcpServer: 'playwright-bo', file: '.auth/bo.json', command: 'npx playwright test --project=bo-auth-setup' },
    ext: { mode: 'external', mcpServer: 'chrome' },
  },
};

test('sessionPlan resolves mcpServer, mode and host from config', () => {
  assert.deepEqual(sessionPlan(config, 'testing', 'front'), {
    mode: 'persistent-profile',
    mcpServer: 'playwright',
    host: 'https://app-testing.example.com',
  });
  assert.deepEqual(sessionPlan(config, 'testing', 'bo'), {
    mode: 'storage-state',
    mcpServer: 'playwright-bo',
    host: 'https://bo-testing.example.com',
    file: '.auth/bo.json',
    command: 'npx playwright test --project=bo-auth-setup',
  });
});

test('sessionPlan rejects an unknown environment, an unknown session or a session no channel uses', () => {
  assert.throws(() => sessionPlan(config, 'nope', 'front'), ConfigError);
  assert.throws(() => sessionPlan(config, 'testing', 'nope'), ConfigError);
  assert.throws(() => sessionPlan(config, 'testing', 'ext'), (error) => error instanceof ConfigError && /ext/.test(error.message));
  assert.throws(() => sessionPlan(config, 'empty', 'front'), ConfigError);
});

test('setupCommand exports channel URLs and drops CI', () => {
  const plan = sessionPlan(config, 'testing', 'bo');
  const urls = { api: 'https://api-testing.example.com', 'front-b': 'https://other-testing.example.com' };
  const { command, args, env } = setupCommand(plan, urls, 'testing', { PATH: '/bin', CI: 'true', KEEP: '1' });
  assert.equal(command, 'npx');
  assert.deepEqual(args, ['playwright', 'test', '--project=bo-auth-setup']);
  assert.equal(env.FT_API_URL, 'https://api-testing.example.com');
  assert.equal(env.FT_FRONT_B_URL, 'https://other-testing.example.com');
  assert.equal(env.FT_ENV, 'testing');
  assert.equal(env.KEEP, '1');
  assert.equal('CI' in env, false);
});

test('setupCommand splits on any whitespace and defaults to process.env', () => {
  const { command, args, env } = setupCommand({ command: '  node   a.mjs\t--x ' }, {}, 'e');
  assert.equal(command, 'node');
  assert.deepEqual(args, ['a.mjs', '--x']);
  assert.equal('CI' in env, false);
  assert.equal(env.PATH, process.env.PATH);
});

test('setupCommand needs a command', () => {
  assert.throws(() => setupCommand({ mode: 'storage-state' }, {}, 'e'), ConfigError);
});

test('module has no file-system dependency', () => {
  assert.equal(/node:fs|node:child_process/.test(fs.readFileSync(new URL('./session.mjs', import.meta.url), 'utf8')), false);
});
