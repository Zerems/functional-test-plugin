/**
 * What is already covered or set aside among the automation candidates proposed by
 * the `[test-ticket]` comments: a spec citing the ticket key, a branch named after it,
 * or an entry in the QA exclusion file.
 */
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { ConfigError } from './config.mjs';

const DEFAULT_PATTERN = 'test/{key-lower}-{slug}';
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Regular expression matching the branches of `key` for a branch pattern made of the
 * placeholders `{key}`, `{key-lower}` and `{slug}` (any text without `/`, possibly empty:
 * the separator right before it is then optional). Anything else is literal; a leading
 * path (`origin/`, `remotes/origin/`) is tolerated.
 */
export function branchRegex(pattern, key) {
  let source = '';
  let literal = ''; // literal text not yet escaped into `source`
  const flush = () => {
    source += escapeRegex(literal);
    literal = '';
  };
  for (const part of pattern.split(/(\{key-lower\}|\{key\}|\{slug\})/)) {
    if (part === '{key}' || part === '{key-lower}') {
      flush();
      source += escapeRegex(part === '{key}' ? key : key.toLowerCase());
    } else if (part === '{slug}') {
      // The separator right before the slug goes with it: an empty slug drops both.
      const separator = /[-_./]$/.test(literal) ? literal.slice(-1) : '';
      literal = literal.slice(0, literal.length - separator.length);
      flush();
      source += separator ? `(?:${escapeRegex(separator)}[^/]*)?` : '[^/]*';
    } else literal += part;
  }
  flush();
  return new RegExp(`^(?:.*/)?${source}$`);
}

/** Files among `specPaths` citing `key` as a whole word; `[]` when nothing matches or git fails. */
export function grepSpecs(root, key, specPaths, execFile = execFileSync) {
  if (specPaths.length === 0) return [];
  // A GitHub key (`owner/repo#42`) is often cited as the bare `#42`.
  const bare = /#\d+$/.exec(key)?.[0];
  const patterns = [key, ...(bare && bare !== key ? [bare] : [])].flatMap((p) => ['-e', p]);
  try {
    const output = execFile('git', ['grep', '-l', '-w', '-F', ...patterns, '--', ...specPaths], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return output.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/** Every local and remote branch, `remotes/origin/x` and `origin/x` both written `origin/x`. */
export function gitBranches(root, execFile = execFileSync) {
  try {
    const output = execFile('git', ['branch', '-a', '--format=%(refname:short)'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return output
      .split('\n')
      .map((branch) => branch.trim().replace(/^remotes\//, ''))
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Keys already covered: `grep(key, specPaths)` finds a spec citing them, or a branch
 * matches `pattern` (also without its `origin/` prefix). `branches()` lists the branches.
 */
export function coveredKeys(keys, { specPaths, grep, branches, pattern = DEFAULT_PATTERN }) {
  const allBranches = branches();
  const names = allBranches.flatMap((branch) => (branch.startsWith('origin/') ? [branch, branch.slice('origin/'.length)] : [branch]));
  const covered = new Set();
  for (const key of keys) {
    const regex = branchRegex(pattern, key);
    if (grep(key, specPaths).length > 0 || names.some((name) => regex.test(name))) covered.add(key);
  }
  return covered;
}

/**
 * `{ key, date, reason }` entries QA set aside; `[]` when the file is absent. Legacy
 * French fields (`cle`, `motif`) are accepted. Unreadable content is a ConfigError.
 */
export function loadExclusions(path) {
  if (!existsSync(path)) return [];
  let data;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new ConfigError([`${path}: invalid JSON (${error.message})`]);
  }
  if (!Array.isArray(data) || data.some((entry) => entry === null || typeof entry !== 'object')) {
    throw new ConfigError([`${path}: must be a JSON array of { key, date, reason }`]);
  }
  return data.map((entry) => ({ key: entry.key ?? entry.cle, date: entry.date, reason: entry.reason ?? entry.motif }));
}

/** Tickets (`{ key, report }`) with at least one candidate, neither covered nor excluded. */
export function filterCandidates(tickets, covered, exclusions) {
  const excluded = new Set(exclusions.map((entry) => entry.key));
  return tickets.filter((t) => t.report?.candidates?.length > 0 && !covered.has(t.key) && !excluded.has(t.key));
}
