import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = path.join(path.dirname(new URL(import.meta.url).pathname), 'ticket.mjs');
const example = JSON.parse(fs.readFileSync(new URL('../templates/config.example.json', import.meta.url), 'utf8'));

/** Runs ticket.mjs from `cwd` with a clean environment; resolves `{ code, stdout, stderr }`. */
function run(cwd, args, env = {}) {
  return new Promise((resolve) => {
    execFile('node', [SCRIPT, ...args], { cwd, env: { PATH: process.env.PATH, ...env } }, (error, stdout, stderr) => {
      resolve({ code: error ? error.code : 0, stdout, stderr });
    });
  });
}

/** A throwaway host folder with the given config (language en). */
function makeHost(config) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ft-ticket-')));
  fs.mkdirSync(path.join(dir, '.claude', 'functional-test'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'functional-test', 'config.json'), JSON.stringify({ ...config, language: 'en' }));
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const fileConfig = { ...example, tracker: { type: 'file' }, delivery: { mode: 'none' } };

test('ticket.mjs prints the dossier of a Markdown ticket and says the delivery is not verified', async () => {
  const host = makeHost(fileConfig);
  try {
    fs.writeFileSync(path.join(host.dir, 'ticket.md'), '# Login page\n\n## Acceptance criteria\n\n- Shows an error on a bad password\n');
    const { code, stdout, stderr } = await run(host.dir, ['./ticket.md']);
    assert.equal(code, 0, stderr);
    assert.match(stdout, /^# ticket — Login page$/m);
    assert.match(stdout, /^1\. Shows an error on a bad password$/m);
    assert.match(stdout, /Delivery not verified: delivery check disabled/);

    const json = JSON.parse((await run(host.dir, ['./ticket.md', '--json'])).stdout);
    assert.equal(json.issue.key, 'ticket');
    assert.equal(json.delivery.state, 'unknown');

    assert.equal((await run(host.dir, ['./ticket.md', '--replay-text'])).stdout, '');
  } finally {
    host.cleanup();
  }
});

test('ticket.mjs exits 2 on bad usage, unknown env, unreadable ticket file and missing host', async () => {
  const host = makeHost(fileConfig);
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-nohost-'));
  try {
    assert.equal((await run(host.dir, [])).code, 2);
    assert.equal((await run(host.dir, ['a.md', '--json', '--replay-text'])).code, 2);
    const env = await run(host.dir, ['a.md', '--env', 'prod']);
    assert.equal(env.code, 2);
    assert.match(env.stderr, /unknown environment: prod \(expected: testing, demo\)/);
    assert.equal((await run(host.dir, ['missing.md'])).code, 2);
    const noHost = await run(bare, ['WV-1']);
    assert.equal(noHost.code, 2);
    assert.match(noHost.stderr, /no host project found/);
  } finally {
    host.cleanup();
    fs.rmSync(bare, { recursive: true, force: true });
  }
});

test('ticket.mjs exits 3 and names the missing variables, never a value', async () => {
  const host = makeHost(example);
  try {
    const { code, stderr } = await run(host.dir, ['WV-1']);
    assert.equal(code, 3);
    assert.match(stderr, /missing environment variables: JIRA_EMAIL, JIRA_API_TOKEN/);
  } finally {
    host.cleanup();
  }
});

/** Starts a server answering every request with `status`; resolves `{ url, close }`. */
function stubServer(status) {
  const server = http.createServer((req, res) => {
    res.statusCode = status;
    res.end('{}');
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((done) => server.close(done)) }),
    ),
  );
}

test('ticket.mjs maps tracker answers to exit codes: 404 → 2, 500 → 4, unreachable → 4', async () => {
  const secrets = { JIRA_EMAIL: 'qa@example.test', JIRA_API_TOKEN: 'secret-token-value' };
  for (const [status, expected, message] of [[404, 2, /ticket not found: WV-1/], [500, 4, /tracker error: Jira 500/]]) {
    const server = await stubServer(status);
    const host = makeHost({ ...example, tracker: { ...example.tracker, baseUrl: server.url } });
    try {
      const { code, stderr } = await run(host.dir, ['wv-1'], secrets);
      assert.equal(code, expected, stderr);
      assert.match(stderr, message);
      assert.ok(!stderr.includes(secrets.JIRA_API_TOKEN));
    } finally {
      host.cleanup();
      await server.close();
    }
  }

  const closed = await stubServer(200);
  await closed.close();
  const host = makeHost({ ...example, tracker: { ...example.tracker, baseUrl: closed.url } });
  try {
    const { code, stderr } = await run(host.dir, ['WV-1'], secrets);
    assert.equal(code, 4, stderr);
    assert.match(stderr, /tracker error/);
  } finally {
    host.cleanup();
  }
});

test('ticket.mjs refuses secret files and non-ticket extensions without echoing their content', async () => {
  for (const config of [fileConfig, example]) {
    const host = makeHost(config);
    try {
      const secret = 'super-secret-value-123';
      fs.writeFileSync(path.join(host.dir, '.env'), `JIRA_API_TOKEN=${secret}\n`);
      fs.writeFileSync(path.join(host.dir, '.env.local'), `OTHER=${secret}\n`);
      fs.mkdirSync(path.join(host.dir, '.auth'));
      fs.writeFileSync(path.join(host.dir, '.auth', 'token.md'), `# ${secret}\n`);
      fs.writeFileSync(path.join(host.dir, '.mcp.json'), JSON.stringify({ token: secret }));
      fs.writeFileSync(path.join(host.dir, 'data.json'), JSON.stringify({ token: secret }));
      fs.symlinkSync(path.join(host.dir, '.env'), path.join(host.dir, 'alias.md'));
      for (const input of ['.env', './.env.local', '.auth/token.md', '.mcp.json', 'data.json', 'alias.md']) {
        const { code, stdout, stderr } = await run(host.dir, [input]);
        assert.equal(code, 2, `${input}: ${stderr}`);
        assert.ok(!stdout.includes(secret) && !stderr.includes(secret), input);
        assert.match(stderr, /refused/, input);
      }
    } finally {
      host.cleanup();
    }
  }
});

test('ticket.mjs reads a .txt ticket and redacts the values loaded from .env', async () => {
  const host = makeHost(fileConfig);
  try {
    const secret = 'leaked-into-ticket-42';
    fs.writeFileSync(path.join(host.dir, '.env'), `APP_PASSWORD=${secret}\n`);
    fs.writeFileSync(path.join(host.dir, 'notes.txt'), `# Notes\n\n## Acceptance criteria\n\n- Log in with ${secret}\n`);
    const { code, stdout, stderr } = await run(host.dir, ['notes.txt']);
    assert.equal(code, 0, stderr);
    assert.match(stdout, /^# notes — Notes$/m);
    assert.ok(!stdout.includes(secret));
    assert.match(stdout, /Log in with \*\*\*/);
    const json = await run(host.dir, ['notes.txt', '--json']);
    assert.equal(json.code, 0, json.stderr);
    assert.ok(!json.stdout.includes(secret));
  } finally {
    host.cleanup();
  }
});
