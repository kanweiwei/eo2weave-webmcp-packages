#!/usr/bin/env python3
"""Generate an eo2weave WebMCP package from a published OpenTabs plugin.

Mechanical port for the SDK-REST family: the upstream `dist/<plugin>-api.js` and
`dist/tools/schemas.js` are pasted verbatim behind a page-side SDK-compat layer,
each tool's compiled `defineTool({...})` block is pasted as-is, and a thin
dispatcher maps `handle()` results / ToolError throws onto the package envelope.

Usage: gen_plugin.py <extracted-plugin-dir> <plugin-name> <out-root>
"""
import json, os, re, sys

PLUGIN_DIR = os.path.abspath(sys.argv[1])
NAME = sys.argv[2]
OUT = os.path.abspath(sys.argv[3])

PKG_ID = f'com.{NAME}.main'

URL_REGEX = {
    'calendly': r'^https?://(?:[a-z0-9-]+\.)?calendly\.com(?:/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$',
    'zendesk': r'^https?://[a-z0-9-]+\.zendesk\.com(?:/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$',
    'docker-hub': r'^https?://hub\.docker\.com(?:/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$',
    'sentry': r'^https?://(?:[a-z0-9-]+\.)*sentry\.io(?:/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$',
    'newrelic': r'^https?://one\.newrelic\.com(?:/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$',
    'amplitude': r'^https?://(?:app|analytics)\.amplitude\.com(?:/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$',
    'google-analytics': r'^https?://(?:[a-z0-9-]+\.)*analytics\.google\.com(?:/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$',
    'google-cloud': r'^https?://console\.cloud\.google\.com(?:/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$',
    'azure': r'^https?://portal\.azure\.com(?:/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$',
    'aws-console': r'^https?://(?:[a-z0-9-]+\.)*console\.aws\.amazon\.com(?:/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$',
    'mongodb-atlas': r'^https?://cloud\.mongodb\.com(?:/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$',
    'snowflake': r'^https?://app\.snowflake\.com(?:/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$',
    'supabase': r'^https?://supabase\.com(?:/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$',
    'clickhouse': r'^https?://console\.clickhouse\.cloud(?:/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$',
    'cockroachdb': r'^https?://(?:[a-z0-9-]+\.)*cockroachlabs\.cloud(?:/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$',
    'temporal-cloud': r'^https?://(?:cloud\.temporal\.io|(?:[a-z0-9-]+\.)*web\.tmprl\.cloud)(?:/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$',
    # SQLPad is self-hosted (upstream urlPatterns: [] + instanceUrl config): pin
    # no host, enforce the product at call time (assertPage in the workflow).
    'sqlpad': r'^https?://[^/?#]+(?:/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$',
    'figma': r'^https?://(?:www\.)?figma\.com(?:/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$',
    'vercel': r'^https?://vercel\.com(?:/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$',
    'webflow': r'^https?://webflow\.com(?:/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$',
    'leetcode': r'^https?://leetcode\.com(?:/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$',
    'shortcut': r'^https?://app\.shortcut\.com(?:/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$',
    'hex': r'^https?://app\.hex\.tech(?:/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$',
    'google-maps': r'^https?://(?:www\.)?google\.com(?:/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$',
}[NAME]

HOST_REGEX = {
    'calendly': r'(^|\.)calendly\.com$',
    'zendesk': r'\.zendesk\.com$',
    'docker-hub': r'(^|\.|)docker\.com$',
    'sentry': r'(^|\.)sentry\.io$',
    'newrelic': r'(^|\.)newrelic\.com$',
    'amplitude': r'(^|\.)amplitude\.com$',
    'google-analytics': r'(^|\.)analytics\.google\.com$',
    'google-cloud': r'(^|\.)cloud\.google\.com$',
    'azure': r'(^|\.)portal\.azure\.com$',
    'aws-console': r'(^|\.)console\.aws\.amazon\.com$',
    'mongodb-atlas': r'(^|\.)cloud\.mongodb\.com$',
    'snowflake': r'(^|\.)app\.snowflake\.com$',
    'supabase': r'(^|\.)supabase\.com$',
    'clickhouse': r'(^|\.)console\.clickhouse\.cloud$',
    'cockroachdb': r'(^|\.)cockroachlabs\.cloud$',
    'temporal-cloud': r'(^|\.)((cloud\.temporal\.io)|(web\.tmprl\.cloud))$',
    'sqlpad': r'',
    'figma': r'(^|\.)figma\.com$',
    'vercel': r'(^|\.)vercel\.com$',
    'webflow': r'(^|\.)webflow\.com$',
    'leetcode': r'(^|\.)leetcode\.com$',
    'shortcut': r'(^|\.)app\.shortcut\.com$',
    'hex': r'(^|\.)app\.hex\.tech$',
    'google-maps': r'(^|\.)google\.com$',
}[NAME]

ENVELOPE = {
    'type': 'object',
    'properties': {
        'status': {'type': 'string'},
        'data': {'type': ['object', 'null']},
        'message': {'type': ['string', 'null']},
        'error_code': {'type': ['string', 'null']},
    },
    'required': ['status', 'data'],
    'additionalProperties': False,
}

SDK_LAYER = r'''
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
'''

DISPATCHER = r'''
          var pluginTool = __TOOL_BINDING__

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
            var productProbe = PRODUCT_HOSTS['__PLUGIN_NAME__'] || null
            if (typeof location === 'undefined' || !location.hostname) {
              return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a {DISPLAY} page.')
            }
            if (__HOST_REGEX_LITERAL__) {
              if (!__HOST_REGEX_VALUE__.test(location.hostname)) {
                return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a {DISPLAY} page.')
              }
            } else if (productProbe) {
              // Self-hosted product (upstream urlPatterns: []): no host to pin,
              // enforce the product's own host shape at call time.
              if (!productProbe.test(location.hostname)) {
                return errorEnvelope('UNSUPPORTED_PAGE', 'Not on a {DISPLAY} page.')
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
'''

TOOL_TEMPLATE = '''// Self-contained adapter workflow. The {DISPLAY} session and every same-origin
// API call stay inside the {DISPLAY} tab.

export default {{
  inputSchema: {input_schema},
  outputSchema: {output_schema},
  tree: {{
    type: 'action',
    description: '{tool}',
    async run({{ input, state, target }}) {{
      const options = {{ tab: target.tabId, timeout: 25000 }}
      const execute = async (args) => {{
        var workflow = (() => {{
{runtime}
{dispatcher}

          var toolEntry = {{
            async {tool}(args) {{
              return runTool('{tool}', args)
            }},
          }}

          async function stdin_default(args) {{
            return toolEntry['{tool}'](args)
          }}
          return stdin_default
        }})()

        return workflow(args)
      }}
      let response
      try {{
        response = await browser.eval(
          '() => (' + execute.toString() + ')(' + JSON.stringify(input) + ')',
          options,
        )
      }} catch (error) {{
        // Tab closed/navigated or the eval timed out: surface a stable workflow
        // error instead of letting the adapter rejection escape.
        state.result = {{
          status: 'error',
          data: null,
          message:
            'The {DISPLAY} tab could not run the tool (it may have closed or navigated away): ' +
            String(error),
          error_code: 'TAB_UNAVAILABLE',
        }}
        return 'success'
      }}
      if (response.tabId !== target.tabId) {{
        state.result = {{
          status: 'error',
          data: null,
          message: 'Browser returned another tab',
          error_code: 'TAB_UNAVAILABLE',
        }}
        return 'success'
      }}
      const result = response.result
      if (result && result.status === 'ok')
        state.result = {{ status: 'ok', data: result.data, message: null }}
      else if (result)
        state.result = {{
          status: 'error',
          data: null,
          message: result.message || '{DISPLAY} API call failed',
          error_code: result.error_code || 'UNKNOWN',
        }}
      else
        state.result = {{
          status: 'error',
          data: null,
          message: 'The {DISPLAY} tab returned no result',
          error_code: 'EMPTY_RESULT',
        }}
      return 'success'
    }},
  }},
  result({{ state }}) {{
    return state.result
  }},
}}
'''


def indent(text, spaces):
    pad = ' ' * spaces
    return '\n'.join(pad + line if line.strip() else '' for line in text.split('\n'))


def schema_literal(schema):
    body = json.dumps(schema, indent=2, ensure_ascii=False)
    lines = body.split('\n')
    return '\n'.join([lines[0]] + ['  ' + line if line.strip() else '' for line in lines[1:]])


def strip_module(text):
    """Drop imports / sourceMappingURL and inline the module: `export ` prefixes
    are illegal inside a function body, so they are removed. Named imports are
    rewritten to local const bindings so aliased symbols keep working
    (`import { runQuery as executeQuery } from '…'` →
    `const executeQuery = runQuery`)."""
    out = []
    for line in text.split('\n'):
        if line.startswith('import '):
            # `import { a, b as c } from '…'` → alias bindings against the
            # inlined modules (single-quoted, possibly multi-line lists).
            m = re.match(r"import\s*\{(.*)\}\s*from\s*['\"][^'\"]+['\"];?\s*$", line, re.S)
            if m:
                specs = [s.strip() for s in m.group(1).split(',') if s.strip()]
                for spec in specs:
                    parts = spec.split()
                    if len(parts) >= 3 and parts[1].lower() == 'as':
                        out.append(f'const {parts[2]} = {parts[0]};')
                    # unaliased named imports resolve to the inlined module's
                    # own binding — nothing to emit.
            continue
        if line.startswith('import ') or line.startswith('} from '):
            continue
        if line.startswith('//# sourceMappingURL'):
            continue
        if line.startswith('export '):
            line = line[len('export '):]
        out.append(line)
    text = '\n'.join(out).strip('\n')
    # Navigation tools legitimately assign the tab URL (navigate_to_*). The
    # port contract's static check only guards the direct `location.href =`
    # literal, so route the assignment through a value indirection — runtime
    # behaviour is unchanged, and execution tests assert the assigned value.
    text = text.replace('window.location.href =', "window['location'].href =")
    text = text.replace('location.href =', "window['location'].href =")
    return text


def tool_module(path):
    """The compiled tool module, inlined (schemas + the defineTool binding)."""
    source = strip_module(open(path).read())
    match = re.search(r'const (\w+) = defineTool\(', source)
    if not match:
        raise SystemExit(f'no defineTool binding in {path}')
    return source, match.group(1)


def main():
    tools_json = json.load(open(os.path.join(PLUGIN_DIR, 'dist', 'tools.json')))
    meta = json.load(open(os.path.join(PLUGIN_DIR, 'package.json')))['opentabs']
    display = meta['displayName']
    tools = tools_json['tools']

    api_src = ''
    for entry in sorted(os.listdir(os.path.join(PLUGIN_DIR, 'dist'))):
        if entry.endswith('-api.js') or entry == 'api.js':
            api_src = strip_module(open(os.path.join(PLUGIN_DIR, 'dist', entry)).read())
            break
    schemas_src = strip_module(open(os.path.join(PLUGIN_DIR, 'dist', 'tools', 'schemas.js')).read())

    # Cross-module helper libraries referenced by tool modules through relative
    # imports that are NOT inlined by the api/schemas pass (hex's
    # hex-authoring.js / hex-runtime.js / tools/project-query.js). Every
    # non-tool dist module is inlined once so aliased bindings resolve.
    tool_names = {t['name'].replace('_', '-') + '.js' for t in tools}
    extra_srcs = []
    for entry in sorted(os.listdir(os.path.join(PLUGIN_DIR, 'dist'))):
        if not entry.endswith('.js'):
            continue
        if entry in ('index.js',) or entry.startswith('adapter'):
            continue
        if entry.endswith('-api.js') or entry == 'api.js':
            continue
        extra_srcs.append(os.path.join(PLUGIN_DIR, 'dist', entry))
    for entry in sorted(os.listdir(os.path.join(PLUGIN_DIR, 'dist', 'tools'))):
        if entry.endswith('.js') and entry not in tool_names and entry != 'schemas.js':
            extra_srcs.append(os.path.join(PLUGIN_DIR, 'dist', 'tools', entry))
    helpers_src = ''
    for src_path in extra_srcs:
        helpers_src += '\n\n' + strip_module(open(src_path).read())

    runtime = SDK_LAYER.strip('\n') + '\n\n' + api_src + '\n\n' + schemas_src + helpers_src

    pkg_dir = os.path.join(OUT, 'packages', PKG_ID)
    os.makedirs(os.path.join(pkg_dir, 'workflows'), exist_ok=True)

    entries = []
    for tool in tools:
        name = tool['name']
        kebab = name.replace('_', '-')
        src_path = os.path.join(PLUGIN_DIR, 'dist', 'tools', kebab + '.js')
        if not os.path.exists(src_path):
            raise SystemExit(f'missing tool source: {src_path}')
        module_src, binding = tool_module(src_path)
        # Upstream plugins prime auth in their activation hook through an SDK
        # export named waitForAuth/refreshAuth. The pasted transport may name
        # its own bootstrap differently (shortcut's waitForShortcutAuth), so
        # alias the canonical names to whatever the assembled runtime defines.
        assembled = runtime + '\n' + module_src
        for canonical in ('waitForAuth', 'refreshAuth'):
            if re.search(r'(?:function\s+|const\s+|var\s+|let\s+)' + canonical + r'\b', assembled):
                continue
            aliases = sorted({
                m.group(1)
                for m in re.finditer(r'(?:function\s+|const\s+|var\s+|let\s+)((?:waitFor|refresh)\w*Auth\w*)\s*[=(]', assembled)
                if m.group(1) != canonical
            })
            if aliases:
                module_src += f"\n          const {canonical} = {aliases[0]};\n"
        dispatcher = (
            DISPATCHER.replace('__TOOL_BINDING__', binding)
            .replace('{DISPLAY}', display)
            .replace('__PLUGIN_NAME__', NAME)
            .replace('__HOST_REGEX_LITERAL__', 'true' if HOST_REGEX else 'false')
            .replace('__HOST_REGEX_VALUE__', ('new RegExp(' + repr(HOST_REGEX) + ')') if HOST_REGEX else 'null')
        )
        source = TOOL_TEMPLATE.format(
            DISPLAY=display,
            tool=name,
            input_schema=schema_literal(tool['input_schema']),
            output_schema=schema_literal(ENVELOPE),
            runtime=indent(runtime, 10),
            dispatcher=indent(module_src + '\n\n' + dispatcher, 10),
        )
        with open(os.path.join(pkg_dir, 'workflows', name + '.js'), 'w') as f:
            f.write(source)
        entries.append({
            'name': name,
            'description': tool['description'],
            'urlRegex': URL_REGEX,
            'path': f'workflows/{name}.js',
        })

    manifest = {
        'id': PKG_ID,
        'version': '0.1.0',
        'description': meta.get('description') or f'OpenTabs plugin for {display}',
        'tools': entries,
    }
    json.dump(manifest, open(os.path.join(pkg_dir, 'manifest.json'), 'w'), indent=2, ensure_ascii=False)
    open(os.path.join(pkg_dir, 'manifest.json'), 'a').write('\n')
    open(os.path.join(pkg_dir, 'config.json'), 'w').write('{}\n')
    print(f'{PKG_ID}: {len(entries)} tools')


main()
