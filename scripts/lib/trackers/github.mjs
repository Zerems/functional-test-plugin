/**
 * Read-only GitHub Issues tracker (REST API). Statuses are labels. The token
 * never appears in an error or an output.
 */
import { MissingSecretError, TrackerError } from '../errors.mjs';

const TIMEOUT_MS = 30_000;
const PER_PAGE = 100;
const MAX_SEARCH_PAGES = 10;
const KEY_PATTERN = /(?:([\w.-]+\/[\w.-]+))?#(\d+)/;
const EXACT_KEY = /^(?:([\w.-]+\/[\w.-]+))?#(\d+)$/;
const ISSUE_URL = /^https?:\/\/[^/\s]+\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)(?:[/?#].*)?$/;

/** `Link` response header -> URL of the `rel="next"` page, or null. */
export function parseLinkNext(header) {
  for (const part of String(header ?? '').split(',')) {
    const match = /<([^>]+)>\s*;\s*rel="?next"?/.exec(part);
    if (match) return match[1];
  }
  return null;
}

/** GitHub tracker; `fetchImpl` is injectable for tests. Search truncation is reported on `lastSearchTruncated`. */
export function createGithubTracker(trackerConfig, env, { fetchImpl = fetch } = {}) {
  if (!env.GITHUB_TOKEN) throw new MissingSecretError(['GITHUB_TOKEN']);
  const base = (trackerConfig.baseUrl || 'https://api.github.com').replace(/\/+$/, '');
  const projects = trackerConfig.projects ?? [];
  const statusLabels = collectStatusLabels(trackerConfig.statuses);
  const headers = {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'functional-test-plugin',
  };

  /** GET a path (relative to the base URL) or an absolute URL on the same origin; returns the Response. */
  async function request(target) {
    const absolute = /^https?:\/\//.test(target);
    if (absolute && new URL(target).origin !== new URL(base).origin) {
      throw new Error('refusing to follow a pagination link outside the tracker host');
    }
    const url = absolute ? target : base + target;
    const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) {
      const path = (absolute ? new URL(target).pathname : target).split('?')[0];
      throw new TrackerError(`GitHub ${response.status} on ${path}`, { status: response.status, path });
    }
    return response;
  }

  const readJson = async (path) => (await request(path)).json();

  /** Collects every page of an array endpoint, following `Link: rel="next"`. */
  async function readPages(path) {
    const items = [];
    let next = path;
    while (next) {
      const response = await request(next);
      items.push(...(await response.json()));
      next = parseLinkNext(response.headers.get('link'));
    }
    return items;
  }

  function parseKey(key) {
    const match = EXACT_KEY.exec(String(key));
    if (!match || !match[1]) throw new Error(`invalid ticket key: ${key}`);
    return { repo: match[1], number: match[2] };
  }

  const tracker = {
    type: 'github',
    keyPattern: KEY_PATTERN,
    trackerStatusesAreLabels: true,
    lastSearchTruncated: false,

    normalizeKey(input) {
      const text = String(input).trim();
      const url = ISSUE_URL.exec(text);
      if (url) return `${url[1]}#${url[2]}`;
      const match = EXACT_KEY.exec(text);
      if (!match) throw new Error(`invalid ticket key: ${input}`);
      if (match[1]) return `${match[1]}#${match[2]}`;
      if (projects.length !== 1) throw new Error(`ambiguous key #${match[2]}: several projects configured`);
      return `${projects[0]}#${match[2]}`;
    },

    async getIssue(key) {
      const { repo, number } = parseKey(key);
      const raw = await readJson(`/repos/${repo}/issues/${number}`);
      const comments = await readPages(`/repos/${repo}/issues/${number}/comments?per_page=${PER_PAGE}`);
      return normalizeIssue(raw, repo, comments, statusLabels);
    },

    async searchWithMarker(marker) {
      const keys = [];
      tracker.lastSearchTruncated = false;
      for (const project of projects) {
        for (let page = 1; page <= MAX_SEARCH_PAGES; page += 1) {
          const params = new URLSearchParams({
            q: `"${marker}" in:comments repo:${project}`,
            per_page: String(PER_PAGE),
            page: String(page),
          });
          const body = await readJson(`/search/issues?${params}`);
          const items = body.items ?? [];
          for (const item of items) if (!item.pull_request) keys.push(`${project}#${item.number}`);
          if (body.incomplete_results) tracker.lastSearchTruncated = true;
          if (items.length < PER_PAGE) break;
          if (page === MAX_SEARCH_PAGES) tracker.lastSearchTruncated = true;
        }
      }
      return keys;
    },

    async getLinkedPullRequests(issue) {
      const { repo, number } = parseKey(issue.key);
      const events = await readPages(`/repos/${repo}/issues/${number}/timeline?per_page=${PER_PAGE}`);
      const found = new Map();
      for (const event of events) {
        if (event.event === 'cross-referenced' && event.source?.issue?.pull_request) {
          const source = event.source.issue;
          const prRepo = source.repository?.full_name ?? repo;
          found.set(`${prRepo}#${source.number}`, { repo: prRepo, number: source.number });
        } else if (event.event === 'connected' && event.subject?.type === 'PullRequest') {
          found.set(`${repo}#${event.subject.number}`, { repo, number: event.subject.number });
        }
      }
      const prs = [];
      for (const pr of found.values()) {
        const raw = await readJson(`/repos/${pr.repo}/pulls/${pr.number}`);
        prs.push({
          repository: pr.repo.split('/')[1],
          title: raw.title ?? '',
          sourceBranch: raw.head?.ref ?? '',
          targetBranch: raw.base?.ref ?? '',
          status: raw.merged_at ? 'MERGED' : raw.state === 'open' ? 'OPEN' : 'DECLINED',
          mergedAt: raw.merged_at ?? null,
          url: raw.html_url ?? '',
        });
      }
      return prs;
    },

    async whoami() {
      return (await readJson('/user')).login ?? '';
    },
  };
  return tracker;
}

/** Every label name configured as a status (lists, single values, per-project overrides). */
function collectStatusLabels(statuses = {}) {
  const names = new Set();
  const add = (value) => {
    if (Array.isArray(value)) value.forEach(add);
    else if (typeof value === 'string' && value) names.add(value);
  };
  const { perProject, ...global } = statuses;
  Object.values(global).forEach(add);
  for (const overrides of Object.values(perProject ?? {})) Object.values(overrides ?? {}).forEach(add);
  return names;
}

/** Raw issue + comments -> Issue (bodies stay Markdown); status = first status label, else open/closed. */
export function normalizeIssue(raw, repo, comments, statusLabels) {
  const labels = (raw.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name));
  return {
    key: `${repo}#${raw.number}`,
    id: String(raw.id),
    title: raw.title ?? '',
    status: labels.find((name) => statusLabels.has(name)) ?? raw.state ?? '',
    type: 'issue',
    url: raw.html_url ?? '',
    labels,
    parent: null,
    links: [],
    body: { format: 'markdown', content: raw.body ?? '' },
    comments: comments.map((c) => ({
      author: c.user?.login ?? '',
      date: c.created_at,
      body: { format: 'markdown', content: c.body ?? '' },
    })),
  };
}
