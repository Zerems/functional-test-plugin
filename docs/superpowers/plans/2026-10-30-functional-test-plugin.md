# Functional Test Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `functional-test` Claude Code plugin: `/test-ticket`, `/automation-candidates` and `/setup` skills backed by dependency-free Node scripts, configurable per host project (tracker, environments, delivery, browser driver, auth, framework, language).

**Architecture:** A plugin repository that is also its own marketplace. Skills (`skills/*/SKILL.md`) give Claude the workflow; scripts (`scripts/*.mjs`) do the deterministic work and are the only things that touch secrets. The engine (`scripts/lib/`) is pure modules with `node:test` tests; trackers, auth and browser drivers are adapters selected by the host's `.claude/functional-test/config.json`. All user-facing strings go through `locales/<lang>.json`.

**Tech Stack:** Node.js ≥ 20 (ESM, `fetch`, `node:test`, `node:child_process`), no npm dependencies. Claude Code plugin format (`.claude-plugin/plugin.json`, `${CLAUDE_PLUGIN_ROOT}`).

**Spec:** `docs/superpowers/specs/2026-10-30-functional-test-plugin-design.md`

**Reference implementation (read-only):** `/Users/Remy/Documents/Wizim/wizim-e2e/.claude/skills/test-ticket/` and `a-automatiser/`. Several modules are ports of its `scripts/lib/*.mjs`; the plan says "port of X" when so. Never modify that repository.

**Out of scope of this plan:** the migration of `wizim-e2e` to the plugin (spec §5), planned separately once the plugin is tagged `0.1.0`.

## Global Constraints

- Node.js ≥ 20; `package.json` has `"engines": { "node": ">=20" }` and **no** `dependencies` or `devDependencies`.
- Code, comments, docs, skill instructions, commit messages: English. User-facing strings: from `locales/<lang>.json`, `en` and `fr` shipped, `en` fallback for missing keys.
- Secrets never printed: no value of `.env` in any output; `maskSecrets` on every body displayed; errors never include a token. Scripts load `.env` themselves.
- Host root = nearest ancestor of `process.cwd()` containing `.claude/functional-test/config.json`. Scripts never derive the host from their own path.
- Scripts are invoked as `node ${CLAUDE_PLUGIN_ROOT}/scripts/<name>.mjs …` and run from the host root.
- Exit codes: `0` ok, `1` blocked / failed, `2` usage or config error, `3` secrets missing, `4` tracker error, `5` HTTP 5xx (api script).
- Comment marker `[test-ticket]` and data marker `[test-ticket:data]` are constants, never translated.
- Verdict codes `OK | KO | INCONCLUSIVE`, case results `OK | KO | UNSTABLE`, priorities `P1 | P2 | P3` are canonical codes; locales give their labels.
- Test files sit next to the module: `scripts/lib/<name>.test.mjs`; `npm test` runs `node --test "scripts/**/*.test.mjs"`.
- Commit after each task; conventional messages (`feat:`, `test:`, `docs:`, `chore:`).

## Review Focus

Spec-implied inputs no task's happy path exercises; each has its pinning test added to the owning task.

1. `.env` with CRLF line endings, `export KEY=…`, quoted values containing `#` → parsed correctly, no secret lost (Task 1).
2. A tracker key given as a URL with query string or in lower case (`https://x.atlassian.net/browse/wv-12?focused=…`) → `WV-12` (Task 5).
3. A `[test-ticket]` comment whose data line is corrupt JSON → parser falls back to the legacy format or returns `null`, never throws (Task 4).
4. A repository without the `origin/<branch>` ref (never fetched, or branch misnamed) → delivery `absent` with a hint, no crash (Task 7).
5. Config names a session whose `mcpServer` is missing from `.mcp.json` → preflight `blocked` with the server name in the message (Task 11).

---

## File structure

```
.claude-plugin/plugin.json             plugin manifest
.claude-plugin/marketplace.json        this repo as a marketplace (source "./")
package.json                           name, engines, "test" script, private
LICENSE                                MIT
README.md                              quickstart (Task 17)
CHANGELOG.md
locales/en.json, locales/fr.json       flat key → string, {param} placeholders
templates/config.example.json          full example config (Wizim-shaped, anonymised)
templates/pitfalls.md                  skeleton with section headings
templates/excluded.json                []
templates/mcp/playwright-mcp.json      MCP entry templates per driver ({{profileDir}}, {{storageState}}, {{engine}}, {{viewport}})
templates/mcp/cypress-mcp.json, robotframework-mcp.json, playwright-test.json
scripts/preflight.mjs                  CLI entry points (thin: parse args, call lib, print, exit code)
scripts/ticket.mjs
scripts/api.mjs
scripts/session.mjs
scripts/comment.mjs
scripts/candidates.mjs
scripts/setup-write.mjs
scripts/lib/host.mjs                   findHostRoot, hostPaths
scripts/lib/env.mjs                    parseDotenv, loadEnv
scripts/lib/config.mjs                 loadConfig, validateConfig, applyDefaults, helpers
scripts/lib/i18n.mjs                   loadLocale, translator
scripts/lib/secrets.mjs                maskSecrets
scripts/lib/criteria/html.mjs          port of html-vers-texte.mjs
scripts/lib/criteria/markdown.mjs      Markdown body → text and criteria
scripts/lib/criteria/index.mjs         bodyToText, extractCriteria by format
scripts/lib/comment.mjs                formatComment, parseComment (+legacy), latestReports, compareReplay
scripts/lib/trackers/index.mjs         createTracker
scripts/lib/trackers/jira.mjs          port of jira.mjs (client + normalisation)
scripts/lib/trackers/github.mjs        GitHub Issues adapter
scripts/lib/trackers/file.mjs          local Markdown adapter
scripts/lib/delivery.mjs               gitLogDelivery, trackerDelivery, assessDelivery, technicalScope
scripts/lib/warnings.mjs               plan warnings (status, env, delivery)
scripts/lib/auth/index.mjs             createAuth (presets + custom module)
scripts/lib/auth/password-login.mjs, static-token.mjs, none.mjs
scripts/lib/api.mjs                    parseApiArgs, tokenCachePath, tokenValid, call
scripts/lib/session.mjs                validateStorageState, sessionPlan, profileDir, setupCommand
scripts/lib/coverage.mjs               coveredKeys, loadExclusions, filterCandidates
scripts/lib/preflight.mjs              pure checks
scripts/lib/setup/write.mjs            mergeMcpJson, envExampleBlock, appendEnvExample, gitignoreAdditions, writeHostFiles
scripts/lib/test-helpers/              fixtures (jira issue JSON, github issue JSON, tmp git repo builder, fake fetch)
skills/test-ticket/SKILL.md
skills/test-ticket/references/test-design-rules.md, report-templates.md, tracker-notes.md
skills/test-ticket/references/browser-drivers/{playwright-mcp,cypress-mcp,robotframework-mcp,template}.md
skills/test-ticket/references/frameworks/{playwright,cypress,robotframework}.md
skills/automation-candidates/SKILL.md
skills/setup/SKILL.md
docs/config-reference.md, docs/adapters.md, docs/migration-from-wizim-e2e.md
```

---

### Task 1: Plugin skeleton, host discovery, dotenv parser

**Files:**
- Create: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `package.json`, `LICENSE`, `.gitignore`, `CHANGELOG.md`
- Create: `scripts/lib/host.mjs`, `scripts/lib/env.mjs`
- Test: `scripts/lib/host.test.mjs`, `scripts/lib/env.test.mjs`

**Interfaces:**
- Produces: `findHostRoot(startDir = process.cwd()): string | null` — nearest ancestor containing `.claude/functional-test/config.json`.
- Produces: `hostPaths(root): { root, configDir, config, pitfallsDefault, excludedDefault, authDir, env, envExample, mcp, gitignore }` (absolute paths; `configDir` = `<root>/.claude/functional-test`, `authDir` = `<root>/.auth`).
- Produces: `parseDotenv(text: string): Record<string,string>`; `loadEnv(root, target = process.env): string[]` (keys loaded; never overrides a key already set in `target`; silent if `.env` absent).

- [ ] **Step 1: Write the manifests**

`plugin.json`: `{ "name": "functional-test", "version": "0.1.0", "description": "Functional testing of delivered tickets from Claude Code: plan, execute, verdict, comment; QA arbitration of automation candidates.", "author": { "name": "Rémy Albinet" }, "repository": "https://github.com/Zerems/functional-test-plugin", "license": "MIT", "keywords": ["qa", "testing", "jira", "github", "playwright"] }`.
`marketplace.json`: `{ "name": "zerems-plugins", "owner": { "name": "Rémy Albinet" }, "metadata": { "description": "Rémy Albinet's Claude Code plugins", "version": "0.1.0" }, "plugins": [{ "name": "functional-test", "source": "./", "description": "<same as plugin.json>", "version": "0.1.0" }] }`.
`package.json`: `{ "name": "functional-test-plugin", "version": "0.1.0", "private": true, "type": "module", "engines": { "node": ">=20" }, "scripts": { "test": "node --test \"scripts/**/*.test.mjs\"" } }`.
`.gitignore`: `node_modules/`, `.DS_Store`. `LICENSE`: MIT, 2026, Rémy Albinet. `CHANGELOG.md`: `## 0.1.0 (unreleased)`.

- [ ] **Step 2: Write the failing tests**

`host.test.mjs` (uses `fs.mkdtempSync` under `os.tmpdir()`):
- `findHostRoot returns the directory holding .claude/functional-test/config.json from a nested cwd`
- `findHostRoot returns null when no ancestor has the config`
- `hostPaths builds the expected absolute paths` (assert `config` ends with `.claude/functional-test/config.json`, `mcp` with `.mcp.json`, `authDir` with `.auth`).

`env.test.mjs`:
- `parseDotenv reads KEY=value, ignores comments and blank lines`
- `parseDotenv handles export prefix, single and double quotes, and # inside quotes` → `{ A: 'x', B: 'with #hash', C: 'single' }` from `export A=x\nB="with #hash"\nC='single' # trailing`
- `parseDotenv accepts CRLF line endings` (Review Focus 1)
- `loadEnv does not override keys already present in target and returns loaded keys`
- `loadEnv returns [] when .env is absent`

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement `host.mjs` and `env.mjs`**

`parseDotenv`: split on `/\r?\n/`, skip blank and `#` lines, strip `export `, split at first `=`, trim; quoted values keep content between quotes (handle `\n` escape in double quotes); unquoted values stop at ` #`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test` — Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: plugin skeleton, host root discovery and dotenv parser"
```

---

### Task 2: Config loading, validation, defaults; i18n; secret masking

**Files:**
- Create: `scripts/lib/config.mjs`, `scripts/lib/i18n.mjs`, `scripts/lib/secrets.mjs`, `locales/en.json`, `locales/fr.json`, `templates/config.example.json`
- Test: `scripts/lib/config.test.mjs`, `scripts/lib/i18n.test.mjs`, `scripts/lib/secrets.test.mjs`

**Interfaces:**
- Produces: `applyDefaults(raw): Config`; `validateConfig(config): string[]` (empty = valid; each error `"<json.path>: <message>"`); `loadConfig(root): Config` (throws `ConfigError { errors }`).
- Produces: `environmentOf(config, name): Environment` (throws `"unknown environment"`), `defaultEnvironmentFor(config, key): string`, `requiredEnvVars(config): { required: string[], optional: string[] }`, `sessionsOf(config, envName): string[]`, `channelsOf(config, envName): Record<string, Channel>`.
- Produces: `loadLocale(lang): Record<string,string>` (merge over `en`), `translator(lang): (key, params?) => string` (`{name}` interpolation; unknown key → key).
- Produces: `maskSecrets(value)` — port of `masquerSecrets`, key regex `/token|password|secret|apikey|api_key|authorization|cookie/i`.
- Config shape: spec §4.2 verbatim, with these defaults when absent: `language: "en"`, `delivery.mode`: `"both"` if `tracker.type` ∈ {jira, github} else `"none"`, `delivery.recentMinutes: 60`, `delivery.repositoriesDir: ".."`, `browser.driver: "playwright-mcp"`, `browser.engine: "chromium"`, `browser.viewport: "1440x900"`, `testData.prefix: "[E2E]"`, `pitfallsFile: ".claude/functional-test/pitfalls.md"`, `automation.excludedFile: ".claude/functional-test/excluded.json"`, `automation.framework: "playwright"`, `automation.specPaths` per framework (`["tests/"]`, `["cypress/e2e/"]`, `["tests/"]`), `automation.runCommand` per framework (`npx playwright test {file}`, `npx cypress run --spec {file}`, `robot {file}`), `automation.branchPattern: "test/{key-lower}-{slug}"`, session `mode`: `"persistent-profile"` when driver is `playwright-mcp`, `"external"` otherwise.
- Validation rules: `version === 1`; `tracker.type` ∈ {jira, github, file, custom}; `custom` requires `module`; jira/github require non-empty `projects`; ≥ 1 environment, each with `branch` and ≥ 1 channel with `url`; a channel's `session` must exist in `sessions`; a channel's `auth` must exist in `auth`; each `sessions.*` has `mcpServer`; `storage-state` sessions have `file` and `command`; `auth.*.preset` ∈ {password-login, static-token, none, custom}; `password-login` requires `loginPath`, `usernameEnv`, `passwordEnv`; `static-token` requires `tokenEnv`; `delivery.mode` ∈ {git-log, tracker, both, none}; `git-log`/`both` require ≥ 1 repository with `name` and `channel`; `browser.driver` ∈ {playwright-mcp, cypress-mcp, robotframework-mcp, custom}, `custom` requires `driverMapping`; `language` has a locale file.

- [ ] **Step 1: Write locales**

`en.json` and `fr.json` with these keys (exact English copy; French translations mirror today's wizim-e2e wording): `verdict.OK`, `verdict.KO`, `verdict.INCONCLUSIVE` ("INCONCLUSIVE" / "NON CONCLUANT"), `result.OK`, `result.KO`, `result.UNSTABLE` ("UNSTABLE" / "INSTABLE"), `comment.title` ("Functional tests" / "Tests fonctionnels"), `comment.verdict` ("Verdict"), `comment.failure` ("Failure" / "Échec"), `comment.cause` ("Cause"), `comment.delivery` ("Delivery" / "Livraison"), `comment.constraints` ("Developer constraints" / "Contraintes du dev"), `comment.cases` ("Cases played" / "Cas joués"), `comment.notPlayed` ("Not played" / "Non joués"), `comment.data` ("Data created" / "Données créées"), `comment.candidates` ("Automation candidates (QA to arbitrate)" / "Candidats à l'automatisation (à arbitrer par QA)"), `comment.pitfall` ("Pitfall discovered" / "Piège découvert"), `comment.none` ("none" / "aucun"), `comment.noneF` ("none" / "aucune"), `preflight.ready` ("--- ready" / "--- prêt"), `preflight.blocked` ("--- blocked" / "--- bloqué"), `preflight.ok` ("OK"), `preflight.ko` ("KO"), `preflight.warn` ("WARNING" / "AVERTISSEMENT"), and one key per preflight line and per ticket-dossier heading added in Tasks 8 and 11 (those tasks list theirs).

- [ ] **Step 2: Write the failing tests**

`config.test.mjs` (fixture: `templates/config.example.json`, a Wizim-shaped example with `language: "fr"`, jira, two environments `testing`/`demo` with channels front/bo/api, five repositories, sessions front (persistent-profile, `playwright`) and bo (storage-state, `playwright-bo`), auth `agency` password-login, automation playwright with `testMcpServer: "playwright-test"`):
- `applyDefaults fills language, delivery mode, browser and automation defaults` (minimal github config → `language 'en'`, `delivery.mode 'both'`, `automation.specPaths ['tests/']`, `sessions.front.mode 'persistent-profile'`)
- `applyDefaults picks delivery none and external sessions for file tracker + cypress driver`
- `validateConfig returns [] for the example config`
- `validateConfig reports a channel session that is not declared` → error contains `environments.testing.channels.front.session`
- `validateConfig reports password-login without usernameEnv`
- `validateConfig reports git-log mode without repositories`
- `validateConfig reports custom driver without driverMapping`
- `defaultEnvironmentFor uses byProject then fallback` (`WVS-12` → `demo`, `WV-12` → `testing`)
- `requiredEnvVars lists tracker and auth variables, optional auth apart` (`JIRA_EMAIL`, `JIRA_API_TOKEN`, `API_V2_AGENCY_USERNAME`, `API_V2_AGENCY_PASSWORD` required; an auth with `optional: true` → optional)
- `loadConfig throws ConfigError with all errors`

`i18n.test.mjs`: `translator('fr') translates verdict.INCONCLUSIVE to NON CONCLUANT`; `translator('fr') falls back to en for a key missing in fr`; `translator('en') interpolates {name}`; `translator returns the key when unknown`; `loadLocale throws for an unknown language`.

`secrets.test.mjs`: `maskSecrets masks nested token, password, authorization and cookie keys, leaves others` (port of existing test).

- [ ] **Step 3: Run tests to verify they fail** — `npm test`, FAIL.

- [ ] **Step 4: Implement `config.mjs`, `i18n.mjs`, `secrets.mjs`, write `templates/config.example.json`**

Tracker credential variable names by type: jira → `JIRA_EMAIL`, `JIRA_API_TOKEN`; github → `GITHUB_TOKEN`; file → none; custom → `tracker.envVars` array.

- [ ] **Step 5: Run tests to verify they pass** — `npm test`, PASS.

- [ ] **Step 6: Commit** — `git commit -m "feat: config loading and validation, locales, secret masking"`

---

### Task 3: Criteria extraction (HTML port + Markdown)

**Files:**
- Create: `scripts/lib/criteria/html.mjs` (port of `html-vers-texte.mjs`), `scripts/lib/criteria/markdown.mjs`, `scripts/lib/criteria/index.mjs`
- Test: `scripts/lib/criteria/html.test.mjs` (port of `html-vers-texte.test.mjs`, English names), `scripts/lib/criteria/markdown.test.mjs`, `scripts/lib/criteria/index.test.mjs`

**Interfaces:**
- Produces: `htmlToText(html): string`, `extractCriteriaFromHtml(html): Criterion[]`, `decodeEntities`, `replaceIssueMacros` (renamed ports).
- Produces: `markdownToText(md): string` (strips emphasis markers except `~~`, keeps list bullets and numbering, collapses blank lines), `extractCriteriaFromMarkdown(md): Criterion[]`.
- Produces: `bodyToText(body: {format, content}): string`, `extractCriteria(body): Criterion[]`; `Criterion = { number: number, text: string, struck: boolean }`.
- Markdown rules: criteria = list items (`-`, `*`, `+`, `1.`), nested items included in document order; without any list, one criterion per non-empty paragraph line, dropping a first line matching `/^(as a|en tant que)\b/i`; an item is `struck` when all its visible text is inside `~~…~~`; partial strike keeps `~~…~~` in `text`; task-list checkboxes `[ ]`/`[x]` are stripped; headings are not criteria.

- [ ] **Step 1: Port `html.test.mjs`** with English test names, same fixtures and assertions as the original.
- [ ] **Step 2: Write `markdown.test.mjs`**: `list items become numbered criteria`, `a fully struck item is marked struck with ~~ removed`, `a partially struck item keeps ~~ markers and is not struck`, `without list, paragraphs become criteria and the "As a" intent line is dropped`, `checkbox markers are stripped`, `nested items are included in order`.
- [ ] **Step 3: Write `index.test.mjs`**: `extractCriteria dispatches on format html, markdown, text` (text = one criterion per non-empty line).
- [ ] **Step 4: Run tests, FAIL.**
- [ ] **Step 5: Port `html.mjs`, implement `markdown.mjs` and `index.mjs`.**
- [ ] **Step 6: Run tests, PASS.**
- [ ] **Step 7: Commit** — `git commit -m "feat: acceptance criteria extraction from HTML and Markdown"`

---

### Task 4: Comment format, parser (data line + legacy), replay diff, `comment.mjs` CLI

**Files:**
- Create: `scripts/lib/comment.mjs`, `scripts/comment.mjs`
- Test: `scripts/lib/comment.test.mjs`

**Interfaces:**
- Produces: `MARKER = '[test-ticket]'`, `DATA_MARKER = '[test-ticket:data]'`.
- Produces: `Report = { v: 1, env, date: 'YYYY-MM-DD HH:MM', verdict: 'OK'|'KO'|'INCONCLUSIVE', delivery: string, constraints: string, cases: [{ id, priority: 'P1'|'P2'|'P3', title, result: 'OK'|'KO'|'UNSTABLE', detail? }], notPlayed: string, data: string, candidates: string[], pitfall?: string, reason?: string }`.
- Produces: `formatComment(report, t): string` — human part localised (same line order as spec §4.5: header, one `Failure:` line per KO case when verdict KO, `Cause:` when `reason`, delivery, constraints, cases, not played, data created, candidates if any, pitfall if any), then final line `${DATA_MARKER} ${JSON.stringify(reportWithoutLocalisedText)}` (canonical codes, no `t` applied).
- Produces: `parseComment(text): Report | null` — if a line starts with `DATA_MARKER`, parse its JSON (invalid JSON → fall through); else if first line starts with `MARKER`, `parseLegacyFrenchComment`; else `null`.
- Produces: `parseLegacyFrenchComment(text): Report | null` — port of `parserCommentaire` mapping `NON CONCLUANT → INCONCLUSIVE`, `INSTABLE → UNSTABLE`, fields renamed (`livraison → delivery`, `contraintes → constraints`, `cas → cases`, `nonJoues → notPlayed`, `donnees → data`, `candidats → candidates`, `piege → pitfall`, `raison → reason`).
- Produces: `latestReports(comments: [{date, body:{format,content}}], env: string | null, bodyToText): Report[]` (newest first; only this env, or every env when `null`); `compareReplay(before, after): [{ id, before, after }]` (port).
- CLI `scripts/comment.mjs`: `format <report.json> [--lang xx]` (lang defaults to config language when a host root is found, else `en`), `parse` (stdin → JSON or exit 1), `diff <old.txt> <new.json>`.

- [ ] **Step 1: Write the failing tests**
- `formatComment in fr reproduces today's header "[test-ticket] Tests fonctionnels — testing — 2026-10-30 14:05 — Verdict : KO"` and the `Échec :` line before `Livraison :`
- `formatComment in en uses English labels and ends with the data line`
- `parseComment reads the data line regardless of the human language` (format in fr → parse → deep-equal report)
- `parseComment falls back to the legacy French format` (fixture: a current wizim-e2e comment → verdict `INCONCLUSIVE`, result `UNSTABLE` mapped)
- `parseComment returns null for a non test-ticket text`
- `parseComment with a corrupt data line falls back to legacy and never throws` (Review Focus 3: legacy header present + `[test-ticket:data] {not json`)
- `latestReports keeps only the env and sorts newest first`
- `compareReplay reports before/after per case id with absent` (port)
- [ ] **Step 2: Run tests, FAIL.**
- [ ] **Step 3: Implement `lib/comment.mjs` and the CLI.**
- [ ] **Step 4: Run tests, PASS;** smoke: `echo '[test-ticket] x' | node scripts/comment.mjs parse` → exit 1 with message.
- [ ] **Step 5: Commit** — `git commit -m "feat: localised test-ticket comment with stable data line, legacy parser, replay diff"`

---

### Task 5: Tracker interface, Jira adapter (port), file adapter

**Files:**
- Create: `scripts/lib/trackers/index.mjs`, `scripts/lib/trackers/jira.mjs`, `scripts/lib/trackers/file.mjs`, `scripts/lib/test-helpers/fake-fetch.mjs`, `scripts/lib/test-helpers/fixtures/jira-issue.json`, `jira-devstatus.json`
- Test: `scripts/lib/trackers/jira.test.mjs` (port of `jira.test.mjs` normalisation tests), `scripts/lib/trackers/file.test.mjs`, `scripts/lib/trackers/index.test.mjs`

**Interfaces:**
- Produces: `createTracker(config, env, { fetchImpl = fetch, root } = {}): Tracker` — dispatch on `config.tracker.type`; `custom` → `import(pathToFileURL(resolve(root, module)))` and call its default export `(trackerConfig, env, deps)`.
- Produces: `Tracker = { type, keyPattern: RegExp, normalizeKey(input): string, getIssue(key): Promise<Issue>, searchWithMarker(marker): Promise<string[]>, getLinkedPullRequests(issue): Promise<PullRequest[] | null>, whoami(): Promise<string>, trackerStatusesAreLabels: boolean }`.
- Produces: `Issue`, `PullRequest` as spec §4.3 (`body: { format, content }`, `comments[].body` same).
- Jira: `keyPattern = /\b([A-Za-z][A-Za-z0-9_]*-\d+)\b/`; `normalizeKey` extracts from URL or text, upper-cases (Review Focus 2); REST v3 `issue/{key}?fields=…&expand=renderedFields` → body format `html`; `searchWithMarker` → JQL `project in (<projects>) AND comment ~ "<marker>" ORDER BY updated DESC` via `/rest/api/3/search/jql` paginated by `nextPageToken`; `getLinkedPullRequests` via dev-status (`applicationType` tried `bitbucket` then `GitHub` then `stash` until one returns PRs) — PRs of repositories named like the host folder are excluded; `whoami` → `/rest/api/3/myself` displayName. Auth: Basic from `JIRA_EMAIL`/`JIRA_API_TOKEN` (throw `MissingSecretError` naming the variables, never the values).
- File: `getIssue(path)` reads Markdown; `key = basename without extension`, `title = first # heading or basename`, `status = ''`, `body = { format: 'markdown', content }`, `comments = []`; `searchWithMarker → []`, `getLinkedPullRequests → null`, `whoami → 'local file'`; `normalizeKey` returns the path as given.

- [ ] **Step 1: Write the failing tests**
- jira: port normalisation tests; add `normalizeKey accepts a browse URL with query string and lower case` (`https://x.atlassian.net/browse/wv-12?focusedCommentId=1` → `WV-12`); `getIssue sends Basic auth and expand=renderedFields` (fake fetch records headers; token not in any thrown error message: assert `/secret-token/.test(err.message) === false` on a 500); `searchWithMarker follows nextPageToken`; `getLinkedPullRequests excludes the host repository and tries application types in order`.
- file: `getIssue reads title and markdown body`, `searchWithMarker returns [] and getLinkedPullRequests null`.
- index: `createTracker dispatches by type`, `createTracker loads a custom module default export`.
- [ ] **Step 2: Run tests, FAIL.**
- [ ] **Step 3: Implement.** Port `clientJira`, `normaliserTicket`, `normaliserPullRequests` under English names.
- [ ] **Step 4: Run tests, PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat: tracker interface with Jira and local file adapters"`

---

### Task 6: GitHub Issues adapter

**Files:**
- Create: `scripts/lib/trackers/github.mjs`, fixtures `github-issue.json`, `github-comments.json`, `github-timeline.json`, `github-search.json`
- Test: `scripts/lib/trackers/github.test.mjs`
- Modify: `scripts/lib/trackers/index.mjs` (register `github`)

**Interfaces:**
- Produces: `createGithubTracker(trackerConfig, env, { fetchImpl })`. Base URL `trackerConfig.baseUrl || 'https://api.github.com'`; header `Authorization: Bearer ${GITHUB_TOKEN}`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`.
- `keyPattern = /(?:([\w.-]+\/[\w.-]+))?#(\d+)/` plus URL form `github.com/{owner}/{repo}/issues/{n}`; `normalizeKey` → `owner/repo#n`; bare `#n` resolves against `projects[0]` (error if several projects).
- `getIssue`: `GET /repos/{owner}/{repo}/issues/{n}` + `GET …/comments?per_page=100` (paginate via `Link: rel="next"`); body format `markdown`; `status` = first label whose name is in any configured `statuses` list, else `open`/`closed`; `trackerStatusesAreLabels = true`.
- `getLinkedPullRequests`: `GET …/issues/{n}/timeline?per_page=100` → events `cross-referenced` whose `source.issue.pull_request` exists, and `connected`; each PR fetched `GET /repos/{o}/{r}/pulls/{n}` for `head.ref`, `base.ref`, `merged_at`, `state` → `status: merged_at ? 'MERGED' : state === 'open' ? 'OPEN' : 'DECLINED'`, `repository = r`.
- `searchWithMarker`: `GET /search/issues?q="<marker>" in:comments repo:o/r` per project, `per_page=100`, up to 10 pages; result `{ keys, truncated }` is exposed as `searchWithMarker(marker)` returning keys and setting `tracker.lastSearchTruncated = boolean` (incomplete_results or more pages).
- `whoami` → `GET /user` login.

- [ ] **Step 1: Write the failing tests**: `normalizeKey handles #n, owner/repo#n and issue URLs`; `normalizeKey rejects bare #n with several projects`; `getIssue maps a label to status when configured, else open/closed`; `getIssue paginates comments via Link header`; `getLinkedPullRequests maps merged, open and closed PRs from timeline`; `searchWithMarker flags truncation`; `missing GITHUB_TOKEN throws MissingSecretError naming the variable`.
- [ ] **Step 2: Run tests, FAIL.** — [ ] **Step 3: Implement.** — [ ] **Step 4: Run tests, PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat: GitHub Issues tracker adapter"`

---

### Task 7: Delivery assessment (git log, tracker, combined) and plan warnings

**Files:**
- Create: `scripts/lib/delivery.mjs`, `scripts/lib/warnings.mjs`, `scripts/lib/test-helpers/tmp-git.mjs` (builds throwaway repos with `git init`, commits, `origin/<branch>` refs via `git update-ref refs/remotes/origin/<branch>`)
- Test: `scripts/lib/delivery.test.mjs`, `scripts/lib/warnings.test.mjs`

**Interfaces:**
- Produces: `repositoryDir(root, repositoriesDir, name): string` — `name === "."` → `root`; otherwise `resolve(root, repositoriesDir, name)`; `repositoriesDir` is `process.env.FT_REPOS_DIR` when set, else the config value.
- Produces: `gitLogDelivery({ root, repositoriesDir, repositories, branch, key, execFile = execFileSync }): { hits: [{ repository, channel, commit, date: ISO, subject }], missingRef: string[], missingRepo: string[], branchHints: [{ repository, branch }] }` — `git -C <dir> log origin/<branch> --grep=<key> -i --format=%H%x09%cI%x09%s`; `missingRef` when git exits non-zero for that ref (Review Focus 4); `branchHints` from `git branch -r --list "*<key-lower>*"`.
- Produces: `trackerDelivery(prs, branch): { merged: PullRequest[], otherTargets: string[], partialRepos: string[] }` (port of `livraisonSurEnv` pieces).
- Produces: `assessDelivery({ mode, git, tracker, branch, now = new Date(), recentMinutes }): Delivery = { state: 'effective'|'recent'|'absent'|'unknown', lastAt: ISO|null, evidence: string[], partialRepos: string[], staleRefs: [{ repository, lastLocalAt, mergedAt }] }` — rules of spec §4.3 table; `both`: state from the union, `staleRefs` when a tracker merge date is newer than the repo's `git log -1 --format=%cI origin/<branch>`.
- Produces: `technicalScope({ delivery, repositories, channels }): string[]` — channels of repositories with evidence; `unknown` → all channel names.
- Produces (`warnings.mjs`): `planWarnings({ issue, envName, defaultEnv, config, delivery, prs, t }): { stop: boolean, lines: string[] }` — port of `avertissements`: `doNotTest` status → `stop: true`; status not in `toTest` → warning; forced env ≠ default → warning; merged PRs targeting other env branches → warning; partial delivery per repo → warning; `delivery.state === 'unknown'` → warning `warnings.deliveryUnknown`. Locale keys: `warnings.doNotTest`, `warnings.statusUnexpected`, `warnings.envForced`, `warnings.otherTargets`, `warnings.partial`, `warnings.deliveryUnknown`, `warnings.staleRef`.

- [ ] **Step 1: Write the failing tests** (tmp-git): `repositoryDir resolves "." to the host root and honours FT_REPOS_DIR`; `gitLogDelivery finds a commit citing the key on origin/<branch>`; `gitLogDelivery reports missingRef for a repo without origin/<branch> and does not throw`; `gitLogDelivery reports missingRepo`; `assessDelivery git-log: recent under recentMinutes, effective after`; `assessDelivery absent when nothing found`; `assessDelivery unknown for mode none and for tracker mode with null prs`; `assessDelivery both flags staleRefs when tracker merge is newer than local ref`; `technicalScope returns channels of delivered repositories, all channels when unknown`; `planWarnings stops on doNotTest status`; `planWarnings warns on unknown delivery`.
- [ ] **Step 2: FAIL** — [ ] **Step 3: Implement** — [ ] **Step 4: PASS**
- [ ] **Step 5: Commit** — `git commit -m "feat: delivery assessment by git log and tracker, plan warnings"`

---

### Task 8: `ticket.mjs` CLI — the ticket dossier

**Files:**
- Create: `scripts/ticket.mjs`, `scripts/lib/dossier.mjs`
- Test: `scripts/lib/dossier.test.mjs`

**Interfaces:**
- Consumes: Tasks 2–7.
- Produces: `buildDossier({ config, env: processEnv, input, envForced, tracker, deps }): Promise<Dossier>` where `Dossier = { issue, criteria, envName, envDefault, prs, delivery, scope, replays: Report[], warnings, stop }`; `renderDossier(dossier, t): string` — same sections as today's `ticket.mjs` output, localised headings (`dossier.criteria`, `dossier.description`, `dossier.comments`, `dossier.pullRequests`, `dossier.delivery`, `dossier.replay`, `dossier.warnings`, `dossier.noCriteria`, `dossier.mobileOnly`, `dossier.firstRun`, `dossier.replayPlan`), struck criteria rendered `~~text~~ (struck, out of scope)`.
- CLI: `ticket.mjs <key|url|path> [--env <name>] [--json | --replay-text]`; exit codes per Global Constraints; `--replay-text` prints the latest `[test-ticket]` comment of the env verbatim.

- [ ] **Step 1: Write the failing tests** with a fake tracker: `buildDossier deduces env from key and marks forced`; `buildDossier returns stop when status is doNotTest`; `renderDossier lists struck criteria as out of scope`; `renderDossier in fr uses French headings`; `buildDossier in file mode yields delivery unknown and no replay`.
- [ ] **Step 2: FAIL** — [ ] **Step 3: Implement** — [ ] **Step 4: PASS**
- [ ] **Step 5: Smoke run** against a temp host folder with `tracker.type: file` and a Markdown ticket: `node scripts/ticket.mjs ./ticket.md` prints criteria and "delivery not verified".
- [ ] **Step 6: Commit** — `git commit -m "feat: ticket dossier CLI"`

---

### Task 9: Auth presets, API call library, `api.mjs` CLI

**Files:**
- Create: `scripts/lib/auth/index.mjs`, `password-login.mjs`, `static-token.mjs`, `none.mjs`, `scripts/lib/api.mjs`, `scripts/api.mjs`
- Test: `scripts/lib/auth/auth.test.mjs`, `scripts/lib/api.test.mjs` (port of `api-v2.test.mjs`)

**Interfaces:**
- Produces: `createAuth(name, section, env, { fetchImpl, root }): Auth = { name, authenticate(apiUrl, credentials?): Promise<{ token, expiresAt: ISO }>, headers({ token, context }): Record<string,string>, cacheKey(credentials?): string }`.
- `password-login`: POST `${apiUrl}${loginPath}` JSON `{ [usernameField='username']: u, [passwordField='password']: p }`; reads `tokenField='access_token'`, `expiresField='expires_in'` (seconds, default 300); `headers` → `Authorization: Bearer`, plus `section.headers` (static map) and `context` entries. `static-token`: token from `tokenEnv`, `expiresAt` far future. `none`: no header. `custom`: module default export `(section, env, deps) → Auth`.
- Produces (`lib/api.mjs`): `parseApiArgs(argv)` → `{ env, auth: 'default'|name, context: {}, method, path, body, raw, credentialsFile }` with flags `--env`, `--auth`, `--header K=V` (repeatable, becomes `context`), `--credentials <file>`, `--body <json|@file>`, `--raw`; `tokenCachePath(root, envName, authName, username?)` under `.auth/api-<env>-<auth>[-<sha12>].json`; `tokenValid(cache, now)` (60 s margin); `call({ apiUrl, auth, method, path, body, context, cache, credentials, fetchImpl }): Promise<{ status, body, durationMs }>` with one re-authentication on 401.
- CLI `api.mjs`: picks the channel's `auth` when `--auth` omitted (`api` channel of the env; several api channels → `--channel <name>` required); prints `<status> <METHOD> <path> (<ms> ms)` then masked body; exit 5 on 5xx, 1 on auth failure, 2 on usage.

- [ ] **Step 1: Write the failing tests**: `password-login posts credentials and returns token with expiry`; `password-login error message never contains the password`; `static-token reads tokenEnv`; `headers merge static headers and context`; `custom auth module is loaded`; port `parseApiArgs`, `tokenValid`, `call re-authenticates once on 401`, `maskSecrets` usage; `tokenCachePath hashes the username`.
- [ ] **Step 2: FAIL** — [ ] **Step 3: Implement** — [ ] **Step 4: PASS**
- [ ] **Step 5: Commit** — `git commit -m "feat: auth presets and authenticated API call CLI"`

---

### Task 10: Browser sessions library and `session.mjs` CLI

**Files:**
- Create: `scripts/lib/session.mjs` (port of `session.mjs` lib), `scripts/session.mjs`
- Test: `scripts/lib/session.test.mjs` (port + new)

**Interfaces:**
- Produces: `validateStorageState(state, host, now, mtime, maxAgeHours = 8): { valid, reason }` (port of `sessionValide`); `profileDir(root, sessionName)` → `<root>/.auth/profiles/<sessionName>`; `sessionPlan(config, envName, sessionName): { mode, mcpServer, host, file?, command? }` (host = URL of the first channel of the env using this session); `setupCommand(plan, envUrls)` → `{ command, args, env }` splitting `plan.command` on spaces, env without `CI`, plus the environment's channel URLs exported as `FT_<CHANNEL>_URL`.
- CLI `session.mjs --env <name> --session <name> [--force]` → JSON `{ state: 'valid'|'invalid'|'external', mode, mcpServer, file?, profileDir?, host, setupRan, reason? }`; `persistent-profile`: creates the dir if missing, `state: 'valid'`; `external`: `state: 'external'`; `storage-state`: validate, run command when invalid or forced (stdout/stderr inherited), re-validate; exit 1 when still invalid.

- [ ] **Step 1: Tests**: port validation tests; `sessionPlan resolves mcpServer, mode and host from config`; `setupCommand exports channel URLs and drops CI`; `profileDir path`.
- [ ] **Step 2: FAIL** — [ ] **Step 3: Implement** — [ ] **Step 4: PASS**
- [ ] **Step 5: Commit** — `git commit -m "feat: browser session modes (persistent profile, storage state, external)"`

---

### Task 11: Preflight

**Files:**
- Create: `scripts/lib/preflight.mjs`, `scripts/preflight.mjs`
- Test: `scripts/lib/preflight.test.mjs`

**Interfaces:**
- Produces pure checks returning `{ level: 'ok'|'ko'|'warn', key, params }`: `checkConfig(errors)`, `checkEnvVars(config, env)`, `checkRepositories(config, root, exists)` (ko in `git-log`, warn in `both`, skipped otherwise), `checkMcp(config, envName, mcpJsonText)` (one line per session's `mcpServer` and for `automation.testMcpServer`; missing server → ko with `{ server }` — Review Focus 5; Playwright driver: `--user-data-dir`/`--storage-state` argument must match the session's profile dir / file → ko otherwise), `checkGitignore(text)` (warn when `.env` or `.auth/` missing), `checkDriverMapping(config, root, exists)`.
- Network checks in the CLI: tracker `whoami` (ko `preflight.trackerUnreachable`), one `authenticate` per `api` channel auth of the env (ko `preflight.authFailed`, warn when auth `optional`).
- Output: one localised line per check (`OK — …`, `KO — …`, `WARNING — …`), then `preflight.ready`/`preflight.blocked`; exit 0/1; exit 2 when no host root. Locale keys: `preflight.noHost`, `preflight.configValid`, `preflight.configInvalid`, `preflight.envMissing`, `preflight.envPresent`, `preflight.envOptionalMissing`, `preflight.reposPresent`, `preflight.reposMissing`, `preflight.mcpOk`, `preflight.mcpMissing`, `preflight.mcpMismatch`, `preflight.mcpFileMissing`, `preflight.trackerOk`, `preflight.trackerUnreachable`, `preflight.authOk`, `preflight.authFailed`, `preflight.gitignore`, `preflight.driverMappingMissing`.

- [ ] **Step 1: Tests**: `checkEnvVars lists missing required and optional separately`; `checkRepositories is ko in git-log and warn in both`; `checkMcp is ko naming the server when absent`; `checkMcp is ko when the playwright profile dir does not match`; `checkMcp is ok for an external session with declared server`; `checkGitignore warns when .auth/ missing`.
- [ ] **Step 2: FAIL** — [ ] **Step 3: Implement** — [ ] **Step 4: PASS**
- [ ] **Step 5: Smoke**: temp host with file tracker, no sessions: `node scripts/preflight.mjs --env local` → `--- ready`.
- [ ] **Step 6: Commit** — `git commit -m "feat: preflight derived from the host configuration"`

---

### Task 12: Coverage and `candidates.mjs` CLI

**Files:**
- Create: `scripts/lib/coverage.mjs` (port of `couverture.mjs`), `scripts/candidates.mjs`
- Test: `scripts/lib/coverage.test.mjs`

**Interfaces:**
- Produces: `branchRegex(pattern, key): RegExp` — `{key}`, `{key-lower}`, `{slug}` (→ `[^/]*`) placeholders; `coveredKeys(keys, { specPaths, grep, branches }): Set<string>`; `loadExclusions(path): [{ key, date, reason }]`; `filterCandidates(tickets, covered, exclusions)`.
- CLI: `candidates.mjs [--json] [--all]`: `tracker.searchWithMarker(MARKER)` → for each key `getIssue`, `latestReports(all envs)` → keep tickets whose newest report has `candidates.length > 0`; output as today (key · status · env · date · title, then `- Tn (Pn) title`), `--all` adds covered / excluded / without candidates; prints `candidates.truncated` warning when `tracker.lastSearchTruncated`; file tracker → exit 2 with `candidates.unsupported`.

- [ ] **Step 1: Tests**: port; add `branchRegex builds from pattern with slug wildcard`; `filterCandidates keeps only tickets with candidates, not covered, not excluded`.
- [ ] **Step 2: FAIL** — [ ] **Step 3: Implement** — [ ] **Step 4: PASS**
- [ ] **Step 5: Commit** — `git commit -m "feat: automation candidates listing with configurable coverage detection"`

---

### Task 13: Setup writer library and `setup-write.mjs` CLI

**Files:**
- Create: `scripts/lib/setup/write.mjs`, `scripts/setup-write.mjs`, `templates/pitfalls.md`, `templates/excluded.json`, `templates/mcp/*.json`
- Test: `scripts/lib/setup/write.test.mjs`

**Interfaces:**
- Produces: `mcpEntriesFor(config, root): Record<string, McpServer>` — one entry per `sessions.*.mcpServer` from the driver template (`playwright-mcp`: `npx -y @playwright/mcp@<pinned> --browser <engine> --viewport-size <viewport>` + `--user-data-dir <profileDir>` or `--isolated --storage-state <file>`; `cypress-mcp`, `robotframework-mcp`: templates filled by the builder from the verified servers), plus `automation.testMcpServer` entry when the framework has a known test MCP (`playwright` → `npx playwright run-test-mcp-server`).
- Produces: `mergeMcpJson(existingText: string | null, entries): string` — keeps existing servers, adds missing ones, never replaces an existing key; `envExampleBlock(config, t): string` — commented block listing every variable from `requiredEnvVars` with a one-line purpose; `appendEnvExample(existing: string | null, block): string` — idempotent (block delimited by `# >>> functional-test` / `# <<< functional-test`, replaced in place); `gitignoreAdditions(existing: string | null): string[]` (`.env`, `.auth/`); `writeHostFiles(root, config, { fs }): { written: string[], skipped: string[] }` — writes `config.json` (pretty, 2 spaces), `pitfalls.md` and `excluded.json` only if absent, merges `.mcp.json`, appends `.env.example`, adds `.gitignore` lines; never writes `.env`.
- CLI: `setup-write.mjs <answers.json>` → `applyDefaults` + `validateConfig` (exit 2 with errors) → `writeHostFiles` → prints written/skipped, then runs the preflight CLI logic for the default environment and prints its output.

- [ ] **Step 1: Tests**: `mergeMcpJson adds servers and keeps existing ones untouched`; `mergeMcpJson on invalid JSON throws a clear error`; `appendEnvExample is idempotent and replaces the delimited block`; `gitignoreAdditions returns only missing lines`; `writeHostFiles does not overwrite an existing pitfalls.md`; `mcpEntriesFor builds a persistent-profile playwright entry with the profile dir`.
- [ ] **Step 2: FAIL** — [ ] **Step 3: Implement** — [ ] **Step 4: PASS**
- [ ] **Step 5: Commit** — `git commit -m "feat: setup writer for host files"`

---

### Task 14: `test-ticket` skill and references

**Files:**
- Create: `skills/test-ticket/SKILL.md`, `references/test-design-rules.md`, `references/report-templates.md`, `references/tracker-notes.md`, `references/browser-drivers/{playwright-mcp,cypress-mcp,robotframework-mcp,template}.md`, `references/frameworks/{playwright,cypress,robotframework}.md`

**Interfaces:**
- Consumes: every CLI of Tasks 8–11 by exact invocation `node ${CLAUDE_PLUGIN_ROOT}/scripts/<name>.mjs …`.

- [ ] **Step 1: Write `SKILL.md`** — frontmatter `name: test-ticket`, English `description` mirroring today's triggers ("test KEY", "replay the ticket", "the ticket is in Test"…), body = the six steps of the current skill translated and generalised:
  - Rules block (secrets, 5xx = KO, uncertainty = INCONCLUSIVE, test data prefix from config, application repos read-only, single mandatory pause, browser commands outside the sandbox, write everything the user reads in `config.language`).
  - Step 1 preflight (`preflight.mjs --env`), then driver check: read the mapping file of `browser.driver` and verify its tools exist in the session; then login check for `persistent-profile`/`external` sessions: one "open URL" on the channel, login page → stop, ask the human to log in, resume.
  - Step 2 `ticket.mjs`; input forms (key, URL, Markdown path); `stop` → explain and end; replay via `--replay-text`.
  - Step 3 plan: eight rules from `test-design-rules.md`, plan template (same table), the single question "Shall I run it? …" (`AskUserQuestion` when available).
  - Step 4 execution: `session.mjs` per session, browser actions through the driver mapping, `api.mjs` with `--header` for context, eventual consistency loop (30 s, 10 × 3 s), UNSTABLE rule, proofs, early stop.
  - Step 5 verdict rules, `report.json` fields (Task 4 `Report`), `comment.mjs format` and `diff`, restitution per `report-templates.md`, "what's left to the dev" using `statuses.afterOk/afterKo` of the project.
  - Step 6 pitfall discovered → report only.
- [ ] **Step 2: Write `test-design-rules.md`** — translation of `techniques-de-test.md` with neutral examples (an order with contract types, a paginated list with a cap, a document lifecycle), no Wizim names.
- [ ] **Step 3: Write `report-templates.md`** — chat report template and comment description (spec §4.5), English copy; note that labels follow the configured language.
- [ ] **Step 4: Write `tracker-notes.md`** — Jira (statuses, `renderedFields`), GitHub (labels as statuses, timeline PRs, search limits), file mode limits.
- [ ] **Step 5: Write driver mappings** — `playwright-mcp.md`: table action → tool (`open URL → browser_navigate`, `read page → browser_snapshot`, `click → browser_click`, `type → browser_type`, `press key → browser_press_key`, `screenshot → browser_take_screenshot`, `close → browser_close` after a storage-state refresh; login detection = URL or snapshot shows a login form), server package `@playwright/mcp@<pinned>`. `cypress-mcp.md` and `robotframework-mcp.md`: same table filled from the verified servers, with "Status: community, verified on <date>, version <x>" and the unsupported actions listed; `template.md`: empty table with instructions.
- [ ] **Step 6: Write framework notes** — per framework: spec location default, file naming citing the ticket key in the title (so `coveredKeys` finds it), run command, one minimal example, "follow `automation.howToWriteTests` first".
- [ ] **Step 7: Verify** — `claude plugin validate .` (or `claude --plugin-dir . ` and `/test-ticket` appears in `/help`); read SKILL.md once as the executor: every command resolves to an existing script.
- [ ] **Step 8: Commit** — `git commit -m "feat: test-ticket skill and references"`

---

### Task 15: `automation-candidates` skill

**Files:**
- Create: `skills/automation-candidates/SKILL.md`

- [ ] **Step 1: Write `SKILL.md`** — frontmatter `name: automation-candidates`, description with triggers ("what's left to automate", "automation candidates", "the devs' proposals"); body: list via `candidates.mjs`; present as-is, newest first; three answers (automate / exclude / later) per spec §4.1; automate = `ticket.mjs KEY`, branch from `automation.branchPattern`, read `automation.howToWriteTests` and `references/frameworks/<framework>.md`, explore with the driver, write, run via `automation.testMcpServer` or `automation.runCommand`, until green; title cites the key; exclusion = append `{ key, date, reason }` to `automation.excludedFile`, show diff, commit on request; never write to the tracker; truncation warning relayed.
- [ ] **Step 2: Verify** the skill lists and re-reads correctly against a fake host (file tracker → the skill must explain candidates are unavailable).
- [ ] **Step 3: Commit** — `git commit -m "feat: automation-candidates skill"`

---

### Task 16: `setup` skill

**Files:**
- Create: `skills/setup/SKILL.md`

- [ ] **Step 1: Write `SKILL.md`** — frontmatter `name: setup`, description ("configure functional-test for this project", "/functional-test:setup"); body: detect existing config (propose current values as defaults); the eight questions of spec §4.7 in order with defaults; collect answers into `<scratchpad>/answers.json` shaped as the config; run `node ${CLAUDE_PLUGIN_ROOT}/scripts/setup-write.mjs <answers.json>`; show written/skipped and the preflight output; tell the user which `.env` variables to fill (names only) and how to re-run the preflight; for community drivers, show the install command from the mapping file; never ask for a secret value in chat; never overwrite host content.
- [ ] **Step 2: Verify** end to end on a temp folder: run the interview as the executor with a file tracker and no UI → `config.json`, `pitfalls.md`, `excluded.json`, `.env.example` block, `.gitignore` lines; preflight `--- ready`.
- [ ] **Step 3: Commit** — `git commit -m "feat: setup skill"`

---

### Task 17: Documentation and release 0.1.0

**Files:**
- Create: `README.md`, `docs/config-reference.md`, `docs/adapters.md`, `docs/migration-from-wizim-e2e.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: `README.md`** — what it does (one paragraph), ten-minute quickstart (`claude plugin marketplace add Zerems/functional-test-plugin`, `claude plugin install functional-test@zerems-plugins`, `/functional-test:setup`, fill `.env`, `/test-ticket <key>`), supported trackers / drivers / frameworks table with status (reference, community, planned), security rules including the suggested host `settings.json` permissions block (`deny`: `Read(./.env)`, `Read(./.auth/**)`, `Read(./.mcp.json)`, `Edit(./.env)`, `Edit(./.auth/**)`; `allow`: `Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/*)`), licence.
- [ ] **Step 2: `docs/config-reference.md`** — every field of §4.2 with type, default, validation rule (generated from Task 2's rules, kept in sync by hand).
- [ ] **Step 3: `docs/adapters.md`** — tracker and auth interfaces (Tasks 5, 9) with a minimal custom module example each; how to add a built-in adapter (file, registration, tests, docs).
- [ ] **Step 4: `docs/migration-from-wizim-e2e.md`** — spec §5 as a checklist for the follow-up plan.
- [ ] **Step 5: `CHANGELOG.md` 0.1.0** entry; `npm test` green; `claude plugin validate .` ok.
- [ ] **Step 6: Commit and tag** — `git commit -m "docs: README, config reference, adapters guide, migration notes" && git tag v0.1.0`.
