import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdownToText, extractCriteriaFromMarkdown } from './markdown.mjs';

test('list items become numbered criteria', () => {
  const md = '# Acceptance criteria\n\n- First rule\n* Second rule\n+ Third rule\n1. Fourth rule\n2) Fifth rule\n';
  assert.deepEqual(extractCriteriaFromMarkdown(md), [
    { number: 1, text: 'First rule', struck: false },
    { number: 2, text: 'Second rule', struck: false },
    { number: 3, text: 'Third rule', struck: false },
    { number: 4, text: 'Fourth rule', struck: false },
    { number: 5, text: 'Fifth rule', struck: false },
  ]);
});

test('a fully struck item is marked struck with ~~ removed', () => {
  assert.deepEqual(extractCriteriaFromMarkdown('- Keep me\n- ~~Out of scope~~\n- AC 3 - ~~Also out~~\n'), [
    { number: 1, text: 'Keep me', struck: false },
    { number: 2, text: 'Out of scope', struck: true },
    { number: 3, text: 'AC 3 - Also out', struck: true },
  ]);
});

test('a partially struck item keeps ~~ markers and is not struck', () => {
  assert.deepEqual(extractCriteriaFromMarkdown('- The ~~date~~ name field is **required**\n'), [
    { number: 1, text: 'The ~~date~~ name field is required', struck: false },
  ]);
});

test('without list, paragraphs become criteria and the "As a" intent line is dropped', () => {
  const md = 'As a user I want a button\n\nThe button is greyed out\nuntil the form is valid\n\nEn tant que CR je veux X\n\nThe message appears\n';
  assert.deepEqual(extractCriteriaFromMarkdown(md).map((c) => c.text), [
    'The button is greyed out until the form is valid',
    'En tant que CR je veux X',
    'The message appears',
  ]);
  assert.deepEqual(extractCriteriaFromMarkdown('En tant que CR je veux X\n\nLe bouton est grisé\n').map((c) => c.text), ['Le bouton est grisé']);
});

test('checkbox markers are stripped', () => {
  assert.deepEqual(extractCriteriaFromMarkdown('- [ ] Todo item\n- [x] Done item\n- [X] Also done\n').map((c) => c.text), [
    'Todo item',
    'Done item',
    'Also done',
  ]);
});

test('nested items are included in order', () => {
  const md = '- Parent\n  - Child A\n    - Grandchild\n\t- Child B (tab)\n- Next\n';
  assert.deepEqual(extractCriteriaFromMarkdown(md).map((c) => c.text), ['Parent', 'Child A', 'Grandchild', 'Child B (tab)', 'Next']);
});

test('headings and fenced code blocks are never criteria', () => {
  const md = '## Heading\n\n```\n- not a criterion\n```\n\n- Real one\n';
  assert.deepEqual(extractCriteriaFromMarkdown(md).map((c) => c.text), ['Real one']);
});

test('multi-line list item continuation is joined', () => {
  assert.deepEqual(extractCriteriaFromMarkdown('- First line\n  continued here\n- Second\n').map((c) => c.text), [
    'First line continued here',
    'Second',
  ]);
});

test('empty or missing body', () => {
  assert.deepEqual(extractCriteriaFromMarkdown(''), []);
  assert.deepEqual(extractCriteriaFromMarkdown(undefined), []);
  assert.equal(markdownToText(null), '');
});

test('markdownToText strips emphasis, keeps ~~, bullets and numbering, links and images, collapses blank lines', () => {
  const md = '# Title\n\n**bold** _it_ `code` __b2__ *i2* ~~gone~~\n\n\n\n- [text](http://x.y) and ![alt](a.png)\n1. one\n';
  assert.equal(
    markdownToText(md),
    '# Title\n\nbold it code b2 i2 ~~gone~~\n\n- text and alt\n1. one',
  );
});

test('a hard-wrapped intent paragraph is dropped entirely', () => {
  const md = 'As a CR,\nI want X,\nso that Y\n\nThe button is greyed\n';
  assert.deepEqual(extractCriteriaFromMarkdown(md).map((c) => c.text), ['The button is greyed']);
  assert.deepEqual(extractCriteriaFromMarkdown('En tant que CR,\nje veux X\n\nEn tant que Z\n').map((c) => c.text), ['En tant que Z']);
});

test('a label-only item is not struck', () => {
  assert.deepEqual(extractCriteriaFromMarkdown('- CA 2\n'), [{ number: 1, text: 'CA 2', struck: false }]);
});
