# functional-test

A Claude Code plugin that functionally tests a delivered ticket and tells you whether it
works. Give it a ticket (a Jira issue, a GitHub issue or a local Markdown file) and an
environment: it reads the acceptance criteria, checks that the work has reached the
environment's branch, derives a test plan with eight fixed design rules, **pauses once so
you can validate the plan**, runs the cases through API calls and an already-authenticated
browser, and returns an argued verdict (`OK`, `KO` or `INCONCLUSIVE`) with a tracker comment
ready to paste. A second command, `/functional-test:automation-candidates`, lists the cases
those comments proposed for automation that no spec covers yet, so QA can decide what to
automate. The plugin never writes to the tracker, never moves a ticket and bundles no
npm dependency (Node.js only).

## Ten-minute quickstart

1. Add the marketplace and install the plugin:

   ```
   claude plugin marketplace add Zerems/functional-test-plugin
   claude plugin install functional-test@zerems-plugins
   ```

2. Open Claude Code in your project (the "host project") and run the interview:

   ```
   /functional-test:setup
   ```

   It asks a few questions (language, tracker, environments, delivery repositories, browser
   driver, API authentication, automation framework), writes
   `.claude/functional-test/config.json`, a pitfalls skeleton, an empty exclusions file, a
   documented block in `.env.example`, the `.mcp.json` entries and the `.gitignore` lines,
   then runs the preflight. It never asks for a secret and never writes `.env`.

3. Create `.env` yourself (copy the block from `.env.example`) and fill in the variables the
   setup listed: tracker credentials, API logins. Reopen Claude Code at the project root and
   accept the new MCP servers of `.mcp.json` (`/mcp`). Ask Claude to re-run the preflight when you
   are done, or simply start step 4, which runs it first.

4. Test a ticket:

   ```
   /functional-test:test-ticket <key>
   ```

   The key can be a tracker key (`PROJ-123`, `owner/repo#12`), a tracker URL, or the path to a
   Markdown file. An environment can follow (`/functional-test:test-ticket PROJ-123 demo`).
   The command is also reachable as `/test-ticket` when no other skill uses that name.
   For a persistent-profile browser session, the first run may ask you to log in yourself in
   the opened browser.

5. QA: `/functional-test:automation-candidates` (also `/automation-candidates` when
   unambiguous).

## What you need

- Node.js 20 or later.
- A tracker token (Jira e-mail and API token, or a GitHub token), **or** a Markdown file
  describing the ticket (the `file` tracker needs no credentials).
- A Playwright MCP server for the UI channels (the setup writes the `.mcp.json` entry). Cypress
  and Robot Framework MCP servers are available as unverified community mappings (the setup
  prints their install command, you add and pin the entry yourself); custom drivers are
  supported, see below.
- For the delivery check, local clones of the application repositories (read-only; the plugin
  never runs `git fetch`), or `delivery.mode: "none"`.

## What is supported

Status: **reference** = implemented and tested; **community** = relies on a third-party
server whose tools were not verified; **notes** = guidance only; **planned** = not available.

| Area | Option | Status |
|---|---|---|
| Tracker | Jira (REST v3, dev-status for pull requests) | reference |
| Tracker | GitHub Issues (github.com or Enterprise Server) | reference |
| Tracker | Local Markdown file | reference |
| Tracker | Custom module (your own adapter) | reference (see [adapters](docs/adapters.md)) |
| Tracker | GitLab, Linear | planned |
| Browser driver | Playwright MCP | reference |
| Browser driver | Cypress MCP | community, unverified (no `.mcp.json` entry written) |
| Browser driver | Robot Framework MCP | community, unverified (no `.mcp.json` entry written) |
| Browser driver | Custom mapping | supported (see [adapters](docs/adapters.md)) |
| Automation framework | Playwright | reference |
| Automation framework | Cypress, Robot Framework | notes |
| Automation framework | Other | via `automation.howToWriteTests` |

## Security

- Secrets live only in `.env`. The config names environment variables (`usernameEnv`,
  `tokenEnv`...), never values. Scripts load `.env` themselves and mask every secret in what
  they print; no error carries a token.
- Claude never reads `.env`, `.auth/**` or `.mcp.json`, and never types a credential in a
  browser: you log in yourself when a session has expired.
- `.auth/` (token caches, browser profiles, screenshots) and `.env` must be gitignored; the
  setup adds the lines and the preflight warns when they are missing.
- The plugin never writes to the tracker: you paste the comment and move the ticket.
- Application repositories are read-only: no `git fetch`, no modification. Test data is
  prefixed (`testData.prefix`), listed in the report and never deleted.
- A 5xx answer is always a KO; uncertainty gives `INCONCLUSIVE`, never `OK`.

Suggested `settings.json` block for the host project (`.claude/settings.json`), documented
but not enforced by the plugin:

```json
{
  "permissions": {
    "deny": [
      "Read(./.env)",
      "Read(./.auth/**)",
      "Read(./.mcp.json)",
      "Edit(./.env)",
      "Edit(./.auth/**)"
    ],
    "allow": [
      "Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/*)"
    ]
  }
}
```

## Languages

Everything a person reads (plan, report, preflight lines, tracker comment) follows
`language` in the config. `en` and `fr` are shipped; a missing key falls back to `en`. To add
a language, copy `locales/en.json` to `locales/<lang>.json` (two or three lowercase letters),
translate the values and set `"language": "<lang>"`. The `[test-ticket]` and
`[test-ticket:data]` markers, the verdict codes (`OK`, `KO`, `INCONCLUSIVE`), the case results
and the priorities (`P1`-`P3`) are never translated.

## Documentation

- [Configuration reference](docs/config-reference.md): every field, default and rule.
- [Adapters guide](docs/adapters.md): custom tracker, custom authentication, browser driver
  mapping, adding a built-in adapter.
- [Acceptance check](docs/acceptance-check.md): how the maintainer checks a release against
  the reference implementation.

## Licence

MIT, see [LICENSE](LICENSE).
