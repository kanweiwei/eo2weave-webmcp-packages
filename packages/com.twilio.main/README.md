# com.twilio.main

Twilio Console for the account the tab is already logged into: subaccounts,
balance, phone numbers (incoming, caller IDs, number search), SMS/MMS, voice
calls, recordings, usage records and triggers, messaging services, Verify
services, Monitor alerts, API keys and TwiML applications — 35 tools, the full
upstream OpenTabs `twilio` plugin.

Every tool runs inside the current `console.twilio.com` tab.

## Auth and transport

- **Credential**: `GET https://www.twilio.com/console/api/v2/projects/info` with
  `credentials: 'include'` — the Console session cookie answers with
  `projectSid` and `authToken` for the account the tab is logged into. The pair
  is cached in page memory for the life of the tab and never leaves page
  context; a failed bootstrap is reported as `AUTH` without touching the REST
  API.
- **Reads**: `GET https://api.twilio.com/2010-04-01/Accounts/<AccountSid><path>.json`
  (subaccounts use `/2010-04-01/Accounts.json`) with
  `Authorization: Basic base64(<AccountSid>:<AuthToken>)`.
- **Sub-products**: `messaging.twilio.com/v1`, `verify.twilio.com/v2` and
  `monitor.twilio.com/v1` share the same transport, as upstream does.
- **Writes**: `POST` with `application/x-www-form-urlencoded` bodies
  (`FriendlyName`, `VoiceUrl`, `To`/`From`/`Body`, …) and `DELETE` for the
  delete tools. `credentials: 'omit'` on the REST calls: Twilio's API
  authenticates with the Basic header, not the console cookie.
- **Pagination**: the upstream plugin pages with Twilio's `PageSize` query
  parameter only (defaults 20 / 50 per list tool, max 1000) and does not follow
  `next_page_uri`; this port keeps that behaviour exactly.
- **Timeouts**: the in-page fetch aborts at 18 s so a slow call fails as
  `TIMEOUT` instead of being orphaned by the 25 s browser command deadline.

Errors are classified like the OpenTabs SDK: 401/403 → `AUTH`, 404 →
`NOT_FOUND`, 429 → `RATE_LIMITED`, 400/422 → `VALIDATION`, 408 → `TIMEOUT`,
aborted/network → `TIMEOUT` / `NETWORK`, 5xx → `HTTP`. A non-JSON success body
is `VALIDATION`.

## Tools

All 35 tools share one host scope:
`^https://console\.twilio\.com(?:/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$`

### Account (3)

`get_current_user`, `list_subaccounts`, `get_balance`

### Phone Numbers (5)

`list_phone_numbers`, `get_phone_number`, `update_phone_number`,
`search_available_numbers`, `list_caller_ids`

### Messages (4)

`list_messages`, `get_message`, `send_message`, `delete_message`

### Calls (4)

`list_calls`, `get_call`, `create_call`, `update_call`

### Recordings (3)

`list_recordings`, `get_recording`, `delete_recording`

### Usage (2)

`list_usage_records`, `list_usage_triggers`

### Messaging Services (3)

`list_messaging_services`, `get_messaging_service`, `create_messaging_service`

### Verify (3)

`list_verify_services`, `get_verify_service`, `create_verify_service`

### Alerts (2)

`list_alerts`, `get_alert`

### API Keys (3)

`list_api_keys`, `create_api_key`, `delete_api_key`

### Applications (3)

`list_applications`, `get_application`, `create_application`

## Output

Every tool returns the repo envelope: `{ status, data, message, error_code }`.
`data` carries the upstream-mapped shape — camel-free snake_case fields with
upstream's defaults (`price: '0'`, `price_unit: 'USD'`, `code_length: 6`,
`validity_period: 14400`, …), and list tools return the array under the same key
upstream uses (`accounts`, `phone_numbers`, `available_phone_numbers`,
`caller_ids`, `messages`, `calls`, `recordings`, `usage_records`,
`usage_triggers`, `services`, `alerts`, `keys`, `applications`).
