import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyDefaults, ConfigError, validateConfig } from '../config.mjs';
import { translator } from '../i18n.mjs';
import { appendEnvExample, communityDriverInstall, envExampleBlock, gitignoreAdditions, mcpEntriesFor, mergeMcpJson, writeHostFiles } from './write.mjs';

const t = translator('en');
const START = '# >>> functional-test';
const END = '# <<< functional-test';

/** Config with a persistent-profile front session, a storage-state bo session and a password-login API. */
function sampleConfig(extra = {}) {
  return applyDefaults({
    version: 1,
    language: 'en',
    tracker: { type: 'jira', baseUrl: 'https://tracker.example.com', projects: ['WV'] },
    environments: {
      testing: {
        branch: 'testing',
        channels: {
          front: { url: 'https://app-testing.example.com', session: 'front' },
          bo: { url: 'https://bo-testing.example.com', session: 'bo' },
          api: { url: 'https://api-testing.example.com', auth: 'agency' },
        },
      },
      demo: {
        branch: 'demo',
        channels: { front: { url: 'https://app-demo.example.com', session: 'front' } },
      },
    },
    delivery: { mode: 'none' },
    sessions: {
      front: { mode: 'persistent-profile', mcpServer: 'playwright' },
      bo: { mode: 'storage-state', mcpServer: 'playwright-bo', file: '.auth/bo.json', command: 'npx playwright test --project=bo-auth-setup' },
    },
    auth: {
      agency: { preset: 'password-login', loginPath: '/login', usernameEnv: 'API_AGENCY_USERNAME', passwordEnv: 'API_AGENCY_PASSWORD' },
      extra: { preset: 'static-token', tokenEnv: 'API_EXTRA_TOKEN', optional: true },
    },
    automation: { framework: 'playwright', testMcpServer: 'playwright-test' },
    ...extra,
  });
}

function tmpDir() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ft-setup-')));
}

test('the sample config is valid', () => {
  assert.deepEqual(validateConfig(sampleConfig()), []);
});

test('mcpEntriesFor builds a persistent-profile playwright entry with the profile dir', () => {
  const root = tmpDir();
  const entries = mcpEntriesFor(sampleConfig(), root);
  assert.deepEqual(entries.playwright, {
    command: 'npx',
    args: ['-y', '@playwright/mcp@0.0.83', '--browser', 'chromium', '--viewport-size', '1440x900', '--user-data-dir', '.auth/profiles/front', '--output-dir', '.auth/screenshots'],
  });
  assert.deepEqual(entries['playwright-bo'], {
    command: 'npx',
    args: ['-y', '@playwright/mcp@0.0.83', '--browser', 'chromium', '--isolated', '--storage-state', '.auth/bo.json', '--viewport-size', '1440x900', '--output-dir', '.auth/screenshots'],
  });
  assert.deepEqual(entries['playwright-test'], { command: 'npx', args: ['playwright', 'run-test-mcp-server'] });
  assert.deepEqual(Object.keys(entries).sort(), ['playwright', 'playwright-bo', 'playwright-test']);
});

test('mcpEntriesFor covers every environment once, skips external sessions and custom drivers', () => {
  const root = tmpDir();
  const config = sampleConfig({ automation: { framework: 'cypress' } });
  config.sessions.front.mode = 'external';
  assert.deepEqual(Object.keys(mcpEntriesFor(config, root)), ['playwright-bo']);
  const custom = sampleConfig({ browser: { driver: 'custom', driverMapping: 'docs/mapping.md' } });
  assert.deepEqual(Object.keys(mcpEntriesFor(custom, root)), ['playwright-test']);
});

test('mcpEntriesFor writes no browser entry for the unverified community drivers', () => {
  const root = tmpDir();
  for (const driver of ['cypress-mcp', 'robotframework-mcp']) {
    const config = sampleConfig({ browser: { driver }, automation: { framework: 'cypress', testMcpServer: 'cy' } });
    for (const session of Object.values(config.sessions)) session.mode = 'external';
    assert.deepEqual(mcpEntriesFor(config, root), {}, driver);
  }
});

test('communityDriverInstall gives the install command and pin note of a community driver only', () => {
  assert.deepEqual(communityDriverInstall('cypress-mcp'), { command: 'npx -y cypress-mcp', pin: 'unpinned — pin a version before use' });
  assert.deepEqual(communityDriverInstall('robotframework-mcp'), { command: 'uvx robotframework-mcp', pin: 'unpinned — pin a version before use' });
  assert.equal(communityDriverInstall('playwright-mcp'), null);
  assert.equal(communityDriverInstall('custom'), null);
});

test('mcpEntriesFor does not mutate the templates between calls', () => {
  const root = tmpDir();
  const a = mcpEntriesFor(sampleConfig(), root);
  a.playwright.args.push('mutated');
  assert.ok(!mcpEntriesFor(sampleConfig(), root).playwright.args.includes('mutated'));
});

test('mergeMcpJson adds servers and keeps existing ones untouched', () => {
  const existing = JSON.stringify({ extra: 1, mcpServers: { mine: { command: 'x' }, playwright: { command: 'custom' } } });
  const text = mergeMcpJson(existing, { playwright: { command: 'npx' }, 'playwright-bo': { command: 'npx' } });
  assert.ok(text.endsWith('\n'));
  assert.equal(text, `${JSON.stringify(JSON.parse(text), null, 2)}\n`);
  assert.deepEqual(JSON.parse(text), {
    extra: 1,
    mcpServers: { mine: { command: 'x' }, playwright: { command: 'custom' }, 'playwright-bo': { command: 'npx' } },
  });
  assert.deepEqual(JSON.parse(mergeMcpJson(null, { a: { command: 'b' } })), { mcpServers: { a: { command: 'b' } } });
  assert.deepEqual(JSON.parse(mergeMcpJson('{}', { a: { command: 'b' } })), { mcpServers: { a: { command: 'b' } } });
});

test('mergeMcpJson on invalid JSON throws a clear error', () => {
  assert.throws(
    () => mergeMcpJson('{ "mcpServers": { "secret": "tok-123456" ', {}),
    (error) => error instanceof ConfigError && error.message === '.mcp.json is not valid JSON' && !error.message.includes('tok-123456'),
  );
  assert.throws(() => mergeMcpJson('[]', {}), ConfigError);
  assert.throws(() => mergeMcpJson('{"mcpServers": []}', {}), ConfigError);
});

test('envExampleBlock lists required then optional variables with a purpose comment', () => {
  const block = envExampleBlock(sampleConfig(), t);
  const lines = block.split('\n');
  assert.equal(lines[0], START);
  assert.equal(lines.at(-1), END);
  const names = lines.filter((l) => /^[A-Z_]+=$/.test(l)).map((l) => l.slice(0, -1));
  assert.deepEqual(names, ['JIRA_EMAIL', 'JIRA_API_TOKEN', 'API_AGENCY_USERNAME', 'API_AGENCY_PASSWORD', 'API_EXTRA_TOKEN']);
  const at = (name) => lines.indexOf(`${name}=`);
  assert.ok(lines[at('JIRA_EMAIL') - 1].startsWith('# ') && lines[at('JIRA_EMAIL') - 1].length > 3);
  assert.ok(lines[at('API_AGENCY_PASSWORD') - 1].includes('agency'));
  assert.ok(lines.indexOf('# optional') > at('API_AGENCY_PASSWORD') && lines.indexOf('# optional') < at('API_EXTRA_TOKEN'));
  assert.equal(envExampleBlock(applyDefaults({ tracker: { type: 'file' } }), t).split('\n').length, 2);
});

test('envExampleBlock localises the purposes', () => {
  const fr = envExampleBlock(sampleConfig(), translator('fr'));
  assert.notEqual(fr, envExampleBlock(sampleConfig(), t));
});

test('appendEnvExample is idempotent and replaces the delimited block', () => {
  const block = `${START}\n# purpose\nA=\n${END}`;
  const once = appendEnvExample('FOO=1\n', block);
  assert.equal(once, `FOO=1\n\n${block}\n`);
  assert.equal(appendEnvExample(once, block), once);
  assert.equal(appendEnvExample(null, block), `${block}\n`);
  assert.equal(appendEnvExample('FOO=1', block), `FOO=1\n\n${block}\n`);

  const newer = `${START}\n# purpose\nA=\nB=\n${END}`;
  const replaced = appendEnvExample(`BEFORE=1\n\n${block}\nAFTER=2\n`, newer);
  assert.equal(replaced, `BEFORE=1\n\n${newer}\nAFTER=2\n`);
  assert.equal(appendEnvExample(replaced, newer), replaced);
});

test('gitignoreAdditions returns only missing lines', () => {
  assert.deepEqual(gitignoreAdditions(null), ['.env', '.auth/']);
  assert.deepEqual(gitignoreAdditions('node_modules\n'), ['.env', '.auth/']);
  assert.deepEqual(gitignoreAdditions('.env\n'), ['.auth/']);
  assert.deepEqual(gitignoreAdditions('/.auth\r\n'), ['.env']);
  assert.deepEqual(gitignoreAdditions('.env*\n.auth/\n'), []);
});

test('writeHostFiles creates every host file and never writes .env', () => {
  const root = tmpDir();
  const result = writeHostFiles(root, sampleConfig(), { t });
  assert.deepEqual(result.written, [
    '.claude/functional-test/config.json',
    '.claude/functional-test/pitfalls.md',
    '.claude/functional-test/excluded.json',
    '.mcp.json',
    '.env.example',
    '.gitignore',
  ]);
  assert.deepEqual(result.skipped, []);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, '.claude/functional-test/config.json'), 'utf8')), sampleConfig());
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, '.claude/functional-test/excluded.json'), 'utf8')), []);
  const pitfalls = fs.readFileSync(path.join(root, '.claude/functional-test/pitfalls.md'), 'utf8');
  for (const heading of ['# Environment pitfalls', '## Deployment', '## Data', '## Accounts', '## UI', '## External dependencies']) {
    assert.ok(pitfalls.includes(heading), heading);
  }
  assert.ok(fs.readFileSync(path.join(root, '.gitignore'), 'utf8').split('\n').includes('.auth/'));
  assert.ok(fs.statSync(path.join(root, '.auth')).isDirectory());
  assert.equal(fs.existsSync(path.join(root, '.env')), false);
});

test('writeHostFiles does not overwrite an existing pitfalls.md', () => {
  const root = tmpDir();
  fs.mkdirSync(path.join(root, '.claude/functional-test'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude/functional-test/pitfalls.md'), 'MY NOTES\n');
  fs.writeFileSync(path.join(root, '.claude/functional-test/excluded.json'), '["WV-1"]');
  const { written, skipped } = writeHostFiles(root, sampleConfig(), { t });
  assert.equal(fs.readFileSync(path.join(root, '.claude/functional-test/pitfalls.md'), 'utf8'), 'MY NOTES\n');
  assert.equal(fs.readFileSync(path.join(root, '.claude/functional-test/excluded.json'), 'utf8'), '["WV-1"]');
  assert.deepEqual(skipped, ['.claude/functional-test/pitfalls.md', '.claude/functional-test/excluded.json']);
  assert.ok(written.includes('.claude/functional-test/config.json'));
});

test('writeHostFiles is idempotent: a second run only rewrites the config', () => {
  const root = tmpDir();
  writeHostFiles(root, sampleConfig(), { t });
  const before = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  const second = writeHostFiles(root, sampleConfig(), { t });
  assert.deepEqual(second.written, ['.claude/functional-test/config.json']);
  assert.deepEqual(second.skipped, ['.claude/functional-test/pitfalls.md', '.claude/functional-test/excluded.json', '.mcp.json', '.env.example', '.gitignore']);
  assert.equal(fs.readFileSync(path.join(root, '.env.example'), 'utf8'), before);
});

test('writeHostFiles keeps foreign content in .mcp.json, .env.example and .gitignore', () => {
  const root = tmpDir();
  fs.writeFileSync(path.join(root, '.mcp.json'), JSON.stringify({ mcpServers: { foreign: { command: 'f' } } }));
  fs.writeFileSync(path.join(root, '.env.example'), 'FOO=\n');
  fs.writeFileSync(path.join(root, '.gitignore'), 'dist\n');
  writeHostFiles(root, sampleConfig(), { t });
  const servers = JSON.parse(fs.readFileSync(path.join(root, '.mcp.json'), 'utf8')).mcpServers;
  assert.deepEqual(Object.keys(servers).sort(), ['foreign', 'playwright', 'playwright-bo', 'playwright-test']);
  assert.ok(fs.readFileSync(path.join(root, '.env.example'), 'utf8').startsWith('FOO=\n\n# >>> functional-test\n'));
  assert.equal(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), 'dist\n.env\n.auth/\n');
});

test('writeHostFiles does not create .mcp.json when there is no entry, and honours custom pitfalls/excluded paths', () => {
  const root = tmpDir();
  const config = applyDefaults({
    version: 1,
    tracker: { type: 'file' },
    environments: { local: { branch: 'main', channels: { front: { url: 'http://localhost:3000' } } } },
    delivery: { mode: 'none' },
    pitfallsFile: 'qa/pitfalls.md',
    automation: { framework: 'other', excludedFile: 'qa/excluded.json' },
  });
  const { written, skipped } = writeHostFiles(root, config, { t });
  assert.equal(fs.existsSync(path.join(root, '.mcp.json')), false);
  assert.ok(skipped.includes('.mcp.json'));
  assert.ok(written.includes('qa/pitfalls.md') && written.includes('qa/excluded.json'));
  assert.equal(fs.existsSync(path.join(root, '.auth')), false);
});

test('writeHostFiles propagates an invalid .mcp.json without touching it', () => {
  const root = tmpDir();
  fs.writeFileSync(path.join(root, '.mcp.json'), '{ broken');
  assert.throws(() => writeHostFiles(root, sampleConfig(), { t }), ConfigError);
  assert.equal(fs.readFileSync(path.join(root, '.mcp.json'), 'utf8'), '{ broken');
});
