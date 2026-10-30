---
name: test-ticket
description: Functionally tests a delivered ticket (Jira issue, GitHub issue or local Markdown file) on a configured environment and returns an argued OK / KO / INCONCLUSIVE verdict with a tracker comment ready to paste. Use whenever someone asks to test, verify, validate or replay a ticket - "test KEY", "/test-ticket KEY env", "replay the ticket", "verify KEY on staging", "the ticket is in Test" - even without the word "test". Never writes to the tracker, never moves the ticket, never writes automated tests (QA arbitrates them with automation-candidates).
---

# Test a ticket on an environment

Input: a ticket (key, tracker URL or path to a Markdown file), an optional environment,
free-form constraints (accounts to use, conditions to add). Output: a verdict in the chat
and a tracker comment in a separate block. The developer pastes the comment and moves the
ticket themselves.

All commands run from the host project root (the folder holding
`.claude/functional-test/config.json`, called "the config" below; it is not secret, read it).
`<scratchpad>` is the session's scratchpad directory. References, relative to this file:
`references/test-design-rules.md` (plan), `references/report-templates.md` (report and
comment), `references/tracker-notes.md` (tracker specifics), `references/browser-drivers/`
(browser tools).

## Rules

- **No secret** in the chat or in a proof: scripts load `.env` themselves; never read
  `.env`, `.auth/**` or `.mcp.json`, never print a token. An account other than the
  configured ones goes through a credentials file in the scratchpad
  (`api.mjs --credentials <file>`), never through a plain argument.
- **A 5xx is a KO**, whatever the case. An expected 4xx is a result.
- **Uncertainty gives INCONCLUSIVE, never OK**: delivery not effective, environment down,
  no P1 playable, proof impossible.
- Test data: created through the API when possible, named `<testData.prefix> <KEY> …`,
  e-mail addresses only in `testData.emailDomains`, listed in the report, never deleted.
- Application repositories: read-only, never `git fetch`, never a modification.
- **One mandatory pause: the plan validation.** Everything else runs on; the developer can
  interrupt at any time. A login request (step 1) is the only other interruption.
- Commands that may open a browser (`session.mjs`) run **outside the sandbox**.
- Write everything the user reads (plan, questions, report) in `config.language`; the
  scripts already localise their output. Case ids `T1…`, priorities `P1…P3` and the codes
  `OK | KO | INCONCLUSIVE | UNSTABLE` stay canonical.

## 1. Preflight

Target environment: the one the user named; otherwise
`defaultEnvironment.byProject[<project of the key>]`, else `defaultEnvironment.fallback`.

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/preflight.mjs --env <env>
```

Labels are localised; rely on the exit code. Exit 0 (ready): go on silently. Exit 1
(blocked): stop, quote the KO lines as they are and point to `/functional-test:setup`.
Exit 2: no host project here, or unknown environment. Warning lines (optional variables
missing) become "not playable" cases in the plan.

**Driver check.** Read the mapping of `browser.driver`
(`references/browser-drivers/<driver>.md`, or the host file `browser.driverMapping` for
`custom`). For each `mcpServer` of the sessions used by the environment's channels, verify
that the mapped tools exist in this session (tool list, or `ToolSearch`). Missing → **stop
before the plan**: Claude Code was opened elsewhere than the host root, or the servers of
`.mcp.json` were not enabled. Ask the user to reopen the session at the host root and
enable those servers (`/mcp`); never drive a browser any other way. A channel whose
actions the mapping lacks is "not playable", not a failure. Skip this check and the
next one when no channel of the environment declares a `session`.

**Login check** (sessions in `persistent-profile` or `external` mode used by the
environment's channels):

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/session.mjs --env <env> --session <session>
```

It prints `{ state, mode, mcpServer, host, profileDir?, … }`. Then one "open URL" on the
channel URL with that server's tools. A login page (per the mapping's detection rule) →
stop, ask the human to log in **themselves** in the opened browser, then open the URL
again and go on. Never type credentials. `storage-state` sessions are checked in step 4.

## 2. Ticket and delivery

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/ticket.mjs <key|url|path> [--env <env>]
```

Input: a key (`PROJ-123`, `owner/repo#12`), a tracker URL, or the path of an existing
Markdown file (file mode: no tracker, no replay). Exit 2: ticket not found or usage; 3:
secrets missing (name the variables to fill, never their values); 4: tracker unreachable.
The header says which environment was used; if it differs from the preflighted one, rerun
step 1 for it.

Read in order:

- **Warnings**: copy them word for word into the plan. A "do not test" status → **stop
  without a plan**, explain why, end.
- **Acceptance criteria**: only the non-struck ones are in scope. None detected → ask the
  developer what is expected (the only question allowed before the plan).
- **Comments**: a clarification later than the description prevails; say so.
- **Delivery on `<env>`**:
  - `absent` → **INCONCLUSIVE** at once: minimal report ("nothing delivered to
    `<branch>`"), comment, end. Unless the developer designated a PR or commit.
  - `recent` → warning in the plan: the deployment may not be live. For a UI channel,
    download the page served at the channel URL and the script bundle it references into
    the scratchpad and search for a marker string of the change (label, route); absent →
    "deployment not effective" (INCONCLUSIVE, propose a replay), not KO.
  - `effective` → nothing to report.
  - `unknown` → warning "delivery not verified"; the run goes on, and this alone never
    makes the verdict INCONCLUSIVE.
- **Technical scope**: the channels to plan for. Only channels the environment does not
  declare (e.g. `mobile`) → INCONCLUSIVE, reason "not testable by this skill".
- **Partial delivery / stale refs**: check in the repository
  (`git -C <repo> log --oneline origin/<branch> | grep -i <KEY>`; repositories live under
  `delivery.repositoriesDir`, overridden by `FT_REPOS_DIR`; `"."` is the host). Fix
  absent → that part is not delivered: say so and never attribute a KO to it. Stale refs →
  say so; fetching is the developer's job.
- **Replay**: a previous `[test-ticket]` report exists for this env → reuse its plan as is
  (same ids, titles, previous constraints and not-played cases recalled), add only the new
  cases the developer asks for, and keep the raw text for the final diff:
  `node ${CLAUDE_PLUGIN_ROOT}/scripts/ticket.mjs <key> --env <env> --replay-text > <scratchpad>/old.txt`.

**Code of the change.** To understand what is delivered (code / ticket divergence, cause
of a KO, `file:line`): `git -C <repo> show origin/<branch>:<path>` and the commits citing
the key (`git log` then `git show`). The code is the authority on what is delivered, the
ticket on the intent; a divergence is reported, never settled silently.

## 3. Test plan (mandatory pause)

Apply rules 1 to 8 of `references/test-design-rules.md` **in order**: one nominal case per
criterion (P1); equivalence partitions, boundary values, state transitions, decision
tables, error cases (P2); adjacent non-regression (P3); environment pitfalls from
`config.pitfallsFile` (if present) as precautions attached to cases. Channels are the
environment's channels; accounts are the configured `auth` names or a credentials file.

Present, in this order (headings in `config.language`):

```markdown
## Test plan — <KEY> · <env> · <title>
**Understanding**: <2-3 sentences: what the ticket delivers, screens and routes involved, PR>
**Delivery**: <effective | recent (N min ago) | unknown> · **Status**: <status>
**Warnings**: <list, or "none">

| Id | P | Channel | Account | Title | Expected | Source |
|---|---|---|---|---|---|---|
| T1 | P1 | <channel> | <account> | … | … | AC 1, rule 1 |

**Not playable**: <id — reason> or "none"
**Precautions**: <pitfall → cases concerned>
**Developer constraints**: <their instructions, or "none">
```

Then ask **the question** and **end the turn**:

> Shall I run it? You can add conditions, remove cases or impose an account.

(`AskUserQuestion` with "Run" / "Change first" when available; otherwise the plain
question.) **Nothing runs before the answer.** The developer's additions go into
"Developer constraints" (plan, report, comment). Volume: every P1 and P2 is played; P3
only if the plan stays under about fifteen cases, otherwise listed "not played, to
arbitrate".

## 4. Execution

**Browser sessions.** Before the first case of a channel whose session is in
`storage-state` mode:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/session.mjs --env <env> --session <session>
```

Outside the sandbox (its setup command may open a browser). Expect `"state":"valid"`;
exit 1 (`"invalid"`, with `reason`) → the channel's cases are not playable. After
`"setupRan":true`, run the driver's "close" action before the next navigation so the
browser reloads the state. Redirected to a login page mid-run: `storage-state` → rerun
with `--force`, "close", resume the case; `persistent-profile` / `external` → ask the
human to log in, as in step 1.

**UI channels**: the abstract actions (open URL, read page, click, type, press key,
screenshot, close) through the tools the driver mapping names, on the server `session.mjs`
reported. Observe what the user sees: texts, buttons present or absent, messages.

**API channels**:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/api.mjs --env <env> [--channel <name>] [--auth <name>] [--header K=V]... [--credentials <file.json>] <METHOD> </path> [--body '<json>' | --body @<file>]
```

`--channel` is needed only when several channels declare an `auth`. `--header` carries
the context headers the API needs (tenant, scope: see the pitfalls file). Prints
`<status> <METHOD> <path> (<ms> ms)` and the masked body. Exit **5 = 5xx = KO**; 0 = an
answer (a 4xx is a result); 1 = authentication failed; 3 = secrets missing (case not
playable); 4 = network error. A case needing an account that does not exist: create a
dedicated prefixed test account through the API, with a generated throwaway password
written to `<scratchpad>/<name>.json` as `{ "username", "password" }`, then
`--credentials` it. An account imposed by the developer: they write the credentials file
themselves, never in the chat.

**Eventual consistency**: after a write, re-read for up to 30 s before concluding (10
reads 3 s apart in one shell loop). A failure not reproduced on a second try → `UNSTABLE`,
not KO.

**Proofs**: for each case, note what was observed (HTTP status and excerpt, on-screen
text, created id); for a KO, a screenshot in the scratchpad. Never a token, a password or
a session.

**Early stop**: environment unreachable, authentication endpoint in 5xx, session
impossible → INCONCLUSIVE with the reason; do not insist.

## 5. Verdict and report

Rules, in this order:

1. **INCONCLUSIVE**: delivery not effective, environment unavailable, no P1 case played,
   or an exit criterion of `test-design-rules.md` missing.
2. **KO**: at least one P1 or P2 case failing because of the delivered code, or any 5xx.
3. **OK**: every P1 and P2 played passes, no 5xx. Not playable, not played and unstable
   cases do not block an OK but are **always** listed.

Before calling a KO, check the pitfalls file and the delivery (old code still served,
environment data, external dependency, known anomaly). A KO that comes from one of them
becomes INCONCLUSIVE, or cites the known anomaly.

Write `<scratchpad>/report.json`:

```json
{ "v": 1, "env": "<env>", "date": "YYYY-MM-DD HH:MM", "verdict": "OK|KO|INCONCLUSIVE",
  "delivery": "<what was delivered, where, when>", "constraints": "<or empty>",
  "cases": [{ "id": "T1", "priority": "P1", "title": "<one line>", "result": "OK|KO|UNSTABLE", "detail": "expected: … / got: …" }],
  "notPlayed": "<ids and reasons, or empty>", "data": "<created data, or empty>",
  "candidates": ["T1"], "pitfall": "<optional>", "reason": "<INCONCLUSIVE only>" }
```

**The cause must be readable in the first lines**: every `KO` case carries `detail` as
`expected: … / got: …` (the script lifts it under the verdict); an INCONCLUSIVE report
carries `reason`. `delivery` is always filled ("nothing delivered to `<branch>`" when
absent); `constraints`, `notPlayed` and `data` may be empty (printed as the localised
"none"). Then:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/comment.mjs format <scratchpad>/report.json
node ${CLAUDE_PLUGIN_ROOT}/scripts/comment.mjs diff <scratchpad>/old.txt <scratchpad>/report.json   # replay only
```

Report as `references/report-templates.md` says: the chat report (one-sentence verdict,
case table, KO details with steps / expected / got / cause hypothesis and `file:line`,
data created, limits, **automation candidates** for QA with the `automation.framework`
and the spec area of `automation.specPaths` they would fit, pitfall discovered), then the
comment in a code block exactly as the script printed it, then what is left to the
developer:

1. Paste the comment into the ticket.
2. Move the ticket to `tracker.statuses.afterOk` or `afterKo`
   (`statuses.perProject.<project>` overrides them; on GitHub these are labels).
   INCONCLUSIVE: do not move it, replay later. File mode: nothing to move.

## 6. Pitfall discovered

An environment behaviour that almost distorted the verdict (not a defect of the ticket)
goes into the report under "Pitfall discovered" (symptom, cause, precaution) and in one
line in the comment (`pitfall`). **Never edit `config.pitfallsFile`**: the team integrates
it.
