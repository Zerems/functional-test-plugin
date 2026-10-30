/**
 * Tracker registry.
 *
 * Tracker = {
 *   type, keyPattern: RegExp, normalizeKey(input): string,
 *   getIssue(key): Promise<Issue>, searchWithMarker(marker): Promise<string[]>,
 *   getLinkedPullRequests(issue): Promise<PullRequest[] | null>,
 *   whoami(): Promise<string>, trackerStatusesAreLabels: boolean
 * }
 * Issue = { key, id, title, status, type, url, labels, parent: {key,title}|null,
 *   links: [{type,key,title}], body: {format,content},
 *   comments: [{author,date,body:{format,content}}] }
 * PullRequest = { repository, title, sourceBranch, targetBranch,
 *   status: 'MERGED'|'OPEN'|'DECLINED', mergedAt, url }
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createJiraTracker } from './jira.mjs';
import { createFileTracker } from './file.mjs';

/** Thrown when environment variables holding credentials are missing. */
export class MissingSecretError extends Error {
  constructor(variables) {
    super(`missing environment variables: ${variables.join(', ')}`);
    this.name = 'MissingSecretError';
    this.variables = variables;
  }
}

/**
 * Builds the tracker named by `config.tracker.type`. `env` is the environment
 * variables object, `root` the host root (custom module resolution, file tracker).
 */
export async function createTracker(config, env, { fetchImpl = fetch, root } = {}) {
  const trackerConfig = config.tracker;
  switch (trackerConfig.type) {
    case 'jira':
      return createJiraTracker(trackerConfig, env, { fetchImpl, root });
    case 'file':
      return createFileTracker(root);
    case 'github':
      throw new Error('tracker github: not available yet');
    case 'custom': {
      const mod = await import(pathToFileURL(resolve(root, trackerConfig.module)).href);
      return mod.default(trackerConfig, env, { fetchImpl, root });
    }
    default:
      throw new Error(`unknown tracker type: ${trackerConfig.type}`);
  }
}
