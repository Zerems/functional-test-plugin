# Driver mapping: custom

Copy this file into the host project (for example
`.claude/functional-test/browser-driver.md`), fill it, and set `browser.driver: "custom"`
and `browser.driverMapping` to its path (relative to the host root). The preflight checks
that the file exists; the skill reads it in place of a built-in mapping.

Fill in:

- **Server**: package and pinned version, and the `.mcp.json` entry to add (command and
  arguments). Declare one entry per session name; its key is the session's `mcpServer`.
- **Session modes supported**: `external` unless the server takes a Playwright profile
  directory (`persistent-profile`) or a storage-state file (`storage-state`).
- **Tool names**: as the session lists them, without the `mcp__<mcpServer>__` prefix.
- **Login detection**: how to tell, after "open URL", that the page is a login page.

## Tool names

Prefixed by the MCP server name: `mcp__<mcpServer>__<tool>`.

| Action | Tool | Arguments |
|---|---|---|
| open URL | | |
| read page | | |
| click | | |
| type | | |
| press key | | |
| screenshot | | |
| close | | |

Leave a row empty when the server cannot perform the action: **the channels using it are
then not playable**, and the skill says so in the plan.

## Login detection

<rule>

## Driver check

<the tools that must exist in the session for the driver to be usable: at least "open URL"
and "read page">
