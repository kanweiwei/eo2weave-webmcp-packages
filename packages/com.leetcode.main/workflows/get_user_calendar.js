// Self-contained adapter workflow. The LeetCode session and every same-origin
// API call stay inside the LeetCode tab.

export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "username": {
        "type": "string",
        "description": "LeetCode username"
      },
      "year": {
        "description": "Filter by year (e.g., 2025). Omit for all years.",
        "type": "integer",
        "minimum": -9007199254740991,
        "maximum": 9007199254740991
      }
    },
    "required": [
      "username"
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
    description: 'get_user_calendar',
    async run({ input, state, target }) {
      const options = { tab: target.tabId, timeout: 25000 }
      const execute = async (args) => {
        var workflow = (() => {
                    // ─── Page-side SDK-compat layer ─────────────────────────────────
                    // Reimplements the subset of @opentabs-dev/plugin-sdk that the
                    // pasted upstream transport calls: credentials:'include' fetches with
                    // a bounded abort and the SDK's HTTP -> ToolError classification,
                    // page readers (meta / cookie / localStorage / globals), the auth
                    // cache and waitUntil. Logging/timing behaviour is not reproduced;
                    // the upstream modules below run unmodified.
                    class ToolError extends Error {
                      constructor(message, code, opts) {
                        super(message)
                        this.name = 'ToolError'
                        this.code = code || 'TOOL_ERROR'
                        this.category = (opts && opts.category) || undefined
                        this.retryable = !!(opts && opts.retryable)
                      }
                      static auth(m, c) { return new ToolError(m, c || 'AUTH_ERROR', { category: 'auth' }) }
                      static notFound(m, c) { return new ToolError(m, c || 'NOT_FOUND', { category: 'not_found' }) }
                      static validation(m, c) { return new ToolError(m, c || 'VALIDATION_ERROR', { category: 'validation' }) }
                      static rateLimited(m, ms, c) { return new ToolError(m, c || 'RATE_LIMITED', { category: 'rate_limit', retryable: true }) }
                      static timeout(m, c) { return new ToolError(m, c || 'TIMEOUT', { category: 'timeout', retryable: true }) }
                      static internal(m, c) { return new ToolError(m, c || 'INTERNAL_ERROR', { category: 'internal' }) }
                    }

                    function defineTool(definition) { return definition }

                    // Zod is only used to declare schemas at module scope; the package
                    // carries its schemas as JSON, so every z.* chain can resolve to this
                    // inert stub.
                    var z = new Proxy(function () {}, {
                      get: function () { return z },
                      apply: function () { return z },
                    })

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

                    function getMetaContent(name) {
                      try {
                        var el = document.querySelector('meta[name="' + name + '"]')
                        if (!el) return null
                        var value = el.getAttribute('content')
                        return value || null
                      } catch (e) {
                        return null
                      }
                    }

                    function getCookie(name) {
                      try {
                        var prefix = name + '='
                        var parts = String(document.cookie || '').split(';')
                        for (var i = 0; i < parts.length; i++) {
                          var part = parts[i].trim()
                          if (part.indexOf(prefix) === 0) return decodeURIComponent(part.slice(prefix.length))
                        }
                        return null
                      } catch (e) {
                        return null
                      }
                    }

                    function getLocalStorage(key) {
                      try {
                        return localStorage.getItem(key)
                      } catch (e) {
                        return null
                      }
                    }

                    function getSessionStorage(key) {
                      try {
                        return sessionStorage.getItem(key)
                      } catch (e) {
                        return null
                      }
                    }

                    // Upstream SDK export (temporal-cloud): scan localStorage keys with a
                    // predicate and return the first hit as { key, value }.
                    function findLocalStorageEntry(predicate) {
                      try {
                        var count = localStorage.length
                        for (var i = 0; i < count; i++) {
                          var key = localStorage.key(i)
                          if (key === null) continue
                          if (!predicate(key)) continue
                          var value = localStorage.getItem(key)
                          if (value === null) continue
                          return { key: key, value: value }
                        }
                      } catch (e) {}
                      return null
                    }

                    function getCurrentUrl() {
                      return typeof location !== 'undefined' ? location.href : ''
                    }

                    var __authCache = (globalThis.__opentabsAuthCache =
                      globalThis.__opentabsAuthCache || {})
                    function getAuthCache(ns) { return __authCache[ns] || null }
                    function setAuthCache(ns, value) { __authCache[ns] = value }
                    function clearAuthCache(ns) { delete __authCache[ns] }

                    // Upstream SDK export: structured logging. The adapter drops log
                    // output, but the pasted transport calls log.debug on auth paths, so
                    // the surface must exist.
                    var log = { debug: function () {}, info: function () {}, warn: function () {}, error: function () {} }

                    function buildQueryString(params) {
                      var search = new URLSearchParams()
                      var keys = Object.keys(params || {})
                      for (var i = 0; i < keys.length; i++) {
                        var value = params[keys[i]]
                        if (value === undefined) continue
                        if (Array.isArray(value)) {
                          for (var j = 0; j < value.length; j++) search.append(keys[i], String(value[j]))
                        } else {
                          search.append(keys[i], String(value))
                        }
                      }
                      return search.toString()
                    }

                    function stripUndefined(obj) {
                      var out = {}
                      var keys = Object.keys(obj || {})
                      for (var i = 0; i < keys.length; i++) {
                        if (obj[keys[i]] !== undefined) out[keys[i]] = obj[keys[i]]
                      }
                      return out
                    }

                    function parseRetryAfterMs(value) {
                      var seconds = Number(value)
                      if (!isNaN(seconds) && seconds >= 0) return seconds * 1000
                      var date = Date.parse(value)
                      if (!isNaN(date)) {
                        var ms = date - Date.now()
                        return ms > 0 ? ms : undefined
                      }
                      return undefined
                    }

                    function parseRateLimitHeader(headers) {
                      var names = ['Retry-After', 'x-rate-limit-reset', 'x-ratelimit-reset', 'RateLimit-Reset']
                      for (var i = 0; i < names.length; i++) {
                        var raw = null
                        try { raw = headers.get(names[i]) } catch (e) {}
                        if (raw === null || raw === undefined) continue
                        var ms = parseRetryAfterMs(raw)
                        if (ms !== undefined) return ms
                      }
                      return undefined
                    }

                    function sleep(ms) {
                      return new Promise(function (resolve) { setTimeout(resolve, ms) })
                    }

                    // Upstream SDK export (sqlpad): plain sleep with progress reporting.
                    async function delay(ms) {
                      return sleep(ms)
                    }

                    async function waitUntil(predicate, options) {
                      var interval = (options && options.interval) || 500
                      var timeout = (options && options.timeout) || 5000
                      var deadline = Date.now() + timeout
                      while (Date.now() <= deadline) {
                        if (await predicate()) return
                        await sleep(interval)
                      }
                      throw ToolError.timeout('waitUntil timed out after ' + timeout + 'ms')
                    }

                    function httpStatusToToolError(status, message, headers) {
                      if (status === 401 || status === 403) return ToolError.auth(message)
                      if (status === 404) return ToolError.notFound(message)
                      if (status === 429) {
                        var retryAfterMs = headers ? parseRateLimitHeader(headers) : undefined
                        return ToolError.rateLimited(message, retryAfterMs)
                      }
                      if (status === 400 || status === 422) return ToolError.validation(message)
                      if (status === 408) return ToolError.timeout(message)
                      if (status >= 500) return new ToolError(message, 'HTTP_ERROR', { category: 'internal', retryable: true })
                      return new ToolError(message, 'HTTP_ERROR', { retryable: false })
                    }

                    var FETCH_TIMEOUT_MS = 18000

                    async function fetchFromPage(url, init) {
                      init = init || {}
                      var timeout = init.timeout || 30000
                      var controller = null
                      if (typeof AbortController === 'function') {
                        try { controller = new AbortController() } catch (e) {}
                      }
                      var budget = Math.min(timeout, FETCH_TIMEOUT_MS)
                      var timer = controller
                        ? setTimeout(function () { try { controller.abort() } catch (e) {} }, budget)
                        : null
                      var response
                      try {
                        response = await fetch(url, {
                          credentials: 'include',
                          ...init,
                          signal: controller ? controller.signal : undefined,
                          timeout: undefined,
                        })
                      } catch (error) {
                        if (timer !== null) clearTimeout(timer)
                        var aborted = error && (error.name === 'AbortError' || String(error).indexOf('abort') !== -1)
                        if (aborted) {
                          return { __fetchError: ToolError.timeout('request timed out after ' + budget + 'ms for ' + url) }
                        }
                        return {
                          __fetchError: new ToolError('network error for ' + url + ': ' + String(error), 'NETWORK_ERROR', {
                            category: 'internal',
                            retryable: true,
                          }),
                        }
                      }
                      if (timer !== null) clearTimeout(timer)
                      if (response && response.__fetchError) throw response.__fetchError
                      if (!response.ok) {
                        var rawText = ''
                        try { rawText = await response.text() } catch (e) { rawText = '' }
                        var text = String(rawText || '')
                        var body = text.length > 512 ? text.slice(0, 512) + '…' : text
                        throw httpStatusToToolError(
                          response.status,
                          'HTTP ' + response.status + ' for ' + url + ': ' + body,
                          response.headers
                        )
                      }
                      return response
                    }

                    async function fetchJSON(url, init, schema) {
                      var response = await fetchFromPage(url, init)
                      if (response.status === 204) return undefined
                      var data
                      try {
                        data = await response.json()
                      } catch (e) {
                        throw ToolError.validation('failed to parse JSON from ' + url)
                      }
                      return data
                    }

                    // Upstream SDK export (sqlpad): same transport, raw text body.
                    async function fetchText(url, init) {
                      var response = await fetchFromPage(url, init)
                      try {
                        return await response.text()
                      } catch (e) {
                        throw ToolError.validation('failed to read text from ' + url)
                      }
                    }

                    // Upstream SDK export (hex): POST JSON, return the parsed body (null
                    // on 204). Uses the same credentials:'include' transport.
                    async function postJSON(url, body, init) {
                      init = init || {}
                      var response = await fetchFromPage(url, {
                        method: 'POST',
                        headers: Object.assign({ 'Content-Type': 'application/json' }, init.headers || {}),
                        body: JSON.stringify(body),
                        timeout: init.timeout,
                      })
                      if (response.status === 204) return null
                      try {
                        return await response.json()
                      } catch (e) {
                        throw ToolError.validation('failed to parse JSON from ' + url)
                      }
                    }

                    // Upstream SDK export (hex): querySelectorAll over the live document,
                    // returning a real array.
                    function querySelectorAll(selector) {
                      try {
                        return Array.prototype.slice.call(document.querySelectorAll(selector))
                      } catch (e) {
                        return []
                      }
                    }

          const GRAPHQL_URL = 'https://leetcode.com/graphql/';
          const getCsrfToken = () => getCookie('csrftoken');
          const isAuthenticated = () => getCsrfToken() !== null;
          const waitForAuth = async () => {
              try {
                  await waitUntil(() => isAuthenticated(), {
                      interval: 500,
                      timeout: 5000,
                  });
                  return true;
              }
              catch {
                  return false;
              }
          };
          /**
           * Execute a GraphQL query against the LeetCode API.
           * Auth is via HttpOnly LEETCODE_SESSION cookie (sent automatically with credentials: 'include').
           * Writes require the `x-csrftoken` header from the non-HttpOnly `csrftoken` cookie.
           */
          const graphql = async (query, variables = {}) => {
              const csrf = getCsrfToken();
              if (!csrf)
                  throw ToolError.auth('Not authenticated — please log in to LeetCode.');
              const headers = {
                  'Content-Type': 'application/json',
                  'x-csrftoken': csrf,
              };
              const init = {
                  method: 'POST',
                  headers,
                  body: JSON.stringify({ query, variables }),
              };
              const response = await fetchFromPage(GRAPHQL_URL, init);
              const json = (await response.json());
              if (json.errors?.length && !json.data) {
                  const msg = json.errors.map(e => e.message).join('; ');
                  throw ToolError.internal(`GraphQL error: ${msg}`);
              }
              return json.data;
          };
          /**
           * Call a REST endpoint on LeetCode (e.g., interpret_solution, submit).
           * Uses the same cookie-based auth as GraphQL.
           */
          const rest = async (path, options = {}) => {
              const csrf = getCsrfToken();
              if (!csrf)
                  throw ToolError.auth('Not authenticated — please log in to LeetCode.');
              const url = `https://leetcode.com${path}`;
              const headers = {
                  'Content-Type': 'application/json',
                  'x-csrftoken': csrf,
                  Referer: 'https://leetcode.com',
              };
              const init = {
                  method: options.method ?? 'POST',
                  headers,
              };
              if (options.body) {
                  init.body = JSON.stringify(options.body);
              }
              const response = await fetchFromPage(url, init);
              if (response.status === 204)
                  return {};
              return (await response.json());
          };
          /**
           * Poll a submission check endpoint until it reaches a terminal state.
           */
          const pollSubmissionResult = async (submissionId) => {
              const csrf = getCsrfToken();
              if (!csrf)
                  throw ToolError.auth('Not authenticated — please log in to LeetCode.');
              let result = {};
              await waitUntil(async () => {
                  const response = await fetchFromPage(`https://leetcode.com/submissions/detail/${submissionId}/check/`, {
                      method: 'GET',
                      headers: { 'x-csrftoken': csrf },
                  });
                  result = (await response.json());
                  return result.state === 'SUCCESS' || result.state === 'FAILURE';
              }, { interval: 1000, timeout: 30000 });
              return result;
          };

          // --- User / Profile ---
          const userStatusSchema = z.object({
              userId: z.number().describe('Numeric user ID'),
              username: z.string().describe('Username'),
              avatar: z.string().describe('Avatar URL'),
              isSignedIn: z.boolean().describe('Whether the user is signed in'),
              isPremium: z.boolean().describe('Whether the user has a premium subscription'),
              isVerified: z.boolean().describe('Whether the email is verified'),
              checkedInToday: z.boolean().describe('Whether the user checked in today'),
              numUnread: z.number().describe('Number of unread notifications'),
          });
          const mapUserStatus = (u) => ({
              userId: u.userId ?? 0,
              username: u.username ?? '',
              avatar: u.avatar ?? '',
              isSignedIn: u.isSignedIn ?? false,
              isPremium: u.isPremium ?? false,
              isVerified: u.isVerified ?? false,
              checkedInToday: u.checkedInToday ?? false,
              numUnread: u.notificationStatus?.numUnread ?? 0,
          });
          const userProfileSchema = z.object({
              username: z.string().describe('Username'),
              realName: z.string().describe('Real name'),
              aboutMe: z.string().describe('Bio / about me text'),
              avatar: z.string().describe('Avatar URL'),
              reputation: z.number().describe('Reputation score'),
              ranking: z.number().describe('Global ranking'),
              company: z.string().describe('Company name'),
              school: z.string().describe('School name'),
              countryName: z.string().describe('Country'),
              websites: z.array(z.string()).describe('Website URLs'),
              skillTags: z.array(z.string()).describe('Skill tags'),
          });
          const mapUserProfile = (u) => ({
              username: u.username ?? '',
              realName: u.profile?.realName ?? '',
              aboutMe: u.profile?.aboutMe ?? '',
              avatar: u.profile?.userAvatar ?? '',
              reputation: u.profile?.reputation ?? 0,
              ranking: u.profile?.ranking ?? 0,
              company: u.profile?.company ?? '',
              school: u.profile?.school ?? '',
              countryName: u.profile?.countryName ?? '',
              websites: u.profile?.websites ?? [],
              skillTags: u.profile?.skillTags ?? [],
          });
          // --- Question Progress ---
          const questionProgressSchema = z.object({
              accepted: z
                  .array(z.object({
                  difficulty: z.string().describe('Difficulty level (EASY, MEDIUM, HARD)'),
                  count: z.number().describe('Number of accepted questions'),
              }))
                  .describe('Accepted questions by difficulty'),
              failed: z
                  .array(z.object({
                  difficulty: z.string().describe('Difficulty level'),
                  count: z.number().describe('Number of failed questions'),
              }))
                  .describe('Failed questions by difficulty'),
              untouched: z
                  .array(z.object({
                  difficulty: z.string().describe('Difficulty level'),
                  count: z.number().describe('Number of untouched questions'),
              }))
                  .describe('Untouched questions by difficulty'),
          });
          const mapDifficultyCounts = (items) => (items ?? []).map(i => ({
              difficulty: i.difficulty ?? '',
              count: i.count ?? 0,
          }));
          const mapQuestionProgress = (p) => ({
              accepted: mapDifficultyCounts(p.numAcceptedQuestions),
              failed: mapDifficultyCounts(p.numFailedQuestions),
              untouched: mapDifficultyCounts(p.numUntouchedQuestions),
          });
          // --- Topic Tag ---
          const topicTagSchema = z.object({
              name: z.string().describe('Tag name (e.g., "Array", "Dynamic Programming")'),
              slug: z.string().describe('URL-safe slug'),
          });
          const mapTopicTag = (t) => ({
              name: t.name ?? '',
              slug: t.slug ?? '',
          });
          // --- Question (List Item) ---
          const questionListItemSchema = z.object({
              frontendId: z.string().describe('Problem number as displayed on LeetCode (e.g., "1")'),
              title: z.string().describe('Problem title'),
              titleSlug: z.string().describe('URL slug for the problem'),
              difficulty: z.string().describe('Difficulty: Easy, Medium, or Hard'),
              acRate: z.number().describe('Acceptance rate as a percentage'),
              status: z.string().describe('User status: "ac" (accepted), "notac" (attempted), or "" (not attempted)'),
              isFavor: z.boolean().describe('Whether the user has favorited this problem'),
              paidOnly: z.boolean().describe('Whether this problem requires a premium subscription'),
              hasSolution: z.boolean().describe('Whether an official solution exists'),
              hasVideoSolution: z.boolean().describe('Whether a video solution exists'),
              topicTags: z.array(topicTagSchema).describe('Topic tags'),
          });
          const mapQuestionListItem = (q) => ({
              frontendId: q.frontendQuestionId ?? '',
              title: q.title ?? '',
              titleSlug: q.titleSlug ?? '',
              difficulty: q.difficulty ?? '',
              acRate: q.acRate ?? 0,
              status: q.status ?? '',
              isFavor: q.isFavor ?? false,
              paidOnly: q.isPaidOnly ?? false,
              hasSolution: q.hasSolution ?? false,
              hasVideoSolution: q.hasVideoSolution ?? false,
              topicTags: (q.topicTags ?? []).map(mapTopicTag),
          });
          // --- Question (Detail) ---
          const codeSnippetSchema = z.object({
              lang: z.string().describe('Language display name (e.g., "Python3")'),
              langSlug: z.string().describe('Language slug (e.g., "python3")'),
              code: z.string().describe('Starter code template'),
          });
          const mapCodeSnippet = (s) => ({
              lang: s.lang ?? '',
              langSlug: s.langSlug ?? '',
              code: s.code ?? '',
          });
          const questionDetailSchema = z.object({
              questionId: z.string().describe('Internal question ID'),
              frontendId: z.string().describe('Problem number as displayed'),
              title: z.string().describe('Problem title'),
              titleSlug: z.string().describe('URL slug'),
              content: z.string().describe('Problem description in HTML'),
              difficulty: z.string().describe('Difficulty: Easy, Medium, or Hard'),
              likes: z.number().describe('Number of likes'),
              dislikes: z.number().describe('Number of dislikes'),
              isLiked: z.boolean().describe('Whether the current user liked this problem'),
              isPaidOnly: z.boolean().describe('Whether this requires premium'),
              categoryTitle: z.string().describe('Category (e.g., "Algorithms")'),
              acRate: z.number().describe('Acceptance rate percentage'),
              status: z.string().describe('User status: "ac", "notac", or ""'),
              topicTags: z.array(topicTagSchema).describe('Topic tags'),
              hints: z.array(z.string()).describe('Hints for solving'),
              similarQuestions: z.string().describe('JSON string of similar questions'),
              exampleTestcases: z.string().describe('Example test cases (newline-separated)'),
              sampleTestCase: z.string().describe('Sample test case input'),
              codeSnippets: z.array(codeSnippetSchema).describe('Starter code for each language'),
          });
          const mapQuestionDetail = (q) => ({
              questionId: q.questionId ?? '',
              frontendId: q.questionFrontendId ?? '',
              title: q.title ?? '',
              titleSlug: q.titleSlug ?? '',
              content: q.content ?? '',
              difficulty: q.difficulty ?? '',
              likes: q.likes ?? 0,
              dislikes: q.dislikes ?? 0,
              isLiked: q.isLiked ?? false,
              isPaidOnly: q.isPaidOnly ?? false,
              categoryTitle: q.categoryTitle ?? '',
              acRate: q.acRate ?? 0,
              status: q.status ?? '',
              topicTags: (q.topicTags ?? []).map(mapTopicTag),
              hints: q.hints ?? [],
              similarQuestions: q.similarQuestions ?? '[]',
              exampleTestcases: q.exampleTestcases ?? '',
              sampleTestCase: q.sampleTestCase ?? '',
              codeSnippets: (q.codeSnippets ?? []).map(mapCodeSnippet),
          });
          // --- Submission ---
          const submissionSchema = z.object({
              id: z.string().describe('Submission ID'),
              title: z.string().describe('Problem title'),
              titleSlug: z.string().describe('Problem slug'),
              statusDisplay: z.string().describe('Status (e.g., "Accepted", "Wrong Answer")'),
              lang: z.string().describe('Language used'),
              runtime: z.string().describe('Runtime (e.g., "13 ms")'),
              memory: z.string().describe('Memory usage (e.g., "42.3 MB")'),
              timestamp: z.string().describe('Unix timestamp of submission'),
              url: z.string().describe('Submission URL path'),
          });
          const mapSubmission = (s) => ({
              id: s.id ?? '',
              title: s.title ?? '',
              titleSlug: s.titleSlug ?? '',
              statusDisplay: s.statusDisplay ?? '',
              lang: s.lang ?? '',
              runtime: s.runtime ?? '',
              memory: s.memory ?? '',
              timestamp: s.timestamp ?? '',
              url: s.url ?? '',
          });
          // --- Submission Detail ---
          const submissionDetailSchema = z.object({
              runtime: z.number().describe('Runtime in milliseconds'),
              runtimeDisplay: z.string().describe('Display runtime (e.g., "13 ms")'),
              runtimePercentile: z.number().describe('Runtime percentile (0-100)'),
              memory: z.number().describe('Memory in bytes'),
              memoryDisplay: z.string().describe('Display memory (e.g., "42.3 MB")'),
              memoryPercentile: z.number().describe('Memory percentile (0-100)'),
              code: z.string().describe('Submitted source code'),
              timestamp: z.number().describe('Unix timestamp'),
              statusCode: z.number().describe('Status code (10 = Accepted)'),
              lang: z.string().describe('Language name'),
              questionTitle: z.string().describe('Problem title'),
              questionTitleSlug: z.string().describe('Problem slug'),
              notes: z.string().describe('User notes on the submission'),
              topicTags: z.array(topicTagSchema).describe('Topic tags'),
              runtimeError: z.string().describe('Runtime error message if any'),
              compileError: z.string().describe('Compile error message if any'),
          });
          const mapSubmissionDetail = (s) => ({
              runtime: s.runtime ?? 0,
              runtimeDisplay: s.runtimeDisplay ?? '',
              runtimePercentile: s.runtimePercentile ?? 0,
              memory: s.memory ?? 0,
              memoryDisplay: s.memoryDisplay ?? '',
              memoryPercentile: s.memoryPercentile ?? 0,
              code: s.code ?? '',
              timestamp: s.timestamp ?? 0,
              statusCode: s.statusCode ?? 0,
              lang: s.lang?.name ?? '',
              questionTitle: s.question?.title ?? '',
              questionTitleSlug: s.question?.titleSlug ?? '',
              notes: s.notes ?? '',
              topicTags: (s.topicTags ?? []).map(mapTopicTag),
              runtimeError: s.runtimeError ?? '',
              compileError: s.compileError ?? '',
          });
          // --- Recent AC Submission ---
          const recentSubmissionSchema = z.object({
              id: z.string().describe('Submission ID'),
              title: z.string().describe('Problem title'),
              titleSlug: z.string().describe('Problem slug'),
              timestamp: z.string().describe('Unix timestamp'),
              statusDisplay: z.string().describe('Status display (e.g., "Accepted")'),
              lang: z.string().describe('Language used'),
          });
          const mapRecentSubmission = (s) => ({
              id: s.id ?? '',
              title: s.title ?? '',
              titleSlug: s.titleSlug ?? '',
              timestamp: s.timestamp ?? '',
              statusDisplay: s.statusDisplay ?? '',
              lang: s.lang ?? '',
          });
          // --- Daily Challenge ---
          const dailyChallengeSchema = z.object({
              date: z.string().describe('Challenge date (YYYY-MM-DD)'),
              link: z.string().describe('Link to the problem'),
              question: questionListItemSchema,
          });
          const mapDailyChallenge = (d) => ({
              date: d.date ?? '',
              link: d.link ?? '',
              question: mapQuestionListItem(d.question ?? {}),
          });
          // --- Calendar / Streak ---
          const calendarSchema = z.object({
              activeYears: z.array(z.number()).describe('Years with activity'),
              streak: z.number().describe('Current streak in days'),
              totalActiveDays: z.number().describe('Total active days'),
              submissionCalendar: z.string().describe('JSON string mapping timestamps to submission counts'),
          });
          const mapCalendar = (c) => ({
              activeYears: c.activeYears ?? [],
              streak: c.streak ?? 0,
              totalActiveDays: c.totalActiveDays ?? 0,
              submissionCalendar: c.submissionCalendar ?? '{}',
          });
          // --- Contest Ranking ---
          const contestRankingSchema = z.object({
              attendedContestsCount: z.number().describe('Number of contests attended'),
              rating: z.number().describe('Contest rating'),
              globalRanking: z.number().describe('Global contest ranking'),
              totalParticipants: z.number().describe('Total contest participants'),
              topPercentage: z.number().describe('Top percentage ranking'),
          });
          const mapContestRanking = (r) => ({
              attendedContestsCount: r.attendedContestsCount ?? 0,
              rating: r.rating ?? 0,
              globalRanking: r.globalRanking ?? 0,
              totalParticipants: r.totalParticipants ?? 0,
              topPercentage: r.topPercentage ?? 0,
          });
          // --- Discussion ---
          const discussionSchema = z.object({
              id: z.number().describe('Discussion topic ID'),
              title: z.string().describe('Topic title'),
              viewCount: z.number().describe('Number of views'),
              voteCount: z.number().describe('Number of votes on the post'),
              creationDate: z.string().describe('Creation date as Unix timestamp string'),
              tags: z.array(topicTagSchema).describe('Tags on the topic'),
          });
          const mapDiscussion = (d) => ({
              id: d.id ?? 0,
              title: d.title ?? '',
              viewCount: d.viewCount ?? 0,
              voteCount: d.post?.voteCount ?? 0,
              creationDate: d.post?.creationDate ?? '',
              tags: (d.tags ?? []).map(mapTopicTag),
          });
          // --- Run Code Result ---
          const runCodeResultSchema = z.object({
              state: z.string().describe('Execution state: SUCCESS or FAILURE'),
              statusCode: z.number().describe('Status code (10 = Accepted)'),
              statusMsg: z.string().describe('Status message (e.g., "Accepted", "Wrong Answer")'),
              statusRuntime: z.string().describe('Runtime display (e.g., "0 ms")'),
              statusMemory: z.string().describe('Memory display (e.g., "19.2 MB")'),
              codeAnswer: z.array(z.string()).describe('Output from the submitted code'),
              expectedCodeAnswer: z.array(z.string()).describe('Expected output'),
              correctAnswer: z.boolean().describe('Whether the answer matches expected output'),
              totalCorrect: z.number().describe('Number of correct test cases'),
              totalTestcases: z.number().describe('Total number of test cases'),
              runtimeError: z.string().describe('Runtime error message if any'),
              compileError: z.string().describe('Compile error message if any'),
          });
          const mapRunCodeResult = (r) => ({
              state: r.state ?? '',
              statusCode: r.status_code ?? 0,
              statusMsg: r.status_msg ?? '',
              statusRuntime: r.status_runtime ?? '',
              statusMemory: r.status_memory ?? '',
              codeAnswer: r.code_answer ?? [],
              expectedCodeAnswer: r.expected_code_answer ?? [],
              correctAnswer: r.correct_answer ?? false,
              totalCorrect: r.total_correct ?? 0,
              totalTestcases: r.total_testcases ?? 0,
              runtimeError: r.full_runtime_error ?? r.runtime_error ?? '',
              compileError: r.full_compile_error ?? r.compile_error ?? '',
          });
          // --- Submit Result ---
          const submitResultSchema = z.object({
              state: z.string().describe('Execution state: SUCCESS or FAILURE'),
              statusCode: z.number().describe('Status code (10 = Accepted)'),
              statusMsg: z.string().describe('Status message'),
              statusRuntime: z.string().describe('Runtime display'),
              statusMemory: z.string().describe('Memory display'),
              totalCorrect: z.number().describe('Number of correct test cases'),
              totalTestcases: z.number().describe('Total test cases'),
              runtimePercentile: z.number().describe('Runtime percentile (0-100)'),
              memoryPercentile: z.number().describe('Memory percentile (0-100)'),
              submissionId: z.string().describe('Submission ID for the result'),
              runtimeError: z.string().describe('Runtime error if any'),
              compileError: z.string().describe('Compile error if any'),
              lastTestcase: z.string().describe('Last failing test case if any'),
          });
          const mapSubmitResult = (r) => ({
              state: r.state ?? '',
              statusCode: r.status_code ?? 0,
              statusMsg: r.status_msg ?? '',
              statusRuntime: r.status_runtime ?? '',
              statusMemory: r.status_memory ?? '',
              totalCorrect: r.total_correct ?? 0,
              totalTestcases: r.total_testcases ?? 0,
              runtimePercentile: r.runtime_percentile ?? 0,
              memoryPercentile: r.memory_percentile ?? 0,
              submissionId: String(r.submission_id ?? ''),
              runtimeError: r.full_runtime_error ?? r.runtime_error ?? '',
              compileError: r.full_compile_error ?? r.compile_error ?? '',
              lastTestcase: r.last_testcase ?? '',
          });
          const getUserCalendar = defineTool({
              name: 'get_user_calendar',
              displayName: 'Get User Calendar',
              description: 'Get a user submission calendar (heatmap data), current streak, total active days, and active years. Optionally filter by year.',
              summary: 'Get submission calendar and streaks',
              icon: 'calendar',
              group: 'Users',
              input: z.object({
                  username: z.string().describe('LeetCode username'),
                  year: z.number().int().optional().describe('Filter by year (e.g., 2025). Omit for all years.'),
              }),
              output: z.object({ calendar: calendarSchema }),
              handle: async (params) => {
                  const data = await graphql(`query userProfileCalendar($username: String!, $year: Int) {
          				matchedUser(username: $username) {
          					userCalendar(year: $year) {
          						activeYears streak totalActiveDays submissionCalendar
          					}
          				}
          			}`, { username: params.username, year: params.year });
                  return { calendar: mapCalendar(data.matchedUser?.userCalendar ?? {}) };
              },
          });
                    const refreshAuth = waitForAuth;



                    var pluginTool = getUserCalendar

                    function mapThrown(error) {
                      if (error && error.name === 'ToolError') {
                        var code = error.code || 'TOOL_ERROR'
                        if (error.category === 'auth') code = 'AUTH'
                        else if (error.category === 'not_found') code = 'NOT_FOUND'
                        else if (error.category === 'rate_limit') code = 'RATE_LIMITED'
                        else if (error.category === 'validation') code = 'VALIDATION'
                        else if (error.category === 'timeout') code = 'TIMEOUT'
                        else if (error.category === 'internal') code = 'INTERNAL'
                        return errorEnvelope(code, error.message || 'Tool failed')
                      }
                      return errorEnvelope('UNKNOWN', error && error.message ? error.message : String(error))
                    }

                    function errorEnvelope(code, message) {
                      return { status: 'error', data: null, error_code: code, message: message, page_url: location.href }
                    }

                    function okEnvelope(data) {
                      return { status: 'ok', data: data, message: null, page_url: location.href }
                    }

                    function assertPage() {
                      var PRODUCT_HOSTS = {
                        'sqlpad': /(^|\.)(sqlpad\.[a-z0-9.-]+|localhost|127\.0\.0\.1)$/,
                      }
                      var productProbe = PRODUCT_HOSTS['leetcode'] || null
                      if (typeof location === 'undefined' || !location.hostname) {
                        return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a LeetCode page.')
                      }
                      if (true) {
                        if (!new RegExp('(^|\\.)leetcode\\.com$').test(location.hostname)) {
                          return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a LeetCode page.')
                        }
                      } else if (productProbe) {
                        // Self-hosted product (upstream urlPatterns: []): no host to pin,
                        // enforce the product's own host shape at call time.
                        if (!productProbe.test(location.hostname)) {
                          return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a LeetCode page.')
                        }
                      }
                      return null
                    }

                    // Some upstream plugins cache a session token that tools read
                    // synchronously (docker-hub's getUsername()). Upstream primes it in
                    // its activation hook, which a WebMCP package does not have: prime it
                    // once here, or every tool that needs the username reports AUTH.
                    var __authPrimed = false
                    async function __primeAuth() {
                      if (__authPrimed) return
                      __authPrimed = true
                      try {
                        if (typeof refreshAuth === 'function') await refreshAuth()
                        else if (typeof waitForAuth === 'function') await waitForAuth()
                      } catch (e) {
                        // The tool's own auth check reports the failure with its code.
                      }
                    }

                    async function runTool(name, args) {
                      var pageError = assertPage()
                      if (pageError) return pageError
                      try {
                        await __primeAuth()
                        var data = await pluginTool.handle(args || {})
                        return okEnvelope(data === undefined ? {} : data)
                      } catch (error) {
                        return mapThrown(error)
                      }
                    }


          var toolEntry = {
            async get_user_calendar(args) {
              return runTool('get_user_calendar', args)
            },
          }

          async function stdin_default(args) {
            return toolEntry['get_user_calendar'](args)
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
        // Tab closed/navigated or the eval timed out: surface a stable workflow
        // error instead of letting the adapter rejection escape.
        state.result = {
          status: 'error',
          data: null,
          message:
            'The LeetCode tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'LeetCode API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The LeetCode tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
