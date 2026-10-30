#!/usr/bin/env node
// Usage:
//   comment.mjs format <report.json> [--lang xx]   report JSON → tracker comment on stdout
//   comment.mjs parse                              comment on stdin → report JSON on stdout (exit 1 if not a comment)
//   comment.mjs diff <old.txt> <new.json>          per-case result before → after a replay
import fs from 'node:fs';
import { findHostRoot } from './lib/host.mjs';
import { loadConfig } from './lib/config.mjs';
import { translator } from './lib/i18n.mjs';
import { formatComment, parseComment, compareReplay } from './lib/comment.mjs';

const USAGE = 'usage: comment.mjs format <report.json> [--lang xx] | parse | diff <old.txt> <new.json>';

function fail(message, code) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    // Never error.message: V8 quotes the start of the file, which may hold a secret.
    return fail(`cannot read JSON from ${file}: ${error.code ?? 'invalid JSON'}`, 2);
  }
}

function languageFor(explicit) {
  if (explicit) return explicit;
  const root = findHostRoot();
  return root ? loadConfig(root).language : 'en';
}

function main(argv) {
  const [command, ...rest] = argv;
  if (command === 'format') {
    const i = rest.indexOf('--lang');
    const lang = i === -1 ? undefined : rest[i + 1];
    const files = i === -1 ? rest : rest.filter((_, k) => k !== i && k !== i + 1);
    if (files.length !== 1 || (i !== -1 && !lang)) return fail(USAGE, 2);
    const t = translator(languageFor(lang));
    process.stdout.write(`${formatComment(readJson(files[0]), t)}\n`);
  } else if (command === 'parse') {
    const report = parseComment(fs.readFileSync(0, 'utf8'));
    if (!report) return fail('not a [test-ticket] comment', 1);
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } else if (command === 'diff') {
    if (rest.length !== 2) return fail(USAGE, 2);
    const before = parseComment(fs.readFileSync(rest[0], 'utf8'));
    if (!before) return fail(`${rest[0]} is not a [test-ticket] comment`, 1);
    for (const { id, before: b, after: a } of compareReplay(before, readJson(rest[1]))) {
      process.stdout.write(`${id} : ${b} → ${a}\n`);
    }
  } else {
    return fail(USAGE, 2);
  }
}

try {
  main(process.argv.slice(2));
} catch (error) {
  fail(error.message, 2);
}
