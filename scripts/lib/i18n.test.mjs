import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { availableLanguages, loadLocale, translator } from './i18n.mjs';

test("translator('fr') translates verdict.INCONCLUSIVE to NON CONCLUANT", () => {
  assert.equal(translator('fr')('verdict.INCONCLUSIVE'), 'NON CONCLUANT');
});

test("translator('fr') falls back to en for a key missing in fr", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-locales-'));
  fs.writeFileSync(path.join(dir, 'en.json'), JSON.stringify({ a: 'Hello', b: 'Only en' }));
  fs.writeFileSync(path.join(dir, 'fr.json'), JSON.stringify({ a: 'Bonjour' }));
  const t = translator('fr', dir);
  assert.equal(t('a'), 'Bonjour');
  assert.equal(t('b'), 'Only en');
  fs.rmSync(dir, { recursive: true });
});

test("translator('en') interpolates {name}", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-locales-'));
  fs.writeFileSync(path.join(dir, 'en.json'), JSON.stringify({ greet: 'Hello {name}, {name}!' }));
  assert.equal(translator('en', dir)('greet', { name: 'Ada' }), 'Hello Ada, Ada!');
  fs.rmSync(dir, { recursive: true });
});

test('translator returns the key when unknown', () => {
  assert.equal(translator('en')('no.such.key'), 'no.such.key');
});

test('loadLocale throws for an unknown language', () => {
  assert.throws(() => loadLocale('xx'), /unknown language: xx/);
});

test('shipped locales cover the same keys and list en and fr', () => {
  assert.deepEqual(availableLanguages(), ['en', 'fr']);
  assert.deepEqual(Object.keys(loadLocale('fr')).sort(), Object.keys(loadLocale('en')).sort());
});
