import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractCriteria, bodyToText } from './index.mjs';

test('extractCriteria dispatches on format html, markdown, text', () => {
  assert.deepEqual(extractCriteria({ format: 'html', content: '<ul><li>A</li><li><del>B</del></li></ul>' }), [
    { number: 1, text: 'A', struck: false },
    { number: 2, text: 'B', struck: true },
  ]);
  assert.deepEqual(extractCriteria({ format: 'markdown', content: '- A\n- ~~B~~\n' }), [
    { number: 1, text: 'A', struck: false },
    { number: 2, text: 'B', struck: true },
  ]);
  assert.deepEqual(extractCriteria({ format: 'text', content: 'A\n\n  B  \n' }), [
    { number: 1, text: 'A', struck: false },
    { number: 2, text: 'B', struck: false },
  ]);
});

test('bodyToText dispatches on format; text is trimmed', () => {
  assert.equal(bodyToText({ format: 'html', content: '<p>A &amp; B</p>' }), 'A & B');
  assert.equal(bodyToText({ format: 'markdown', content: '**A**\n' }), 'A');
  assert.equal(bodyToText({ format: 'text', content: '  hello \n' }), 'hello');
});

test('missing body or content gives empty results', () => {
  assert.deepEqual(extractCriteria(undefined), []);
  assert.deepEqual(extractCriteria({ format: 'text' }), []);
  assert.equal(bodyToText(null), '');
});
