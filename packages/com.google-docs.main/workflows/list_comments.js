// Self-contained adapter workflow. Every Google Docs call (Drive v3 through the
// page's gapi client, the same-origin fallback fetch, and the editor HTML read
// behind plain text and comment anchors) and the session it rides on stay inside
// the docs.google.com tab.
export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "document_id": {
        "description": "Google Docs document ID. Defaults to the document open in the current editor tab.",
        "type": "string"
      },
      "status": {
        "description": "Filter by comment status: \"open\" (default) returns only unresolved comments that need attention, \"resolved\" returns only resolved/closed comments, \"all\" returns both",
        "type": "string",
        "enum": [
          "open",
          "resolved",
          "all"
        ]
      },
      "include_orphaned": {
        "description": "Include orphaned comments whose anchored text no longer exists in the document (default false). Orphaned comments are typically left over from previous revisions of the document and are hidden by the Google Docs UI.",
        "type": "boolean"
      },
      "page_size": {
        "description": "Maximum number of comments to return (default 50, max 100)",
        "type": "integer",
        "minimum": 1,
        "maximum": 100
      },
      "page_token": {
        "description": "Page token from a previous list_comments call",
        "type": "string"
      },
      "include_deleted": {
        "description": "Include deleted comments (default false)",
        "type": "boolean"
      }
    },
    "additionalProperties": false
  },
  outputSchema: {
    "type": "object",
    "properties": {
      "comments": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string",
              "description": "Comment ID"
            },
            "author": {
              "type": "string",
              "description": "Comment author display name"
            },
            "author_email": {
              "type": "string",
              "description": "Comment author email address"
            },
            "content": {
              "type": "string",
              "description": "Comment text content"
            },
            "created_time": {
              "type": "string",
              "description": "Comment creation time in ISO 8601 format"
            },
            "modified_time": {
              "type": "string",
              "description": "Comment last modified time in ISO 8601 format"
            },
            "resolved": {
              "type": "boolean",
              "description": "Whether the comment thread is resolved (closed). Resolved threads no longer need attention."
            },
            "quoted_text": {
              "type": "string",
              "description": "The document text this comment is anchored to"
            },
            "anchor": {
              "type": "string",
              "description": "Named range ID (kix.*) that positions this comment in the document"
            },
            "replies": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "id": {
                    "type": "string",
                    "description": "Reply ID"
                  },
                  "author": {
                    "type": "string",
                    "description": "Reply author display name"
                  },
                  "author_email": {
                    "type": "string",
                    "description": "Reply author email address"
                  },
                  "content": {
                    "type": "string",
                    "description": "Reply text content"
                  },
                  "created_time": {
                    "type": "string",
                    "description": "Reply creation time in ISO 8601 format"
                  },
                  "modified_time": {
                    "type": "string",
                    "description": "Reply last modified time in ISO 8601 format"
                  },
                  "action": {
                    "type": "string",
                    "description": "Reply action: \"reopen\" or \"resolve\", empty for regular replies"
                  }
                },
                "required": [
                  "id",
                  "author",
                  "author_email",
                  "content",
                  "created_time",
                  "modified_time",
                  "action"
                ],
                "additionalProperties": false
              },
              "description": "Replies in this comment thread"
            }
          },
          "required": [
            "id",
            "author",
            "author_email",
            "content",
            "created_time",
            "modified_time",
            "resolved",
            "quoted_text",
            "anchor",
            "replies"
          ],
          "additionalProperties": false
        },
        "description": "Comment threads on the document"
      },
      "next_page_token": {
        "type": "string",
        "description": "Token for the next page, empty if there are no more results"
      }
    },
    "required": [
      "comments",
      "next_page_token"
    ],
    "additionalProperties": false
  },
  tree: {
    type: 'action',
    description: 'list_comments',
    async run({ input, state, target }) {
      const options = { tab: target.tabId, timeout: 25000 }
      const execute = async (args) => {
        var workflow = (() => {

          // Page-side Google Docs runtime, translated from OpenTabs
          // google-docs-api.ts, document-text.ts and tools/schemas.ts (MIT). Runs
          // INSIDE the docs.google.com tab: gapi.client.request signs each Drive
          // v3 call with SAPSIDHASH derived from the tab's own session cookies, so
          // no credential is ever read out of the page or returned.
          var DRIVE_API_BASE = '/drive/v3'
          var API_DEADLINE_MS = 18000
          var DOCUMENT_MIME_TYPE = 'application/vnd.google-apps.document'
          var DOCUMENT_FIELDS =
            'id,name,mimeType,modifiedTime,createdTime,trashed,starred,shared,ownedByMe,webViewLink,owners(displayName,emailAddress),lastModifyingUser(displayName,emailAddress)'
          var DOCUMENT_LIST_FIELDS = 'nextPageToken,files(' + DOCUMENT_FIELDS + ')'
          var REPLY_FIELDS = 'id,author(displayName,emailAddress,photoLink),content,createdTime,modifiedTime,action'
          var COMMENT_FIELDS =
            'id,author(displayName,emailAddress,photoLink),content,createdTime,modifiedTime,resolved,quotedFileContent(mimeType,value),anchor,replies(' +
            REPLY_FIELDS +
            ')'
          var COMMENT_LIST_FIELDS = 'nextPageToken,comments(' + COMMENT_FIELDS + ')'
          // Google Docs assigns a kix.<id> named range to every comment anchor; the
          // editor HTML embeds the live ones, so a regex over the page gives the
          // complete set of anchor positions.
          var KIX_PATTERN = /kix\.[a-z0-9]{12,}/g

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
          // Upstream's readiness signal is gapi.client.request: the Docs editor
          // loads gapi on every signed-in page and gapi signs with the session.
          function getGapiRequest() {
            var requestFn = getPageGlobal('gapi.client.request')
            return typeof requestFn === 'function' ? requestFn : null
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
          // Google's JSON endpoints used to answer with an XSSI guard line.
          function stripXssiPrefix(text) {
            var body = String(text === undefined || text === null ? '' : text)
            if (body.charCodeAt(0) === 0xfeff) body = body.slice(1)
            if (body.indexOf(")]}'") === 0) {
              var newline = body.indexOf('\n')
              body = newline === -1 ? '' : body.slice(newline + 1)
            }
            return body
          }
          // Same classification as upstream classifyGapiError(): 401/403 auth,
          // 404 not found, 429 rate limited, 400/422 validation, else internal.
          function classifyGapiError(endpoint, err) {
            var status = err && err.status
            var message =
              (err && err.result && err.result.error && err.result.error.message) || 'API error: ' + endpoint
            if (status === 401 || status === 403) return toolError('AUTH', message)
            if (status === 404) return toolError('NOT_FOUND', message)
            if (status === 429) return toolError('RATE_LIMITED', message)
            if (status === 400 || status === 422) return toolError('VALIDATION', message)
            return toolError('INTERNAL', '(' + (status === undefined || status === null ? 'unknown' : status) + ') ' + message)
          }
          function classifyStatus(status, message) {
            if (status === 401 || status === 403) return toolError('AUTH', message)
            if (status === 404) return toolError('NOT_FOUND', message)
            if (status === 429) return toolError('RATE_LIMITED', message)
            if (status === 400 || status === 422) return toolError('VALIDATION', message)
            return toolError('INTERNAL', '(' + (status === undefined ? 'unknown' : status) + ') ' + message)
          }
          function serializeRequestBody(body) {
            if (body === undefined) return undefined
            return typeof body === 'string' ? body : JSON.stringify(body)
          }
          var apiKeySet = false
          function getEmbeddedApiKey() {
            var candidate = getPageGlobal('preload.globals.gmsSuiteApiKey')
            return typeof candidate === 'string' && candidate.length > 0 ? candidate : null
          }
          // Upstream falls back to an API key bundled inside the plugin; that
          // literal is redacted in both the public source and the published build,
          // so the port only sets a key when the page exposes one. The call still
          // rides on the tab session either way.
          function ensureApiKey() {
            if (apiKeySet) return
            var setApiKey = getPageGlobal('gapi.client.setApiKey')
            if (typeof setApiKey !== 'function') return
            var key = getEmbeddedApiKey()
            if (!key) return
            setApiKey(key)
            apiKeySet = true
          }
          // gapi resolves with { status, result, body, headers } and rejects with
          // the same shape. The deadline keeps a stalled request inside the 25s
          // browser-eval budget (port safeguard; upstream awaits unbounded).
          function gapiRequest(requestFn, options) {
            return new Promise(function (resolve, reject) {
              var settled = false
              var timer = setTimeout(function () {
                if (settled) return
                settled = true
                reject(toolError('TIMEOUT', 'Google Docs request timed out after the 18s in-page deadline.'))
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
          // Fallback for a tab that has not exposed gapi yet: the identical path,
          // method and params go out as a same-origin fetch with the tab's cookies.
          async function fetchApi(path, options, body) {
            options = options || {}
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
              if (aborted) throw toolError('TIMEOUT', 'Google Docs request aborted after the 18s in-page deadline.')
              throw toolError('NETWORK', 'Network error calling Google Docs: ' + String(e))
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
              throw classifyStatus(response.status, detail || 'API error: ' + path)
            }
            if (data === null) {
              throw toolError('AUTH', 'Google Docs is not ready — please open Google Docs and sign in.')
            }
            return data
          }
          async function callApi(path, options) {
            options = options || {}
            var body = serializeRequestBody(options.body)
            var requestFn = getGapiRequest()
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
                throw classifyGapiError(path, error)
              }
              return response && response.result !== undefined ? response.result : {}
            }
            return await fetchApi(path, options, body)
          }
          function driveApi(endpoint, options) {
            return callApi(DRIVE_API_BASE + endpoint, options)
          }
          // Drive answers a successful DELETE with 204 and no body, which gapi
          // reports as a rejected { status: 204 }.
          async function driveApiVoid(endpoint, options) {
            options = options || {}
            var requestFn = getGapiRequest()
            var path = DRIVE_API_BASE + endpoint
            if (requestFn) {
              ensureApiKey()
              try {
                await gapiRequest(requestFn, {
                  path: path,
                  method: options.method,
                  params: cleanParams(options.params),
                })
              } catch (err) {
                if (err && err.__toolError) throw err
                if (err && err.status === 204) return
                throw classifyGapiError(endpoint, err)
              }
              return
            }
            await fetchApi(path, { method: options.method, params: options.params }, undefined)
          }

          // --- document context (google-docs-api.ts) ---
          function getCurrentDocumentContext() {
            var href = String(location.href || '')
            var match = href.match(/\/document\/d\/([^/?#]+)/)
            if (!match) return null
            var encodedDocumentId = match[1]
            if (!encodedDocumentId) return null
            var tabMatch = href.match(/[?&]tab=([^&#]*)/)
            var tabId = tabMatch ? tabMatch[1] : ''
            var title = ''
            try {
              title = (document && document.title) || ''
            } catch (e) {
              title = ''
            }
            return {
              documentId: decodeURIComponent(encodedDocumentId),
              tabId: tabId,
              title: title,
              url: href,
            }
          }
          function resolveDocumentId(explicitDocumentId) {
            if (explicitDocumentId) return explicitDocumentId
            var current = getCurrentDocumentContext()
            if (current && current.documentId) return current.documentId
            throw toolError(
              'VALIDATION',
              'No document ID found — provide document_id or open a Google Doc in the current tab.',
            )
          }
          function getDocumentFile(documentId) {
            return driveApi('/files/' + encodeURIComponent(documentId), { params: { fields: DOCUMENT_FIELDS } })
          }

          // --- mappers (tools/schemas.ts) ---
          function mapUser(user) {
            user = user || {}
            return {
              display_name: user.displayName === undefined || user.displayName === null ? '' : user.displayName,
              email: user.emailAddress === undefined || user.emailAddress === null ? '' : user.emailAddress,
              permission_id: user.permissionId === undefined || user.permissionId === null ? '' : user.permissionId,
              photo_link: user.photoLink === undefined || user.photoLink === null ? '' : user.photoLink,
            }
          }
          function mapStorageQuota(quota) {
            quota = quota || {}
            return {
              limit_bytes: quota.limit === undefined || quota.limit === null ? '0' : quota.limit,
              usage_bytes: quota.usage === undefined || quota.usage === null ? '0' : quota.usage,
              usage_in_drive_bytes: quota.usageInDrive === undefined || quota.usageInDrive === null ? '0' : quota.usageInDrive,
              usage_in_trash_bytes:
                quota.usageInDriveTrash === undefined || quota.usageInDriveTrash === null ? '0' : quota.usageInDriveTrash,
            }
          }
          function mapDocument(file) {
            file = file || {}
            var owners = file.owners || []
            var owner = owners[0] || {}
            var lastModifying = file.lastModifyingUser || {}
            return {
              id: file.id === undefined || file.id === null ? '' : file.id,
              title: file.name === undefined || file.name === null ? '' : file.name,
              mime_type: file.mimeType === undefined || file.mimeType === null ? '' : file.mimeType,
              created_time: file.createdTime === undefined || file.createdTime === null ? '' : file.createdTime,
              modified_time: file.modifiedTime === undefined || file.modifiedTime === null ? '' : file.modifiedTime,
              trashed: file.trashed === undefined || file.trashed === null ? false : !!file.trashed,
              starred: file.starred === undefined || file.starred === null ? false : !!file.starred,
              shared: file.shared === undefined || file.shared === null ? false : !!file.shared,
              owned_by_me: file.ownedByMe === undefined || file.ownedByMe === null ? false : !!file.ownedByMe,
              web_view_link: file.webViewLink === undefined || file.webViewLink === null ? '' : file.webViewLink,
              owner: owner.displayName === undefined || owner.displayName === null ? '' : owner.displayName,
              owner_email: owner.emailAddress === undefined || owner.emailAddress === null ? '' : owner.emailAddress,
              last_modified_by:
                lastModifying.displayName === undefined || lastModifying.displayName === null ? '' : lastModifying.displayName,
            }
          }
          function mapTab(tab, activeTabId) {
            tab = tab || {}
            return {
              id: tab.id === undefined || tab.id === null ? '' : tab.id,
              title: tab.title === undefined || tab.title === null ? '' : tab.title,
              index: typeof tab.index === 'number' ? tab.index : 0,
              parent_id: tab.parentId === undefined || tab.parentId === null ? '' : tab.parentId,
              is_current_tab: tab.id === activeTabId || (activeTabId === '' && tab.id === ''),
            }
          }
          function mapReply(reply) {
            reply = reply || {}
            var author = reply.author || {}
            return {
              id: reply.id === undefined || reply.id === null ? '' : reply.id,
              author: author.displayName === undefined || author.displayName === null ? '' : author.displayName,
              author_email: author.emailAddress === undefined || author.emailAddress === null ? '' : author.emailAddress,
              content: reply.content === undefined || reply.content === null ? '' : reply.content,
              created_time: reply.createdTime === undefined || reply.createdTime === null ? '' : reply.createdTime,
              modified_time: reply.modifiedTime === undefined || reply.modifiedTime === null ? '' : reply.modifiedTime,
              action: reply.action === undefined || reply.action === null ? '' : reply.action,
            }
          }
          function mapComment(comment) {
            comment = comment || {}
            var author = comment.author || {}
            var quoted = comment.quotedFileContent || {}
            var replies = []
            var rawReplies = comment.replies || []
            for (var i = 0; i < rawReplies.length; i++) replies.push(mapReply(rawReplies[i]))
            return {
              id: comment.id === undefined || comment.id === null ? '' : comment.id,
              author: author.displayName === undefined || author.displayName === null ? '' : author.displayName,
              author_email: author.emailAddress === undefined || author.emailAddress === null ? '' : author.emailAddress,
              content: comment.content === undefined || comment.content === null ? '' : comment.content,
              created_time: comment.createdTime === undefined || comment.createdTime === null ? '' : comment.createdTime,
              modified_time: comment.modifiedTime === undefined || comment.modifiedTime === null ? '' : comment.modifiedTime,
              resolved: comment.resolved === undefined || comment.resolved === null ? false : !!comment.resolved,
              quoted_text: quoted.value === undefined || quoted.value === null ? '' : quoted.value,
              anchor: comment.anchor === undefined || comment.anchor === null ? '' : comment.anchor,
              replies: replies,
            }
          }
          function escapeDriveQueryValue(value) {
            return String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'")
          }

          // --- plain text (document-text.ts) ---
          function parseModelChunksFromHtml(html) {
            var textChunks = []
            var marker = 'DOCS_modelChunk ='
            var searchFrom = 0
            while (true) {
              var markerIdx = html.indexOf(marker, searchFrom)
              if (markerIdx === -1) break
              var jsonStart = html.indexOf('{', markerIdx + marker.length)
              if (jsonStart === -1) break
              var semiIdx = html.indexOf(';', jsonStart)
              if (semiIdx === -1) break
              searchFrom = semiIdx + 1
              try {
                var chunkJson = JSON.parse(html.slice(jsonStart, semiIdx))
                var chunkOps = chunkJson.chunk
                if (!Array.isArray(chunkOps)) continue
                for (var i = 0; i < chunkOps.length; i++) {
                  var op = chunkOps[i]
                  if (op && op.ty === 'is' && typeof op.s === 'string') {
                    textChunks.push({ ibi: typeof op.ibi === 'number' && op.ibi ? op.ibi : 1, text: op.s })
                  }
                }
              } catch (e) {
                // Malformed chunk — skip and try the next one.
              }
            }
            if (textChunks.length === 0) return null
            textChunks.sort(function (a, b) {
              return a.ibi - b.ibi
            })
            var rawText = ''
            for (var j = 0; j < textChunks.length; j++) rawText += textChunks[j].text
            var lines = rawText.split('\n')
            var kept = []
            for (var k = 0; k < lines.length; k++) {
              if (lines[k].length > 0) kept.push(lines[k])
            }
            return kept.join('\n')
          }
          function extractTitleFromHtml(html) {
            var match = html.match(/<title>([^<]*)<\/title>/)
            if (!match || !match[1]) return ''
            return match[1].replace(/ - Google Docs$/, '')
          }
          async function fetchDocumentText(documentId) {
            var resolvedId = resolveDocumentId(documentId)
            var url = location.origin + '/document/d/' + encodeURIComponent(resolvedId) + '/edit?tab=t.0&_cb=' + Date.now()
            var response = await fetch(url, { cache: 'no-store', credentials: 'include' })
            if (!response.ok) {
              var errorBody = ''
              try {
                errorBody = await response.text()
              } catch (e) {}
              throw classifyStatus(response.status, errorBody.slice(0, 512) || 'API error: document HTML')
            }
            var html = await response.text()
            // A signed-out tab (or a page that is not the editor) never embeds a
            // model chunk. Report that as AUTH instead of as an empty document.
            if (html.indexOf('DOCS_modelChunk') === -1) {
              throw toolError('AUTH', 'Google Docs is not ready — please open Google Docs and sign in.')
            }
            return { text: parseModelChunksFromHtml(html), title: extractTitleFromHtml(html) }
          }

          // --- comments (tools/list-comments.ts helpers) ---
          async function fetchLiveAnchorIds(documentId) {
            try {
              var response = await fetch(location.origin + '/document/d/' + encodeURIComponent(documentId) + '/edit', {
                credentials: 'include',
              })
              if (!response.ok) return null
              var html = await response.text()
              return new Set(html.match(KIX_PATTERN) || [])
            } catch (e) {
              return null
            }
          }
          // Upstream fetches every page internally: client-side filtering of a
          // single page would silently drop matching comments that sit later.
          async function fetchAllComments(documentId, includeDeleted) {
            var allComments = []
            var pageToken
            do {
              var data = await driveApi('/files/' + encodeURIComponent(documentId) + '/comments', {
                params: {
                  fields: COMMENT_LIST_FIELDS,
                  pageSize: 100,
                  pageToken: pageToken,
                  includeDeleted: includeDeleted,
                },
              })
              var comments = (data && data.comments) || []
              for (var i = 0; i < comments.length; i++) allComments.push(comments[i])
              pageToken = data && data.nextPageToken
            } while (pageToken)
            return allComments
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
            if (location.hostname !== 'docs.google.com')
              return error('UNSUPPORTED_PAGE', 'Not on a docs.google.com page.')
            return null
          }

          var googleDocsToolImplementations = {
            async list_comments(args) {
              var documentId = resolveDocumentId(args.document_id)
              var status = args.status || 'open'
              var includeOrphaned = args.include_orphaned === true
              var pageSize = typeof args.page_size === 'number' ? args.page_size : 50

              var rawComments = await fetchAllComments(documentId, args.include_deleted === true)
              var comments = []
              for (var i = 0; i < rawComments.length; i++) comments.push(mapComment(rawComments[i]))

              if (status === 'open' || status === 'resolved') {
                var wanted = status === 'resolved'
                var filtered = []
                for (var j = 0; j < comments.length; j++) {
                  if (comments[j].resolved === wanted) filtered.push(comments[j])
                }
                comments = filtered
              }

              if (!includeOrphaned) {
                // If the page fetch fails, skip orphan filtering rather than
                // dropping every comment — upstream's graceful degradation.
                var liveAnchors = await fetchLiveAnchorIds(documentId)
                if (liveAnchors) {
                  var kept = []
                  for (var k = 0; k < comments.length; k++) {
                    if (comments[k].anchor !== '' && liveAnchors.has(comments[k].anchor)) kept.push(comments[k])
                  }
                  comments = kept
                }
              }

              // The page token is an offset into the filtered set: upstream
              // paginates client-side so status/orphan filters stay correct.
              var startIndex = args.page_token ? parseInt(args.page_token, 10) : 0
              var page = comments.slice(startIndex, startIndex + pageSize)
              var nextStart = startIndex + pageSize
              var hasMore = nextStart < comments.length

              return { comments: page, next_page_token: hasMore ? String(nextStart) : '' }
            }
          }

          async function stdin_default(args) {
            try {
              var pageError = assertPage()
              if (pageError) return pageError
              var data = await googleDocsToolImplementations['list_comments'](args)
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
            'The docs.google.com tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'Google Docs API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The docs.google.com tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
