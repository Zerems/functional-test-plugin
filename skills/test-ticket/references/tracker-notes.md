# Tracker notes

What the `ticket.mjs` dossier relies on, per tracker type (`config.tracker.type`), and the
limits to state in a plan or a report. **Read-only everywhere**: no skill of this plugin
writes to a tracker (comment, transition, label, field).

Always use `ticket.mjs` first; never call a tracker API by hand with the credentials, and
never print them. Credentials have fixed variable names, read from `.env` by the scripts:
`JIRA_EMAIL` + `JIRA_API_TOKEN` (Jira), `GITHUB_TOKEN` (GitHub).

## Jira

- **Keys**: `PROJ-123`, or a `…/browse/PROJ-123` URL. `tracker.projects` lists the
  project keys; `defaultEnvironment.byProject` and `statuses.perProject` use them.
- **Statuses**: workflow statuses, matched by name against `tracker.statuses` (`toTest`,
  `doNotTest`, `afterOk`, `afterKo`, `perProject.<PROJECT>` overrides). A status in
  `doNotTest` stops the skill; a status outside `toTest` is a warning.
- **Bodies**: the issue is read with `expand=renderedFields`, so description and comments
  are rendered HTML (the raw fields are Atlassian Document Format). Struck criteria
  (`<del>`, `<s>`) stay visible as `~~…~~` and are out of scope. A comment pasted as plain
  text comes back as one `<p>` per line; the parser ignores blank lines.
- **Linked pull requests**: from the dev-status API (`bitbucket`, `GitHub` and `stash`
  application types). Jira links a PR as soon as its branch or a commit cites the key, so
  promotion PRs between environment branches also appear; the host repository's own PRs
  are excluded.
- **Pitfalls**: a migrated key answers with the new key (read `key` in the dossier, not the
  input); a 404/410 on an endpoint is first an obsolete API variant, not an access issue.

## GitHub Issues

- **Keys**: `owner/repo#12`, an `…/owner/repo/issues/12` URL, or `#12` when
  `tracker.projects` lists a single repository. `tracker.baseUrl` defaults to
  `https://api.github.com` (GitHub Enterprise: its API URL).
- **Statuses are labels**: an issue only has `open` / `closed`; its reported status is the
  first label found in any `tracker.statuses` list, else `open` or `closed`. A `closed`
  issue gives the same "unexpected status" warning as a status outside `toTest`.
  "Move the ticket" therefore means "set the `afterOk` / `afterKo` label". GitHub Projects
  columns are not read.
- **Bodies**: Markdown; struck criteria are `~~…~~`.
- **Linked pull requests**: from the issue timeline (`cross-referenced` and `connected`
  events), each PR read for its branches and merge date.
- **Search limits** (replay reads the ticket directly; only `automation-candidates`
  searches): the comment search API is rate-limited, its index may lag behind recent
  comments, and results are capped; the scripts say when a search was truncated. Relay that
  warning as is.

## File mode

The input is the path of an existing Markdown file (or `tracker.type: file`).

- Title = the first `#` heading; criteria = the list items; key = the file name.
- No status (no status warning, no `doNotTest` stop), no comments, no pull requests: the
  delivery comes from `git log` only, or is `unknown`.
- **No replay** (there is no previous `[test-ticket]` comment to read) and **no automation
  candidates listing** (nothing to search). The comment is still produced, for the record;
  there is no ticket to move.
