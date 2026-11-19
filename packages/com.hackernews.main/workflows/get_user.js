// Self-contained adapter workflow. Hacker News HTML fetching and parsing stay inside the news.ycombinator.com tab.

export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "username": {
        "type": "string",
        "minLength": 1,
        "description": "Username (case-sensitive)"
      }
    },
    "required": [
      "username"
    ],
    "additionalProperties": false
  },
  outputSchema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
      },
      data: {
        type: ['object', 'null'],
      },
      message: {
        type: ['string', 'null'],
      },
      error_code: {
        type: ['string', 'null'],
      },
    },
    required: ['status', 'data'],
    additionalProperties: false,
  },
  tree: {
    type: 'action',
    description: 'Get a Hacker News user profile by username (case-sensitive): karma, account creation date, and bio.',
    async run({ input, state, target }) {
      const options = { tab: target.tabId, timeout: 25000 }
      const execute = async (args) => {
        var workflow = (() => {

          // Page-side Hacker News runtime (translated from OpenTabs
          // hackernews-api.ts, MIT). Runs INSIDE the news.ycombinator.com tab.
          // HN serves a strict CSP (default-src 'self' with no connect-src
          // override), so every cross-origin API (Firebase, Algolia) is
          // blocked: the tools fetch HN's own server-rendered HTML pages and
          // parse them with DOMParser. No credential is read or stored — the
          // session cookie travels with each same-origin request.
          var HN_ORIGIN = 'https://news.ycombinator.com'
          var HN_HOST = 'news.ycombinator.com'

          function hnAbsolute(path) {
            if (/^https?:\/\//i.test(path)) return path
            return HN_ORIGIN + (path.charAt(0) === '/' ? path : '/' + path)
          }

          function ok(data) {
            return {
              status: 'ok',
              data: data,
              message: null,
              page_url: location.href,
            }
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

          // One request path for the HTML GETs and the comment POST. The
          // deadline is absolute from the start of the request (headers plus
          // body), so a stalled response can never outlive the 25s
          // browser-eval timeout and leave the request running.
          async function hnFetch(path, options) {
            options = options || {}
            var headers = options.headers || {}
            var abortController = null
            if (typeof AbortController === 'function')
              try {
                abortController = new AbortController()
              } catch (e) {}
            var deadlineMs = 18000
            var startedAt = Date.now()
            var abortTimer =
              abortController !== null
                ? setTimeout(
                    function () {
                      try {
                        abortController.abort()
                      } catch (e) {}
                    },
                    Math.max(1, deadlineMs - (Date.now() - startedAt)),
                  )
                : null
            var response
            try {
              response = await fetch(hnAbsolute(path), {
                method: options.method || 'GET',
                headers: headers,
                body: options.body,
                credentials: 'include',
                redirect: options.redirect || 'follow',
                signal: abortController ? abortController.signal : undefined,
              })
            } catch (e) {
              if (abortTimer !== null) clearTimeout(abortTimer)
              var aborted =
                e && (e.name === 'AbortError' || String(e).indexOf('abort') !== -1)
              return {
                ok: false,
                error_code: aborted ? 'TIMEOUT' : 'NETWORK',
                message: aborted
                  ? 'Hacker News request aborted after the 18s in-page deadline.'
                  : 'Network error calling Hacker News: ' + String(e),
              }
            }
            var text = ''
            try {
              text = await response.text()
            } catch (e) {}
            if (abortTimer !== null) clearTimeout(abortTimer)
            if (!response.ok) {
              var code = 'HTTP'
              if (response.status === 401 || response.status === 403) code = 'AUTH'
              else if (response.status === 404) code = 'NOT_FOUND'
              else if (response.status === 429) code = 'RATE_LIMITED'
              return {
                ok: false,
                error_code: code,
                status: response.status,
                message:
                  'Hacker News request failed (' +
                  response.status +
                  ')' +
                  (text ? ': ' + text.slice(0, 300) : ''),
              }
            }
            return { ok: true, text: text }
          }

          async function fetchHtml(path) {
            var response = await hnFetch(path)
            if (!response.ok) return response
            if (typeof DOMParser !== 'function')
              return {
                ok: false,
                error_code: 'PARSE',
                message: 'DOMParser is not available in this tab.',
              }
            var doc = null
            try {
              doc = new DOMParser().parseFromString(response.text, 'text/html')
            } catch (e) {
              doc = null
            }
            if (!doc)
              return {
                ok: false,
                error_code: 'PARSE',
                message: 'Hacker News returned HTML that could not be parsed.',
              }
            return { ok: true, doc: doc }
          }

          function textOf(el) {
            return el && el.textContent ? el.textContent : ''
          }
          function attrOf(el, name) {
            return el && typeof el.getAttribute === 'function'
              ? el.getAttribute(name) || ''
              : ''
          }
          function intOf(value) {
            var parsed = parseInt(value, 10)
            return isNaN(parsed) ? 0 : parsed
          }
          // The age element's title is the exact submission time
          // ("2025-02-01T09:12:44 1738391564"); the visible text is relative.
          function ageTime(row) {
            var ageEl = row ? row.querySelector('.age') : null
            var title = attrOf(ageEl, 'title')
            return title ? title.split(' ')[0] : ''
          }
          function commentCount(row) {
            if (!row) return 0
            var links = row.querySelectorAll('a')
            for (var i = 0; i < links.length; i++) {
              if (textOf(links[i]).indexOf('comment') !== -1)
                return intOf(textOf(links[i]))
            }
            return 0
          }

          function parseStoryRow(row) {
            var id = Number(row.id)
            if (!id) return null
            var titleLink = row.querySelector('.titleline > a')
            var rawUrl = attrOf(titleLink, 'href')
            var subRow = row.nextElementSibling
            return {
              id: id,
              title: textOf(titleLink),
              url: rawUrl.indexOf('item?id=') === 0 ? '' : rawUrl,
              site: textOf(row.querySelector('.sitestr')),
              score: intOf(textOf(subRow ? subRow.querySelector('.score') : null)),
              by: textOf(subRow ? subRow.querySelector('.hnuser') : null),
              time: ageTime(subRow),
              descendants: commentCount(subRow),
            }
          }

          // Story listings share one page shape; only the path differs.
          async function hnStoryPage(path, page) {
            var url = path
            if (page > 1) url += url.indexOf('?') !== -1 ? '&p=' + page : '?p=' + page
            var fetched = await fetchHtml(url)
            if (!fetched.ok) return fetched
            var doc = fetched.doc
            var rows = doc.querySelectorAll('tr.athing')
            var stories = []
            for (var i = 0; i < rows.length; i++) {
              var story = parseStoryRow(rows[i])
              if (story) stories.push(story)
            }
            // An empty list is never a legitimate answer for a listing: no
            // story rows means HN's markup moved, and an empty shell would
            // reach the caller as a successful call with no data.
            if (stories.length === 0)
              return {
                ok: false,
                error_code: 'PARSE',
                message:
                  'No story rows found on ' +
                  hnAbsolute(url) +
                  ' — Hacker News may have changed its markup.',
              }
            return {
              ok: true,
              data: { stories: stories, has_more: doc.querySelector('a.morelink') !== null },
            }
          }

          async function hnItem(id) {
            var fetched = await fetchHtml('/item?id=' + id)
            if (!fetched.ok) return fetched
            var doc = fetched.doc
            var body = doc.body ? textOf(doc.body) : ''
            if (body.indexOf('No such item') !== -1)
              return { ok: false, error_code: 'NOT_FOUND', message: 'Item ' + id + ' not found' }
            var mainRow = doc.querySelector('tr.athing')
            if (!mainRow)
              return { ok: false, error_code: 'NOT_FOUND', message: 'Item ' + id + ' not found' }

            // Comment pages: the main row carries .commtext and no .titleline.
            var commentEl = mainRow.querySelector('.commtext')
            if (commentEl)
              return {
                ok: true,
                data: {
                  item: {
                    id: id,
                    type: 'comment',
                    title: '',
                    url: '',
                    text: commentEl.innerHTML || '',
                    score: 0,
                    by: textOf(mainRow.querySelector('.hnuser')),
                    time: ageTime(mainRow),
                    descendants: 0,
                  },
                },
              }

            var titleLink = mainRow.querySelector('.titleline > a')
            var rawUrl = attrOf(titleLink, 'href')
            var subRow = mainRow.nextElementSibling
            var score = intOf(textOf(subRow ? subRow.querySelector('.score') : null))
            var by = textOf(subRow ? subRow.querySelector('.hnuser') : null)
            // A job row has neither an author nor a score.
            var type = 'story'
            if (!by && !score) type = 'job'
            return {
              ok: true,
              data: {
                item: {
                  id: id,
                  type: type,
                  title: textOf(titleLink),
                  url: rawUrl.indexOf('item?id=') === 0 ? '' : rawUrl,
                  text: doc.querySelector('.toptext')
                    ? doc.querySelector('.toptext').innerHTML || ''
                    : '',
                  score: score,
                  by: by,
                  time: ageTime(subRow),
                  descendants: commentCount(subRow),
                },
              },
            }
          }

          async function hnStoryComments(storyId, page) {
            var url = '/item?id=' + storyId
            if (page > 1) url += '&p=' + page
            var fetched = await fetchHtml(url)
            if (!fetched.ok) return fetched
            var doc = fetched.doc
            var storyRow = doc.querySelector('tr.athing:not(.comtr)')
            var subRow = storyRow ? storyRow.nextElementSibling : null
            var rows = doc.querySelectorAll('tr.athing.comtr')
            var comments = []
            for (var i = 0; i < rows.length; i++) {
              var row = rows[i]
              // HN indents one nesting level per 40px spacer image.
              var indentEl = row.querySelector('.ind img')
              var textEl = row.querySelector('.commtext')
              comments.push({
                id: Number(row.id),
                by: textOf(row.querySelector('.hnuser')) || '[deleted]',
                text: textEl ? textEl.innerHTML || '' : '',
                time: ageTime(row),
                indent: intOf(attrOf(indentEl, 'width')) / 40,
              })
            }
            return {
              ok: true,
              data: {
                comments: comments,
                total: commentCount(subRow),
                has_more: doc.querySelector('a.morelink') !== null,
              },
            }
          }

          async function hnUser(username) {
            var fetched = await fetchHtml('/user?id=' + encodeURIComponent(username))
            if (!fetched.ok) return fetched
            var doc = fetched.doc
            var rows = doc.querySelectorAll('table table tr')
            var created = ''
            var karma = 0
            var about = ''
            var foundUser = false
            for (var i = 0; i < rows.length; i++) {
              var cells = rows[i].querySelectorAll('td')
              if (cells.length < 2) continue
              var label = textOf(cells[0]).trim().replace(':', '')
              if (label === 'user') foundUser = true
              if (label === 'created') created = textOf(cells[1]).trim()
              if (label === 'karma') karma = intOf(textOf(cells[1]).trim())
              if (label === 'about') about = (cells[1].innerHTML || '').trim()
            }
            if (!foundUser)
              return {
                ok: false,
                error_code: 'NOT_FOUND',
                message: 'User "' + username + '" not found',
              }
            return {
              ok: true,
              data: { user: { username: username, created: created, karma: karma, about: about } },
            }
          }

          function hnLoggedIn() {
            return document.querySelector('a#logout') !== null
          }

          // HN signs comment submissions with an HMAC token rendered into the
          // reply form. The reply page carries it; the item page is the
          // fallback for a top-level comment on a story.
          async function hnHmac(parentId) {
            var fetched = await fetchHtml(
              '/reply?id=' +
                parentId +
                '&goto=item%3Fid%3D' +
                parentId +
                '%23' +
                parentId,
            )
            if (!fetched.ok) return fetched
            var form = fetched.doc.querySelector('form[action="comment"]')
            if (!form) {
              var item = await fetchHtml('/item?id=' + parentId)
              if (!item.ok) return item
              form = item.doc.querySelector('form[action="comment"]')
              if (!form)
                return {
                  ok: false,
                  error_code: 'AUTH',
                  message:
                    'Comment form not found — make sure you are logged in to Hacker News.',
                }
            }
            var hmacEl = form.querySelector('input[name="hmac"]')
            var gotoEl = form.querySelector('input[name="goto"]')
            var hmac = hmacEl ? hmacEl.value || '' : ''
            if (!hmac)
              return {
                ok: false,
                error_code: 'AUTH',
                message: 'HMAC token not found — make sure you are logged in to Hacker News.',
              }
            return { ok: true, hmac: hmac, goto: gotoEl ? gotoEl.value || '' : '' }
          }

          async function hnSubmitComment(parentId, text) {
            if (!hnLoggedIn())
              return {
                ok: false,
                error_code: 'AUTH',
                message: 'Not logged in — please log in to Hacker News to post comments.',
              }
            var token = await hnHmac(parentId)
            if (!token.ok) return token
            // Multipart, exactly like the site's own form: never a JSON body.
            var formData = new FormData()
            formData.append('parent', String(parentId))
            formData.append('goto', token.goto)
            formData.append('hmac', token.hmac)
            formData.append('text', text)
            var response = await hnFetch('/comment', {
              method: 'POST',
              body: formData,
              redirect: 'follow',
            })
            if (!response.ok) return response
            return { ok: true, data: { success: true } }
          }

          var hnToolImplementations = {
            async get_user(args) {
              if (location.hostname !== HN_HOST)
                return error('UNSUPPORTED_PAGE', 'Not on a news.ycombinator.com page.')
              var result = await hnUser(args.username)
              if (!result.ok) return error(result.error_code, result.message)
              return ok(result.data)
            },
          }

          async function stdin_default(args) {
            return hnToolImplementations['get_user'](args)
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
            'The news.ycombinator.com tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'Hacker News request failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The news.ycombinator.com tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
