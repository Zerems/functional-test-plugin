import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createFileTracker, ticketFileRefusal } from './file.mjs';

function withRoot(fn) {
  const root = mkdtempSync(join(tmpdir(), 'ft-file-'));
  return Promise.resolve(fn(root)).finally(() => rmSync(root, { recursive: true, force: true }));
}

test('getIssue reads title and markdown body', () =>
  withRoot(async (root) => {
    mkdirSync(join(root, 'tickets'));
    const content = '# Login page\n\n## Acceptance\n- works\n';
    writeFileSync(join(root, 'tickets', 'login.md'), content);
    const tracker = createFileTracker(root);
    const issue = await tracker.getIssue('tickets/login.md');
    assert.deepEqual(issue, {
      key: 'login',
      id: 'login',
      title: 'Login page',
      status: '',
      type: 'file',
      url: pathToFileURL(join(root, 'tickets', 'login.md')).href,
      labels: [],
      parent: null,
      links: [],
      body: { format: 'markdown', content },
      comments: [],
    });
    const absolute = await tracker.getIssue(join(root, 'tickets', 'login.md'));
    assert.equal(absolute.key, 'login');
  }));

test('getIssue falls back to the basename and rejects a missing file', () =>
  withRoot(async (root) => {
    writeFileSync(join(root, 'plain.md'), 'no heading\n## sub\n');
    const tracker = createFileTracker(root);
    assert.equal((await tracker.getIssue('plain.md')).title, 'plain');
    await assert.rejects(tracker.getIssue('nope.md'), /^Error: ticket file not found: nope\.md$/);
  }));

test('searchWithMarker returns [] and getLinkedPullRequests null', async () => {
  const tracker = createFileTracker('/x');
  assert.deepEqual(await tracker.searchWithMarker('[test-ticket]'), []);
  assert.equal(await tracker.getLinkedPullRequests({}), null);
  assert.equal(await tracker.whoami(), 'local file');
  assert.equal(tracker.type, 'file');
  assert.equal(tracker.trackerStatusesAreLabels, false);
  assert.equal(tracker.normalizeKey('tickets/a b.md'), 'tickets/a b.md');
  assert.ok(tracker.keyPattern.test('anything'));
});

test('ticketFileRefusal accepts Markdown and text files only and refuses secret paths', () =>
  withRoot(async (root) => {
    assert.equal(ticketFileRefusal(root, 'notes.txt'), null);
    assert.equal(ticketFileRefusal(root, 'a/b.MD'), null);
    assert.equal(ticketFileRefusal(root, 'spec.markdown'), null);
    assert.equal(ticketFileRefusal(root, 'data.json'), 'extension');
    assert.equal(ticketFileRefusal(root, 'README'), 'extension');
    assert.equal(ticketFileRefusal(root, '.env'), 'secret');
    assert.equal(ticketFileRefusal(root, '.env.local.md'), 'secret');
    assert.equal(ticketFileRefusal(root, '.auth/cache.md'), 'secret');
    assert.equal(ticketFileRefusal(root, '.mcp.json'), 'secret');
    writeFileSync(join(root, '.env'), 'A=b\n');
    symlinkSync(join(root, '.env'), join(root, 'alias.md'));
    assert.equal(ticketFileRefusal(root, 'alias.md'), 'secret');
    await assert.rejects(createFileTracker(root).getIssue('alias.md'), /refused \(secret\)/);
  }));
