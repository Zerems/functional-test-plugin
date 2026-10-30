#!/usr/bin/env node
// Usage: preflight.mjs [--env <name>]
//   Checks that the host project is ready for /test-ticket on the environment `--env` (default:
//   defaultEnvironment.fallback, else the first environment): configuration, environment variables,
//   application repositories, .mcp.json, driver mapping, .gitignore, then the network: tracker
//   and one login per API channel. One line per check (OK | KO | WARNING - text), then
//   `--- ready` or `--- blocked`. No value of .env is ever printed.
// Exit codes: 0 ready; 1 blocked (any KO); 2 usage, unknown environment or no host project.
import fs from 'node:fs';
import { parseFlags, reportError } from './lib/cli.mjs';
import { ConfigError, loadConfig, requiredEnvVars } from './lib/config.mjs';
import { createAuth } from './lib/auth/index.mjs';
import { loadEnv } from './lib/env.mjs';
import { findHostRoot, hostPaths } from './lib/host.mjs';
import { translator } from './lib/i18n.mjs';
import { checkConfig, checkDriverMapping, checkEnvVars, checkGitignore, checkMcp, checkRepositories } from './lib/preflight.mjs';
import { redactValues } from './lib/secrets.mjs';
import { MissingSecretError, createTracker } from './lib/trackers/index.mjs';

const TIMEOUT_MS = 30_000;

/** `fetch` that gives up after 30 s, whatever signal the caller passes. */
const fetchWithTimeout = (url, init = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });

/** Text of `path`, or null when it cannot be read. */
function readOptional(path) {
  try {
    return fs.readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** Translator for the language written in a config that failed validation, `en` when unusable. */
function translatorFor(file) {
  try {
    return translator(JSON.parse(fs.readFileSync(file, 'utf8')).language ?? 'en');
  } catch {
    return translator('en');
  }
}

async function main(argv) {
  const en = translator('en');
  let flags;
  try {
    ({ flags } = parseFlags(argv, { env: 'string' }, en('preflight.usage')));
  } catch (error) {
    return reportError(error, en);
  }

  const root = findHostRoot();
  if (!root) {
    process.stdout.write(`${en('preflight.noHost')}\n`);
    return 2;
  }
  const paths = hostPaths(root);
  loadEnv(root);

  const out = [];
  let blocked = false;
  let t = translator('en');
  const emit = ({ level, key, params }) => {
    if (level === 'ko') blocked = true;
    out.push(`${t(`preflight.${level}`)} — ${t(key, params)}`);
  };
  const finish = () => {
    out.push(t(blocked ? 'preflight.blocked' : 'preflight.ready'));
    process.stdout.write(`${out.join('\n')}\n`);
    return blocked ? 1 : 0;
  };

  let config;
  try {
    config = loadConfig(root);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    t = translatorFor(paths.config);
    emit(checkConfig(error.errors));
    return finish();
  }
  t = translator(config.language);

  const envName = flags.env ?? config.defaultEnvironment?.fallback ?? Object.keys(config.environments)[0];
  if (!Object.hasOwn(config.environments, envName)) {
    process.stderr.write(`${t('cli.unknownEnv', { env: envName, expected: Object.keys(config.environments).join(', ') })}\n`);
    return 2;
  }

  const env = process.env;
  const varsOf = (partial) => {
    const { required, optional } = requiredEnvVars(partial);
    return [...required, ...optional];
  };
  const absent = (names) => names.some((name) => !env[name]);
  const secretValues = varsOf(config).map((name) => env[name]);
  const safe = (error) => redactValues(String(error.message), secretValues);

  for (const result of [
    checkConfig([]),
    checkEnvVars(config, env),
    checkRepositories(config, root, undefined, env),
    checkMcp(config, envName, readOptional(paths.mcp), root),
    checkDriverMapping(config, root),
    checkGitignore(readOptional(paths.gitignore)),
  ].flat()) {
    emit(result);
  }

  // Network checks: skipped when the variables they need were just reported missing.
  if (config.tracker.type !== 'file' && !absent(varsOf({ ...config, auth: {} }))) {
    try {
      const tracker = await createTracker(config, env, { fetchImpl: fetchWithTimeout, root });
      emit({ level: 'ok', key: 'preflight.trackerOk', params: { who: await tracker.whoami() } });
    } catch (error) {
      const message = error instanceof MissingSecretError ? error.message : safe(error);
      emit({ level: 'ko', key: 'preflight.trackerUnreachable', params: { message } });
    }
  }

  for (const channel of Object.values(config.environments[envName].channels)) {
    if (channel.auth === undefined) continue;
    const section = config.auth[channel.auth];
    if (absent(varsOf({ tracker: { type: 'file' }, auth: { [channel.auth]: section } }))) continue;
    const params = { auth: channel.auth, env: envName };
    try {
      const auth = await createAuth(channel.auth, section, env, { fetchImpl: fetchWithTimeout, root });
      await auth.authenticate(channel.url.replace(/\/+$/, ''));
      emit({ level: 'ok', key: 'preflight.authOk', params });
    } catch (error) {
      emit({ level: section.optional ? 'warn' : 'ko', key: 'preflight.authFailed', params: { ...params, message: safe(error) } });
    }
  }

  return finish();
}

process.exitCode = await main(process.argv.slice(2));
