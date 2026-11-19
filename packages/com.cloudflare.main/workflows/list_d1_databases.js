// Self-contained adapter workflow for list_d1_databases. The Cloudflare dashboard
// session (ATOK token + account ID) and every /api/v4 call stay inside the
// dash.cloudflare.com tab.

export default {
  inputSchema: {
    "type": "object",
    "properties": {},
    "additionalProperties": false
  },
  outputSchema: {
    "type": "object",
    "properties": {
      "status": {
        "type": "string"
      },
      "data": {
        "type": [
          "object",
          "null"
        ]
      },
      "message": {
        "type": [
          "string",
          "null"
        ]
      },
      "error_code": {
        "type": [
          "string",
          "null"
        ]
      }
    },
    "required": [
      "status",
      "data"
    ],
    "additionalProperties": false
  },
  tree: {
    type: 'action',
    description: "list_d1_databases",
    async run({ input, state, target }) {
      const options = { tab: target.tabId, timeout: 25000 }
      const execute = async (args) => {
        var workflow = (() => {
// In-page Cloudflare runtime (translated from OpenTabs
// plugins/cloudflare/src/cloudflare-api.ts + tools/*.ts, MIT). It runs INSIDE
// the dash.cloudflare.com tab: the x-atok anti-forgery token is re-read from
// window.bootstrap.atok on every call, the account ID from the /<32-hex>/ URL
// prefix, and every API call goes through the dashboard's same-origin
// /api/v4 proxy with the session cookie.
function getPageGlobal(path) {
  try {
    var parts = path.split('.')
    var node = globalThis
    for (var i = 0; i < parts.length; i++) {
      if (node === null || node === undefined) return undefined
      node = node[parts[i]]
    }
    return node
  } catch (e) {
    return undefined
  }
}
function getAtok() {
  // Always read live: the dashboard re-issues atok on every page load.
  var atok = getPageGlobal('bootstrap.atok')
  return typeof atok === 'string' && atok.length > 0 ? atok : null
}
function currentPath() {
  // Real tabs expose location.pathname; the test sandbox only carries href.
  if (typeof location.pathname === 'string') return location.pathname
  var href = String(location.href || '')
  return href.replace(/^https?:\/\/[^/]+/, '') || '/'
}
function extractAccountId() {
  var match = currentPath().match(/^\/([a-f0-9]{32})\b/)
  return match ? match[1] : null
}
function getPersistedAccountId() {
  try {
    return sessionStorage.getItem('cf_account_id') || null
  } catch (e) {
    return null
  }
}
function setPersistedAccountId(accountId) {
  try {
    if (accountId) sessionStorage.setItem('cf_account_id', accountId)
    else sessionStorage.removeItem('cf_account_id')
  } catch (e) {}
}
function getAuth() {
  var atok = getAtok()
  if (!atok) return null
  var accountId = getPersistedAccountId() || extractAccountId()
  setPersistedAccountId(accountId)
  return { atok: atok, accountId: accountId }
}
function getAccountId() {
  var auth = getAuth()
  return auth ? auth.accountId : extractAccountId()
}
function buildQueryString(query) {
  var params = new URLSearchParams()
  var keys = Object.keys(query || {})
  for (var i = 0; i < keys.length; i++) {
    var value = query[keys[i]]
    if (Array.isArray(value)) {
      for (var j = 0; j < value.length; j++) {
        if (value[j] !== undefined) params.append(keys[i], String(value[j]))
      }
    } else if (value !== undefined) {
      params.append(keys[i], String(value))
    }
  }
  return params.toString()
}
function def(value, fallback) {
  return value === undefined || value === null ? fallback : value
}
// One fetch path for both the REST proxy and the GraphQL endpoint: same
// in-page deadline, same error classification, cookies always attached.
async function rawRequest(url, options) {
  options = options || {}
  var headers = options.headers || {}
  var body = options.body
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(body)
  }
  // Abort before the 25s browser command deadline so a timed-out call does
  // not leave the request running in the tab.
  var controller = null
  if (typeof AbortController === 'function') {
    try {
      controller = new AbortController()
    } catch (e) {}
  }
  var timer =
    controller !== null
      ? setTimeout(function () {
          try {
            controller.abort()
          } catch (e) {}
        }, 18000)
      : null
  var response
  try {
    response = await fetch(url, {
      method: options.method || 'GET',
      headers: headers,
      body: body,
      credentials: 'include',
      signal: controller ? controller.signal : undefined,
    })
  } catch (e) {
    if (timer !== null) clearTimeout(timer)
    var aborted =
      e &&
      (e.name === 'AbortError' ||
        e.name === 'TimeoutError' ||
        String(e).indexOf('abort') !== -1)
    if (aborted)
      return error('TIMEOUT', 'Cloudflare API request aborted after the 18s in-page deadline: ' + url)
    return error('NETWORK', 'Network error calling the Cloudflare API: ' + String(e))
  }
  if (!response.ok) {
    var text = ''
    try {
      text = await response.text()
    } catch (e) {}
    if (timer !== null) clearTimeout(timer)
    var code = 'INTERNAL'
    if (response.status === 401 || response.status === 403) code = 'AUTH'
    else if (response.status === 404) code = 'NOT_FOUND'
    else if (response.status === 429) code = 'RATE_LIMITED'
    if (code === 'AUTH') setPersistedAccountId(null)
    return error(
      code,
      'Cloudflare API error (' + response.status + '): ' + url + ' — ' + String(text || '').slice(0, 512),
    )
  }
  var data
  try {
    data = await response.json()
  } catch (e) {
    if (timer !== null) clearTimeout(timer)
    return error('INTERNAL', 'Cloudflare API returned invalid JSON: ' + url)
  }
  if (timer !== null) clearTimeout(timer)
  return { ok: true, data: data }
}
// cloudflareApi(): the dashboard's same-origin proxy, plus the standard
// { success, errors } envelope check.
async function cfApi(endpoint, options) {
  options = options || {}
  var auth = getAuth()
  if (!auth) return error('AUTH', 'Not authenticated — please log in to Cloudflare.')
  var url = '/api/v4' + endpoint
  var qs = options.query ? buildQueryString(options.query) : ''
  if (qs) url += '?' + qs
  var response = await rawRequest(url, {
    method: options.method || 'GET',
    headers: { 'x-atok': auth.atok },
    body: options.body,
  })
  if (!response.ok) return response
  var data = response.data
  if (!data) return error('INTERNAL', 'Cloudflare API returned an empty response: ' + url)
  if (data.success === false) {
    var msg = ''
    if (Array.isArray(data.errors) && data.errors.length > 0) {
      msg = data.errors
        .map(function (e) {
          return '[' + (e && e.code) + '] ' + (e && e.message)
        })
        .join('; ')
    }
    return error('INTERNAL', 'Cloudflare API error: ' + (msg || 'request failed'))
  }
  return { ok: true, data: data }
}

// --- mappers (OpenTabs tools/schemas.ts) ---
function mapZone(z) {
  z = z || {}
  var account = z.account
  var plan = z.plan
  return {
    id: z.id || '',
    name: z.name || '',
    status: z.status || '',
    paused: z.paused === undefined ? false : !!z.paused,
    type: z.type || '',
    name_servers: Array.isArray(z.name_servers) ? z.name_servers : [],
    plan_name: (plan && plan.name) || '',
    created_on: z.created_on || '',
    modified_on: z.modified_on || '',
    account_id: (account && account.id) || '',
    account_name: (account && account.name) || '',
  }
}
function mapDnsRecord(r) {
  r = r || {}
  return {
    id: r.id || '',
    type: r.type || '',
    name: r.name || '',
    content: r.content || '',
    proxied: r.proxied === undefined ? false : !!r.proxied,
    ttl: r.ttl === undefined ? 1 : r.ttl,
    priority: r.priority === undefined ? null : r.priority,
    comment: r.comment === undefined ? null : r.comment,
    created_on: r.created_on || '',
    modified_on: r.modified_on || '',
  }
}
function mapWorker(w) {
  w = w || {}
  return {
    id: w.id || '',
    created_on: w.created_on || '',
    modified_on: w.modified_on || '',
    etag: w.etag || '',
    usage_model: w.usage_model || '',
    compatibility_date: w.compatibility_date === undefined ? null : w.compatibility_date,
  }
}
function mapPagesProject(p) {
  p = p || {}
  var source = p.source
  var config = source && source.config
  return {
    id: p.id || '',
    name: p.name || '',
    subdomain: p.subdomain || '',
    production_branch: p.production_branch || 'main',
    created_on: p.created_on || '',
    source_type: (source && source.type) || null,
    source_repo: config
      ? (config.owner || '') + '/' + (config.repo_name || '')
      : null,
  }
}
function mapPagination(info) {
  info = info || {}
  return {
    page: def(info.page, 1),
    per_page: def(info.per_page, 20),
    count: def(info.count, 0),
    total_count: def(info.total_count, 0),
    total_pages: def(info.total_pages, 0),
  }
}
function mapZoneSetting(s) {
  s = s || {}
  return {
    id: s.id || '',
    value: s.value,
    editable: s.editable === undefined ? false : !!s.editable,
    modified_on: s.modified_on === undefined ? null : s.modified_on,
  }
}

function ok(data) {
  return { status: 'ok', data: data, message: null }
}
function error(code, message) {
  return { status: 'error', data: null, error_code: code, message: message }
}
function requireAccountId(message) {
  var accountId = getAccountId()
  if (!accountId) return { error: error('VALIDATION', message) }
  return { accountId: accountId }
}

          var cfToolImplementations = {
            async list_d1_databases(args) {
        var account = requireAccountId('Could not determine account ID. Navigate to an account page first.')
        if (account.error) return account.error
        var response = await cfApi('/accounts/' + encodeURIComponent(account.accountId) + '/d1/database')
        if (!response.ok) return response
        var dbs = Array.isArray(response.data.result) ? response.data.result : []
        return ok({
          databases: dbs.map(function (d) {
            return {
              uuid: d.uuid || '',
              name: d.name || '',
              version: d.version || '',
              num_tables: def(d.num_tables, 0),
              file_size: def(d.file_size, 0),
              created_at: d.created_at || '',
            }
          }),
        })
            },
          }

          async function stdin_default(args) {
            return cfToolImplementations["list_d1_databases"](args)
          }
          return stdin_default
        })()

        return workflow(args)
      }
      let response
      try {
        response = await browser.eval(
          '() => (' + execute.toString() + ')(' + JSON.stringify(input) + ')',
          options,
        )
      } catch (error) {
        // Tab closed/navigated or the eval timed out: surface a stable
        // workflow error instead of letting the adapter rejection escape.
        state.result = {
          status: 'error',
          data: null,
          message:
            'The dash.cloudflare.com tab could not run the tool (it may have closed or navigated away): ' +
            String(error),
          error_code: 'TAB_UNAVAILABLE',
        }
        return 'success'
      }
      if (response.tabId !== target.tabId) {
        state.result = {
          status: 'error',
          data: null,
          message: 'Browser returned another tab',
          error_code: 'TAB_UNAVAILABLE',
        }
        return 'success'
      }
      const result = response.result
      if (result && result.status === 'ok')
        state.result = { status: 'ok', data: result.data, message: null }
      else if (result)
        state.result = {
          status: 'error',
          data: null,
          message: result.message || 'Cloudflare API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The dash.cloudflare.com tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
