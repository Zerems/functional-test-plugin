import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createJiraTracker, normalizeIssue, normalizePullRequests } from './jira.mjs';
import { MissingSecretError } from './index.mjs';
import { fakeFetch } from '../test-helpers/fake-fetch.mjs';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../test-helpers/fixtures/${name}`, import.meta.url), 'utf8'));
const issueFixture = fixture('jira-issue.json');
const devStatusFixture = fixture('jira-devstatus.json');

const trackerConfig = {
  type: 'jira',
  baseUrl: 'https://j.test/',
  projects: ['WV', 'WVS'],
  statuses: { toTest: ['Test'], doNotTest: [], afterOk: '', afterKo: '' },
};
const env = { JIRA_EMAIL: 'a@b', JIRA_API_TOKEN: 'secret-token' };
const create = (fetchImpl, root) => createJiraTracker(trackerConfig, env, { fetchImpl, root });

test('normalizeIssue maps the raw Jira issue to an Issue with html bodies', () => {
  const issue = normalizeIssue(issueFixture, 'https://j.test');
  assert.equal(issue.key, 'WV-90');
  assert.equal(issue.id, '10001');
  assert.equal(issue.title, 'Commande CDI');
  assert.equal(issue.status, 'Test');
  assert.equal(issue.type, 'Story');
  assert.equal(issue.url, 'https://j.test/browse/WV-90');
  assert.deepEqual(issue.labels, ['cdi']);
  assert.deepEqual(issue.body, {
    format: 'html',
    content: '<p>Intention</p><ul><li>CA un</li><li><del>CA deux</del></li></ul>',
  });
  assert.deepEqual(issue.comments, [
    {
      author: 'Remy',
      date: '2026-10-20T10:00:00.000+0000',
      body: { format: 'html', content: '<p>[test-ticket] Functional tests - testing - 2026-10-20 10:00 - Verdict: OK</p>' },
    },
  ]);
  assert.deepEqual(issue.parent, { key: 'WV-1', title: 'Épopée commandes' });
  assert.deepEqual(issue.links, [
    { type: 'is blocked by', key: 'WV-5', title: 'Référentiel' },
    { type: 'relates to', key: 'WVS-9', title: 'Bug' },
  ]);
});

test('normalizeIssue tolerates a bare issue', () => {
  const issue = normalizeIssue({ key: 'WV-2', id: '2' }, 'https://j.test');
  assert.deepEqual(issue.body, { format: 'html', content: '' });
  assert.deepEqual(issue.comments, []);
  assert.deepEqual(issue.links, []);
  assert.equal(issue.parent, null);
  assert.equal(issue.title, '');
});

test('normalizePullRequests maps fields and statuses, and excludes a repository', () => {
  const prs = normalizePullRequests(devStatusFixture, 'wizim-e2e');
  assert.deepEqual(prs.map((p) => p.repository), ['wizim-backend-v2', 'wizim-front-v2', 'wizim-api']);
  assert.deepEqual(prs[0], {
    repository: 'wizim-backend-v2',
    title: 'Backend change',
    sourceBranch: 'feat/x',
    targetBranch: 'testing',
    status: 'MERGED',
    mergedAt: '2026-10-09T14:31:01.834+0000',
    url: 'https://bitbucket.org/x/y/pull-requests/1',
  });
  assert.equal(prs[1].status, 'OPEN');
  assert.equal(prs[1].mergedAt, null);
  assert.equal(prs[2].status, 'DECLINED');
  assert.equal(prs[2].mergedAt, null);
  assert.deepEqual(normalizePullRequests({}), []);
  assert.equal(normalizePullRequests(devStatusFixture).length, 4);
});

test('normalizeKey accepts a browse URL with query string and lower case', () => {
  const tracker = create(fakeFetch([]));
  assert.equal(tracker.normalizeKey('https://x.atlassian.net/browse/wv-12?focusedCommentId=1'), 'WV-12');
  assert.equal(tracker.normalizeKey('https://x.atlassian.net/browse/WVS-3#comment'), 'WVS-3');
  assert.equal(tracker.normalizeKey('please test wv-7 now'), 'WV-7');
  assert.equal(tracker.normalizeKey('WV-1'), 'WV-1');
  assert.throws(() => tracker.normalizeKey('nothing here'), /invalid ticket key: nothing here/);
  assert.throws(() => tracker.normalizeKey('https://x.atlassian.net/browse/oops'), /invalid ticket key/);
});

test('exposes the tracker contract', () => {
  const tracker = create(fakeFetch([]));
  assert.equal(tracker.type, 'jira');
  assert.equal(tracker.trackerStatusesAreLabels, false);
  assert.ok(tracker.keyPattern.test('WV-12'));
});

test('getIssue sends Basic auth and expand=renderedFields', async () => {
  const fetchImpl = fakeFetch([{ match: (u) => u.includes('/rest/api/3/issue/'), body: issueFixture }]);
  const issue = await create(fetchImpl).getIssue('WV-90');
  assert.equal(fetchImpl.calls.length, 1);
  const { url, init } = fetchImpl.calls[0];
  assert.match(url, /^https:\/\/j\.test\/rest\/api\/3\/issue\/WV-90\?fields=summary,status,issuetype,description,comment,issuelinks,parent,labels,components&expand=renderedFields$/);
  assert.equal(init.headers.Authorization, 'Basic ' + Buffer.from('a@b:secret-token').toString('base64'));
  assert.equal(init.headers.Accept, 'application/json');
  assert.equal(issue.url, 'https://j.test/browse/WV-90');
  assert.equal(issue.body.format, 'html');
});

test('HTTP errors name the status and path, never the token or the body', async () => {
  const fetchImpl = fakeFetch([{ match: () => true, status: 500, body: 'secret-token leaked in body' }]);
  await assert.rejects(create(fetchImpl).getIssue('WV-1'), (err) => {
    assert.match(err.message, /^Jira 500 on \/rest\/api\/3\/issue\/WV-1$/);
    assert.equal(/secret-token/.test(err.message), false);
    return true;
  });
});

test('missing credentials throw MissingSecretError naming only the missing variables', () => {
  assert.throws(
    () => createJiraTracker(trackerConfig, { JIRA_EMAIL: 'a@b' }, { fetchImpl: fakeFetch([]) }),
    (err) => err instanceof MissingSecretError && JSON.stringify(err.variables) === '["JIRA_API_TOKEN"]',
  );
  assert.throws(
    () => createJiraTracker(trackerConfig, {}, { fetchImpl: fakeFetch([]) }),
    (err) => err instanceof MissingSecretError && JSON.stringify(err.variables) === '["JIRA_EMAIL","JIRA_API_TOKEN"]',
  );
});

test('a missing baseUrl is a configuration error naming tracker.baseUrl', () => {
  assert.throws(() => createJiraTracker({ ...trackerConfig, baseUrl: undefined }, env, {}), /tracker\.baseUrl/);
});

test('searchWithMarker follows nextPageToken', async () => {
  const fetchImpl = fakeFetch([
    { match: (u) => u.includes('nextPageToken=p2'), body: { issues: [{ key: 'WV-2' }] } },
    { match: () => true, body: { issues: [{ key: 'WV-1' }], nextPageToken: 'p2' } },
  ]);
  const keys = await create(fetchImpl).searchWithMarker('[test-ticket]');
  assert.deepEqual(keys, ['WV-1', 'WV-2']);
  assert.equal(fetchImpl.calls.length, 2);
  const first = new URL(fetchImpl.calls[0].url);
  assert.equal(first.pathname, '/rest/api/3/search/jql');
  assert.equal(first.searchParams.get('jql'), 'project in (WV, WVS) AND comment ~ "[test-ticket]" ORDER BY updated DESC');
  assert.equal(first.searchParams.get('fields'), 'key');
  assert.equal(first.searchParams.get('maxResults'), '50');
  assert.equal(first.searchParams.get('nextPageToken'), null);
  assert.equal(new URL(fetchImpl.calls[1].url).searchParams.get('nextPageToken'), 'p2');
});

test('getLinkedPullRequests excludes the host repository and tries application types in order', async () => {
  const fetchImpl = fakeFetch([
    { match: (u) => u.includes('applicationType=bitbucket'), body: { detail: [] } },
    { match: (u) => u.includes('applicationType=GitHub'), body: devStatusFixture },
  ]);
  const prs = await create(fetchImpl, '/work/wizim-e2e').getLinkedPullRequests({ id: '10001', key: 'WV-90' });
  assert.deepEqual(prs.map((p) => p.repository), ['wizim-backend-v2', 'wizim-front-v2', 'wizim-api']);
  assert.deepEqual(
    fetchImpl.calls.map((c) => new URL(c.url).searchParams.get('applicationType')),
    ['bitbucket', 'GitHub'],
  );
  assert.equal(
    fetchImpl.calls[0].url,
    'https://j.test/rest/dev-status/latest/issue/detail?issueId=10001&applicationType=bitbucket&dataType=pullrequest',
  );
});

test('getLinkedPullRequests returns [] when no application type has a pull request', async () => {
  const fetchImpl = fakeFetch([{ match: () => true, body: { detail: [] } }]);
  assert.deepEqual(await create(fetchImpl).getLinkedPullRequests({ id: '1' }), []);
  assert.deepEqual(
    fetchImpl.calls.map((c) => new URL(c.url).searchParams.get('applicationType')),
    ['bitbucket', 'GitHub', 'stash'],
  );
});

test('whoami returns the display name', async () => {
  const fetchImpl = fakeFetch([{ match: (u) => u.endsWith('/rest/api/3/myself'), body: { displayName: 'Remy A' } }]);
  assert.equal(await create(fetchImpl).whoami(), 'Remy A');
});
