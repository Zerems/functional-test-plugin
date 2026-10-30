#!/usr/bin/env node
// Usage: api.mjs --env <name> [--channel <name>] [--auth <name>] [--header K=V]...
//                [--credentials <file>] [--body <json|@file>] [--raw] <METHOD> <path>
//   Authenticated call to the environment's API channel (the only channel with an `auth`,
//   else --channel). Prints `<status> <METHOD> <path> (<ms> ms)` then the body, secrets
//   masked (`--raw`: compact JSON on one line). Tokens are cached under .auth/.
//   --header K=V      extra request header (repeatable), applied after the auth's own
//   --credentials     JSON file { "username", "password" } replacing the auth's variables
// Exit codes: 0 answer received (a 4xx is a test result); 5 answer is a 5xx; 1 authentication
// failed or anything else; 2 usage or config; 3 secrets missing; 4 network error.
import fs from 'node:fs';
import { call, cachesToken, parseApiArgs, readTokenCache, resolveApiChannel, tokenCachePath, writeTokenCache } from './lib/api.mjs';
import { createAuth } from './lib/auth/index.mjs';
import { UsageError, reportError } from './lib/cli.mjs';
import { ConfigError, loadConfig, requiredEnvVars } from './lib/config.mjs';
import { loadEnv } from './lib/env.mjs';
import { findHostRoot } from './lib/host.mjs';
import { translator } from './lib/i18n.mjs';
import { maskSecrets, redactValues } from './lib/secrets.mjs';

/** The `{ username, password }` of a credentials file; UsageError when unreadable or incomplete. */
function readCredentials(file, t) {
  let credentials;
  try {
    credentials = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new UsageError(t('api.credentialsUnreadable', { file }));
  }
  if (!credentials?.username || !credentials.password) throw new UsageError(t('api.credentialsIncomplete', { file }));
  return { username: credentials.username, password: credentials.password };
}

function readBody(body, t) {
  if (body === null || !body.startsWith('@')) return body;
  try {
    return fs.readFileSync(body.slice(1), 'utf8');
  } catch {
    throw new UsageError(t('api.bodyUnreadable', { file: body.slice(1) }));
  }
}

/**
 * Values that must never be printed: the token, the credentials in use, the auth's environment
 * variables and every variable the configuration requires (tracker tokens included).
 */
function secretValues(config, section, credentials, token) {
  const { required, optional } = requiredEnvVars(config);
  const names = [section.usernameEnv, section.passwordEnv, section.tokenEnv, ...required, ...optional];
  return [token, credentials?.username, credentials?.password, ...names.map((name) => name && process.env[name])];
}

/**
 * The body as printed, the known secret values redacted: a string as is, an object with its
 * secret-looking fields masked, pretty-printed (compact with --raw).
 */
function render(body, raw, secrets) {
  if (typeof body === 'string') return redactValues(body, secrets);
  const masked = maskSecrets(body);
  return redactValues(raw ? JSON.stringify(masked) : JSON.stringify(masked, null, 2), secrets);
}

async function main(argv) {
  const en = translator('en');
  const say = (message) => process.stderr.write(`${message}\n`);
  let options;
  try {
    options = parseApiArgs(argv, en('api.usage'));
  } catch (error) {
    return reportError(error, en);
  }

  const root = findHostRoot();
  if (!root) {
    say(en('cli.noHost'));
    return 2;
  }
  let config;
  try {
    config = loadConfig(root);
  } catch (error) {
    if (error instanceof ConfigError) return reportError(error, en);
    throw error;
  }
  loadEnv(root);
  const t = translator(config.language);

  if (!config.environments[options.env]) {
    say(t('cli.unknownEnv', { env: options.env, expected: Object.keys(config.environments).join(', ') }));
    return 2;
  }

  try {
    const { apiUrl, authName } = resolveApiChannel(config, options.env, options, t);
    const credentials = options.credentialsFile ? readCredentials(options.credentialsFile, t) : null;
    const body = readBody(options.body, t);
    const auth = await createAuth(authName, config.auth[authName], process.env, { root });

    const cacheFile = cachesToken(auth) ? tokenCachePath(root, options.env, auth.cacheKey(credentials)) : null;
    const cache = cacheFile ? readTokenCache(cacheFile) : {};
    const tokenBefore = cache.token;

    const result = await call({ apiUrl, auth, method: options.method, path: options.path, body, context: options.context, cache, credentials });
    if (cacheFile && cache.token !== tokenBefore) writeTokenCache(cacheFile, cache);

    process.stdout.write(`${result.status} ${options.method} ${options.path} (${result.durationMs} ms)\n`);
    if (result.body !== null) process.stdout.write(`${render(result.body, options.raw, secretValues(config, config.auth[authName], credentials, cache.token))}\n`);
    return result.status >= 500 ? 5 : 0;
  } catch (error) {
    return reportError(error, t);
  }
}

process.exitCode = await main(process.argv.slice(2));
