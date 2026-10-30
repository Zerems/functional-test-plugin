# Driver mapping: `playwright-mcp`

Status: **reference driver**, fully supported. Server: `@playwright/mcp@0.0.83` (tool names
and parameters checked against that version's README on 2026-10-30).

Session modes supported: `persistent-profile` (default), `storage-state`. Setup writes one
`.mcp.json` entry per session name (from `templates/mcp/playwright-mcp.json`):

- `persistent-profile`: `npx -y @playwright/mcp@0.0.83 --browser <engine> --viewport-size <viewport> --user-data-dir .auth/profiles/<session> --output-dir .auth/screenshots`
- `storage-state`: `npx -y @playwright/mcp@0.0.83 --browser <engine> --isolated --storage-state <file> --viewport-size <viewport> --output-dir .auth/screenshots`

The server writes files only inside its allowed roots: screenshots go to its `--output-dir`,
`<host root>/.auth/screenshots/`. An absolute path elsewhere (the scratchpad, for example) is
refused (`File access denied … outside allowed roots`). `.auth/` is gitignored and must stay
so.

## Tool names

Tools are prefixed by the MCP server name that `session.mjs` reports (`mcpServer`):
`mcp__<mcpServer>__browser_navigate`, and so on. Use only the server of the channel's
session.

| Action | Tool | Arguments |
|---|---|---|
| open URL | `browser_navigate` | `url` |
| read page | `browser_snapshot` | none (accessibility tree with element refs) |
| click | `browser_click` | `target`: the ref from the latest snapshot; `element`: a human description |
| type | `browser_type` | `target`, `element`, `text`; `submit: true` presses Enter after |
| press key | `browser_press_key` | `key` (`Enter`, `Escape`, `ArrowDown`, a character) |
| screenshot | `browser_take_screenshot` | `filename`: a relative file name, e.g. `<KEY>-T3.png`, written under `.auth/screenshots/`; `fullPage` when useful |
| close | `browser_close` | none; required after `session.mjs` reports `"setupRan":true`, before the next navigation |

Useful extras of the same server: `browser_wait_for` (`text`, `textGone`, `time` ≤ 30 s),
`browser_select_option`, `browser_fill_form`, `browser_navigate_back`, `browser_tabs`,
`browser_handle_dialog`.

Refs change on every page update: take a new `browser_snapshot` before clicking or typing
after a navigation or a state change. Screenshots are proofs for KO cases only, never for
deciding an action (use the snapshot).

## Login detection

After "open URL", the page is a login page when the final URL's path is a login route
(`/login`, `/signin`, `/auth/…`, or the identity provider's host) **or** the snapshot shows
a login form (a password field with a sign-in button). Then follow the skill's login
check: the human logs in in that browser, the skill opens the URL again.

## Driver check

The tools `mcp__<mcpServer>__browser_navigate` and `mcp__<mcpServer>__browser_snapshot`
must exist in the session (tool list or `ToolSearch`) for every session the environment's
channels use.
