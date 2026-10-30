# Adapters guide

The plugin talks to the outside world through small ES modules: a **tracker** (where tickets
live), an **auth** (how the `api` script logs in) and a **browser driver mapping** (which MCP
tool performs each browser action). The built-in ones are listed in the
[README](../README.md); a host project can add its own without touching the plugin.

Custom modules live in the host project (conventionally
`.claude/functional-test/adapters/`), are committed with it, and are referenced by a path
relative to the host root. They are loaded with a dynamic `import()` and must
`export default` a function.

Two rules for every adapter: **never put a secret in an error message or an output** (the
engine masks what it prints, but only a module can keep a token out of its own messages), and
**read only**: trackers are never written to.

## Tracker interface

Configuration: `"tracker": { "type": "custom", "module": "<path>", "envVars": ["..."] }`.
Any other keys of the `tracker` section reach the module untouched, so a custom tracker can
define its own settings.

The module default-exports a function, synchronous or `async`:

```
default(trackerConfig, env, { fetchImpl, root }) -> Tracker
```

`trackerConfig` is the `tracker` section, `env` the environment variables (`process.env`,
`.env` already loaded), `fetchImpl` the `fetch` to use for HTTP calls, `root` the host root.

```
Tracker = {
  type: string,                       // free; 'file' is reserved for the built-in file tracker
  keyPattern: RegExp,                 // recognises a key inside free text
  trackerStatusesAreLabels: boolean,  // true when statuses are labels (GitHub)
  normalizeKey(input: string): string,                      // key, URL or free text -> canonical key; throws when invalid
  getIssue(key): Promise<Issue>,                            // throws when the ticket does not exist
  searchWithMarker(marker: string): Promise<string[]>,      // keys whose comments contain the marker
  getLinkedPullRequests(issue): Promise<PullRequest[] | null>,  // null = this tracker cannot know
  whoami(): Promise<string>,                                // display name, shown by the preflight
  lastSearchTruncated?: boolean       // set to true by searchWithMarker when it stopped early
}

Issue = {
  key, id, title, status, type, url: string,
  labels: string[],
  parent: { key, title } | null,
  links: [{ type, key, title }],
  body: { format: 'html' | 'markdown' | 'text', content: string },   // acceptance criteria are read from it
  comments: [{ author: string, date: ISO string, body: { format, content } }]
}

PullRequest = {
  repository: string, title: string, sourceBranch: string, targetBranch: string,
  status: 'MERGED' | 'OPEN' | 'DECLINED',
  mergedAt: ISO string | null, url: string
}
```

Notes:

- `searchWithMarker` receives the constant `[test-ticket]` and only has to find the tickets
  whose comments contain it; the plugin re-reads each ticket and parses its latest comment.
  Return `[]` when the tracker cannot search (candidates and replay then find nothing).
- `getLinkedPullRequests` is only called when `delivery.mode` is `tracker` or `both`; `null`
  makes the delivery `unknown` (a warning) in `tracker` mode and falls back to git in `both`.
- Body `format`: `html` and `markdown` keep struck-through criteria (`<del>`, `<s>`, `~~...~~`)
  and mark them out of scope; `text` gives one criterion per non-empty line.
- Errors: any thrown `Error` exits with code 1 (network failures such as `ECONNREFUSED` or a
  timeout exit with 4). The built-in trackers throw `TrackerError` (exit 4, or 2 for a 404)
  and `MissingSecretError` (exit 3) from `scripts/lib/errors.mjs`.
- `ticket.mjs` and the other scripts load the tracker with `createTracker`
  (`scripts/lib/trackers/index.mjs`); `candidates.mjs` refuses `type: "file"` only.

### Minimal custom tracker: a folder of JSON files

One file per ticket, `tickets/T-1.json`:
`{ "title": "...", "status": "...", "description": "markdown", "comments": [ { "author": "...", "date": "...", "body": { "format": "markdown", "content": "..." } } ] }`.
Config: `{ "type": "custom", "module": ".claude/functional-test/adapters/tracker.mjs", "dir": "tickets" }`.

```js
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export default function createTracker(trackerConfig, env, { root }) {
  const dir = resolve(root, trackerConfig.dir ?? 'tickets');
  const load = async (key) => JSON.parse(await readFile(join(dir, `${key}.json`), 'utf8'));
  return {
    type: 'custom', keyPattern: /\bT-\d+\b/, trackerStatusesAreLabels: false,
    normalizeKey(input) {
      const key = /T-\d+/i.exec(input)?.[0];
      if (!key) throw new Error(`invalid ticket key: ${input}`);
      return key.toUpperCase();
    },
    async getIssue(key) {
      const t = await load(key);
      return { key, id: key, title: t.title, status: t.status, type: 'ticket', url: '', labels: [], parent: null, links: [],
        body: { format: 'markdown', content: t.description }, comments: t.comments ?? [] };
    },
    async searchWithMarker(marker) {
      const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
      const found = [];
      for (const f of files) if (JSON.stringify((await load(f.slice(0, -5))).comments ?? []).includes(marker)) found.push(f.slice(0, -5));
      return found;
    },
    getLinkedPullRequests: async () => null,
    whoami: async () => 'local folder',
  };
}
```

## Auth interface

Configuration: `"auth": { "<name>": { "preset": "custom", "module": "<path>", "envVars": ["..."] } }`,
referenced by a channel's `"auth": "<name>"`. Other keys of the section reach the module
untouched. `envVars` lists the variables the module needs: the preflight reports them when
missing (a section with `"optional": true` only warns).

```
default(name, section, env, { fetchImpl, root }) -> Auth      // synchronous or async
```

`name` is the key in `auth`, `section` its configuration, `env` the environment variables,
`fetchImpl` the `fetch` to use, `root` the host root.

```
Auth = {
  authenticate(apiUrl: string, credentials?: { username, password }): Promise<{ token: string | null, expiresAt: ISO string }>,
  headers({ token, context }): Record<string, string>,
  cacheKey(credentials?): string,
  name?: string, preset?: string
}
```

- `authenticate` receives the channel URL without a trailing slash. `credentials` is only
  given when `api.mjs --credentials <file>` is used (an alternate account); a module may
  ignore it. It may throw; keep the message free of secrets. `expiresAt` is when the token
  stops being valid: the `api` script caches it under `.auth/` until a minute before, and
  re-authenticates once on a 401.
- `headers` builds the request headers from the token and `context` (the `--header K=V`
  values of the call). The built-in presets also merge the section's static `headers` map;
  a custom module is free to do the same.
- `cacheKey` names the cache entry: return `name` for one account, and add a hash of the
  username when `credentials` is given, so alternate accounts never share a token.
- The module must export a function returning an object with `authenticate`, `headers` and
  `cacheKey` as functions; anything else is rejected with an explicit error.

### Minimal custom auth: tenant header after a password login

Config: `{ "preset": "custom", "module": ".claude/functional-test/adapters/auth.mjs", "envVars": ["SHOP_USER", "SHOP_PASSWORD"], "loginPath": "/login", "tenant": "acme" }`.

```js
export default function createAuth(name, section, env, { fetchImpl }) {
  return {
    name,
    preset: 'custom',
    async authenticate(apiUrl) {
      const [userVar, passwordVar] = section.envVars;
      const response = await fetchImpl(`${apiUrl}${section.loginPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Tenant': section.tenant },
        body: JSON.stringify({ email: env[userVar], password: env[passwordVar] }),
      });
      if (!response.ok) throw new Error(`login ${name} refused (${response.status})`);
      const { token, ttl = 300 } = await response.json();
      return { token, expiresAt: new Date(Date.now() + ttl * 1000).toISOString() };
    },
    headers: ({ token, context }) => ({ Authorization: `Bearer ${token}`, 'X-Tenant': section.tenant, ...context }),
    cacheKey: () => name,
  };
}
```

## Browser driver mapping

The skills never name an MCP tool. They reason in six abstract actions (**open URL**, **read
page**, **click**, **type**, **press key**, **screenshot**, plus **close** and the detection
of a login page), and a *driver mapping* file says which tool of the configured MCP server
performs each one. Built-in mappings live in
`skills/test-ticket/references/browser-drivers/`: `playwright-mcp.md` (reference),
`cypress-mcp.md` and `robotframework-mcp.md` (community servers, unverified: their tool
names are placeholders to fill and verify before use; the setup writes no `.mcp.json` entry
for them, it prints their unpinned install command).

To drive any other browser MCP server:

1. Copy `skills/test-ticket/references/browser-drivers/template.md` into the host project,
   for example `.claude/functional-test/browser-driver.md`.
2. Fill it: the server (package, pinned version, the `.mcp.json` entry; one entry per
   session name, its key being the session's `mcpServer`), the session modes it supports
   (`external` unless it takes a Playwright profile directory or storage-state file), the
   tool names as the session lists them **without** the `mcp__<mcpServer>__` prefix, with
   their arguments, and the login-detection rule. Leave a row empty when the server cannot
   perform that action: the channels needing it are then reported as not playable in the
   plan instead of failing.
3. List the tools that must exist in the session for the driver to be usable (at least
   "open URL" and "read page"): the skill checks them before planning.
4. Configure it:

   ```json
   "browser": { "driver": "custom", "driverMapping": ".claude/functional-test/browser-driver.md" },
   "sessions": { "front": { "mode": "external", "mcpServer": "my-browser" } }
   ```

   Add the `my-browser` entry to `.mcp.json` yourself (the setup writes no entry for a
   custom driver). The preflight is `KO` when the mapping file does not exist or the server
   is not declared.

The skill reads the mapping in place of a built-in one, so it must be precise about argument
conventions (for example which reference a click expects, which file name a screenshot
takes).

## Adding a built-in adapter

For a tracker (GitLab, Linear...) or an auth preset that deserves to ship with the plugin:

1. **Module.** A tracker goes in `scripts/lib/trackers/<name>.mjs` exporting
   `create<Name>Tracker(trackerConfig, env, { fetchImpl })` that returns the Tracker
   interface above; an auth preset goes in `scripts/lib/auth/<name>.mjs` exporting
   `create<Name>(name, section, env, { fetchImpl })` that returns the Auth interface. Use the
   injected `fetchImpl` (never a global `fetch`), throw `MissingSecretError` (from
   `scripts/lib/errors.mjs`) when variables are missing and `TrackerError` for a non-OK
   response, put a timeout on every call, and keep tokens out of every message. No npm
   dependency.
2. **Registration.** Trackers: add a `case` in `createTracker`
   (`scripts/lib/trackers/index.mjs`). Auth presets: add the factory to `PRESETS` in
   `scripts/lib/auth/index.mjs`.
3. **Configuration rules** in `scripts/lib/config.mjs`: add the name to `TRACKER_TYPES` or
   `AUTH_PRESETS`, its validation (required fields) in `validateConfig`, and its variables to
   `TRACKER_ENV_VARS` or `requiredEnvVars`; for a tracker with projects, list it in
   `TRACKERS_WITH_PROJECTS` (this also makes `delivery.mode` default to `both`). Mirror the
   variable purposes in `scripts/lib/setup/write.mjs` (`purposes`) and the locale keys
   `setup.purpose.*` in `locales/en.json` and `locales/fr.json`.
4. **Tests** next to the module: `scripts/lib/trackers/<name>.test.mjs` (or
   `scripts/lib/auth/auth.test.mjs` for presets), with `node:test` and the fake `fetch` of
   `scripts/lib/test-helpers/fake-fetch.mjs`, recorded responses in
   `scripts/lib/test-helpers/fixtures/`. Cover the key normalisation, a ticket with and
   without comments, a 404, a missing secret and the absence of the token in errors. Add the
   registration case to `scripts/lib/trackers/index.test.mjs` and the config rules to
   `scripts/lib/config.test.mjs`. `npm test` must stay green.
5. **Documentation.** Update the README support table, `docs/config-reference.md` (fields
   and environment variables), the skill notes (`skills/test-ticket/references/tracker-notes.md`
   for a tracker, the `setup` skill's questions) and add a `CHANGELOG.md` entry.
