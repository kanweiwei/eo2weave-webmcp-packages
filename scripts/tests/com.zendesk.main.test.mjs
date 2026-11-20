/**
 * com.zendesk.main — execution tests against a stubbed agent tab.
 *
 * Zendesk's in-product identity is `window.__app_config__.currentUser.id` plus
 * a CSRF token from a meta tag (falling back to the `_zendesk_csrf` cookie), so
 * a tab without the config must be rejected before any request is made.
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

function zendeskPage(handler, extra = {}) {
  const requests = []
  const page = {
    hostname: 'acme.zendesk.com',
    href: 'https://acme.zendesk.com/agent/dashboard',
    meta: { 'csrf-token': 'zendesk-csrf' },
    globals: { __app_config__: { currentUser: { id: 4711 } } },
    fetch: async (url, init) => {
      requests.push({ url: String(url), init: init ?? {} })
      return handler(String(url), init ?? {})
    },
    ...extra,
  }
  return { requests, page }
}

export default async function register({ ok, equal, section, runTool }) {
  section('com.zendesk.main: identity')

  {
    const { requests, page } = zendeskPage(() => jsonResponse({}), { globals: {} })
    const result = await runTool('com.zendesk.main', 'list_tickets', { input: {}, page })
    equal(result.status, 'error', 'zendesk signed out: error status')
    equal(result.error_code, 'AUTH', 'zendesk signed out: AUTH')
    equal(requests.length, 0, 'zendesk signed out: makes no request')
  }

  section('com.zendesk.main: reads')

  {
    const { requests, page } = zendeskPage(() =>
      jsonResponse({
        tickets: [
          {
            id: 9001,
            subject: 'Printer on fire',
            status: 'open',
            priority: 'urgent',
            requester_id: 4711,
            updated_at: '2026-11-20T08:00:00Z',
          },
        ],
        count: 1,
      })
    )
    const result = await runTool('com.zendesk.main', 'list_tickets', {
      input: { per_page: 50 },
      page,
    })

    equal(result.status, 'ok', 'zendesk list_tickets: ok')
    equal(result.data.tickets.length, 1, 'zendesk list_tickets: one ticket')
    equal(result.data.count, 1, 'zendesk list_tickets: count')
    equal(requests.length, 1, 'zendesk list_tickets: one request')
    ok(requests[0].url.includes('/api/v2/tickets.json'), 'zendesk list_tickets: path')
    ok(requests[0].url.includes('per_page=50'), 'zendesk list_tickets: per_page forwarded')
    equal(requests[0].init.credentials, 'include', 'zendesk list_tickets: cookies sent')
  }

  section('com.zendesk.main: writes')

  {
    const { requests, page } = zendeskPage(() =>
      jsonResponse({ ticket: { id: 9002, subject: 'New ticket', status: 'new', priority: 'normal' } }, 201)
    )
    const result = await runTool('com.zendesk.main', 'create_ticket', {
      input: { subject: 'New ticket', body: 'Details', priority: 'normal' },
      page,
    })

    equal(result.status, 'ok', 'zendesk create_ticket: ok')
    equal(requests.length, 1, 'zendesk create_ticket: one request')
    equal(requests[0].init.method, 'POST', 'zendesk create_ticket: POST')
    equal(
      requests[0].init.headers['X-CSRF-Token'],
      'zendesk-csrf',
      'zendesk create_ticket: CSRF header from meta'
    )
    const body = JSON.parse(String(requests[0].init.body))
    equal(body.ticket.subject, 'New ticket', 'zendesk create_ticket: payload nests under ticket')
  }

  section('com.zendesk.main: failures')

  {
    const { page } = zendeskPage(() => jsonResponse({ error: 'RecordNotFound', description: 'Not found' }, 404))
    const result = await runTool('com.zendesk.main', 'get_ticket', { input: { ticket_id: 1 }, page })
    equal(result.status, 'error', 'zendesk 404: error status')
    equal(result.error_code, 'NOT_FOUND', 'zendesk 404: NOT_FOUND')
  }
}
