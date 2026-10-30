import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = path.join(path.dirname(new URL(import.meta.url).pathname), 'api.mjs');
const example = JSON.parse(fs.readFileSync(new URL('../templates/config.example.json', import.meta.url), 'utf8'));

function run(cwd, args, env = {}) {
  return new Promise((resolve) => {
    execFile('node', [SCRIPT, ...args], { cwd, env: { PATH: process.env.PATH, ...env } }, (error, stdout, stderr) => {
      resolve({ code: error ? error.code : 0, stdout, stderr });
    });
  });
}

/** Host folder whose testing `api` channel points at `apiUrl`; `.gitignore`-less, language en. */
function makeHost(apiUrl, mutate = (config) => config) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ft-api-')));
  fs.mkdirSync(path.join(dir, '.claude', 'functional-test'), { recursive: true });
  const config = structuredClone(example);
  config.language = 'en';
  config.environments.testing.channels.api.url = apiUrl;
  fs.writeFileSync(path.join(dir, '.claude', 'functional-test', 'config.json'), JSON.stringify(mutate(config)));
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/** Stub API: POST /v1/auth/agency/login, GET /v1/me (secrets in the body), GET /v1/boom (503), POST /v1/echo. */
async function stubApi() {
  const requests = [];
  let logins = 0;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, body: raw });
      const send = (status, payload) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
      };
      if (req.url === '/v1/auth/agency/login') {
        const { username, password } = JSON.parse(raw);
        if (password !== 'correct-password') return send(401, { error: `wrong password ${password}` });
        logins += 1;
        return send(200, { access_token: `jwt-${username}-${logins}`, expires_in: 300 });
      }
      if (!req.headers.authorization?.startsWith('Bearer jwt-')) return send(401, {});
      if (req.url === '/v1/me') return send(200, { id: 'u1', name: 'Collab', apiToken: 'leaky-token', nested: { password: 'leaky-pw' } });
      if (req.url === '/v1/session') {
        const token = req.headers.authorization.slice('Bearer '.length);
        return send(200, { data: { jwt: token, echo: `seen ${token}`, note: `jira ${process.env.STUB_ECHO ?? ''}` } });
      }
      if (req.url === '/v1/boom') return send(503, 'upstream down');
      if (req.url === '/v1/text') return send(200, `debug: ${req.headers.authorization} user=collab pass=correct-password ok`);
      if (req.url === '/v1/missing') return send(404, { message: 'not here' });
      if (req.url === '/v1/echo') return send(201, { received: JSON.parse(raw || 'null') });
      return send(404, {});
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    logins: () => logins,
    close: () => new Promise((done) => server.close(done)),
  };
}

const secrets = { API_AGENCY_USERNAME: 'collab', API_AGENCY_PASSWORD: 'correct-password' };

test('api.mjs logs in, calls the API, masks the body and caches the token with mode 0600', async () => {
  const api = await stubApi();
  const host = makeHost(`${api.url}/`);
  try {
    const first = await run(host.dir, ['--env', 'testing', 'GET', '/v1/me', '--header', 'X-Agency-Id=ag1'], secrets);
    assert.equal(first.code, 0, first.stderr);
    assert.match(first.stdout, /^200 GET \/v1\/me \(\d+ ms\)\n/);
    assert.match(first.stdout, /"name": "Collab"/);
    assert.match(first.stdout, /"apiToken": "\*\*\*"/);
    assert.match(first.stdout, /"password": "\*\*\*"/);
    assert.ok(!first.stdout.includes('leaky'));
    assert.equal(api.requests[1].headers['x-agency-id'], 'ag1');
    assert.equal(api.requests[1].headers.authorization, 'Bearer jwt-collab-1');

    const cacheFile = path.join(host.dir, '.auth', 'api-testing-agency.json');
    assert.equal(fs.statSync(cacheFile).mode & 0o777, 0o600);
    assert.equal(JSON.parse(fs.readFileSync(cacheFile, 'utf8')).token, 'jwt-collab-1');

    const second = await run(host.dir, ['--env', 'testing', '--raw', 'GET', '/v1/me'], secrets);
    assert.equal(second.code, 0, second.stderr);
    assert.equal(api.logins(), 1, 'the cached token is reused');
    assert.match(second.stdout, /\n\{"id":"u1","name":"Collab","apiToken":"\*\*\*","nested":\{"password":"\*\*\*"\}\}\n$/);
  } finally {
    host.cleanup();
    await api.close();
  }
});

test('api.mjs sends a body from the command line or a file, and answers a 4xx with exit 0', async () => {
  const api = await stubApi();
  const host = makeHost(api.url);
  try {
    fs.writeFileSync(path.join(host.dir, 'body.json'), '{"from":"file"}');
    const inline = await run(host.dir, ['--env', 'testing', 'post', '/v1/echo', '--body', '{"a":1}'], secrets);
    assert.equal(inline.code, 0, inline.stderr);
    assert.match(inline.stdout, /^201 POST \/v1\/echo/);
    assert.deepEqual(JSON.parse(api.requests.at(-1).body), { a: 1 });
    assert.equal(api.requests.at(-1).headers['content-type'], 'application/json');

    await run(host.dir, ['--env', 'testing', 'POST', '/v1/echo', '--body', '@body.json'], secrets);
    assert.deepEqual(JSON.parse(api.requests.at(-1).body), { from: 'file' });

    const missing = await run(host.dir, ['--env', 'testing', 'GET', '/v1/missing'], secrets);
    assert.equal(missing.code, 0);
    assert.match(missing.stdout, /^404 GET \/v1\/missing/);
  } finally {
    host.cleanup();
    await api.close();
  }
});

test('api.mjs redacts the token and the credentials from a plain-text body, with or without --raw', async () => {
  const api = await stubApi();
  const host = makeHost(api.url);
  try {
    for (const extra of [[], ['--raw']]) {
      const { code, stdout, stderr } = await run(host.dir, ['--env', 'testing', ...extra, 'GET', '/v1/text'], secrets);
      assert.equal(code, 0, stderr);
      assert.match(stdout, /^200 GET \/v1\/text \(\d+ ms\)\ndebug: Bearer \*\*\* user=\*\*\* pass=\*\*\* ok\n$/);
      assert.ok(!stdout.includes('jwt-collab'));
      assert.ok(!stdout.includes('correct-password'));
    }

    fs.writeFileSync(path.join(host.dir, 'worker.json'), JSON.stringify({ username: 'worker@e2e', password: 'correct-password' }));
    const explicit = await run(host.dir, ['--env', 'testing', '--credentials', 'worker.json', 'GET', '/v1/text']);
    assert.match(explicit.stdout, /debug: Bearer \*\*\* user=collab pass=\*\*\* ok/);
    assert.ok(!explicit.stdout.includes('jwt-worker') && !explicit.stdout.includes('correct-password'));
  } finally {
    host.cleanup();
    await api.close();
  }
});

test('api.mjs masks secrets under secret-looking keys and redacts known secret values under any key', async () => {
  const api = await stubApi();
  const host = makeHost(api.url);
  process.env.STUB_ECHO = 'jira-api-token-value';
  try {
    const env = { ...secrets, JIRA_EMAIL: 'qa@example.test', JIRA_API_TOKEN: 'jira-api-token-value' };
    for (const extra of [[], ['--raw']]) {
      const { code, stdout, stderr } = await run(host.dir, ['--env', 'testing', ...extra, 'GET', '/v1/session'], env);
      assert.equal(code, 0, stderr);
      assert.match(stdout, /"jwt": ?"\*\*\*"/);
      assert.match(stdout, /"echo": ?"seen \*\*\*"/);
      assert.match(stdout, /"note": ?"jira \*\*\*"/);
      assert.ok(!stdout.includes('jwt-collab') && !stdout.includes('jira-api-token-value'), stdout);
    }
  } finally {
    delete process.env.STUB_ECHO;
    host.cleanup();
    await api.close();
  }
});

test('api.mjs exits 5 on a 5xx answer', async () => {
  const api = await stubApi();
  const host = makeHost(api.url);
  try {
    const { code, stdout } = await run(host.dir, ['--env', 'testing', 'GET', '/v1/boom'], secrets);
    assert.equal(code, 5);
    assert.match(stdout, /^503 GET \/v1\/boom \(\d+ ms\)\nupstream down\n$/);
  } finally {
    host.cleanup();
    await api.close();
  }
});

test('api.mjs exits 1 when the login is refused, without leaking the password', async () => {
  const api = await stubApi();
  const host = makeHost(api.url);
  try {
    const { code, stderr, stdout } = await run(host.dir, ['--env', 'testing', 'GET', '/v1/me'], { ...secrets, API_AGENCY_PASSWORD: 'wrong-password' });
    assert.equal(code, 1);
    assert.match(stderr, /login agency refused \(401\)/);
    assert.ok(!(stderr + stdout).includes('wrong-password'));
    assert.ok(!fs.existsSync(path.join(host.dir, '.auth')));
  } finally {
    host.cleanup();
    await api.close();
  }
});

test('api.mjs --credentials uses its own account and its own cache file', async () => {
  const api = await stubApi();
  const host = makeHost(api.url);
  try {
    fs.writeFileSync(path.join(host.dir, 'worker.json'), JSON.stringify({ username: 'worker@e2e', password: 'correct-password' }));
    const { code, stderr } = await run(host.dir, ['--env', 'testing', '--credentials', 'worker.json', 'GET', '/v1/me']);
    assert.equal(code, 0, stderr);
    assert.equal(api.requests[1].headers.authorization, 'Bearer jwt-worker@e2e-1');
    const files = fs.readdirSync(path.join(host.dir, '.auth'));
    assert.equal(files.length, 1);
    assert.match(files[0], /^api-testing-agency-[0-9a-f]{12}\.json$/);

    fs.writeFileSync(path.join(host.dir, 'bad.json'), '{"username":"x"}');
    assert.equal((await run(host.dir, ['--env', 'testing', '--credentials', 'bad.json', 'GET', '/v1/me'])).code, 2);
    assert.equal((await run(host.dir, ['--env', 'testing', '--credentials', 'nope.json', 'GET', '/v1/me'])).code, 2);
  } finally {
    host.cleanup();
    await api.close();
  }
});

test('api.mjs exits 3 for missing secrets, 4 when unreachable and 2 for usage or config problems', async () => {
  const api = await stubApi();
  const host = makeHost(api.url);
  try {
    const missing = await run(host.dir, ['--env', 'testing', 'GET', '/v1/me']);
    assert.equal(missing.code, 3);
    assert.match(missing.stderr, /missing environment variables: API_AGENCY_USERNAME, API_AGENCY_PASSWORD/);

    assert.equal((await run(host.dir, ['GET', '/v1/me'])).code, 2);
    assert.match((await run(host.dir, ['--env', 'testing', 'GET', 'v1/me'])).stderr, /^usage: api\.mjs/);
    const unknown = await run(host.dir, ['--env', 'prod', 'GET', '/v1/me']);
    assert.equal(unknown.code, 2);
    assert.match(unknown.stderr, /unknown environment: prod \(expected: testing, demo\)/);
    assert.equal((await run(host.dir, ['--env', 'testing', '--channel', 'nope', 'GET', '/v1/me'])).code, 2);
    assert.equal((await run(host.dir, ['--env', 'testing', '--auth', 'nope', 'GET', '/v1/me'])).code, 2);
  } finally {
    host.cleanup();
    await api.close();
  }

  const closed = await stubApi();
  await closed.close();
  const unreachable = makeHost(closed.url);
  try {
    const { code, stderr } = await run(unreachable.dir, ['--env', 'testing', 'GET', '/v1/me'], secrets);
    assert.equal(code, 4, stderr);
    assert.match(stderr, /network error/);
    assert.ok(!stderr.includes('correct-password'));
  } finally {
    unreachable.cleanup();
  }

  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-nohost-'));
  try {
    const { code, stderr } = await run(bare, ['--env', 'testing', 'GET', '/v1/me']);
    assert.equal(code, 2);
    assert.match(stderr, /no host project found/);
  } finally {
    fs.rmSync(bare, { recursive: true, force: true });
  }
});

test('api.mjs needs --channel when the environment has several API channels', async () => {
  const api = await stubApi();
  const host = makeHost(api.url, (config) => {
    config.environments.testing.channels.admin = { url: api.url, auth: 'agency' };
    return config;
  });
  try {
    const ambiguous = await run(host.dir, ['--env', 'testing', 'GET', '/v1/me'], secrets);
    assert.equal(ambiguous.code, 2);
    assert.match(ambiguous.stderr, /several API channels in environment testing \(api, admin\): pass --channel/);
    const chosen = await run(host.dir, ['--env', 'testing', '--channel', 'admin', 'GET', '/v1/me'], secrets);
    assert.equal(chosen.code, 0, chosen.stderr);
  } finally {
    host.cleanup();
    await api.close();
  }
});

test('api.mjs with a static-token auth sends the token from the environment and caches nothing', async () => {
  const api = await stubApi();
  const host = makeHost(api.url, (config) => {
    config.auth.agency = { preset: 'static-token', tokenEnv: 'API_TOKEN', scheme: 'Bearer' };
    return config;
  });
  try {
    const { code, stderr } = await run(host.dir, ['--env', 'testing', 'GET', '/v1/me'], { API_TOKEN: 'jwt-static' });
    assert.equal(code, 0, stderr);
    assert.equal(api.requests[0].headers.authorization, 'Bearer jwt-static');
    assert.ok(!fs.existsSync(path.join(host.dir, '.auth')));
  } finally {
    host.cleanup();
    await api.close();
  }
});
