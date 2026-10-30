/** Local Markdown file tracker: a ticket is a Markdown file on disk. */
import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Extensions a ticket file may have. */
export const TICKET_FILE_EXTENSIONS = ['.md', '.markdown', '.txt'];

const isSecretPath = (abs) => {
  const name = basename(abs);
  return name.startsWith('.env') || name === '.mcp.json' || abs.split(sep).includes('.auth');
};

/**
 * Why `input` (resolved against `root`) must not be read as a ticket file: `'secret'` for a
 * `.env*` file, anything under `.auth/` or `.mcp.json` (symbolic links followed), `'extension'`
 * for anything but a Markdown or text file; `null` when it may be read.
 */
export function ticketFileRefusal(root, input) {
  const abs = resolve(root, input);
  let real = abs;
  try {
    real = realpathSync(abs);
  } catch {
    // Missing file: the reader reports it.
  }
  if (isSecretPath(abs) || isSecretPath(real)) return 'secret';
  const allowed = (file) => TICKET_FILE_EXTENSIONS.includes(extname(file).toLowerCase());
  return allowed(abs) && allowed(real) ? null : 'extension';
}

export function createFileTracker(root) {
  return {
    type: 'file',
    keyPattern: /.+/,
    trackerStatusesAreLabels: false,
    normalizeKey: (input) => input,
    async getIssue(pathOrKey) {
      const abs = resolve(root, pathOrKey);
      const refusal = ticketFileRefusal(root, pathOrKey);
      if (refusal) throw new Error(`ticket file refused (${refusal}): ${pathOrKey}`);
      let content;
      try {
        content = await readFile(abs, 'utf8');
      } catch (err) {
        if (err.code === 'ENOENT' || err.code === 'EISDIR') throw new Error(`ticket file not found: ${pathOrKey}`);
        throw err;
      }
      const key = basename(abs, extname(abs));
      const heading = /^# +(.+?)\s*$/m.exec(content);
      return {
        key,
        id: key,
        title: heading ? heading[1] : key,
        status: '',
        type: 'file',
        url: pathToFileURL(abs).href,
        labels: [],
        parent: null,
        links: [],
        body: { format: 'markdown', content },
        comments: [],
      };
    },
    async searchWithMarker() {
      return [];
    },
    async getLinkedPullRequests() {
      return null;
    },
    async whoami() {
      return 'local file';
    },
  };
}
