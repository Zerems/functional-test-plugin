import fs from 'node:fs';
import { hostPaths } from './host.mjs';
import { availableLanguages } from './i18n.mjs';

export class ConfigError extends Error {
  constructor(errors) {
    super(errors.join('\n'));
    this.name = 'ConfigError';
    this.errors = errors;
  }
}

const TRACKER_TYPES = ['jira', 'github', 'file', 'custom'];
const TRACKERS_WITH_PROJECTS = ['jira', 'github'];
const AUTH_PRESETS = ['password-login', 'static-token', 'none', 'custom'];
const DELIVERY_MODES = ['git-log', 'tracker', 'both', 'none'];
const GIT_DELIVERY_MODES = ['git-log', 'both'];
const SESSION_MODES = ['persistent-profile', 'storage-state', 'external'];
const AUTOMATION_FRAMEWORKS = ['playwright', 'cypress', 'robotframework', 'other'];
const BROWSER_DRIVERS = ['playwright-mcp', 'cypress-mcp', 'robotframework-mcp', 'custom'];

const SPEC_PATHS = { playwright: ['tests/'], cypress: ['cypress/e2e/'], robotframework: ['tests/'] };
const RUN_COMMANDS = {
  playwright: 'npx playwright test {file}',
  cypress: 'npx cypress run --spec {file}',
  robotframework: 'robot {file}',
};
const TRACKER_ENV_VARS = { jira: ['JIRA_EMAIL', 'JIRA_API_TOKEN'], github: ['GITHUB_TOKEN'], file: [] };

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isFilled = (v) => typeof v === 'string' && v.trim() !== '';
const entries = (v) => (isObject(v) ? Object.entries(v) : []);

/** Deep copy of `raw` with every optional setting filled in. Never mutates `raw`. */
export function applyDefaults(raw) {
  const config = structuredClone(isObject(raw) ? raw : {});
  const section = (name) => (config[name] = isObject(config[name]) ? config[name] : {});

  config.language ??= 'en';

  const delivery = section('delivery');
  delivery.mode ??= TRACKERS_WITH_PROJECTS.includes(config.tracker?.type) ? 'both' : 'none';
  delivery.recentMinutes ??= 60;
  delivery.repositoriesDir ??= '..';

  const browser = section('browser');
  browser.driver ??= 'playwright-mcp';
  browser.engine ??= 'chromium';
  browser.viewport ??= '1440x900';

  for (const [, session] of entries(config.sessions)) {
    if (isObject(session)) session.mode ??= browser.driver === 'playwright-mcp' ? 'persistent-profile' : 'external';
  }

  section('testData').prefix ??= '[E2E]';
  config.pitfallsFile ??= '.claude/functional-test/pitfalls.md';

  const automation = section('automation');
  automation.excludedFile ??= '.claude/functional-test/excluded.json';
  automation.framework ??= 'playwright';
  automation.specPaths ??= [...(SPEC_PATHS[automation.framework] ?? ['tests/'])];
  if (RUN_COMMANDS[automation.framework]) automation.runCommand ??= RUN_COMMANDS[automation.framework];
  automation.branchPattern ??= 'test/{key-lower}-{slug}';

  return config;
}

// Each check receives the config and pushes "<json.path>: <message>" lines.
const checks = [
  (c, err) => c.version !== 1 && err('version', 'must be 1'),

  (c, err) => {
    const t = c.tracker;
    if (!isObject(t)) return err('tracker', 'is required');
    if (!TRACKER_TYPES.includes(t.type)) err('tracker.type', `must be one of ${TRACKER_TYPES.join(', ')}`);
    if (t.type === 'custom' && !isFilled(t.module)) err('tracker.module', 'is required for a custom tracker');
    if (TRACKERS_WITH_PROJECTS.includes(t.type) && !(Array.isArray(t.projects) && t.projects.length > 0)) {
      err('tracker.projects', `needs at least one project for a ${t.type} tracker`);
    }
  },

  (c, err) => {
    const envs = entries(c.environments);
    if (envs.length === 0) return err('environments', 'needs at least one environment');
    for (const [name, env] of envs) {
      const at = `environments.${name}`;
      if (!isFilled(env?.branch)) err(`${at}.branch`, 'is required');
      const channels = entries(env?.channels);
      if (channels.length === 0) err(`${at}.channels`, 'needs at least one channel');
      for (const [channelName, channel] of channels) {
        const cat = `${at}.channels.${channelName}`;
        if (!isFilled(channel?.url)) err(`${cat}.url`, 'is required');
        if (channel?.session !== undefined && !isObject(c.sessions?.[channel.session])) {
          err(`${cat}.session`, `session "${channel.session}" is not declared in sessions`);
        }
        if (channel?.auth !== undefined && !isObject(c.auth?.[channel.auth])) {
          err(`${cat}.auth`, `auth "${channel.auth}" is not declared in auth`);
        }
      }
    }
  },

  (c, err) => {
    for (const [name, session] of entries(c.sessions)) {
      const at = `sessions.${name}`;
      if (!isFilled(session?.mcpServer)) err(`${at}.mcpServer`, 'is required');
      if (!SESSION_MODES.includes(session?.mode)) err(`${at}.mode`, `must be one of ${SESSION_MODES.join(', ')}`);
      if (session?.mode === 'storage-state') {
        if (!isFilled(session.file)) err(`${at}.file`, 'is required for a storage-state session');
        if (!isFilled(session.command)) err(`${at}.command`, 'is required for a storage-state session');
      }
    }
  },

  (c, err) => {
    for (const [name, auth] of entries(c.auth)) {
      const at = `auth.${name}`;
      if (!AUTH_PRESETS.includes(auth?.preset)) {
        err(`${at}.preset`, `must be one of ${AUTH_PRESETS.join(', ')}`);
      } else if (auth.preset === 'password-login') {
        for (const field of ['loginPath', 'usernameEnv', 'passwordEnv']) {
          if (!isFilled(auth[field])) err(`${at}.${field}`, 'is required for password-login');
        }
      } else if (auth.preset === 'static-token' && !isFilled(auth.tokenEnv)) {
        err(`${at}.tokenEnv`, 'is required for static-token');
      }
    }
  },

  (c, err) => {
    const d = c.delivery;
    if (!DELIVERY_MODES.includes(d?.mode)) return err('delivery.mode', `must be one of ${DELIVERY_MODES.join(', ')}`);
    if (!GIT_DELIVERY_MODES.includes(d.mode)) return;
    const repos = Array.isArray(d.repositories) ? d.repositories : [];
    if (repos.length === 0) err('delivery.repositories', `needs at least one repository in ${d.mode} mode`);
    repos.forEach((repo, i) => {
      if (!isFilled(repo?.name)) err(`delivery.repositories[${i}].name`, 'is required');
      if (!isFilled(repo?.channel)) err(`delivery.repositories[${i}].channel`, 'is required');
    });
  },

  (c, err) => {
    const b = c.browser;
    if (!BROWSER_DRIVERS.includes(b?.driver)) err('browser.driver', `must be one of ${BROWSER_DRIVERS.join(', ')}`);
    if (b?.driver === 'custom' && !isFilled(b.driverMapping)) {
      err('browser.driverMapping', 'is required for a custom driver');
    }
  },

  (c, err) => {
    const framework = c.automation?.framework;
    if (!AUTOMATION_FRAMEWORKS.includes(framework)) {
      err('automation.framework', `must be one of ${AUTOMATION_FRAMEWORKS.join(', ')}`);
    }
  },

  (c, err) => {
    if (!availableLanguages().includes(c.language)) {
      err('language', `no locale file for "${c.language}" (available: ${availableLanguages().join(', ')})`);
    }
  },
];

/** Validation errors of a config already passed through applyDefaults; `[]` means valid. */
export function validateConfig(config) {
  const errors = [];
  const err = (path, message) => errors.push(`${path}: ${message}`);
  for (const check of checks) check(config, err);
  return errors;
}

/** Read, default and validate the host's config; throws ConfigError listing every problem. */
export function loadConfig(root) {
  const file = hostPaths(root).config;
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new ConfigError([`${file}: cannot be read as JSON (${error.message})`]);
  }
  const config = applyDefaults(raw);
  const errors = validateConfig(config);
  if (errors.length > 0) throw new ConfigError(errors);
  return config;
}

export function environmentOf(config, name) {
  const env = config.environments?.[name];
  if (!env) throw new Error(`unknown environment: ${name}`);
  return env;
}

export function channelsOf(config, envName) {
  return structuredClone(environmentOf(config, envName).channels ?? {});
}

/** Distinct session names used by the environment's channels, in channel order. */
export function sessionsOf(config, envName) {
  const names = Object.values(channelsOf(config, envName))
    .map((channel) => channel.session)
    .filter(Boolean);
  return [...new Set(names)];
}

/** Environment to test `key` on: byProject for its project, else the fallback, else the first environment. */
export function defaultEnvironmentFor(config, key) {
  const project = key.includes('#') ? key.split('#')[0] : key.split('-')[0];
  const { fallback, byProject } = config.defaultEnvironment ?? {};
  return byProject?.[project] ?? fallback ?? Object.keys(config.environments)[0];
}

/** Names of the environment variables the config relies on, de-duplicated in order of first appearance. */
export function requiredEnvVars(config) {
  const required = [];
  const optional = [];
  const add = (list, names) => {
    for (const name of names) if (name && !list.includes(name)) list.push(name);
  };

  const { type } = config.tracker ?? {};
  add(required, type === 'custom' ? (config.tracker.envVars ?? []) : (TRACKER_ENV_VARS[type] ?? []));

  for (const [, auth] of entries(config.auth)) {
    let names;
    if (auth.preset === 'password-login') names = [auth.usernameEnv, auth.passwordEnv];
    else if (auth.preset === 'static-token') names = [auth.tokenEnv];
    else names = auth.envVars ?? [];
    add(auth.optional ? optional : required, names);
  }
  return { required, optional };
}
