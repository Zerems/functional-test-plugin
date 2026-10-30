/**
 * Read-only Jira tracker (REST API v3 + dev-status). The token never appears in
 * an error or an output.
 */
import { basename } from 'node:path';
import { MissingSecretError } from './index.mjs';

const ISSUE_FIELDS = 'summary,status,issuetype,description,comment,issuelinks,parent,labels,components';
const TIMEOUT_MS = 30_000;
const PR_APPLICATION_TYPES = ['bitbucket', 'GitHub', 'stash'];
const KEY_PATTERN = /\b([A-Za-z][A-Za-z0-9_]*-\d+)\b/;
const EXACT_KEY = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;

/** Jira tracker; `fetchImpl` is injectable for tests, `root` excludes the host repository's PRs. */
export function createJiraTracker(trackerConfig, env, { fetchImpl = fetch, root } = {}) {
  if (!trackerConfig.baseUrl) throw new Error('tracker.baseUrl is required for the jira tracker');
  const base = trackerConfig.baseUrl.replace(/\/+$/, '');
  const missing = ['JIRA_EMAIL', 'JIRA_API_TOKEN'].filter((name) => !env[name]);
  if (missing.length > 0) throw new MissingSecretError(missing);
  const authorization = 'Basic ' + Buffer.from(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`).toString('base64');
  const hostRepository = root ? basename(root) : null;

  async function readJson(path) {
    const response = await fetchImpl(base + path, {
      headers: { Authorization: authorization, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Jira ${response.status} on ${path.split('?')[0]}`);
    return response.json();
  }

  async function search(jql, fields, maxResults = 50, maxPages = 10) {
    const issues = [];
    let nextPageToken = null;
    for (let page = 0; page < maxPages; page += 1) {
      const params = new URLSearchParams({ jql, fields: fields.join(','), maxResults: String(maxResults) });
      if (nextPageToken) params.set('nextPageToken', nextPageToken);
      const body = await readJson(`/rest/api/3/search/jql?${params}`);
      issues.push(...(body.issues ?? []));
      nextPageToken = body.nextPageToken ?? null;
      if (!nextPageToken) break;
    }
    return issues;
  }

  return {
    type: 'jira',
    keyPattern: KEY_PATTERN,
    trackerStatusesAreLabels: false,

    normalizeKey(input) {
      const text = String(input).trim();
      const browse = /\/browse\/([^/?#]+)/.exec(text);
      const candidate = browse ? browse[1] : KEY_PATTERN.exec(text)?.[1];
      if (!candidate || !EXACT_KEY.test(candidate)) throw new Error(`invalid ticket key: ${input}`);
      return candidate.toUpperCase();
    },

    async getIssue(key) {
      const body = await readJson(`/rest/api/3/issue/${encodeURIComponent(key)}?fields=${ISSUE_FIELDS}&expand=renderedFields`);
      return normalizeIssue(body, base);
    },

    async searchWithMarker(marker) {
      const quoted = marker.replace(/[\\"]/g, '\\$&');
      const jql = `project in (${trackerConfig.projects.join(', ')}) AND comment ~ "${quoted}" ORDER BY updated DESC`;
      return (await search(jql, ['key'])).map((issue) => issue.key);
    },

    async getLinkedPullRequests(issue) {
      for (const applicationType of PR_APPLICATION_TYPES) {
        const body = await readJson(
          `/rest/dev-status/latest/issue/detail?issueId=${issue.id}&applicationType=${applicationType}&dataType=pullrequest`,
        );
        const prs = normalizePullRequests(body, hostRepository);
        if (prs.length > 0) return prs;
      }
      return [];
    },

    async whoami() {
      return (await readJson('/rest/api/3/myself')).displayName ?? '';
    },
  };
}

/** Raw `GET /issue/{key}?expand=renderedFields` response -> Issue (bodies stay HTML). */
export function normalizeIssue(body, baseUrl) {
  const f = body.fields ?? {};
  const rendered = body.renderedFields ?? {};
  const renderedComments = rendered.comment?.comments ?? [];
  const links = (f.issuelinks ?? []).map((link) => {
    const inward = link.inwardIssue;
    const target = inward ?? link.outwardIssue ?? {};
    return {
      type: inward ? link.type?.inward : link.type?.outward,
      key: target.key,
      title: target.fields?.summary ?? '',
    };
  });
  return {
    key: body.key,
    id: body.id,
    title: f.summary ?? '',
    status: f.status?.name ?? '',
    type: f.issuetype?.name ?? '',
    url: `${baseUrl}/browse/${body.key}`,
    labels: f.labels ?? [],
    parent: f.parent ? { key: f.parent.key, title: f.parent.fields?.summary ?? '' } : null,
    links,
    body: { format: 'html', content: rendered.description ?? '' },
    comments: (f.comment?.comments ?? []).map((c, i) => ({
      author: c.author?.displayName ?? '',
      date: c.created,
      body: { format: 'html', content: renderedComments[i]?.body ?? '' },
    })),
  };
}

/** dev-status response -> PullRequest[], skipping `excludeRepository` when given. */
export function normalizePullRequests(body, excludeRepository = null) {
  const prs = [];
  for (const detail of body.detail ?? []) {
    for (const pr of detail.pullRequests ?? []) {
      const repository = String(pr.repositoryName ?? '').replace(/^[^/]*\//, '');
      if (excludeRepository && repository === excludeRepository) continue;
      const status = pr.status === 'MERGED' || pr.status === 'OPEN' ? pr.status : 'DECLINED';
      prs.push({
        repository,
        title: pr.name ?? '',
        sourceBranch: pr.source?.branch ?? '',
        targetBranch: pr.destination?.branch ?? '',
        status,
        mergedAt: status === 'MERGED' ? (pr.lastUpdate ?? null) : null,
        url: pr.url ?? '',
      });
    }
  }
  return prs;
}
