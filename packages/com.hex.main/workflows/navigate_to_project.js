// Self-contained adapter workflow. The Hex session and every same-origin
// API call stay inside the Hex tab.

export default {
  inputSchema: {
    "type": "object",
    "properties": {
      "project_id": {
        "type": "string",
        "minLength": 1,
        "description": "Hex project ID"
      },
      "mode": {
        "description": "Project route to open: app or logic (default app)",
        "type": "string",
        "enum": [
          "app",
          "logic"
        ]
      }
    },
    "required": [
      "project_id"
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
    description: 'navigate_to_project',
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

          const CACHE_NAMESPACE = 'hex';
          const FALLBACK_OPERATION_HASHES = {
              CollectionsForFilter: '462a3d4abd8d3267afd8287ceb960561c21501358df9ee8715ad24acb0dd2d41',
              CreateHex: '716f549e1e4901051be3d02e091f7534f8b3bd5ef271106e517c3448206c4600',
              CreateHexFromHome: 'd7b7386710489490bc1f477a21d2eeb3163620fbe5a4774dcf54865e8a93ae89',
              doAppSessionAtomicOperation: '992dc618f7f7a2d28d33332e68c8e2175fd43051786bdb2d4dd456c9208e20d1',
              doHexVersionAtomicOperation: '4cadb318249f8ca6a2ddf35369af575947b0af691e9cd60f2fda544e1ada346a',
              GetDataConnectionsForHomePageSidebar: 'bd7c3099dcc2e3411937555cf51e1a84c549d4cb43620c17727d8a1114c5375e',
              GetExplores: 'b866bab8544aeacbf4f246a7574d7adf1cd2a17f718aa9d556284f9f262d4823',
              GetHexesForHome: '47eec24be05da5528678d9b212181072e717331c89f8ef24d832d156bf30dc55',
              GetHexVersion: 'ce87b62607dbcd9187368ae2d210130599bc756b1134f315fb89bfbc9ea52593',
              GetLogicSessionId: 'dd8801955ea8c2b2d4ee326d758b6f1c7e095471fefcf360427a0bb8339cab31',
              HexVersionMPModel: '019db38b640f582892b29a966a0402878d3081a3dc5dc1e8bed5be02fb49f2d5',
              GetOrgCategories: 'c8a68c0afc9c55df866594a8e0170772bbf473f9e36a858f82302e587fbf14c8',
              GetOrgStatuses: '024f7a32a4e8feab5b17020ea4f1bd9984c4beda4e55b9d00d9fb707f7daa615',
              GetProjectLabelsForHome: '7589c73ad9c51fc481256149ab98f59c29838014c93be778a8b688b4d64f0534',
              GetRecentThreads: '1b8126a2a04b8e73f508c82df273e7779bcff05f456ec040458c8d9cd02c841e',
              GetSafeOrUnknownHexesForHome: 'd5da34e7b30ac605cb02adbdc2ba7f56a4ec1f6a4219292a292879a75f799e4c',
              Me: '442871bec9991e3b7cded771cab93235918a990c9ba868fcdd0a6f044900835f',
              ProductVersions: '1f0d5841e07d4a5db2a812bf81fb00073e2d19f19cfd27e8082bdbb1ed3978b4',
              UpdateHexTitle: '2aa36a53bbbdf7b7c8fe508cdf9b9cb1977a5ff30e3c50c2a1851d436ab0fe82',
          };
          const OPERATION_HASH_PATTERNS = [
              /"([A-Za-z][A-Za-z0-9_]{1,80})":"([a-f0-9]{64})"/g,
              /\\"([A-Za-z][A-Za-z0-9_]{1,80})\\":\\"([a-f0-9]{64})\\"/g,
          ];
          const isAuthenticated = () => {
              const launchDarklyUser = getPageGlobal('launchDarklyContext.user');
              if (launchDarklyUser && typeof launchDarklyUser === 'object')
                  return true;
              const hexVersion = getPageGlobal('launchDarklyContext.user.hexVersion');
              return typeof hexVersion === 'string' && hexVersion.length > 0;
          };
          const waitForAuth = () => waitUntil(() => isAuthenticated(), { interval: 500, timeout: 5000 }).then(() => true, () => false);
          const getOrgId = () => {
              const pathSegment = new URL(getCurrentUrl()).pathname.split('/').filter(Boolean)[0];
              return pathSegment ?? 'global';
          };
          const getCurrentContext = () => {
              const url = new URL(getCurrentUrl());
              const pathParts = url.pathname.split('/').filter(Boolean);
              const orgId = pathParts[0] ?? 'global';
              const section = pathParts[1] ?? '';
              const projectId = ['app', 'hex'].includes(section) ? (pathParts[2] ?? '') : '';
              return {
                  origin: url.origin,
                  org_id: orgId,
                  section,
                  project_id: projectId,
                  url: url.href,
                  title: document.title,
              };
          };
          const buildProjectUrl = (projectId, mode = 'app') => {
              const url = new URL(getCurrentUrl());
              const encodedProjectId = encodeURIComponent(projectId);
              url.pathname =
                  mode === 'logic'
                      ? `/${getOrgId()}/hex/${encodedProjectId}/draft/logic`
                      : `/${getOrgId()}/app/${encodedProjectId}/latest`;
              url.search = '';
              url.hash = '';
              return url.href;
          };
          const navigateToProject = (projectId, mode = 'app') => {
              const url = buildProjectUrl(projectId, mode);
              window['location'].href = url;
              return url;
          };
          const getAgentVersion = () => {
              const hexVersion = getPageGlobal('launchDarklyContext.user.hexVersion');
              return typeof hexVersion === 'string' ? hexVersion : '';
          };
          const getGraphQLHeaders = () => ({
              'x-agent-type': 'WEB_CLIENT',
              'x-agent-version': getAgentVersion(),
              'x-csrf-safe': 'safe',
              'x-org-id': getOrgId(),
          });
          const isHexScriptUrl = (url) => {
              try {
                  const parsed = new URL(url, getCurrentUrl());
                  return parsed.hostname === 'static.hex.site' && parsed.pathname.endsWith('.js');
              }
              catch {
                  return false;
              }
          };
          const getScriptUrls = () => {
              const scriptUrls = querySelectorAll('script[src]').map(script => script.src);
              const resourceUrls = performance
                  .getEntriesByType('resource')
                  .map(entry => entry.name)
                  .filter(url => typeof url === 'string');
              return Array.from(new Set([...scriptUrls, ...resourceUrls].filter(isHexScriptUrl)));
          };
          const readHashCache = (scriptUrls) => {
              const cache = getAuthCache(CACHE_NAMESPACE);
              if (!cache)
                  return null;
              if (cache.scriptUrls.length !== scriptUrls.length)
                  return null;
              if (cache.scriptUrls.some((url, index) => url !== scriptUrls[index]))
                  return null;
              return cache;
          };
          const extractOperations = (text, operations) => {
              for (const pattern of OPERATION_HASH_PATTERNS) {
                  pattern.lastIndex = 0;
                  let match = pattern.exec(text);
                  while (match !== null) {
                      const [, operationName, hash] = match;
                      if (operationName && hash)
                          operations[operationName] = hash;
                      match = pattern.exec(text);
                  }
              }
          };
          const discoverOperationHashes = async (requiredOperation, forceRefresh = false) => {
              const scriptUrls = getScriptUrls();
              const cached = readHashCache(scriptUrls);
              if (!forceRefresh && cached && (!requiredOperation || cached.operations[requiredOperation]))
                  return cached;
              const operations = {};
              for (const url of scriptUrls) {
                  try {
                      const text = await fetchText(url, { credentials: 'omit', timeout: 15_000 });
                      extractOperations(text, operations);
                      if (requiredOperation && operations[requiredOperation])
                          break;
                  }
                  catch {
                      // Static bundle discovery is best-effort. A known operation table is used
                      // when the currently loaded bundles do not expose a requested operation.
                  }
              }
              const nextCache = {
                  scriptUrls,
                  operations: { ...FALLBACK_OPERATION_HASHES, ...operations },
              };
              setAuthCache(CACHE_NAMESPACE, nextCache);
              return nextCache;
          };
          const getOperationHash = async (operationName) => {
              const cache = await discoverOperationHashes(operationName);
              const hash = cache.operations[operationName];
              if (!hash)
                  throw ToolError.internal(`Hex operation hash not found for ${operationName}.`);
              return hash;
          };
          const isPersistedQueryError = (error) => {
              if (!(error instanceof Error))
                  return false;
              const message = error.message.toLowerCase();
              return message.includes('persisted') || message.includes('sha256') || message.includes('operation hash');
          };
          const buildGraphQLPath = (operationName, options = {}) => {
              const query = buildQueryString({
                  op: operationName,
                  extra: options.extra,
              });
              return `/graphql?${query}`;
          };
          const graphQLOnce = async (operationName, variables, options = {}) => {
              if (!isAuthenticated())
                  throw ToolError.auth('Not authenticated — please log in to Hex.');
              const hash = await getOperationHash(operationName);
              const response = await postJSON(buildGraphQLPath(operationName, options), {
                  operationName,
                  variables,
                  extensions: {
                      persistedQuery: {
                          version: 1,
                          sha256Hash: hash,
                      },
                  },
              }, { headers: getGraphQLHeaders() });
              if (!response)
                  throw ToolError.internal(`Hex returned an empty response for ${operationName}.`);
              if (response.errors?.length) {
                  const message = response.errors.map(error => error.message ?? error.extensions?.code ?? 'Unknown error').join('; ');
                  throw ToolError.validation(`Hex GraphQL error for ${operationName}: ${message}`);
              }
              if (!response.data)
                  throw ToolError.internal(`Hex response for ${operationName} did not include data.`);
              return response.data;
          };
          const graphQL = async (operationName, variables, options = {}) => {
              try {
                  return await graphQLOnce(operationName, variables, options);
              }
              catch (error) {
                  if (!isPersistedQueryError(error))
                      throw error;
                  await discoverOperationHashes(operationName, true);
                  return graphQLOnce(operationName, variables, options);
              }
          };
          const collectResponseTypes = (value, types = new Set()) => {
              if (!value || typeof value !== 'object')
                  return Array.from(types);
              if (Array.isArray(value)) {
                  for (const item of value)
                      collectResponseTypes(item, types);
                  return Array.from(types);
              }
              const record = value;
              const typename = record.__typename;
              if (typeof typename === 'string' && typename.length > 0)
                  types.add(typename);
              const operationType = record.type;
              if (typeof operationType === 'string' && operationType.length > 0)
                  types.add(operationType);
              for (const child of Object.values(record))
                  collectResponseTypes(child, types);
              return Array.from(types);
          };
          const findStringField = (value, fieldName) => {
              if (!value || typeof value !== 'object')
                  return '';
              if (Array.isArray(value)) {
                  for (const item of value) {
                      const found = findStringField(item, fieldName);
                      if (found)
                          return found;
                  }
                  return '';
              }
              const record = value;
              if (record.key === fieldName && typeof record.value === 'string')
                  return record.value;
              const directValue = record[fieldName];
              if (typeof directValue === 'string')
                  return directValue;
              for (const child of Object.values(record)) {
                  const found = findStringField(child, fieldName);
                  if (found)
                      return found;
              }
              return '';
          };
          const summarizeAtomicOperation = (operation) => {
              const responses = (operation?.responses ?? []).flat(Number.POSITIVE_INFINITY);
              return {
                  response_count: responses.length,
                  response_types: collectResponseTypes(responses),
                  revision: operation?.revision ?? null,
                  last_run_start: findStringField(responses, 'lastRunStart'),
              };
          };
          const getDraftVersion = async (projectId) => {
              const [versionData, logicSessionData] = await Promise.all([
                  graphQL('GetHexVersion', { hexId: projectId, version: 'draft' }),
                  graphQL('GetLogicSessionId', { hexId: projectId, version: 'draft' }),
              ]);
              const versionId = versionData.hexVersionByNumber?.id;
              if (!versionId)
                  throw ToolError.notFound(`Hex draft version not found for project: ${projectId}`);
              return {
                  project_id: projectId,
                  version_id: versionId,
                  logic_session_id: logicSessionData.hexVersionByNumber?.logicSessionId ?? versionData.hexVersionByNumber?.logicSessionId ?? '',
              };
          };
          const createHexProject = async (params) => {
              const data = await graphQL('CreateHex', {
                  getProjectCount: false,
                  isTour: false,
                  hexType: 'PROJECT',
                  name: params.title,
                  projectLanguage: params.projectLanguage ?? 'PYTHON',
                  description: params.description ?? '',
                  statusId: params.statusId ?? null,
                  categoryIds: params.categoryIds ?? [],
                  kernelImage: null,
                  kernelSize: null,
                  collectionId: params.collectionId ?? null,
                  collectionProjectRole: null,
              });
              const project = data.createHex;
              if (!project?.id)
                  throw ToolError.internal('Hex did not return a project ID after creation.');
              const draftVersion = await getDraftVersion(project.id);
              return {
                  id: project.id,
                  title: project.title ?? params.title,
                  org_id: project.org?.id ?? getOrgId(),
                  draft_version_id: draftVersion.version_id,
                  logic_session_id: draftVersion.logic_session_id,
                  app_url: buildProjectUrl(project.id, 'app'),
                  logic_url: buildProjectUrl(project.id, 'logic'),
              };
          };
          const doHexVersionAtomicOperation = async (hexVersionId, requests, extra) => {
              const data = await graphQL('doHexVersionAtomicOperation', {
                  requests,
                  hexVersionId,
                  skipSideEffects: false,
              }, { extra });
              return summarizeAtomicOperation(data.doHexVersionAtomicOperation ?? data.doHexVersionAtomicOperationV2);
          };
          const runAppSession = async (projectId, logicSessionId, priorityCellIds = [], forceOverwriteCache = false) => {
              if (!logicSessionId)
                  throw ToolError.notFound(`Hex logic session not found for project: ${projectId}`);
              const data = await graphQL('doAppSessionAtomicOperation', {
                  requests: [
                      {
                          mpClientId: crypto.randomUUID(),
                          operation: {
                              type: 'RUN_APP_SESSION',
                              payload: {
                                  forceOverwriteCache,
                                  executeTrace: false,
                                  priorityCellIds,
                              },
                          },
                          revisionOverride: null,
                      },
                  ],
                  appSessionId: logicSessionId,
                  skipSideEffects: false,
              }, { extra: 'RUN_APP_SESSION' });
              const summary = summarizeAtomicOperation(data.doAppSessionAtomicOperation ?? data.doAppSessionAtomicOperationV2);
              return {
                  project_id: projectId,
                  logic_session_id: logicSessionId,
                  started: true,
                  priority_cell_ids: priorityCellIds,
                  force_overwrite_cache: forceOverwriteCache,
                  last_run_start: summary.last_run_start,
                  response_count: summary.response_count,
                  response_types: summary.response_types,
              };
          };
          const runProject = async (projectId, priorityCellIds = [], forceOverwriteCache = false) => {
              const draftVersion = await getDraftVersion(projectId);
              return runAppSession(projectId, draftVersion.logic_session_id, priorityCellIds, forceOverwriteCache);
          };

          const userSchema = z.object({
              id: z.string().describe('User ID'),
              name: z.string().describe('Display name'),
              email: z.string().describe('Email address'),
              org_role: z.string().describe('Organization role for the current Hex organization'),
              platform_role: z.string().describe('Platform role for the current Hex account'),
              created_date: z.string().describe('ISO 8601 timestamp when the user account was created'),
              has_api_access: z.boolean().describe('Whether the user has Hex API access'),
          });
          const mapUser = (user) => ({
              id: user.id ?? '',
              name: user.name ?? '',
              email: user.email ?? '',
              org_role: user.orgRole ?? '',
              platform_role: user.platformRole ?? '',
              created_date: user.createdDate ?? '',
              has_api_access: user.hasApiAccess ?? false,
          });
          const organizationSchema = z.object({
              id: z.string().describe('Organization ID'),
              name: z.string().describe('Organization display name'),
              default_status_id: z.string().describe('Default project status ID for the organization'),
              allow_magic: z.boolean().describe('Whether Hex Magic features are enabled for the organization'),
          });
          const mapOrganization = (organization) => ({
              id: organization.id ?? '',
              name: organization.name ?? organization.displayName ?? '',
              default_status_id: organization.defaultStatusId ?? '',
              allow_magic: organization.allowMagic ?? false,
          });
          const currentContextSchema = z.object({
              origin: z.string().describe('Current Hex instance origin'),
              org_id: z.string().describe('Current organization ID from the URL path'),
              section: z.string().describe('Current Hex route section, such as home, app, or hex'),
              project_id: z
                  .string()
                  .describe('Project route identifier from the current URL, or empty when not on a project route'),
              url: z.string().describe('Current browser URL'),
              title: z.string().describe('Current browser page title'),
          });
          const pageInfoSchema = z.object({
              has_next_page: z.boolean().describe('Whether another page of results is available'),
              has_previous_page: z.boolean().describe('Whether a previous page of results is available'),
              start_cursor: z.string().nullable().describe('Cursor for the first result, or null when unavailable'),
              end_cursor: z.string().nullable().describe('Cursor for the last result, or null when unavailable'),
          });
          const mapPageInfo = (pageInfo = {}) => ({
              has_next_page: pageInfo.hasNextPage ?? false,
              has_previous_page: pageInfo.hasPreviousPage ?? false,
              start_cursor: pageInfo.startCursor ?? null,
              end_cursor: pageInfo.endCursor ?? null,
          });
          const statusSchema = z.object({
              id: z.string().describe('Status ID'),
              name: z.string().describe('Status name'),
              color: z.string().describe('Status color value'),
              description: z.string().describe('Status description'),
          });
          const mapStatus = (status) => ({
              id: status.id ?? '',
              name: status.name ?? '',
              color: status.color ?? '',
              description: status.description ?? '',
          });
          const categorySchema = z.object({
              id: z.string().describe('Category ID'),
              name: z.string().describe('Category name'),
              color: z.string().describe('Category color value'),
              description: z.string().describe('Category description'),
          });
          const mapCategory = (category) => ({
              id: category.id ?? '',
              name: category.name ?? '',
              color: category.color ?? '',
              description: category.description ?? '',
          });
          const projectPersonSchema = z.object({
              id: z.string().describe('User ID'),
              name: z.string().describe('User display name'),
              email: z.string().describe('User email address'),
          });
          const mapProjectPerson = (person = {}) => ({
              id: person.id ?? '',
              name: person.name ?? '',
              email: person.email ?? '',
          });
          const projectSchema = z.object({
              id: z.string().describe('Project ID'),
              title: z.string().describe('Project title'),
              description: z.string().describe('Plain text project description'),
              hex_type: z.string().describe('Hex project type'),
              project_language: z.string().describe('Primary project language'),
              effective_role: z.string().describe('Current user effective role for the project'),
              can_share: z.boolean().describe('Whether the current user can share the project'),
              can_view_logic: z.boolean().describe('Whether the current user can view the project logic'),
              can_use_app: z.boolean().describe('Whether the current user can use the app view'),
              starred_by_viewer: z.boolean().describe('Whether the current user has starred the project'),
              trashed: z.boolean().describe('Whether the project is in trash'),
              trash_date: z.string().describe('ISO 8601 timestamp when the project was trashed, or empty when not trashed'),
              user_updated_date: z.string().describe('ISO 8601 timestamp when the project was last updated'),
              last_viewed_by_me: z.string().describe('ISO 8601 timestamp when the current user last viewed the project'),
              date_created: z.string().describe('ISO 8601 timestamp when the project was created'),
              total_view_count: z.number().int().describe('Total view count reported by Hex'),
              status: statusSchema.describe('Project status'),
              categories: z.array(categorySchema).describe('Categories attached to the project'),
              owner: projectPersonSchema.describe('Project owner'),
              creator: projectPersonSchema.describe('Project creator'),
              app_url: z.string().describe('URL for the project app route'),
              logic_url: z.string().describe('URL for the project logic route'),
          });
          const authoredProjectSchema = z.object({
              id: z.string().describe('Hex project ID'),
              title: z.string().describe('Project title'),
              org_id: z.string().describe('Organization ID that owns the project'),
              draft_version_id: z.string().describe('Draft Hex version ID used for authoring operations'),
              logic_session_id: z.string().describe('Logic session ID used to run project cells'),
              app_url: z.string().describe('URL for the project app route'),
              logic_url: z.string().describe('URL for the project logic route'),
          });
          const textFromDescription = (value) => {
              if (typeof value === 'string')
                  return value;
              if (Array.isArray(value))
                  return value.map(textFromDescription).filter(Boolean).join('\n');
              if (!value || typeof value !== 'object')
                  return '';
              const record = value;
              const ownText = typeof record.text === 'string' ? record.text : '';
              const childText = Array.isArray(record.children) ? record.children.map(textFromDescription).join('') : '';
              return ownText || childText;
          };
          const mapProject = (project) => ({
              id: project.id ?? '',
              title: project.title ?? '',
              description: textFromDescription(project.description),
              hex_type: project.hexType ?? '',
              project_language: project.projectLanguage ?? '',
              effective_role: project.effectiveRole ?? '',
              can_share: project.canShare ?? false,
              can_view_logic: project.canViewLogic ?? false,
              can_use_app: project.canUseApp ?? false,
              starred_by_viewer: project.starredByViewer ?? false,
              trashed: project.trashDate !== null && project.trashDate !== undefined,
              trash_date: project.trashDate ?? '',
              user_updated_date: project.userUpdatedDate ?? '',
              last_viewed_by_me: project.lastViewedByMe ?? '',
              date_created: project.dateCreated ?? '',
              total_view_count: project.projectAnalytics?.totalViewCount ?? project.lastPublishedVersion?.totalViewCount ?? 0,
              status: mapStatus(project.status ?? {}),
              categories: (project.categories ?? []).map(mapCategory),
              owner: mapProjectPerson(project.owner ?? {}),
              creator: mapProjectPerson(project.creator ?? {}),
              app_url: project.id ? buildProjectUrl(project.id, 'app') : '',
              logic_url: project.id ? buildProjectUrl(project.id, 'logic') : '',
          });
          const collectionSchema = z.object({
              id: z.string().describe('Collection ID'),
              name: z.string().describe('Collection name'),
              description: z.string().describe('Collection description'),
              project_count: z.number().int().describe('Number of projects in the collection when reported by Hex'),
              starred_by_viewer: z.boolean().describe('Whether the current user has starred the collection'),
          });
          const mapCollection = (collection) => ({
              id: collection.id ?? '',
              name: collection.name ?? collection.title ?? '',
              description: collection.description ?? '',
              project_count: collection.hexCount ?? collection.projectCount ?? 0,
              starred_by_viewer: collection.starredByViewer ?? false,
          });
          const dataConnectionSchema = z.object({
              id: z.string().describe('Data connection ID'),
              name: z.string().describe('Data connection name when reported by Hex'),
              type: z.string().describe('Data connection type'),
              description: z.string().describe('Data connection description'),
              is_multi_database: z.boolean().describe('Whether this connection supports multiple databases'),
          });
          const mapDataConnection = (connection) => ({
              id: connection.id ?? '',
              name: connection.name ?? connection.displayName ?? '',
              type: connection.connectionType ?? connection.type ?? '',
              description: connection.description ?? '',
              is_multi_database: connection.isMultiDatabase ?? false,
          });
          const threadSchema = z.object({
              id: z.string().describe('Thread ID'),
              title: z.string().describe('Thread title'),
              thread_type: z.string().describe('Thread type'),
              created_date: z.string().describe('ISO 8601 timestamp when the thread was created'),
              updated_date: z.string().describe('ISO 8601 timestamp when the thread was last updated'),
          });
          const mapThread = (thread) => ({
              id: thread.id ?? '',
              title: thread.title ?? thread.name ?? '',
              thread_type: thread.threadType ?? '',
              created_date: thread.createdDate ?? '',
              updated_date: thread.updatedDate ?? '',
          });
          const exploreSchema = z.object({
              id: z.string().describe('Explore ID'),
              title: z.string().describe('Explore title'),
              description: z.string().describe('Explore description'),
              created_date: z.string().describe('ISO 8601 timestamp when the explore was created'),
              updated_date: z.string().describe('ISO 8601 timestamp when the explore was last updated'),
              creator: projectPersonSchema.describe('Explore creator'),
          });
          const mapExplore = (explore) => ({
              id: explore.id ?? '',
              title: explore.title ?? explore.name ?? '',
              description: explore.description ?? '',
              created_date: explore.createdDate ?? '',
              updated_date: explore.updatedDate ?? '',
              creator: mapProjectPerson(explore.creator ?? {}),
          });
          const productVersionSchema = z.object({
              id: z.string().describe('Product version ID'),
              app_version: z.string().describe('Hex app version'),
              client_version: z.string().describe('Hex client version'),
              kernel_version: z.string().describe('Hex kernel version'),
              sidecar_version: z.string().describe('Hex sidecar version'),
          });
          const mapProductVersion = (version) => ({
              id: version.id ?? '',
              app_version: version.appVersion ?? '',
              client_version: version.clientVersion ?? '',
              kernel_version: version.kernelVersion ?? '',
              sidecar_version: version.sidecarVersion ?? '',
          });
          const projectCellSchema = z.object({
              id: z.string().describe('Cell ID'),
              static_id: z.string().describe('Stable cell ID used across versions'),
              contents_id: z.string().describe('Cell contents ID used by update operations, or empty when unavailable'),
              input_cell_id: z.string().describe('Hex input-cell contents ID for Parameter cells, or empty when unavailable'),
              order: z.string().describe('Cell ordering value reported by Hex'),
              label: z.string().describe('Cell label, or empty when the cell has no label'),
              cell_type: z.string().describe('Hex cell type, such as SQL, MARKDOWN, CODE, or CHART'),
              contents_type: z.string().describe('GraphQL cell contents typename, such as SqlCell or MarkdownCell'),
              result_variable: z
                  .string()
                  .describe('Output dataframe name for cells that produce one, or input variable name for Parameter cells'),
              connection_id: z.string().describe('Data connection ID used by SQL cells, or empty when not applicable'),
              input_type: z.string().describe('Hex input type for Parameter cells, such as DATE or TEXT_INPUT'),
              output_type: z.string().describe('Hex output data type for Parameter cells, such as DATETIME or STRING'),
              default_value_string: z.string().describe('Default value string stored by Hex for Parameter cells'),
              source: z.string().describe('Cell source text when requested and available'),
              deleted: z.boolean().describe('Whether the cell is marked deleted'),
          });
          const createdCellSchema = z.object({
              id: z.string().describe('Cell ID'),
              static_id: z.string().describe('Stable cell ID used across versions'),
              contents_id: z.string().describe('Cell contents ID used by update operations'),
              story_element_id: z.string().describe('Story element ID Hex created for the cell'),
              order: z.string().describe('Cell ordering value sent to Hex'),
              cell_type: z.string().describe('Hex cell type, such as SQL or TEXT'),
              result_variable: z.string().describe('Output variable/dataframe name for SQL cells, or empty when not applicable'),
              connection_id: z.string().describe('Data connection ID used by SQL cells, or empty when not applicable'),
              source: z.string().describe('Cell source text'),
          });
          const atomicOperationSchema = z.object({
              response_count: z.number().int().describe('Number of atomic operation responses returned by Hex'),
              response_types: z.array(z.string()).describe('Response type names returned by Hex for the atomic operation'),
              revision: z.number().int().nullable().describe('Revision returned by Hex, or null when not returned'),
              last_run_start: z.string().describe('Run start timestamp reported by Hex, or empty when not applicable'),
          });
          const dashboardGridRowSchema = z.object({
              id: z.string().describe('Hex app grid row ID created for the dashboard layout'),
              grid_layout_id: z.string().describe('Hex app grid layout ID containing this row'),
              grid_column_id: z.string().describe('Hex app grid column ID created for this row'),
              grid_element_id: z.string().describe('Hex app grid element ID created for the cell placement'),
              cell_id: z.string().describe('Hex cell ID placed into this grid row'),
              start: z.number().int().describe('Starting grid column, inclusive, on Hex 0-120 grid coordinates'),
              end: z.number().int().describe('Ending grid column, exclusive, on Hex 0-120 grid coordinates'),
              show_label: z.boolean().describe('Whether Hex should show the cell label in the app row'),
              hide_output: z.boolean().describe('Whether Hex should hide the cell output in the app row'),
              show_source: z.boolean().describe('Whether Hex should show source code in the app row'),
          });
          const runResultSchema = z.object({
              project_id: z.string().describe('Hex project ID that was run'),
              logic_session_id: z.string().describe('Logic session ID used to trigger the run'),
              started: z.boolean().describe('Whether Hex accepted the run request'),
              priority_cell_ids: z.array(z.string()).describe('Cell IDs prioritized for the run'),
              force_overwrite_cache: z.boolean().describe('Whether Hex was asked to overwrite cached results'),
              last_run_start: z.string().describe('Run start timestamp reported by Hex, or empty when not returned'),
              response_count: z.number().int().describe('Number of atomic operation responses returned by Hex'),
              response_types: z.array(z.string()).describe('Response type names returned by Hex for the run operation'),
          });
          const cellResultValueSchema = z
              .union([z.string(), z.number(), z.boolean(), z.null()])
              .describe('Cell result value as returned by Hex display-table output');
          const cellResultOutputContentSchema = z.object({
              id: z.string().describe('Output content ID'),
              mime_type: z.string().describe('Hex output content MIME type'),
              status: z.string().describe('Output content loading status, such as READY'),
          });
          const cellResultOutputSchema = z.object({
              id: z.string().describe('Hex output ID'),
              output_type: z.string().describe('Hex output type, such as EXECUTE_RESULT, ERROR, or METADATA'),
              order: z.number().int().describe('Output order within the cell'),
              contents: z.array(cellResultOutputContentSchema).describe('Output content records attached to this output'),
          });
          const cellResultDataFrameSchema = z.object({
              columns: z.record(z.string(), z.string()).describe('Dataframe schema columns keyed by column name'),
              row_count: z.number().int().describe('Dataframe row count reported by Hex scope metadata'),
              row_count_is_truncated: z.boolean().describe('Whether Hex reported the dataframe schema row count as truncated'),
          });
          const cellResultColumnSchema = z.object({
              id: z.string().describe('Hex display-table column ID'),
              name: z.string().describe('Display-table column name'),
              type: z.string().describe('Display-table column type reported by Hex'),
          });
          const cellResultSqlStatusSchema = z.object({
              loaded_rows: z.number().int().describe('Number of rows loaded by the SQL query'),
              finished: z.boolean().describe('Whether Hex reported the SQL query stream as finished'),
              elapsed_time_ms: z.number().describe('Elapsed SQL status time in milliseconds when reported by Hex'),
          });
          const cellResultSchema = z.object({
              project_id: z.string().describe('Hex project ID'),
              logic_session_id: z.string().describe('Logic session ID whose runtime state was read'),
              app_session_state: z.string().describe('Overall Hex app-session state, such as IDLE, RUNNING, or ERRORED'),
              app_session_last_run_start: z.string().describe('ISO 8601 timestamp for the last app-session run start'),
              app_session_last_run_end: z.string().describe('ISO 8601 timestamp for the last app-session run end'),
              cell_id: z.string().describe('Hex cell ID'),
              app_session_cell_id: z.string().describe('Runtime app-session cell ID corresponding to the Hex cell ID'),
              cell_state: z.string().describe('Terminal or current cell execution state, such as IDLE, RUNNING, or ERRORED'),
              last_execution_start: z.string().describe('ISO 8601 timestamp when this cell last started executing'),
              last_execution_end: z.string().describe('ISO 8601 timestamp when this cell last finished executing'),
              result_variable: z.string().describe('Output dataframe variable name for this cell, or empty when unavailable'),
              dataframe_schema: cellResultDataFrameSchema
                  .nullable()
                  .describe('Dataframe schema from Hex runtime scope, or null when the cell did not produce a dataframe'),
              columns: z.array(cellResultColumnSchema).describe('Display-table columns parsed from Hex output content'),
              rows: z
                  .array(z.record(z.string(), cellResultValueSchema))
                  .describe('Rows parsed from Hex display-table output, limited by row_limit'),
              row_count: z.number().int().describe('Total display-table row count reported by Hex'),
              returned_row_count: z.number().int().describe('Number of rows returned by this tool'),
              truncated: z.boolean().describe('Whether rows were truncated by this tool row_limit'),
              sql_status: cellResultSqlStatusSchema
                  .nullable()
                  .describe('SQL stream status output when Hex produced one, otherwise null'),
              errors: z.array(z.string()).describe('Execution error messages parsed from Hex error outputs'),
              outputs: z.array(cellResultOutputSchema).describe('Output records attached to the cell'),
          });
          const mapProjectCell = (cell, includeSource) => ({
              id: cell.id ?? '',
              static_id: cell.staticId ?? '',
              contents_id: cell.cellContents?.id ??
                  cell.cellContents?.sqlCellId ??
                  cell.cellContents?.textCellId ??
                  cell.cellContents?.inputCellId ??
                  '',
              input_cell_id: cell.cellContents?.inputCellId ?? '',
              order: cell.order === undefined ? '' : String(cell.order),
              label: cell.label ?? '',
              cell_type: cell.cellType ?? '',
              contents_type: cell.cellContents?.__typename ?? '',
              result_variable: cell.cellContents?.resultVariable ?? cell.cellContents?.name ?? '',
              connection_id: cell.cellContents?.connectionId ?? '',
              input_type: cell.cellContents?.inputType ?? '',
              output_type: cell.cellContents?.outputType ?? '',
              default_value_string: cell.cellContents?.defaultValueString ?? '',
              source: includeSource ? (cell.cellContents?.source ?? textFromDescription(cell.cellContents?.richText)) : '',
              deleted: cell.deletedDate !== null && cell.deletedDate !== undefined,
          });
          const projectVersionSchema = z.object({
              id: z.string().describe('Hex version ID'),
              version: z.string().describe('Hex version string requested, such as draft'),
              display_name: z.string().describe('Version display name'),
              published: z.boolean().describe('Whether this Hex version is published'),
              logic_session_id: z.string().describe('Logic session ID for this version when reported by Hex'),
          });
          const mapProjectVersion = (version, requestedVersion) => ({
              id: version.id ?? '',
              version: version.version ?? requestedVersion,
              display_name: version.displayName ?? version.name ?? '',
              published: version.published ?? false,
              logic_session_id: version.logicSessionId ?? '',
          });
          const mapConnectionNodes = (connection) => (connection?.edges ?? []).flatMap(edge => (edge?.node ? [edge.node] : []));

          const newId = () => {
              if (!crypto.randomUUID)
                  throw ToolError.internal('Hex authoring requires browser crypto.randomUUID support.');
              return crypto.randomUUID();
          };
          const buildCellOrder = (orderIndex) => `O${String(orderIndex).padStart(9, '0')}`;
          const normalizeConnectionId = (connectionId) => {
              const trimmed = connectionId?.trim();
              return trimmed ? trimmed : null;
          };
          const buildAtomicRequest = (operationType, payload) => ({
              mpClientId: newId(),
              operation: {
                  type: operationType,
                  payload,
              },
          });
          const buildStoryElement = (storyElementId, now, visibleInApp) => ({
              id: storyElementId,
              createdDate: now,
              updatedDate: now,
              revision: 0,
              visible: visibleInApp,
              showLabel: true,
          });
          const buildTextRichText = (text) => text.split(/\r?\n/).map(line => ({
              type: 'paragraph',
              children: [{ text: line }],
          }));
          const getLoadedLayoutBundle = (versionId) => {
              const store = getPageGlobal('__APP_SESSION_AO_CONTROLLER__.dataStore');
              const state = store?.getState?.();
              const bundle = state?.hexVersionMP?.[versionId];
              if (!bundle) {
                  throw ToolError.validation('Hex app layout state for this draft is not loaded. Open the project app/logic editor tab and try again.');
              }
              return bundle;
          };
          const isActiveLayout = (layout) => Boolean(layout?.id) && layout?.deletedDate == null;
          const isActiveGridRow = (row, gridLayoutId) => Boolean(row?.id) && row?.gridLayoutId === gridLayoutId && row?.deletedDate == null;
          const resolveGridLayoutId = (versionId, gridLayoutId) => {
              const explicitGridLayoutId = gridLayoutId?.trim();
              if (explicitGridLayoutId)
                  return explicitGridLayoutId;
              const bundle = getLoadedLayoutBundle(versionId);
              const gridLayouts = Object.values(bundle.gridLayouts?.entities ?? {}).filter(isActiveLayout);
              const resolvedGridLayoutId = gridLayouts[0]?.id;
              if (!resolvedGridLayoutId) {
                  throw ToolError.notFound('Hex did not expose an active app grid layout for this draft.');
              }
              return resolvedGridLayoutId;
          };
          const readActiveGridRows = (versionId, gridLayoutId) => {
              const bundle = getLoadedLayoutBundle(versionId);
              return Object.values(bundle.gridRows?.entities ?? {}).filter(row => isActiveGridRow(row, gridLayoutId));
          };
          const normalizeGridRowInput = (row) => {
              const start = row.start ?? 0;
              const end = row.end ?? 120;
              if (start < 0 || start > 119)
                  throw ToolError.validation(`Grid row start is out of range: ${start}`);
              if (end < 1 || end > 120)
                  throw ToolError.validation(`Grid row end is out of range: ${end}`);
              if (start >= end)
                  throw ToolError.validation(`Grid row start must be less than end: ${start} >= ${end}`);
              return {
                  cellId: row.cellId,
                  start,
                  end,
                  showLabel: row.showLabel ?? true,
                  hideOutput: row.hideOutput ?? false,
                  showSource: row.showSource ?? false,
              };
          };
          const buildGridRowRequest = (row, gridLayoutId) => {
              const normalizedRow = normalizeGridRowInput(row);
              return {
                  id: newId(),
                  grid_layout_id: gridLayoutId,
                  grid_column_id: newId(),
                  grid_element_id: newId(),
                  cell_id: normalizedRow.cellId,
                  start: normalizedRow.start,
                  end: normalizedRow.end,
                  show_label: normalizedRow.showLabel,
                  hide_output: normalizedRow.hideOutput,
                  show_source: normalizedRow.showSource,
              };
          };
          const readDraftCells = async (projectId) => {
              const data = await graphQL('HexVersionMPModel', {
                  hexId: projectId,
                  version: 'draft',
                  hexAlreadyLoaded: false,
                  canViewCategoriesOrStatuses: true,
              });
              return data.hexVersionByNumber?.cells ?? [];
          };
          const createTextCellInProject = async (params) => {
              const draftVersion = await getDraftVersion(params.projectId);
              const cellId = newId();
              const staticCellId = newId();
              const contentsId = newId();
              const storyElementId = newId();
              const now = new Date().toISOString();
              const order = buildCellOrder(params.orderIndex ?? 1);
              const operation = await doHexVersionAtomicOperation(draftVersion.version_id, [
                  buildAtomicRequest('CREATE_CELL', {
                      cellId,
                      staticCellId,
                      insertAt: order,
                      contents: {
                          type: 'TEXT',
                          id: contentsId,
                          createdDate: now,
                          updatedDate: now,
                          revision: 0,
                          richText: buildTextRichText(params.text),
                          cellReferencesV2: null,
                          cellReferencesParseError: null,
                      },
                      storyElement: buildStoryElement(storyElementId, now, params.visibleInApp ?? true),
                      componentImportCellId: null,
                      blockCellId: null,
                      origin: 'ADD_CELL_BAR',
                  }),
              ], 'CREATE_CELL');
              return {
                  project_id: params.projectId,
                  version_id: draftVersion.version_id,
                  cell: {
                      id: cellId,
                      static_id: staticCellId,
                      contents_id: contentsId,
                      story_element_id: storyElementId,
                      order,
                      cell_type: 'TEXT',
                      result_variable: '',
                      connection_id: '',
                      source: params.text,
                  },
                  operation,
              };
          };
          const defaultInputOptions = (inputType, options) => {
              if (options)
                  return options;
              if (inputType === 'DATE') {
                  return {
                      enableTime: false,
                      showRelativeDates: true,
                      useDateRange: false,
                  };
              }
              return {};
          };
          const defaultInputOutputType = (inputType) => {
              switch (inputType) {
                  case 'TEXT_INPUT':
                  case 'DROPDOWN':
                      return 'STRING';
                  case 'NUMERIC_INPUT':
                  case 'SLIDER':
                      return 'NUMBER';
                  case 'TABLE':
                  case 'FILE_UPLOAD':
                      return 'DATA_FRAME';
                  case 'DATE':
                      return 'DATETIME';
                  case 'BUTTON':
                  case 'CHECKBOX':
                      return 'BOOLEAN';
                  case 'MULTISELECT':
                      return 'LIST_STRING';
              }
          };
          const createInputCellInProject = async (params) => {
              const draftVersion = await getDraftVersion(params.projectId);
              const cellId = newId();
              const staticCellId = newId();
              const contentsId = newId();
              const storyElementId = newId();
              const now = new Date().toISOString();
              const order = buildCellOrder(params.orderIndex ?? 1);
              const inputType = params.inputType ?? 'TEXT_INPUT';
              const outputType = params.outputType ?? defaultInputOutputType(inputType);
              const name = params.name.trim();
              if (!name)
                  throw ToolError.validation('Hex input cell name cannot be empty.');
              const operation = await doHexVersionAtomicOperation(draftVersion.version_id, [
                  buildAtomicRequest('CREATE_CELL', {
                      cellId,
                      staticCellId,
                      insertAt: order,
                      contents: {
                          type: 'INPUT',
                          id: contentsId,
                          createdDate: now,
                          updatedDate: now,
                          revision: 0,
                          name,
                          inputType,
                          outputType,
                          defaultValueString: params.defaultValueString,
                          required: params.required ?? false,
                          options: defaultInputOptions(inputType, params.options),
                      },
                      storyElement: buildStoryElement(storyElementId, now, params.visibleInApp ?? true),
                      componentImportCellId: null,
                      blockCellId: null,
                      origin: 'ADD_CELL_BAR',
                  }),
              ], 'CREATE_CELL');
              return {
                  project_id: params.projectId,
                  version_id: draftVersion.version_id,
                  cell: {
                      id: cellId,
                      static_id: staticCellId,
                      contents_id: contentsId,
                      story_element_id: storyElementId,
                      order,
                      cell_type: 'INPUT',
                      result_variable: name,
                      connection_id: '',
                      source: params.defaultValueString ?? '',
                  },
                  operation,
              };
          };
          const upsertDashboardLayoutInProject = async (params) => {
              const draftVersion = await getDraftVersion(params.projectId);
              const gridLayoutId = resolveGridLayoutId(draftVersion.version_id, params.gridLayoutId);
              const operations = [];
              const deletedGridRowIds = new Set();
              for (const gridRowId of params.deleteGridRowIds ?? []) {
                  const trimmedGridRowId = gridRowId.trim();
                  if (trimmedGridRowId)
                      deletedGridRowIds.add(trimmedGridRowId);
              }
              if (params.replaceExisting) {
                  for (const row of readActiveGridRows(draftVersion.version_id, gridLayoutId)) {
                      if (row.id)
                          deletedGridRowIds.add(row.id);
                  }
              }
              const deleteRequests = Array.from(deletedGridRowIds).map(gridRowId => buildAtomicRequest('DELETE_GRID_ROW', { gridRowId }));
              if (deleteRequests.length > 0) {
                  operations.push(await doHexVersionAtomicOperation(draftVersion.version_id, deleteRequests, 'DELETE_GRID_ROW'));
              }
              const createdGridRows = [];
              for (let index = 0; index < params.rows.length; index += 1) {
                  const row = params.rows[index];
                  if (!row)
                      continue;
                  const gridRow = buildGridRowRequest(row, gridLayoutId);
                  createdGridRows.push(gridRow);
                  operations.push(await doHexVersionAtomicOperation(draftVersion.version_id, [
                      buildAtomicRequest('CREATE_GRID_ROW', {
                          gridLayoutId,
                          gridRowId: gridRow.id,
                          insertAt: buildCellOrder(index + 1),
                          gridColumns: [
                              {
                                  id: gridRow.grid_column_id,
                                  start: gridRow.start,
                                  end: gridRow.end,
                                  gridElements: [
                                      {
                                          id: gridRow.grid_element_id,
                                          entityId: gridRow.cell_id,
                                          type: 'CELL',
                                          hideOutput: gridRow.hide_output,
                                          showLabel: gridRow.show_label,
                                          showSource: gridRow.show_source,
                                      },
                                  ],
                              },
                          ],
                      }),
                  ], 'CREATE_GRID_ROW'));
              }
              return {
                  project_id: params.projectId,
                  version_id: draftVersion.version_id,
                  grid_layout_id: gridLayoutId,
                  deleted_grid_row_ids: Array.from(deletedGridRowIds),
                  created_grid_rows: createdGridRows,
                  operations,
              };
          };
          const createSqlCellInProject = async (params) => {
              const draftVersion = await getDraftVersion(params.projectId);
              const cellId = newId();
              const staticCellId = newId();
              const contentsId = newId();
              const storyElementId = newId();
              const now = new Date().toISOString();
              const order = buildCellOrder(params.orderIndex ?? 1);
              const connectionId = normalizeConnectionId(params.connectionId);
              const resultVariable = params.resultVariable?.trim() || 'dataframe';
              await doHexVersionAtomicOperation(draftVersion.version_id, [
                  buildAtomicRequest('CREATE_CELL', {
                      cellId,
                      staticCellId,
                      insertAt: order,
                      contents: {
                          type: 'SQL',
                          id: contentsId,
                          createdDate: now,
                          updatedDate: now,
                          revision: 0,
                          source: '',
                          resultVariable,
                          castDecimals: true,
                          useNativeDates: true,
                          useRichDisplay: false,
                          enablePreview: true,
                          connectionId,
                          dataFrameCell: false,
                          sqlDisplayTableConfig: null,
                          loadIntoDataFrame: true,
                          cellReferencesV2: null,
                          cellReferencesParseError: null,
                          sqlCellReferencesV3: null,
                          jinjaCellReferencesV3: null,
                          jinjaSqlReferences: null,
                          sqlCellOutputType: 'PANDAS',
                          allowDuplicateColumns: false,
                      },
                      storyElement: buildStoryElement(storyElementId, now, params.visibleInApp ?? true),
                      componentImportCellId: null,
                      blockCellId: null,
                      origin: 'ADD_CELL_BAR',
                  }),
              ], 'CREATE_CELL');
              const operation = await doHexVersionAtomicOperation(draftVersion.version_id, [
                  buildAtomicRequest('UPDATE_SQL_CELL', {
                      sqlCellId: contentsId,
                      cellId,
                      key: 'source',
                      value: params.source,
                  }),
              ], 'UPDATE_SQL_CELL');
              return {
                  project_id: params.projectId,
                  version_id: draftVersion.version_id,
                  cell: {
                      id: cellId,
                      static_id: staticCellId,
                      contents_id: contentsId,
                      story_element_id: storyElementId,
                      order,
                      cell_type: 'SQL',
                      result_variable: resultVariable,
                      connection_id: connectionId ?? '',
                      source: params.source,
                  },
                  operation,
              };
          };

          const storeFromPage = () => {
              const store = getPageGlobal('__APP_SESSION_AO_CONTROLLER__.dataStore');
              if (!store || typeof store !== 'object') {
                  throw ToolError.validation('Hex app session runtime is not loaded. Open the project notebook tab and try again.');
              }
              return store;
          };
          const getRuntimeState = () => {
              const state = storeFromPage().getState?.();
              if (!state)
                  throw ToolError.validation('Hex app session state is not available in the current tab.');
              return state;
          };
          const parseMaybeJson = (value) => {
              let parsed = value;
              for (let index = 0; index < 3; index += 1) {
                  if (typeof parsed !== 'string')
                      return parsed;
                  const trimmed = parsed.trim();
                  if (!trimmed)
                      return '';
                  try {
                      parsed = JSON.parse(trimmed);
                  }
                  catch {
                      return parsed;
                  }
              }
              return parsed;
          };
          const parseContent = (content) => typeof content?.contents === 'string' ? parseMaybeJson(content.contents) : null;
          const ansiEscapePattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
          const stripAnsi = (value) => value.replace(ansiEscapePattern, '');
          const summarizeErrorText = (value) => stripAnsi(value)
              .split(/\r?\n/)
              .map(line => line.trim())
              .filter(line => line && !line.startsWith('traceId:'))
              .slice(0, 4)
              .join(' | ');
          const normalizeError = (value, depth = 0) => {
              if (typeof value === 'string') {
                  const parsed = parseMaybeJson(value);
                  if (parsed !== value && depth < 3)
                      return normalizeError(parsed, depth + 1);
                  return summarizeErrorText(value);
              }
              if (Array.isArray(value)) {
                  return value
                      .map(item => normalizeError(item, depth + 1))
                      .filter(Boolean)
                      .join('; ');
              }
              if (!value || typeof value !== 'object')
                  return '';
              const record = value;
              const traceback = record.traceback ? summarizeErrorText(record.traceback) : '';
              if (record.errorType && traceback)
                  return `${record.errorType}: ${traceback}`;
              if (traceback)
                  return traceback;
              if (record.errorType)
                  return record.errorType;
              return '';
          };
          const coerceJsonValue = (value) => {
              if (value === null || ['string', 'number', 'boolean'].includes(typeof value))
                  return value;
              return JSON.stringify(value);
          };
          const resolveColumnName = (column) => column.columnNameOverride ?? column.columnNameDefault ?? column.columnName?.join('.') ?? column.columnId ?? '';
          const rowsFromDisplayTable = (displayTable, rowLimit) => {
              if (!displayTable?.columns?.length) {
                  return { columns: [], rows: [], row_count: displayTable?.rowCount ?? 0, truncated: false };
              }
              const rowCount = displayTable.rowCount ?? Math.max(...displayTable.columns.map(column => column.columnData?.length ?? 0), 0);
              const returnedRowCount = Math.min(rowLimit, rowCount);
              const rows = Array.from({ length: returnedRowCount }, (_, rowIndex) => {
                  const row = {};
                  for (const column of displayTable.columns ?? []) {
                      const name = resolveColumnName(column);
                      if (!name)
                          continue;
                      row[name] = coerceJsonValue(column.columnData?.[rowIndex] ?? null);
                  }
                  return row;
              });
              return {
                  columns: displayTable.columns.map(column => ({
                      id: column.columnId ?? '',
                      name: resolveColumnName(column),
                      type: column.columnType ?? '',
                  })),
                  rows,
                  row_count: rowCount,
                  truncated: rowCount > returnedRowCount,
              };
          };
          const findOutputContent = (outputContent, contentRef) => outputContent?.outputContents?.[contentRef.id ?? ''];
          const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
          const findDisplayTable = (outputs, outputContent) => {
              for (const output of outputs) {
                  for (const contentRef of output.frontendOutputContents ?? []) {
                      if (contentRef.mimeType !== 'application/vnd.hex.displaytable+json')
                          continue;
                      const parsed = parseContent(findOutputContent(outputContent, contentRef));
                      if (isRecord(parsed))
                          return parsed;
                  }
              }
              return null;
          };
          const findSqlStatus = (outputs, outputContent) => {
              for (const output of outputs) {
                  for (const contentRef of output.frontendOutputContents ?? []) {
                      if (contentRef.mimeType !== 'application/vnd.hex.sqlstatus+json')
                          continue;
                      const parsed = parseContent(findOutputContent(outputContent, contentRef));
                      if (!isRecord(parsed))
                          continue;
                      const status = parsed;
                      return {
                          loaded_rows: status.loadedRows ?? 0,
                          finished: status.finished ?? false,
                          elapsed_time_ms: status.elapsedTime ?? 0,
                      };
                  }
              }
              return null;
          };
          const collectErrors = (outputs, outputContent) => {
              const errors = [];
              for (const output of outputs) {
                  if (output.outputType !== 'ERROR')
                      continue;
                  for (const contentRef of output.frontendOutputContents ?? []) {
                      const message = normalizeError(parseContent(findOutputContent(outputContent, contentRef)));
                      if (message)
                          errors.push(message);
                  }
              }
              return Array.from(new Set(errors));
          };
          const summarizeOutputs = (outputs, outputContent) => outputs.map(output => ({
              id: output.id ?? '',
              output_type: output.outputType ?? '',
              order: output.order ?? 0,
              contents: (output.frontendOutputContents ?? []).map(contentRef => ({
                  id: contentRef.id ?? '',
                  mime_type: contentRef.mimeType ?? '',
                  status: findOutputContent(outputContent, contentRef)?.status ?? '',
              })),
          }));
          const resolveResultVariable = (state, cellId, explicitResultVariable) => {
              if (explicitResultVariable)
                  return explicitResultVariable;
              for (const version of Object.values(state.hexVersionMP ?? {})) {
                  const resultVariable = version?.cellContents?.entities?.[cellId]?.resultVariable;
                  if (resultVariable)
                      return resultVariable;
              }
              return '';
          };
          const resolveCellId = (state, session, resultVariable) => {
              if (!resultVariable)
                  return '';
              for (const version of Object.values(state.hexVersionMP ?? {})) {
                  for (const [cellId, contents] of Object.entries(version?.cellContents?.entities ?? {})) {
                      if (contents?.resultVariable === resultVariable && session.cellIdToAppSessionCellId?.[cellId])
                          return cellId;
                  }
              }
              return '';
          };
          const readRuntimeCellResult = async (options) => {
              const draftVersion = await getDraftVersion(options.projectId);
              const state = getRuntimeState();
              const session = state.appSessionMP?.[draftVersion.logic_session_id];
              if (!session) {
                  throw ToolError.validation('Hex app session state for this project is not loaded in the current tab.');
              }
              const requestedResultVariable = options.resultVariable?.trim() ?? '';
              const cellId = options.cellId?.trim() || resolveCellId(state, session, requestedResultVariable);
              if (!cellId)
                  throw ToolError.validation('Provide a Hex cell ID. Result-variable lookup requires a loaded cell mapping.');
              const appSessionCellId = session.cellIdToAppSessionCellId?.[cellId] ?? '';
              if (!appSessionCellId)
                  throw ToolError.notFound(`Hex app session cell not found for cell: ${cellId}`);
              const appSessionCell = session.appSessionCells?.entities?.[appSessionCellId];
              const outputIds = session.appSessionCellIdToOutputIds?.[appSessionCellId] ?? [];
              const outputs = outputIds.flatMap(outputId => {
                  const output = session.outputs?.entities?.[outputId];
                  return output ? [output] : [];
              });
              const outputContent = state.outputContent?.[draftVersion.logic_session_id];
              const displayTable = findDisplayTable(outputs, outputContent);
              const table = rowsFromDisplayTable(displayTable, options.rowLimit ?? 50);
              const resultVariable = resolveResultVariable(state, cellId, requestedResultVariable);
              const scopeItem = resultVariable ? session.scope?.entities?.[resultVariable] : undefined;
              return {
                  project_id: options.projectId,
                  logic_session_id: draftVersion.logic_session_id,
                  app_session_state: session.appSession?.state ?? '',
                  app_session_last_run_start: session.appSession?.lastRunStart ?? '',
                  app_session_last_run_end: session.appSession?.lastRunEnd ?? '',
                  cell_id: cellId,
                  app_session_cell_id: appSessionCellId,
                  cell_state: appSessionCell?.state ?? '',
                  last_execution_start: appSessionCell?.lastExecutionStartTime ?? '',
                  last_execution_end: appSessionCell?.lastExecutionEndTime ?? '',
                  result_variable: resultVariable,
                  dataframe_schema: scopeItem?.dataFrameSchema
                      ? {
                          columns: scopeItem.dataFrameSchema.columns ?? {},
                          row_count: scopeItem.dataFrameSchema.rowCount ?? 0,
                          row_count_is_truncated: scopeItem.dataFrameSchema.rowCountIsTruncated ?? false,
                      }
                      : null,
                  columns: table.columns,
                  rows: table.rows,
                  row_count: table.row_count,
                  returned_row_count: table.rows.length,
                  truncated: table.truncated,
                  sql_status: findSqlStatus(outputs, outputContent),
                  errors: collectErrors(outputs, outputContent),
                  outputs: summarizeOutputs(outputs, outputContent),
              };
          };
          const isTerminalCellState = (state) => !['', 'QUEUED', 'RUNNING', 'PENDING'].includes(state);
          const waitForRuntimeCellResult = async (options) => {
              const minStartMs = options.minExecutionStart ? Date.parse(options.minExecutionStart) : 0;
              await waitUntil(async () => {
                  try {
                      const result = await readRuntimeCellResult(options);
                      const executionStartMs = result.last_execution_start ? Date.parse(result.last_execution_start) : 0;
                      return isTerminalCellState(result.cell_state) && (!minStartMs || executionStartMs >= minStartMs);
                  }
                  catch {
                      return false;
                  }
              }, { interval: 500, timeout: options.timeoutMs ?? 30_000 });
              return readRuntimeCellResult(options);
          };

          const queryProjects = async (params = {}) => {
              const data = await graphQL('GetSafeOrUnknownHexesForHome', {
                  orgId: getOrgId(),
                  ownershipLevel: params.ownershipLevel ?? 'ALL',
                  onlyPublished: params.onlyPublished ?? false,
                  after: params.after ?? null,
                  before: null,
                  first: params.limit ?? 20,
                  last: null,
                  trashed: false,
                  includeCreatorImgUrl: false,
                  order: 'RECENTLY_VIEWED',
                  archived: 'INCLUDE',
                  searchTerm: params.searchTerm,
                  onlyStarred: params.onlyStarred,
                  hexIds: params.projectIds,
              });
              const connection = data.safeOrUnknownHexes;
              return {
                  org_id: getOrgId(),
                  projects: mapConnectionNodes(connection).map(mapProject),
                  page_info: mapPageInfo(connection?.pageInfo),
              };
          };
          const navigateToProjectTool = defineTool({
              name: 'navigate_to_project',
              displayName: 'Navigate To Project',
              description: 'Navigate the current Hex tab to a project app or logic route. The tool returns immediately after setting the browser location.',
              summary: 'Open a Hex project in the current tab',
              icon: 'external-link',
              group: 'Projects',
              input: z.object({
                  project_id: z.string().min(1).describe('Hex project ID'),
                  mode: z.enum(['app', 'logic']).optional().describe('Project route to open: app or logic (default app)'),
              }),
              output: z.object({
                  url: z.string().describe('URL that the current Hex tab was navigated to'),
              }),
              handle: async (params) => ({ url: navigateToProject(params.project_id, params.mode ?? 'app') }),
          });
                    const refreshAuth = waitForAuth;



                    var pluginTool = navigateToProjectTool

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
                      var productProbe = PRODUCT_HOSTS['hex'] || null
                      if (typeof location === 'undefined' || !location.hostname) {
                        return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Hex page.')
                      }
                      if (true) {
                        if (!new RegExp('(^|\\.)app\\.hex\\.tech$').test(location.hostname)) {
                          return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Hex page.')
                        }
                      } else if (productProbe) {
                        // Self-hosted product (upstream urlPatterns: []): no host to pin,
                        // enforce the product's own host shape at call time.
                        if (!productProbe.test(location.hostname)) {
                          return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a Hex page.')
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
            async navigate_to_project(args) {
              return runTool('navigate_to_project', args)
            },
          }

          async function stdin_default(args) {
            return toolEntry['navigate_to_project'](args)
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
            'The Hex tab could not run the tool (it may have closed or navigated away): ' +
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
          message: result.message || 'Hex API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }
      else
        state.result = {
          status: 'error',
          data: null,
          message: 'The Hex tab returned no result',
          error_code: 'EMPTY_RESULT',
        }
      return 'success'
    },
  },
  result({ state }) {
    return state.result
  },
}
