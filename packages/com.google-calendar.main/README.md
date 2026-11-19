# Google Calendar WebMCP package (com.google-calendar.main 0.1.0)

Full port of the OpenTabs Google Calendar plugin
(MIT, https://github.com/opentabs-dev/opentabs/tree/main/plugins/google-calendar)
into the builtin WebMCP package format: all 18 upstream tools, no subset.

Everything runs inside the calendar.google.com tab. Upstream talks to the
Calendar API v3 through the page's own `gapi.client.request`, which signs each
call with SAPISIDHASH derived from the tab's session cookies; the port keeps that
transport, so no credential is ever read out of the page or returned. When a tab
has not exposed `gapi.client.request` yet, the same path (`/calendar/v3/...`),
method and params go out as a same-origin `fetch` with `credentials: 'include'`
and a `)]}'` XSSI prefix strip; Google answers an unknown `/calendar/v3` path on
that host with its marketing HTML page, which is reported as
`AUTH` ("Google Calendar is not ready") rather than as data. Both transports
classify errors like upstream: 401/403 `AUTH`, 404 `NOT_FOUND`, 429
`RATE_LIMITED`, 400/422 `VALIDATION`, anything else `INTERNAL`; an in-page 18s
deadline yields `TIMEOUT` and a transport failure `NETWORK`.

`GET/POST/PATCH/DELETE` bodies and query params are the upstream ones
(`maxResults`, `singleEvents`, `orderBy`, `showDeleted`, `pageToken`,
`sendUpdates`, `destination`, `showHidden`, `showDeleted`). Every response is
mapped through upstream's defensive mappers (`date_time`/`date`/`time_zone`,
attendee flags, reminder overrides, `conferenceData` video entry point).

## Tools

| Tool | Mechanics | Calendar API v3 endpoint |
| --- | --- | --- |
| `list_events` | GET + range/text query, `singleEvents` expansion | `GET /calendars/:id/events` |
| `get_event` | GET single resource | `GET /calendars/:id/events/:eventId` |
| `create_event` | POST + timed/all-day body mapping | `POST /calendars/:id/events` |
| `update_event` | PATCH, only the provided fields | `PATCH /calendars/:id/events/:eventId` |
| `delete_event` | DELETE (whole series for recurring) | `DELETE /calendars/:id/events/:eventId` |
| `quick_add_event` | POST natural-language `text` param | `POST /calendars/:id/events/quickAdd` |
| `move_event` | POST `destination` param | `POST /calendars/:id/events/:eventId/move` |
| `list_event_instances` | GET nested resource + pagination | `GET /calendars/:id/events/:eventId/instances` |
| `search_events` | calendar list, then per-calendar `q` search | `GET /users/me/calendarList` + `GET /calendars/:id/events` |
| `list_calendars` | GET + `showHidden`/`showDeleted` | `GET /users/me/calendarList` |
| `get_calendar` | GET single resource | `GET /calendars/:id` |
| `create_calendar` | POST secondary calendar | `POST /calendars` |
| `update_calendar` | PATCH metadata | `PATCH /calendars/:id` |
| `delete_calendar` | DELETE secondary calendar | `DELETE /calendars/:id` |
| `query_freebusy` | POST `items` body, per-calendar mapping | `POST /freeBusy` |
| `list_settings` | GET collection | `GET /users/me/settings` |
| `get_setting` | GET single setting | `GET /users/me/settings/:settingId` |
| `get_colors` | GET object map → arrays | `GET /colors` |

## Upstream assumption to watch

Upstream's whole data path rests on `gapi.client.request` being present on the
Calendar page, and on `calendar.google.com` serving `/calendar/v3` through it.
There is no batched `batchexecute`/`f.req` layer in this plugin (verified
against upstream `main` and the published `0.0.88` dist). If gapi disappears
from the page, the fallback fetch at least keeps the failure honest and
classifiable instead of silently returning an HTML page as calendar data.

Every workflow returns `{ status: 'ok'|'error', data, message }`. Error results
carry a stable `error_code`: `UNSUPPORTED_PAGE`, `AUTH`, `NOT_FOUND`,
`RATE_LIMITED`, `VALIDATION`, `INTERNAL`, `TIMEOUT`, `NETWORK`,
`TAB_UNAVAILABLE` (the tab closed, navigated away, or could not run the tool),
`EMPTY_RESULT` or `UNKNOWN`.
