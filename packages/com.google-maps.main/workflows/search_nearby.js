// Self-contained adapter workflow. The Google Maps session and every same-origin
// API call stay inside the Google Maps tab.

export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "category": {
        "type": "string",
        "description": "Category to search for (e.g., \"restaurants\", \"gas stations\", \"coffee shops\")"
      },
      "lat": {
        "description": "Latitude for search center. Uses current map center if omitted.",
        "type": "number"
      },
      "lng": {
        "description": "Longitude for search center. Uses current map center if omitted.",
        "type": "number"
      },
      "zoom": {
        "description": "Zoom level (1-21, default 15)",
        "type": "integer",
        "minimum": 1,
        "maximum": 21
      }
    },
    "required": [
      "category"
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
    description: 'search_nearby',
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

          // --- Auth detection ---
          // Google Maps uses HttpOnly session cookies for API calls.
          // Maps works for both anonymous and logged-in users.
          // Auth detection verifies the Maps page is loaded and functional.
          const isAuthenticated = () => {
              const url = getCurrentUrl();
              return url.includes('google.com/maps');
          };
          const waitForAuth = () => waitUntil(() => isAuthenticated(), { interval: 500, timeout: 5000 }).then(() => true, () => false);
          // --- Maps search API ---
          const searchPlaces = async (query, lat, lng, radius, maxResults) => {
              const params = new URLSearchParams({
                  tbm: 'map',
                  authuser: '0',
                  hl: 'en',
                  gl: 'us',
                  q: query,
              });
              const pb = `!4m8!1m3!1d${radius}!2d${lng}!3d${lat}!3m2!1i1024!2i768!4f13.1!7i${maxResults}`;
              params.set('pb', pb);
              const response = await fetchFromPage(`/search?${params.toString()}`);
              const text = await response.text();
              return text.replace(/^\)\]\}'\n/, '');
          };
          // --- Page state extraction ---
          const getMapCenter = () => {
              const url = getCurrentUrl();
              const match = url.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*),(\d+\.?\d*)z/);
              if (match?.[1] && match[2] && match[3]) {
                  return {
                      lat: Number.parseFloat(match[1]),
                      lng: Number.parseFloat(match[2]),
                      zoom: Number.parseFloat(match[3]),
                  };
              }
              const initState = getPageGlobal('APP_INITIALIZATION_STATE');
              if (initState?.[0] && Array.isArray(initState[0])) {
                  const viewport = initState[0];
                  const coords = viewport[0];
                  if (coords && coords.length >= 3 && typeof coords[2] === 'number' && typeof coords[1] === 'number') {
                      return { lat: coords[2], lng: coords[1], zoom: 15 };
                  }
              }
              return null;
          };
          const getSearchQuery = () => {
              const url = getCurrentUrl();
              const searchMatch = url.match(/\/maps\/search\/([^/@]+)/);
              if (searchMatch?.[1])
                  return decodeURIComponent(searchMatch[1].replace(/\+/g, ' '));
              const placeMatch = url.match(/\/maps\/place\/([^/@]+)/);
              if (placeMatch?.[1])
                  return decodeURIComponent(placeMatch[1].replace(/\+/g, ' '));
              return null;
          };
          const getDirectionsFromUrl = () => {
              const url = getCurrentUrl();
              const dirMatch = url.match(/\/maps\/dir\/([^/]+)\/([^/@]+)/);
              if (!dirMatch?.[1] || !dirMatch[2])
                  return null;
              let travelMode = 'driving';
              if (url.includes('!3e1'))
                  travelMode = 'transit';
              else if (url.includes('!3e2'))
                  travelMode = 'walking';
              else if (url.includes('!3e3'))
                  travelMode = 'bicycling';
              return {
                  origin: decodeURIComponent(dirMatch[1].replace(/\+/g, ' ')),
                  destination: decodeURIComponent(dirMatch[2].replace(/\+/g, ' ')),
                  travelMode,
              };
          };
          // --- Fetch HTML page and extract embedded data ---
          const fetchPageData = async (path) => {
              const resp = await fetchFromPage(path, {
                  headers: { Accept: 'text/html' },
              });
              const html = await resp.text();
              const stateMatch = html.match(/window\.APP_INITIALIZATION_STATE\s*=\s*(\[[\s\S]*?\]);\s*(?:window|var|<\/script>)/);
              if (!stateMatch?.[1]) {
                  throw ToolError.internal('Failed to extract Maps page data');
              }
              const state = JSON.parse(stateMatch[1]);
              return { state, html };
          };
          // --- Extract embedded JSON from APP_INITIALIZATION_STATE ---
          const extractEmbeddedData = (state) => {
              const stateArr = state;
              const innerContainer = stateArr[3];
              if (!Array.isArray(innerContainer))
                  return null;
              for (let i = 0; i < innerContainer.length; i++) {
                  const entry = innerContainer[i];
                  if (typeof entry === 'string' && entry.length > 100) {
                      const cleaned = entry.replace(/^\)\]\}'\n/, '');
                      try {
                          return JSON.parse(cleaned);
                      }
                      catch {
                          // Malformed JSON — skip and try the next entry
                      }
                  }
              }
              return null;
          };
          // --- URL builders ---
          const buildSearchUrl = (query, lat, lng, zoom) => {
              const encodedQuery = encodeURIComponent(query);
              if (lat !== undefined && lng !== undefined) {
                  const z = zoom ?? 15;
                  return `/maps/search/${encodedQuery}/@${lat},${lng},${z}z`;
              }
              return `/maps/search/${encodedQuery}`;
          };
          const buildDirectionsUrl = (origin, destination, travelMode) => {
              const encodedOrigin = encodeURIComponent(origin);
              const encodedDest = encodeURIComponent(destination);
              const modeMap = {
                  driving: '0',
                  transit: '1',
                  walking: '2',
                  bicycling: '3',
              };
              const modeCode = modeMap[travelMode] ?? '0';
              return `/maps/dir/${encodedOrigin}/${encodedDest}/data=!4m2!4m1!3e${modeCode}`;
          };
          const buildPlaceUrl = (query) => {
              return `/maps/place/${encodeURIComponent(query)}`;
          };
          const buildLocationUrl = (lat, lng, zoom) => {
              return `/maps/@${lat},${lng},${zoom}z`;
          };

          // --- Map view schema ---
          const mapViewSchema = z.object({
              lat: z.number().describe('Map center latitude'),
              lng: z.number().describe('Map center longitude'),
              zoom: z.number().describe('Map zoom level (1-21, higher is more detailed)'),
              query: z.string().describe('Current search query or place name, empty if none'),
              url: z.string().describe('Current Google Maps URL'),
          });
          // --- Place search result schema ---
          const placeSearchResultSchema = z.object({
              name: z.string().describe('Place name'),
              place_id: z.string().describe('Google Maps internal place identifier (hex format)'),
              address: z.string().describe('Place address'),
              rating: z.number().describe('Average rating (1-5), 0 if not available'),
              review_count: z.number().describe('Number of reviews, 0 if not available'),
              type: z.string().describe('Place type/category (e.g., restaurant, cafe)'),
              lat: z.number().describe('Place latitude'),
              lng: z.number().describe('Place longitude'),
              open_now: z.string().describe('Current open status (e.g., "Open", "Closed", ""), empty if unknown'),
              price_level: z.string().describe('Price level ("$", "$$", "$$$", "$$$$"), empty if not available'),
          });
          const mapPlaceSearchResult = (p) => ({
              name: p.name ?? '',
              place_id: p.place_id ?? '',
              address: p.address ?? '',
              rating: p.rating ?? 0,
              review_count: p.review_count ?? 0,
              type: p.type ?? '',
              lat: p.lat ?? 0,
              lng: p.lng ?? 0,
              open_now: p.open_now ?? '',
              price_level: p.price_level ?? '',
          });
          // --- Place detail schema ---
          const placeDetailSchema = z.object({
              name: z.string().describe('Place name'),
              place_id: z.string().describe('Google Maps internal place identifier'),
              address: z.string().describe('Full address'),
              lat: z.number().describe('Place latitude'),
              lng: z.number().describe('Place longitude'),
              rating: z.number().describe('Average rating (1-5), 0 if not available'),
              review_count: z.number().describe('Number of reviews, 0 if not available'),
              phone: z.string().describe('Phone number, empty if not available'),
              website: z.string().describe('Website URL, empty if not available'),
              type: z.string().describe('Place type/category'),
              price_level: z.string().describe('Price level indicator'),
              hours: z.array(z.string()).describe('Opening hours by day, empty if not available'),
              url: z.string().describe('Google Maps URL for this place'),
          });
          const mapPlaceDetail = (p) => ({
              name: p.name ?? '',
              place_id: p.place_id ?? '',
              address: p.address ?? '',
              lat: p.lat ?? 0,
              lng: p.lng ?? 0,
              rating: p.rating ?? 0,
              review_count: p.review_count ?? 0,
              phone: p.phone ?? '',
              website: p.website ?? '',
              type: p.type ?? '',
              price_level: p.price_level ?? '',
              hours: p.hours ?? [],
              url: p.url ?? '',
          });
          // --- Directions schema ---
          const directionRouteSchema = z.object({
              summary: z.string().describe('Route summary (e.g., "via I-280 S")'),
              distance: z.string().describe('Total distance (e.g., "12.3 mi")'),
              duration: z.string().describe('Estimated travel time (e.g., "18 min")'),
              origin: z.string().describe('Origin address or name'),
              destination: z.string().describe('Destination address or name'),
              travel_mode: z.string().describe('Travel mode: driving, transit, walking, or bicycling'),
              url: z.string().describe('Google Maps directions URL'),
          });
          const mapDirectionRoute = (r) => ({
              summary: r.summary ?? '',
              distance: r.distance ?? '',
              duration: r.duration ?? '',
              origin: r.origin ?? '',
              destination: r.destination ?? '',
              travel_mode: r.travel_mode ?? 'driving',
              url: r.url ?? '',
          });
          const searchNearby = defineTool({
              name: 'search_nearby',
              displayName: 'Search Nearby',
              description: 'Open a Google Maps search for a category of places near specific coordinates. Navigates the browser to show results on the map. Common categories: restaurants, hotels, gas stations, coffee, pharmacies, ATMs, grocery stores, parking, hospitals, banks.',
              summary: 'Search by category near coordinates',
              icon: 'compass',
              group: 'Search',
              input: z.object({
                  category: z.string().describe('Category to search for (e.g., "restaurants", "gas stations", "coffee shops")'),
                  lat: z.number().optional().describe('Latitude for search center. Uses current map center if omitted.'),
                  lng: z.number().optional().describe('Longitude for search center. Uses current map center if omitted.'),
                  zoom: z.number().int().min(1).max(21).optional().describe('Zoom level (1-21, default 15)'),
              }),
              output: z.object({
                  url: z.string().describe('The Google Maps search URL navigated to'),
                  success: z.boolean().describe('Whether the navigation succeeded'),
              }),
              handle: async (params) => {
                  const center = getMapCenter();
                  const lat = params.lat ?? center?.lat;
                  const lng = params.lng ?? center?.lng;
                  const zoom = params.zoom ?? center?.zoom;
                  const query = `${params.category} nearby`;
                  const path = buildSearchUrl(query, lat, lng, zoom);
                  const fullUrl = `https://www.google.com${path}`;
                  window['location'].href = fullUrl;
                  return { url: fullUrl, success: true };
              },
          });
                    const refreshAuth = waitForAuth;



                    var pluginTool = searchNearby

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
                      var productProbe = PRODUCT_HOSTS['google-maps'] || null
                      if (typeof location === 'undefined' || !location.hostname) {
                        return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Google Maps page.')
                      }
                      if (true) {
                        if (!new RegExp('(^|\\.)google\\.com$').test(location.hostname)) {
                          return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Google Maps page.')
                        }
                      } else if (productProbe) {
                        // Self-hosted product (upstream urlPatterns: []): no host to pin,
                        // enforce the product's own host shape at call time.
                        if (!productProbe.test(location.hostname)) {
                          return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Google Maps page.')
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
            async search_nearby(args) {
              return runTool('search_nearby', args)
            },
          }

          async function stdin_default(args) {
            return toolEntry['search_nearby'](args)
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
            'The Google Maps tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'Google Maps API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The Google Maps tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
