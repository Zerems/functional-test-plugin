---
name: automation-candidates
description: Lists, for QA to arbitrate, the cases test-ticket proposed for automation in its [test-ticket] tracker comments that no spec covers yet and QA has not excluded, then writes the automated test or records a reasoned exclusion. Use when someone asks "what's left to automate", "automation candidates", "/automation-candidates", "the devs' proposals", or before a regression campaign to decide what to cover. Read-only on the tracker; it never decides for QA.
---

# Automation candidates

Every `test-ticket` run that judges a case worth an automated test lists it in the
tracker comment it prepares ("automation candidates"). This skill gathers them so QA
decides; it never decides in QA's place.

All commands run from the host project root (the folder holding
`.claude/functional-test/config.json`, called "the config" below; it is not secret, read it).
Framework notes and driver mappings live in the `test-ticket` skill:
`${CLAUDE_PLUGIN_ROOT}/skills/test-ticket/references/frameworks/` and
`${CLAUDE_PLUGIN_ROOT}/skills/test-ticket/references/browser-drivers/`.

## Rules

- **Never write to the tracker**: the comment stays the developer's. No status change,
  no comment, no label.
- Application repositories: read-only, never `git fetch`, never a modification. Tests are
  written in the host project only; in a single-repository setup the host repository
  (`"."`) is the only writable one: the branch and the spec go there, the other configured
  repositories stay read-only.
- **No secret** in the chat: never read `.env`, `.auth/**` or `.mcp.json`, never print a
  token. **Never type a credential in a browser**: an account that is not logged in → ask
  the human to log in in that session.
- Commands that may open a browser (`session.mjs`, a test run) run **outside the sandbox**.
- Write everything the user reads in `config.language`; the scripts already localise
  their output. Case ids `T1…` and priorities `P1…P3` stay canonical.
- Commit only when the user asks.

## 1. List

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/candidates.mjs          # to arbitrate
node ${CLAUDE_PLUGIN_ROOT}/scripts/candidates.mjs --all    # + covered, excluded, without candidate
```

A ticket is **covered** when a tracked file under `automation.specPaths` cites its key
(`git grep -w`) or a local or remote branch matches `automation.branchPattern`;
**excluded** when it is in `automation.excludedFile`. The rest is to arbitrate.

Present the output **as it is printed** (key, status, environment, comment date, title,
proposed cases), newest first. Never reformulate, merge or re-prioritise the cases.
Relay the truncation warning word for word when the script prints it: the list may be
incomplete.

Exit 0: list printed (possibly "no pending candidate"). Exit 2: no host project, invalid
config, or **`tracker.type: file`**: candidates are read from tracker comments, so they
are unavailable without a tracker; say so and stop. Exit 3:
secrets missing (name the variables to fill in `.env`, never their values). Exit 4: tracker
unreachable.

## 2. Arbitrate

Three answers from QA, handled as they are:

### "automate T2 and T3 of KEY"

1. Read the ticket and its latest comment:
   `node ${CLAUDE_PLUGIN_ROOT}/scripts/ticket.mjs KEY`. The cases to automate are the ones
   QA named, with the expected results of the comment.
2. Create the branch from the host's default branch, named after
   `automation.branchPattern` (`{key}` → the key, `{key-lower}` → the key in lower case,
   `{slug}` → a short kebab-case summary of the cases). The branch alone already makes the
   ticket "covered" on the next listing.
3. Read **`automation.howToWriteTests` first** (the host's guide, agents and conventions
   win over everything else), then the framework notes
   `${CLAUDE_PLUGIN_ROOT}/skills/test-ticket/references/frameworks/<automation.framework>.md`.
   `framework: other` → follow `howToWriteTests` only and say that no framework notes exist.
4. Target environment, for the exploration and the run: the one QA names, else
   `defaultEnvironment.fallback`, else the first environment of the config.
   Explore the behaviour on it with the browser driver, exactly as `test-ticket` does: the
   mapping of `browser.driver` (`references/browser-drivers/<driver>.md`, or the host file
   `browser.driverMapping` for `custom`), the session of the channel
   (`node ${CLAUDE_PLUGIN_ROOT}/scripts/session.mjs --env <env> --session <session>`, then
   the tools `mcp__<mcpServer>__…` it reports), login page → the human logs in.
5. Write the spec under `automation.specPaths`. **Its title cites the ticket key** (and
   each test the case id): that is what coverage detection finds once the file is
   committed. Test data: `testData.prefix` and the key in every name it creates.
6. Run it until green: through the test MCP server `automation.testMcpServer` when
   declared (its tools are `mcp__<testMcpServer>__…`), else `automation.runCommand` with
   `{file}` replaced by the spec path. A failure is diagnosed before any change: a test
   adapted to hide a defect (a 5xx, a wrong behaviour) is never acceptable; report the
   defect instead.
7. Show the diff; commit on request.

### "exclude KEY: reason"

Append `{ "key": "KEY", "date": "YYYY-MM-DD", "reason": "<reason>" }` (today's date, QA's
reason in their words) to `automation.excludedFile`; create the file with `[]` if absent.
Show the diff; commit on request.

### "later"

Do nothing: the ticket comes back on the next listing.
