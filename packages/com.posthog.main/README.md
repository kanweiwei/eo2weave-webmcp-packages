# com.posthog.main

PostHog product analytics for the `us.posthog.com` / `eu.posthog.com` tab the
user is already logged into: dashboards, insights, feature flags, experiments,
annotations, persons, cohorts, surveys, actions, projects, HogQL and trends
queries, raw events and the event/property definition catalog — 38 tools, the
full upstream OpenTabs `posthog` plugin.

Every tool runs inside the current PostHog app tab: same-origin `/api/...`
fetches with the tab's session cookie, exactly the transport the PostHog web app
itself uses.

## Auth and transport

- **Credential**: the Django CSRF cookie `posthog_csrftoken` (HttpOnly session
  cookie travels with `credentials: 'include'`). The current team id and
  organization id come from the page global
  `POSTHOG_APP_CONTEXT` (`current_team.id`,
  `current_project.organization_id`). No cookie or no team id ⇒ `AUTH` with no
  request sent — the tab is logged out or still booting.
- **Reads**: `GET` to a same-origin path, `Accept: application/json`, no CSRF
  header.
- **Writes**: `POST` / `PATCH` with `X-CSRFToken` (the cookie value) and, for
  JSON bodies, `Content-Type: application/json`. Omitted optional inputs are
  never sent, so a PATCH only touches the fields the caller named.
- **Deletes are soft**: PostHog answers 405 to `DELETE` on most resources, so
  the delete tools `PATCH` `{ "deleted": true }` — the same convention the web
  app uses.
- **Two URL families, on purpose**: `/api/environments/<team_id>/...` for
  dashboards, insights, persons, events and the query endpoint;
  `/api/projects/<team_id>/...` for feature flags, experiments, annotations,
  cohorts, surveys, actions and definitions. Team id and project id are
  interchangeable in PostHog Cloud; upstream mixes the two and this port keeps
  the same paths.
- **Timeouts**: the in-page fetch aborts at 18 s so a slow call fails as
  `TIMEOUT` instead of being orphaned by the 25 s browser command deadline.

Errors are classified the way the SDK does it: 401/403 → `AUTH`, 404 →
`NOT_FOUND`, 429 → `RATE_LIMITED`, 400/422 → `VALIDATION`, 500s → `HTTP`,
aborted/network → `TIMEOUT` / `NETWORK`. A successful call always returns the
adapter envelope `{ status: 'ok', data, message: null }`.

## Tools

All 38 tools share one host scope:

`^https://(?:us|eu|app)\.posthog\.com(?:/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$`

(`app.posthog.com` is the legacy host — it 302s to `us.posthog.com` today.)

### Users and organization (2)

| tool | endpoint |
| --- | --- |
| `get_current_user` | `GET /api/users/@me/` — email, name, verification and 2FA flags |
| `get_organization` | `GET /api/organizations/@current/` — name, created_at, membership level |

### Projects (2)

| tool | endpoint |
| --- | --- |
| `list_projects` | `GET /api/organizations/<org_id>/projects/` (`limit`, `offset`) |
| `get_project` | `GET /api/organizations/<org_id>/projects/<project_id>/` |

### Dashboards (5)

| tool | endpoint |
| --- | --- |
| `list_dashboards` | `GET /api/environments/<team>/dashboards/` (`limit`, `offset`) |
| `get_dashboard` | `GET /api/environments/<team>/dashboards/<id>/` |
| `create_dashboard` | `POST /api/environments/<team>/dashboards/` (`name` required, plus `description`, `pinned`, `tags`) |
| `update_dashboard` | `PATCH /api/environments/<team>/dashboards/<id>/` |
| `delete_dashboard` | `PATCH … {deleted: true}` |

### Insights (5)

| tool | endpoint |
| --- | --- |
| `list_insights` | `GET /api/environments/<team>/insights/` (`limit`, `offset`, `short_id`, `saved`) |
| `get_insight` | `GET /api/environments/<team>/insights/<id>/` |
| `create_insight` | `POST /api/environments/<team>/insights/` — the HogQL string is wrapped as `DataTableNode` → `HogQLQuery`, `saved: true`, optional `dashboards: [dashboard_id]` |
| `update_insight` | `PATCH /api/environments/<team>/insights/<id>/` (`name`, `description`, `favorited`, `tags`) |
| `delete_insight` | `PATCH … {deleted: true}` |

### Feature flags (5)

| tool | endpoint |
| --- | --- |
| `list_feature_flags` | `GET /api/projects/<team>/feature_flags/` (`limit`, `offset`, `active`, `search`) |
| `get_feature_flag` | `GET /api/projects/<team>/feature_flags/<id>/` |
| `create_feature_flag` | `POST /api/projects/<team>/feature_flags/` — `rollout_percentage` becomes `filters.groups[0].rollout_percentage` with empty `properties` |
| `update_feature_flag` | `PATCH /api/projects/<team>/feature_flags/<id>/` — only the fields given are sent |
| `delete_feature_flag` | `PATCH … {deleted: true}` |

Flag reads report `rollout_percentage` from `filters.groups[0]`.

### Experiments (3)

| tool | endpoint |
| --- | --- |
| `list_experiments` | `GET /api/projects/<team>/experiments/` |
| `get_experiment` | `GET /api/projects/<team>/experiments/<id>/` |
| `create_experiment` | `POST /api/projects/<team>/experiments/` (`name`, `feature_flag_key` required) |

### Annotations (3)

| tool | endpoint |
| --- | --- |
| `list_annotations` | `GET /api/projects/<team>/annotations/` (`limit`, `offset`, `search`) |
| `create_annotation` | `POST /api/projects/<team>/annotations/` (`content`, `date_marker`, optional `scope`) |
| `delete_annotation` | `PATCH … {deleted: true}` |

### Persons (2)

| tool | endpoint |
| --- | --- |
| `list_persons` | `GET /api/environments/<team>/persons/` (`limit`, `offset`, `search`, `distinct_id`) |
| `get_person` | `GET /api/environments/<team>/persons/<id>/` |

### Cohorts, surveys, actions (6)

| tool | endpoint |
| --- | --- |
| `list_cohorts` | `GET /api/projects/<team>/cohorts/` |
| `get_cohort` | `GET /api/projects/<team>/cohorts/<id>/` |
| `list_surveys` | `GET /api/projects/<team>/surveys/` (`archived`) |
| `get_survey` | `GET /api/projects/<team>/surveys/<uuid>/` |
| `list_actions` | `GET /api/projects/<team>/actions/` |
| `get_action` | `GET /api/projects/<team>/actions/<id>/` |

### Query and events (3)

| tool | endpoint |
| --- | --- |
| `run_query` | `POST /api/environments/<team>/query/` with `{query: {kind: 'HogQLQuery', query}}` — returns `columns`, `results`, `types`, `hogql` |
| `run_trends_query` | `POST /api/environments/<team>/query/` with a `TrendsQuery` (`series`, `dateRange`, `interval`, optional `breakdownFilter`) — returns one `{label, count, data, days}` per series |
| `list_events` | `GET /api/environments/<team>/events/` — `orderBy: ["-timestamp"]`, default `limit` 20, filters `event`, `person_id`, `after`, `before` |

### Data management (2)

| tool | endpoint |
| --- | --- |
| `list_event_definitions` | `GET /api/projects/<team>/event_definitions/` (`limit`, `offset`, `search`) |
| `list_property_definitions` | `GET /api/projects/<team>/property_definitions/` (`type` defaults to `event`, plus `limit`, `offset`, `search`) |

## Notes

- Upstream declares a `configSchema.instanceUrl` for self-hosted PostHog; its
  `urlPatterns` (and this package) cover PostHog Cloud only, so self-hosted
  instances are out of scope — a self-hosted tab fails as `UNSUPPORTED_PAGE`
  rather than issuing half-working requests.
- `run_query` / `run_trends_query` surface a PostHog-side query error as a plain
  error message (`HogQL query error: …`), as upstream does, instead of mapping
  it to a typed `VALIDATION`.
- Tests: `scripts/tests/com.posthog.main.test.mjs` (114 assertions — reads,
  writes, soft delete, HogQL query, CSRF header, auth/page failures, urlRegex).
