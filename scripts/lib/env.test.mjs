import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseDotenv, loadEnv } from './env.mjs';

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ft-env-'));
}

test('parseDotenv reads KEY=value, ignores comments and blank lines', () => {
  const out = parseDotenv('# comment\n\nA=1\n  B = two  \nnoequals\nC=\n');
  assert.deepEqual(out, { A: '1', B: 'two', C: '' });
});

test('parseDotenv handles export prefix, single and double quotes, and # inside quotes', () => {
  const out = parseDotenv('export A=x\nB="with #hash"\nC=\'single\' # trailing');
  assert.deepEqual(out, { A: 'x', B: 'with #hash', C: 'single' });
});

test('parseDotenv expands \\n only in double quotes and cuts unquoted values at " #"', () => {
  const out = parseDotenv('A="l1\\nl2"\nB=\'l1\\nl2\'\nC=val # note\nD=a#b');
  assert.deepEqual(out, { A: 'l1\nl2', B: 'l1\\nl2', C: 'val', D: 'a#b' });
});

test('parseDotenv accepts CRLF line endings', () => {
  const out = parseDotenv('A=1\r\nB="two"\r\n\r\nC=three\r\n');
  assert.deepEqual(out, { A: '1', B: 'two', C: 'three' });
});

test('loadEnv does not override keys already present in target and returns loaded keys', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, '.env'), 'A=fromfile\nB=fromfile\nC=fromfile\n');
  const target = { A: 'keep', C: '' };
  const loaded = loadEnv(root, target);
  assert.deepEqual(loaded, ['B']);
  assert.deepEqual(target, { A: 'keep', B: 'fromfile', C: '' });
});

test('loadEnv returns [] when .env is absent', () => {
  const target = {};
  assert.deepEqual(loadEnv(tmp(), target), []);
  assert.deepEqual(target, {});
});
