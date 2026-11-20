# Zendesk WebMCP package (com.zendesk.main 0.1.0)

Full port of the OpenTabs Zendesk plugin
(MIT, https://github.com/opentabs-dev/opentabs/tree/main/plugins/zendesk) into the
builtin WebMCP package format: **all 17 upstream tools, no subset**.

Parity is asserted against the published manifest
(`@opentabs-dev/opentabs-plugin-zendesk@0.0.88` `dist/tools.json`) by the
repository harness: same tool names, same input property sets, same `required`
lists, same JSON Schema per field.

The plugin is REST-only upstream, so the port is too: no GraphQL or HTML
scraping was invented.

## Transport and activation

- Every request is same-origin inside the Zendesk tab, against `/api/v2`, with
  `credentials: 'include'` and `Accept: application/json`.
- Identity: `window.__app_config__.currentUser.id` for identity, plus a CSRF token from the `csrf-token` meta tag (falling back to the `_zendesk_csrf` cookie) on every non-GET request.
- The `urlRegex` in `manifest.json` pins the Zendesk host, so a tab on another
  origin returns `UNSUPPORTED_PAGE` with **zero requests**.

Zendesk embeds its agent session in `__app_config__`; a tab without it returns `AUTH` with no network request.

## Tools (17)

| Tool | Description |
|---|---|
| `list_tickets` | List support tickets from Zendesk. Returns tickets with full details including subject, status, priority, assignee, requester, and timestamps. Support |
| `get_ticket` | Get detailed information about a specific support ticket by its ID. Returns the full ticket object including subject, description, status, priority, a |
| `create_ticket` | Create a new support ticket in Zendesk. Requires a subject and initial comment body. Optionally set priority, type, tags, assignee, group, and request |
| `update_ticket` | Update an existing support ticket. Change the subject, status, priority, type, tags, assignee, or group. Only specified fields are updated; omitted fi |
| `delete_ticket` | Permanently delete a support ticket by its ID. This action cannot be undone. The ticket and all its comments will be removed from Zendesk. |
| `list_ticket_comments` | List all comments on a support ticket. Returns comments with author information, body text, creation timestamp, and public/private status. Supports pa |
| `add_ticket_comment` | Add a comment to an existing support ticket. Comments can be public (visible to the requester) or private (internal notes for agents only). Returns th |
| `get_current_user` | Get the profile of the currently authenticated Zendesk user. |
| `get_user` | Get detailed information about a specific Zendesk user by their ID. |
| `list_users` | List users in the Zendesk account. Optionally filter by role and paginate results. |
| `list_organizations` | List all organizations in the Zendesk account with optional pagination. |
| `get_organization` | Get detailed information about a specific Zendesk organization by its ID. |
| `list_groups` | List all agent groups in the Zendesk account. |
| `search` | Search across tickets, users, and organizations using Zendesk search syntax. Examples: 'type:ticket status:open', 'type:user role:agent', 'type:organi |
| `list_views` | List all shared and personal views in the Zendesk account. |
| `get_view_tickets` | Get the list of tickets in a specific Zendesk view. Use list_views to discover available views. |
| `list_tags` | List all tags in the Zendesk account with their usage counts. |

## Verification

- `scripts/tests/com.zendesk.main.test.mjs` exercises the ported runtime against a
  stubbed tab: reads, a write (method + CSRF/bearer header + payload shape),
  a signed-out tab (error code with zero requests) and an API failure.
- `node scripts/test-packages.mjs` covers contract, upstream parity, the
  package-local tests and `validate-package.mjs` for every package in the repo.

## Layout

- `manifest.json` — tool list, `urlRegex`, workflow paths
- `workflows/<tool>.js` — one self-contained workflow per tool: page-side SDK
  compatibility layer, the upstream API module and mappers pasted verbatim, and
  the tool's own `handle` body
- `config.json` — package config (none needed: identity comes from the tab)
