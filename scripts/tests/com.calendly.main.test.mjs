/**
 * com.calendly.main — execution tests against a stubbed Calendly tab.
 *
 * Identity is the CSRF meta tag plus the signed-in cookie (exactly what the
 * ported API layer reads), so a page without them must reject before any
 * request is attempted.
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

function calendlyPage(handler, extra = {}) {
  const requests = []
  const page = {
    hostname: 'calendly.com',
    href: 'https://calendly.com/event_types',
    cookie: 'CALENDLY_AUTHENTICATED_USER_STATUS=AUTHENTICATED',
    meta: { 'csrf-token': 'csrf-abc123' },
    fetch: async (url, init) => {
      requests.push({ url: String(url), init })
      return handler(String(url), init)
    },
    ...extra,
  }
  return { requests, page }
}

export default async function register({ ok, equal, section, runTool }) {
  section('com.calendly.main: identity')

  {
    const { requests, page } = calendlyPage(() => jsonResponse({}), {
      cookie: '',
      meta: {},
    })
    const result = await runTool('com.calendly.main', 'list_event_types', { input: {}, page })
    equal(result.status, 'error', 'calendly signed out: error status')
    equal(result.error_code, 'AUTH', 'calendly signed out: AUTH')
    equal(requests.length, 0, 'calendly signed out: makes no request')
  }

  section('com.calendly.main: reads')

  {
    const { requests, page } = calendlyPage(() =>
      jsonResponse({
        // my_calendly groups event types per owned profile.
        results: [
          {
            event_types: [
              {
                uri: 'https://api.calendly.com/event_types/ET1',
                name: 'Intro',
                slug: 'intro',
                active: true,
                scheduling_url: 'https://calendly.com/ada/intro',
              },
            ],
          },
        ],
        pagination: { count: 1, next_page: null },
      })
    )
    const result = await runTool('com.calendly.main', 'list_event_types', {
      input: { page: 2 },
      page,
    })

    equal(result.status, 'ok', 'calendly list_event_types: ok')
    equal(result.data.event_types.length, 1, 'calendly list_event_types: one event type')
    equal(result.data.event_types[0].name, 'Intro', 'calendly list_event_types: mapped name')
    equal(requests.length, 1, 'calendly list_event_types: one request')
    ok(requests[0].url.includes('/users/me/event_types'), 'calendly list_event_types: path')
    ok(requests[0].url.includes('scope=my_calendly'), 'calendly list_event_types: scope')
    ok(requests[0].url.includes('page=2'), 'calendly list_event_types: page forwarded')
    equal(requests[0].init.credentials, 'include', 'calendly list_event_types: cookies sent')
  }

  section('com.calendly.main: writes')

  {
    const { requests, page } = calendlyPage(() =>
      jsonResponse({ resource: { uri: 'u', name: 'Intro', slug: 'intro', active: true } })
    )
    const result = await runTool('com.calendly.main', 'activate_event_type', {
      input: { event_type_id: 'ET1' },
      page,
    })

    equal(result.status, 'ok', 'calendly activate_event_type: ok')
    equal(requests.length, 1, 'calendly activate_event_type: one request')
    equal(requests[0].init.method, 'PUT', 'calendly activate_event_type: PUT')
    ok(requests[0].url.includes('/users/me/event_types/ET1/activate'), 'calendly activate: path')
    equal(
      requests[0].init.headers['X-CSRF-Token'],
      'csrf-abc123',
      'calendly activate: CSRF header from meta'
    )
  }

  section('com.calendly.main: failures')

  {
    const { page } = calendlyPage(() => jsonResponse({ message: 'nope' }, 403))
    const result = await runTool('com.calendly.main', 'get_current_user', { input: {}, page })
    equal(result.status, 'error', 'calendly 403: error status')
    equal(result.error_code, 'AUTH', 'calendly 403: AUTH')
  }
}
