import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigError } from './config.mjs';
import { branchRegex, grepSpecs, gitBranches, coveredKeys, loadExclusions, filterCandidates } from './coverage.mjs';
import { createTmpRepo } from './test-helpers/tmp-git.mjs';

function execGit(dir, args) {
  execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
}

test('branchRegex builds from pattern with slug wildcard', () => {
  const regex = branchRegex('test/{key-lower}-{slug}', 'WV-363');
  assert.ok(regex.test('test/wv-363-foo'));
  assert.ok(regex.test('test/wv-363'));
  assert.ok(regex.test('origin/test/wv-363-foo-bar'));
  assert.ok(!regex.test('test/wv-3630'));
  assert.ok(!regex.test('test/wv-36'));
  assert.ok(!regex.test('test/wv-363-foo/bar'));
  assert.ok(branchRegex('feature/{key}', 'ABC-1').test('feature/ABC-1'));
  assert.ok(!branchRegex('feature/{key}', 'ABC-1').test('feature/abc-1'));
});

test('branchRegex escapes the characters of the key and of the pattern', () => {
  assert.ok(branchRegex('test/{key-lower}-{slug}', 'a.b-1').test('test/a.b-1-x'));
  assert.ok(!branchRegex('test/{key-lower}-{slug}', 'a.b-1').test('test/axb-1-x'));
  assert.ok(!branchRegex('t.st/{key}', 'K-1').test('tXst/K-1'));
});

test('keys covered by a spec or a test/ branch', () => {
  const covered = coveredKeys(['WV-1', 'WV-2', 'WV-3'], {
    specPaths: ['tests/'],
    pattern: 'test/{key-lower}-{slug}',
    grep: (key) => (key === 'WV-1' ? ['tests/x.spec.ts'] : []),
    branches: () => ['main', 'remotes/origin/test/wv-2-truc', 'test/wvs-9-autre'],
  });
  assert.deepEqual([...covered].sort(), ['WV-1', 'WV-2']);
});

test('I4: a test/wv-363 branch does not cover WV-36', () => {
  const covered = coveredKeys(['WV-36', 'WV-363'], {
    specPaths: ['tests/'],
    pattern: 'test/{key-lower}-{slug}',
    grep: () => [],
    branches: () => ['remotes/origin/test/wv-363-x'],
  });
  assert.deepEqual([...covered], ['WV-363']);
});

test('exclusions: missing file gives an empty list, otherwise the entries', () => {
  assert.deepEqual(loadExclusions('/nonexistent/path.json'), []);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-exclusions-'));
  try {
    const file = path.join(dir, 'e.json');
    fs.writeFileSync(file, JSON.stringify([{ key: 'WV-4', date: '2026-10-23', reason: 'screen removed' }]));
    assert.deepEqual(loadExclusions(file), [{ key: 'WV-4', date: '2026-10-23', reason: 'screen removed' }]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('exclusions: legacy French keys are accepted, invalid JSON is a config error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-exclusions-'));
  try {
    const file = path.join(dir, 'e.json');
    fs.writeFileSync(file, JSON.stringify([{ cle: 'WV-4', date: '2026-10-23', motif: 'écran supprimé' }]));
    assert.deepEqual(loadExclusions(file), [{ key: 'WV-4', date: '2026-10-23', reason: 'écran supprimé' }]);
    fs.writeFileSync(file, '{ not json');
    assert.throws(() => loadExclusions(file), ConfigError);
    fs.writeFileSync(file, '{"key":"WV-4"}');
    assert.throws(() => loadExclusions(file), ConfigError);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('filterCandidates keeps only tickets with candidates, not covered, not excluded', () => {
  const report = (candidates) => ({ env: 'demo', date: '2026-10-23 10:00', verdict: 'OK', cases: [], candidates });
  const tickets = [
    { key: 'WV-1', title: 'covered', status: 'Test OK', report: report(['T1']) },
    { key: 'WV-4', title: 'excluded', status: 'Test OK', report: report(['T1']) },
    { key: 'WV-5', title: 'no candidates', status: 'Test OK', report: report([]) },
    { key: 'WV-6', title: 'to arbitrate', status: 'Test OK', report: report(['T2', 'T3']) },
  ];
  const remaining = filterCandidates(tickets, new Set(['WV-1']), [{ key: 'WV-4', date: '2026-10-23', reason: 'x' }]);
  assert.deepEqual(remaining.map((t) => t.key), ['WV-6']);
});

test('grepSpecs runs git grep on the spec paths and returns the files, nothing on failure', () => {
  const calls = [];
  const execFile = (file, args, options) => {
    calls.push({ file, args, cwd: options.cwd });
    return 'tests/a.spec.ts\ntests/b.spec.ts\n';
  };
  assert.deepEqual(grepSpecs('/host', 'WV-1', ['tests/', 'e2e/'], execFile), ['tests/a.spec.ts', 'tests/b.spec.ts']);
  assert.deepEqual(calls[0], { file: 'git', args: ['grep', '-l', '-w', '-F', '-e', 'WV-1', '--', 'tests/', 'e2e/'], cwd: '/host' });
  assert.deepEqual(grepSpecs('/host', 'WV-1', [], execFile), []);
  assert.equal(calls.length, 1);
  assert.deepEqual(grepSpecs('/host', 'WV-1', ['tests/'], () => { throw new Error('exit 1'); }), []);
});

test('grepSpecs also greps the bare #number of a GitHub key', () => {
  let args;
  grepSpecs('/host', 'acme/webapp#42', ['tests/'], (file, a) => {
    args = a;
    return '';
  });
  assert.deepEqual(args, ['grep', '-l', '-w', '-F', '-e', 'acme/webapp#42', '-e', '#42', '--', 'tests/']);
});

test('gitBranches and grepSpecs work on a real repository', () => {
  const repo = createTmpRepo();
  try {
    repo.commit('init');
    fs.mkdirSync(path.join(repo.dir, 'tests'));
    fs.writeFileSync(path.join(repo.dir, 'tests', 'a.spec.ts'), "test('WV-7 login', () => {});\n");
    fs.writeFileSync(path.join(repo.dir, 'tests', 'b.spec.ts'), "test('WV-70 other', () => {});\n");
    execGit(repo.dir, ['add', '.']);
    const sha = repo.commit('add specs');
    repo.setRemoteRef('test/wv-8-x', sha);
    assert.deepEqual(grepSpecs(repo.dir, 'WV-7', ['tests/']), ['tests/a.spec.ts']);
    assert.deepEqual(grepSpecs(repo.dir, 'WV-9', ['tests/']), []);
    const branches = gitBranches(repo.dir);
    assert.ok(branches.includes('main'));
    assert.ok(branches.includes('origin/test/wv-8-x'));
    assert.deepEqual(gitBranches(path.join(os.tmpdir(), 'ft-no-such-repo-dir')), []);
  } finally {
    repo.cleanup();
  }
});
