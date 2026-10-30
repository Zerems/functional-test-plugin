#!/usr/bin/env node
// Usage: session.mjs --env <name> --session <name> [--force]
//   Makes sure the browser session `--session` is usable on environment `--env`.
//   persistent-profile: creates the profile folder; external: nothing to check;
//   storage-state: validates the file, runs the session's setup command when it is invalid
//   (or with --force) and validates again. The command's output goes to stderr (fd 2), so stdout
//   carries the JSON line only.
//   Prints one JSON line { state: 'valid'|'invalid'|'external', mode, mcpServer, host, file?,
//   profileDir?, setupRan, reason?, reasonCode? }; the content of the state file is never printed.
// Exit codes: 0 valid or external; 1 still invalid; 2 usage or config; no host project.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { UsageError, parseFlags, reportError } from './lib/cli.mjs';
import { ConfigError, channelsOf, loadConfig } from './lib/config.mjs';
import { loadEnv } from './lib/env.mjs';
import { findHostRoot } from './lib/host.mjs';
import { translator } from './lib/i18n.mjs';
import { profileDir, sessionPlan, setupCommand, validateStorageState } from './lib/session.mjs';

/** Validation result of the storage-state file: `{ valid, reason, ... }` with `unreadable` when it is not JSON. */
function checkFile(file, host) {
  if (!fs.existsSync(file)) return validateStorageState(null, host, new Date(), new Date());
  let state;
  try {
    state = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { valid: false, reason: 'unreadable' };
  }
  return validateStorageState(state, host, new Date(), fs.statSync(file).mtime);
}

/** Localised text of a validation result. */
function describe(result, t) {
  const known = result.known?.length ? result.known.join(', ') : t('session.noKnownHost');
  return t(`session.reason.${result.reason}`, { host: result.host, hours: result.hours, known });
}

async function main(argv) {
  const en = translator('en');
  const say = (message) => process.stderr.write(`${message}\n`);
  let flags;
  try {
    ({ flags } = parseFlags(argv, { env: 'string', session: 'string', force: 'boolean' }, en('session.usage')));
    if (!flags.env || !flags.session) throw new UsageError(en('session.usage'));
  } catch (error) {
    return reportError(error, en);
  }

  const root = findHostRoot();
  if (!root) {
    say(en('cli.noHost'));
    return 2;
  }
  let config;
  try {
    config = loadConfig(root);
  } catch (error) {
    if (error instanceof ConfigError) return reportError(error, en);
    throw error;
  }
  loadEnv(root);
  const t = translator(config.language);

  if (!config.environments[flags.env]) {
    say(t('cli.unknownEnv', { env: flags.env, expected: Object.keys(config.environments).join(', ') }));
    return 2;
  }

  try {
    const plan = sessionPlan(config, flags.env, flags.session);
    const out = { state: 'valid', mode: plan.mode, mcpServer: plan.mcpServer, host: plan.host };

    if (plan.mode === 'external') {
      out.state = 'external';
      out.setupRan = false;
    } else if (plan.mode === 'persistent-profile') {
      out.profileDir = profileDir(root, flags.session);
      fs.mkdirSync(out.profileDir, { recursive: true });
      out.setupRan = false;
    } else {
      const file = path.resolve(root, plan.file);
      out.file = file;
      out.setupRan = false;
      let result = checkFile(file, plan.host);
      if (!result.valid || flags.force) {
        const note = result.valid ? 'session.setupForced' : 'session.setupRun';
        say(t(note, { session: flags.session, reason: result.valid ? '' : describe(result, t), host: plan.host }));
        const urls = Object.fromEntries(Object.entries(channelsOf(config, flags.env)).map(([name, channel]) => [name, channel.url]));
        const { command, args, env } = setupCommand(plan, urls, flags.env);
        const run = spawnSync(command, args, { cwd: root, env, stdio: ['ignore', 2, 2] });
        out.setupRan = true;
        if (run.status !== 0) say(t('session.setupFailed', { status: run.status ?? run.error?.message ?? run.signal }));
        result = checkFile(file, plan.host);
      }
      if (!result.valid) {
        out.state = 'invalid';
        out.reason = describe(result, t);
        out.reasonCode = result.reason;
      }
    }

    process.stdout.write(`${JSON.stringify(out)}\n`);
    return out.state === 'invalid' ? 1 : 0;
  } catch (error) {
    return reportError(error, t);
  }
}

process.exitCode = await main(process.argv.slice(2));
