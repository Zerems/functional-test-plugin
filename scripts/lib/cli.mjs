/** Shared by the CLI scripts: flag parsing and the mapping from errors to exit codes. */
import { ConfigError } from './config.mjs';
import { MissingSecretError, TrackerError } from './errors.mjs';

/** Bad command line; its message is the usage line. Exit code 2. */
export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

const NETWORK_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT']);

/** True for a failure to reach the server (refused, unresolved, reset, timed out). */
export function isNetworkError(error) {
  return (
    error?.name === 'AbortError' ||
    error?.name === 'TimeoutError' ||
    (error instanceof TypeError && /fetch failed/i.test(error.message)) ||
    NETWORK_CODES.has(error?.cause?.code ?? error?.code)
  );
}

/** Exit code of a failure: 2 usage/config/not found, 3 secrets missing, 4 tracker or network, 1 anything else. */
export function exitCodeFor(error) {
  if (error instanceof ConfigError || error instanceof UsageError) return 2;
  if (error instanceof MissingSecretError) return 3;
  if (error instanceof TrackerError) return error.status === 404 ? 2 : 4;
  if (isNetworkError(error)) return 4;
  return 1;
}

/**
 * Prints the failure on `stderr` and returns its exit code. `notFound` replaces the
 * message of a 404 tracker error (the caller knows what was not found); `networkKey`
 * is the locale key used for network errors.
 */
export function reportError(error, t, { stderr = process.stderr, notFound, networkKey = 'cli.networkError' } = {}) {
  const code = exitCodeFor(error);
  let message = error.message;
  if (error instanceof MissingSecretError) message = t('cli.missingSecrets', { variables: error.variables.join(', ') });
  else if (error instanceof TrackerError) message = error.status === 404 && notFound ? notFound : t('cli.trackerError', { message: error.message });
  else if (code === 4) message = t(networkKey, { message: error.message });
  stderr.write(`${message}\n`);
  return code;
}

/**
 * Parses `--flag [value]` arguments. `spec` maps a flag name (without dashes) to
 * `'boolean'`, `'string'` (last one wins, default `null`) or `'list'` (repeatable,
 * default `[]`). Anything else starting with `--`, or a value-less / `--`-valued flag,
 * throws a UsageError carrying `usage`. Returns `{ flags, positionals }`.
 */
export function parseFlags(argv, spec, usage) {
  const flags = {};
  for (const [name, type] of Object.entries(spec)) flags[name] = type === 'boolean' ? false : type === 'list' ? [] : null;
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const name = arg.slice(2);
    const type = Object.hasOwn(spec, name) ? spec[name] : undefined;
    if (type === undefined) throw new UsageError(usage);
    if (type === 'boolean') {
      flags[name] = true;
      continue;
    }
    const value = argv[++i];
    if (value === undefined || value.startsWith('--')) throw new UsageError(usage);
    if (type === 'list') flags[name].push(value);
    else flags[name] = value;
  }
  return { flags, positionals };
}
