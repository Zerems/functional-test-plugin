#!/usr/bin/env node
// Usage: candidates.mjs [--json] [--all]
//   Tickets whose latest [test-ticket] comment proposes cases to automate, minus those already
//   covered (a spec citing the key, a branch named after it) and those QA set aside.
//   --json  { remaining, covered, exclusions, truncated } as JSON
//   --all   also lists the covered tickets, the exclusions and the tickets without candidate
// Exit codes: 0 ok; 2 usage, config or file tracker; 3 secrets missing; 4 tracker or network error;
// 1 anything else.
import path from 'node:path';
import { findHostRoot } from './lib/host.mjs';
import { loadEnv } from './lib/env.mjs';
import { ConfigError, loadConfig } from './lib/config.mjs';
import { translator } from './lib/i18n.mjs';
import { parseFlags, reportError } from './lib/cli.mjs';
import { createTracker } from './lib/trackers/index.mjs';
import { MARKER, latestReports } from './lib/comment.mjs';
import { bodyToText } from './lib/criteria/index.mjs';
import { coveredKeys, filterCandidates, gitBranches, grepSpecs, loadExclusions } from './lib/coverage.mjs';

const timeOf = (date) => {
  const ms = Date.parse(date);
  return Number.isNaN(ms) ? 0 : ms;
};

/** Text output: one block per remaining ticket, then (with `--all`) the covered, excluded and candidate-less ones. */
function renderText({ remaining, covered, exclusions, withoutCandidate, all }, t) {
  const list = (items) => items.join(', ') || t('candidates.noneListed');
  const lines = [];
  if (remaining.length === 0) lines.push(t('candidates.none'));
  for (const ticket of remaining) {
    const { report } = ticket;
    lines.push(`${ticket.key} · ${ticket.status} · ${report.env} · ${report.date} · ${ticket.title}`);
    for (const id of report.candidates) {
      const found = report.cases.find((c) => c.id === id);
      lines.push(found ? `  - ${found.id} (${found.priority}) ${found.title}` : `  - ${id} ${t('candidates.missingCase')}`);
    }
  }
  if (all) {
    lines.push(
      '',
      t('candidates.covered', { list: list(covered) }),
      t('candidates.excluded', { list: list(exclusions.map((e) => (e.reason ? `${e.key} (${e.reason})` : e.key))) }),
      t('candidates.withoutCandidate', { list: list(withoutCandidate) }),
    );
  }
  return lines.join('\n');
}

async function main(argv) {
  const en = translator('en');
  let flags;
  try {
    ({ flags } = parseFlags(argv, { json: 'boolean', all: 'boolean' }, en('candidates.usage')));
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

  if (config.tracker.type === 'file') {
    process.stderr.write(`${t('candidates.unsupported')}\n`);
    return 2;
  }

  try {
    const tracker = await createTracker(config, process.env, { root });
    const keys = await tracker.searchWithMarker(MARKER);
    const truncated = tracker.lastSearchTruncated === true;
    if (truncated) process.stderr.write(`${t('candidates.truncated')}\n`);

    const tickets = [];
    for (const key of keys) {
      const issue = await tracker.getIssue(key);
      const [latest] = latestReports(issue.comments, null, bodyToText);
      if (latest) tickets.push({ key: issue.key, title: issue.title, status: issue.status, date: latest.date, report: latest });
    }
    tickets.sort((a, b) => timeOf(b.date) - timeOf(a.date));

    const { specPaths, branchPattern, excludedFile } = config.automation;
    const covered = coveredKeys(
      tickets.map((ticket) => ticket.key),
      { specPaths, pattern: branchPattern, grep: (key, paths) => grepSpecs(root, key, paths), branches: () => gitBranches(root) },
    );
    const exclusions = loadExclusions(path.resolve(root, excludedFile));
    const remaining = filterCandidates(tickets, covered, exclusions);

    if (flags.json) {
      process.stdout.write(`${JSON.stringify({ remaining, covered: [...covered], exclusions, truncated }, null, 2)}\n`);
    } else {
      const withoutCandidate = tickets.filter((ticket) => ticket.report.candidates.length === 0).map((ticket) => ticket.key);
      process.stdout.write(`${renderText({ remaining, covered: [...covered], exclusions, withoutCandidate, all: flags.all }, t)}\n`);
    }
    return 0;
  } catch (error) {
    return reportError(error, t, { networkKey: 'cli.trackerError' });
  }
}

process.exitCode = await main(process.argv.slice(2));
