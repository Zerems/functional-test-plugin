import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MARKER,
  DATA_MARKER,
  formatComment,
  parseComment,
  parseLegacyFrenchComment,
  latestReports,
  compareReplay,
} from './comment.mjs';
import { translator } from './i18n.mjs';

const fr = translator('fr');
const en = translator('en');

const report = {
  v: 1,
  env: 'testing',
  date: '2026-10-30 14:05',
  verdict: 'KO',
  delivery: 'PR « feat(order): CDI form » merged on testing on 2026-10-09',
  constraints: 'use the LA ROCHELLE agency',
  cases: [
    { id: 'T1', priority: 'P1', title: 'Create a CDI order', result: 'OK' },
    { id: 'T2', priority: 'P2', title: 'Empty end date accepted', result: 'KO', detail: 'expected: created / got: 422' },
    { id: 'T3', priority: 'P3', title: 'Temp order unchanged', result: 'UNSTABLE', detail: 'passed on retry' },
  ],
  notPlayed: 'T5 (company realm missing)',
  data: 'worker b2651f42',
  candidates: ['T1', 'T3'],
  pitfall: 'the Validate button only shows at 1920 px',
};

const minimal = {
  v: 1,
  env: 'demo',
  date: '2026-10-30 09:00',
  verdict: 'OK',
  delivery: 'PR « fix » merged on demo',
  constraints: '',
  cases: [{ id: 'T1', priority: 'P1', title: 'Filter stays active', result: 'OK' }],
  notPlayed: '',
  data: '',
  candidates: [],
};

const legacy = [
  '[test-ticket] Tests fonctionnels — testing — 2026-10-26 10:12 — Verdict : NON CONCLUANT',
  'Cause : aucune PR mergée vers testing',
  'Livraison : PR « fix » mergée sur testing',
  'Contraintes du dev : aucune',
  'Cas joués :',
  '- T1 (P1) Titre : OK',
  '- T2 (P2) Autre titre : INSTABLE — détail',
  'Non joués : aucun',
  'Données créées : aucune',
  "Candidats à l'automatisation (à arbitrer par QA) : T1",
].join('\n');

test('formatComment in fr reproduces today\'s header "[test-ticket] Tests fonctionnels — testing — 2026-10-30 14:05 — Verdict : KO"', () => {
  const lines = formatComment(report, fr).split('\n');
  assert.equal(lines[0], '[test-ticket] Tests fonctionnels — testing — 2026-10-30 14:05 — Verdict : KO');
  assert.equal(lines[1], 'Échec : T2 (P2) Empty end date accepted — expected: created / got: 422');
  assert.equal(lines[2].startsWith('Livraison : '), true);
  assert.ok(lines.includes('- T3 (P3) Temp order unchanged : INSTABLE — passed on retry'));
  assert.ok(lines.includes('Cas joués :'));
  assert.ok(lines.includes('Piège découvert : the Validate button only shows at 1920 px'));
  assert.ok(lines.includes("Candidats à l'automatisation (à arbitrer par QA) : T1, T3"));
  const none = formatComment(minimal, fr).split('\n');
  assert.ok(none.includes('Contraintes du dev : aucune'));
  assert.ok(none.includes('Non joués : aucun'));
  assert.ok(none.includes('Données créées : aucune'));
});

test('formatComment in en uses English labels and ends with the data line', () => {
  const text = formatComment(report, en);
  const lines = text.split('\n');
  assert.equal(lines[0], '[test-ticket] Functional tests — testing — 2026-10-30 14:05 — Verdict : KO');
  assert.equal(lines[1], 'Failure : T2 (P2) Empty end date accepted — expected: created / got: 422');
  assert.ok(lines.includes('Cases played :'));
  assert.ok(lines.includes('- T3 (P3) Temp order unchanged : UNSTABLE — passed on retry'));
  assert.ok(formatComment(minimal, en).includes('Not played : none'));
  const last = lines.at(-1);
  assert.ok(last.startsWith(`${DATA_MARKER} {`));
  assert.deepEqual(JSON.parse(last.slice(DATA_MARKER.length + 1)), report);
  assert.equal(MARKER, '[test-ticket]');
});

test('formatComment shows Cause for a reason and no Failure line unless the verdict is KO', () => {
  const inconclusive = { ...minimal, verdict: 'INCONCLUSIVE', reason: 'no delivery found', cases: [] };
  const lines = formatComment(inconclusive, en).split('\n');
  assert.equal(lines[1], 'Cause : no delivery found');
  assert.ok(!formatComment({ ...minimal, cases: [{ ...minimal.cases[0], result: 'KO' }], verdict: 'INCONCLUSIVE' }, en).includes('Failure :'));
});

test('parseComment reads the data line regardless of the human language', () => {
  assert.deepEqual(parseComment(formatComment(report, fr)), report);
  assert.deepEqual(parseComment(formatComment(report, en)), report);
  assert.deepEqual(parseComment(formatComment(minimal, fr)), minimal);
  // Jira paste in paragraphs: blank lines between lines
  assert.deepEqual(parseComment(formatComment(report, en).split('\n').join('\n\n')), report);
});

test('parseComment falls back to the legacy French format', () => {
  const parsed = parseComment(legacy);
  assert.deepEqual(parsed, {
    v: 1,
    env: 'testing',
    date: '2026-10-26 10:12',
    verdict: 'INCONCLUSIVE',
    delivery: 'PR « fix » mergée sur testing',
    constraints: 'aucune',
    cases: [
      { id: 'T1', priority: 'P1', title: 'Titre', result: 'OK' },
      { id: 'T2', priority: 'P2', title: 'Autre titre', result: 'UNSTABLE', detail: 'détail' },
    ],
    notPlayed: 'aucun',
    data: 'aucune',
    candidates: ['T1'],
    reason: 'aucune PR mergée vers testing',
  });
  assert.deepEqual(parseLegacyFrenchComment(legacy), parsed);
});

test('parseComment returns null for a non test-ticket text', () => {
  assert.equal(parseComment('hello'), null);
  assert.equal(parseComment(''), null);
  assert.equal(parseComment(undefined), null);
  assert.equal(parseComment('[test-ticket] x'), null);
});

test('parseComment with a corrupt data line falls back to legacy and never throws', () => {
  const corrupt = `${legacy}\n${DATA_MARKER} {not json`;
  assert.equal(parseComment(corrupt).verdict, 'INCONCLUSIVE');
  assert.equal(parseComment(`${DATA_MARKER} {not json`), null);
  assert.equal(parseComment(`${DATA_MARKER} 42`), null);
  assert.equal(parseComment(`${DATA_MARKER} null`), null);
});

test('latestReports keeps only the env and sorts newest first', () => {
  const body = (text) => ({ format: 'text', content: text });
  const comments = [
    { date: '2026-10-20T10:00:00.000+0000', body: body(formatComment({ ...minimal, env: 'testing', date: '2026-10-20 10:00' }, en)) },
    { date: '2026-10-21T10:00:00.000+0000', body: body('an ordinary comment') },
    { date: '2026-10-22T10:00:00.000+0000', body: body(formatComment({ ...minimal, env: 'demo', date: '2026-10-22 10:00' }, fr)) },
    { date: '2026-10-23T10:00:00.000+0000', body: body(formatComment({ ...minimal, env: 'testing', date: '2026-10-23 10:00', verdict: 'KO' }, fr)) },
  ];
  const toText = (b) => b.content;
  assert.deepEqual(latestReports(comments, 'testing', toText).map((r) => [r.date, r.verdict]), [
    ['2026-10-23 10:00', 'KO'],
    ['2026-10-20 10:00', 'OK'],
  ]);
  assert.deepEqual(latestReports(comments, null, toText).map((r) => r.date), [
    '2026-10-23 10:00',
    '2026-10-22 10:00',
    '2026-10-20 10:00',
  ]);
});

test('compareReplay reports before/after per case id with absent', () => {
  const c = (id, result) => ({ id, priority: 'P2', title: id, result });
  const before = { ...minimal, cases: [c('T1', 'OK'), c('T2', 'KO'), c('T10', 'OK')] };
  const after = { ...minimal, cases: [c('T1', 'OK'), c('T2', 'OK'), c('T3', 'OK')] };
  assert.deepEqual(compareReplay(before, after), [
    { id: 'T1', before: 'OK', after: 'OK' },
    { id: 'T2', before: 'KO', after: 'OK' },
    { id: 'T3', before: 'absent', after: 'OK' },
    { id: 'T10', before: 'OK', after: 'absent' },
  ]);
});
