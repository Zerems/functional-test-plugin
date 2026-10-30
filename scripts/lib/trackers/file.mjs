/** Local Markdown file tracker: a ticket is a Markdown file on disk. */
import { readFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function createFileTracker(root) {
  return {
    type: 'file',
    keyPattern: /.+/,
    trackerStatusesAreLabels: false,
    normalizeKey: (input) => input,
    async getIssue(pathOrKey) {
      const abs = resolve(root, pathOrKey);
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
