import { test } from 'node:test';
import assert from 'node:assert/strict';
import { translator } from './i18n.mjs';
import { planWarnings } from './warnings.mjs';

const t = translator('en');
const config = {
  tracker: { statuses: { toTest: ['Test'], doNotTest: ['Not a bug', 'Needs info'] } },
  environments: {
    testing: { branch: 'testing', channels: {} },
    demo: { branch: 'demo', channels: {} },
  },
};
const effective = { state: 'effective', lastAt: null, evidence: [], partialRepos: [], staleRefs: [], reason: null };
const pr = (over) => ({ repository: 'api', title: 't', sourceBranch: 's', targetBranch: 'testing', status: 'MERGED', mergedAt: null, url: '', ...over });
const run = (over = {}) =>
  planWarnings({ issue: { status: 'Test' }, envName: 'testing', defaultEnv: 'testing', config, delivery: effective, prs: [], t, ...over });

test('planWarnings stops on doNotTest status', () => {
  const result = run({ issue: { status: 'Not a bug' }, envName: 'demo', delivery: { ...effective, state: 'unknown', reason: 'mode-none' } });
  assert.equal(result.stop, true);
  assert.deepEqual(result.lines, [t('warnings.doNotTest', { status: 'Not a bug' })]);
});

test('planWarnings is silent for a regular delivery', () => {
  assert.deepEqual(run(), { stop: false, lines: [] });
});

test('planWarnings warns on unknown delivery', () => {
  const result = run({ delivery: { ...effective, state: 'unknown', reason: 'mode-none' } });
  assert.equal(result.stop, false);
  assert.deepEqual(result.lines, ['Delivery not verified: delivery check disabled (mode none).']);
  const noRef = run({ delivery: { ...effective, state: 'unknown', reason: 'no-ref-readable' } });
  assert.deepEqual(noRef.lines, ['Delivery not verified: no origin/testing ref could be read in any repository.']);
  const fr = run({ t: translator('fr'), delivery: { ...effective, state: 'unknown', reason: 'tracker-unknown' } });
  assert.deepEqual(fr.lines, ['Livraison non vérifiée : le tracker ne peut pas connaître les PR.']);
});

test('planWarnings warns on unexpected status and forced environment', () => {
  const result = run({ issue: { status: 'In progress' }, envName: 'demo' });
  assert.deepEqual(result.lines, [
    t('warnings.statusUnexpected', { status: 'In progress', expected: 'Test' }),
    t('warnings.envForced', { env: 'demo', default: 'testing' }),
  ]);
});

test('planWarnings warns when merged PRs only target another known environment branch', () => {
  const result = run({ prs: [pr({ targetBranch: 'demo' }), pr({ targetBranch: 'release/9' })] });
  assert.deepEqual(result.lines, [t('warnings.otherTargets', { targets: 'demo', branch: 'testing' })]);
  assert.deepEqual(run({ prs: [pr({ targetBranch: 'demo' }), pr({ targetBranch: 'testing' })] }).lines, []);
  assert.deepEqual(run({ prs: [pr({ targetBranch: 'release/9' })] }).lines, []);
  assert.deepEqual(run({ prs: null }).lines, []);
});

test('planWarnings warns once per partially delivered repository and per stale ref', () => {
  const delivery = {
    ...effective,
    partialRepos: ['front', 'bo'],
    staleRefs: [{ repository: 'api', lastLocalAt: '2026-10-30T08:00:00.000Z', mergedAt: '2026-10-30T10:00:00.000Z' }],
  };
  const result = run({ delivery });
  assert.deepEqual(result.lines, [
    t('warnings.partial', { repository: 'front', branch: 'testing' }),
    t('warnings.partial', { repository: 'bo', branch: 'testing' }),
    t('warnings.staleRef', { repository: 'api', localDate: '2026-10-30T08:00:00.000Z', mergedAt: '2026-10-30T10:00:00.000Z' }),
  ]);
});

test('planWarnings warns once per repository git could not read', () => {
  const delivery = { ...effective, unreadRepositories: [{ repository: 'api', reason: 'missing-ref' }, { repository: 'bo', reason: 'missing-repo' }] };
  assert.deepEqual(run({ delivery }).lines, [
    'api: origin/testing could not be read (no such remote branch) - the delivery check ignored this repository.',
    'bo: origin/testing could not be read (not a git clone) - the delivery check ignored this repository.',
  ]);
});

test('planWarnings reads the French locale', () => {
  const fr = translator('fr');
  const result = run({ t: fr, issue: { status: 'Not a bug' } });
  assert.match(result.lines[0], /^Statut « Not a bug » : ne pas tester/);
});
