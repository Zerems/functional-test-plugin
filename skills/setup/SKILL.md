---
name: setup
description: Configures the functional-test plugin for the current project through a short interview, then writes the host files (config, pitfalls skeleton, exclusions, .env.example block, .mcp.json entries, .gitignore lines) and runs the preflight. Use when someone asks to "configure functional-test for this project", "/functional-test:setup", "set up the plugin", "install the test-ticket skill here", or when a preflight points here. Re-runnable: current values become the defaults. Never asks for a secret value, never writes .env.
---

# Set up functional-test in a host project

Input: the user's answers. Output: the host files written by `setup-write.mjs`, the
preflight result, and the list of what is left to the user (variables to fill, MCP servers
to enable). `<scratchpad>` is the session's scratchpad directory.

## Rules

- **Never ask for a secret value** in the chat (token, password, API key): the config only
  names environment variables; the user fills `.env` themselves. A secret pasted in the
  chat is never repeated; tell the user to put it in `.env` and to consider rotating it.
- **Never read or write `.env`, `.auth/**` or `.mcp.json`**; never print a secret.
  `setup-write.mjs` merges `.mcp.json` itself.
- **Never overwrite host content**: only `setup-write.mjs` writes, and it keeps an existing
  pitfalls file, exclusions file and `.mcp.json` entries; it never deletes anything.
- Defaults are shown with every question; an empty answer takes the default.

## 0. Detect

The host root is the nearest ancestor of the current directory (itself included) that holds
`.claude/functional-test/config.json`. Found → read that config (it is not secret) and
propose its values as the defaults of every question below; if that folder is not the
project the user means, stop and say so. Not found → the current directory becomes the
host root.

First ask the **interview language** (`en` or `fr`) and conduct the rest of the interview
in it.

Ask with `AskUserQuestion` when available (one call per numbered step, its sub-fields as
separate questions), otherwise as plain questions. Skip what earlier answers made
irrelevant: no UI channel → no browser sessions; no API channel → no API authentication;
`tracker: file` → no projects, statuses or credentials.

## 1. Output language

`language`: `en` | `fr` (default: the interview language). Plans, reports and tracker
comments are written in it.

## 2. Tracker

- `tracker.type`: `jira` | `github` | `file` (local Markdown tickets, no comments to read) |
  `custom` (`tracker.module`: path of an adapter module, `tracker.envVars`: the names of
  the variables it needs).
- `baseUrl`: required for `jira` (e.g. `https://<site>.atlassian.net`); `github` defaults to
  `https://api.github.com` (another URL for GitHub Enterprise).
- `projects`: at least one — Jira project keys (`PROJ`), or GitHub `owner/repo`.
- `statuses` (on GitHub these are **label names**): `toTest` (list; another status gives a
  warning), `doNotTest` (list; the run stops), `afterOk`, `afterKo` (only echoed to the
  developer), optional `perProject.<project>` overrides.
- Credentials have fixed names, written to `.env.example`: `JIRA_EMAIL` and
  `JIRA_API_TOKEN` for Jira, `GITHUB_TOKEN` for GitHub. Say so; never ask their values.

## 3. Environments

For each environment: a name (`staging`, `testing`…), the deployed `branch`, and its
channels `{ <channel>: { url, session?, auth? } }` (e.g. `front`, `bo` for UIs, `api`).
A UI channel gets a `session` name (step 5), an API channel an `auth` name (step 6);
channels sharing a session or an auth reuse the same name across environments.
Then `defaultEnvironment`: `fallback` (default: the first environment) and optional
`byProject: { <project>: <environment> }`.

## 4. Delivery

- `delivery.mode`: `git-log` (commits citing the key on the environment's branch) |
  `tracker` (pull requests linked in the tracker) | `both` (default for Jira and GitHub) |
  `none` (default otherwise).
- `git-log` and `both`: `repositoriesDir` (where application repositories are cloned,
  relative to the host root, default `..`; `FT_REPOS_DIR` overrides it) and at least one
  repository `{ name, channel, slug? }` — `name` is the folder, `"."` for the host itself;
  `channel` the channel it serves; `slug` its name in the tracker when it differs.
- `recentMinutes`: default `60` (a delivery younger than this may not be deployed yet).

## 5. Browser driver and sessions

Only when a channel declares a `session`.

- `browser.driver`: `playwright-mcp` (default, reference) | `cypress-mcp` |
  `robotframework-mcp` (community servers, unverified) | `custom` (`browser.driverMapping`:
  path to a mapping file copied from
  `${CLAUDE_PLUGIN_ROOT}/skills/test-ticket/references/browser-drivers/template.md`).
- `browser.engine`: `chromium` (default) | `msedge` | `chrome` | `firefox` | `webkit`;
  `browser.viewport`: default `1440x900`.
- For each session name: `mode` and `mcpServer` (default `playwright` for the first
  session, `playwright-<session>` for the others).
  - `persistent-profile` (default for Playwright): a browser profile under
    `.auth/profiles/<session>/`; the human logs in once in it.
  - `storage-state` (Playwright only): `file` (e.g. `.auth/<session>.json`) and the
    `command` that produces it (e.g. a Playwright setup project).
  - `external` (the only mode for the other drivers): the server manages the login.

## 6. API authentication

Only when a channel declares an `auth`. For each auth name, a `preset`:

- `password-login`: `loginPath` (POST, JSON body), `usernameEnv`, `passwordEnv` (variable
  **names**, e.g. `API_USERNAME`); optional `usernameField` / `passwordField` (default
  `username` / `password`), `tokenField` (default `access_token`), `expiresField` (default
  `expires_in`).
- `static-token`: `tokenEnv`; optional `scheme` (default `Bearer`, `""` for the raw token).
- `none`.
- `custom`: `module` (adapter path) and `envVars` (names).

Optional for all: `headers` (static request headers) and `optional: true` (missing
variables only make the cases not playable).

## 7. Test data

`testData.prefix` (default `[E2E]`): put in the name of every record the skill creates.
`testData.emailDomains`: the only domains allowed in created e-mail addresses (e.g. a
test domain or a disposable-mail service).

## 8. Automation

- `automation.framework`: `playwright` (default) | `cypress` | `robotframework` | `other`.
- `specPaths`: where automated tests live (default `tests/`, `cypress/e2e/` for Cypress).
- `branchPattern`: default `test/{key-lower}-{slug}` (`{key}`, `{key-lower}`, `{slug}`).
- `excludedFile`: default `.claude/functional-test/excluded.json`.
- `howToWriteTests`: the file to read before writing a test (e.g. `CLAUDE.md` or a guide),
  optionally the agents to use.
- `testMcpServer`: optional MCP server that runs a spec (`playwright-test` for Playwright,
  written by setup; other frameworks: a server the user adds to `.mcp.json` themselves).
- `runCommand`: fallback with `{file}` (defaults `npx playwright test {file}`,
  `npx cypress run --spec {file}`, `robot {file}`; required for `other`).

## 9. Write

Write `<scratchpad>/answers.json` in the shape of
`${CLAUDE_PLUGIN_ROOT}/templates/config.example.json`, starting with `"version": 1`, with
only what was answered (the script fills the defaults). Then, from the host root:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/setup-write.mjs <scratchpad>/answers.json
```

Exit 2: the validation errors are printed as `<json.path>: <message>`; fix the answers
(ask again only what is wrong), rerun. Exit 1: files written, preflight blocked (expected
while `.env` is not filled). Exit 0: files written, preflight `--- ready`.

## 10. Report

In `config.language`:

1. The written and skipped files, as printed.
2. The variables to fill in `.env` (never committed): their **names** only, from the block
   between `# >>> functional-test` and `# <<< functional-test` of `.env.example`.
3. Community driver (`cypress-mcp`, `robotframework-mcp`): the install command of
   `${CLAUDE_PLUGIN_ROOT}/templates/mcp/<driver>.json` (`npx -y cypress-mcp`,
   `uvx robotframework-mcp`), the warning that the server is unverified, and that its
   tool names must be filled in a `custom` mapping (see its mapping file) before use.
   `custom` driver or a non-Playwright `testMcpServer`: the user adds those servers to
   `.mcp.json` themselves.
4. Activate the MCP servers: reopen Claude Code at the host root and accept the servers of
   `.mcp.json` (`/mcp`). On a re-run, an existing entry is never replaced: if a session
   changed mode or path, the user edits that entry themselves (the preflight shows it).
5. The preflight KO and warning lines as printed, and how to rerun it once `.env` is filled:
   `node ${CLAUDE_PLUGIN_ROOT}/scripts/preflight.mjs --env <defaultEnvironment.fallback>`.
6. Suggested host `.claude/settings.json` permissions (documented, not written):
   `"deny": ["Read(.env)", "Edit(.env)", "Read(.auth/**)", "Edit(.auth/**)", "Read(.mcp.json)", "Edit(.mcp.json)"]`
   and `"allow": ["Bash(node <plugin root>/scripts/*)"]`, `<plugin root>` being the value
   of `${CLAUDE_PLUGIN_ROOT}`.
