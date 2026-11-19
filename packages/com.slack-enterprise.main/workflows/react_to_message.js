// Self-contained adapter workflow. The xoxc- / xoxp tokens and every
// app.slack.com /api/ call stay inside the app.slack.com tab.
export default {
  inputSchema: {"type": "object", "properties": {"channel": {"type": "string", "description": "Channel ID where the message is located (e.g., C1234567890)"}, "timestamp": {"type": "string", "description": "Timestamp of the message to react to"}, "emoji": {"type": "string", "description": "Emoji name without colons (e.g., \"thumbsup\", \"heart\", \"rocket\")"}}, "required": ["channel", "timestamp", "emoji"], "additionalProperties": false},
  outputSchema: {"type": "object", "properties": {"success": {"type": "boolean"}}, "required": ["success"], "additionalProperties": false},
  tree: {
    type: 'action',
    description: 'react_to_message',
    async run({ input, state, target }) {
      const options = { tab: target.tabId, timeout: 25000 }
      const execute = async (args) => {
        var workflow = (() => {

          // Page-side Slack Enterprise Grid runtime (translated from OpenTabs
          // slack-enterprise-api.ts + tools/*.ts, MIT). Runs INSIDE the app.slack.com
          // tab: the xoxc- xoxc/xoxp tokens live in the page's own localStorage /
          // boot_data and never leave page context.
          var API_DEADLINE_MS = 18000
          var UPLOAD_DEADLINE_MS = 60000
          var AUTH_CACHE_SLOT = '__slackee_auth_cache'
          var AUTH_CACHE_TTL_MS = 300000
          var SLACK_AUTH_ERRORS = ['not_authed', 'invalid_auth', 'account_inactive', 'token_revoked', 'token_expired', 'missing_scope']
          var SLACK_NOT_FOUND_ERRORS = ['channel_not_found', 'user_not_found', 'message_not_found', 'not_in_channel']
          var SLACK_VALIDATION_ERRORS = ['invalid_arguments', 'too_many_attachments', 'msg_too_long', 'no_text', 'invalid_blocks']

          function orEmpty(value) {
            return value === undefined || value === null ? '' : value
          }
          function orDefault(value, fallback) {
            return value === undefined || value === null ? fallback : value
          }
          // Upstream's ToolError carries a category; here the same object shape is
          // kept so ported handler code (`error instanceof ToolError`, `.category`)
          // runs unchanged, with `__toolError` for the adapter envelope.
          class ToolError extends Error {
            constructor(message, code, category) {
              super(message)
              this.name = 'ToolError'
              this.__toolError = code || 'INTERNAL'
              this.category = category || null
            }
            static auth(message) {
              return new ToolError(message, 'AUTH', 'auth')
            }
            static notFound(message) {
              return new ToolError(message, 'NOT_FOUND', 'not_found')
            }
            static validation(message) {
              return new ToolError(message, 'VALIDATION', 'validation')
            }
            static rateLimited(message) {
              return new ToolError(message, 'RATE_LIMITED', 'rate_limit')
            }
            static internal(message) {
              return new ToolError(message, 'INTERNAL', 'internal')
            }
            static timeout(message) {
              return new ToolError(message, 'TIMEOUT', 'timeout')
            }
          }
          function classifySlackError(record) {
            var code = typeof record.error === 'string' ? record.error : 'unknown_error'
            var message = 'Slack API error: ' + code
            if (SLACK_AUTH_ERRORS.indexOf(code) !== -1) throw ToolError.auth(message)
            if (SLACK_NOT_FOUND_ERRORS.indexOf(code) !== -1) throw ToolError.notFound(message)
            if (code === 'ratelimited') throw ToolError.rateLimited(message)
            if (SLACK_VALIDATION_ERRORS.indexOf(code) !== -1) throw ToolError.validation(message)
            throw ToolError.internal(message)
          }
          function parseRetryAfterMs(value) {
            if (value === null || value === undefined) return undefined
            var text = String(value).trim()
            if (/^\d+$/.test(text)) return parseInt(text, 10) * 1000
            var when = Date.parse(text)
            if (isNaN(when)) return undefined
            var delta = when - Date.now()
            return delta > 0 ? delta : 0
          }
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
          function getLocalStorageValue(key) {
            try {
              if (typeof localStorage === 'undefined' || !localStorage) return null
              var value = localStorage.getItem(key)
              return typeof value === 'string' ? value : null
            } catch (e) {
              return null
            }
          }
          // AbortController may be missing in a stripped page context; the request
          // still has to be cancellable, so the timer is only wired when it exists.
          function startDeadline(ms) {
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
                  }, ms)
                : null
            return { controller: controller, timer: timer, signal: controller ? controller.signal : undefined }
          }
          function endDeadline(handle) {
            if (handle && handle.timer !== null && handle.timer !== undefined) clearTimeout(handle.timer)
          }
          function stripTrailingSlash(value) {
            return String(value || '').replace(/\/$/, '')
          }

          // --- transport (slack-enterprise-api.ts) --------------------------------
          // localConfig_v2/v3 holds one entry per team; the enterprise org is the
          // E-prefix entry and the workspace is a T-prefix entry.
          function readLocalConfig() {
            var keys = ['localConfig_v2', 'localConfig_v3']
            for (var i = 0; i < keys.length; i++) {
              var raw = getLocalStorageValue(keys[i])
              if (!raw) continue
              try {
                return { raw: raw, config: JSON.parse(raw) }
              } catch (e) {
                return null
              }
            }
            return null
          }
          // The org token cannot call workspace APIs directly; the enterprise client
          // boots through client.userBoot to learn the default workspace team id.
          async function discoverWorkspaceTeamId(enterpriseToken, enterpriseId) {
            try {
              var form = new URLSearchParams()
              form.append('token', enterpriseToken)
              form.append('_x_reason', 'api_call')
              form.append('_x_mode', 'online')
              form.append('_x_sonic', 'true')
              form.append('_x_app_name', 'client')
              form.append('_x_team_id', enterpriseId)
              var deadline = startDeadline(15000)
              var response
              try {
                response = await fetch('/api/client.userBoot', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                  body: form.toString(),
                  credentials: 'include',
                  signal: deadline.signal,
                })
              } finally {
                endDeadline(deadline)
              }
              if (!response.ok) return null
              var data = await response.json()
              if (!data || data.ok !== true) return null
              if (data.default_workspace) return data.default_workspace
              if (data.workspaces && data.workspaces[0] && data.workspaces[0].id) return data.workspaces[0].id
              return null
            } catch (e) {
              return null
            }
          }
          async function getAuthFromLocalConfig() {
            try {
              var found = readLocalConfig()
              if (!found) return null
              var config = found.config
              if (!config || !config.teams) return null
              var teamIds = Object.keys(config.teams)
              var enterpriseId = null
              for (var i = 0; i < teamIds.length; i++) {
                if (teamIds[i].charAt(0) === 'E') {
                  enterpriseId = teamIds[i]
                  break
                }
              }
              if (!enterpriseId) return null
              var workspaceIds = []
              for (var j = 0; j < teamIds.length; j++) {
                if (teamIds[j].charAt(0) === 'T') workspaceIds.push(teamIds[j])
              }
              var enterpriseTeam = config.teams[enterpriseId] || {}
              var enterpriseToken = enterpriseTeam.token || null
              var workspaceTeamId = null
              var workspaceToken = null
              var workspaceUrl = ''
              if (workspaceIds.length > 0) {
                var firstWsId = workspaceIds[0]
                var wsTeam = config.teams[firstWsId] || {}
                workspaceTeamId = firstWsId
                workspaceToken = wsTeam.token || null
                workspaceUrl = wsTeam.url || ''
              }
              if (!workspaceToken && enterpriseToken) {
                var discoveredId = await discoverWorkspaceTeamId(enterpriseToken, enterpriseId)
                if (discoveredId && config.teams[discoveredId]) {
                  workspaceTeamId = discoveredId
                  var discoveredTeam = config.teams[discoveredId] || {}
                  workspaceToken = discoveredTeam.token || null
                  workspaceUrl = discoveredTeam.url || ''
                }
              }
              if (!workspaceToken && enterpriseToken) {
                workspaceToken = enterpriseToken
                workspaceTeamId = enterpriseId
                workspaceUrl = enterpriseTeam.url || ''
              }
              if (!workspaceToken || !workspaceTeamId) return null
              return {
                workspaceToken: workspaceToken,
                workspaceTeamId: workspaceTeamId,
                workspaceUrl: stripTrailingSlash(workspaceUrl) || location.origin,
                enterpriseToken: enterpriseToken,
                enterpriseId: enterpriseId,
                signature: found.raw,
              }
            } catch (e) {
              return null
            }
          }
          // boot_data only counts for an Enterprise Grid install, which is exactly
          // what upstream's `enterprise_id` check means.
          function getAuthFromBootData() {
            try {
              var bootData = getPageGlobal('boot_data')
              if (!bootData || typeof bootData.api_token !== 'string') return null
              if (bootData.api_token.indexOf('xoxc-') !== 0) return null
              if (!bootData.enterprise_id) return null
              var teamId = typeof bootData.team_id === 'string' ? bootData.team_id : ''
              var teamUrl = typeof bootData.team_url === 'string' ? stripTrailingSlash(bootData.team_url) : ''
              return {
                workspaceToken: bootData.api_token,
                workspaceTeamId: teamId,
                workspaceUrl: teamUrl || location.origin,
                enterpriseToken: null,
                enterpriseId: bootData.enterprise_id,
                signature: bootData.api_token,
              }
            } catch (e) {
              return null
            }
          }
          // A tab that switched accounts must not keep using the previous token, so
          // the cache entry is keyed on the auth source it was derived from.
          function currentAuthSignature() {
            var found = readLocalConfig()
            if (found) return found.raw
            var bootData = getPageGlobal('boot_data')
            if (bootData && typeof bootData.api_token === 'string') return bootData.api_token
            return null
          }
          function readAuthCache() {
            try {
              var entry = globalThis[AUTH_CACHE_SLOT]
              if (!entry || !entry.auth) return null
              if (Date.now() - entry.at > AUTH_CACHE_TTL_MS) return null
              var signature = currentAuthSignature()
              if (signature === null || signature !== entry.signature) return null
              return entry.auth
            } catch (e) {
              return null
            }
          }
          function writeAuthCache(auth) {
            try {
              globalThis[AUTH_CACHE_SLOT] = { auth: auth, signature: auth.signature, at: Date.now() }
            } catch (e) {}
          }
          async function getAuth() {
            var cached = readAuthCache()
            if (cached) return cached
            var auth = (await getAuthFromLocalConfig()) || getAuthFromBootData()
            if (auth) writeAuthCache(auth)
            return auth
          }
          function requireAuth(auth, label) {
            if (!auth) throw ToolError.auth('Not authenticated — no enterprise Slack session found')
            if (!auth.workspaceToken) throw ToolError.auth('Not authenticated — no Slack workspace token found')
            return auth
          }

          // Shared response handling: rate limits, HTTP status, Slack's
          // {ok:false,error} envelope.
          async function readSlackResponse(response, label, validationOn400) {
            if (response.status === 429) {
              var retryAfter = null
              try {
                retryAfter = response.headers && response.headers.get ? response.headers.get('Retry-After') : null
              } catch (e) {}
              var retryMs = parseRetryAfterMs(retryAfter)
              var hint =
                retryMs !== undefined
                  ? '. Retry after ' + Math.ceil(retryMs / 1000) + 's'
                  : retryAfter
                    ? '. Retry after ' + retryAfter + ' seconds'
                    : ''
              throw ToolError.rateLimited('Slack API rate limited (429)' + hint + ' [' + label + ']')
            }
            if (!response.ok) {
              var errorText = ''
              try {
                errorText = await response.text()
              } catch (e) {}
              var httpMessage = label + ': Slack API HTTP ' + response.status + ': ' + errorText
              if (response.status === 401 || response.status === 403) throw ToolError.auth(httpMessage)
              if (response.status === 404) throw ToolError.notFound(httpMessage)
              if (response.status === 400 && validationOn400) throw ToolError.validation(httpMessage)
              throw new ToolError(httpMessage, 'HTTP', 'internal')
            }
            var data
            try {
              data = await response.json()
            } catch (e) {
              throw new ToolError(label + ': failed to parse Slack API response', 'HTTP', 'internal')
            }
            if (typeof data !== 'object' || data === null)
              throw new ToolError(label + ': invalid API response format', 'HTTP', 'internal')
            if (data.ok !== true) classifySlackError(data)
            return data
          }
          // One absolute in-page deadline so a stalled request is aborted before the
          // 25s browser-eval timeout orphans it (upstream allows 30s).
          async function slackRequest(url, init, label, validationOn400, omitCredentials) {
            var deadline = startDeadline(API_DEADLINE_MS)
            var response
            try {
              response = await fetch(url, {
                method: init.method || 'GET',
                headers: init.headers,
                body: init.body,
                credentials: omitCredentials ? 'omit' : 'include',
                signal: deadline.signal,
              })
            } catch (e) {
              endDeadline(deadline)
              var aborted = e && (e.name === 'AbortError' || String(e).indexOf('abort') !== -1)
              if (aborted) throw ToolError.timeout(label + ': request aborted after the 18s in-page deadline')
              throw new ToolError(label + ': network error: ' + String(e), 'NETWORK', 'internal')
            }
            try {
              return await readSlackResponse(response, label, validationOn400)
            } finally {
              endDeadline(deadline)
            }
          }
          function buildForm(auth, token, teamId, params) {
            var form = new URLSearchParams()
            form.append('token', token)
            var keys = Object.keys(params || {})
            for (var i = 0; i < keys.length; i++) {
              var value = params[keys[i]]
              if (value === undefined || value === null) continue
              form.append(keys[i], typeof value === 'object' ? JSON.stringify(value) : String(value))
            }
            form.append('_x_reason', 'api_call')
            form.append('_x_mode', 'online')
            form.append('_x_sonic', 'true')
            form.append('_x_app_name', 'client')
            form.append('_x_team_id', teamId)
            return form.toString()
          }
          // Workspace-token call: form-encoded POST to the same-origin /api/<method>,
          // exactly the shape the Slack web client sends.
          async function slackApi(method, params) {
            var auth = requireAuth(await getAuth(), 'slackApi:' + method)
            return await slackRequest(
              '/api/' + method,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: buildForm(auth, auth.workspaceToken, auth.workspaceTeamId, params),
              },
              'slackApi:' + method,
              false,
              false,
            )
          }
          // Org-token call for enterprise-level APIs (saved.list, search.modules).
          async function slackEnterpriseApi(method, params) {
            var auth = await getAuth()
            if (!auth || !auth.enterpriseToken) throw ToolError.auth('No enterprise org token available')
            return await slackRequest(
              '/api/' + method,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: buildForm(auth, auth.enterpriseToken, auth.enterpriseId, params),
              },
              'slackEnterpriseApi:' + method,
              false,
              false,
            )
          }
          async function getWorkspaceTeamId() {
            var auth = requireAuth(await getAuth(), 'getWorkspaceTeamId')
            return auth.workspaceTeamId
          }

          // --- encoding helpers (upload_file) --------------------------------------
          function encodeUtf8(text) {
            if (typeof TextEncoder === 'function') return new TextEncoder().encode(text)
            var str = String(text)
            var bytes = []
            for (var i = 0; i < str.length; i++) {
              var code = str.charCodeAt(i)
              if (code < 0x80) {
                bytes.push(code)
              } else if (code < 0x800) {
                bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
              } else if (code >= 0xd800 && code <= 0xdbff) {
                var next = str.charCodeAt(i + 1)
                if (next >= 0xdc00 && next <= 0xdfff) {
                  var cp = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00)
                  i++
                  bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
                } else {
                  bytes.push(0xef, 0xbf, 0xbd)
                }
              } else {
                bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
              }
            }
            return new Uint8Array(bytes)
          }
          function parseUrl(value) {
            var text = String(value || '')
            if (typeof URL === 'function') {
              try {
                var parsed = new URL(text)
                return { hostname: parsed.hostname, protocol: parsed.protocol }
              } catch (e) {
                return null
              }
            }
            var match = /^([a-z][a-z0-9+.-]*:)\/\/([^/?#]+)/i.exec(text)
            if (!match) return null
            var host = match[2].split('@').pop().split(':')[0].toLowerCase()
            return { hostname: host, protocol: match[1].toLowerCase() }
          }
          // The pre-signed upload URL is on files.slack.com and already carries its
          // own auth in the query string: no cookies, no credentials.
          async function uploadContent(uploadUrl, contentBytes) {
            var deadline = startDeadline(UPLOAD_DEADLINE_MS)
            try {
              return await fetch(uploadUrl, { method: 'POST', body: contentBytes, signal: deadline.signal })
            } finally {
              endDeadline(deadline)
            }
          }

          // --- input defaults -------------------------------------------------------
          // The host validates args without coercing or filling zod defaults, so the
          // published schema's `default` values are applied here, as upstream did.
          function applyDefaults(schema, value) {
            if (!schema || typeof schema !== 'object') return value
            if (value === undefined || value === null) {
              if (schema.default !== undefined) return schema.default
              return value
            }
            if (schema.type === 'object' && typeof value === 'object' && !Array.isArray(value)) {
              var out = {}
              var given = Object.keys(value)
              for (var i = 0; i < given.length; i++) out[given[i]] = value[given[i]]
              var props = schema.properties || {}
              var names = Object.keys(props)
              for (var j = 0; j < names.length; j++) {
                var name = names[j]
                if (out[name] === undefined && props[name].default !== undefined) out[name] = props[name].default
                else if (out[name] !== undefined) out[name] = applyDefaults(props[name], out[name])
              }
              return out
            }
            if (schema.type === 'array' && Array.isArray(value) && schema.items) {
              return value.map(function (item) {
                return applyDefaults(schema.items, item)
              })
            }
            return value
          }

          // --- mappers (OpenTabs tools/schemas.ts) ---------------------------------
          function mapChannel(c) {
            c = c || {}
            return {
              id: c.id ?? '',
              name: c.name ?? '',
              is_channel: c.is_channel ?? false,
              is_private: c.is_private ?? false,
              num_members: c.num_members ?? 0,
              topic: c.topic?.value ?? '',
              purpose: c.purpose?.value ?? '',
            }
          }
          function mapMessage(m) {
            m = m || {}
            return {
              type: m.type ?? 'message',
              user: m.user ?? '',
              text: m.text ?? '',
              ts: m.ts ?? '',
            }
          }
          function mapUser(u) {
            u = u || {}
            return {
              id: u.id ?? '',
              name: u.name ?? '',
              real_name: u.real_name ?? u.profile?.real_name ?? u.profile?.display_name ?? '',
              is_admin: u.is_admin ?? false,
              is_bot: u.is_bot ?? false,
            }
          }
          function mapUserProfile(u) {
            u = u || {}
            return {
              id: u.id ?? '',
              name: u.name ?? '',
              real_name: u.real_name ?? u.profile?.real_name ?? u.profile?.display_name ?? '',
              title: u.profile?.title ?? '',
              email: u.profile?.email ?? '',
              phone: u.profile?.phone ?? '',
              status_text: u.profile?.status_text ?? '',
              status_emoji: u.profile?.status_emoji ?? '',
              image_72: u.profile?.image_72 ?? '',
              timezone: u.tz ?? '',
              is_admin: u.is_admin ?? false,
              is_bot: u.is_bot ?? false,
            }
          }
          function mapReaction(r) {
            r = r || {}
            return { name: r.name ?? '', count: r.count ?? 0, users: r.users ?? [] }
          }
          function mapPin(p) {
            p = p || {}
            return {
              type: p.type ?? 'message',
              channel: p.channel ?? '',
              message_ts: p.message?.ts ?? '',
              message_text: p.message?.text ?? '',
              created_by: p.created_by ?? '',
              created: p.created ?? 0,
            }
          }
          function mapStarredItem(s) {
            s = s || {}
            return {
              type: s.type ?? '',
              channel: s.channel ?? '',
              message_ts: s.message?.ts ?? '',
              message_text: s.message?.text ?? '',
              file_id: s.file?.id ?? '',
              file_name: s.file?.name ?? '',
              date_create: s.date_create ?? 0,
            }
          }
          function mapSearchChannel(c) {
            c = c || {}
            return {
              id: c.id ?? '',
              name: c.name ?? '',
              member_count: c.member_count ?? 0,
              is_member: c.is_member ?? false,
              purpose: c.purpose?.value ?? '',
              timestamp: c.timestamp ?? 0,
            }
          }
          function mapFile(f) {
            f = f || {}
            return {
              id: f.id ?? '',
              name: f.name ?? '',
              title: f.title ?? '',
              mimetype: f.mimetype ?? '',
              filetype: f.filetype ?? '',
              size: f.size ?? 0,
              url_private: f.url_private ?? '',
              permalink: f.permalink ?? '',
              created: f.created ?? 0,
              user: f.user ?? '',
            }
          }
          function mapBookmark(b) {
            b = b || {}
            return {
              id: b.id ?? '',
              channel_id: b.channel_id ?? '',
              title: b.title ?? '',
              link: b.link ?? '',
              type: b.type ?? 'link',
              emoji: b.emoji ?? '',
              date_created: b.date_created ?? b.date_create ?? 0,
              date_updated: b.date_updated ?? b.date_update ?? 0,
            }
          }
          function mapUserGroup(g) {
            g = g || {}
            return {
              id: g.id ?? '',
              name: g.name ?? '',
              handle: g.handle ?? '',
              description: g.description ?? '',
              user_count: g.user_count ?? 0,
              is_external: g.is_external ?? false,
            }
          }
          function mapReminder(r) {
            r = r || {}
            return {
              id: r.id ?? '',
              creator: r.creator ?? '',
              text: r.text ?? '',
              user: r.user ?? '',
              recurring: r.recurring ?? false,
              time: r.time ?? 0,
              complete_ts: r.complete_ts ?? 0,
            }
          }

          // --- upload_file guards (tools/upload-file.ts) ---------------------------
          var BLOCKED_EXTENSIONS = ['exe', 'sh', 'bat', 'cmd', 'com', 'app', 'dmg', 'msi', 'bin']
          var MAX_FILE_SIZE = 20 * 1024 * 1024
          function validateExtension(filename) {
            var parts = String(filename || '').split('.')
            var ext = parts.length > 1 ? parts.pop().toLowerCase() : ''
            if (BLOCKED_EXTENSIONS.indexOf(ext) !== -1)
              throw ToolError.validation('File extension ".' + ext + '" is blocked for security reasons')
          }
          function validateMagicBytes(base64Content, filename) {
            var parts = String(filename || '').split('.')
            var ext = parts.length > 1 ? parts.pop().toLowerCase() : ''
            var prefix = String(base64Content || '').substring(0, 12)
            var magicMap = {
              png: ['iVBORw0KGgo'],
              jpg: ['/9j/'],
              jpeg: ['/9j/'],
              gif: ['R0lGODlh', 'R0lGODdh'],
              pdf: ['JVBERi0'],
              zip: ['UEsDB'],
            }
            var expected = magicMap[ext]
            if (!expected) return
            for (var i = 0; i < expected.length; i++) {
              if (prefix.indexOf(expected[i]) === 0) return
            }
            throw ToolError.validation('File content does not match expected format for ".' + ext + '"')
          }

          function isSlackHost() {
            var host = (location && location.hostname) || ''
            return host === 'slack.com' || host.slice(-10) === '.slack.com'
          }
          function ok(data) {
            return { status: 'ok', data: data, message: null, page_url: location.href }
          }
          function error(code, message) {
            return { status: 'error', data: null, error_code: code, message: message, page_url: location.href }
          }

          var slackToolImplementations = {
            async react_to_message(args) {
              var params = applyDefaults({"type": "object", "properties": {"channel": {"type": "string", "description": "Channel ID where the message is located (e.g., C1234567890)"}, "timestamp": {"type": "string", "description": "Timestamp of the message to react to"}, "emoji": {"type": "string", "description": "Emoji name without colons (e.g., \"thumbsup\", \"heart\", \"rocket\")"}}, "required": ["channel", "timestamp", "emoji"], "additionalProperties": false}, args)

              const name = params.emoji.replace(/^:|:$/g, '');
              await slackApi('reactions.add', {
                  channel: params.channel,
                  timestamp: params.timestamp,
                  name,
              });
              return { success: true };
            },
          }

          async function stdin_default(args) {
            try {
              if (!isSlackHost())
                return error('UNSUPPORTED_PAGE', 'Not on an app.slack.com page.')
              var data = await slackToolImplementations['react_to_message'](args)
              return ok(data)
            } catch (e) {
              return error(
                e && e.__toolError ? e.__toolError : 'UNKNOWN',
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
            'The app.slack.com tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'Slack Enterprise API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The app.slack.com tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
