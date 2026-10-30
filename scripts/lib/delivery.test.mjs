import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assessDelivery,
  effectiveRepositoriesDir,
  gitLogDelivery,
  repositoryDir,
  technicalScope,
  trackerDelivery,
} from './delivery.mjs';
import { createTmpRepo } from './test-helpers/tmp-git.mjs';

const NOW = new Date('2026-10-30T12:00:00Z');
const minutesAgo = (m) => new Date(NOW.getTime() - m * 60_000).toISOString();

/** A repository directory named `name` inside a fresh parent dir, as `repositoriesDir` expects. */
function reposParent(...names) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-git-'));
  const repos = {};
  for (const name of names) {
    repos[name] = createTmpRepo({ parent, name });
  }
  const cleanup = () => fs.rmSync(parent, { recursive: true, force: true });
  return { parent, repos, cleanup };
}

const pr = (over = {}) => ({
  repository: 'api',
  title: 'Fix things',
  sourceBranch: 'feature/x',
  targetBranch: 'testing',
  status: 'MERGED',
  mergedAt: minutesAgo(300),
  url: 'https://example.test/pr/1',
  ...over,
});

test('repositoryDir resolves "." to the host root and honours FT_REPOS_DIR', () => {
  assert.equal(repositoryDir('/host/app', '..', '.'), '/host/app');
  assert.equal(repositoryDir('/host/app', '..', 'api'), '/host/api');
  assert.equal(repositoryDir('/host/app', 'repos', 'api'), '/host/app/repos/api');
  assert.equal(effectiveRepositoriesDir({ delivery: { repositoriesDir: '..' } }, {}), '..');
  assert.equal(effectiveRepositoriesDir({ delivery: { repositoriesDir: '..' } }, { FT_REPOS_DIR: '/srv/repos' }), '/srv/repos');
  assert.equal(repositoryDir('/host/app', effectiveRepositoriesDir({ delivery: { repositoriesDir: '..' } }, { FT_REPOS_DIR: '/srv/repos' }), 'api'), '/srv/repos/api');
});

test('gitLogDelivery finds a commit citing the key on origin/<branch>', () => {
  const { parent, repos, cleanup } = reposParent('api');
  try {
    repos.api.commit('chore: unrelated', { date: '2026-10-30T08:00:00Z' });
    const sha = repos.api.commit('WV-12 fix the login', { date: '2026-10-30T10:00:00Z' });
    repos.api.commit('WV-123 another ticket', { date: '2026-10-30T11:00:00Z' });
    const head = repos.api.commit('wv-12 follow-up (lower case)', { date: '2026-10-30T11:30:00Z' });
    repos.api.setRemoteRef('testing', head);
    const result = gitLogDelivery({
      root: '/unused',
      repositoriesDir: parent,
      repositories: [{ name: 'api', channel: 'api' }],
      branch: 'testing',
      key: 'WV-12',
    });
    assert.deepEqual(result.missingRef, []);
    assert.deepEqual(result.missingRepo, []);
    assert.deepEqual(
      result.hits.map((h) => [h.repository, h.channel, h.subject, h.date]),
      [
        ['api', 'api', 'wv-12 follow-up (lower case)', '2026-10-30T11:30:00.000Z'],
        ['api', 'api', 'WV-12 fix the login', '2026-10-30T10:00:00.000Z'],
      ],
    );
    assert.equal(result.hits[1].commit, sha);
    assert.equal(result.lastLocalCommitAt.api, '2026-10-30T11:30:00.000Z');
  } finally {
    cleanup();
  }
});

test('gitLogDelivery does not treat key characters as a pattern', () => {
  const { parent, repos, cleanup } = reposParent('api');
  try {
    repos.api.commit('fixes aXb', { date: '2026-10-30T09:00:00Z' });
    const sha = repos.api.commit('fixes a.b', { date: '2026-10-30T10:00:00Z' });
    repos.api.setRemoteRef('testing', repos.api.commit('noop', { date: '2026-10-30T11:00:00Z' }));
    const { hits } = gitLogDelivery({
      root: '/unused',
      repositoriesDir: parent,
      repositories: [{ name: 'api', channel: 'api' }],
      branch: 'testing',
      key: 'a.b',
    });
    assert.deepEqual(hits.map((h) => h.commit), [sha]);
  } finally {
    cleanup();
  }
});

test('gitLogDelivery reports missingRef for a repo without origin/<branch> and does not throw', () => {
  const { parent, repos, cleanup } = reposParent('api', 'front');
  try {
    repos.api.commit('WV-12 work', { date: '2026-10-30T10:00:00Z' });
    const head = repos.front.commit('WV-12 ui', { date: '2026-10-30T10:00:00Z' });
    repos.front.setRemoteRef('testing', head);
    // a remote branch named after the key hints at undelivered work in api
    repos.api.setRemoteRef('feature/wv-12-login', repos.api.commit('wip', { date: '2026-10-30T10:30:00Z' }));
    const result = gitLogDelivery({
      root: '/unused',
      repositoriesDir: parent,
      repositories: [
        { name: 'api', channel: 'api' },
        { name: 'front', channel: 'front' },
      ],
      branch: 'testing',
      key: 'WV-12',
    });
    assert.deepEqual(result.missingRef, ['api']);
    assert.deepEqual(result.hits.map((h) => h.repository), ['front']);
    assert.deepEqual(result.checked, ['front']);
    assert.equal(result.lastLocalCommitAt.api, undefined);
  } finally {
    cleanup();
  }
});

test('gitLogDelivery lists remote branches named after the key as hints', () => {
  const { parent, repos, cleanup } = reposParent('api');
  try {
    const sha = repos.api.commit('base', { date: '2026-10-30T10:00:00Z' });
    repos.api.setRemoteRef('testing', sha);
    repos.api.setRemoteRef('feature/wv-12-login', sha);
    const result = gitLogDelivery({
      root: '/unused',
      repositoriesDir: parent,
      repositories: [{ name: 'api', channel: 'api' }],
      branch: 'testing',
      key: 'WV-12',
    });
    assert.deepEqual(result.hits, []);
    assert.deepEqual(result.branchHints, [{ repository: 'api', branch: 'origin/feature/wv-12-login' }]);
  } finally {
    cleanup();
  }
});

test('gitLogDelivery reports missingRepo', () => {
  const { parent, repos, cleanup } = reposParent('api');
  try {
    fs.mkdirSync(path.join(parent, 'not-a-repo'));
    repos.api.setRemoteRef('testing', repos.api.commit('WV-12', { date: '2026-10-30T10:00:00Z' }));
    const result = gitLogDelivery({
      root: '/unused',
      repositoriesDir: parent,
      repositories: [
        { name: 'absent', channel: 'x' },
        { name: 'not-a-repo', channel: 'y' },
        { name: 'api', channel: 'api' },
      ],
      branch: 'testing',
      key: 'WV-12',
    });
    assert.deepEqual(result.missingRepo, ['absent', 'not-a-repo']);
    assert.equal(result.hits.length, 1);
  } finally {
    cleanup();
  }
});

test('gitLogDelivery reads the host repository from root when the name is "."', () => {
  const host = createTmpRepo();
  try {
    host.setRemoteRef('testing', host.commit('WV-12 host change', { date: '2026-10-30T10:00:00Z' }));
    const { hits } = gitLogDelivery({
      root: host.dir,
      repositoriesDir: '/does/not/matter',
      repositories: [{ name: '.', channel: 'front' }],
      branch: 'testing',
      key: 'WV-12',
    });
    assert.deepEqual(hits.map((h) => h.repository), ['.']);
  } finally {
    host.cleanup();
  }
});

test('gitLogDelivery runs git through the injected execFile', () => {
  const { parent, cleanup } = reposParent('api');
  try {
    const calls = [];
    const execFile = (file, args) => {
      calls.push([file, ...args]);
      return args.includes('log') && args.includes('--grep=(^|[^A-Za-z0-9])WV-1([^0-9]|$)')
        ? `${'a'.repeat(40)}\t2026-10-30T10:00:00+02:00\tWV-1 stub\n`
        : '';
    };
    const { hits } = gitLogDelivery({
      root: '/unused',
      repositoriesDir: parent,
      repositories: [{ name: 'api', channel: 'api' }],
      branch: 'testing',
      key: 'WV-1',
      execFile,
    });
    assert.equal(hits[0].date, '2026-10-30T08:00:00.000Z');
    assert.ok(calls.every(([file]) => file === 'git'));
    assert.ok(calls.some((c) => c.includes('origin/testing')));
  } finally {
    cleanup();
  }
});

test('trackerDelivery splits merged PRs, other targets and partially delivered repositories', () => {
  const prs = [
    pr({ repository: 'api', targetBranch: 'testing' }),
    pr({ repository: 'front', targetBranch: 'demo' }),
    pr({ repository: 'front', targetBranch: 'testing', status: 'OPEN' }),
    pr({ repository: 'bo', targetBranch: 'testing', status: 'DECLINED' }),
  ];
  const result = trackerDelivery(prs, 'testing');
  assert.deepEqual(result.merged.map((p) => p.repository), ['api']);
  assert.deepEqual(result.otherTargets, ['demo']);
  assert.deepEqual(result.partialRepos, ['front']);
  assert.deepEqual(trackerDelivery([pr({ targetBranch: 'demo' })], 'testing').partialRepos, []);
});

test('assessDelivery git-log: recent under recentMinutes, effective after', () => {
  const hit = (date) => ({ repository: 'api', channel: 'api', commit: 'abcdef1234567', date, subject: 'WV-1 x' });
  const git = (date) => ({ hits: [hit(date)], missingRef: [], missingRepo: [], branchHints: [], checked: ['api'], lastLocalCommitAt: {} });
  const recent = assessDelivery({ mode: 'git-log', git: git(minutesAgo(10)), tracker: null, branch: 'testing', now: NOW, recentMinutes: 60 });
  assert.equal(recent.state, 'recent');
  assert.equal(recent.lastAt, minutesAgo(10));
  assert.deepEqual(recent.repositoriesTouched, ['api']);
  assert.deepEqual(recent.evidence, [{ kind: 'commit', repository: 'api', sha: 'abcdef1234567', date: minutesAgo(10), title: 'WV-1 x' }]);
  const effective = assessDelivery({ mode: 'git-log', git: git(minutesAgo(61)), tracker: null, branch: 'testing', now: NOW, recentMinutes: 60 });
  assert.equal(effective.state, 'effective');
});

test('assessDelivery absent when nothing found', () => {
  const git = { hits: [], missingRef: [], missingRepo: [], branchHints: [], checked: ['api'], lastLocalCommitAt: {} };
  const result = assessDelivery({ mode: 'git-log', git, tracker: null, branch: 'testing', now: NOW, recentMinutes: 60 });
  assert.equal(result.state, 'absent');
  assert.equal(result.lastAt, null);
  assert.deepEqual(result.evidence, []);
  const byTracker = assessDelivery({ mode: 'tracker', git: null, tracker: [pr({ targetBranch: 'demo' })], branch: 'testing', now: NOW, recentMinutes: 60 });
  assert.equal(byTracker.state, 'absent');
});

test('assessDelivery is unknown when no repository could be read in git-log mode', () => {
  const git = { hits: [], missingRef: ['api'], missingRepo: ['front'], branchHints: [], checked: [], lastLocalCommitAt: {} };
  const result = assessDelivery({ mode: 'git-log', git, tracker: null, branch: 'testing', now: NOW, recentMinutes: 60 });
  assert.equal(result.state, 'unknown');
  assert.equal(result.reason, 'no-ref-readable');
});

test('assessDelivery unknown for mode none and for tracker mode with null prs', () => {
  const none = assessDelivery({ mode: 'none', git: null, tracker: null, branch: 'testing', now: NOW, recentMinutes: 60 });
  assert.equal(none.state, 'unknown');
  assert.equal(none.reason, 'mode-none');
  const tracker = assessDelivery({ mode: 'tracker', git: null, tracker: null, branch: 'testing', now: NOW, recentMinutes: 60 });
  assert.equal(tracker.state, 'unknown');
  assert.equal(tracker.reason, 'tracker-unknown');
  assert.deepEqual(tracker.evidence, []);
  assert.deepEqual(tracker.staleRefs, []);
});

test('assessDelivery tracker mode dates the delivery by the newest merge into the branch', () => {
  const prs = [pr({ mergedAt: minutesAgo(500) }), pr({ repository: 'front', mergedAt: minutesAgo(5) }), pr({ repository: 'bo', targetBranch: 'demo' })];
  const result = assessDelivery({ mode: 'tracker', git: null, tracker: prs, branch: 'testing', now: NOW, recentMinutes: 60 });
  assert.equal(result.state, 'recent');
  assert.equal(result.lastAt, minutesAgo(5));
  assert.deepEqual(result.repositoriesTouched, ['api', 'front']);
  assert.deepEqual(result.evidence[0], { kind: 'pr', repository: 'api', date: minutesAgo(500), title: 'Fix things' });
  assert.deepEqual(result.evidence[1], { kind: 'pr', repository: 'front', date: minutesAgo(5), title: 'Fix things' });
  assert.equal(assessDelivery({ mode: 'tracker', git: null, tracker: [pr({ mergedAt: null })], branch: 'testing', now: NOW, recentMinutes: 60 }).state, 'recent');
});

test('assessDelivery tracker mode reports repositories with a partial delivery', () => {
  const prs = [pr({ repository: 'api' }), pr({ repository: 'front', targetBranch: 'demo' })];
  const result = assessDelivery({ mode: 'tracker', git: null, tracker: prs, branch: 'testing', now: NOW, recentMinutes: 60 });
  assert.deepEqual(result.partialRepos, ['front']);
});

test('assessDelivery both flags staleRefs when tracker merge is newer than local ref', () => {
  const git = {
    hits: [],
    missingRef: [],
    missingRepo: [],
    branchHints: [],
    checked: ['api', 'front'],
    lastLocalCommitAt: { api: minutesAgo(600), front: minutesAgo(10) },
  };
  const prs = [pr({ repository: 'api', mergedAt: minutesAgo(30) }), pr({ repository: 'front', mergedAt: minutesAgo(120) })];
  const result = assessDelivery({ mode: 'both', git, tracker: prs, branch: 'testing', now: NOW, recentMinutes: 60 });
  assert.deepEqual(result.staleRefs, [{ repository: 'api', lastLocalAt: minutesAgo(600), mergedAt: minutesAgo(30) }]);
  assert.equal(result.state, 'recent');
});

test('assessDelivery both prefers git hits, falls back to the tracker, is unknown when neither can tell', () => {
  const hit = { repository: 'api', channel: 'api', commit: 'abcdef1234567', date: minutesAgo(400), subject: 'WV-1' };
  const git = { hits: [hit], missingRef: [], missingRepo: [], branchHints: [], checked: ['api'], lastLocalCommitAt: { api: minutesAgo(400) } };
  const both = assessDelivery({ mode: 'both', git, tracker: [pr({ mergedAt: minutesAgo(5) })], branch: 'testing', now: NOW, recentMinutes: 60 });
  assert.equal(both.state, 'recent');
  assert.equal(both.lastAt, minutesAgo(5));
  assert.equal(both.evidence.length, 2);
  const noGit = assessDelivery({ mode: 'both', git: null, tracker: [pr({ mergedAt: minutesAgo(5) })], branch: 'testing', now: NOW, recentMinutes: 60 });
  assert.equal(noGit.state, 'recent');
  const none = assessDelivery({ mode: 'both', git: null, tracker: null, branch: 'testing', now: NOW, recentMinutes: 60 });
  assert.equal(none.state, 'unknown');
  const olderPr = assessDelivery({ mode: 'both', git, tracker: [pr({ mergedAt: minutesAgo(900) })], branch: 'testing', now: NOW, recentMinutes: 60 });
  assert.equal(olderPr.state, 'effective');
  assert.equal(olderPr.lastAt, minutesAgo(400));
  const gitOnly = assessDelivery({ mode: 'both', git, tracker: null, branch: 'testing', now: NOW, recentMinutes: 60 });
  assert.equal(gitOnly.state, 'effective');
  const empty = { ...git, hits: [] };
  assert.equal(assessDelivery({ mode: 'both', git: empty, tracker: [], branch: 'testing', now: NOW, recentMinutes: 60 }).state, 'absent');
});

test('technicalScope returns channels of delivered repositories, all channels when unknown', () => {
  const repositories = [
    { name: 'api', channel: 'api' },
    { name: 'front', channel: 'front' },
    { name: 'front-admin', channel: 'front' },
    { name: 'app', channel: 'mobile' },
  ];
  const channels = ['front', 'api', 'mobile'];
  const delivered = { state: 'effective', repositoriesTouched: ['front-admin', 'acme/api'] };
  assert.deepEqual(technicalScope({ delivery: delivered, repositories, channels }), ['api', 'front']);
  assert.deepEqual(technicalScope({ delivery: { state: 'unknown', repositoriesTouched: [] }, repositories, channels }), channels);
  assert.deepEqual(technicalScope({ delivery: { state: 'absent', repositoriesTouched: [] }, repositories, channels }), []);
});

test('assessDelivery both flags a stale "." ref through its default slug', () => {
  const git = {
    hits: [],
    missingRef: [],
    missingRepo: [],
    branchHints: [],
    checked: ['.'],
    lastLocalCommitAt: { '.': minutesAgo(600) },
    slugs: { '.': 'my-app' },
  };
  const prs = [pr({ repository: 'my-app', mergedAt: minutesAgo(30) })];
  const result = assessDelivery({ mode: 'both', git, tracker: prs, branch: 'testing', now: NOW, recentMinutes: 60 });
  assert.deepEqual(result.staleRefs, [{ repository: 'my-app', lastLocalAt: minutesAgo(600), mergedAt: minutesAgo(30) }]);
});

test('gitLogDelivery maps configured names to tracker slugs, "." defaulting to the host directory name', () => {
  const { slugs } = gitLogDelivery({
    root: '/work/my-app',
    repositoriesDir: '/nowhere',
    repositories: [
      { name: '.', channel: 'front' },
      { name: 'api', channel: 'api', slug: 'acme-api' },
      { name: 'bo', channel: 'bo' },
    ],
    branch: 'testing',
    key: 'WV-1',
  });
  assert.deepEqual(slugs, { '.': 'my-app', api: 'acme-api', bo: 'bo' });
});

test('a "." repository matches tracker PRs through its default slug', () => {
  const repositories = [
    { name: '.', channel: 'front' },
    { name: 'api', channel: 'api', slug: 'acme/api-server' },
  ];
  const delivery = { state: 'recent', repositoriesTouched: ['acme/my-app', 'api-server'] };
  assert.deepEqual(technicalScope({ delivery, repositories, channels: ['front', 'api', 'mobile'], root: '/work/my-app' }), ['front', 'api']);
});

test('a touched repository matching no configured entry yields all channels', () => {
  const repositories = [{ name: 'api', channel: 'api' }];
  const delivery = { state: 'effective', repositoriesTouched: ['api', 'unlisted'] };
  assert.deepEqual(technicalScope({ delivery, repositories, channels: ['front', 'api'] }), ['front', 'api']);
});
