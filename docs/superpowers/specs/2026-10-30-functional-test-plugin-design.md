# Functional Test plugin — design

Date: 2026-10-30
Status: draft for approval
Origin: the `/test-ticket` and `/a-automatiser` skills of the private `wizim-e2e` repository (Interaction / Wizim), rewritten as a portable Claude Code plugin.

## 1. Intent

Today two skills let a developer test a delivered Jira ticket from Claude Code and let QA
arbitrate what deserves an automated test. They work well but only inside `wizim-e2e`:
they hard-code Wizim's environments, Jira projects, Bitbucket, authentication model,
application repositories and a large body of environment knowledge.

We want the same behaviour, installable on **any project** with a **minimal one-time
configuration**: a person adds the plugin to Claude Code, runs a setup command, answers a
few questions, and `/test-ticket` then behaves exactly as it does in `wizim-e2e` today,
on their own tracker, forge, environments and application.

The plugin is published from the author's personal GitHub account (`Zerems`) as a Claude
Code marketplace, so anyone can install it.

## 2. Goals, non-goals, anti-goals

### Goals

- G1. Identical user-facing behaviour to the current `/test-ticket`: preflight, ticket
  reading with acceptance criteria (struck-through criteria out of scope), deterministic
  test plan derived from eight fixed rules, **one mandatory pause** for plan validation
  (a browser login interruption may additionally occur on first use, see 4.4),
  execution through API calls and an already-authenticated browser, verdict
  OK / KO / INCONCLUSIVE, a tracker comment ready to paste, replay after a fix.
- G2. Identical behaviour for `/a-automatiser`: list the automation candidates proposed in
  `[test-ticket]` comments that are neither covered nor excluded, then follow QA's
  decision (write the test following the host project's conventions, or record an
  exclusion with a reason).
- G3. Everything project-specific lives in the host project: a config file, a `.env`, an
  optional environment-pitfalls file, an optional exclusions file, optional adapter modules.
- G4. Tracker-agnostic and forge-agnostic through small adapter interfaces. v1 ships
  **Jira** and **GitHub Issues** adapters, a **local file** mode (criteria in a Markdown
  file, no tracker at all), and a forge-independent delivery check based on `git log`.
- G5. Engine in English; everything a human reads (plan, report, comment, preflight
  messages) in a configurable language. v1 ships `en` and `fr`.
- G6. A `setup` command that interviews the user, writes the host files, and runs the
  preflight. Re-runnable, never destructive.
- G7. No npm dependency in the plugin. Node.js ≥ 20 is the only runtime requirement.
- G9. The browser is driven through a **browser MCP server declared in the config**.
  Playwright MCP is the built-in reference driver; Cypress and Robot Framework MCP servers
  (community projects, see 4.4) are supported as drivers with their own tool mapping, and
  any other browser MCP can be declared with a custom mapping. The **automation
  framework** the host writes its tests in (Playwright, Cypress, Robot Framework, other)
  is also configured: `automation-candidates` proposes, writes and runs tests in that
  framework, through a test MCP server when the host has one.
- G8. `wizim-e2e` becomes the first consumer and keeps its current behaviour, including
  French output and its existing `[test-ticket]` comments on Jira.

### Non-goals (v1)

- GitLab and Linear adapters. The interfaces must make them straightforward; they are not
  written in v1.
- Writing to the tracker (comments, transitions, fields). The developer pastes the comment
  and moves the ticket, as today.
- Writing automated tests from the plugin itself. `/a-automatiser` hands over to the host
  project's own conventions and agents.
- Shipping Wizim's environment pitfalls, account tables or anomaly register. They move
  to `wizim-e2e`'s own pitfalls file.
- Bundling a browser or Playwright. The host installs the Playwright MCP server as today.
- Mobile application testing.

### Anti-goals

- A test that passes because the skill adapted to a defect. A 5xx is always a KO.
- Any secret (token, password, session) printed in chat, in a proof, or in a comment.
- A plugin that only works when the host repository looks like `wizim-e2e` (e.g. requires
  Playwright setup projects, a `tests/` folder or a `scripts/qa-domains.mjs`).
- A "generic" plugin whose setup takes longer than cloning `wizim-e2e` did. Minimal
  configuration is a requirement, not a nice-to-have: a project with one environment, a
  GitHub tracker and no API must be usable in under ten minutes.

## 3. Constraints

- Claude Code plugin format: `.claude-plugin/plugin.json`, `skills/<name>/SKILL.md`,
  optional `commands/`, scripts referenced through `${CLAUDE_PLUGIN_ROOT}`. The repository
  is also its own marketplace (`.claude-plugin/marketplace.json`).
- Scripts run from the plugin directory, not from the host repository: the host root is
  discovered, never assumed from the script's own path.
- No `node_modules`: `.env` parsing, HTML/Markdown conversion, HTTP calls use Node built-ins.
- Claude must never read `.env`, `.auth/` or the MCP config: scripts load secrets
  themselves and mask them in any output.
- Browser automation goes through an MCP server, as today (Playwright MCP `browser_*`
  tools in `wizim-e2e`). On 2026-10-30 no **official** Cypress or Robot Framework MCP
  server exists; community ones do (`cypress-mcp` on npm; `robotframework-mcp` by
  SourceFuse and `rf-mcp` on PyPI). The design therefore never depends on one specific
  server: drivers are tool mappings (4.4), and the builder verifies the community servers'
  actual tool names before shipping their mapping.
- The plugin repository, its code, comments, docs and skill instructions are in English.
  The user-facing output follows the configured language.

## 4. Architecture

```
functional-test-plugin/                     (GitHub: Zerems/functional-test-plugin)
  .claude-plugin/plugin.json                name "functional-test", version, author
  .claude-plugin/marketplace.json           lists this plugin (source: this repo)
  skills/
    test-ticket/SKILL.md                    the 6-step workflow (engine instructions)
    test-ticket/references/                 test-design rules (ISTQB), report templates, tracker notes
    test-ticket/references/browser-drivers/ one tool-mapping file per browser MCP: playwright-mcp.md (reference),
                                            cypress-mcp.md, robotframework-mcp.md (community, version-pinned), template.md (custom)
    automation-candidates/SKILL.md          formerly a-automatiser
    setup/SKILL.md                          interview → host files → preflight
  scripts/                                  entry points: preflight, ticket, api, session, comment, candidates, setup-write
  scripts/lib/                              engine: config, env, i18n, trackers/, delivery, criteria, comment, auth/, coverage
  scripts/lib/**/*.test.mjs                 node:test, no deps
  locales/en.json, locales/fr.json
  templates/                                host file skeletons written by setup (config, pitfalls, excluded, .env.example block, .mcp.json entries)
  docs/                                     README quickstart, adapters guide, config reference, migration from wizim-e2e
```

Host project, after `setup`:

```
<host>/
  .claude/functional-test/config.json       everything non-secret (committed)
  .claude/functional-test/pitfalls.md       environment pitfalls, team-written, optional (committed)
  .claude/functional-test/excluded.json     tickets QA excluded from automation (committed)
  .claude/functional-test/adapters/*.mjs    custom auth / tracker / session adapters, optional (committed)
  .env                                      secrets (gitignored); .env.example gets a documented block
  .mcp.json                                 Playwright MCP server entries (merged, never overwritten)
  .auth/                                    token cache and browser profiles (gitignored)
```

Host root discovery: start from the current working directory and walk up until
`.claude/functional-test/config.json` is found. Claude Code runs commands from the project
root, so in practice this is immediate; walking up makes worktrees and sub-folders work.

### 4.1 Skills

**`test-ticket`** keeps the six steps of the current skill. What changes:

- Step 1 preflight reads the config and checks only what the config requires (see 4.6).
- Step 2 reads the ticket through the tracker adapter and the delivery through the
  delivery module. Input is a ticket key, a tracker URL, or a path to a local Markdown
  file (file mode).
- Step 3 derives the plan with the same eight rules. The `channels` of the environment
  (front, bo, api… declared in config) replace the hard-coded Wizim channels. Pitfalls come
  from the host's pitfalls file. The plan is written in the configured language.
- Step 4 executes through the `api` script (authentication delegated to the auth adapter)
  and the browser MCP tools of the configured driver (4.4) after the `session` script
  confirmed a connected browser. The SKILL.md describes browser actions abstractly
  (open a URL, read the page, click, type, take a screenshot) and the driver's mapping
  file says which MCP tool performs each one.
- Step 5 writes `report.json` in the scratchpad, then the `comment` script formats it in
  the configured language, with the stable machine-readable block (4.5).
- Step 6 "pitfall discovered" is unchanged: reported, never written to the pitfalls file
  by the skill.

**`automation-candidates`** (was `a-automatiser`): lists tickets whose latest
`[test-ticket]` comment carries candidates, minus covered and excluded ones. Coverage
detection is configured (paths to grep, branch pattern). Arbitration:

- "automate T2 and T3 of KEY": read the ticket and comment, create the configured branch,
  then write the test in the configured **framework** (`automation.framework`:
  `playwright`, `cypress`, `robotframework` or `other`), following the host project's own
  test-writing instructions. The config points to them (`automation.howToWriteTests`: a
  path to a Markdown file such as the host's `CLAUDE.md` or a dedicated guide, optionally
  the names of agents to use). The skill explores the behaviour with the browser MCP
  driver, writes the spec, then runs it until green through the host's **test MCP
  server** when one is declared (`automation.testMcpServer`: Playwright's
  `run-test-mcp-server` as used in `wizim-e2e`, or a Cypress / Robot Framework MCP that
  can run a spec) or else through `automation.runCommand` (`npx playwright test {file}`,
  `npx cypress run --spec {file}`, `robot {file}`). The plugin ships no agent and no
  framework; it ships one short "framework notes" reference per supported framework
  (file layout, naming, how the ticket key is cited so coverage detection finds it).
- "exclude KEY: reason": append to the exclusions file, show the diff, commit on request.
- "later": do nothing.

**`setup`**: see 4.7.

### 4.2 Host configuration

`config.json` is the single non-secret source of truth. Indicative shape (the builder
finalises the schema and validates it in preflight with clear error messages):

```jsonc
{
  "version": 1,
  "language": "fr",                                // en | fr (locale files); default en
  "tracker": {
    "type": "jira",                                // jira | github | file | custom
    "module": null,                                // custom: path to an adapter module
    "baseUrl": "https://wizim-dev.atlassian.net",  // github: "https://api.github.com" (default) or GHES
    "projects": ["WV", "WVS"],                     // jira project keys / github "owner/repo" list
    "statuses": {
      "toTest": ["Test"],                          // expected status when the skill runs (else a warning)
      "doNotTest": ["Pas un bug", "Besoin story", "En attente d'infos"],
      "afterOk": "Test OK", "afterKo": "Test KO",  // only echoed in "what's left to the dev"
      "perProject": { "WVS": { "afterOk": "Test Ok" } }
    }
  },
  "environments": {
    "testing": {
      "branch": "testing",                         // branch deployed on this environment
      "channels": {
        "front": { "url": "https://app-testing.wizim.io", "session": "front" },
        "bo":    { "url": "https://bo-next-testing.wizim.io", "session": "bo" },
        "api":   { "url": "https://api-testing.wizim.io", "auth": "agency" }
      }
    },
    "demo": { "...": "..." }
  },
  "defaultEnvironment": { "fallback": "testing", "byProject": { "WVS": "demo" } },
  "delivery": {
    "mode": "git-log",                             // git-log | tracker | both | none (default: both when the tracker knows PRs)
    "recentMinutes": 60,
    "repositoriesDir": "..",                       // relative to host root; env var FT_REPOS_DIR overrides
    "repositories": [                              // "." = the host repository itself (single-repo projects)
      { "name": "wizim-front-v2", "channel": "front" },
      { "name": "wizim-backend-v2", "channel": "api" },
      { "name": "wizim-interim", "channel": "mobile" }   // mobile: "not testable by this skill"
    ]
  },
  "browser": {
    "driver": "playwright-mcp",                    // playwright-mcp (reference) | cypress-mcp | robotframework-mcp | custom
    "driverMapping": null,                         // custom: path to the host's tool-mapping file (see 4.4)
    "engine": "msedge",                            // chromium (default) | msedge | chrome | firefox | webkit, when the driver supports it
    "viewport": "1440x900"
  },
  "sessions": {                                    // one MCP server per session name, shared by all environments (see 4.4)
    "front": { "mode": "persistent-profile", "mcpServer": "playwright" },
    "bo":    { "mode": "storage-state", "mcpServer": "playwright-bo", "file": ".auth/bo.json",
               "command": "npx playwright test --project=bo-auth-setup --reporter=list" }
  },
  "auth": {
    "agency": { "preset": "password-login", "loginPath": "/v1/auth/agency/login",
                "usernameEnv": "API_V2_AGENCY_USERNAME", "passwordEnv": "API_V2_AGENCY_PASSWORD" },
    "custom-example": { "preset": "custom", "module": ".claude/functional-test/adapters/auth.mjs" }
  },
  "testData": { "prefix": "[E2E]", "emailDomains": ["e2e.wizim.test", "yopmail.com"] },
  "pitfallsFile": ".claude/functional-test/pitfalls.md",
  "automation": {
    "framework": "playwright",                     // playwright | cypress | robotframework | other
    "specPaths": ["tests/"],                       // git grep -w <key> here ⇒ covered (defaults per framework: tests/, cypress/e2e/, tests/ *.robot)
    "branchPattern": "test/{key-lower}-{slug}",    // existing branch matching ⇒ covered
    "excludedFile": ".claude/functional-test/excluded.json",
    "howToWriteTests": "CLAUDE.md",                // what the skill reads before writing a test
    "testMcpServer": "playwright-test",            // optional: MCP server that runs/debugs the written test
    "runCommand": "npx playwright test {file}"     // fallback when no test MCP server; default per framework
  }
}
```

Secrets are never in `config.json`: the config names the **environment variables** that
hold them (`*Env` fields), and `.env.example` documents them. Tracker credentials have
fixed variable names per adapter (`JIRA_EMAIL` / `JIRA_API_TOKEN`, `GITHUB_TOKEN`), listed
in the adapter's documentation and written to `.env.example` by setup.

### 4.3 Adapter interfaces

Adapters are ES modules exporting plain functions. Built-in ones live in the plugin; a
host may point `module` to its own file, which receives the config section and `env`.

**Tracker**

```ts
createTracker(config, env) → {
  keyPattern: RegExp,                       // how to recognise a key in free text / URL
  normaliseKey(input: string): string,      // "wv-363", URL → "WV-363" ; "#12" → "owner/repo#12"
  getIssue(key): Promise<Issue>,
  searchWithMarker(marker: string): Promise<string[]>,   // keys whose comments contain the marker
  getLinkedPullRequests(issue): Promise<PullRequest[] | null>,  // null = this tracker cannot know
  whoami(): Promise<string>                 // display name, for the preflight line
}
Issue = { key, id, title, status, type, url, labels[], parent?, links[],
          body: { format: 'html' | 'markdown' | 'text', content },
          comments: [{ author, date, body: { format, content } }] }
PullRequest = { repository, title, sourceBranch, targetBranch, status: 'MERGED'|'OPEN'|'DECLINED', mergedAt?, url }
```

- `jira`: REST v3 with `renderedFields` (HTML), Bitbucket/GitHub dev-status for linked PRs
  (reuse of the existing client).
- `github`: REST issues API (Markdown body and comments), linked PRs from the issue
  timeline (`cross-referenced` and `connected` events) and PRs whose body contains a
  closing reference. `projects` entries are `owner/repo`. **Status mapping**: GitHub
  issues only have `open`/`closed` plus labels, so the adapter reports as `status` the
  first label that appears in any of the configured `statuses` lists; when none matches,
  `status` is `open` or `closed`. For GitHub the `statuses` config therefore holds label
  names, setup says so in its question, and a `closed` issue produces the same "status
  unexpected" warning as a non-`toTest` status in Jira. GitHub Projects (v2) columns are
  not read in v1.
- `file`: `getIssue(path)` reads a Markdown file; title = first heading, criteria = list
  items; no comments, no search, no PRs (replay and candidates are unavailable and say so).

`searchWithMarker(marker)` searches comments for the constant marker `[test-ticket]`
only (never a localised label). The `candidates` script then re-reads each returned
ticket and keeps those whose latest `[test-ticket]` comment has a non-empty
`candidates` list in its data line (or in the legacy French format). Ticket-by-ticket
reads are accepted (as today). For GitHub the adapter uses the search API
(`"[test-ticket]" in:comments repo:owner/repo`), whose indexing may lag and whose rate
limit is low; the script says so when the search is truncated. No local cache in v1.

**Criteria extraction** is engine code with two parsers (HTML from Jira, Markdown from
GitHub/file). Both keep strike-through (`<del>`/`<s>` or `~~…~~`) and mark those criteria
"out of scope", and both drop a leading intent sentence ("As a …", "En tant que …").

**Delivery** (engine, not an adapter)

- `git-log` mode: for each configured repository, `git -C <repo> log origin/<branch> --grep=<key> -i --format=…` plus branches named with the key. Finds the newest commit date; state `absent` / `recent` (< `recentMinutes`) / `effective`. Reports repositories whose local refs look stale (last commit date older than the tracker's merge date, when known), as today ("the dev fetches, the skill never does").
- `tracker` mode: PRs merged into the environment's branch, as today.
- `both` (default when the tracker returns PRs): tracker for dates and links, git log to confirm and to detect partial deliveries.
- `none`: no delivery check at all. State is `unknown`.
- Technical scope (channels touched) comes from the repositories' `channel` in config;
  with `none` or `file` mode it is "all channels of the environment".

States and their effect on the run:

| State | When | Effect |
|---|---|---|
| `effective` | key found, older than `recentMinutes` | nothing to report |
| `recent` | key found, newer than `recentMinutes` | warning in the plan: deployment may not be live |
| `absent` | a check ran and found nothing | **INCONCLUSIVE immediately**, as today (unless the dev designates a PR or commit) |
| `unknown` | `mode: none`, `file` tracker, or a `tracker`-only mode whose tracker returned `null` | warning in the plan ("delivery not verified"), the run continues; the verdict is never INCONCLUSIVE for that reason alone |

The host repository may be listed as `"."`: the "application repositories are read-only,
never fetch" rule then applies to the *other* repositories; the host repository is the
one Claude already works in (branches for `automation-candidates`, commits of the
exclusions file). Refs of `"."` are read as they are, like any other repository.

**Auth** (for the `api` script)

```ts
createAuth(section, env) → {
  authenticate(): Promise<{ token, expiresAt }>,       // may throw a masked error
  headers(ctx): Record<string,string>,                 // Authorization + context headers (e.g. X-Agency-Id)
  cacheKey: string                                     // token cache under .auth/
}
```

Presets: `password-login` (POST JSON `{username,password}` to `loginPath`, reads
`access_token` and `expires_in` by default, field names configurable), `static-token`
(`tokenEnv`), `none`, `custom` (module). Wizim's "first agency of the JWT becomes
`X-Agency-Id`" rule and its disposable worker-account flow live in a custom module inside
`wizim-e2e`, not in the plugin. The `api` script keeps its contract: `--env`, `--auth
<name>`, `--credentials <file>` for an alternate account, `--body`, exit code 5 on 5xx,
masked bodies, token cache per env/auth/account.

### 4.4 Browser driver and sessions

**Driver.** The skill never names MCP tools directly. It reasons in six abstract browser
actions (open URL, read page, click, type, press key, screenshot) plus "detect a login
page", and a **driver mapping file** says which tool of the configured MCP server
performs each one, with any argument conventions. Built-in mappings:

| Driver | MCP server | Status | Sessions supported |
|---|---|---|---|
| `playwright-mcp` | `@playwright/mcp` (`browser_navigate`, `browser_snapshot`, `browser_click`…) | reference, fully supported | `persistent-profile`, `storage-state` |
| `cypress-mcp` | community `cypress-mcp` (npm) | supported if its tool set covers the six actions; version pinned in the mapping | `external` |
| `robotframework-mcp` | community `robotframework-mcp` (SourceFuse) or `rf-mcp` (PyPI), Browser/Selenium library underneath | same rule | `external` |
| `custom` | any | host provides the mapping file (`browser.driverMapping`, from `template.md`) | declared in the mapping |

The builder verifies each community server's actual tools before shipping its mapping;
a server that cannot perform one of the six actions is documented as partial, and the
skill treats the channels it cannot drive as "not playable" rather than failing. Setup
offers the driver list, writes the matching `.mcp.json` entries (the community servers'
install commands come from the mapping files), and the preflight checks that the chosen
driver's server is declared.

**Sessions.** The skill needs a browser that is already logged in. A **session name** (`front`, `bo`…)
maps to exactly **one MCP server entry** in `.mcp.json`, named by `mcpServer`, shared by
all environments: an MCP entry is static, and browser cookies are per host, so one
profile or one storage-state file can hold sessions for `testing` and `demo` at once
(storage-state files are rewritten per run as today, which `session` validates by host).
Claude picks the tools of that server (`mcp__<mcpServer>__browser_*`) for every channel
that declares this session; the `session` script prints the server name to use.

Three modes per session name:

- `external` (only mode for non-Playwright drivers): the MCP server or the framework
  manages authentication itself (Cypress `cy.session`, Robot Framework keywords); the
  `session` script only reports the server name, and the login check below applies.
- `persistent-profile` (default for `playwright-mcp`, zero code): the MCP server is started with a persistent
  `--user-data-dir` under `.auth/profiles/<session>/`. No script can open the browser or
  read the login state of a Chromium profile (the plugin bundles no Playwright, cookies are
  encrypted), so the `session` script only ensures the directory exists and reports the
  server name. **Login is checked by Claude**, right after the preflight and before the
  plan: one `browser_navigate` to the channel URL of the target environment; if it lands
  on a login page, Claude stops and asks the human to log in **themselves** in the opened
  browser, then re-navigates and continues. This interruption is distinct from the plan
  validation pause, happens only on first use or after expiry, and is also the fallback
  when a redirect to login occurs mid-execution. The skill never types credentials.
- `storage-state`: the host declares a `command` that produces a Playwright
  `storageState` file; the `session` script validates the file against the environment's
  host (origin or host cookies, age) and re-runs the command when invalid, as today.

Setup writes one MCP server entry per session name into `.mcp.json` (merged with existing
entries, never overwritten). Browser engine (`chromium` default, `msedge`, …) and viewport
are config. Preflight check 6 verifies that each `mcpServer` named by the sessions of the
target environment exists in `.mcp.json` with the matching profile directory or
storage-state path.

### 4.5 Internationalisation and the comment format

- `locales/<lang>.json` holds every user-facing string emitted by scripts (preflight lines,
  comment labels, report headings). SKILL.md tells Claude to write the plan and the
  report in `config.language` and to use the templates in the configured language.
- The pasted comment has two parts:
  1. A human-readable part in the configured language, same content as today (header with
     marker, environment, date, verdict; "Failure:" / "Cause:" lines first; delivery;
     constraints; cases; not played; data created; candidates; pitfall).
  2. A final single line `[test-ticket:data] {…}`: compact JSON (`v`, `env`, `date`,
     `verdict`, `cases[{id,priority,title,result,detail?}]`, `candidates`, `notPlayed`,
     `data`, `constraints`, `reason?`, `pitfall?`). Replay and `automation-candidates`
     parse **this line only**, so the language of the human part is irrelevant.
- Legacy: the parser falls back to the current French labelled format when the data line
  is absent, so existing Wizim comments keep working for replay and candidates.
- The marker `[test-ticket]` is a constant (the tracker filter users subscribe to
  depends on it) and is not translated.

### 4.6 Preflight

One line per check, then `--- ready` or `--- blocked` (localised), exit 0/1. Checks are
derived from the config, never from a fixed list:

1. Config present, valid against the schema, language supported.
2. Every environment variable the config references (tracker credentials, each auth
   preset's `*Env`) is present and non-empty. Optional auth sections may be marked
   `"optional": true` → warning, cases become "not playable".
3. Tracker reachable (`whoami`), unless `type: file`.
4. Repositories present under `repositoriesDir` when `delivery.mode` uses git log
   (missing → blocked in `git-log`, warning in `both`).
5. For each `api` channel of the target environment: authentication succeeds.
6. `.mcp.json` declares the configured browser driver's MCP server for each session
   name used by the environment's channels (profile dir or storage-state path matches
   for Playwright), and the `automation.testMcpServer` when one is configured.
7. `.gitignore` covers `.env` and `.auth/` (warning).

The MCP tools' actual presence in the Claude session cannot be checked by a script; the
SKILL.md keeps today's instruction to verify `browser_*` tools exist before planning.

### 4.7 Setup command

`/functional-test:setup` (also reachable as `/setup` inside the plugin namespace) runs an
interview in the user's language of choice, then writes files. Questions, in order, with
defaults shown:

1. Output language.
2. Tracker type; base URL; projects / repositories; statuses (to test, do-not-test, after OK/KO).
3. Environments: name, deployed branch, channels with URLs; which is the default and any
   per-project default.
4. Delivery: where application repositories live and which channel each one is.
5. Browser driver (Playwright MCP default, Cypress MCP, Robot Framework MCP, custom), then
   sessions: for each channel with a UI, persistent profile (default), an existing
   storage-state command, or external.
6. API authentication: preset per API channel, variable names.
7. Test data prefix and e-mail domains.
8. Automation framework (Playwright, Cypress, Robot Framework, other), where automated
   tests live (spec paths, branch pattern), what to read before writing one, and how to
   run one (test MCP server or command).

Then it writes `config.json`, a `pitfalls.md` skeleton (sections, no content), an empty
`excluded.json`, a documented block appended to `.env.example`, merged `.mcp.json`
entries, `.gitignore` lines if missing, and runs the preflight. Secrets are never asked
in chat: setup tells the user which variables to fill in `.env` and re-runs the
preflight on request. Re-running setup proposes current values as defaults and
rewrites only what changed; it never deletes host content.

### 4.8 Security and conduct rules (carried over)

- Claude never reads `.env`, `.auth/**`, `.mcp.json`; the plugin's `settings` suggestions
  (documented, not enforced) include the corresponding `deny` rules.
- Scripts mask any value whose key looks like a secret; errors never include tokens.
- Alternate accounts are passed as a JSON file path, never as CLI arguments.
- Application repositories are read-only: never `git fetch`, never a modification.
- A 5xx is a KO. Uncertainty gives INCONCLUSIVE, never OK.
- Test data is prefixed and listed, never deleted.
- Browser-opening commands run outside the sandbox; the SKILL.md says so.

## 5. Migration of wizim-e2e (validation of the whole)

The plugin is done when `wizim-e2e`, configured as a host, runs `/test-ticket` on a real
ticket and produces the same plan, report and comment as today (in French), and
`/automation-candidates` lists the same tickets as `/a-automatiser`. Concretely:

- `.claude/functional-test/config.json` with `language: fr`, Jira tracker, the two
  environments and three channels, five repositories, `storage-state` sessions using the
  existing `auth-setup` / `bo-auth-setup` projects, auth `agency` as `password-login`
  plus a custom module for the `X-Agency-Id` rule and the disposable worker account flow.
- `pieges-env.md` → `.claude/functional-test/pitfalls.md`; `docs/qa/automatisation-ecartee.json`
  → `excluded.json` (or the config points to the existing path).
- The eight Wizim examples of `techniques-de-test.md` move to the pitfalls file or a
  host-side examples section; the plugin's rules file keeps neutral examples.
- `.claude/skills/test-ticket` and `a-automatiser` are removed from `wizim-e2e`;
  `tnr-demo` and `analyse-run-tnr`, which import the Jira client, either keep a copy or
  import from the plugin (builder's call, documented).
- `docs/qa/07-tester-un-ticket.md` is updated to the plugin install flow.

This migration is a separate change in `wizim-e2e`, planned after the plugin's first
release, but it is the acceptance test of the plugin and must be run before v1 is tagged.

## 6. Decisions log

| Decision | Choice | Alternative rejected |
|---|---|---|
| Distribution | Claude Code plugin, repository = marketplace, GitHub `Zerems/functional-test-plugin` | copying `.claude/skills` into each repo (no updates, no setup) |
| Host config location | `.claude/functional-test/` folder | root-level config file (root clutter), `.env` only (no structure) |
| Ticket source abstraction | adapter modules with a small interface; Jira + GitHub + file in v1 | declarative URL/JSON-path config (too brittle for GraphQL trackers), MCP-only reading (non-deterministic, no preflight) |
| Delivery check | `git log` by default, tracker PRs as enrichment | tracker-only (ties the plugin to Bitbucket dev-status) |
| Browser session | persistent profile by default, storage-state command optional | always requiring Playwright setup projects |
| API auth | presets + custom module | one declarative template for everything |
| Language | English engine, `language` config, `en`/`fr` locales | French only; English only |
| Comment format | localised text + stable `[test-ticket:data]` JSON line, legacy parser kept | parsing localised labels |
| Dependencies | none; Node ≥ 20 | dotenv & co. from the host's `node_modules` |
| Skill names | `test-ticket`, `automation-candidates`, `setup` | keeping `a-automatiser` (French) |
| Delivery not verifiable | `unknown` state: warning, run continues; `absent` stays INCONCLUSIVE | always INCONCLUSIVE (would make `file` mode and single-repo projects unusable) |
| Host = application repo | allowed as `"."` in `repositories`; read-only rule applies to the others | separate test repository required (wizim-e2e shape) |
| MCP servers | one per session name, shared by environments, named in config | one per session × environment (N×M entries, static `.mcp.json`) |
| Persistent-profile login | checked by Claude via `browser_navigate` before the plan; human logs in on demand | script-driven login check (impossible without bundling Playwright) |
| GitHub status | label matched against configured status lists, else open/closed | GitHub Projects columns (GraphQL, v2 scope) |
| Candidate search | marker-only search, client-side filter, ticket-by-ticket reads, no cache | localised-label search; local cache file |
| Browser driver | abstract actions + mapping file per MCP server; Playwright reference, Cypress and Robot Framework community mappings, custom | Playwright MCP hard-coded |
| Automation framework | configured (`playwright`, `cypress`, `robotframework`, `other`), test MCP server optional, run command fallback | Playwright-only test writing |
| Licence | MIT | — |

## 7. Left to the builder

- Exact JSON schema of `config.json` and the validation error wording.
- Locale key list and the English wording of the report and comment templates.
- GitHub adapter details: pagination, rate-limit handling, GHES base URL, how
  `owner/repo#n` keys map to `projects`.
- Whether the `[test-ticket:data]` line is wrapped in a code span for Markdown trackers.
- Test strategy (node:test with fixtures for each adapter; a fake tracker for the
  end-to-end script tests), versioning and release tagging, `marketplace.json` fields.
- README quickstart, adapters guide, config reference, migration guide.
- Layout of `.auth/` (profiles, token caches) and the cache-key hashing.
- Verification of the community Cypress and Robot Framework MCP servers (tool names,
  install command, pinned version), the content of their mapping files, and the
  "framework notes" for Cypress and Robot Framework.
