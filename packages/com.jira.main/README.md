# Jira WebMCP package (com.jira.main 0.1.0)

Full port of the OpenTabs Jira plugin
(MIT, https://github.com/opentabs-dev/opentabs/tree/main/plugins/jira) into the
builtin WebMCP package format: all 20 upstream tools, no subset.

Every call runs inside the `*.atlassian.net` tab. The plugin's own API layer is
ported as-is: same-origin `fetch` with `credentials: 'include'` against
`/rest/api/3` (Jira platform) and `/rest/agile/1.0` (boards, sprints), JSON
bodies only, and the same status classification (401/403 → `AUTH`, 404 →
`NOT_FOUND`, 400 → `VALIDATION`, 429 → `RATE_LIMITED`). There is no token: the
browser's Jira session cookie is the credential.

The session identity is the two meta tags Jira Cloud stamps on every page,
`ajs-atlassian-account-id` and `ajs-cloud-id`. Upstream caches them in the
extension's auth cache; this port re-reads them from the page on every call, so
an account switch in a live tab cannot reuse the previous identity. A page
without them returns `UNAUTHENTICATED` before any request is made.

Rich text is Atlassian Document Format in both directions: descriptions and
comment bodies are wrapped as a single ADF paragraph on write, and read back as
plain text with one line per top-level block. `add_watcher` sends the account id
as a bare JSON string, because that is what the endpoint takes.

Scope matches the upstream URL patterns `*://*.atlassian.net/*` minus
`*://*.atlassian.net/wiki/*`, so Confluence pages on the same site are excluded.
The `instanceUrl` config schema upstream offers for self-hosted Jira is not
ported: this package targets Jira Cloud.

## Tools

| Tool | Mechanics | Jira endpoint |
| --- | --- | --- |
| `search_issues` | JQL + `fields` list, pagination | `GET /rest/api/3/search/jql` |
| `get_issue` | GET + explicit field set, ADF → text | `GET /rest/api/3/issue/:key` |
| `create_issue` | POST, ADF description, optional fields only | `POST /rest/api/3/issue` |
| `update_issue` | PUT, only supplied fields, `assignee: null` unassigns | `PUT /rest/api/3/issue/:key` |
| `delete_issue` | DELETE + `deleteSubtasks`, 204 | `DELETE /rest/api/3/issue/:key` |
| `transition_issue` | POST `{transition:{id}}` | `POST /rest/api/3/issue/:key/transitions` |
| `get_transitions` | GET + transition mapping | `GET /rest/api/3/issue/:key/transitions` |
| `assign_issue` | PUT `{accountId}` or `null` | `PUT /rest/api/3/issue/:key/assignee` |
| `link_issues` | POST issueLink body | `POST /rest/api/3/issueLink` |
| `add_watcher` | POST bare JSON string body | `POST /rest/api/3/issue/:key/watchers` |
| `list_issue_types` | GET + type mapping | `GET /rest/api/3/issuetype` |
| `list_priorities` | GET + priority mapping | `GET /rest/api/3/priority` |
| `add_comment` | POST ADF body, comment mapping | `POST /rest/api/3/issue/:key/comment` |
| `list_comments` | GET + `maxResults`/`startAt`/`orderBy` | `GET /rest/api/3/issue/:key/comment` |
| `list_projects` | GET + `query`/`maxResults`/`startAt` | `GET /rest/api/3/project/search` |
| `get_project` | GET + project mapping | `GET /rest/api/3/project/:key` |
| `list_boards` | agile base path, `projectKeyOrId`/`type` | `GET /rest/agile/1.0/board` |
| `list_sprints` | agile base path, `state` filter | `GET /rest/agile/1.0/board/:id/sprint` |
| `search_users` | GET + user mapping | `GET /rest/api/3/user/search` |
| `get_myself` | GET + user mapping | `GET /rest/api/3/myself` |

## Verification

`npm test` covers the contract, upstream tool-set/schema parity (20/20 names and
input schemas from the published `@opentabs-dev/opentabs-plugin-jira`), and
execution against a stubbed page: JQL search + ADF flattening, issue read,
create (JSON body, default `Task`, omitted optionals), partial update with
`assignee: null`, transition, comment, watcher bare-string body, agile boards,
204 deletes, and the 401/403/`UNAUTHENTICATED` paths.

Browser-only paths not exercised by the harness: a real Jira Cloud session
(cookie auth), and instance behaviour that depends on the site's field
configuration or permissions.
