import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToText, extractCriteriaFromHtml } from './html.mjs';

test('bullet list and strike-through kept', () => {
  const html =
    '<p>En tant que CR je veux créer une commande</p><ul><li>Vérifier le formulaire</li><li><del>Vérifier la description</del></li></ul>';
  assert.equal(
    htmlToText(html),
    'En tant que CR je veux créer une commande\n\n- Vérifier le formulaire\n- ~~Vérifier la description~~',
  );
});

test('entities and unknown tags', () => {
  assert.equal(htmlToText('<p>A &amp; B&nbsp;<span class="x">C</span> &#39;D&#39;</p>'), "A & B C 'D'");
});

test('ordered list and headings', () => {
  assert.equal(htmlToText('<h2>Règles</h2><ol><li>un</li><li>deux</li></ol>'), 'Règles\n\n1. un\n2. deux');
});

test('criteria from li items, strike-through detected', () => {
  const html = '<p>Intention</p><ul><li>CA un</li><li><s>CA deux</s></li></ul>';
  assert.deepEqual(extractCriteriaFromHtml(html), [
    { number: 1, text: 'CA un', struck: false },
    { number: 2, text: 'CA deux', struck: true },
  ]);
});

test('criteria from paragraphs when there is no list', () => {
  const html = '<p>En tant que CR je veux un bouton</p><p>Le bouton est grisé</p><p></p><p>Le message apparaît</p>';
  assert.deepEqual(
    extractCriteriaFromHtml(html).map((c) => c.text),
    ['Le bouton est grisé', 'Le message apparaît'],
  );
});

test('empty or missing description', () => {
  assert.deepEqual(extractCriteriaFromHtml(''), []);
  assert.deepEqual(extractCriteriaFromHtml(null), []);
  assert.equal(htmlToText(undefined), '');
});

test('partial strike-through stays in the criterion text, not struck', () => {
  assert.deepEqual(extractCriteriaFromHtml('<ul><li>Le champ <del>date</del> nom est requis</li></ul>'), [
    { number: 1, text: 'Le champ ~~date~~ nom est requis', struck: false },
  ]);
});

test('<br> inside a paragraph separates criteria, strike-through kept', () => {
  const html = '<p>En tant que CR je veux…</p><p>CA1 : le filtre reste actif<br/>CA2 : <del>le compteur se met à jour</del></p>';
  assert.deepEqual(extractCriteriaFromHtml(html), [
    { number: 1, text: 'CA1 : le filtre reste actif', struck: false },
    { number: 2, text: 'CA2 : le compteur se met à jour', struck: true },
  ]);
});

test('nested lists: parent and children are separate', () => {
  const html = '<ul><li>Parent<ul><li>Enfant A</li><li>Enfant B</li></ul></li><li>Suivant</li></ul>';
  assert.deepEqual(extractCriteriaFromHtml(html).map((c) => c.text), ['Parent', 'Enfant A', 'Enfant B', 'Suivant']);
  assert.equal(htmlToText(html), '- Parent\n  - Enfant A\n  - Enfant B\n- Suivant');
});

test('a single paragraph becomes the criterion; the "En tant que" intent is dropped', () => {
  assert.deepEqual(extractCriteriaFromHtml('<p>La commande reste « à traiter » après confirmation</p>').map((c) => c.text), [
    'La commande reste « à traiter » après confirmation',
  ]);
  assert.deepEqual(extractCriteriaFromHtml('<p>En tant que CR je veux X</p><p>Le bouton est grisé</p>').map((c) => c.text), ['Le bouton est grisé']);
  assert.deepEqual(extractCriteriaFromHtml('<p>Étapes : ouvrir la fiche</p><p>Attendu : le statut change</p>').map((c) => c.text), [
    'Étapes : ouvrir la fiche',
    'Attendu : le statut change',
  ]);
});

test('an issue key rendered as a Jira macro (link + status badge) is reduced to the bare key, on the same line', () => {
  const macro =
    '\n    <span class="jira-issue-macro" data-jira-key="WV-327" >\n' +
    '                <a href="https://example.atlassian.net/browse/WV-327" class="jira-issue-macro-key issue-link"  title="Titre" >\n' +
    '            <img class="icon" src="https://example.atlassian.net/avatar.png" />\n            WV-327\n        </a>\n' +
    '                <span class="aui-lozenge aui-lozenge-subtle aui-lozenge-current jira-macro-single-issue-export-pdf">Test</span>\n' +
    '            </span>\n';
  const html = `<p>Cas joués :</p>\n<ul>\n\t<li>T12 (P2) Autre agence : KO — non imputée à ${macro}</li>\n\t<li>T13 (P2) Id inexistant : OK</li>\n</ul>\n<p>Données créées : besoin [E2E] ${macro} 7c2a</p>`;
  assert.equal(
    htmlToText(html),
    'Cas joués :\n\n- T12 (P2) Autre agence : KO — non imputée à WV-327\n- T13 (P2) Id inexistant : OK\n\nDonnées créées : besoin [E2E] WV-327 7c2a',
  );
});

test('a label-only item is not struck', () => {
  assert.deepEqual(extractCriteriaFromHtml('<ul><li>CA 2</li><li>3.</li></ul>'), [
    { number: 1, text: 'CA 2', struck: false },
    { number: 2, text: '3.', struck: false },
  ]);
});

test('a struck item may keep an AC or criteria label outside the strike-through', () => {
  assert.deepEqual(extractCriteriaFromHtml('<ul><li>AC 2 - <del>out of scope</del></li><li>Criteria 3 : <s>dropped</s></li></ul>'), [
    { number: 1, text: 'AC 2 - out of scope', struck: true },
    { number: 2, text: 'Criteria 3 : dropped', struck: true },
  ]);
});

test('an English "As a" intent paragraph is dropped when there is no list', () => {
  assert.deepEqual(
    extractCriteriaFromHtml('<p>As a CR I want a button</p><p>The button is greyed out</p>').map((c) => c.text),
    ['The button is greyed out'],
  );
});
