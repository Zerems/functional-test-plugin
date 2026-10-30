import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = path.join(path.dirname(new URL(import.meta.url).pathname), 'comment.mjs');

function run(cwd, args) {
  return new Promise((resolve) => {
    execFile('node', [SCRIPT, ...args], { cwd, env: { PATH: process.env.PATH } }, (error, stdout, stderr) => {
      resolve({ code: error ? error.code : 0, stdout, stderr });
    });
  });
}

test('comment.mjs format never echoes the content of a file that is not JSON', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-comment-'));
  try {
    const secret = 'secret-from-dotenv-987';
    fs.writeFileSync(path.join(dir, '.env'), `TOKEN=${secret}\n`);
    const { code, stdout, stderr } = await run(dir, ['format', '.env', '--lang', 'en']);
    assert.equal(code, 2);
    assert.ok(!stdout.includes(secret) && !stderr.includes(secret), stderr);
    assert.ok(!stdout.includes('TOKEN') && !stderr.includes('TOKEN='), stderr);
    assert.match(stderr, /cannot read JSON from \.env/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
