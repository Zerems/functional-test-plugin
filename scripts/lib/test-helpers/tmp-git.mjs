import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const IDENTITY = ['-c', 'user.name=t', '-c', 'user.email=t@example.test'];

/**
 * Throwaway git repository under the OS temp dir, for tests (or `<parent>/<name>` when given,
 * so several repositories can share one `repositoriesDir`).
 * `commit(message, { date })` makes an empty commit (optionally dated with an ISO string)
 * and returns its sha; `setRemoteRef(branch, sha)` fakes `origin/<branch>`; `cleanup()` removes it.
 */
export function createTmpRepo({ branch = 'main', parent, name } = {}) {
  let dir;
  if (parent) {
    dir = path.join(parent, name);
    fs.mkdirSync(dir, { recursive: true });
  } else {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-git-'));
  }
  const git = (args, env = {}) =>
    execFileSync('git', ['-C', dir, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    }).trim();
  git(['init', '-q', '-b', branch]);
  return {
    dir,
    commit(message, { date } = {}) {
      const env = date ? { GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date } : {};
      git([...IDENTITY, 'commit', '--allow-empty', '-q', '-m', message], env);
      return git(['rev-parse', 'HEAD']);
    },
    setRemoteRef(remoteBranch, sha) {
      git(['update-ref', `refs/remotes/origin/${remoteBranch}`, sha]);
    },
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
