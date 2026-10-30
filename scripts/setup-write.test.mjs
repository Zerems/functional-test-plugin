import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = path.join(path.dirname(new URL(import.meta.url).pathname), 'setup-write.mjs');
const EXAMPLE = JSON.parse(fs.readFileSync(path.join(path.dirname(SCRIPT), '..', 'templates', 'config.example.json'), 'utf8'));

function run(cwd, args) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH } });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function tmpDir() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ft-setup-cli-')));
}

/** The example answers, with the file tracker, no delivery repositories; `withSessions: false` drops the browser sessions. */
function answers({ withSessions = true } = {}) {
  const config = structuredClone(EXAMPLE);
  config.language = 'en';
  config.tracker = { type: 'file' };
  config.delivery = { mode: 'none' };
  delete config.defaultEnvironment.byProject;
  if (!withSessions) {
    delete config.sessions;
    for (const environment of Object.values(config.environments)) for (const channel of Object.values(environment.channels)) delete channel.session;
  }
  return config;
}

function writeAnswers(dir, config) {
  const file = path.join(dir, 'answers.json');
  fs.writeFileSync(file, JSON.stringify(config));
  return file;
}

test('setup-write creates the host files in the current directory when no host exists', () => {
  const dir = tmpDir();
  const file = writeAnswers(dir, answers({ withSessions: false }));
  const { code, stdout } = run(dir, [file, '--no-preflight']);
  assert.equal(code, 0, stdout);
  assert.match(stdout, /written: \.claude\/functional-test\/config\.json/);
  assert.match(stdout, /written: \.claude\/functional-test\/pitfalls\.md/);
  assert.match(stdout, /written: \.env\.example/);
  assert.match(stdout, /Next: copy the variables of \.env\.example/);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(dir, '.mcp.json'), 'utf8')).mcpServers), ['playwright-test']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '.claude/functional-test/config.json'), 'utf8')).browser.viewport, '1440x900');
  assert.ok(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8').includes('.auth/'));
  assert.equal(fs.existsSync(path.join(dir, '.env')), false);
  assert.doesNotMatch(stdout, /---/, 'the preflight is not run with --no-preflight');
});

test('a second run reports the config as written and everything else as skipped', () => {
  const dir = tmpDir();
  const file = writeAnswers(dir, answers());
  assert.equal(run(dir, [file, '--no-preflight']).code, 0);
  const { code, stdout } = run(dir, [file, '--no-preflight']);
  assert.equal(code, 0);
  assert.deepEqual(stdout.split('\n').filter((l) => l.startsWith('written:')), ['written: .claude/functional-test/config.json']);
  assert.equal(stdout.split('\n').filter((l) => l.startsWith('skipped')).length, 5);
});

test('an existing .mcp.json keeps its foreign server and gains the new entries', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { foreign: { command: 'f' } } }));
  const { code } = run(dir, [writeAnswers(dir, answers()), '--no-preflight']);
  assert.equal(code, 0);
  const servers = JSON.parse(fs.readFileSync(path.join(dir, '.mcp.json'), 'utf8')).mcpServers;
  assert.deepEqual(Object.keys(servers).sort(), ['foreign', 'playwright', 'playwright-bo', 'playwright-test']);
  assert.deepEqual(servers.foreign, { command: 'f' });
});

test('setup-write runs the preflight on the new host and exits with its code', () => {
  const dir = tmpDir();
  const { code, stdout } = run(dir, [writeAnswers(dir, answers({ withSessions: false }))]);
  // API channel logins cannot succeed offline and the credentials are not set: the preflight blocks.
  assert.equal(code, 1);
  assert.match(stdout, /--- blocked/);
  assert.match(stdout, /written: \.claude\/functional-test\/config\.json/);
});

test('invalid answers exit 2 and list every error without writing anything', () => {
  const dir = tmpDir();
  const config = answers();
  config.tracker = { type: 'jira' };
  config.environments = {};
  const { code, stderr } = run(dir, [writeAnswers(dir, config), '--no-preflight']);
  assert.equal(code, 2);
  assert.match(stderr, /tracker\.projects/);
  assert.match(stderr, /environments: needs at least one environment/);
  assert.equal(fs.existsSync(path.join(dir, '.claude')), false);
});

test('usage and unreadable answers exit 2', () => {
  const dir = tmpDir();
  assert.equal(run(dir, []).code, 2);
  assert.equal(run(dir, ['a.json', 'b.json']).code, 2);
  assert.equal(run(dir, ['--bogus']).code, 2);
  const missing = run(dir, ['missing.json']);
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /cannot read the answers file/);
  fs.writeFileSync(path.join(dir, 'bad.json'), '{ nope');
  assert.equal(run(dir, ['bad.json']).code, 2);
});

test('a malformed .mcp.json stops the setup with exit 2 and a message that does not quote it', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, '.mcp.json'), '{ "token": "tok-987654" ');
  const { code, stderr } = run(dir, [writeAnswers(dir, answers()), '--no-preflight']);
  assert.equal(code, 2);
  assert.match(stderr, /\.mcp\.json is not valid JSON/);
  assert.doesNotMatch(stderr, /tok-987654/);
});

test('a community driver gets no .mcp.json entry but its install command and the unverified warning', () => {
  for (const [driver, command] of [['cypress-mcp', 'npx -y cypress-mcp'], ['robotframework-mcp', 'uvx robotframework-mcp']]) {
    const dir = tmpDir();
    const config = answers();
    config.browser = { driver };
    for (const session of Object.values(config.sessions)) {
      session.mode = 'external';
      delete session.file;
      delete session.command;
    }
    const { code, stdout, stderr } = run(dir, [writeAnswers(dir, config), '--no-preflight']);
    assert.equal(code, 0, stderr);
    const servers = JSON.parse(fs.readFileSync(path.join(dir, '.mcp.json'), 'utf8')).mcpServers;
    assert.deepEqual(Object.keys(servers), ['playwright-test'], driver);
    assert.ok(stdout.includes(`Install command: ${command}`), stdout);
    assert.match(stdout, /community server, unverified — verify the tool names and pin a version before use/);
    assert.match(stdout, /playwright, playwright-bo/);
  }
});
