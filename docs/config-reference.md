# Configuration reference

The configuration lives in the host project, in `.claude/functional-test/config.json`. It is
JSON, contains no secret (it names the environment variables that hold them) and is
committed. `/functional-test:setup` writes it; `templates/config.example.json` is a complete
example. This page follows the order of that example.

Every script reads the file the same way: defaults are applied first (`applyDefaults`), then
the result is validated (`validateConfig`); every problem is listed as
`<json.path>: <message>` and the script stops (exit code 2, or `KO` in the preflight).
"Required" below means "reported by the validation when absent"; a few settings are required
by the adapters themselves and fail later, which is said in each case.

The host root is the nearest ancestor of the working directory that contains
`.claude/functional-test/config.json`. Relative paths in the configuration are relative to it.

## Top level

| Field | Type | Default | Rule |
|---|---|---|---|
| `version` | number | none | Required, must be `1`. |
| `language` | string | `"en"` | Must have a file `locales/<language>.json` in the plugin (`en`, `fr` shipped). |
| `pitfallsFile` | string | `".claude/functional-test/pitfalls.md"` | Path of the team-written environment pitfalls file. Not validated; the skill reads it when present. |

## `tracker`

Required object.

| Field | Type | Default | Rule |
|---|---|---|---|
| `tracker.type` | string | none | Required: `jira`, `github`, `file` or `custom`. |
| `tracker.module` | string | none | Required when `type` is `custom`: path of the adapter module, relative to the host root. |
| `tracker.envVars` | string[] | `[]` | `custom` only: names of the environment variables the module needs (checked by the preflight). |
| `tracker.baseUrl` | string | github: `https://api.github.com` | Jira: the instance URL, e.g. `https://tracker.example.com`; required by the Jira adapter (it throws when absent, validation does not check it). GitHub: set only for GitHub Enterprise Server (its API base URL). |
| `tracker.projects` | string[] | none | Required, at least one entry, for `jira` (project keys: `["PROJ"]`) and `github` (`owner/repo` list). Not used by `file` and `custom`. |
| `tracker.statuses` | object | `{}` | Not validated, see below. |

`tracker.statuses`:

| Field | Type | Meaning |
|---|---|---|
| `toTest` | string[] | Expected status when the skill runs; any other status gives a warning in the plan. |
| `doNotTest` | string[] | A ticket in one of these statuses stops the run (a single line, no plan). |
| `afterOk`, `afterKo` | string | Status the developer moves the ticket to; only echoed in the report ("what is left to the developer"), the plugin never moves a ticket. |
| `perProject` | object | `{ "<PROJECT>": { "afterOk": "...", ... } }` overrides per project. |

For GitHub, which only has `open` / `closed`, the statuses are **label names**: the issue's
status is the first label found in any configured status list, else `open` / `closed`.

## `environments`

Required object with at least one environment (`testing`, `demo`... the name is free).

| Field | Type | Default | Rule |
|---|---|---|---|
| `environments.<env>.branch` | string | none | Required: the branch deployed on this environment; the delivery check looks for the ticket on `origin/<branch>`. |
| `environments.<env>.channels` | object | none | Required, at least one channel (`front`, `bo`, `api`... free names). |
| `environments.<env>.channels.<ch>.url` | string | none | Required. |
| `environments.<env>.channels.<ch>.session` | string | none | Optional, for a UI channel. Must name an entry of `sessions`. |
| `environments.<env>.channels.<ch>.auth` | string | none | Optional, for an API channel. Must name an entry of `auth`. |

A channel with `session` is played in the browser; a channel with `auth` is called with
`api.mjs`. `api.mjs` picks the only channel of the environment that has an `auth`, or the one
given with `--channel`.

## `defaultEnvironment`

| Field | Type | Default | Rule |
|---|---|---|---|
| `defaultEnvironment.fallback` | string | first environment | Environment used when none is given. Not validated. |
| `defaultEnvironment.byProject` | object | `{}` | `{ "<PROJECT>": "<env>" }`. The project of a key is what precedes the `-` (Jira `PROJ-12` gives `PROJ`) or the `#` (GitHub `owner/repo#12` gives `owner/repo`). Not validated. |

## `delivery`

How the skill checks that a ticket has reached the environment's branch.

| Field | Type | Default | Rule |
|---|---|---|---|
| `delivery.mode` | string | `"both"` for `jira` and `github`, else `"none"` | `git-log`, `tracker`, `both` or `none`. |
| `delivery.recentMinutes` | number | `60` | A delivery newer than this is `recent` (warning: the deployment may not be live). Not validated. |
| `delivery.repositoriesDir` | string | `".."` | Folder holding the application clones, relative to the host root. The environment variable `FT_REPOS_DIR` overrides it. |
| `delivery.repositories` | object[] | none | Required, at least one, when `mode` is `git-log` or `both`. |
| `delivery.repositories[].name` | string | none | Required: the clone's folder name under `repositoriesDir`, or `"."` for the host repository itself. |
| `delivery.repositories[].channel` | string | none | Required: the channel the repository serves (any name; a ticket touching only a `mobile` repository is reported as not testable by this skill). |
| `delivery.repositories[].slug` | string | the `name`; for `"."` the host folder name | Optional, a non-empty string: the repository's name in the tracker's pull requests, when it differs from the folder name. |

Modes: `git-log` reads `git log origin/<branch>` of each repository (never `git fetch`: the
developer fetches); `tracker` uses the pull requests the tracker returns; `both` uses the
tracker for dates and links and git to confirm; `none` checks nothing. Delivery states:
`effective`, `recent` (warning), `absent` (the run ends `INCONCLUSIVE`), `unknown` (mode
`none`, a tracker that cannot know pull requests, or no readable ref: warning, the run
continues).

`"."` designates the host repository: it is always considered present, and its refs are read
as they are. The read-only rule (never fetch, never modify) applies to the other repositories.

## `browser`

| Field | Type | Default | Rule |
|---|---|---|---|
| `browser.driver` | string | `"playwright-mcp"` | `playwright-mcp`, `cypress-mcp`, `robotframework-mcp` or `custom`. |
| `browser.driverMapping` | string | none | Required when `driver` is `custom`: path of the mapping file (see [adapters](adapters.md)); the preflight checks that it exists. |
| `browser.engine` | string | `"chromium"` | Browser engine given to the server (`chromium`, `msedge`, `chrome`, `firefox`, `webkit`) when the driver supports it. Not validated. |
| `browser.viewport` | string | `"1440x900"` | `<width>x<height>`. Not validated. |

## `sessions`

Optional object: one entry per browser session name used by a channel's `session`. A session
maps to exactly one MCP server entry of `.mcp.json`, shared by every environment.

| Field | Type | Default | Rule |
|---|---|---|---|
| `sessions.<name>.mode` | string | `persistent-profile` with `playwright-mcp`, else `external` | `persistent-profile`, `storage-state` or `external`. |
| `sessions.<name>.mcpServer` | string | none | Required: name of the server in `.mcp.json`. The tools are `mcp__<mcpServer>__<tool>`. |
| `sessions.<name>.file` | string | none | Required for `storage-state`: the storage-state file, e.g. `.auth/bo.json`. |
| `sessions.<name>.command` | string | none | Required for `storage-state`: command that produces the file (split on spaces, run from the host root; it receives `FT_ENV` and `FT_<CHANNEL>_URL` variables, e.g. `FT_BO_URL`, and runs without `CI`). |

Session modes and what is checked:

| Mode | Meaning | Preflight | `session.mjs` (during a run) |
|---|---|---|---|
| `persistent-profile` | The Playwright MCP server keeps a profile folder `.auth/profiles/<session>`; you log in once in the opened browser. | The server is declared in `.mcp.json` and, with `playwright-mcp`, its `--user-data-dir` points to `.auth/profiles/<session>`. | Creates the folder. Login is checked by Claude: one navigation to the channel URL; on a login page it asks you to log in yourself. |
| `storage-state` | A Playwright `storageState` file produced by `command`. | The server is declared and its `--storage-state` points to `file`. | Validates the file (it names the channel's host as an origin or a cookie domain, host cookies not all expired, younger than 8 hours); when invalid, or with `--force`, runs `command` and validates again. |
| `external` | Authentication is managed by the server or the framework itself (the only mode of non-Playwright drivers). | The server is declared in `.mcp.json`. | Nothing to check; reports the server name. |

For every mode the preflight is `KO` when `.mcp.json` is missing or is not valid JSON, or when
the server of a session used by the environment is not declared. The server named by
`automation.testMcpServer`, when set, must be declared too.

## `auth`

Optional object: one entry per authentication referenced by a channel's `auth`. Used by
`api.mjs`; tokens are cached under `.auth/`.

| Field | Type | Default | Rule |
|---|---|---|---|
| `auth.<name>.preset` | string | none | Required: `password-login`, `static-token`, `none` or `custom`. |
| `auth.<name>.headers` | object | `{}` | Static request headers added to every call, whatever the preset. |
| `auth.<name>.optional` | boolean | `false` | When `true`, missing variables or a failed login are only a warning (the cases become not playable). |

`password-login` (POST JSON credentials to the channel URL + `loginPath`, token read from the answer):

| Field | Type | Default | Rule |
|---|---|---|---|
| `loginPath` | string | none | Required. |
| `usernameEnv`, `passwordEnv` | string | none | Required: **names** of the environment variables holding the login. |
| `usernameField`, `passwordField` | string | `"username"`, `"password"` | JSON field names of the request. |
| `tokenField` | string | `"access_token"` | Field of the answer holding the token. |
| `expiresField` | string | `"expires_in"` | Field of the answer holding the lifetime in seconds (300 s when absent). |

`static-token`:

| Field | Type | Default | Rule |
|---|---|---|---|
| `tokenEnv` | string | none | Required: name of the variable holding the token. |
| `scheme` | string | `"Bearer"` | Sent as `Authorization: <scheme> <token>`; `""` sends the raw token. |

`none`: no credential; only `headers` are sent. `custom`:

| Field | Type | Default | Rule |
|---|---|---|---|
| `module` | string | none | Path of the module, relative to the host root (see [adapters](adapters.md)). Not checked by the validation; the module is loaded when the auth is used. |
| `envVars` | string[] | `[]` | Names of the variables the module needs. |

## `testData`

| Field | Type | Default | Rule |
|---|---|---|---|
| `testData.prefix` | string | `"[E2E]"` | Put in the name of every record the skill creates. |
| `testData.emailDomains` | string[] | none | The only domains allowed in created e-mail addresses. Not validated. |

## `automation`

Used by `/functional-test:automation-candidates`.

| Field | Type | Default | Rule |
|---|---|---|---|
| `automation.framework` | string | `"playwright"` | `playwright`, `cypress`, `robotframework` or `other`. |
| `automation.specPaths` | string[] | `["tests/"]` (`playwright`, `robotframework`, `other`), `["cypress/e2e/"]` (`cypress`) | Where automated tests live: a spec citing the ticket key there means the ticket is covered. |
| `automation.branchPattern` | string | `"test/{key-lower}-{slug}"` | A branch matching it covers the ticket. Placeholders `{key}`, `{key-lower}`, `{slug}`. |
| `automation.excludedFile` | string | `".claude/functional-test/excluded.json"` | JSON array of `{ key, date, reason }`: tickets QA set aside. |
| `automation.howToWriteTests` | string | none | File the skill reads before writing a test (a `CLAUDE.md` or a guide), optionally naming agents. Not validated. |
| `automation.testMcpServer` | string | none | MCP server that runs a written spec (`playwright-test` for Playwright). When set, the preflight requires it in `.mcp.json`. |
| `automation.runCommand` | string | `npx playwright test {file}`, `npx cypress run --spec {file}`, `robot {file}`; none for `other` | Fallback when there is no test MCP server; `{file}` is the spec. The setup asks for it with `other`; the validation does not require it. |

## Environment variables

Names come from the configuration; values live in the host's `.env` (never printed). A
variable already set in the process environment wins over `.env`. The preflight reports
`KO` for a missing required variable, a warning for a missing optional one.

| Source | Variables |
|---|---|
| `tracker.type: jira` | `JIRA_EMAIL`, `JIRA_API_TOKEN` |
| `tracker.type: github` | `GITHUB_TOKEN` |
| `tracker.type: file` | none |
| `tracker.type: custom` | the names in `tracker.envVars` |
| `auth` `password-login` | `usernameEnv` and `passwordEnv` of the section |
| `auth` `static-token` | `tokenEnv` of the section |
| `auth` `none` or `custom` | the names in the section's `envVars` |
| `auth.<name>.optional: true` | the section's variables become optional (warning only) |
| `FT_REPOS_DIR` | optional: directory holding the application clones; overrides `delivery.repositoriesDir` |

Passed to a `storage-state` session command (do not set them yourself): `FT_ENV` (the
environment name) and `FT_<CHANNEL>_URL` per channel of the environment, the channel name
upper-cased with non-alphanumeric characters replaced by `_`.
