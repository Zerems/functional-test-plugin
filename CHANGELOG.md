# Changelog

## 0.1.0 — 2026-10-30

First release.

- `test-ticket` skill: preflight, ticket reading with acceptance criteria (struck-through
  criteria out of scope), delivery check, deterministic test plan with one validation pause,
  execution through API calls and an already-authenticated browser, verdict
  `OK` / `KO` / `INCONCLUSIVE`, tracker comment ready to paste with a machine-readable
  `[test-ticket:data]` line, replay after a fix.
- `automation-candidates` skill: lists the cases proposed for automation that no spec covers
  and QA has not excluded; writes the test in the configured framework or records an
  exclusion.
- `setup` skill: interview, then writes the host config, pitfalls skeleton, exclusions file,
  `.env.example` block, `.mcp.json` entries and `.gitignore` lines, and runs the preflight.
- Trackers: Jira, GitHub Issues, local Markdown file, custom module. Authentication:
  `password-login`, `static-token`, `none`, custom module.
- Delivery check from `git log`, tracker pull requests, or both; session modes
  `persistent-profile`, `storage-state` and `external`.
- Browser drivers: Playwright MCP (reference), Cypress MCP and Robot Framework MCP
  (community, unverified), custom mapping. Automation frameworks: Playwright, Cypress,
  Robot Framework notes, other.
- Output in English and French (`locales/`), no npm dependency (Node.js 20 or later).
- Documentation: README, configuration reference, adapters guide, acceptance check.
