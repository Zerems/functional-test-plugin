import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTracker } from './index.mjs';

const base = { projects: ['WV'], statuses: { toTest: [], doNotTest: [], afterOk: '', afterKo: '' } };
const env = { JIRA_EMAIL: 'a@b', JIRA_API_TOKEN: 't' };

test('createTracker dispatches by type', async () => {
  const jira = await createTracker({ tracker: { ...base, type: 'jira', baseUrl: 'https://j.test' } }, env, {});
  assert.equal(jira.type, 'jira');
  const file = await createTracker({ tracker: { ...base, type: 'file' } }, env, { root: '/x' });
  assert.equal(file.type, 'file');
  const github = await createTracker({ tracker: { ...base, type: 'github', projects: ['acme/webapp'] } }, { GITHUB_TOKEN: 't' }, {});
  assert.equal(github.type, 'github');
  await assert.rejects(createTracker({ tracker: { ...base, type: 'x' } }, env, {}), /^Error: unknown tracker type: x$/);
});

test('createTracker loads a custom module default export', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ft-custom-'));
  try {
    writeFileSync(
      join(root, 'tracker.mjs'),
      'export default (trackerConfig, env, deps) => ({ type: "custom", seen: { trackerConfig, env, root: deps.root, hasFetch: typeof deps.fetchImpl } });\n',
    );
    const config = { tracker: { ...base, type: 'custom', module: './tracker.mjs' } };
    const tracker = await createTracker(config, env, { root });
    assert.equal(tracker.type, 'custom');
    assert.equal(tracker.seen.trackerConfig, config.tracker);
    assert.equal(tracker.seen.env, env);
    assert.equal(tracker.seen.root, root);
    assert.equal(tracker.seen.hasFetch, 'function');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
