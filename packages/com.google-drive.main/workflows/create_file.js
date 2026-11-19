// Self-contained adapter workflow. The Google Drive session and every
// gapi.client.request stay inside the drive.google.com tab.

export default {
  inputSchema: {
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "description": "File name"
    },
    "mime_type": {
      "description": "MIME type. Defaults to \"application/vnd.google-apps.document\" (Google Doc). Use \"application/vnd.google-apps.spreadsheet\" for Sheets, \"application/vnd.google-apps.presentation\" for Slides, \"text/plain\" for text files.",
      "type": "string"
    },
    "parent_id": {
      "description": "Parent folder ID. Defaults to My Drive root.",
      "type": "string"
    },
    "description": {
      "description": "File description",
      "type": "string"
    }
  },
  "required": [
    "name"
  ],
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
    description: 'create_file',
    async run({ input, state, target }) {
      const options = { tab: target.tabId, timeout: 25000 }
      const execute = async (args) => {
        var workflow = (() => {

          // Page-side Google Drive runtime (translated from OpenTabs
          // google-drive-api.ts and tools/schemas.ts, MIT). Runs INSIDE the
          // drive.google.com tab: gapi signs each call with the tab's own session
          // cookies (SAPISIDHASH), so no credential is ever read out or returned.
          var API_BASE = '/drive/v3'
          // A stalled gapi request must not outlive the 25s browser-eval budget.
          var API_DEADLINE_MS = 18000
          // Upstream waitForAuth(): poll gapi.client.request every 500ms, give up
          // after 8s. On a logged-out tab the app never publishes gapi.
          var AUTH_POLL_MS = 500
          var AUTH_WAIT_MS = 8000
          // Upstream ships this literal redacted ('AIzaSy...Sz_8') in every
          // published artifact (0.0.74-0.0.89), so it cannot be reproduced here;
          // the Drive app has already configured its own gapi client, which is why
          // requests still authenticate through the tab's session.
          var DRIVE_API_KEY = ''
          var FILE_FIELDS =
            'id,name,mimeType,modifiedTime,createdTime,size,parents,trashed,starred,shared,webViewLink,iconLink,description,owners(displayName,emailAddress),lastModifyingUser(displayName,emailAddress)'
          var FILE_LIST_FIELDS = 'nextPageToken,files(' + FILE_FIELDS + ')'
          var apiKeySet = false

          function getPageGlobal(path) {
            try {
              var parts = String(path).split('.')
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
          function toolError(code, message) {
            var error = new Error(message)
            error.__toolError = code
            return error
          }
          function getGapiRequest() {
            var requestFn = getPageGlobal('gapi.client.request')
            return typeof requestFn === 'function' ? requestFn : null
          }
          function isAuthenticated() {
            return getGapiRequest() !== null
          }
          function sleep(ms) {
            return new Promise(function (resolve) {
              setTimeout(resolve, ms)
            })
          }
          // Mirrors upstream waitForAuth(): resolve with the request function as
          // soon as gapi is published, or with null once the 8s window is gone.
          async function waitForGapi() {
            var started = Date.now()
            while (Date.now() - started < AUTH_WAIT_MS) {
              var requestFn = getGapiRequest()
              if (requestFn) return requestFn
              await sleep(AUTH_POLL_MS)
            }
            return getGapiRequest()
          }
          function ensureApiKey() {
            if (apiKeySet || !DRIVE_API_KEY) return
            var setApiKey = getPageGlobal('gapi.client.setApiKey')
            if (typeof setApiKey === 'function') {
              setApiKey(DRIVE_API_KEY)
              apiKeySet = true
            }
          }
          function cleanParams(params) {
            if (!params) return undefined
            var out = {}
            var keys = Object.keys(params)
            for (var i = 0; i < keys.length; i++) {
              var value = params[keys[i]]
              if (value !== undefined) out[keys[i]] = value
            }
            return out
          }
          function buildQueryString(params) {
            if (!params) return ''
            var search = new URLSearchParams()
            var keys = Object.keys(params)
            for (var i = 0; i < keys.length; i++) {
              var value = params[keys[i]]
              if (value === undefined || value === null) continue
              search.append(keys[i], String(value))
            }
            return search.toString()
          }
          // Google's JSON endpoints used to answer with an XSSI guard line;
          // stripping it keeps a valid payload from becoming a parse error.
          function stripXssiPrefix(text) {
            var body = String(text === undefined || text === null ? '' : text)
            if (body.charCodeAt(0) === 0xfeff) body = body.slice(1)
            if (body.indexOf(")]}'") === 0) {
              var newline = body.indexOf('\n')
              body = newline === -1 ? '' : body.slice(newline + 1)
            }
            return body
          }
          // Same classification as upstream api(): 401/403 auth, 404 not found,
          // 429 rate limited, 400/422 validation, everything else internal.
          function classifyStatus(status, message) {
            if (status === 401 || status === 403) return toolError('AUTH', message)
            if (status === 404) return toolError('NOT_FOUND', message)
            if (status === 429) return toolError('RATE_LIMITED', message)
            if (status === 400 || status === 422) return toolError('VALIDATION', message)
            return toolError('INTERNAL', '(' + (status === undefined ? 'unknown' : status) + ') ' + message)
          }
          // gapi.client.request resolves (and rejects) with { status, result,
          // body, headers }. A deadline keeps a stalled call bounded.
          function gapiRequest(requestFn, options) {
            return new Promise(function (resolve, reject) {
              var settled = false
              var timer = setTimeout(function () {
                if (settled) return
                settled = true
                reject(toolError('TIMEOUT', 'Google Drive request timed out after the 18s in-page deadline.'))
              }, API_DEADLINE_MS)
              function finish(fn, value) {
                if (settled) return
                settled = true
                clearTimeout(timer)
                fn(value)
              }
              try {
                requestFn(options).then(
                  function (response) {
                    finish(resolve, response)
                  },
                  function (error) {
                    finish(reject, error)
                  },
                )
              } catch (e) {
                finish(reject, e)
              }
            })
          }
          // Same path/method/params as the gapi call, sent as a same-origin fetch
          // with the tab's cookies, for a tab where the Drive app has not exposed
          // gapi yet. Google answers an unknown /drive/v3 path on this host with
          // the marketing HTML page, reported as "not ready" instead of as data.
          async function fetchApi(path, options, endpoint, body) {
            var url = location.origin + path
            var query = buildQueryString(options.params)
            if (query) url += '?' + query
            var headers = {}
            if (body !== undefined) headers['Content-Type'] = 'application/json'
            var controller = null
            if (typeof AbortController === 'function') {
              try {
                controller = new AbortController()
              } catch (e) {
                controller = null
              }
            }
            var timer =
              controller !== null
                ? setTimeout(function () {
                    try {
                      controller.abort()
                    } catch (e) {}
                  }, API_DEADLINE_MS)
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
              var aborted = e && (e.name === 'AbortError' || String(e).indexOf('abort') !== -1)
              if (aborted) throw toolError('TIMEOUT', 'Google Drive request aborted after the 18s in-page deadline.')
              throw toolError('NETWORK', 'Network error calling Google Drive: ' + String(e))
            }
            var text = ''
            try {
              text = await response.text()
            } catch (e) {}
            if (timer !== null) clearTimeout(timer)
            if (response.status === 204) return {}
            var payload = stripXssiPrefix(text)
            var data = null
            if (payload) {
              try {
                data = JSON.parse(payload)
              } catch (e) {
                data = null
              }
            }
            if (response.status < 200 || response.status >= 300) {
              var detail = (data && data.error && data.error.message) || payload.slice(0, 512)
              throw classifyStatus(response.status, detail || 'API error: ' + endpoint)
            }
            if (data === null) {
              throw toolError('AUTH', 'Google Drive is not ready — please open Google Drive and sign in.')
            }
            return data
          }
          async function api(endpoint, options) {
            options = options || {}
            var path = API_BASE + endpoint
            var body = options.body ? JSON.stringify(options.body) : undefined
            var requestFn = getGapiRequest() || (await waitForGapi())
            if (requestFn) {
              ensureApiKey()
              var response
              try {
                response = await gapiRequest(requestFn, {
                  path: path,
                  method: options.method,
                  params: cleanParams(options.params),
                  body: body,
                })
              } catch (error) {
                if (error && error.__toolError) throw error
                var status = error && error.status
                var message =
                  (error && error.result && error.result.error && error.result.error.message) ||
                  'API error: ' + endpoint
                throw classifyStatus(status, message)
              }
              return response && response.result !== undefined && response.result !== null
                ? response.result
                : {}
            }
            return await fetchApi(path, options, endpoint, body)
          }
          // Void caller: a 204 No Content DELETE resolves/rejects with status 204
          // and no body, which upstream treats as success.
          async function apiVoid(endpoint, options) {
            options = options || {}
            var path = API_BASE + endpoint
            var requestFn = getGapiRequest() || (await waitForGapi())
            if (requestFn) {
              ensureApiKey()
              try {
                await gapiRequest(requestFn, {
                  path: path,
                  method: options.method,
                  params: cleanParams(options.params),
                })
              } catch (error) {
                if (error && error.__toolError) throw error
                var status = error && error.status
                if (status === 204) return
                var message =
                  (error && error.result && error.result.error && error.result.error.message) ||
                  'API error: ' + endpoint
                throw classifyStatus(status, message)
              }
              return
            }
            await fetchApi(path, options, endpoint, undefined)
          }

          // --- mappers (OpenTabs tools/schemas.ts) ---
          function mapUser(u) {
            u = u || {}
            return {
              display_name: u.displayName === undefined || u.displayName === null ? '' : u.displayName,
              email: u.emailAddress === undefined || u.emailAddress === null ? '' : u.emailAddress,
              permission_id: u.permissionId === undefined || u.permissionId === null ? '' : u.permissionId,
              photo_link: u.photoLink === undefined || u.photoLink === null ? '' : u.photoLink,
            }
          }
          function mapStorageQuota(q) {
            q = q || {}
            return {
              limit_bytes: q.limit === undefined || q.limit === null ? '0' : q.limit,
              usage_bytes: q.usage === undefined || q.usage === null ? '0' : q.usage,
              usage_in_drive_bytes:
                q.usageInDrive === undefined || q.usageInDrive === null ? '0' : q.usageInDrive,
              usage_in_trash_bytes:
                q.usageInDriveTrash === undefined || q.usageInDriveTrash === null ? '0' : q.usageInDriveTrash,
            }
          }
          function mapFile(f) {
            f = f || {}
            var parents = f.parents || []
            var owners = f.owners || []
            var owner = owners[0] || {}
            var modifier = f.lastModifyingUser || {}
            return {
              id: f.id === undefined || f.id === null ? '' : f.id,
              name: f.name === undefined || f.name === null ? '' : f.name,
              mime_type: f.mimeType === undefined || f.mimeType === null ? '' : f.mimeType,
              modified_time: f.modifiedTime === undefined || f.modifiedTime === null ? '' : f.modifiedTime,
              created_time: f.createdTime === undefined || f.createdTime === null ? '' : f.createdTime,
              size: f.size === undefined || f.size === null ? '' : f.size,
              parent_id: parents.length > 0 ? parents[0] : '',
              trashed: f.trashed === undefined || f.trashed === null ? false : !!f.trashed,
              starred: f.starred === undefined || f.starred === null ? false : !!f.starred,
              shared: f.shared === undefined || f.shared === null ? false : !!f.shared,
              web_view_link: f.webViewLink === undefined || f.webViewLink === null ? '' : f.webViewLink,
              description: f.description === undefined || f.description === null ? '' : f.description,
              owner: owner.displayName === undefined || owner.displayName === null ? '' : owner.displayName,
              owner_email: owner.emailAddress === undefined || owner.emailAddress === null ? '' : owner.emailAddress,
              last_modified_by:
                modifier.displayName === undefined || modifier.displayName === null ? '' : modifier.displayName,
            }
          }
          function mapFiles(list) {
            var out = []
            var items = list || []
            for (var i = 0; i < items.length; i++) out.push(mapFile(items[i]))
            return out
          }
          function mapPermission(p) {
            p = p || {}
            return {
              id: p.id === undefined || p.id === null ? '' : p.id,
              type: p.type === undefined || p.type === null ? '' : p.type,
              role: p.role === undefined || p.role === null ? '' : p.role,
              email: p.emailAddress === undefined || p.emailAddress === null ? '' : p.emailAddress,
              display_name: p.displayName === undefined || p.displayName === null ? '' : p.displayName,
              domain: p.domain === undefined || p.domain === null ? '' : p.domain,
            }
          }

          function ok(data) {
            return { status: 'ok', data: data, message: null, page_url: location.href }
          }
          function error(code, message) {
            return {
              status: 'error',
              data: null,
              error_code: code,
              message: message,
              page_url: location.href,
            }
          }
          function assertPage() {
            if (location.hostname !== 'drive.google.com')
              return error('UNSUPPORTED_PAGE', 'Not on a drive.google.com page.')
            return null
          }

          var driveToolImplementations = {

            async create_file(args) {
              var body = {
                name: args.name,
                mimeType:
                  args.mime_type === undefined || args.mime_type === null
                    ? 'application/vnd.google-apps.document'
                    : args.mime_type,
              }
              if (args.parent_id) body.parents = [args.parent_id]
              if (args.description) body.description = args.description
              var data = await api('/files', {
                method: 'POST',
                params: { fields: FILE_FIELDS },
                body: body,
              })
              return { file: mapFile(data) }
            }
          }

          async function stdin_default(args) {
            try {
              var pageError = assertPage()
              if (pageError) return pageError
              var data = await driveToolImplementations['create_file'](args)
              return ok(data)
            } catch (e) {
              return error(
                e && e.__toolError ? e.__toolError : 'INTERNAL',
                e && e.message ? e.message : String(e),
              )
            }
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
            'The drive.google.com tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'Google Drive API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The drive.google.com tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
