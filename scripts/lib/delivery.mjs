/**
 * Delivery assessment: has the ticket's work reached the environment's branch?
 *
 * Delivery = { state: 'effective'|'recent'|'absent'|'unknown', lastAt: ISO|null,
 *   evidence: string[], partialRepos: string[], staleRefs: [{ repository, lastLocalAt, mergedAt }],
 *   repositoriesTouched: string[], reason: string|null }
 * `reason` explains an `unknown` state. Git is only ever read, never fetched: the dev fetches.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Directory holding the clones: `FT_REPOS_DIR` wins over `delivery.repositoriesDir`. */
export function effectiveRepositoriesDir(config, env = process.env) {
  return env.FT_REPOS_DIR || config.delivery.repositoriesDir;
}

/** Where repository `name` lives; `"."` is the host repository itself. */
export function repositoryDir(root, repositoriesDir, name) {
  return name === '.' ? root : path.resolve(root, repositoriesDir, name);
}

const escapeEre = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const toIso = (date) => new Date(date).toISOString();
const lastSegment = (name) => String(name).split('/').pop();
const sameRepository = (a, b) => a === b || lastSegment(a) === lastSegment(b);

/**
 * Commits citing `key` on `origin/<branch>` of each configured repository, newest first.
 * A repository that is not a clone goes to `missingRepo`, one without that remote branch to
 * `missingRef`; neither is an error. `checked` lists the repositories whose ref was read and
 * `lastLocalCommitAt` their newest commit on it (to spot refs that need a `git fetch`).
 * `branchHints` are remote branches named after the key, for repositories with no hit.
 */
export function gitLogDelivery({ root, repositoriesDir, repositories, branch, key, execFile = execFileSync }) {
  const result = { hits: [], missingRef: [], missingRepo: [], branchHints: [], checked: [], lastLocalCommitAt: {} };
  const run = (dir, args) => execFile('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const ref = `origin/${branch}`;
  // The key must stand alone: WV-12 does not match WV-123.
  const pattern = `(^|[^A-Za-z0-9])${escapeEre(key)}([^0-9]|$)`;

  for (const { name, channel } of repositories) {
    const dir = repositoryDir(root, repositoriesDir, name);
    if (!fs.existsSync(path.join(dir, '.git'))) {
      result.missingRepo.push(name);
      continue;
    }
    let lastCommit;
    let log;
    try {
      lastCommit = String(run(dir, ['log', '-1', '--format=%cI', ref])).trim();
      log = String(run(dir, ['log', ref, '--extended-regexp', `--grep=${pattern}`, '-i', '--format=%H%x09%cI%x09%s']));
    } catch {
      result.missingRef.push(name);
      continue;
    }
    result.checked.push(name);
    if (lastCommit) result.lastLocalCommitAt[name] = toIso(lastCommit);
    const hits = log
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [commit, date, ...subject] = line.split('\t');
        return { repository: name, channel, commit, date: toIso(date), subject: subject.join('\t') };
      });
    result.hits.push(...hits);
    if (hits.length === 0) {
      try {
        const branches = String(run(dir, ['branch', '-r', '--list', `*${key.toLowerCase()}*`]));
        for (const line of branches.split('\n')) if (line.trim()) result.branchHints.push({ repository: name, branch: line.trim() });
      } catch {
        // hints are a convenience
      }
    }
  }
  return result;
}

/** Merged PRs into `branch`, the other branches merged PRs went to, repositories only merged elsewhere. */
export function trackerDelivery(prs, branch) {
  const mergedAll = prs.filter((p) => p.status === 'MERGED');
  const merged = mergedAll.filter((p) => p.targetBranch === branch);
  const otherTargets = [...new Set(mergedAll.map((p) => p.targetBranch).filter((target) => target !== branch))];
  const delivered = new Set(merged.map((p) => p.repository));
  const partialRepos =
    merged.length === 0 ? [] : [...new Set(mergedAll.filter((p) => !delivered.has(p.repository)).map((p) => p.repository))];
  return { merged, otherTargets, partialRepos };
}

const newest = (dates) => dates.reduce((max, d) => (max === null || d > max ? d : max), null);

function stateByAge(dates, undated, now, recentMinutes) {
  if (undated) return 'recent';
  const ageMinutes = (now.getTime() - new Date(newest(dates)).getTime()) / 60_000;
  return ageMinutes < recentMinutes ? 'recent' : 'effective';
}

function staleRefsOf(merged, lastLocalCommitAt) {
  const mergedAtByRepo = new Map();
  for (const p of merged) {
    if (!p.mergedAt) continue;
    const at = toIso(p.mergedAt);
    if (!mergedAtByRepo.has(p.repository) || at > mergedAtByRepo.get(p.repository)) mergedAtByRepo.set(p.repository, at);
  }
  const stale = [];
  for (const [repository, mergedAt] of mergedAtByRepo) {
    const local = Object.keys(lastLocalCommitAt).find((name) => sameRepository(name, repository));
    if (local !== undefined && lastLocalCommitAt[local] < mergedAt) {
      stale.push({ repository, lastLocalAt: lastLocalCommitAt[local], mergedAt });
    }
  }
  return stale;
}

/**
 * State of the delivery from git hits (`git`), tracker PRs (`tracker`, null when the tracker
 * cannot know), or both. `absent` means a check ran and found nothing; when no check could
 * run (mode none, tracker without PRs, no readable ref) the state is `unknown`.
 */
export function assessDelivery({ mode, git, tracker, branch, now = new Date(), recentMinutes }) {
  const delivery = { state: 'unknown', lastAt: null, evidence: [], partialRepos: [], staleRefs: [], repositoriesTouched: [], reason: null };
  if (mode === 'none') return { ...delivery, reason: 'mode none' };

  const useGit = mode === 'git-log' || mode === 'both';
  const useTracker = mode === 'tracker' || mode === 'both';
  const gitReadable = useGit && git !== null && (git.hits.length > 0 || git.checked.length > 0);
  const trackerReadable = useTracker && Array.isArray(tracker);
  if (!gitReadable && !trackerReadable) {
    const reasons = [];
    if (useGit) reasons.push(`no origin/${branch} ref could be read in the configured repositories`);
    if (useTracker) reasons.push('tracker cannot know pull requests');
    return { ...delivery, reason: reasons.join(' and ') };
  }

  const hits = gitReadable ? git.hits : [];
  const tracked = trackerReadable ? trackerDelivery(tracker, branch) : { merged: [], partialRepos: [] };
  delivery.evidence = [
    ...hits.map((h) => `${h.repository}: ${h.commit.slice(0, 7)} ${h.date} ${h.subject}`),
    ...tracked.merged.map(
      (p) => `PR « ${p.title} » (${p.repository}) merged into ${branch}${p.mergedAt ? ` on ${toIso(p.mergedAt)}` : ''}`,
    ),
  ];
  delivery.repositoriesTouched = [...new Set([...hits.map((h) => h.repository), ...tracked.merged.map((p) => p.repository)])];
  delivery.partialRepos = tracked.partialRepos;
  if (mode === 'both' && gitReadable) delivery.staleRefs = staleRefsOf(tracked.merged, git.lastLocalCommitAt ?? {});

  // Git, being the branch itself, speaks first; the tracker answers when git found nothing.
  const source = hits.length > 0 ? { dates: hits.map((h) => h.date), undated: false } : tracked.merged.length > 0
    ? { dates: tracked.merged.filter((p) => p.mergedAt).map((p) => toIso(p.mergedAt)), undated: tracked.merged.some((p) => !p.mergedAt) }
    : null;
  if (source === null) return { ...delivery, state: 'absent' };
  return { ...delivery, state: stateByAge(source.dates, source.undated, now, recentMinutes), lastAt: newest(source.dates) };
}

/**
 * Channels the delivery touches: those of the repositories it reached; every channel of the
 * environment when the delivery is unknown. Repository names match on their last path segment.
 */
export function technicalScope({ delivery, repositories, channels }) {
  if (delivery.state === 'unknown') return [...channels];
  const touched = delivery.repositoriesTouched ?? [];
  const scope = repositories.filter((repo) => touched.some((name) => sameRepository(name, repo.name))).map((repo) => repo.channel);
  return [...new Set(scope)];
}
