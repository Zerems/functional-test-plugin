import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cachesToken, call, parseApiArgs, readTokenCache, resolveApiChannel, tokenCachePath, tokenValid, writeTokenCache } from './api.mjs';
import { createAuth } from './auth/index.mjs';
import { UsageError } from './cli.mjs';
import { maskSecrets } from './secrets.mjs';
import { translator } from './i18n.mjs';
import { fakeFetch } from './test-helpers/fake-fetch.mjs';

const sha12 = (text) => createHash('sha256').update(text).digest('hex').slice(0, 12);

test('parseApiArgs reads flags and positionals', () => {
  assert.deepEqual(parseApiArgs(['--env', 'testing', 'get', '/v1/workers']), {
    env: 'testing',
    auth: null,
    channel: null,
    context: {},
    method: 'GET',
    path: '/v1/workers',
    body: null,
    raw: false,
    credentialsFile: null,
  });
  assert.deepEqual(
    parseApiArgs([
      '--env', 'demo', '--channel', 'api', '--auth', 'worker', '--header', 'X-Agency-Id=ag1', '--header', 'X-Eq=a=b',
      '--credentials', 'cred.json', '--raw', 'POST', '/v1/x', '--body', '{"a":1}',
    ]),
    {
      env: 'demo',
      auth: 'worker',
      channel: 'api',
      context: { 'X-Agency-Id': 'ag1', 'X-Eq': 'a=b' },
      method: 'POST',
      path: '/v1/x',
      body: '{"a":1}',
      raw: true,
      credentialsFile: 'cred.json',
    },
  );
  assert.equal(parseApiArgs(['--env', 'demo', 'POST', '/v1/x', '--body', '@/tmp/body.json']).body, '@/tmp/body.json');
});

test('parseApiArgs throws a UsageError for every malformed command line', () => {
  for (const argv of [
    ['GET', '/v1/workers'],
    ['--env', 'testing', 'GET', 'v1/workers'],
    ['--env', 'testing', 'GET'],
    ['--env', 'testing', 'GET', '/a', '/b'],
    ['--env', 'testing', '--header', 'NoEquals', 'GET', '/a'],
    ['--env', 'testing', '--header', '=v', 'GET', '/a'],
    ['--env', 'testing', '--unknown', 'GET', '/a'],
    ['--env'],
  ]) {
    assert.throws(() => parseApiArgs(argv, 'usage: api.mjs …'), (error) => error instanceof UsageError && error.message === 'usage: api.mjs …', argv.join(' '));
  }
  assert.throws(() => parseApiArgs(['GET', '/x']), /usage: api\.mjs/);
});

test('tokenValid keeps a 60 s margin', () => {
  const now = new Date('2026-10-23T10:00:00Z');
  assert.equal(tokenValid({ token: 't', expiresAt: '2026-10-23T10:00:30Z' }, now), false);
  assert.equal(tokenValid({ token: 't', expiresAt: '2026-10-23T10:05:00Z' }, now), true);
  assert.equal(tokenValid({ expiresAt: '2026-10-23T10:05:00Z' }, now), false);
  assert.equal(tokenValid({}, now), false);
  assert.equal(tokenValid(null, now), false);
});

test('tokenCachePath hashes the username', () => {
  assert.equal(tokenCachePath('/host', 'testing', 'api'), path.join('/host', '.auth', 'api-testing-api.json'));
  const withUser = tokenCachePath('/host', 'testing', 'api', 'a@b');
  assert.equal(withUser, path.join('/host', '.auth', `api-testing-api-${sha12('a@b')}.json`));
  assert.ok(!withUser.includes('a@b'));
  assert.notEqual(withUser, tokenCachePath('/host', 'testing', 'api', 'c@d'));
  assert.equal(tokenCachePath('/host', 'demo', '../evil/x'), path.join('/host', '.auth', 'api-demo-.._evil_x.json'));
});

test('the token cache round-trips with mode 0600 and tolerates a missing or corrupt file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-api-'));
  try {
    const file = path.join(dir, '.auth', 'api-x.json');
    assert.deepEqual(readTokenCache(file), {});
    writeTokenCache(file, { token: 't', expiresAt: '2030-01-01T00:00:00.000Z', extra: 1 });
    assert.deepEqual(readTokenCache(file), { token: 't', expiresAt: '2030-01-01T00:00:00.000Z' });
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    fs.writeFileSync(file, 'not json');
    assert.deepEqual(readTokenCache(file), {});
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const loginSection = { preset: 'password-login', loginPath: '/auth/login', usernameEnv: 'U', passwordEnv: 'P' };
const env = { U: 'collab', P: 'secret-pw' };
const isLogin = (url) => url.endsWith('/auth/login');

test('call logs in, then sends the request with the auth headers and context', async () => {
  const fetchImpl = fakeFetch([
    { match: isLogin, body: { access_token: 'jwt-1', expires_in: 300 } },
    { match: (url) => url.endsWith('/v1/workers?page=2'), body: { items: [] } },
  ]);
  const auth = await createAuth('api', { ...loginSection, headers: { 'X-Tenant': 'acme' } }, env, { fetchImpl });
  const cache = {};
  const result = await call({ apiUrl: 'https://api.example.test', auth, method: 'GET', path: '/v1/workers?page=2', context: { 'X-Agency-Id': 'ag1' }, cache, fetchImpl });

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { items: [] });
  assert.equal(typeof result.durationMs, 'number');
  assert.deepEqual(fetchImpl.calls.map((c) => c.url), ['https://api.example.test/auth/login', 'https://api.example.test/v1/workers?page=2']);
  const { init } = fetchImpl.calls[1];
  assert.equal(init.method, 'GET');
  assert.equal(init.headers.Authorization, 'Bearer jwt-1');
  assert.equal(init.headers['X-Tenant'], 'acme');
  assert.equal(init.headers['X-Agency-Id'], 'ag1');
  assert.equal(init.headers.Accept, 'application/json');
  assert.equal(init.headers['Content-Type'], undefined, 'no body, no Content-Type');
  assert.equal(init.body, undefined);
  assert.ok(init.signal instanceof AbortSignal);
  assert.equal(cache.token, 'jwt-1');
  assert.ok(tokenValid(cache));
});

test('call reuses a valid cached token without logging in and sends the body as JSON', async () => {
  const fetchImpl = fakeFetch([{ match: (url) => url.endsWith('/v1/x'), status: 201, body: { id: 'n1' } }]);
  const auth = await createAuth('api', loginSection, env, { fetchImpl });
  const cache = { token: 'cached', expiresAt: new Date(Date.now() + 3_600_000).toISOString() };
  const result = await call({ apiUrl: 'https://a.test', auth, method: 'POST', path: '/v1/x', body: '{"a":1}', cache, fetchImpl });
  assert.equal(result.status, 201);
  assert.equal(fetchImpl.calls.length, 1);
  const { init } = fetchImpl.calls[0];
  assert.equal(init.headers.Authorization, 'Bearer cached');
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.equal(init.body, '{"a":1}');
});

test('call re-authenticates once on 401', async () => {
  let logins = 0;
  let requests = 0;
  const fetchImpl = async (url) => {
    if (isLogin(String(url))) {
      logins += 1;
      return new Response(JSON.stringify({ access_token: `jwt-${logins}`, expires_in: 300 }), { status: 200 });
    }
    requests += 1;
    return new Response(null, { status: requests === 1 ? 401 : 204 });
  };
  const auth = await createAuth('api', loginSection, env, { fetchImpl });
  const cache = {};
  const result = await call({ apiUrl: 'https://a.test', auth, method: 'DELETE', path: '/v1/x', cache, fetchImpl });
  assert.equal(result.status, 204);
  assert.equal(result.body, null);
  assert.equal(logins, 2);
  assert.equal(requests, 2);
  assert.equal(cache.token, 'jwt-2');

  // A second 401 is returned as is: no endless loop.
  logins = 0;
  const always401 = async (url) =>
    isLogin(String(url)) ? new Response(JSON.stringify({ access_token: `jwt-${(logins += 1)}`, expires_in: 300 })) : new Response('denied', { status: 401 });
  const stubborn = await call({ apiUrl: 'https://a.test', auth, method: 'GET', path: '/v1/x', cache: {}, fetchImpl: always401 });
  assert.equal(stubborn.status, 401);
  assert.equal(stubborn.body, 'denied');
  assert.equal(logins, 2);
});

test('call returns a 5xx as is and keeps a text body as a string', async () => {
  const fetchImpl = fakeFetch([{ match: () => true, status: 503, body: 'Service unavailable' }]);
  const auth = await createAuth('open', { preset: 'none' }, {}, {});
  const result = await call({ apiUrl: 'https://a.test', auth, method: 'GET', path: '/v1/x', fetchImpl });
  assert.equal(result.status, 503);
  assert.equal(result.body, 'Service unavailable');
  assert.equal(fetchImpl.calls[0].init.headers.Authorization, undefined);
});

test('call passes explicit credentials to the login, and a login failure carries no secret', async () => {
  const fetchImpl = fakeFetch([
    { match: isLogin, body: { access_token: 'w', expires_in: 300 } },
    { match: () => true, body: {} },
  ]);
  const auth = await createAuth('api', loginSection, env, { fetchImpl });
  await call({ apiUrl: 'https://a.test', auth, method: 'GET', path: '/x', credentials: { username: 'w@e2e', password: 'pw' }, fetchImpl });
  assert.deepEqual(JSON.parse(fetchImpl.calls[0].init.body), { username: 'w@e2e', password: 'pw' });

  const refused = fakeFetch([{ match: () => true, status: 403, body: { echo: 'secret-pw' } }]);
  const refusing = await createAuth('api', loginSection, env, { fetchImpl: refused });
  await assert.rejects(call({ apiUrl: 'https://a.test', auth: refusing, method: 'GET', path: '/x', fetchImpl: refused }), (error) => {
    assert.ok(!error.message.includes('secret-pw'));
    return /login api refused \(403\)/.test(error.message);
  });
});

test('cachesToken is false for presets whose credential is read afresh from the environment', async () => {
  assert.equal(cachesToken(await createAuth('a', loginSection, env, {})), true);
  assert.equal(cachesToken(await createAuth('a', { preset: 'static-token', tokenEnv: 'T' }, {}, {})), false);
  assert.equal(cachesToken(await createAuth('a', { preset: 'none' }, {}, {})), false);
});

test('displayed bodies are masked with maskSecrets', () => {
  assert.deepEqual(maskSecrets({ id: '1', access_token: 'abc', nested: { password: 'x' }, list: [{ token: 't' }] }), {
    id: '1',
    access_token: '***',
    nested: { password: '***' },
    list: [{ token: '***' }],
  });
});

const channelsConfig = (channels, extra = {}) => ({
  auth: { main: loginSection, other: { preset: 'none' } },
  environments: { testing: { branch: 'main', channels } },
  ...extra,
});
const t = translator('en');

test('resolveApiChannel picks the only channel that declares an auth', () => {
  const config = channelsConfig({ web: { url: 'https://app.example.test' }, api: { url: 'https://api.example.test/', auth: 'main' } });
  assert.deepEqual(resolveApiChannel(config, 'testing', {}, t), { channelName: 'api', apiUrl: 'https://api.example.test', authName: 'main' });
  assert.deepEqual(resolveApiChannel(config, 'testing', { auth: 'other' }, t).authName, 'other');
});

test('resolveApiChannel needs --channel when several channels have an auth, and reports unusable choices', () => {
  const two = channelsConfig({ api: { url: 'https://a.test', auth: 'main' }, admin: { url: 'https://b.test', auth: 'other' } });
  assert.throws(() => resolveApiChannel(two, 'testing', {}, t), (error) => error instanceof UsageError && /several API channels.*api, admin.*--channel/.test(error.message));
  assert.deepEqual(resolveApiChannel(two, 'testing', { channel: 'admin' }, t), { channelName: 'admin', apiUrl: 'https://b.test', authName: 'other' });
  assert.throws(() => resolveApiChannel(two, 'testing', { channel: 'nope' }, t), /unknown channel: nope \(expected: api, admin\)/);

  const none = channelsConfig({ web: { url: 'https://app.test' } });
  assert.throws(() => resolveApiChannel(none, 'testing', {}, t), /no API channel/);
  assert.throws(() => resolveApiChannel(none, 'testing', { channel: 'web' }, t), /channel web declares no auth/);
  assert.equal(resolveApiChannel(none, 'testing', { channel: 'web', auth: 'main' }, t).authName, 'main');
  assert.throws(() => resolveApiChannel(two, 'testing', { channel: 'api', auth: 'ghost' }, t), /unknown auth: ghost \(expected: main, other\)/);
});
