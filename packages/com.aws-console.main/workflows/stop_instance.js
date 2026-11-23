// Self-contained adapter workflow. The AWS Console session and every same-origin
// API call stay inside the AWS Console tab.

export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "instance_id": {
        "type": "string",
        "minLength": 1,
        "description": "EC2 instance ID to stop (e.g., i-1234567890abcdef0)"
      }
    },
    "required": [
      "instance_id"
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
    description: 'stop_instance',
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

          // --- Credential Interception ---
          /** Active MutationObserver for iframe discovery — disconnected after credentials are captured. */
          let iframeObserver = null;
          /** Disconnect the iframe MutationObserver if still active. */
          const disconnectCredentialObserver = () => {
              if (iframeObserver) {
                  iframeObserver.disconnect();
                  iframeObserver = null;
                  log.debug('Disconnected credential interception MutationObserver');
              }
          };
          /**
           * Install credential interception hooks on service iframes.
           *
           * The AWS Console loads each service (EC2, Lambda, etc.) in a same-origin iframe.
           * Each iframe's Janus SDK exchanges the console session cookies for temporary STS
           * credentials via an HTTP request whose JSON response contains the full credential
           * set (accessKeyId, secretAccessKey, sessionToken, expiration).
           *
           * We patch Response.prototype.json in every same-origin iframe — both existing ones
           * and new ones discovered via MutationObserver — to capture the credential exchange
           * response. Captured credentials are persisted via the SDK auth cache so they survive
           * adapter re-injection.
           *
           * Because the adapter runs at document_idle (after page scripts), we cannot intercept
           * the initial credential exchange on the first page load. Credentials become available
           * after the user navigates to a second service page or an iframe triggers a credential
           * refresh (credentials expire every ~15 minutes).
           */
          const installCredentialInterceptor = () => {
              const g = globalThis;
              if (g.__awsCredInterceptorInstalled)
                  return;
              g.__awsCredInterceptorInstalled = true;
              const patchFrame = (win) => {
                  try {
                      const w = win;
                      if (w.__awsPatched)
                          return;
                      w.__awsPatched = true;
                      const origJson = w.Response.prototype.json;
                      w.Response.prototype.json = async function () {
                          const result = await origJson.call(this);
                          try {
                              const c = result?.credentials ?? result;
                              if (c &&
                                  typeof c === 'object' &&
                                  typeof c.accessKeyId === 'string' &&
                                  typeof c.secretAccessKey === 'string' &&
                                  typeof c.sessionToken === 'string') {
                                  setAuthCache('aws-console', c);
                                  log.debug('Captured AWS credentials from iframe credential exchange');
                                  disconnectCredentialObserver();
                              }
                          }
                          catch {
                              // Ignore non-credential responses
                          }
                          return result;
                      };
                  }
                  catch {
                      // Cross-origin iframes throw — ignore
                  }
              };
              const patchIframe = (iframe) => {
                  // Patch on load (catches iframes that haven't loaded yet)
                  iframe.addEventListener('load', () => {
                      try {
                          if (iframe.contentWindow)
                              patchFrame(iframe.contentWindow);
                      }
                      catch {
                          // Ignore cross-origin
                      }
                  });
                  // Also patch immediately (catches already-loaded iframes)
                  try {
                      if (iframe.contentWindow)
                          patchFrame(iframe.contentWindow);
                  }
                  catch {
                      // Ignore cross-origin
                  }
              };
              // Patch all existing iframes
              for (const iframe of document.querySelectorAll('iframe')) {
                  patchIframe(iframe);
              }
              // Watch for new iframes added to the DOM
              iframeObserver = new MutationObserver(mutations => {
                  for (const m of mutations) {
                      for (const node of m.addedNodes) {
                          if (node instanceof HTMLIFrameElement) {
                              patchIframe(node);
                          }
                          if (node instanceof HTMLElement) {
                              for (const f of node.querySelectorAll('iframe')) {
                                  patchIframe(f);
                              }
                          }
                      }
                  }
              });
              if (document.body) {
                  iframeObserver.observe(document.body, { childList: true, subtree: true });
              }
              else {
                  document.addEventListener('DOMContentLoaded', () => {
                      iframeObserver?.observe(document.body, { childList: true, subtree: true });
                  });
              }
          };
          // Install at module scope (guard for Node.js build environment)
          if (typeof document !== 'undefined') {
              installCredentialInterceptor();
          }
          // --- Auth Detection ---
          const getSessionInfo = () => {
              const raw = getMetaContent('awsc-session-data');
              if (!raw)
                  return null;
              try {
                  const data = JSON.parse(raw);
                  if (!data.accountId)
                      return null;
                  return {
                      accountId: String(data.accountId),
                      displayName: String(data.displayName ?? ''),
                      sessionARN: String(data.sessionARN ?? ''),
                      infrastructureRegion: String(data.infrastructureRegion ?? ''),
                  };
              }
              catch {
                  return null;
              }
          };
          const getUserInfo = () => {
              const raw = getCookie('aws-userInfo');
              if (!raw)
                  return null;
              try {
                  const decoded = decodeURIComponent(raw);
                  const data = JSON.parse(decoded);
                  if (!data.arn)
                      return null;
                  return { username: data.username ?? '', arn: data.arn ?? '', signinType: data.signinType ?? '' };
              }
              catch {
                  return null;
              }
          };
          const isAuthenticated = () => getUserInfo() !== null || getSessionInfo() !== null;
          const waitForAuth = async () => {
              try {
                  await waitUntil(() => isAuthenticated(), { interval: 500, timeout: 5000 });
                  return true;
              }
              catch {
                  return false;
              }
          };
          const getAccountInfo = () => {
              const session = getSessionInfo();
              const user = getUserInfo();
              if (!session && !user) {
                  throw ToolError.auth('Not authenticated — please log in to the AWS Console.');
              }
              return {
                  accountId: session?.accountId ?? '',
                  username: user?.username ?? session?.displayName ?? '',
                  arn: user?.arn ?? '',
                  sessionARN: session?.sessionARN ?? '',
                  region: session?.infrastructureRegion ?? '',
                  signinType: user?.signinType ?? '',
              };
          };
          // --- Region and Service Data ---
          const getCurrentRegion = () => getMetaContent('awsc-mezz-region') ?? 'us-east-1';
          const getRegions = () => {
              const raw = getMetaContent('awsc-mezz-data');
              if (!raw)
                  return [];
              try {
                  return JSON.parse(raw).regions ?? [];
              }
              catch {
                  return [];
              }
          };
          // --- SigV4 Signing ---
          const toArrayBuffer = (bytes) => {
              const buf = new ArrayBuffer(bytes.byteLength);
              new Uint8Array(buf).set(bytes);
              return buf;
          };
          const hmacSha256 = async (key, data) => {
              const keyBytes = typeof key === 'string' ? new TextEncoder().encode(key) : key;
              const dataBytes = new TextEncoder().encode(data);
              const cryptoKey = await crypto.subtle.importKey('raw', toArrayBuffer(keyBytes), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
              return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, dataBytes));
          };
          const sha256Hex = async (data) => {
              const bytes = new TextEncoder().encode(data);
              const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
              return Array.from(hash)
                  .map(b => b.toString(16).padStart(2, '0'))
                  .join('');
          };
          const toHex = (bytes) => Array.from(bytes)
              .map(b => b.toString(16).padStart(2, '0'))
              .join('');
          const formatDate = (d) => {
              const pad = (n) => String(n).padStart(2, '0');
              const dateStamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
              const amzDate = `${dateStamp}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
              return { dateStamp, amzDate };
          };
          /**
           * Sign an AWS API request using SigV4 via the Web Crypto API.
           *
           * Supports both query-string APIs (EC2, IAM) and REST APIs (Lambda, CloudWatch Logs).
           * The path may include a query string (e.g., "/2015-03-31/functions?MaxItems=50") which
           * is separated and included in the canonical request per SigV4 spec.
           */
          const signRequest = async (creds, method, host, path, body, region, service, headers) => {
              const { dateStamp, amzDate } = formatDate(new Date());
              const bodyHash = await sha256Hex(body);
              const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
              const allHeaders = {
                  host,
                  'x-amz-content-sha256': bodyHash,
                  'x-amz-date': amzDate,
                  'x-amz-security-token': creds.sessionToken,
                  ...headers,
              };
              const signedHeaderNames = Object.keys(allHeaders).sort().join(';');
              const canonicalHeaders = Object.keys(allHeaders)
                  .sort()
                  .map(k => `${k}:${allHeaders[k]}\n`)
                  .join('');
              // Separate path and query string for canonical request
              const qsIndex = path.indexOf('?');
              const canonicalPath = qsIndex >= 0 ? path.substring(0, qsIndex) : path;
              const canonicalQueryString = qsIndex >= 0 ? path.substring(qsIndex + 1) : '';
              const canonicalRequest = [
                  method,
                  canonicalPath,
                  canonicalQueryString,
                  canonicalHeaders,
                  signedHeaderNames,
                  bodyHash,
              ].join('\n');
              const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, await sha256Hex(canonicalRequest)].join('\n');
              const kDate = await hmacSha256(`AWS4${creds.secretAccessKey}`, dateStamp);
              const kRegion = await hmacSha256(kDate, region);
              const kService = await hmacSha256(kRegion, service);
              const kSigning = await hmacSha256(kService, 'aws4_request');
              const signature = toHex(await hmacSha256(kSigning, stringToSign));
              const authorization = `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaderNames}, Signature=${signature}`;
              return { ...allHeaders, authorization };
          };
          // --- Credentials ---
          const getCredentials = () => {
              const cached = getAuthCache('aws-console');
              if (cached?.accessKeyId && cached.secretAccessKey && cached.sessionToken) {
                  if (cached.expiration) {
                      const expiresAt = new Date(cached.expiration).getTime();
                      if (Date.now() < expiresAt - 60_000)
                          return cached;
                      log.debug('AWS credentials expired, clearing cache');
                      clearAuthCache('aws-console');
                  }
                  else {
                      return cached;
                  }
              }
              throw ToolError.auth('AWS credentials not yet captured. Navigate to an AWS service page (e.g., EC2, Lambda) and wait a few seconds, then retry. Credentials are captured automatically when a service page loads its iframe.');
          };
          // --- Error Classification ---
          const classifyError = (status, body, service) => {
              if (status === 401 || status === 403) {
                  // Parse the error body to decide whether to clear cached credentials.
                  // Real auth failures include an XML/JSON error body; CORS-blocked or permission
                  // errors on specific resources should not invalidate the credential cache.
                  const isExpiredCreds = body.includes('ExpiredToken') || body.includes('RequestExpired') || body.includes('InvalidClientTokenId');
                  if (isExpiredCreds) {
                      clearAuthCache('aws-console');
                  }
                  const msgMatch = body.match(/<Message>(.*?)<\/Message>/);
                  throw ToolError.auth(msgMatch?.[1] ?? `AWS ${service} authentication failed (${status}).`);
              }
              if (status === 404) {
                  throw ToolError.notFound(`AWS ${service} resource not found.`);
              }
              if (status === 429) {
                  throw ToolError.rateLimited(`AWS ${service} rate limit exceeded. Try again later.`);
              }
              if (status === 400) {
                  const msgMatch = body.match(/<Message>(.*?)<\/Message>/);
                  let jsonMsg;
                  if (body.startsWith('{')) {
                      try {
                          jsonMsg = JSON.parse(body).Message;
                      }
                      catch {
                          // Malformed JSON body — fall through to generic message
                      }
                  }
                  throw ToolError.validation(msgMatch?.[1] ?? jsonMsg ?? `AWS ${service} bad request (400).`);
              }
              const msgMatch = body.match(/<Message>(.*?)<\/Message>/);
              throw ToolError.internal(msgMatch?.[1] ?? `AWS ${service} error (${status}): ${body.substring(0, 200)}`);
          };
          // --- XML Parser ---
          /**
           * Parse an AWS XML response into a nested object.
           *
           * Uses DOMParser (available in the browser page context). Handles:
           * - Nested elements via recursion
           * - Repeated sibling elements with the same tag name as arrays
           * - AWS list wrapper tags (`<item>`, `<member>`) always treated as arrays
           * - Leaf text nodes returned as strings
           * - XML namespace prefixes stripped (uses localName)
           */
          const parseXml = (xml) => {
              const doc = new DOMParser().parseFromString(xml, 'text/xml');
              const nodeToObject = (node) => {
                  const children = Array.from(node.children);
                  if (children.length === 0)
                      return node.textContent ?? '';
                  const result = {};
                  const seenKeys = new Set();
                  for (const child of children) {
                      const key = child.localName;
                      const value = nodeToObject(child);
                      const isListWrapper = key === 'item' || key === 'member';
                      if (seenKeys.has(key) || isListWrapper) {
                          // Convert to array on second occurrence, or always for list wrappers
                          const existing = result[key];
                          if (Array.isArray(existing)) {
                              existing.push(value);
                          }
                          else if (existing !== undefined) {
                              result[key] = [existing, value];
                          }
                          else {
                              result[key] = [value];
                          }
                      }
                      else {
                          result[key] = value;
                      }
                      seenKeys.add(key);
                  }
                  return result;
              };
              return nodeToObject(doc.documentElement);
          };
          /**
           * Make a signed AWS API call.
           *
           * Supports both query-string APIs (EC2, IAM, CloudWatch) and REST APIs (Lambda).
           *
           * @param service - AWS service identifier used for signing and hostname (e.g., "ec2", "lambda")
           * @param action  - API action. For query APIs this becomes the Action parameter. For JSON
           *                  APIs with amz-json content type, this becomes the X-Amz-Target header.
           *                  For REST APIs where the action is encoded in the path, pass an empty string.
           * @param params  - Query parameters for query-string APIs (ignored when jsonBody/rawBody is set)
           * @param options - Additional options (see AwsApiOptions)
           */
          const awsApi = async (service, action, params = {}, options = {}) => {
              const creds = getCredentials();
              const region = options.region ?? getCurrentRegion();
              const method = options.method ?? 'POST';
              const path = options.path ?? '/';
              // Determine host — IAM is a global service with a fixed endpoint
              let host = options.host ?? `${service}.${region}.amazonaws.com`;
              if (service === 'iam')
                  host = 'iam.amazonaws.com';
              // Determine signing region — IAM always signs with us-east-1
              const signingRegion = service === 'iam' ? 'us-east-1' : region;
              // Build request body and headers
              let body;
              const headers = { ...options.extraHeaders };
              if (options.rawBody !== undefined) {
                  body = options.rawBody;
                  headers['content-type'] = options.contentType ?? 'application/x-www-form-urlencoded';
              }
              else if (options.jsonBody !== undefined) {
                  body = JSON.stringify(options.jsonBody);
                  headers['content-type'] = options.contentType ?? 'application/x-amz-json-1.0';
                  if (action && options.contentType?.includes('amz-json')) {
                      headers['x-amz-target'] = action;
                  }
              }
              else {
                  // Query-string API (default)
                  const qs = new URLSearchParams(action ? { Action: action, ...params } : params);
                  if (options.version)
                      qs.set('Version', options.version);
                  body = qs.toString();
                  headers['content-type'] = 'application/x-www-form-urlencoded';
              }
              // For GET requests, the body must be empty (query params go in the URL path)
              const fetchBody = method === 'GET' ? undefined : body;
              const signBody = method === 'GET' ? '' : body;
              const signedHeaders = await signRequest(creds, method, host, path, signBody, signingRegion, service, headers);
              let resp;
              try {
                  resp = await fetch(`https://${host}${path}`, {
                      method,
                      headers: signedHeaders,
                      body: fetchBody,
                  });
              }
              catch (e) {
                  // "Failed to fetch" typically means CORS blocked the request
                  const msg = e instanceof Error ? e.message : String(e);
                  throw ToolError.internal(`AWS ${service} request failed (likely CORS): ${msg}. This endpoint may not allow cross-origin requests from the console.`);
              }
              const respText = await resp.text();
              if (!resp.ok)
                  classifyError(resp.status, respText, service);
              // Parse response based on content type
              const trimmed = respText.trim();
              if (trimmed.startsWith('{') || trimmed.startsWith('['))
                  return JSON.parse(trimmed);
              if (trimmed.startsWith('<'))
                  return parseXml(trimmed);
              return trimmed;
          };

          // --- Account ---
          const accountInfoSchema = z.object({
              account_id: z.string().describe('AWS account ID (12-digit number)'),
              username: z.string().describe('IAM username or root account email'),
              arn: z.string().describe('User ARN from aws-userInfo cookie'),
              session_arn: z.string().describe('Session ARN from console session'),
              region: z.string().describe('Current console region (e.g., us-east-2)'),
              signin_type: z.string().describe('Sign-in type (PUBLIC for root, ROLE for IAM role, etc.)'),
          });
          // --- Region ---
          const regionSchema = z.object({
              id: z.string().describe('Region identifier (e.g., us-east-1)'),
              name: z.string().describe('Geographic area name (e.g., United States)'),
              location: z.string().describe('City/location (e.g., N. Virginia)'),
              opt_in: z.boolean().describe('Whether the region requires opt-in'),
          });
          const mapRegion = (r) => ({
              id: r.id ?? '',
              name: r.name ?? '',
              location: r.location ?? '',
              opt_in: r.optIn ?? false,
          });
          // --- EC2 Instance ---
          const instanceSchema = z.object({
              instance_id: z.string().describe('EC2 instance ID (e.g., i-1234567890abcdef0)'),
              instance_type: z.string().describe('Instance type (e.g., t2.micro)'),
              state: z.string().describe('Instance state (running, stopped, pending, etc.)'),
              public_ip: z.string().describe('Public IPv4 address (empty if none)'),
              private_ip: z.string().describe('Private IPv4 address'),
              vpc_id: z.string().describe('VPC ID'),
              subnet_id: z.string().describe('Subnet ID'),
              launch_time: z.string().describe('Launch time (ISO 8601)'),
              name: z.string().describe('Name tag value (empty if no Name tag)'),
              key_name: z.string().describe('Key pair name (empty if none)'),
              availability_zone: z.string().describe('Availability zone (e.g., us-east-2a)'),
              architecture: z.string().describe('Architecture (x86_64, arm64)'),
              platform: z.string().describe('Platform (linux, windows)'),
          });
          const extractName = (tagSet) => {
              const items = Array.isArray(tagSet?.item) ? tagSet.item : tagSet?.item ? [tagSet.item] : [];
              const nameTag = items.find(t => t.key === 'Name');
              return nameTag?.value ?? '';
          };
          const mapInstance = (i) => ({
              instance_id: i.instanceId ?? '',
              instance_type: i.instanceType ?? '',
              state: i.instanceState?.name ?? '',
              public_ip: i.publicIpAddress ?? '',
              private_ip: i.privateIpAddress ?? '',
              vpc_id: i.vpcId ?? '',
              subnet_id: i.subnetId ?? '',
              launch_time: i.launchTime ?? '',
              name: extractName(i.tagSet),
              key_name: i.keyName ?? '',
              availability_zone: i.placement?.availabilityZone ?? '',
              architecture: i.architecture ?? '',
              platform: i.platform ?? i.platformDetails ?? 'linux',
          });
          // --- Security Group ---
          const securityGroupSchema = z.object({
              group_id: z.string().describe('Security group ID (e.g., sg-12345)'),
              group_name: z.string().describe('Security group name'),
              description: z.string().describe('Description'),
              vpc_id: z.string().describe('VPC ID'),
          });
          const mapSecurityGroup = (sg) => ({
              group_id: sg.groupId ?? '',
              group_name: sg.groupName ?? '',
              description: sg.groupDescription ?? '',
              vpc_id: sg.vpcId ?? '',
          });
          // --- VPC ---
          const vpcSchema = z.object({
              vpc_id: z.string().describe('VPC ID (e.g., vpc-12345)'),
              cidr_block: z.string().describe('IPv4 CIDR block'),
              state: z.string().describe('VPC state (available, pending)'),
              is_default: z.boolean().describe('Whether this is the default VPC'),
              name: z.string().describe('Name tag value (empty if no Name tag)'),
          });
          const mapVpc = (v) => ({
              vpc_id: v.vpcId ?? '',
              cidr_block: v.cidrBlock ?? '',
              state: v.state ?? '',
              is_default: v.isDefault === 'true',
              name: extractName(v.tagSet),
          });
          // --- Subnet ---
          const subnetSchema = z.object({
              subnet_id: z.string().describe('Subnet ID (e.g., subnet-12345)'),
              vpc_id: z.string().describe('VPC ID this subnet belongs to'),
              cidr_block: z.string().describe('IPv4 CIDR block'),
              availability_zone: z.string().describe('Availability zone (e.g., us-east-2a)'),
              available_ips: z.number().describe('Number of available IPv4 addresses'),
              name: z.string().describe('Name tag value (empty if no Name tag)'),
              state: z.string().describe('Subnet state (available, pending)'),
              is_default: z.boolean().describe('Whether this is the default subnet for the AZ'),
          });
          const mapSubnet = (s) => ({
              subnet_id: s.subnetId ?? '',
              vpc_id: s.vpcId ?? '',
              cidr_block: s.cidrBlock ?? '',
              availability_zone: s.availabilityZone ?? '',
              available_ips: Number(s.availableIpAddressCount ?? 0),
              name: extractName(s.tagSet),
              state: s.state ?? '',
              is_default: s.defaultForAz === 'true',
          });
          // --- Lambda Function ---
          const lambdaFunctionSchema = z.object({
              function_name: z.string().describe('Function name'),
              function_arn: z.string().describe('Function ARN'),
              runtime: z.string().describe('Runtime (e.g., nodejs20.x, python3.12)'),
              handler: z.string().describe('Handler function (e.g., index.handler)'),
              code_size: z.number().describe('Code size in bytes'),
              memory_size: z.number().describe('Memory allocated in MB'),
              timeout: z.number().describe('Timeout in seconds'),
              last_modified: z.string().describe('Last modified timestamp'),
              state: z.string().describe('Function state (Active, Pending, Inactive, Failed)'),
              description: z.string().describe('Function description'),
          });
          const mapLambdaFunction = (f) => ({
              function_name: f.FunctionName ?? '',
              function_arn: f.FunctionArn ?? '',
              runtime: f.Runtime ?? '',
              handler: f.Handler ?? '',
              code_size: f.CodeSize ?? 0,
              memory_size: f.MemorySize ?? 0,
              timeout: f.Timeout ?? 0,
              last_modified: f.LastModified ?? '',
              state: f.State ?? '',
              description: f.Description ?? '',
          });
          // --- IAM User ---
          const iamUserSchema = z.object({
              user_name: z.string().describe('IAM user name'),
              user_id: z.string().describe('Unique user ID'),
              arn: z.string().describe('User ARN'),
              create_date: z.string().describe('Creation date (ISO 8601)'),
              path: z.string().describe('User path'),
          });
          const mapIamUser = (u) => ({
              user_name: u.UserName ?? '',
              user_id: u.UserId ?? '',
              arn: u.Arn ?? '',
              create_date: u.CreateDate ?? '',
              path: u.Path ?? '',
          });
          // --- IAM Role ---
          const iamRoleSchema = z.object({
              role_name: z.string().describe('IAM role name'),
              role_id: z.string().describe('Unique role ID'),
              arn: z.string().describe('Role ARN'),
              create_date: z.string().describe('Creation date (ISO 8601)'),
              path: z.string().describe('Role path'),
              description: z.string().describe('Role description'),
          });
          const mapIamRole = (r) => ({
              role_name: r.RoleName ?? '',
              role_id: r.RoleId ?? '',
              arn: r.Arn ?? '',
              create_date: r.CreateDate ?? '',
              path: r.Path ?? '',
              description: r.Description ?? '',
          });
          // --- CloudWatch Log Group ---
          const logGroupSchema = z.object({
              log_group_name: z.string().describe('Log group name (e.g., /aws/lambda/my-function)'),
              arn: z.string().describe('Log group ARN'),
              retention_days: z.number().describe('Retention period in days (0 means never expire)'),
              stored_bytes: z.number().describe('Bytes stored in the log group'),
              creation_time: z.string().describe('Creation time as epoch milliseconds string'),
          });
          const mapLogGroup = (g) => ({
              log_group_name: g.logGroupName ?? '',
              arn: g.arn ?? '',
              retention_days: g.retentionInDays ?? 0,
              stored_bytes: g.storedBytes ?? 0,
              creation_time: String(g.creationTime ?? ''),
          });
          // --- CloudWatch Alarm ---
          const alarmSchema = z.object({
              alarm_name: z.string().describe('Alarm name'),
              alarm_arn: z.string().describe('Alarm ARN'),
              state_value: z.string().describe('Alarm state (OK, ALARM, INSUFFICIENT_DATA)'),
              metric_name: z.string().describe('CloudWatch metric name'),
              namespace: z.string().describe('Metric namespace'),
              description: z.string().describe('Alarm description'),
          });
          const mapAlarm = (a) => ({
              alarm_name: a.AlarmName ?? '',
              alarm_arn: a.AlarmArn ?? '',
              state_value: a.StateValue ?? '',
              metric_name: a.MetricName ?? '',
              namespace: a.Namespace ?? '',
              description: a.AlarmDescription ?? '',
          });
          // --- Helpers ---
          /**
           * Normalize AWS XML list items. AWS XML responses wrap lists in various ways:
           * - <instancesSet><item>...</item></instancesSet> (EC2)
           * The parsed XML may produce a single object or an array depending on item count.
           */
          const normalizeList = (items) => {
              if (!items)
                  return [];
              if (Array.isArray(items))
                  return items;
              return [items];
          };
          /**
           * Extract EC2 instances from a DescribeInstances response.
           * Handles the nested reservationSet > item > instancesSet > item structure.
           */
          const extractInstances = (data) => {
              const reservationSet = data.reservationSet;
              const reservations = normalizeList(reservationSet?.item);
              const instances = [];
              for (const reservation of reservations) {
                  const instancesSet = reservation.instancesSet;
                  instances.push(...normalizeList(instancesSet?.item));
              }
              return instances;
          };
          const stopInstance = defineTool({
              name: 'stop_instance',
              displayName: 'Stop EC2 Instance',
              description: 'Stop a running EC2 instance. The instance must be in the "running" state. Returns the previous and current state of the instance.',
              summary: 'Stop a running EC2 instance',
              icon: 'square',
              group: 'EC2',
              input: z.object({
                  instance_id: z.string().min(1).describe('EC2 instance ID to stop (e.g., i-1234567890abcdef0)'),
              }),
              output: z.object({
                  instance_id: z.string().describe('Instance ID'),
                  previous_state: z.string().describe('Previous instance state'),
                  current_state: z.string().describe('Current instance state after stop'),
              }),
              handle: async (params) => {
                  const data = await awsApi('ec2', 'StopInstances', { 'InstanceId.1': params.instance_id }, { version: '2016-11-15' });
                  const stateChange = data.instancesSet?.item;
                  if (!stateChange)
                      throw ToolError.internal('Unexpected response from StopInstances');
                  return {
                      instance_id: String(stateChange.instanceId ?? params.instance_id),
                      previous_state: String(stateChange.previousState?.name ?? 'unknown'),
                      current_state: String(stateChange.currentState?.name ?? 'stopping'),
                  };
              },
          });


                    var pluginTool = stopInstance

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
                      if (typeof location === 'undefined' || !location.hostname) {
                        return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a AWS Console page.')
                      }
                      if (!/(^|\.)console\.aws\.amazon\.com$/.test(location.hostname)) {
                        return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a AWS Console page.')
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
            async stop_instance(args) {
              return runTool('stop_instance', args)
            },
          }

          async function stdin_default(args) {
            return toolEntry['stop_instance'](args)
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
            'The AWS Console tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'AWS Console API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The AWS Console tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
