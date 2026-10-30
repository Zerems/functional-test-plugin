#!/usr/bin/env node
// Usage: setup-write.mjs <answers.json> [--no-preflight]
//   Turns the answers of the /setup interview (a config-shaped JSON file) into the host files:
//   .claude/functional-test/config.json (always rewritten), pitfalls.md and excluded.json (only if
//   absent), .mcp.json, .env.example and .gitignore (merged, never overwritten). Never writes .env.
//   Without an existing host project the current directory becomes the host root. Then runs the
//   preflight for the default environment, unless --no-preflight.
// Exit codes: 0 done (and ready); 1 the preflight is blocked; 2 usage, unreadable answers or invalid
//   configuration.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError, parseFlags, reportError } from './lib/cli.mjs';
import { ConfigError, applyDefaults, requiredEnvVars, validateConfig } from './lib/config.mjs';
import { findHostRoot } from './lib/host.mjs';
import { availableLanguages, translator } from './lib/i18n.mjs';
import { writeHostFiles } from './lib/setup/write.mjs';

const PREFLIGHT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'preflight.mjs');
const COMMUNITY_DRIVERS = ['cypress-mcp', 'robotframework-mcp'];

async function main(argv) {
  const en = translator('en');
  let positionals;
  let flags;
  try {
    ({ flags, positionals } = parseFlags(argv, { 'no-preflight': 'boolean' }, en('setup.usage')));
    if (positionals.length !== 1) throw new UsageError(en('setup.usage'));
  } catch (error) {
    return reportError(error, en);
  }

  const answersFile = path.resolve(positionals[0]);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(answersFile, 'utf8'));
  } catch (error) {
    process.stderr.write(`${en('setup.unreadable', { file: answersFile, message: error.code ?? 'invalid JSON' })}\n`);
    return 2;
  }

  const config = applyDefaults(raw);
  const errors = validateConfig(config);
  const lang = translator(availableLanguages().includes(config.language) ? config.language : 'en');
  if (errors.length > 0) {
    process.stderr.write(`${[lang('setup.invalid'), ...errors].join('\n')}\n`);
    return 2;
  }

  const root = findHostRoot() ?? process.cwd();
  let result;
  try {
    result = writeHostFiles(root, config, { t: lang });
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    return reportError(error, lang);
  }
  for (const file of result.written) process.stdout.write(`${lang('setup.written', { path: file })}\n`);
  for (const file of result.skipped) process.stdout.write(`${lang('setup.skipped', { path: file })}\n`);

  const next = [];
  const { required, optional } = requiredEnvVars(config);
  if (required.length + optional.length > 0) next.push('setup.nextEnv');
  const manual = config.browser.driver === 'custom' || (config.automation.testMcpServer && config.automation.framework !== 'playwright');
  if (manual) next.push('setup.nextMcpManual');
  if (COMMUNITY_DRIVERS.includes(config.browser.driver)) next.push('setup.nextMcpCheck');
  for (const key of next) process.stdout.write(`${lang(key)}\n`);

  if (flags['no-preflight']) return 0;
  return spawnSync(process.execPath, [PREFLIGHT], { cwd: root, stdio: 'inherit' }).status ?? 1;
}

process.exitCode = await main(process.argv.slice(2));
