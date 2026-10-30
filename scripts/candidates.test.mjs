import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { formatComment } from './lib/comment.mjs';
import { translator } from './lib/i18n.mjs';
import { createTmpRepo } from './lib/test-helpers/tmp-git.mjs';

const SCRIPT = path.join(path.dirname(new URL(import.meta.url).pathname), 'candidates.mjs');
const example = JSON.parse(fs.readFileSync(new URL('../templates/config.example.json', import.meta.url), 'utf8'));
const secrets = { JIRA_EMAIL: 'qa@example.test', JIRA_API_TOKEN: 'secret-token-value' };

/** Runs candidates.mjs from `cwd` with a clean environment (async: the stub server lives in this process). */
function run(cwd, args = [], env = {}) {
  return new Promise((resolve) => {
    execFile('node', [SCRIPT, ...args], { cwd, env: { PATH: process.env.PATH, ...env } }, (error, stdout, stderr) => {
      resolve({ code: error ? error.code : 0, stdout, stderr });
    });
  });
}

const escapeHtml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const toHtml = (text) => text.split('\n').map((line) => `<p>${escapeHtml(line)}</p>`).join('');

const report = (candidates, env = 'testing') => ({
  v: 1,
  env,
  date: '2026-10-22 10:00',
  verdict: 'OK',
  delivery: 'merged',
  constraints: '',
  cases: [
    { id: 'T1', priority: 'P1', title: 'Create a booking', result: 'OK' },
    { id: 'T2', priority: 'P2', title: 'Cancel a booking', result: 'OK' },
  ],
  notPlayed: '',
  data: '',
  candidates,
});

const LEGACY = [
  '[test-ticket] Tests fonctionnels — demo — 2026-10-20 09:00 — Verdict : OK',
  'Livraison : mergée',
  'Cas :',
  '- T1 (P1) Export the planning : OK',
  "Candidats à l'automatisation (à arbitrer par QA) : T1",
].join('\n');

const comment = (text, created) => ({ created, text });
const ISSUES = {
  'WV-1': { summary: 'Covered by a spec', status: 'Test OK', comments: [comment(formatComment(report(['T1']), translator('en')), '2026-10-22T10:00:00.000+0000')] },
  'WV-2': { summary: 'Legacy French comment', status: 'Test OK', comments: [comment(LEGACY, '2026-10-20T09:00:00.000+0000')] },
  'WV-3': { summary: 'Nothing to automate', status: 'Test OK', comments: [comment(formatComment(report([]), translator('en')), '2026-10-21T10:00:00.000+0000')] },
  'WV-4': { summary: 'Set aside by QA', status: 'Test OK', comments: [comment(formatComment(report(['T2']), translator('en')), '2026-10-23T10:00:00.000+0000')] },
  'WV-5': { summary: 'Newest, two candidates', status: 'Test KO', comments: [comment(formatComment(report(['T1', 'T9'], 'demo'), translator('en')), '2026-10-25T10:00:00.000+0000')] },
};

/** Stub Jira: the search lists every ISSUES key, each issue carries its comments (raw + rendered). */
function stubJira() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://stub');
    res.setHeader('content-type', 'application/json');
    const key = /^\/rest\/api\/3\/issue\/([^/]+)$/.exec(url.pathname)?.[1];
    if (url.pathname === '/rest/api/3/search/jql') {
      res.end(JSON.stringify({ issues: Object.keys(ISSUES).map((k) => ({ key: k })) }));
    } else if (key && ISSUES[key]) {
      const { summary, status, comments } = ISSUES[key];
      res.end(
        JSON.stringify({
          key,
          id: '1',
          fields: { summary, status: { name: status }, comment: { comments: comments.map((c) => ({ created: c.created, author: { displayName: 'QA' } })) } },
          renderedFields: { comment: { comments: comments.map((c) => ({ body: toHtml(c.text) })) } },
        }),
      );
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((done) => server.close(done)) }),
    ),
  );
}

/** A git repository acting as host: a spec citing WV-1, a branch for WV-5, WV-4 excluded in the legacy French format. */
function makeHost(config) {
  const repo = createTmpRepo();
  fs.mkdirSync(path.join(repo.dir, '.claude', 'functional-test'), { recursive: true });
  fs.writeFileSync(path.join(repo.dir, '.claude', 'functional-test', 'config.json'), JSON.stringify({ ...config, language: 'en', delivery: { mode: 'none' } }));
  fs.mkdirSync(path.join(repo.dir, 'tests'));
  fs.writeFileSync(path.join(repo.dir, 'tests', 'booking.spec.ts'), "test('WV-1 creates a booking', () => {});\n");
  execFileSync('git', ['-C', repo.dir, 'add', 'tests']);
  repo.commit('add the spec');
  return repo;
}

test('candidates.mjs lists the tickets to arbitrate, newest first, and omits covered, excluded and candidate-less ones', async () => {
  const server = await stubJira();
  const host = makeHost({ ...example, tracker: { ...example.tracker, baseUrl: server.url } });
  try {
    fs.writeFileSync(
      path.join(host.dir, '.claude', 'functional-test', 'excluded.json'),
      JSON.stringify([{ cle: 'WV-4', date: '2026-10-24', motif: 'screen removed' }]),
    );
    const { code, stdout, stderr } = await run(host.dir, [], secrets);
    assert.equal(code, 0, stderr);
    assert.equal(
      stdout,
      [
        'WV-5 · Test KO · demo · 2026-10-22 10:00 · Newest, two candidates',
        '  - T1 (P1) Create a booking',
        '  - T9 (case missing from the comment)',
        'WV-2 · Test OK · demo · 2026-10-20 09:00 · Legacy French comment',
        '  - T1 (P1) Export the planning',
        '',
      ].join('\n'),
    );
    assert.ok(!stdout.includes('WV-1') && !stdout.includes('WV-4') && !stdout.includes('WV-3'));
    assert.ok(!(stdout + stderr).includes(secrets.JIRA_API_TOKEN));

    const all = await run(host.dir, ['--all'], secrets);
    assert.equal(all.code, 0, all.stderr);
    assert.match(all.stdout, /^Already covered: WV-1$/m);
    assert.match(all.stdout, /^Excluded by QA: WV-4 \(screen removed\)$/m);
    assert.match(all.stdout, /^No candidate in the latest comment: WV-3$/m);

    const json = JSON.parse((await run(host.dir, ['--json'], secrets)).stdout);
    assert.deepEqual(json.remaining.map((t) => t.key), ['WV-5', 'WV-2']);
    assert.deepEqual(json.covered, ['WV-1']);
    assert.deepEqual(json.exclusions, [{ key: 'WV-4', date: '2026-10-24', reason: 'screen removed' }]);
    assert.equal(json.truncated, false);
  } finally {
    host.cleanup();
    await server.close();
  }
});

test('candidates.mjs treats a test/<key> branch as coverage and says so when nothing is left', async () => {
  const server = await stubJira();
  const host = makeHost({ ...example, tracker: { ...example.tracker, baseUrl: server.url } });
  try {
    const sha = host.commit('branch tip');
    host.setRemoteRef('test/wv-5-two-candidates', sha);
    host.setRemoteRef('test/wv-2', sha);
    host.setRemoteRef('test/wv-4-x', sha);
    const { code, stdout, stderr } = await run(host.dir, [], secrets);
    assert.equal(code, 0, stderr);
    assert.equal(stdout, 'No pending candidate.\n');
  } finally {
    host.cleanup();
    await server.close();
  }
});

test('candidates.mjs exits 2 with the file tracker, 2 on a bad flag, 3 without secrets', async () => {
  const host = makeHost({ ...example, tracker: { type: 'file' } });
  try {
    const unsupported = await run(host.dir);
    assert.equal(unsupported.code, 2);
    assert.equal(unsupported.stderr, 'Candidates are unavailable with the file tracker.\n');
    const usage = await run(host.dir, ['--bogus']);
    assert.equal(usage.code, 2);
    assert.match(usage.stderr, /usage: candidates\.mjs/);
  } finally {
    host.cleanup();
  }
  const jiraHost = makeHost({ ...example, tracker: { ...example.tracker, baseUrl: 'http://127.0.0.1:9' } });
  try {
    const { code, stderr } = await run(jiraHost.dir);
    assert.equal(code, 3);
    assert.match(stderr, /JIRA_API_TOKEN/);
  } finally {
    jiraHost.cleanup();
  }
});

test('candidates.mjs fails with 4 and never prints the token on a tracker error', async () => {
  const server = http.createServer((req, res) => {
    res.statusCode = 500;
    res.end('{}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const host = makeHost({ ...example, tracker: { ...example.tracker, baseUrl: `http://127.0.0.1:${server.address().port}` } });
  try {
    const { code, stderr } = await run(host.dir, [], secrets);
    assert.equal(code, 4);
    assert.match(stderr, /tracker error: Jira 500/);
    assert.ok(!stderr.includes(secrets.JIRA_API_TOKEN));
  } finally {
    host.cleanup();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('candidates.mjs warns on stderr and flags the JSON when the tracker search was truncated', async () => {
  const host = makeHost({ ...example, tracker: { type: 'custom', module: './tracker.mjs', projects: ['WV'] } });
  try {
    fs.writeFileSync(
      path.join(host.dir, 'tracker.mjs'),
      'export default () => ({ type: "custom", lastSearchTruncated: true, searchWithMarker: async () => [], getIssue: async () => { throw new Error("unused"); } });\n',
    );
    const text = await run(host.dir);
    assert.equal(text.code, 0, text.stderr);
    assert.equal(text.stdout, 'No pending candidate.\n');
    assert.equal(text.stderr, 'Warning: the tracker search was truncated, the list may be incomplete.\n');
    const json = JSON.parse((await run(host.dir, ['--json'])).stdout);
    assert.deepEqual(json, { remaining: [], covered: [], exclusions: [], truncated: true });
  } finally {
    host.cleanup();
  }
});
