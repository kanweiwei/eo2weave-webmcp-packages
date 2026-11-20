/**
 * com.docker-hub.main — execution tests against a stubbed Hub tab.
 *
 * Docker Hub authenticates with a JWT fetched from `/auth/profile` (cookie
 * session), cached for the run, and sends it as `Authorization: Bearer`. The
 * sandbox has no `AbortSignal.timeout`, which the ported API layer uses for its
 * own 30s cap, so the page supplies it the same way a tab would.
 */

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    async text() {
      return JSON.stringify(payload)
    },
    async json() {
      return payload
    },
  }
}

function hubPage(handler, extra = {}) {
  const requests = []
  const page = {
    hostname: 'hub.docker.com',
    href: 'https://hub.docker.com/repositories',
    globals: { AbortSignal: { timeout: () => new AbortController().signal } },
    fetch: async (url, init) => {
      requests.push({ url: String(url), init: init ?? {} })
      return handler(String(url), init ?? {})
    },
    ...extra,
  }
  return { requests, page }
}

/** Answers `/auth/profile` like a signed-in session, and delegates the rest. */
function signedIn(rest) {
  return (url, init) => {
    if (url.endsWith('/auth/profile')) {
      return jsonResponse({ token: 'jwt-abc', profile: { username: 'ada' } })
    }
    return rest(url, init)
  }
}

export default async function register({ ok, equal, section, runTool }) {
  section('com.docker-hub.main: activation')

  {
    const { requests, page } = hubPage(() => jsonResponse({}))
    const result = await runTool('com.docker-hub.main', 'get_current_user', {
      input: {},
      page: { ...page, hostname: 'example.com' },
    })
    equal(result.status, 'error', 'docker-hub wrong host: error status')
    equal(result.error_code, 'UNSUPPORTED_PAGE', 'docker-hub wrong host: UNSUPPORTED_PAGE')
    equal(requests.length, 0, 'docker-hub wrong host: makes no request')
  }

  section('com.docker-hub.main: reads')

  {
    const { requests, page } = hubPage(
      signedIn(() =>
        jsonResponse({
          count: 1,
          results: [
            {
              name: 'api',
              namespace: 'ada',
              description: 'service',
              is_private: false,
              pull_count: 42,
              star_count: 3,
              last_updated: '2026-11-19T10:00:00Z',
            },
          ],
        })
      )
    )
    const result = await runTool('com.docker-hub.main', 'list_repositories', {
      input: { page_size: 25 },
      page,
    })

    equal(result.status, 'ok', 'docker-hub list_repositories: ok')
    equal(result.data.count, 1, 'docker-hub list_repositories: count')
    equal(result.data.repositories.length, 1, 'docker-hub list_repositories: one repository')

    const apiCall = requests.find((r) => r.url.includes('/v2/namespaces/ada/repositories'))
    ok(Boolean(apiCall), 'docker-hub list_repositories: namespace path')
    ok(String(apiCall.url).includes('page_size=25'), 'docker-hub list_repositories: page_size')
    equal(apiCall.init.headers.Authorization, 'Bearer jwt-abc', 'docker-hub: bearer token used')
    // Repository calls authenticate with the bearer token; only the profile
    // bootstrap relies on the cookie session.
    const profileCall = requests.find((r) => r.url.endsWith('/auth/profile'))
    ok(Boolean(profileCall), 'docker-hub: profile bootstrapped before the API call')
    equal(profileCall.init.credentials, 'include', 'docker-hub: profile uses the cookie session')
  }

  section('com.docker-hub.main: identity resolution')

  {
    const { requests, page } = hubPage(signedIn(() => jsonResponse({ username: 'ada' })))
    const result = await runTool('com.docker-hub.main', 'get_current_user', { input: {}, page })

    equal(result.status, 'ok', 'docker-hub get_current_user: ok')
    ok(requests.some((r) => r.url.endsWith('/auth/profile')), 'docker-hub: profile endpoint used')
  }

  section('com.docker-hub.main: failures')

  {
    // No session: `/auth/profile` answers 401, so the tool reports AUTH and the
    // repository endpoint is never called.
    const { requests, page } = hubPage((url) =>
      url.endsWith('/auth/profile') ? jsonResponse({ detail: 'unauthorized' }, 401) : jsonResponse({})
    )
    const result = await runTool('com.docker-hub.main', 'list_repositories', { input: {}, page })

    equal(result.status, 'error', 'docker-hub signed out: error status')
    equal(result.error_code, 'AUTH', 'docker-hub signed out: AUTH')
    ok(
      !requests.some((r) => r.url.includes('/v2/namespaces/')),
      'docker-hub signed out: repository endpoint not called'
    )
  }
}
