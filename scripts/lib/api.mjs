/**
 * Authenticated API calls: command-line parsing, API channel resolution, token cache
 * under `.auth/` (gitignored, one file per environment, auth and account) and the call
 * itself with one re-authentication on 401. A token only ever leaves this module in the
 * request headers.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { UsageError, parseFlags } from './cli.mjs';
import { hostPaths } from './host.mjs';

const MARGIN_MS = 60_000;
const TIMEOUT_MS = 60_000;

export const API_USAGE =
  'usage: api.mjs --env <name> [--channel <name>] [--auth <name>] [--header K=V]... [--credentials <file>] [--body <json|@file>] [--raw] <METHOD> <path>';

/**
 * Command line → `{ env, auth, channel, context, method, path, body, raw, credentialsFile }`.
 * `--header K=V` (repeatable) fills `context`; `body` stays the raw `<json|@file>` argument.
 * Throws a UsageError carrying `usage` for anything malformed.
 */
export function parseApiArgs(argv, usage = API_USAGE) {
  const { flags, positionals } = parseFlags(
    argv,
    { env: 'string', auth: 'string', channel: 'string', header: 'list', credentials: 'string', body: 'string', raw: 'boolean' },
    usage,
  );
  const [method, requestPath] = positionals;
  if (!flags.env || positionals.length !== 2 || !requestPath.startsWith('/')) throw new UsageError(usage);
  const context = {};
  for (const header of flags.header) {
    const at = header.indexOf('=');
    if (at < 1) throw new UsageError(usage);
    context[header.slice(0, at)] = header.slice(at + 1);
  }
  return {
    env: flags.env,
    auth: flags.auth,
    channel: flags.channel,
    context,
    method: method.toUpperCase(),
    path: requestPath,
    body: flags.body,
    raw: flags.raw,
    credentialsFile: flags.credentials,
  };
}

/**
 * The environment's API channel: the one named by `channel`, else the only channel that
 * declares an `auth`. `auth` overrides the channel's auth name. Throws a UsageError
 * (messages from `t`) when the choice is ambiguous or unknown.
 */
export function resolveApiChannel(config, envName, { channel = null, auth = null } = {}, t) {
  const channels = config.environments[envName].channels;
  const apiChannels = Object.keys(channels).filter((name) => channels[name].auth !== undefined);
  let channelName = channel;
  if (channelName === null) {
    if (apiChannels.length === 0) throw new UsageError(t('api.noApiChannel', { env: envName }));
    if (apiChannels.length > 1) throw new UsageError(t('api.severalApiChannels', { env: envName, channels: apiChannels.join(', ') }));
    [channelName] = apiChannels;
  } else if (!Object.hasOwn(channels, channelName)) {
    throw new UsageError(t('api.unknownChannel', { channel: channelName, expected: Object.keys(channels).join(', ') }));
  }
  const authName = auth ?? channels[channelName].auth;
  if (authName === undefined) throw new UsageError(t('api.channelNoAuth', { channel: channelName }));
  if (!Object.hasOwn(config.auth ?? {}, authName)) {
    throw new UsageError(t('api.unknownAuth', { auth: authName, expected: Object.keys(config.auth ?? {}).join(', ') }));
  }
  return { channelName, apiUrl: channels[channelName].url.replace(/\/+$/, ''), authName };
}

/** `<root>/.auth/api-<env>-<auth>[-<sha12 of username>].json`. */
export function tokenCachePath(root, envName, authName, username = null) {
  const safe = (part) => String(part).replace(/[^A-Za-z0-9._-]/g, '_');
  const suffix = username ? `-${createHash('sha256').update(username).digest('hex').slice(0, 12)}` : '';
  return path.join(hostPaths(root).authDir, `api-${safe(envName)}-${safe(authName)}${suffix}.json`);
}

/** Token still usable: present and more than 60 s from its expiry. */
export function tokenValid(cache, now = new Date()) {
  if (!cache?.token || !cache.expiresAt) return false;
  return new Date(cache.expiresAt).getTime() - now.getTime() > MARGIN_MS;
}

/** Whether a token is worth caching: static-token and none read their credential afresh each time. */
export const cachesToken = (auth) => auth.preset !== 'static-token' && auth.preset !== 'none';

/** `{ token, expiresAt }` read from `file`, `{}` when absent or unreadable. */
export function readTokenCache(file) {
  try {
    const { token, expiresAt } = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { token, expiresAt };
  } catch {
    return {};
  }
}

export function writeTokenCache(file, { token, expiresAt }) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ token, expiresAt }), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

async function readBody(response) {
  const text = await response.text();
  if (text.length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Authenticated request. `cache` (`{ token, expiresAt }`) is read, and mutated when a new
 * token is obtained; `credentials` (`{ username, password }`) replace the auth's environment
 * variables; `body` is a JSON string. A 401 triggers one re-authentication and one retry.
 * Returns `{ status, body (parsed JSON | string | null), durationMs }`.
 */
export async function call({ apiUrl, auth, method, path: requestPath, body = null, context = {}, cache = {}, credentials = null, fetchImpl = fetch }) {
  const login = async () => {
    const { token, expiresAt } = await auth.authenticate(apiUrl, credentials);
    cache.token = token;
    cache.expiresAt = expiresAt;
  };
  if (!tokenValid(cache)) await login();

  const request = async () => {
    const headers = { Accept: 'application/json' };
    if (body !== null) headers['Content-Type'] = 'application/json';
    Object.assign(headers, auth.headers({ token: cache.token, context }));
    const started = Date.now();
    const response = await fetchImpl(`${apiUrl}${requestPath}`, {
      method,
      headers,
      body: body ?? undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { status: response.status, body: await readBody(response), durationMs: Date.now() - started };
  };

  let result = await request();
  if (result.status === 401) {
    await login();
    result = await request();
  }
  return result;
}
