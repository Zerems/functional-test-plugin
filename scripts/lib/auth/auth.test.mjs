import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAuth } from './index.mjs';
import { MissingSecretError } from '../errors.mjs';
import { fakeFetch } from '../test-helpers/fake-fetch.mjs';

const loginSection = { preset: 'password-login', loginPath: '/v1/auth/login', usernameEnv: 'API_USER', passwordEnv: 'API_PASS' };
const env = { API_USER: 'collab@example.test', API_PASS: 'hunter2-secret' };
const sha12 = (text) => createHash('sha256').update(text).digest('hex').slice(0, 12);

test('password-login posts credentials and returns token with expiry', async () => {
  const fetchImpl = fakeFetch([{ match: (url) => url.endsWith('/v1/auth/login'), body: { access_token: 'tok-1', expires_in: 120 } }]);
  const auth = await createAuth('api', loginSection, env, { fetchImpl });
  const before = Date.now();
  const result = await auth.authenticate('https://api.example.test');

  assert.equal(result.token, 'tok-1');
  const expiresIn = new Date(result.expiresAt).getTime() - before;
  assert.ok(expiresIn >= 119_000 && expiresIn <= 121_000, `expiresAt ${result.expiresAt}`);
  assert.equal(fetchImpl.calls.length, 1);
  const [{ url, init }] = fetchImpl.calls;
  assert.equal(url, 'https://api.example.test/v1/auth/login');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.equal(init.headers.Accept, 'application/json');
  assert.deepEqual(JSON.parse(init.body), { username: 'collab@example.test', password: 'hunter2-secret' });
  assert.ok(init.signal instanceof AbortSignal);
});

test('password-login honours field names and default lifetime, and explicit credentials replace the env', async () => {
  const fetchImpl = fakeFetch([{ match: () => true, body: { jwt: 'tok-2' } }]);
  const section = { ...loginSection, usernameField: 'email', passwordField: 'pwd', tokenField: 'jwt', expiresField: 'ttl' };
  const auth = await createAuth('api', section, {}, { fetchImpl });
  const before = Date.now();
  const result = await auth.authenticate('https://api.example.test', { username: 'worker@e2e', password: 'pw' });
  assert.equal(result.token, 'tok-2');
  assert.deepEqual(JSON.parse(fetchImpl.calls[0].init.body), { email: 'worker@e2e', pwd: 'pw' });
  const lifetime = new Date(result.expiresAt).getTime() - before;
  assert.ok(lifetime >= 299_000 && lifetime <= 301_000, 'default lifetime is 300 s');
});

test('password-login names the missing variables and never calls the server', async () => {
  const fetchImpl = fakeFetch([]);
  const auth = await createAuth('api', loginSection, { API_USER: 'u' }, { fetchImpl });
  await assert.rejects(auth.authenticate('https://api.example.test'), (error) => {
    assert.ok(error instanceof MissingSecretError);
    assert.deepEqual(error.variables, ['API_PASS']);
    return true;
  });
  assert.equal(fetchImpl.calls.length, 0);
});

test('password-login error message never contains the password', async () => {
  const refused = fakeFetch([{ match: () => true, status: 401, body: { error: 'bad password hunter2-secret' } }]);
  const auth = await createAuth('api', loginSection, env, { fetchImpl: refused });
  await assert.rejects(auth.authenticate('https://api.example.test'), (error) => {
    assert.equal(error.message, 'login api refused (401)');
    assert.ok(!error.message.includes('hunter2-secret'));
    return true;
  });

  const notJson = fakeFetch([{ match: () => true, body: 'oops hunter2-secret <html>' }]);
  const invalid = await createAuth('api', loginSection, env, { fetchImpl: notJson });
  await assert.rejects(invalid.authenticate('https://api.example.test'), (error) => {
    assert.equal(error.message, 'login api: invalid response');
    assert.ok(!error.message.includes('hunter2-secret'));
    return true;
  });

  const noToken = fakeFetch([{ match: () => true, body: { hello: 'world' } }]);
  const other = await createAuth('api', loginSection, env, { fetchImpl: noToken });
  await assert.rejects(other.authenticate('https://api.example.test'), { message: 'login api: no token in response' });
});

test('password-login headers merge static headers and context, context winning', async () => {
  const auth = await createAuth('api', { ...loginSection, headers: { 'X-Tenant': 'acme', 'X-Agency-Id': 'default' } }, env, {});
  assert.deepEqual(auth.headers({ token: 'tok', context: { 'X-Agency-Id': 'ag-1' } }), {
    Authorization: 'Bearer tok',
    'X-Tenant': 'acme',
    'X-Agency-Id': 'ag-1',
  });
  assert.deepEqual(auth.headers({ token: 'tok' }), { Authorization: 'Bearer tok', 'X-Tenant': 'acme', 'X-Agency-Id': 'default' });
});

test('password-login cacheKey is the auth name, suffixed by a hash of the explicit username', async () => {
  const auth = await createAuth('api', loginSection, env, {});
  assert.equal(auth.cacheKey(), 'api');
  assert.equal(auth.cacheKey({ username: 'worker@e2e', password: 'pw' }), `api-${sha12('worker@e2e')}`);
  assert.ok(!auth.cacheKey({ username: 'worker@e2e', password: 'pw' }).includes('worker'));
});

test('static-token reads tokenEnv', async () => {
  const auth = await createAuth('svc', { preset: 'static-token', tokenEnv: 'SVC_TOKEN' }, { SVC_TOKEN: 'abc' }, {});
  assert.equal(auth.preset, 'static-token');
  const result = await auth.authenticate('https://api.example.test');
  assert.equal(result.token, 'abc');
  assert.equal(result.expiresAt, '9999-12-31T00:00:00.000Z');
  assert.deepEqual(auth.headers({ token: 'abc', context: { 'X-A': '1' } }), { Authorization: 'Bearer abc', 'X-A': '1' });
  assert.equal(auth.cacheKey(), 'svc');
});

test('static-token without its variable throws MissingSecretError; the scheme is configurable', async () => {
  const missing = await createAuth('svc', { preset: 'static-token', tokenEnv: 'SVC_TOKEN' }, {}, {});
  await assert.rejects(missing.authenticate('https://x'), (error) => error instanceof MissingSecretError && error.variables[0] === 'SVC_TOKEN');

  const token = await createAuth('svc', { preset: 'static-token', tokenEnv: 'T', scheme: 'Token' }, { T: 'abc' }, {});
  assert.deepEqual(token.headers({ token: 'abc' }), { Authorization: 'Token abc' });
  const raw = await createAuth('svc', { preset: 'static-token', tokenEnv: 'T', scheme: '' }, { T: 'abc' }, {});
  assert.deepEqual(raw.headers({ token: 'abc' }), { Authorization: 'abc' });
});

test('none sends no credentials, only static headers and context', async () => {
  const auth = await createAuth('open', { preset: 'none', headers: { 'X-Key': 'k' } }, {}, {});
  const result = await auth.authenticate('https://api.example.test');
  assert.equal(result.token, null);
  assert.equal(result.expiresAt, '9999-12-31T00:00:00.000Z');
  assert.deepEqual(auth.headers({ token: null, context: { 'X-A': '1' } }), { 'X-Key': 'k', 'X-A': '1' });
});

test('custom auth module is loaded', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ft-auth-')));
  try {
    fs.writeFileSync(
      path.join(root, 'my-auth.mjs'),
      `export default function (name, section, env, deps) {
        return {
          name,
          preset: 'custom',
          authenticate: async (apiUrl) => ({ token: apiUrl + '|' + env.SECRET + '|' + typeof deps.fetchImpl + '|' + deps.root, expiresAt: '2030-01-01T00:00:00.000Z' }),
          headers: ({ token }) => ({ 'X-Custom': token }),
          cacheKey: () => name + '-' + section.flavour,
        };
      }`,
    );
    const auth = await createAuth('mine', { preset: 'custom', module: './my-auth.mjs', flavour: 'v2' }, { SECRET: 's' }, { root });
    const { token } = await auth.authenticate('https://a');
    assert.equal(token, `https://a|s|function|${root}`);
    assert.deepEqual(auth.headers({ token: 't' }), { 'X-Custom': 't' });
    assert.equal(auth.cacheKey(), 'mine-v2');

    fs.writeFileSync(path.join(root, 'bad.mjs'), 'export default function () { return { authenticate() {} }; }');
    await assert.rejects(createAuth('bad', { preset: 'custom', module: './bad.mjs' }, {}, { root }), {
      message: 'custom auth bad: module must export a default function returning { authenticate, headers, cacheKey }',
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('createAuth rejects an unknown preset', async () => {
  await assert.rejects(createAuth('x', { preset: 'oauth' }, {}, {}), /unknown auth preset: oauth/);
});
