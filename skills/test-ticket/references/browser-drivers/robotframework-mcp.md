# Driver mapping: `robotframework-mcp`

> **Status: community server, unverified on 2026-10-30 — verify the tool names and pin a
> version before use.** Fill the `<…>` placeholders from the server's own tool list (`/mcp` in
> Claude Code, or `ToolSearch`) and pin the version you verified in the install command.
> Until the tool names are filled in, copy this file into the host as a `custom` mapping
> and point `browser.driverMapping` to it; if the driver check cannot find the tools, stop
> before the plan and say so. Never edit the plugin's files during a run.

Server: `robotframework-mcp` (PyPI, community; `rf-mcp` is an alternative with its own
tool names). Setup writes **no** `.mcp.json` entry for it: it prints the install command of
`templates/mcp/robotframework-mcp.json` (unpinned) and the user adds the entry, a pinned
version, to `.mcp.json` themselves, one per session `mcpServer`:

```json
{ "command": "uvx", "args": ["robotframework-mcp"] }
```

Session mode supported: `external` only (the server or Robot Framework itself manages
authentication, e.g. a login keyword of the Browser or SeleniumLibrary library).
`session.mjs` only reports the server name; the skill's login check applies.

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
