# npm WebMCP package (com.npm.main 0.1.0)

Full port of the OpenTabs npm plugin
(MIT, https://github.com/opentabs-dev/opentabs/tree/main/plugins/npm) into the
builtin WebMCP package format: all 14 upstream tools, no subset.

Every call runs inside the www.npmjs.com tab. The site answers any page with
JSON when the request carries `x-spiferack: 1`, so the port reuses npm's own
server-rendered data instead of the public registry: same-origin `fetch` with
`credentials: 'include'` and the spiferack header. The logged-in session is read
from the page (`window.__context__.context.user.name`, `.user.avatars.large`
and `window.__context__.context.csrftoken`); it never leaves page context and is
re-read on every call, so an account switch in a live tab cannot reuse the
previous account's csrf token. Non-GET calls additionally send `x-csrf-token`
from that context; all 14 current tools are GETs.

The authenticated tools (`get_current_user`, `list_user_packages`,
`list_tokens`) never take a username from the caller — they read it from the
page and return `UNAUTHENTICATED` on a logged-out tab. Public reads (package,
version, readme, downloads, dependents, dependencies, search, user profile, user
packages, organization) work anonymously, exactly like the upstream tool
implementations.

## Tools

| Tool | Mechanics | npm endpoint |
| --- | --- | --- |
| `get_current_user` | page context only, no fetch | `window.__context__` |
| `search_packages` | GET + `q`/`page` query + score mapping | `GET /search` |
| `get_package` | GET + capsule/packageVersion mapping | `GET /package/:name` |
| `get_package_version` | nested path + dependency maps | `GET /package/:name/v/:version` |
| `get_package_readme` | GET, string-or-`{data}` readme | `GET /package/:name` |
| `get_package_downloads` | GET + weekly series mapping | `GET /package/:name` |
| `get_package_dependents` | GET + truncated dependents sample | `GET /package/:name` |
| `get_package_versions` | GET + `activeTab=versions` + dist-tags | `GET /package/:name?activeTab=versions` |
| `get_package_dependencies` | GET + dependency maps | `GET /package/:name` |
| `get_user_profile` | GET + scope/parent mapping | `GET /~:username` |
| `get_user_packages` | GET + `page` query | `GET /~:username?page=` |
| `get_organization` | GET + `page` query + 2FA flag | `GET /org/:name?page=` |
| `list_user_packages` | authenticated, username from page | `GET /settings/:username/packages?page=` |
| `list_tokens` | authenticated, username from page | `GET /settings/:username/tokens` |

## Upstream assumption to watch

This plugin was dormant upstream (npm publishes stopped months before this
port). Its whole data path rests on two volunteer assumptions: npmjs.com keeps
answering browser requests with `x-spiferack: 1`, and the web app keeps
publishing `window.__context__` with `user.name` + `csrftoken`. If the second
one goes away, the public read tools keep working and every authenticated tool
degrades to a clear `UNAUTHENTICATED`; if the first one goes away, every tool
fails with npm's HTML page parsed as JSON ("npm registry returned invalid JSON").

## Notes

- Outputs keep the upstream shapes (`{ package }`, `{ packages, total }`,
  `{ tokens }`, …) inside the adapter envelope
  `{ status, data, message, error_code }`.
- Types are declared as the API takes them: `page` is an `integer` with
  `minimum: 0`, never a string.
- Errors are classified, not thrown: `AUTH` (401/403), `NOT_FOUND` (404),
  `RATE_LIMITED` (429), `HTTP`, `NETWORK`, `UNAUTHENTICATED`,
  `UNSUPPORTED_PAGE`.
