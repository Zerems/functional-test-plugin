#!/usr/bin/env node
// Usage: ticket.mjs <key|url|path> [--env <name>] [--json | --replay-text]
//   (default)       the ticket dossier as text: criteria, description, comments, pull requests,
//                   delivery, replay, warnings
//   --json          the dossier as JSON
//   --replay-text   the latest [test-ticket] comment of the env, verbatim (nothing if none)
// Exit codes: 0 ok; 2 usage, config, unknown env or ticket not found; 3 secrets missing;
// 4 tracker or network error; 1 anything else.
import fs from 'node:fs';
import path from 'node:path';
import { findHostRoot } from './lib/host.mjs';
import { loadEnv } from './lib/env.mjs';
import { ConfigError, loadConfig } from './lib/config.mjs';
import { translator } from './lib/i18n.mjs';
import { UsageError, parseFlags, reportError } from './lib/cli.mjs';
import { createTracker } from './lib/trackers/index.mjs';
import { createFileTracker } from './lib/trackers/file.mjs';
import { buildDossier, latestReplayText, renderDossier } from './lib/dossier.mjs';

/** `{ input, envForced, json, replayText }` or throws UsageError. */
function parseArgs(argv, usage) {
  const { flags, positionals } = parseFlags(argv, { env: 'string', json: 'boolean', 'replay-text': 'boolean' }, usage);
  if (positionals.length !== 1 || (flags.json && flags['replay-text'])) throw new UsageError(usage);
  return { input: positionals[0], envForced: flags.env, json: flags.json, replayText: flags['replay-text'] };
}

const isExistingFile = (root, input) => {
  try {
    return fs.statSync(path.resolve(root, input)).isFile();
  } catch {
    return false;
  }
};

async function main(argv) {
  const en = translator('en');
  let options;
  try {
    options = parseArgs(argv, en('ticket.usage'));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 2;
  }

  const root = findHostRoot();
  if (!root) {
    process.stderr.write(`${en('cli.noHost')}\n`);
    return 2;
  }
  let config;
  try {
    config = loadConfig(root);
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      return 2;
    }
    throw error;
  }
  loadEnv(root);
  const t = translator(config.language);

  const { input, envForced } = options;
  if (envForced && !config.environments[envForced]) {
    process.stderr.write(`${t('cli.unknownEnv', { env: envForced, expected: Object.keys(config.environments).join(', ') })}\n`);
    return 2;
  }

  let key = input;
  let tracker;
  try {
    tracker = isExistingFile(root, input) ? createFileTracker(root) : await createTracker(config, process.env, { root });
    try {
      key = tracker.normalizeKey(input);
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      return 2;
    }
    const dossier = await buildDossier({ config, env: process.env, input, envForced, tracker, deps: { root, t } });
    if (options.replayText) {
      const text = latestReplayText(dossier.issue, dossier.envName);
      if (text !== null) process.stdout.write(`${text}\n`);
    } else if (options.json) {
      process.stdout.write(`${JSON.stringify(dossier, null, 2)}\n`);
    } else {
      process.stdout.write(`${renderDossier(dossier, t)}\n`);
    }
    return 0;
  } catch (error) {
    // A local ticket file that cannot be read is a usage problem, not a tracker one.
    if (tracker?.type === 'file') {
      process.stderr.write(`${error.message}\n`);
      return 2;
    }
    return reportError(error, t, { notFound: t('ticket.notFound', { key }), networkKey: 'cli.trackerError' });
  }
}

process.exitCode = await main(process.argv.slice(2));
