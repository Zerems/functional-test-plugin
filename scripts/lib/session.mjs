/**
 * Browser session handling. A session is one of three modes:
 *  - persistent-profile: the browser MCP server keeps its own profile folder (`.auth/profiles/<name>`);
 *  - storage-state: a Playwright-style storageState file produced by a setup command, valid for one
 *    host and for a limited time;
 *  - external: managed outside the plugin (e.g. the user's own browser), never checked.
 * Pure functions: reading files and spawning the setup command is the CLI's job.
 */
import path from 'node:path';
import { ConfigError, environmentOf } from './config.mjs';

export const MAX_AGE_HOURS = 8;

/**
 * A storageState is valid when it exists, names the target host (a recorded origin, or a cookie
 * whose domain is exactly the host) and is younger than `maxAgeHours`; host cookies that are all
 * expired invalidate it. A parent-domain cookie (`.example.com`) is shared by every environment
 * and says nothing. Returns `{ valid, reason }` where `reason` is a code: `absent`, `wrong-host`
 * (with `host` and `known`), `cookies-expired`, `too-old` (with `hours`), `''` when valid.
 * (`unreadable` is raised by the caller, which reads the file.)
 */
export function validateStorageState(state, host, now, mtime, maxAgeHours = MAX_AGE_HOURS) {
  if (!state) return { valid: false, reason: 'absent' };
  const hostname = new URL(host).hostname;
  const origins = (state.origins ?? []).map((o) => o.origin);
  const cookies = state.cookies ?? [];
  const hostCookies = cookies.filter((c) => c.domain === hostname);
  const byOrigin = origins.includes(host);
  if (!byOrigin && hostCookies.length === 0) {
    const known = [...new Set([...origins, ...cookies.map((c) => c.domain).filter((d) => d && !d.startsWith('.'))])];
    return { valid: false, reason: 'wrong-host', host, known };
  }
  if (!byOrigin) {
    const dated = hostCookies.filter((c) => typeof c.expires === 'number' && c.expires > 0);
    if (dated.length === hostCookies.length && dated.every((c) => c.expires * 1000 <= now.getTime())) {
      return { valid: false, reason: 'cookies-expired' };
    }
  }
  const ageHours = (now.getTime() - mtime.getTime()) / 3_600_000;
  if (ageHours > maxAgeHours) return { valid: false, reason: 'too-old', hours: maxAgeHours };
  return { valid: true, reason: '' };
}

/** Profile folder of a persistent-profile session; the name is reduced to `[A-Za-z0-9._-]`. */
export function profileDir(root, sessionName) {
  let safe = String(sessionName).replace(/[^A-Za-z0-9._-]/g, '_');
  if (/^\.*$/.test(safe)) safe = `_${safe}`;
  return path.join(root, '.auth', 'profiles', safe);
}

/**
 * What a session needs on an environment: `{ mode, mcpServer, host, file?, command? }`, `host`
 * being the origin of the first channel of the environment that uses the session.
 * Throws ConfigError for an unknown environment or session, or a session no channel uses there.
 */
export function sessionPlan(config, envName, sessionName) {
  let environment;
  try {
    environment = environmentOf(config, envName);
  } catch {
    throw new ConfigError([`environments.${envName}: unknown environment`]);
  }
  const session = config.sessions?.[sessionName];
  if (!session) throw new ConfigError([`sessions.${sessionName}: unknown session`]);
  const channel = Object.values(environment.channels ?? {}).find((c) => c.session === sessionName);
  if (!channel) throw new ConfigError([`environments.${envName}: no channel uses session "${sessionName}"`]);
  const plan = { mode: session.mode, mcpServer: session.mcpServer, host: new URL(channel.url).origin };
  if (session.file !== undefined) plan.file = session.file;
  if (session.command !== undefined) plan.command = session.command;
  return plan;
}

/**
 * The setup command as `{ command, args, env }`: `plan.command` split on whitespace, the base
 * environment without `CI`, plus `FT_<CHANNEL>_URL` for every entry of `envUrls` (channel → url)
 * and `FT_ENV` when `envName` is given.
 */
export function setupCommand(plan, envUrls, envName, baseEnv = process.env) {
  const [command, ...args] = String(plan.command ?? '').trim().split(/\s+/);
  if (!command) throw new ConfigError(['session has no setup command']);
  const { CI, ...env } = baseEnv;
  for (const [channel, url] of Object.entries(envUrls ?? {})) {
    env[`FT_${channel.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_URL`] = url;
  }
  if (envName !== undefined) env.FT_ENV = envName;
  return { command, args, env };
}
