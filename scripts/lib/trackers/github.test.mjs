import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGithubTracker, parseLinkNext } from './github.mjs';
import { MissingSecretError, TrackerError } from './index.mjs';
import { fakeFetch } from '../test-helpers/fake-fetch.mjs';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../test-helpers/fixtures/${name}`, import.meta.url), 'utf8'));
const issueFixture = fixture('github-issue.json');
const [commentsPage1, commentsPage2] = fixture('github-comments.json');
const timelineFixture = fixture('github-timeline.json');
const searchFixture = fixture('github-search.json');

const statuses = { toTest: ['ready-for-test'], doNotTest: ['wontfix'], afterOk: 'tested-ok', afterKo: 'tested-ko' };
const trackerConfig = { type: 'github', projects: ['acme/webapp'], statuses };
const env = { GITHUB_TOKEN: 'ghp-secret' };
const create = (fetchImpl, config = trackerConfig) => createGithubTracker(config, env, { fetchImpl });
const route = (suffix, body, extra = {}) => ({
  match: (url) => url === `https://api.github.com${suffix}`,
  body,
  ...extra,
});

test('exposes the tracker contract', () => {
  const tracker = create(fakeFetch([]));
  assert.equal(tracker.type, 'github');
  assert.equal(tracker.trackerStatusesAreLabels, true);
  assert.equal(tracker.keyPattern.exec('see acme/webapp#42 now')[0], 'acme/webapp#42');
});

test('normalizeKey handles #n, owner/repo#n and issue URLs', () => {
  const tracker = create(fakeFetch([]));
  assert.equal(tracker.normalizeKey('#42'), 'acme/webapp#42');
  assert.equal(tracker.normalizeKey(' acme/api#7 '), 'acme/api#7');
  assert.equal(tracker.normalizeKey('https://github.com/acme/api/issues/7'), 'acme/api#7');
  assert.equal(tracker.normalizeKey('https://github.com/acme/api/issues/7?x=1#issuecomment-5'), 'acme/api#7');
  assert.throws(() => tracker.normalizeKey('https://github.com/acme/api/pull/7'), /^Error: invalid ticket key: /);
  assert.throws(() => tracker.normalizeKey('WV-12'), /^Error: invalid ticket key: WV-12$/);
  assert.throws(() => tracker.normalizeKey('acme/api#x'), /invalid ticket key/);
});

test('normalizeKey rejects bare #n with several projects', () => {
  const tracker = create(fakeFetch([]), { ...trackerConfig, projects: ['acme/webapp', 'acme/api'] });
  assert.throws(() => tracker.normalizeKey('#42'), /^Error: ambiguous key #42: several projects configured$/);
  assert.equal(tracker.normalizeKey('acme/api#42'), 'acme/api#42');
});

test('getIssue maps a label to status when configured, else open/closed', async () => {
  const fetchImpl = fakeFetch([
    route('/repos/acme/webapp/issues/42', issueFixture),
    route('/repos/acme/webapp/issues/42/comments?per_page=100', commentsPage1),
  ]);
  const issue = await create(fetchImpl).getIssue('acme/webapp#42');
  assert.equal(issue.status, 'ready-for-test');
  assert.equal(issue.key, 'acme/webapp#42');
  assert.equal(issue.id, '9001');
  assert.equal(issue.title, 'Checkout fails with an empty cart');
  assert.equal(issue.type, 'issue');
  assert.equal(issue.url, 'https://github.com/acme/webapp/issues/42');
  assert.deepEqual(issue.labels, ['bug', 'ready-for-test', 'tested-ok']);
  assert.equal(issue.parent, null);
  assert.deepEqual(issue.links, []);
  assert.equal(issue.body.format, 'markdown');
  assert.match(issue.body.content, /^## Intent/);

  const unlabelled = { ...issueFixture, labels: [{ name: 'bug' }], state: 'closed' };
  const closed = await create(
    fakeFetch([route('/repos/acme/webapp/issues/42', unlabelled), route('/repos/acme/webapp/issues/42/comments?per_page=100', [])]),
  ).getIssue('acme/webapp#42');
  assert.equal(closed.status, 'closed');
  const open = await create(
    fakeFetch([
      route('/repos/acme/webapp/issues/42', { ...unlabelled, state: 'open' }),
      route('/repos/acme/webapp/issues/42/comments?per_page=100', []),
    ]),
  ).getIssue('acme/webapp#42');
  assert.equal(open.status, 'open');
});

test('getIssue also recognises perProject status labels', async () => {
  const config = { ...trackerConfig, statuses: { ...statuses, perProject: { 'acme/webapp': { afterOk: 'qa-passed' } } } };
  const labelled = { ...issueFixture, labels: [{ name: 'qa-passed' }] };
  const issue = await create(
    fakeFetch([route('/repos/acme/webapp/issues/42', labelled), route('/repos/acme/webapp/issues/42/comments?per_page=100', [])]),
    config,
  ).getIssue('acme/webapp#42');
  assert.equal(issue.status, 'qa-passed');
});

test('getIssue sends the GitHub headers and strips the trailing slash of baseUrl', async () => {
  const fetchImpl = fakeFetch([
    { match: (url) => url === 'https://ghe.test/api/v3/repos/acme/webapp/issues/42', body: issueFixture },
    { match: (url) => url === 'https://ghe.test/api/v3/repos/acme/webapp/issues/42/comments?per_page=100', body: [] },
  ]);
  await create(fetchImpl, { ...trackerConfig, baseUrl: 'https://ghe.test/api/v3/' }).getIssue('acme/webapp#42');
  assert.equal(fetchImpl.calls.length, 2);
  for (const { init } of fetchImpl.calls) {
    assert.equal(init.headers.Authorization, 'Bearer ghp-secret');
    assert.equal(init.headers.Accept, 'application/vnd.github+json');
    assert.equal(init.headers['X-GitHub-Api-Version'], '2022-11-28');
    assert.equal(init.headers['User-Agent'], 'functional-test-plugin');
  }
});

test('getIssue paginates comments via Link header', async () => {
  const next = 'https://api.github.com/repositories/1/issues/42/comments?per_page=100&page=2';
  const fetchImpl = fakeFetch([
    route('/repos/acme/webapp/issues/42', issueFixture),
    route('/repos/acme/webapp/issues/42/comments?per_page=100', commentsPage1, {
      headers: { Link: `<${next}>; rel="next", <https://api.github.com/x?page=2>; rel="last"` },
    }),
    { match: (url) => url === next, body: commentsPage2 },
  ]);
  const issue = await create(fetchImpl).getIssue('acme/webapp#42');
  assert.deepEqual(
    issue.comments.map((c) => c.author),
    ['alice', 'bob', 'carol'],
  );
  assert.deepEqual(issue.comments[2], {
    author: 'carol',
    date: '2026-10-21T08:15:00Z',
    body: { format: 'markdown', content: '[test-ticket] Functional tests - staging - Verdict: OK' },
  });
  assert.equal(fetchImpl.calls.length, 3);
  assert.equal(fetchImpl.calls[2].init.headers.Authorization, 'Bearer ghp-secret');
});

test('a pagination link outside the tracker origin is refused and never requested', async () => {
  for (const next of ['https://evil.test/comments?page=2', 'http://api.github.com/repos/acme/webapp/issues/42/comments?page=2']) {
    const fetchImpl = fakeFetch([
      route('/repos/acme/webapp/issues/42', issueFixture),
      route('/repos/acme/webapp/issues/42/comments?per_page=100', commentsPage1, {
        headers: { Link: `<${next}>; rel="next"` },
      }),
    ]);
    await assert.rejects(create(fetchImpl).getIssue('acme/webapp#42'), /outside the tracker host/);
    assert.equal(fetchImpl.calls.length, 2);
    assert.equal(fetchImpl.calls.some((c) => c.url === next || c.url.includes('evil.test')), false);
  }
});

test('a never-ending Link chain stops after the page cap', async () => {
  let served = 0;
  const fetchImpl = fakeFetch([
    route('/repos/acme/webapp/issues/42', issueFixture),
    {
      match: (url) => url.includes('/comments'),
      get body() {
        served += 1;
        return [{ id: served, user: { login: 'alice' }, created_at: '2026-10-20T09:00:00Z', body: `c${served}` }];
      },
      get headers() {
        return { Link: `<https://api.github.com/repos/acme/webapp/issues/42/comments?page=${served + 1}>; rel="next"` };
      },
    },
  ]);
  const issue = await create(fetchImpl).getIssue('acme/webapp#42');
  assert.equal(issue.comments.length, 20);
  assert.equal(fetchImpl.calls.length, 21);
});

test('parseLinkNext extracts the next relation', () => {
  assert.equal(parseLinkNext('<https://a.test/p?page=2>; rel="next", <https://a.test/p?page=9>; rel="last"'), 'https://a.test/p?page=2');
  assert.equal(parseLinkNext('<https://a.test/p?page=1>; rel="prev"'), null);
  assert.equal(parseLinkNext(null), null);
  assert.equal(parseLinkNext(''), null);
});

test('getLinkedPullRequests maps merged, open and closed PRs from timeline', async () => {
  const pull = (number, repo, state, mergedAt, head, base) => ({
    title: `PR ${number}`,
    state,
    merged_at: mergedAt,
    head: { ref: head },
    base: { ref: base },
    html_url: `https://github.com/${repo}/pull/${number}`,
  });
  const fetchImpl = fakeFetch([
    route('/repos/acme/webapp/issues/42/timeline?per_page=100', timelineFixture),
    route('/repos/acme/webapp/pulls/7', pull(7, 'acme/webapp', 'closed', '2026-10-22T12:00:00Z', 'fix/cart', 'main')),
    route('/repos/acme/api/pulls/9', pull(9, 'acme/api', 'open', null, 'fix/cart-api', 'develop')),
    route('/repos/acme/webapp/pulls/10', pull(10, 'acme/webapp', 'closed', null, 'try/cart', 'main')),
  ]);
  const tracker = create(fetchImpl);
  const issue = { key: 'acme/webapp#42', id: '9001' };
  const prs = await tracker.getLinkedPullRequests(issue);
  assert.deepEqual(prs, [
    { repository: 'webapp', title: 'PR 7', sourceBranch: 'fix/cart', targetBranch: 'main', status: 'MERGED', mergedAt: '2026-10-22T12:00:00Z', url: 'https://github.com/acme/webapp/pull/7' },
    { repository: 'api', title: 'PR 9', sourceBranch: 'fix/cart-api', targetBranch: 'develop', status: 'OPEN', mergedAt: null, url: 'https://github.com/acme/api/pull/9' },
    { repository: 'webapp', title: 'PR 10', sourceBranch: 'try/cart', targetBranch: 'main', status: 'DECLINED', mergedAt: null, url: 'https://github.com/acme/webapp/pull/10' },
  ]);
  const urls = fetchImpl.calls.map((c) => c.url);
  assert.equal(urls.filter((u) => u.endsWith('/pulls/7')).length, 1);
  assert.equal(urls[0], 'https://api.github.com/repos/acme/webapp/issues/42/timeline?per_page=100');
  assert.equal(fetchImpl.calls[0].init.headers.Accept, 'application/vnd.github+json');
});

test('getLinkedPullRequests returns [] when the timeline links no pull request', async () => {
  const fetchImpl = fakeFetch([route('/repos/acme/webapp/issues/42/timeline?per_page=100', [{ event: 'labeled' }])]);
  assert.deepEqual(await create(fetchImpl).getLinkedPullRequests({ key: 'acme/webapp#42' }), []);
  assert.equal(fetchImpl.calls.length, 1);
});

test('searchWithMarker queries each project and skips pull requests', async () => {
  const fetchImpl = fakeFetch([
    {
      match: (url) => url.startsWith('https://api.github.com/search/issues?'),
      body: searchFixture,
    },
  ]);
  const tracker = create(fetchImpl, { ...trackerConfig, projects: ['acme/webapp', 'acme/api'] });
  const keys = await tracker.searchWithMarker('[test-ticket]');
  assert.deepEqual(keys, ['acme/webapp#42', 'acme/webapp#43', 'acme/api#42', 'acme/api#43']);
  assert.equal(tracker.lastSearchTruncated, false);
  const url = new URL(fetchImpl.calls[0].url);
  assert.equal(url.pathname, '/search/issues');
  assert.equal(url.searchParams.get('q'), '"[test-ticket]" in:comments repo:acme/webapp');
  assert.equal(url.searchParams.get('per_page'), '100');
  assert.equal(url.searchParams.get('page'), '1');
});

test('searchWithMarker flags truncation', async () => {
  const incomplete = fakeFetch([
    { match: () => true, body: { ...searchFixture, incomplete_results: true } },
  ]);
  const t1 = create(incomplete);
  assert.equal((await t1.searchWithMarker('m')).length, 2);
  assert.equal(t1.lastSearchTruncated, true);

  const fullPage = Array.from({ length: 100 }, (_, i) => ({ number: i + 1, id: i + 1 }));
  const endless = fakeFetch([{ match: () => true, body: { incomplete_results: false, items: fullPage } }]);
  const t2 = create(endless);
  assert.equal((await t2.searchWithMarker('m')).length, 1000);
  assert.equal(endless.calls.length, 10);
  assert.equal(t2.lastSearchTruncated, true);

  const lastShort = fakeFetch([
    {
      match: (url) => url.includes('page=2'),
      body: { incomplete_results: false, items: [{ number: 500, id: 500 }] },
    },
    { match: () => true, body: { incomplete_results: false, items: fullPage } },
  ]);
  const t3 = create(lastShort);
  assert.equal((await t3.searchWithMarker('m')).length, 101);
  assert.equal(lastShort.calls.length, 2);
  assert.equal(t3.lastSearchTruncated, false);
});

test('whoami returns the login', async () => {
  const fetchImpl = fakeFetch([route('/user', { login: 'alice' })]);
  assert.equal(await create(fetchImpl).whoami(), 'alice');
});

test('a non-OK response throws a TrackerError carrying status and path', async () => {
  const fetchImpl = fakeFetch([{ match: () => true, status: 404, body: 'ghp-secret in body' }]);
  await assert.rejects(create(fetchImpl).getIssue('acme/webapp#42'), (err) => {
    assert.ok(err instanceof TrackerError);
    assert.equal(err.status, 404);
    assert.equal(err.path, '/repos/acme/webapp/issues/42');
    assert.match(err.message, /^GitHub 404 on \/repos\/acme\/webapp\/issues\/42$/);
    assert.equal(/ghp-secret/.test(err.message), false);
    return true;
  });
});

test('missing GITHUB_TOKEN throws MissingSecretError naming the variable', () => {
  assert.throws(
    () => createGithubTracker(trackerConfig, {}, { fetchImpl: fakeFetch([]) }),
    (err) => err instanceof MissingSecretError && JSON.stringify(err.variables) === '["GITHUB_TOKEN"]',
  );
});
