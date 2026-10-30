/**
 * Ticket dossier: everything the test plan starts from, built from the tracker, the
 * delivery check and the previous reports, then rendered as plain text for the skill.
 *
 * Dossier = { issue, criteria, envName, envDefault, envForced, branch, prs, delivery, scope,
 *   replays, warnings, stop }  (`branch`: the environment's branch, for the rendered delivery lines)
 * `prs` is the tracker's pull requests, or null when they were not read.
 */
import { channelsOf, defaultEnvironmentFor, environmentOf } from './config.mjs';
import { MARKER, latestReports } from './comment.mjs';
import { bodyToText, extractCriteria } from './criteria/index.mjs';
import { assessDelivery, effectiveRepositoriesDir, gitLogDelivery, technicalScope } from './delivery.mjs';
import { translator } from './i18n.mjs';
import { planWarnings } from './warnings.mjs';

const GIT_MODES = ['git-log', 'both'];
const TRACKER_MODES = ['tracker', 'both'];

/**
 * Reads the ticket and assembles its dossier for the target environment.
 * `input` is what the user typed (a key, a URL or a file path, whatever `tracker` understands);
 * `envForced` the `--env` value or null. `deps`: `root` (host root, required for git modes),
 * `now`, `t` (translator for the warnings, default: the configured language),
 * `gitLog` (replacement for `gitLogDelivery`, for tests).
 */
export async function buildDossier({ config, env, input, envForced = null, tracker, deps = {} }) {
  const { root, now = new Date(), gitLog = gitLogDelivery } = deps;
  const t = deps.t ?? translator(config.language);
  if (envForced) environmentOf(config, envForced); // fail before any network call

  const issue = await tracker.getIssue(tracker.normalizeKey(input));
  const envDefault = defaultEnvironmentFor(config, issue.key);
  const envName = envForced || envDefault;
  const branch = environmentOf(config, envName).branch;

  const { mode, recentMinutes } = config.delivery;
  const repositories = config.delivery.repositories ?? [];
  const git =
    GIT_MODES.includes(mode) && repositories.length > 0
      ? gitLog({ root, repositoriesDir: effectiveRepositoriesDir(config, env), repositories, branch, key: issue.key })
      : null;
  const prs = TRACKER_MODES.includes(mode) && tracker.type !== 'file' ? await tracker.getLinkedPullRequests(issue) : null;

  const delivery = assessDelivery({ mode, git, tracker: prs, branch, now, recentMinutes });
  const scope = technicalScope({ delivery, repositories, channels: Object.keys(channelsOf(config, envName)), root });
  const { stop, lines } = planWarnings({ issue, envName, defaultEnv: envDefault, config, delivery, prs, t });

  return {
    issue,
    criteria: extractCriteria(issue.body),
    envName,
    envDefault,
    envForced: Boolean(envForced),
    branch,
    prs,
    delivery,
    scope,
    replays: latestReports(issue.comments ?? [], envName, bodyToText),
    warnings: lines,
    stop,
  };
}

const timeOf = (date) => Date.parse(date) || 0;

/**
 * Text of the newest `[test-ticket]` comment written for `envName`, as the tracker returned it
 * (to feed `comment.mjs diff`); null when there is none.
 */
export function latestReplayText(issue, envName) {
  const found = (issue.comments ?? [])
    .map((c) => ({ date: c.date, text: bodyToText(c.body) }))
    .filter(({ text }) => text.startsWith(MARKER) && text.split('\n')[0].includes(` — ${envName} — `))
    .sort((a, b) => timeOf(b.date) - timeOf(a.date));
  return found.length > 0 ? found[0].text : null;
}

/** `YYYY-MM-DD HH:MM` from an ISO date, as written; `?` when there is none. */
const formatDate = (iso) => (typeof iso === 'string' && iso.length >= 16 ? iso.slice(0, 16).replace('T', ' ') : '?');

/** Locale label of a canonical code; the code itself when the locale has none. */
function label(t, prefix, code) {
  const text = t(`${prefix}.${code}`);
  return text === `${prefix}.${code}` ? code : text;
}

function deliveryLines(d, t, now) {
  const { delivery, envName, scope, branch } = d;
  const lines = [];
  if (delivery.state === 'absent') lines.push(t('dossier.deliveryAbsent', { env: envName }));
  else if (delivery.state === 'recent') {
    const minutes = Math.max(0, Math.round((now.getTime() - new Date(delivery.lastAt).getTime()) / 60_000));
    lines.push(t('dossier.deliveryRecent', { minutes: Number.isNaN(minutes) ? '?' : minutes }));
  } else if (delivery.state === 'effective') lines.push(t('dossier.deliveryEffective', { date: formatDate(delivery.lastAt).slice(0, 10) }));
  else {
    lines.push(t('dossier.deliveryUnknown', { reason: t(`delivery.reason.${delivery.reason}`, { branch }) }));
  }

  for (const e of delivery.evidence) {
    const parts = [e.repository, label(t, 'dossier.kind', e.kind)];
    if (e.sha) parts.push(e.sha.slice(0, 7));
    parts.push(formatDate(e.date), e.title);
    lines.push(`- ${parts.join(' · ')}`);
  }

  const scopeText = scope.length > 0 ? scope.join(', ') : t('dossier.scopeNone');
  lines.push(t(delivery.state === 'unknown' ? 'dossier.technicalScopeUnknown' : 'dossier.technicalScope', { scope: scopeText }));
  for (const repository of delivery.partialRepos) lines.push(t('dossier.partial', { repository, branch }));
  for (const { repository, lastLocalAt, mergedAt } of delivery.staleRefs) {
    lines.push(t('dossier.staleRef', { repository, localDate: formatDate(lastLocalAt), mergedAt: formatDate(mergedAt) }));
  }
  if (scope.length === 1 && scope[0] === 'mobile') lines.push(t('dossier.mobileOnly'));
  return lines;
}

function replayLines(d, t) {
  const { replays, issue, envName } = d;
  if (replays.length === 0) return [t('dossier.firstRun')];
  const lines = replays.map((r) => {
    const cases = r.cases.map((c) => `${c.id} ${label(t, 'result', c.result)}`).join(', ');
    return `- ${t('dossier.replayLine', { date: r.date, verdict: label(t, 'verdict', r.verdict), count: r.cases.length, cases })}`;
  });
  const [last] = replays;
  lines.push(t('dossier.replayPlan'));
  for (const c of last.cases) lines.push(`  - ${c.id} (${c.priority}) ${c.title}`);
  lines.push(
    `  ${t('dossier.prevConstraints')} : ${last.constraints ?? ''}`,
    `  ${t('dossier.prevNotPlayed')} : ${last.notPlayed ?? ''}`,
    `  ${t('dossier.replayTextHint', { key: issue.key, env: envName })}`,
  );
  return lines;
}

/**
 * Dossier → text, sections in a fixed order, headings and notices from `t`.
 * `now` only serves the "delivered N min ago" line.
 */
export function renderDossier(dossier, t, { now = new Date() } = {}) {
  const { issue, criteria, envName, prs, warnings } = dossier;
  const out = [];
  const section = (title, lines) => out.push('', `## ${title}`, ...lines);

  out.push(`# ${issue.key} — ${issue.title}`);
  out.push(
    t('dossier.meta', {
      type: issue.type,
      status: issue.status || '-',
      env: envName,
      origin: t(dossier.envForced ? 'dossier.envForced' : 'dossier.envDeduced'),
    }),
  );
  if (issue.parent) out.push(`${t('dossier.parent')} : ${issue.parent.key} — ${issue.parent.title}`);
  if (issue.labels?.length) out.push(`${t('dossier.labels')} : ${issue.labels.join(', ')}`);
  if (issue.links?.length) out.push(`${t('dossier.links')} : ${issue.links.map((l) => `${l.type} ${l.key} (${l.title})`).join(' ; ')}`);

  section(t('dossier.criteria'), criteria.length === 0
    ? [t('dossier.noCriteria')]
    : criteria.map((c) => (c.struck ? `${c.number}. ~~${c.text}~~ ${t('dossier.struck')}` : `${c.number}. ${c.text}`)));

  section(t('dossier.description'), [bodyToText(issue.body) || t('dossier.empty')]);

  const ordinary = (issue.comments ?? [])
    .map((c) => ({ ...c, text: bodyToText(c.body) }))
    .filter((c) => !c.text.startsWith(MARKER));
  section(t('dossier.comments'), ordinary.length === 0
    ? [t('dossier.none')]
    : ordinary.map((c) => `- ${formatDate(c.date)} ${c.author} : ${c.text.replace(/\n+/g, ' / ')}`));

  section(t('dossier.pullRequests'), prs === null
    ? [t('dossier.pullRequestsUnknown')]
    : prs.length === 0
      ? [t('dossier.noPullRequests')]
      : prs.map((p) => `- ${p.repository} · ${p.status} · ${p.sourceBranch} → ${p.targetBranch} · ${formatDate(p.mergedAt).slice(0, 10)} · ${p.title}`));

  section(t('dossier.delivery', { env: envName }), deliveryLines(dossier, t, now));
  section(t('dossier.replay'), replayLines(dossier, t));
  section(t('dossier.warnings'), warnings.length === 0 ? [t('dossier.none')] : warnings.map((w) => `- ${w}`));

  return out.join('\n');
}
