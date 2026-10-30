import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ConfigError,
  applyDefaults,
  channelsOf,
  defaultEnvironmentFor,
  environmentOf,
  loadConfig,
  requiredEnvVars,
  sessionsOf,
  validateConfig,
} from './config.mjs';
import { hostPaths } from './host.mjs';

const EXAMPLE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates', 'config.example.json');
const example = () => JSON.parse(fs.readFileSync(EXAMPLE, 'utf8'));
const validExample = () => applyDefaults(example());

const withRepositories = (raw) => ({ ...raw, delivery: { repositories: [{ name: 'app', channel: 'front' }] } });

const minimalGithub = () => ({
  version: 1,
  tracker: { type: 'github', projects: ['acme/app'] },
  environments: { staging: { branch: 'main', channels: { front: { url: 'https://staging.example.com', session: 'front' } } } },
  sessions: { front: { mcpServer: 'playwright' } },
});

test('applyDefaults fills language, delivery mode, browser and automation defaults', () => {
  const raw = minimalGithub();
  const config = applyDefaults(raw);
  assert.equal(config.language, 'en');
  assert.equal(config.delivery.mode, 'both');
  assert.equal(config.delivery.recentMinutes, 60);
  assert.equal(config.delivery.repositoriesDir, '..');
  assert.equal(config.browser.driver, 'playwright-mcp');
  assert.equal(config.browser.engine, 'chromium');
  assert.equal(config.browser.viewport, '1440x900');
  assert.equal(config.testData.prefix, '[E2E]');
  assert.equal(config.pitfallsFile, '.claude/functional-test/pitfalls.md');
  assert.equal(config.automation.excludedFile, '.claude/functional-test/excluded.json');
  assert.equal(config.automation.framework, 'playwright');
  assert.deepEqual(config.automation.specPaths, ['tests/']);
  assert.equal(config.automation.runCommand, 'npx playwright test {file}');
  assert.equal(config.automation.branchPattern, 'test/{key-lower}-{slug}');
  assert.equal(config.sessions.front.mode, 'persistent-profile');
  assert.equal(raw.language, undefined, 'argument is not mutated');
  assert.equal(raw.sessions.front.mode, undefined, 'argument is not mutated');
});

test('applyDefaults picks delivery none and external sessions for file tracker + cypress driver', () => {
  const config = applyDefaults({
    ...minimalGithub(),
    tracker: { type: 'file' },
    browser: { driver: 'cypress-mcp' },
    automation: { framework: 'cypress' },
  });
  assert.equal(config.delivery.mode, 'none');
  assert.equal(config.sessions.front.mode, 'external');
  assert.deepEqual(config.automation.specPaths, ['cypress/e2e/']);
  assert.equal(config.automation.runCommand, 'npx cypress run --spec {file}');
});

test('applyDefaults keeps explicit values', () => {
  const config = applyDefaults({ ...minimalGithub(), language: 'fr', delivery: { mode: 'tracker', recentMinutes: 5 } });
  assert.equal(config.language, 'fr');
  assert.equal(config.delivery.mode, 'tracker');
  assert.equal(config.delivery.recentMinutes, 5);
});

test('validateConfig returns [] for the example config', () => {
  assert.deepEqual(validateConfig(validExample()), []);
});

test('validateConfig reports a channel session that is not declared', () => {
  const config = validExample();
  config.environments.testing.channels.front.session = 'ghost';
  const errors = validateConfig(config);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^environments\.testing\.channels\.front\.session: /);
});

test('validateConfig reports password-login without usernameEnv', () => {
  const config = validExample();
  delete config.auth.agency.usernameEnv;
  const errors = validateConfig(config);
  assert.ok(errors.some((e) => e.startsWith('auth.agency.usernameEnv')), errors.join('\n'));
});

test('validateConfig reports git-log mode without repositories', () => {
  const config = validExample();
  config.delivery.repositories = [];
  const errors = validateConfig(config);
  assert.ok(errors.some((e) => e.startsWith('delivery.repositories')), errors.join('\n'));
});

test('validateConfig accepts an optional repository slug', () => {
  const config = validExample();
  config.delivery.repositories[0].slug = 'acme/webapp';
  assert.deepEqual(validateConfig(config), []);
  config.delivery.repositories[0].slug = '';
  assert.ok(validateConfig(config).some((e) => e.startsWith('delivery.repositories[0].slug')));
});

test('validateConfig reports custom driver without driverMapping', () => {
  const config = validExample();
  config.browser.driver = 'custom';
  const errors = validateConfig(config);
  assert.ok(errors.some((e) => e.startsWith('browser.driverMapping')), errors.join('\n'));
});

test('validateConfig reports structural problems with their JSON path', () => {
  const config = validExample();
  config.version = 2;
  config.language = 'xx';
  config.tracker.type = 'custom';
  config.environments.demo.branch = '';
  config.environments.testing.channels.api.auth = 'ghost';
  config.sessions.bo.file = '';
  config.auth.agency.preset = 'magic';
  config.delivery.mode = 'sometimes';
  const paths = validateConfig(config).map((e) => e.split(': ')[0]);
  for (const expected of [
    'version',
    'language',
    'tracker.module',
    'environments.demo.branch',
    'environments.testing.channels.api.auth',
    'sessions.bo.file',
    'auth.agency.preset',
    'delivery.mode',
  ]) {
    assert.ok(paths.includes(expected), `${expected} missing from ${paths.join(', ')}`);
  }
});

test('validateConfig reports missing environments, projects, sessions mcpServer and static-token tokenEnv', () => {
  const config = validExample();
  config.environments = {};
  config.tracker.projects = [];
  delete config.sessions.front.mcpServer;
  config.auth.agency = { preset: 'static-token' };
  const paths = validateConfig(config).map((e) => e.split(': ')[0]);
  for (const expected of ['environments', 'tracker.projects', 'sessions.front.mcpServer', 'auth.agency.tokenEnv']) {
    assert.ok(paths.includes(expected), `${expected} missing from ${paths.join(', ')}`);
  }
});

test('environmentOf returns the environment and throws for an unknown one', () => {
  const config = validExample();
  assert.equal(environmentOf(config, 'demo').branch, 'demo');
  assert.throws(() => environmentOf(config, 'prod'), /unknown environment/);
});

test('defaultEnvironmentFor uses byProject then fallback', () => {
  const config = validExample();
  assert.equal(defaultEnvironmentFor(config, 'PRJS-12'), 'demo');
  assert.equal(defaultEnvironmentFor(config, 'PRJ-12'), 'testing');
  assert.equal(defaultEnvironmentFor(config, 'acme/app#7'), 'testing');
});

test('defaultEnvironmentFor handles GitHub keys and a missing defaultEnvironment', () => {
  const config = applyDefaults(minimalGithub());
  assert.equal(defaultEnvironmentFor(config, 'acme/app#7'), 'staging');
  config.defaultEnvironment = { fallback: 'staging', byProject: { 'acme/app': 'demo' } };
  assert.equal(defaultEnvironmentFor(config, 'acme/app#7'), 'demo');
});

test('requiredEnvVars lists tracker and auth variables, optional auth apart', () => {
  const config = validExample();
  config.auth.agency.usernameEnv = 'API_V2_AGENCY_USERNAME';
  config.auth.agency.passwordEnv = 'API_V2_AGENCY_PASSWORD';
  config.auth.extra = { preset: 'static-token', tokenEnv: 'EXTRA_TOKEN', optional: true };
  assert.deepEqual(requiredEnvVars(config), {
    required: ['JIRA_EMAIL', 'JIRA_API_TOKEN', 'API_V2_AGENCY_USERNAME', 'API_V2_AGENCY_PASSWORD'],
    optional: ['EXTRA_TOKEN'],
  });
});

test('requiredEnvVars covers github, file and custom trackers and custom auth variables', () => {
  assert.deepEqual(requiredEnvVars({ tracker: { type: 'github' } }), { required: ['GITHUB_TOKEN'], optional: [] });
  assert.deepEqual(requiredEnvVars({ tracker: { type: 'file' } }), { required: [], optional: [] });
  assert.deepEqual(
    requiredEnvVars({
      tracker: { type: 'custom', envVars: ['A', 'B'] },
      auth: { one: { preset: 'custom', envVars: ['B', 'C'] }, two: { preset: 'none' } },
    }),
    { required: ['A', 'B', 'C'], optional: [] },
  );
});

test('sessionsOf returns distinct session names in channel order, channelsOf a copy of the channels', () => {
  const config = validExample();
  assert.deepEqual(sessionsOf(config, 'testing'), ['front', 'bo']);
  const channels = channelsOf(config, 'testing');
  assert.deepEqual(Object.keys(channels), ['front', 'bo', 'api']);
  channels.front.url = 'changed';
  assert.equal(config.environments.testing.channels.front.url, 'https://app-testing.example.com');
});

function tempHost(contents) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-config-'));
  const { config, configDir } = hostPaths(root);
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(config, contents);
  return root;
}

test('loadConfig loads and applies defaults', () => {
  const root = tempHost(JSON.stringify(withRepositories(minimalGithub())));
  const config = loadConfig(root);
  assert.equal(config.language, 'en');
  assert.equal(config.sessions.front.mode, 'persistent-profile');
  fs.rmSync(root, { recursive: true });
});

test('loadConfig throws ConfigError with all errors', () => {
  const bad = withRepositories(minimalGithub());
  bad.version = 3;
  bad.tracker.projects = [];
  const root = tempHost(JSON.stringify(bad));
  assert.throws(
    () => loadConfig(root),
    (err) => {
      assert.ok(err instanceof ConfigError);
      assert.equal(err.errors.length, 2);
      assert.equal(err.message, err.errors.join('\n'));
      return true;
    },
  );
  fs.rmSync(root, { recursive: true });
});

test('loadConfig reports unreadable or malformed JSON as a ConfigError', () => {
  const root = tempHost('{ not json');
  assert.throws(() => loadConfig(root), (err) => err instanceof ConfigError && /config\.json/.test(err.message));
  fs.rmSync(root, { recursive: true });
  assert.throws(() => loadConfig(path.join(os.tmpdir(), 'ft-no-such-host')), ConfigError);
});

test('validateConfig reports an unknown session mode', () => {
  const config = validExample();
  config.sessions.front.mode = 'cookie-jar';
  const errors = validateConfig(config);
  assert.ok(errors.some((e) => e.startsWith('sessions.front.mode: ')), errors.join('\n'));
});

test('validateConfig reports an unknown automation framework', () => {
  const config = validExample();
  config.automation.framework = 'selenium';
  const errors = validateConfig(config);
  assert.ok(errors.some((e) => e.startsWith('automation.framework: ')), errors.join('\n'));
});
