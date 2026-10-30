/**
 * The `[test-ticket]` tracker comment: a localised human part followed by one
 * machine-readable data line, the parser that reads it back (data line first,
 * legacy French format as fallback) and the replay comparison.
 *
 * Report = {
 *   v: 1, env, date ('YYYY-MM-DD HH:MM'), verdict ('OK' | 'KO' | 'INCONCLUSIVE'),
 *   delivery, constraints, cases: [{ id, priority ('P1'|'P2'|'P3'), title,
 *   result ('OK'|'KO'|'UNSTABLE'), detail? }], notPlayed, data, candidates: [id],
 *   pitfall?, reason?
 * }
 */

export const MARKER = '[test-ticket]';
export const DATA_MARKER = '[test-ticket:data]';

/** Canonical report (codes, fixed key order) without any localised text. */
function canonical(report) {
  const out = {
    v: 1,
    env: report.env,
    date: report.date,
    verdict: report.verdict,
    delivery: report.delivery,
    constraints: report.constraints,
    cases: (report.cases ?? []).map((c) => {
      const item = { id: c.id, priority: c.priority, title: c.title, result: c.result };
      if (c.detail) item.detail = c.detail;
      return item;
    }),
    notPlayed: report.notPlayed,
    data: report.data,
    candidates: report.candidates ?? [],
  };
  if (report.pitfall) out.pitfall = report.pitfall;
  if (report.reason) out.reason = report.reason;
  return out;
}

const withDetail = (detail) => (detail ? ` — ${detail}` : '');

/** Report → tracker comment (plain text), human lines in the language of `t`, then the data line. */
export function formatComment(report, t) {
  const r = canonical(report);
  const field = (key, value, none) => `${t(key)} : ${value || t(none)}`;
  const lines = [`${MARKER} ${t('comment.title')} — ${r.env} — ${r.date} — ${t('comment.verdict')} : ${t(`verdict.${r.verdict}`)}`];
  if (r.verdict === 'KO') {
    for (const c of r.cases.filter((x) => x.result === 'KO')) {
      lines.push(`${t('comment.failure')} : ${c.id} (${c.priority}) ${c.title}${withDetail(c.detail)}`);
    }
  }
  if (r.reason) lines.push(`${t('comment.cause')} : ${r.reason}`);
  lines.push(
    `${t('comment.delivery')} : ${r.delivery}`,
    field('comment.constraints', r.constraints, 'comment.noneF'),
    `${t('comment.cases')} :`,
    ...r.cases.map((c) => `- ${c.id} (${c.priority}) ${c.title} : ${t(`result.${c.result}`)}${withDetail(c.detail)}`),
    field('comment.notPlayed', r.notPlayed, 'comment.none'),
    field('comment.data', r.data, 'comment.noneF'),
  );
  if (r.candidates.length > 0) lines.push(`${t('comment.candidates')} : ${r.candidates.join(', ')}`);
  if (r.pitfall) lines.push(`${t('comment.pitfall')} : ${r.pitfall}`);
  lines.push(`${DATA_MARKER} ${JSON.stringify(r)}`);
  return lines.join('\n');
}

function contentLines(text) {
  return String(text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function parseDataLine(lines) {
  const line = lines.find((l) => l.startsWith(DATA_MARKER));
  if (line === undefined) return null;
  let data;
  try {
    data = JSON.parse(line.slice(DATA_MARKER.length));
  } catch {
    return null;
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;
  return {
    ...data,
    v: data.v ?? 1,
    cases: Array.isArray(data.cases) ? data.cases : [],
    candidates: Array.isArray(data.candidates) ? data.candidates : [],
  };
}

/** Comment text → Report; `null` when it is not a test-ticket comment. Never throws. */
export function parseComment(text) {
  const lines = contentLines(text);
  return parseDataLine(lines) ?? parseLegacyLines(lines);
}

// --- legacy French format (wizim-e2e `/test-ticket`, before the data line) ---

const LEGACY_FAILURE = 'Échec : ';
const LEGACY_CAUSE = 'Cause : ';
const LEGACY_CANDIDATES = "Candidats à l'automatisation (à arbitrer par QA) : ";
const LEGACY_PITFALL = 'Piège découvert : ';
const LEGACY_VERDICTS = { OK: 'OK', KO: 'KO', 'NON CONCLUANT': 'INCONCLUSIVE' };
const LEGACY_RESULTS = { OK: 'OK', KO: 'KO', INSTABLE: 'UNSTABLE' };

function parseLegacyLines(lines) {
  if (lines.length === 0 || !lines[0].startsWith(MARKER)) return null;
  const header = lines[0].match(/^\[test-ticket\] Tests fonctionnels — (\S+) — (.+?) — Verdict : (.+)$/);
  if (!header) return null;
  const verdict = LEGACY_VERDICTS[header[3]];
  if (!verdict) return null;
  const report = {
    v: 1,
    env: header[1],
    date: header[2],
    verdict,
    delivery: '',
    constraints: 'aucune',
    cases: [],
    notPlayed: 'aucun',
    data: 'aucune',
    candidates: [],
  };
  for (const line of lines.slice(1)) {
    let m;
    if (line.startsWith(LEGACY_FAILURE)) continue; // redundant with the KO cases
    else if (line.startsWith(LEGACY_CAUSE)) report.reason = line.slice(LEGACY_CAUSE.length);
    else if ((m = line.match(/^Livraison : (.*)$/))) report.delivery = m[1];
    else if ((m = line.match(/^Contraintes du dev : (.*)$/))) report.constraints = m[1];
    else if ((m = line.match(/^- (T\d+) \((P[123])\) (.+?) : (OK|KO|INSTABLE)(?: — (.*))?$/))) {
      const c = { id: m[1], priority: m[2], title: m[3], result: LEGACY_RESULTS[m[4]] };
      if (m[5]) c.detail = m[5];
      report.cases.push(c);
    } else if ((m = line.match(/^Non joués : (.*)$/))) report.notPlayed = m[1];
    else if ((m = line.match(/^Données créées : (.*)$/))) report.data = m[1];
    else if (line.startsWith(LEGACY_CANDIDATES)) {
      report.candidates = line.slice(LEGACY_CANDIDATES.length).split(',').map((s) => s.trim()).filter(Boolean);
    } else if (line.startsWith(LEGACY_PITFALL)) report.pitfall = line.slice(LEGACY_PITFALL.length);
  }
  return report;
}

/** Legacy French comment → Report; `null` when the first line lacks the marker or the header. */
export function parseLegacyFrenchComment(text) {
  return parseLegacyLines(contentLines(text));
}

const timeOf = (date) => {
  const ms = Date.parse(date);
  return Number.isNaN(ms) ? 0 : ms;
};

/**
 * Reports found in tracker comments `{ date, body }`, newest first; only those of `env`,
 * or every env when `env` is null. `bodyToText` turns a comment body into plain text.
 */
export function latestReports(comments, env, bodyToText) {
  return comments
    .map((c) => ({ date: c.date, report: parseComment(bodyToText(c.body)) }))
    .filter((x) => x.report && (env === null || x.report.env === env))
    .sort((a, b) => timeOf(b.date) - timeOf(a.date))
    .map((x) => x.report);
}

/** Result per case id before and after a replay; `absent` when the case exists on one side only. */
export function compareReplay(before, after) {
  const ids = new Set([...before.cases.map((c) => c.id), ...after.cases.map((c) => c.id)]);
  const num = (id) => Number(id.replace(/\D/g, ''));
  return [...ids]
    .sort((a, b) => num(a) - num(b))
    .map((id) => ({
      id,
      before: before.cases.find((c) => c.id === id)?.result ?? 'absent',
      after: after.cases.find((c) => c.id === id)?.result ?? 'absent',
    }));
}
