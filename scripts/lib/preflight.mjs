/**
 * Preflight checks: is the host project set up to run /test-ticket? Pure functions: each returns
 * `{ level: 'ok'|'ko'|'warn', key, params }` (or an array of them, empty when the check does not
 * apply); `key` is a `preflight.*` locale key and `params` its placeholders. Reading files and the
 * network checks are the CLI's job. No value of the environment is ever put in a result, only names.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { effectiveRepositoriesDir, repositoryDir } from './delivery.mjs';
import { requiredEnvVars, sessionsOf } from './config.mjs';
import { profileDir } from './session.mjs';

const line = (level, key, params = {}) => ({ level, key, params });

/** The configuration, valid or not (`errors` come from validateConfig / ConfigError). */
export function checkConfig(errors) {
  return errors.length === 0 ? line('ok', 'preflight.configValid') : line('ko', 'preflight.configInvalid', { errors: errors.join('; ') });
}

/** Required variables missing → ko; optional ones missing → warn; everything present → ok. */
export function checkEnvVars(config, env) {
  const { required, optional } = requiredEnvVars(config);
  const missing = required.filter((name) => !env[name]);
  const optionalMissing = optional.filter((name) => !env[name]);
  const out = [];
  if (missing.length > 0) out.push(line('ko', 'preflight.envMissing', { names: missing.join(', ') }));
  else out.push(line('ok', 'preflight.envPresent'));
  if (optionalMissing.length > 0) out.push(line('warn', 'preflight.envOptionalMissing', { names: optionalMissing.join(', ') }));
  return out;
}

/**
 * Clones of the delivery repositories, only relevant when git is read (`git-log`: ko, `both`: warn
 * as the tracker can take over). `"."` (the host repository) is always present.
 */
export function checkRepositories(config, root, exists = existsSync, env = process.env) {
  const { mode, repositories = [] } = config.delivery;
  if (mode !== 'git-log' && mode !== 'both') return [];
  const dir = effectiveRepositoriesDir(config, env);
  const shown = path.resolve(root, dir);
  const absent = repositories
    .filter((repository) => repository.name !== '.' && !exists(path.join(repositoryDir(root, dir, repository.name), '.git')))
    .map((repository) => repository.name);
  if (absent.length === 0) return [line('ok', 'preflight.reposPresent', { dir: shown })];
  return [line(mode === 'git-log' ? 'ko' : 'warn', 'preflight.reposMissing', { dir: shown, names: absent.join(', ') })];
}

/** Value of the last `--flag value` / `--flag=value` in `args`, or null. */
function flagValue(args, flag) {
  let found = null;
  args.forEach((arg, i) => {
    if (arg === flag) found = typeof args[i + 1] === 'string' ? args[i + 1] : null;
    else if (typeof arg === 'string' && arg.startsWith(`${flag}=`)) found = arg.slice(flag.length + 1);
  });
  return found;
}

/** What the Playwright MCP server of a session must be started with, or null when nothing is expected. */
function playwrightExpectation(config, root, sessionName) {
  const session = config.sessions[sessionName];
  if (config.browser.driver !== 'playwright-mcp') return null;
  if (session.mode === 'persistent-profile') return { flag: '--user-data-dir', path: profileDir(root, sessionName) };
  if (session.mode === 'storage-state') return { flag: '--storage-state', path: path.resolve(root, session.file) };
  return null;
}

/**
 * The MCP servers the environment needs, read from the text of `.mcp.json` (null when the file is
 * absent): nothing when no server is needed, else one line per session's server and one for `automation.testMcpServer`. A server must be
 * declared; with the Playwright driver its profile directory / storage-state file argument must
 * point where the session expects it.
 */
export function checkMcp(config, envName, mcpJsonText, root) {
  const needed = sessionsOf(config, envName).map((name) => ({ server: config.sessions[name].mcpServer, expectation: playwrightExpectation(config, root, name) }));
  if (config.automation?.testMcpServer) needed.push({ server: config.automation.testMcpServer, expectation: null });
  if (needed.length === 0) return [];
  if (mcpJsonText === null || mcpJsonText === undefined) return [line('ko', 'preflight.mcpFileMissing')];
  let servers;
  try {
    const parsed = JSON.parse(mcpJsonText);
    servers = parsed?.mcpServers && typeof parsed.mcpServers === 'object' ? parsed.mcpServers : {};
  } catch {
    // The parse error quotes the start of the file, which may hold tokens: say nothing about it.
    return [line('ko', 'preflight.mcpFileInvalid')];
  }

  const check = (server, expectation) => {
    if (!Object.hasOwn(servers, server)) return line('ko', 'preflight.mcpMissing', { server });
    if (expectation) {
      const args = Array.isArray(servers[server]?.args) ? servers[server].args : [];
      const actual = flagValue(args, expectation.flag);
      if (actual === null || path.resolve(root, actual) !== expectation.path) {
        return line('ko', 'preflight.mcpMismatch', { server, expected: `${expectation.flag} ${expectation.path}` });
      }
    }
    return line('ok', 'preflight.mcpOk', { server });
  };

  return needed.map(({ server, expectation }) => check(server, expectation));
}

export const IGNORED = {
  '.env': ['.env', '/.env', '.env*', '/.env*'],
  '.auth/': ['.auth', '.auth/', '/.auth', '/.auth/', '.auth/*', '/.auth/*'],
};

/** Warns when `.gitignore` (its text, null when absent) does not cover `.env` and `.auth/`. */
export function checkGitignore(text) {
  const entries = new Set((text ?? '').split(/\r?\n/).map((l) => l.trim()));
  const uncovered = Object.keys(IGNORED).filter((name) => !IGNORED[name].some((pattern) => entries.has(pattern)));
  return uncovered.length === 0 ? [] : [line('warn', 'preflight.gitignore', { names: uncovered.join(', ') })];
}

/** A `custom` browser driver is described by a mapping file, which must exist. */
export function checkDriverMapping(config, root, exists = existsSync) {
  if (config.browser.driver !== 'custom') return [];
  const file = path.resolve(root, config.browser.driverMapping);
  return exists(file) ? [] : [line('ko', 'preflight.driverMappingMissing', { path: file })];
}
