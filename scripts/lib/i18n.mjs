import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCALES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'locales');

/** Language codes that have a locale file, sorted. */
export function availableLanguages(dir = LOCALES_DIR) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
    .sort();
}

function readLocale(dir, lang) {
  const file = path.join(dir, `${lang}.json`);
  if (!/^[a-z]{2,3}$/.test(lang) || !fs.existsSync(file)) throw new Error(`unknown language: ${lang}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Flat key → label map for `lang`, any key missing there taken from `en`. */
export function loadLocale(lang, dir = LOCALES_DIR) {
  const en = readLocale(dir, 'en');
  return lang === 'en' ? en : { ...en, ...readLocale(dir, lang) };
}

/** `(key, params?) => string`; `{name}` placeholders are interpolated, an unknown key is returned as is. */
export function translator(lang, dir = LOCALES_DIR) {
  const messages = loadLocale(lang, dir);
  return (key, params = {}) => {
    const template = messages[key];
    if (template === undefined) return key;
    return template.replace(/\{(\w+)\}/g, (whole, name) => (name in params ? String(params[name]) : whole));
  };
}
