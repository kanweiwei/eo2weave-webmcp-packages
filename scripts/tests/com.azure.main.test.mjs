/**
 * com.azure.main — execution tests against a stubbed Azure Portal tab.
 *
 * Identity is an MSAL ARM access token stored as a JSON object in sessionStorage
 * (keys containing 'accesstoken' + the management scope, entry.secret not yet
 * expired) — exactly what the ported API layer extracts. ARM calls go to
 * management.azure.com with the bearer token and `credentials: 'omit'` (ARM is
 * cross-origin).
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

const MSAL_ENTRY = JSON.stringify({
  secret: 'arm-token-abc',
  expiresOn: String(Math.floor(Date.now() / 1000) + 3600),
})

function makeEmptyStorage() {
  const map = new Map()
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    key: (index) => [...map.keys()][index] ?? null,
    get length() {
      return map.size
    },
  }
}

/** A signed-in Azure Portal tab whose sessionStorage holds an ARM MSAL token. */
function azurePage(handler, extra = {}) {
  const requests = []
  const map = new Map([['{msal-accesstoken}/management.core.windows.net/key', MSAL_ENTRY]])
  const storage = {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    key: (index) => [...map.keys()][index] ?? null,
    get length() {
      return map.size
    },
  }
  const page = {
    hostname: 'portal.azure.com',
    href: 'https://portal.azure.com/#home',
    fetch: async (url, init) => {
      requests.push({ url: String(url), init })
      return handler(String(url), init)
    },
  }
  Object.assign(page, extra)
  // sessionStorage must survive Object.assign extras (identity-failure tests
  // pass an empty one)
  page.sessionStorage = extra.sessionStorage ?? storage
  return { requests, page, sessionStorage: storage }
}

export default async function register({ ok, equal, section, runTool }) {
  section('com.azure.main: identity')

  {
    const { requests, page } = azurePage(() => jsonResponse({}), {
      sessionStorage: makeEmptyStorage(),
    })
    const result = await runTool('com.azure.main', 'list_subscriptions', { input: {}, page })
    equal(result.status, 'error', 'azure signed out: error status')
    equal(result.error_code, 'AUTH', 'azure signed out: AUTH')
    equal(requests.length, 0, 'azure signed out: makes no request')
  }

  section('com.azure.main: reads')

  {
    // get_current_user decodes the ARM JWT payload (name/upn/oid claims)
    const jwtBody = Buffer.from(JSON.stringify({ name: 'Ada', upn: 'ada@example.com', oid: 'oid-1', tid: 't-1' })).toString('base64url')
    const { page, sessionStorage } = azurePage(() => jsonResponse({}))
    sessionStorage.setItem('{msal-accesstoken}/management.core.windows.net/key', JSON.stringify({
      secret: `header.${jwtBody}.sig`,
      expiresOn: String(Math.floor(Date.now() / 1000) + 3600),
    }))
    const result = await runTool('com.azure.main', 'get_current_user', { input: {}, page })
    if (result.status !== 'ok') console.log('AZURE USER', JSON.stringify(result).slice(0, 200))
    equal(result.status, 'ok', 'azure get_current_user: ok')
    equal(result.data.user.display_name, 'Ada', 'azure get_current_user: name from JWT')
    equal(result.data.user.user_principal_name, 'ada@example.com', 'azure get_current_user: upn from JWT')
    equal(result.data.user.id, 'oid-1', 'azure get_current_user: oid claim')
  }

  {
    const { requests, page } = azurePage(() =>
      jsonResponse({
        value: [
          { subscriptionId: 'sub-1', displayName: 'Production', state: 'Enabled', tenantId: 't-1' },
        ],
      }),
    )
    const result = await runTool('com.azure.main', 'list_subscriptions', { input: {}, page })
    if (result.status !== 'ok') console.log('AZURE SUBS', JSON.stringify(result).slice(0, 300))

    equal(result.status, 'ok', 'azure list_subscriptions: ok')
    equal(result.data.subscriptions.length, 1, 'azure list_subscriptions: one subscription')
    equal(result.data.subscriptions[0].subscription_id, 'sub-1', 'azure list_subscriptions: id mapped')
    equal(result.data.subscriptions[0].display_name, 'Production', 'azure list_subscriptions: name mapped')
    equal(requests.length, 1, 'azure list_subscriptions: one request')
    ok(requests[0].url.startsWith('https://management.azure.com/subscriptions?'), 'azure: ARM endpoint')
    ok(requests[0].url.includes('api-version='), 'azure: api-version query')
    equal(requests[0].init.headers.Authorization, 'Bearer arm-token-abc', 'azure: bearer token from MSAL')
    equal(requests[0].init.credentials, 'omit', 'azure: ARM cross-origin omits credentials')
  }

  {
    const { requests, page } = azurePage(() =>
      jsonResponse({
        value: [
          { id: '/subscriptions/sub-1/resourcegroups/rg-1', name: 'rg-1', location: 'westeurope' },
        ],
      }),
    )
    const result = await runTool('com.azure.main', 'list_resource_groups', {
      input: { subscription_id: 'sub-1' },
      page,
    })
    equal(result.status, 'ok', 'azure list_resource_groups: ok')
    equal(result.data.resource_groups[0].name, 'rg-1', 'azure list_resource_groups: name')
    ok(requests[0].url.includes('/subscriptions/sub-1/resourcegroups'), 'azure: subscription-scoped path')
  }

  section('com.azure.main: writes')

  {
    const { requests, page } = azurePage(() =>
      jsonResponse({ id: '/subscriptions/sub-1/resourcegroups/rg-new', name: 'rg-new', location: 'westeurope' }),
    )
    const result = await runTool('com.azure.main', 'create_resource_group', {
      input: { subscription_id: 'sub-1', resource_group_name: 'rg-new', location: 'westeurope' },
      page,
    })

    equal(result.status, 'ok', 'azure create_resource_group: ok')
    equal(requests[0].init.method, 'PUT', 'azure create_resource_group: PUT')
    equal(JSON.parse(requests[0].init.body).location, 'westeurope', 'azure create_resource_group: location body')
    ok(requests[0].url.includes('/resourcegroups/rg-new?'), 'azure create_resource_group: path')
  }

  section('com.azure.main: failures')

  {
    const { page } = azurePage(() => jsonResponse({ error: { message: 'nope' } }, 401))
    const result = await runTool('com.azure.main', 'list_subscriptions', { input: {}, page })
    equal(result.status, 'error', 'azure 401: error status')
    equal(result.error_code, 'AUTH', 'azure 401: AUTH')
  }
}
