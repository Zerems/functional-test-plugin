# Driver mapping: `cypress-mcp`

> **Status: community server, unverified on 2026-10-30 — verify the tool names before
> relying on it.** Fill the `<…>` placeholders from the server's own tool list (`/mcp` in
> Claude Code, or `ToolSearch`) and pin the version you verified in the install command.

Server: `cypress-mcp` (npm, community). Install entry written by setup (from
`templates/mcp/cypress-mcp.json`):

```json
{ "command": "npx", "args": ["-y", "cypress-mcp"] }
```

Session mode supported: `external` only (the server or Cypress itself manages
authentication, e.g. `cy.session`). `session.mjs` only reports the server name; the
skill's login check applies.

## Tool names

Prefixed by the MCP server name: `mcp__<mcpServer>__<tool>`.

| Action | Tool | Arguments |
|---|---|---|
| open URL | `<tool to verify>` | `<…>` |
| read page | `<tool to verify>` | `<…>` |
| click | `<tool to verify>` | `<…>` |
| type | `<tool to verify>` | `<…>` |
| press key | `<tool to verify>` | `<…>` |
| screenshot | `<tool to verify>` | `<…>` |
| close | `<tool to verify, or "none">` | `<…>` |

**A missing action → the channels using it are not playable** (listed in the plan with the
reason "driver cannot <action>"), never a failure and never a workaround through another
browser.

## Login detection

The final URL is a login route, or the page content read back shows a login form.

## Driver check

The "open URL" and "read page" tools above must exist in the session; otherwise stop
before the plan as the skill says.
