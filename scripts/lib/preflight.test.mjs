import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { applyDefaults } from './config.mjs';
import { profileDir } from './session.mjs';
import { checkConfig, checkDriverMapping, checkEnvVars, checkGitignore, checkMcp, checkRepositories } from './preflight.mjs';

const ROOT = '/host';

function makeConfig(overrides = {}) {
  return applyDefaults({
    version: 1,
    tracker: { type: 'jira', baseUrl: 'https://tracker.example.com', projects: ['WV'] },
    environments: {
      testing: {
        branch: 'testing',
        channels: {
          front: { url: 'https://app.example.com', session: 'front' },
          api: { url: 'https://api.example.com', auth: 'agency' },
        },
      },
    },
    delivery: { mode: 'git-log', repositories: [{ name: 'front-app', channel: 'front' }, { name: '.', channel: 'front' }] },
    sessions: { front: { mode: 'persistent-profile', mcpServer: 'playwright' } },
    auth: {
      agency: { preset: 'password-login', loginPath: '/login', usernameEnv: 'API_USER', passwordEnv: 'API_PASS' },
      extra: { preset: 'static-token', tokenEnv: 'EXTRA_TOKEN', optional: true },
    },
    ...overrides,
  });
}

const lines = (result) => [result].flat();

test('checkEnvVars lists missing required and optional separately', () => {
  const config = makeConfig();
  const result = lines(checkEnvVars(config, { JIRA_EMAIL: 'a@b.c', API_USER: 'u' }));
  assert.deepEqual(result, [
    { level: 'ko', key: 'preflight.envMissing', params: { names: 'JIRA_API_TOKEN, API_PASS' } },
    { level: 'warn', key: 'preflight.envOptionalMissing', params: { names: 'EXTRA_TOKEN' } },
  ]);
  const complete = lines(checkEnvVars(config, { JIRA_EMAIL: 'a', JIRA_API_TOKEN: 'b', API_USER: 'c', API_PASS: 'd', EXTRA_TOKEN: 'e' }));
  assert.deepEqual(complete, [{ level: 'ok', key: 'preflight.envPresent', params: {} }]);
});

test('checkRepositories is ko in git-log and warn in both', () => {
  const present = new Set([path.join(ROOT, '.git')]);
  const exists = (p) => present.has(p);
  const gitLog = lines(checkRepositories(makeConfig(), ROOT, exists, {}));
  assert.equal(gitLog.length, 1);
  assert.equal(gitLog[0].level, 'ko');
  assert.equal(gitLog[0].key, 'preflight.reposMissing');
  assert.equal(gitLog[0].params.names, 'front-app', '"." is always present');

  const both = lines(checkRepositories(makeConfig({ delivery: { mode: 'both', repositories: [{ name: 'front-app', channel: 'front' }] } }), ROOT, exists, {}));
  assert.equal(both[0].level, 'warn');

  const all = lines(checkRepositories(makeConfig(), ROOT, () => true, {}));
  assert.deepEqual(all.map((l) => [l.level, l.key]), [['ok', 'preflight.reposPresent']]);

  for (const mode of ['tracker', 'none']) {
    assert.deepEqual(lines(checkRepositories(makeConfig({ delivery: { mode } }), ROOT, () => false, {})), [], `skipped in ${mode} mode`);
  }
});

test('checkRepositories honours FT_REPOS_DIR over the configured directory', () => {
  const asked = [];
  checkRepositories(makeConfig(), ROOT, (p) => (asked.push(p), true), { FT_REPOS_DIR: '/elsewhere' });
  assert.ok(asked.includes(path.join('/elsewhere', 'front-app', '.git')), asked.join(', '));
});

test('checkMcp is ko naming the server when absent', () => {
  const mcp = JSON.stringify({ mcpServers: { other: { command: 'x' } } });
  assert.deepEqual(lines(checkMcp(makeConfig(), 'testing', mcp, ROOT)), [
    { level: 'ko', key: 'preflight.mcpMissing', params: { server: 'playwright' } },
  ]);
  assert.deepEqual(lines(checkMcp(makeConfig(), 'testing', null, ROOT)), [{ level: 'ko', key: 'preflight.mcpFileMissing', params: {} }]);
  assert.equal(lines(checkMcp(makeConfig(), 'testing', '{nope', ROOT))[0].key, 'preflight.mcpFileInvalid');
});

test('checkMcp has nothing to check when the environment needs no MCP server', () => {
  const config = makeConfig({ environments: { testing: { branch: 'testing', channels: { api: { url: 'https://api.example.com' } } } } });
  assert.deepEqual(lines(checkMcp(config, 'testing', null, ROOT)), []);
});

test('checkMcp is ko when the playwright profile dir does not match', () => {
  const server = (args) => JSON.stringify({ mcpServers: { playwright: { command: 'npx', args } } });
  const expected = profileDir(ROOT, 'front');

  const wrong = lines(checkMcp(makeConfig(), 'testing', server(['@playwright/mcp', '--user-data-dir', '/tmp/other']), ROOT));
  assert.equal(wrong[0].level, 'ko');
  assert.equal(wrong[0].key, 'preflight.mcpMismatch');
  assert.equal(wrong[0].params.server, 'playwright');
  assert.ok(wrong[0].params.expected.includes('--user-data-dir'));
  assert.equal(lines(checkMcp(makeConfig(), 'testing', server(['@playwright/mcp']), ROOT))[0].key, 'preflight.mcpMismatch', 'flag missing');

  for (const args of [
    ['--user-data-dir', expected],
    [`--user-data-dir=${expected}`],
    ['--user-data-dir', '.auth/profiles/front'],
  ]) {
    assert.deepEqual(lines(checkMcp(makeConfig(), 'testing', server(args), ROOT)), [
      { level: 'ok', key: 'preflight.mcpOk', params: { server: 'playwright' } },
    ]);
  }
});

test('checkMcp requires the storage-state file of a storage-state session', () => {
  const config = makeConfig({ sessions: { front: { mode: 'storage-state', mcpServer: 'pw', file: '.auth/front.json', command: 'x' } } });
  const server = (args) => JSON.stringify({ mcpServers: { pw: { args } } });
  assert.equal(lines(checkMcp(config, 'testing', server(['--storage-state', '.auth/front.json']), ROOT))[0].level, 'ok');
  assert.equal(lines(checkMcp(config, 'testing', server(['--storage-state', '.auth/other.json']), ROOT))[0].key, 'preflight.mcpMismatch');
});

test('checkMcp is ok for an external session with declared server', () => {
  const config = makeConfig({ sessions: { front: { mode: 'external', mcpServer: 'my-browser' } } });
  const mcp = JSON.stringify({ mcpServers: { 'my-browser': { command: 'whatever', args: [] } } });
  assert.deepEqual(lines(checkMcp(config, 'testing', mcp, ROOT)), [{ level: 'ok', key: 'preflight.mcpOk', params: { server: 'my-browser' } }]);
});

test('checkMcp only checks the presence of the server for other drivers and for the test MCP server', () => {
  const config = makeConfig({
    browser: { driver: 'cypress-mcp' },
    automation: { testMcpServer: 'pw-test' },
  });
  const mcp = JSON.stringify({ mcpServers: { playwright: { args: [] } } });
  assert.deepEqual(lines(checkMcp(config, 'testing', mcp, ROOT)), [
    { level: 'ok', key: 'preflight.mcpOk', params: { server: 'playwright' } },
    { level: 'ko', key: 'preflight.mcpMissing', params: { server: 'pw-test' } },
  ]);
});

test('checkGitignore warns when .auth/ missing', () => {
  assert.deepEqual(lines(checkGitignore('node_modules/\n.env\n')), [{ level: 'warn', key: 'preflight.gitignore', params: { names: '.auth/' } }]);
  assert.deepEqual(lines(checkGitignore('.auth/\n')), [{ level: 'warn', key: 'preflight.gitignore', params: { names: '.env' } }]);
  assert.deepEqual(lines(checkGitignore(null)), [{ level: 'warn', key: 'preflight.gitignore', params: { names: '.env, .auth/' } }]);
  assert.deepEqual(lines(checkGitignore('# c\n/.env\n.auth\n')), []);
});

test('checkDriverMapping is ko only for a custom driver whose mapping file is missing', () => {
  const custom = makeConfig({ browser: { driver: 'custom', driverMapping: 'docs/driver.md' } });
  assert.deepEqual(lines(checkDriverMapping(custom, ROOT, () => false)), [
    { level: 'ko', key: 'preflight.driverMappingMissing', params: { path: path.join(ROOT, 'docs/driver.md') } },
  ]);
  assert.deepEqual(lines(checkDriverMapping(custom, ROOT, () => true)), []);
  assert.deepEqual(lines(checkDriverMapping(makeConfig(), ROOT, () => false)), []);
});

test('checkConfig reports a valid or an invalid configuration', () => {
  assert.deepEqual(checkConfig([]), { level: 'ok', key: 'preflight.configValid', params: {} });
  assert.deepEqual(checkConfig(['a: bad', 'b: worse']), { level: 'ko', key: 'preflight.configInvalid', params: { errors: 'a: bad; b: worse' } });
});
