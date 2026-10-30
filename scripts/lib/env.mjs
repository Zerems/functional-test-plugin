import fs from 'node:fs';
import { hostPaths } from './host.mjs';

function parseValue(raw) {
  const v = raw.trim();
  const quote = v[0];
  if (quote === '"' || quote === "'") {
    const end = v.indexOf(quote, 1);
    if (end !== -1) {
      const inner = v.slice(1, end);
      return quote === '"' ? inner.replace(/\\n/g, '\n') : inner;
    }
  }
  const hash = v.indexOf(' #');
  return (hash === -1 ? v : v.slice(0, hash)).trim();
}

/** Parse dotenv text into a plain object. Lines without `=` are ignored. */
export function parseDotenv(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trimStart();
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (key === '') continue;
    out[key] = parseValue(line.slice(eq + 1));
  }
  return out;
}

/**
 * Load `<root>/.env` into target without overriding keys already defined.
 * Returns the keys it set; [] when the file is missing.
 */
export function loadEnv(root, target = process.env) {
  let text;
  try {
    text = fs.readFileSync(hostPaths(root).env, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const loaded = [];
  for (const [key, value] of Object.entries(parseDotenv(text))) {
    if (target[key] !== undefined) continue;
    target[key] = value;
    loaded.push(key);
  }
  return loaded;
}
