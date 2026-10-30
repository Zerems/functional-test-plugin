import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildDossier, renderDossier, latestReplayText } from './dossier.mjs';
import { translator } from './i18n.mjs';
import { createFileTracker } from './trackers/file.mjs';
import { createTmpRepo } from './test-helpers/tmp-git.mjs';
import { formatComment, MARKER } from './comment.mjs';

const NOW = new Date('2026-10-30T12:00:00Z');
const en = translator('en');
const fr = translator('fr');

const example = JSON.parse(fs.readFileSync(new URL('../../templates/config.example.json', import.meta.url), 'utf8'));
/** Example config, delivery read from the tracker's pull requests (no git needed). */
const baseConfig = (over = {}) => ({ ...example, language: 'en', delivery: { mode: 'tracker', recentMinutes: 60, repositoriesDir: '..', repositories: example.delivery.repositories }, ...over });

const html = (content) => ({ format: 'html', content });
const makeIssue = (over = {}) => ({
  key: 'WV-12',
  id: '10012',
  title: 'Filter candidates',
  status: 'Test',
  type: 'Story',
  url: 'https://tracker.example.com/browse/WV-12',
  labels: ['front'],
  parent: { key: 'WV-1', title: 'Epic' },
  links: [{ type: 'relates to', key: 'WV-7', title: 'Other' }],
  body: html('<h3>Acceptance criteria</h3><ul><li>Filter by city</li><li><s>Filter by age</s></li></ul>'),
  comments: [],
  ...over,
});
const mergedPr = (over = {}) => ({
  repository: 'front-app',
  title: 'WV-12 city filter',
  sourceBranch: 'feature/wv-12',
  targetBranch: 'testing',
  status: 'MERGED',
  mergedAt: '2026-10-29T08:00:00.000Z',
  url: 'https://example.test/pr/1',
  ...over,
});
const fakeTracker = ({ issue = makeIssue(), prs = [mergedPr()], type = 'jira' } = {}) => ({
  type,
  normalizeKey: (input) => input.toUpperCase(),
  getIssue: async () => issue,
  getLinkedPullRequests: async () => prs,
});
const build = (over = {}) =>
  buildDossier({
    config: baseConfig(),
    env: {},
    input: 'wv-12',
    envForced: null,
    tracker: fakeTracker(),
    deps: { now: NOW, root: '/unused' },
    ...over,
  });

const report = (over = {}) => ({
  v: 1,
  env: 'testing',
  date: '2026-10-28 10:00',
  verdict: 'KO',
  delivery: 'effective',
  constraints: 'none',
  cases: [
    { id: 'T1', priority: 'P1', title: 'City filter', result: 'OK' },
    { id: 'T2', priority: 'P2', title: 'Empty city', result: 'KO', detail: 'error 500' },
  ],
  notPlayed: 'none',
  data: 'none',
  candidates: [],
  ...over,
});

test('buildDossier deduces env from key and marks forced', async () => {
  const deduced = await build({ input: 'prjs-3', tracker: fakeTracker({ issue: makeIssue({ key: 'PRJS-3' }), prs: [mergedPr({ targetBranch: 'demo' })] }) });
  assert.equal(deduced.envName, 'demo');
  assert.equal(deduced.envDefault, 'demo');
  assert.equal(deduced.envForced, false);
  assert.deepEqual(deduced.warnings, []);

  const forced = await build({ input: 'prjs-3', envForced: 'testing', tracker: fakeTracker({ issue: makeIssue({ key: 'PRJS-3' }) }) });
  assert.equal(forced.envName, 'testing');
  assert.equal(forced.envDefault, 'demo');
  assert.equal(forced.envForced, true);
  assert.ok(forced.warnings.some((w) => w.includes('forced to "testing"')));
});

test('buildDossier returns stop when status is doNotTest', async () => {
  const dossier = await build({ tracker: fakeTracker({ issue: makeIssue({ status: 'Pas un bug' }) }) });
  assert.equal(dossier.stop, true);
  assert.equal(dossier.warnings.length, 1);
  assert.match(dossier.warnings[0], /do not test/);
});

test('buildDossier assembles criteria, delivery, scope and replays', async () => {
  const comment = { author: 'qa', date: '2026-10-28T10:00:00.000Z', body: { format: 'text', content: formatComment(report(), en) } };
  const dossier = await build({ tracker: fakeTracker({ issue: makeIssue({ comments: [comment] }) }) });
  assert.deepEqual(dossier.criteria.map((c) => [c.number, c.text, c.struck]), [[1, 'Filter by city', false], [2, 'Filter by age', true]]);
  assert.equal(dossier.delivery.state, 'effective');
  assert.deepEqual(dossier.scope, ['front']);
  assert.equal(dossier.prs.length, 1);
  assert.deepEqual(dossier.replays.map((r) => r.verdict), ['KO']);
  assert.equal(dossier.stop, false);
});

test('buildDossier in git-log mode matches the host repository "." through root', async () => {
  const host = createTmpRepo({ branch: 'main' });
  try {
    const sha = host.commit('WV-12 city filter', { date: '2026-10-29T08:00:00Z' });
    host.setRemoteRef('testing', sha);
    const config = baseConfig({
      delivery: { mode: 'git-log', recentMinutes: 60, repositoriesDir: '..', repositories: [{ name: '.', channel: 'front' }, { name: 'backend-api', channel: 'api' }] },
    });
    const dossier = await build({ config, deps: { now: NOW, root: host.dir } });
    assert.equal(dossier.delivery.state, 'effective');
    assert.deepEqual(dossier.scope, ['front']);
  } finally {
    host.cleanup();
  }
});

test('buildDossier drops the host repository PRs only when "." is not a delivery repository', async () => {
  const prs = [mergedPr(), mergedPr({ repository: 'my-tests', title: 'WV-12 tests' })];
  const pureTests = await build({ tracker: fakeTracker({ prs }), deps: { now: NOW, root: '/work/my-tests' } });
  assert.deepEqual(pureTests.prs.map((p) => p.repository), ['front-app']);
  assert.deepEqual(pureTests.delivery.repositoriesTouched, ['front-app']);

  const config = baseConfig({
    delivery: { mode: 'tracker', recentMinutes: 60, repositoriesDir: '..', repositories: [{ name: '.', channel: 'front' }, { name: 'backend-api', channel: 'api' }] },
  });
  const declared = await build({ config, tracker: fakeTracker({ prs }), deps: { now: NOW, root: '/work/my-tests' } });
  assert.deepEqual(declared.prs.map((p) => p.repository), ['front-app', 'my-tests']);
  assert.deepEqual(declared.delivery.repositoriesTouched, ['front-app', 'my-tests']);
});

test('the dossier reports unread repositories and branch hints', async () => {
  const gitLog = () => ({
    hits: [],
    missingRef: ['backend-api'],
    missingRepo: ['mobile-app'],
    branchHints: [{ repository: 'front-app', branch: 'origin/feature/wv-12-filter' }],
    checked: ['front-app'],
    lastLocalCommitAt: {},
    slugs: {},
  });
  const config = baseConfig({ delivery: { ...example.delivery, mode: 'git-log', recentMinutes: 60 } });
  const dossier = await build({ config, deps: { now: NOW, root: '/unused', gitLog } });
  assert.equal(dossier.delivery.state, 'absent');
  assert.deepEqual(dossier.delivery.unreadRepositories, [
    { repository: 'backend-api', reason: 'missing-ref' },
    { repository: 'mobile-app', reason: 'missing-repo' },
  ]);
  assert.deepEqual(dossier.delivery.branchHints, [{ repository: 'front-app', branch: 'origin/feature/wv-12-filter' }]);
  assert.ok(dossier.warnings.some((w) => w.startsWith('backend-api: origin/testing could not be read')));
  assert.ok(dossier.warnings.some((w) => w.startsWith('mobile-app: origin/testing could not be read')));
  const text = renderDossier(dossier, en, { now: NOW });
  assert.match(text, /^Could not read origin\/testing in backend-api \(no such remote branch\)\.$/m);
  assert.match(text, /^Could not read origin\/testing in mobile-app \(not a git clone\)\.$/m);
  assert.match(text, /^Branches citing the key \(not merged\): front-app: origin\/feature\/wv-12-filter$/m);
  const french = renderDossier(dossier, fr, { now: NOW });
  assert.match(french, /Impossible de lire origin\/testing dans backend-api/);
  assert.match(french, /Branches citant la clé \(non mergées\) : front-app/);
});

test('buildDossier in file mode yields delivery unknown and no replay', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-dossier-'));
  try {
    fs.writeFileSync(path.join(dir, 'ticket.md'), '# Login page\n\n## Acceptance criteria\n\n- Shows an error on a bad password\n- Locks after 5 attempts\n');
    const config = { ...baseConfig(), tracker: { type: 'file' }, delivery: { mode: 'none', recentMinutes: 60, repositoriesDir: '..' } };
    const dossier = await buildDossier({ config, env: {}, input: './ticket.md', envForced: null, tracker: createFileTracker(dir), deps: { now: NOW, root: dir } });
    assert.equal(dossier.issue.key, 'ticket');
    assert.equal(dossier.criteria.length, 2);
    assert.equal(dossier.delivery.state, 'unknown');
    assert.equal(dossier.prs, null);
    assert.deepEqual(dossier.replays, []);
    assert.equal(dossier.envName, 'testing');
    assert.match(renderDossier(dossier, en, { now: NOW }), /Delivery not verified/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('buildDossier rejects an unknown forced environment', async () => {
  await assert.rejects(build({ envForced: 'prod' }), /unknown environment: prod/);
});

test('renderDossier lists struck criteria as out of scope', async () => {
  const text = renderDossier(await build(), en, { now: NOW });
  assert.match(text, /^# WV-12 — Filter candidates$/m);
  assert.match(text, /^1\. Filter by city$/m);
  assert.match(text, /^2\. ~~Filter by age~~ \(struck, out of scope\)$/m);
});

test('renderDossier in fr uses French headings', async () => {
  const dossier = await build({ config: baseConfig({ language: 'fr' }) });
  const text = renderDossier(dossier, fr, { now: NOW });
  for (const heading of ['## Critères d’acceptation', '## Description', '## Commentaires', '## Pull requests', '## Livraison sur testing', '## Rejeu', '## Avertissements']) {
    assert.ok(text.includes(heading), heading);
  }
  assert.match(text, /aucun commentaire \[test-ticket\] pour cet env/);
});

test('renderDossier shows delivery lines, evidence and the mobile-only notice', async () => {
  const recent = await build({ tracker: fakeTracker({ prs: [mergedPr({ mergedAt: '2026-10-30T11:30:00.000Z' })] }) });
  const text = renderDossier(recent, en, { now: NOW });
  assert.match(text, /^## Delivery on testing$/m);
  assert.match(text, /recent: .*30 min/);
  assert.match(text, /^- front-app · PR · 2026-10-30 11:30 · WV-12 city filter$/m);
  assert.match(text, /Technical scope: front/);

  const mobile = await build({ tracker: fakeTracker({ prs: [mergedPr({ repository: 'mobile-app' })] }) });
  assert.match(renderDossier(mobile, en, { now: NOW }), /Mobile only: not testable by this skill\./);

  const absent = await build({ tracker: fakeTracker({ prs: [] }) });
  assert.match(renderDossier(absent, en, { now: NOW }), /absent: .*testing/);
});

test('renderDossier omits [test-ticket] comments from the comments and offers the replay plan', async () => {
  const comments = [
    { author: 'dev', date: '2026-10-27T09:15:00.000Z', body: { format: 'text', content: 'Please check\nthe empty case' } },
    { author: 'qa', date: '2026-10-28T10:00:00.000Z', body: { format: 'text', content: formatComment(report(), en) } },
  ];
  const text = renderDossier(await build({ tracker: fakeTracker({ issue: makeIssue({ comments }) }) }), en, { now: NOW });
  assert.match(text, /^- 2026-10-27 09:15 dev : Please check \/ the empty case$/m);
  assert.doesNotMatch(text, /^- 2026-10-28 10:00 qa/m);
  assert.match(text, /^- 2026-10-28 10:00 · verdict KO · 2 cases : T1 OK, T2 KO$/m);
  assert.match(text, /^ {2}- T2 \(P2\) Empty city$/m);
  assert.match(text, /--replay-text/);
});

test('renderDossier shows the no-criteria notice and empty sections', async () => {
  const issue = makeIssue({ body: { format: 'text', content: '' }, labels: [], parent: null, links: [] });
  const text = renderDossier(await build({ tracker: fakeTracker({ issue, prs: [] }) }), en, { now: NOW });
  assert.match(text, /no criteria detected/);
  assert.match(text, /^## Description\n\(empty\)$/m);
  assert.doesNotMatch(text, /^Parent/m);
});

test('latestReplayText returns the newest [test-ticket] comment of the env, verbatim', () => {
  const older = formatComment(report({ date: '2026-10-27 10:00' }), en);
  const newer = formatComment(report({ date: '2026-10-28 10:00' }), en);
  const other = formatComment(report({ env: 'demo' }), en);
  const comments = [
    { author: 'qa', date: '2026-10-28T10:00:00.000Z', body: { format: 'text', content: newer } },
    { author: 'qa', date: '2026-10-27T10:00:00.000Z', body: { format: 'text', content: older } },
    { author: 'qa', date: '2026-10-29T10:00:00.000Z', body: { format: 'text', content: other } },
    { author: 'dev', date: '2026-10-30T10:00:00.000Z', body: { format: 'text', content: 'no marker' } },
  ];
  const text = latestReplayText({ comments }, 'testing');
  assert.equal(text, newer);
  assert.ok(text.startsWith(MARKER));
  assert.equal(latestReplayText({ comments: [] }, 'testing'), null);
});
