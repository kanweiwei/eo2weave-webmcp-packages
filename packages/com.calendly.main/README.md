# Calendly WebMCP package (com.calendly.main 0.1.0)

Full port of the OpenTabs Calendly plugin
(MIT, https://github.com/opentabs-dev/opentabs/tree/main/plugins/calendly) into the
builtin WebMCP package format: **all 15 upstream tools, no subset**.

Parity is asserted against the published manifest
(`@opentabs-dev/opentabs-plugin-calendly@0.0.88` `dist/tools.json`) by the
repository harness: same tool names, same input property sets, same `required`
lists, same JSON Schema per field.

The plugin is REST-only upstream, so the port is too: no GraphQL or HTML
scraping was invented.

## Transport and activation

- Every request is same-origin inside the Calendly tab, against `/api`, with
  `credentials: 'include'` and `Accept: application/json`.
- Identity: CSRF meta tag `csrf-token` + the `CALENDLY_AUTHENTICATED_USER_STATUS` cookie; both are read on every call, so a signed-out tab is rejected before any request.
- The `urlRegex` in `manifest.json` pins the Calendly host, so a tab on another
  origin returns `UNSUPPORTED_PAGE` with **zero requests**.

Calendly groups `my_calendly` event types per owned profile, which the ported mapper flattens.

## Tools (15)

| Tool | Description |
|---|---|
| `get_current_user` | Get the profile of the currently authenticated Calendly user including name, email, booking URL, timezone, and event count. |
| `get_user_permissions` | Get the permission policy for the current user, showing what actions they can perform in the organization (create event types, manage teams, configure |
| `get_organization` | Get details about the current Calendly organization including name, tier, trial status, and owner information. |
| `get_organization_statistics` | Get seat usage statistics for the current Calendly organization including available seats, active users, pending invitations, and occupancy ratio. |
| `list_event_types` | List all event types for the current user. Event types define the scheduling templates (e.g. "30 Minute Meeting", "Discovery Call"). Returns paginated |
| `get_event_type` | Get detailed information about a specific event type by its numeric ID. Returns full configuration including duration, location settings, custom intak |
| `create_event_type` | Create a new event type (scheduling template). Requires a name and a URL-safe slug. Returns the new event type ID and edit path. |
| `update_event_type` | Update an existing event type. Only specified fields are changed; omitted fields remain unchanged. Returns the updated event type. |
| `delete_event_type` | Permanently delete an event type by its numeric ID. This action cannot be undone. Active events scheduled through this event type are not affected. |
| `clone_event_type` | Create a copy of an existing event type with all its settings. The clone is created with " (clone)" appended to the name and a generated slug. Returns |
| `activate_event_type` | Activate a previously deactivated event type, making it available for booking again. |
| `deactivate_event_type` | Deactivate an event type so it is no longer available for booking. The event type is preserved and can be reactivated later. Existing scheduled events |
| `list_scheduled_events` | List scheduled events (meetings) with optional status filter. Defaults to showing all events. Supports pagination with 20 events per page. |
| `list_calendar_accounts` | List all connected calendar accounts (Google Calendar, Outlook, etc.) with their conflict checking and push settings. |
| `get_user_busy_times` | Get busy time slots for the current user within a date range. Returns both Calendly events and external calendar events that block availability. Requi |

## Verification

- `scripts/tests/com.calendly.main.test.mjs` exercises the ported runtime against a
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
