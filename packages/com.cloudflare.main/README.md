# Cloudflare WebMCP package (com.cloudflare.main 0.1.0)

Full port of the OpenTabs Cloudflare plugin
(MIT, https://github.com/opentabs-dev/opentabs/tree/main/plugins/cloudflare) into
the builtin WebMCP package format: all 30 upstream tools, no subset, including
the five write tools (`update_zone_setting`, `create_dns_record`,
`update_dns_record`, `delete_dns_record`, `purge_cache`).

Every call runs inside the dash.cloudflare.com tab. The dashboard proxies the
Cloudflare API at the same-origin path `/api/v4/…` (api.cloudflare.com itself is
blocked by CORS), so the port reuses that proxy: `fetch` with
`credentials: 'include'` — functionally identical to the upstream
`credentials: 'same-origin'` for a same-origin request, and the cookie is the
session — plus the dashboard's `x-atok` anti-forgery header. `x-atok` is read
live from `window.bootstrap.atok` on every call, never cached, because the
dashboard re-issues it (timestamp-prefixed) on each page load. The account ID is
the leading 32-hex segment of the current URL (`/<account_id>/…`), remembered in
`sessionStorage` for the tab's lifetime when the current page has none.

Reads that are zone-scoped take `zone_id`; account-scoped tools
(`list_workers`, `list_pages_projects`, `list_kv_namespaces`, `list_d1_databases`,
`list_queues`, `list_ai_models`, `list_vectorize_indexes`, `list_tunnels`,
`list_email_addresses`, `list_alerting_policies`, `list_rules_lists`) derive the
account from the page and return `VALIDATION` when the tab is not on an
account-scoped URL. Without `window.bootstrap.atok` no request is sent at all:
every tool returns `AUTH`, so a logged-out tab fails fast rather than getting a
login page back as JSON.

Errors are classified from the transport and the Cloudflare envelope
(`{ success, errors[] }`): 401/403 → `AUTH`, 404 → `NOT_FOUND`, 429 →
`RATE_LIMITED`, other non-2xx → `INTERNAL`, `success: false` → `INTERNAL` with
the `[code] message` list, in-page deadline (18 s) → `TIMEOUT`.

## Tools

| Tool | Mechanics | Dashboard endpoint |
| --- | --- | --- |
| `list_zones` | GET + name/status filters + pagination | `GET /api/v4/zones` |
| `get_zone` | GET by zone ID | `GET /api/v4/zones/:id` |
| `get_zone_settings` | GET + setting list mapping | `GET /api/v4/zones/:id/settings` |
| `update_zone_setting` | **write**, PATCH `{ value }` | `PATCH /api/v4/zones/:id/settings/:setting_id` |
| `list_dns_records` | GET + type/name filters + pagination | `GET /api/v4/zones/:id/dns_records` |
| `create_dns_record` | **write**, POST, `ttl` defaults to 1, optionals omitted | `POST /api/v4/zones/:id/dns_records` |
| `update_dns_record` | **write**, full-replace PUT | `PUT /api/v4/zones/:id/dns_records/:record_id` |
| `delete_dns_record` | **write**, DELETE, returns deleted id | `DELETE /api/v4/zones/:id/dns_records/:record_id` |
| `list_rulesets` | GET + phase/kind mapping | `GET /api/v4/zones/:id/rulesets` |
| `get_ruleset` | GET + rule list mapping | `GET /api/v4/zones/:id/rulesets/:ruleset_id` |
| `list_firewall_rules` | GET + nested `filter.expression` | `GET /api/v4/zones/:id/firewall/rules` |
| `list_rules_lists` | account-scoped GET | `GET /api/v4/accounts/:account_id/rules/lists` |
| `list_page_rules` | GET + `targets[0].constraint` mapping | `GET /api/v4/zones/:id/pagerules` |
| `list_ssl_certificates` | GET + certificate pack mapping | `GET /api/v4/zones/:id/ssl/certificate_packs` |
| `purge_cache` | **write**, POST, everything or files/tags/hosts/prefixes | `POST /api/v4/zones/:id/purge_cache` |
| `list_workers` | account-scoped GET | `GET /api/v4/accounts/:account_id/workers/scripts` |
| `list_worker_routes` | GET + route mapping | `GET /api/v4/zones/:id/workers/routes` |
| `list_pages_projects` | account-scoped GET + source repo mapping | `GET /api/v4/accounts/:account_id/pages/projects` |
| `list_kv_namespaces` | account-scoped GET + pagination | `GET /api/v4/accounts/:account_id/storage/kv/namespaces` |
| `list_d1_databases` | account-scoped GET | `GET /api/v4/accounts/:account_id/d1/database` |
| `list_queues` | account-scoped GET | `GET /api/v4/accounts/:account_id/queues` |
| `list_ai_models` | account-scoped GET + search/task filters | `GET /api/v4/accounts/:account_id/ai/models/search` |
| `list_vectorize_indexes` | account-scoped GET | `GET /api/v4/accounts/:account_id/vectorize/indexes` |
| `list_tunnels` | account-scoped GET + `is_deleted` | `GET /api/v4/accounts/:account_id/cfd_tunnel` |
| `list_email_routing_rules` | GET + `tag`-as-id mapping | `GET /api/v4/zones/:id/email/routing/rules` |
| `list_email_addresses` | account-scoped GET | `GET /api/v4/accounts/:account_id/email/routing/addresses` |
| `list_waiting_rooms` | GET + room mapping | `GET /api/v4/zones/:id/waiting_rooms` |
| `list_alerting_policies` | account-scoped GET | `GET /api/v4/accounts/:account_id/alerting/v3/policies` |
| `graphql_query` | **write-ish (POST)**, raw GraphQL `{ data, errors }` envelope | `POST /api/v4/graphql` |
| `get_user` | GET + `two_factor_authentication_enabled` rename | `GET /api/v4/user` |

`graphql_query` is the analytics escape hatch: it posts the caller's query (and
optional variables) to the dashboard's GraphQL proxy and returns `data` plus
`errors`, which is a different envelope from the REST endpoints and is passed
through unchanged.

## Scope

Every tool matches the whole dashboard origin
(`^https://dash\.cloudflare\.com/…$`, optional query/hash tail) because the
account ID prefix and the zone pages all live under it; a narrower regex would
hide account-scoped tools from the zone pages they are invoked from.
