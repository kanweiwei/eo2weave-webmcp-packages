# Docker Hub WebMCP package (com.docker-hub.main 0.1.0)

Full port of the OpenTabs Docker Hub plugin
(MIT, https://github.com/opentabs-dev/opentabs/tree/main/plugins/docker-hub) into the
builtin WebMCP package format: **all 12 upstream tools, no subset**.

Parity is asserted against the published manifest
(`@opentabs-dev/opentabs-plugin-docker-hub@0.0.89` `dist/tools.json`) by the
repository harness: same tool names, same input property sets, same `required`
lists, same JSON Schema per field.

The plugin is REST-only upstream, so the port is too: no GraphQL or HTML
scraping was invented.

## Transport and activation

- Every request is same-origin inside the Docker Hub tab, against `https://hub.docker.com`, with
  `credentials: 'include'` and `Accept: application/json`.
- Identity: A JWT from `/auth/profile` (cookie session), cached for the run and sent as `Authorization: Bearer`. A WebMCP package has no activation hook, so the cache is primed per call before the tool runs — otherwise tools that read the username (e.g. `list_repositories` without `namespace`) would report `AUTH`.
- The `urlRegex` in `manifest.json` pins the Docker Hub host, so a tab on another
  origin returns `UNSUPPORTED_PAGE` with **zero requests**.

Repository calls are bearer-authenticated; only the profile bootstrap uses the cookie session.

## Tools (12)

| Tool | Description |
|---|---|
| `get_current_user` | Get the profile of the currently authenticated Docker Hub user including username, full name, location, company, and account creation date. |
| `get_user_profile` | Get a Docker Hub user profile by username. Returns username, full name, location, company, account type, and join date. |
| `list_organizations` | List Docker Hub organizations the current user belongs to. Returns organization names, locations, and join dates. |
| `list_repositories` | List Docker Hub repositories in a namespace (user or organization). Defaults to the current user. Supports filtering by name and sorting. |
| `get_repository` | Get detailed information about a Docker Hub repository including description, pull count, star count, permissions, categories, and full README. |
| `create_repository` | Create a new Docker Hub repository in a namespace. The repository is created as a public image repository by default. |
| `update_repository` | Update a Docker Hub repository. Only specified fields are changed; omitted fields remain unchanged. |
| `delete_repository` | Permanently delete a Docker Hub repository. This action cannot be undone. All tags and images in the repository will be deleted. |
| `list_tags` | List tags for a Docker Hub repository. Returns tag names, digests, sizes, platform support, and last update times. Use namespace "library" for officia |
| `get_tag` | Get detailed information about a specific tag in a Docker Hub repository, including its digest, size, and platform-specific images. |
| `search_repositories` | Search Docker Hub repositories by keyword. Returns matching repositories with pull counts, star counts, and official/automated status. |
| `search_catalog` | Search the Docker Hub catalog for images, extensions, and models. Returns rich metadata including categories, source type (official, verified publishe |

## Verification

- `scripts/tests/com.docker-hub.main.test.mjs` exercises the ported runtime against a
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
