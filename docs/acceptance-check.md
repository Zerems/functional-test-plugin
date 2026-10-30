# Acceptance check

This is the maintainer's checklist before a release. It verifies that the plugin reproduces
the behaviour of **the reference implementation**: the in-house skills `/test-ticket` and
`/a-automatiser` that the plugin was extracted from. The check runs on a throwaway host
folder; **the plugin is never installed in the reference repository, and that repository is
never modified** (it stays the read-only source of expected behaviour).

## Preparation

- [ ] Create an empty folder outside any repository (for example under the system temporary
  directory) and `git init` it. This is the throwaway host.
- [ ] Create `.claude/functional-test/` in it and copy `templates/config.example.json` there
  as `config.json`. The template is the reference configuration, anonymised: replace the
  placeholder tracker URL, environment URLs, project keys and variable names with the real
  ones used by the reference implementation, and set `"language"` to the language its
  output uses. Point `delivery.repositoriesDir` at the folder holding the existing local
  clones of the application repositories (read-only: the plugin never fetches or modifies
  them), and list the same repositories and channels as the reference setup.
- [ ] Copy the reference implementation's environment pitfalls file to the path of
  `pitfallsFile` (default `.claude/functional-test/pitfalls.md`).
- [ ] Create `.env` next to it, filled by you with the same accounts and tokens as the
  reference implementation uses (never pasted in a chat). Check that `.env` and `.auth/`
  are gitignored.
- [ ] Add the browser MCP server entries to `.mcp.json` as `/functional-test:setup` would
  (or run the setup in the throwaway host and then align `config.json` with the reference).
  Sessions use `persistent-profile`: no automation project is needed to log in.
- [ ] Install the plugin from the working tree under test (for example
  `claude plugin marketplace add <path to the plugin repository>`, then
  `claude plugin install functional-test@zerems-plugins`) in the **throwaway host only**.
- [ ] Reopen Claude Code in the throwaway host and accept the MCP servers.
- [ ] The preflight is `--- ready`: no `KO` line (warnings are explained).

## Checks

Pick a real ticket that was already tested with the reference implementation, with its
`[test-ticket]` comment on the tracker, and note the environment it was tested on.

- [ ] **Preflight.** Same checks as the reference (configuration, variables, repositories,
  MCP servers, tracker, one login per API channel) and the same conclusion.
- [ ] **Plan.** `/functional-test:test-ticket <key>` produces the same test plan as the
  reference implementation: same warnings (status, environment, delivery), same cases
  derived from the same acceptance criteria (struck-through criteria out of scope), same
  priorities; one pause for validation, and no other question except a possible browser
  login.
- [ ] **Execution and report.** Once the plan is validated, the cases run through the `api`
  script and the browser; the verdict (`OK`, `KO`, `INCONCLUSIVE`) and the case results
  equal the reference's, and a 5xx is a KO.
- [ ] **Comment.** The prepared tracker comment has the same content and structure as the
  reference's (header with the `[test-ticket]` marker, environment, date, verdict,
  delivery, cases, not played, data created, candidates, pitfall), in the configured
  language, plus the final `[test-ticket:data]` line. Compare it with
  `node ${CLAUDE_PLUGIN_ROOT}/scripts/comment.mjs diff <old.txt> <new.json>` when useful.
- [ ] **Secrets.** Nothing from `.env` appears in the chat, the plan, the report or the
  comment.
- [ ] **Replay.** Running `/functional-test:test-ticket <key>` again on the ticket detects
  the existing `[test-ticket]` comment of the environment (the reference's own, in its
  legacy format, and the plugin's), reuses its plan as is, and ends with a per-case diff
  of the results before and after. `node ${CLAUDE_PLUGIN_ROOT}/scripts/ticket.mjs <key>
  --env <env> --replay-text` prints that comment verbatim.
- [ ] **Automation candidates.** `/functional-test:automation-candidates` lists the same
  tickets as `/a-automatiser` of the reference implementation (compare with `--all` for the
  covered and excluded ones), with the same cases, minus what is covered or excluded.
- [ ] **Exclusion.** Excluding a ticket appends to the exclusions file and the ticket leaves
  the list.
- [ ] **Re-running the setup** on the throwaway host proposes the current values as defaults,
  keeps the existing pitfalls file, exclusions file and `.mcp.json` entries, and deletes
  nothing.

## Release

- [ ] `npm test` is green and `claude plugin validate .` passes.
- [ ] Every command and path quoted in the README exists.
- [ ] The reference repository has no change (`git status` there is clean, and the plugin is
  not installed in it).
- [ ] The throwaway host is deleted, including its `.env` and `.auth/`.
- [ ] `CHANGELOG.md` has the entry, the version of `plugin.json` and `marketplace.json`
  matches it, and the annotated tag `v<version>` is created on the release commit.
