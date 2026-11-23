/**
 * com.cockroachdb.main — execution tests against a stubbed CockroachDB Cloud tab.
 *
 * Identity is a non-empty `window.initData` (the server-injected session blob)
 * plus a `window.proto` global with compiled protobuf classes — exactly what
 * the ported gRPC-Web transport reads. The gRPC call itself is a POST to
 * cockroachlabs.cloud with HttpOnly session cookies (credentials 'include')
 * and a grpc-web+proto body; the stub proto serializes to empty frames so the
 * fetch recorder can assert method/headers and feed canned response frames.
 */

function grpcResponse(frames) {
  // frames: [{ flag, payload }] — payload is a plain object; the stub proto
  // decodes nothing, so we hand back the raw object via toObject().
  const chunks = frames.map((f) => ({
    flag: f.flag,
    data: new TextEncoder().encode(JSON.stringify(f.payload ?? {})),
  }))
  const parts = []
  for (const c of chunks) {
    const len = c.data.length
    parts.push(c.flag, len, c.data)
  }
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/grpc-web+proto' },
    async arrayBuffer() {
      // Rebuild the real wire format: [flag:1][len:4 BE][payload].
      const total = chunks.reduce((n, c) => n + 5 + c.data.length, 0)
      const buf = new ArrayBuffer(total)
      const view = new DataView(buf)
      let offset = 0
      for (const c of chunks) {
        view.setUint8(offset, c.flag)
        view.setUint32(offset + 1, c.data.length)
        new Uint8Array(buf, offset + 5, c.data.length).set(c.data)
        offset += 5 + c.data.length
      }
      return buf
    },
  }
}

function makeProto() {
  // Real constructor functions (arrow functions have no .prototype), one per
  // proto message class name; the canned responses carry the decoded data, so
  // serializeBinary() emits an empty payload and deserializeBinary() reads JSON.
  function clsFactory(name) {
    const cls = function Message() {
      this.__name = name
    }
  // Serialize to an empty payload: the canned responses carry the data.
  cls.prototype.serializeBinary = () => new Uint8Array(0)
  cls.prototype.toObject = function () {
    return this.__decoded ?? {}
  }
  cls.prototype.decodeAndSet = function (data) {
    // The transport calls responseClass.deserializeBinary(data).toObject();
    // the canned data frame is JSON of the toObject() shape in tests.
    try {
      this.__decoded = JSON.parse(new TextDecoder().decode(data))
    } catch {
      this.__decoded = {}
    }
    return this
  }
  cls.deserializeBinary = (data) => {
    const instance = new cls()
    return instance.decodeAndSet(data)
  }
  // newInstance() is the google-protobuf convention upstream generated code uses.
    cls.newInstance = () => new cls()
    return cls
  }
  const ns = {
    console: {},
    common: {},
  }
  for (const name of [
    'ListClustersResponse',
    'GetClusterResponse',
    'GetOrganizationResponse',
    'ListDatabaseUsersResponse',
    'ListInvoicesResponse',
    'Empty',
    'SetDeleteProtectionRequest',
    'GetClusterRequest',
  ]) {
    ns.console[name] = clsFactory(name)
    ns.common[name] = clsFactory(name)
    ns[name] = clsFactory(name)
  }
  return ns
}

function cockroachPage(handler, extra = {}) {
  const requests = []
  const page = {
    hostname: 'cockroachlabs.cloud',
    href: 'https://cockroachlabs.cloud/cluster/org-1/overview',
    fetch: async (url, init) => {
      requests.push({ url: String(url), init })
      return handler(String(url), init)
    },
  }
  page.globals = {
    AbortSignal: { timeout: () => undefined },
    DOMException,
    initData: 'base64-session-blob',
    proto: makeProto(),
    ...(extra.globals ?? {}),
  }
  Object.assign(page, extra)
  return { requests, page }
}

export default async function register({ ok, equal, section, runTool }) {
  section('com.cockroachdb.main: identity')

  {
    const { requests, page } = cockroachPage(() => grpcResponse([]), {
      globals: { AbortSignal: { timeout: () => undefined }, proto: makeProto() },
    })
    const result = await runTool('com.cockroachdb.main', 'list_clusters', { input: {}, page })
    equal(result.status, 'error', 'cockroachdb signed out: error status')
    equal(result.error_code, 'AUTH', 'cockroachdb signed out: AUTH')
    equal(requests.length, 0, 'cockroachdb signed out: makes no request')
  }

  section('com.cockroachdb.main: reads')

  {
    const { requests, page } = cockroachPage(() =>
      grpcResponse([
        {
          flag: 0,
          payload: {
            clustersList: [
              {
                id: 'c-1',
                name: 'prod',
                cockroachVersion: 'v24.1',
                cloudProvider: 1,
                state: 2,
                sqlDns: 'prod.cockroachlabs.cloud',
                regionsList: [{ id: 'r1', numNodes: 3, isPrimary: true }],
                createdAt: { seconds: '1700000000', nanos: 0 },
              },
            ],
          },
        },
        { flag: 128, payload: {} },
      ]),
    )
    const result = await runTool('com.cockroachdb.main', 'list_clusters', { input: {}, page })
    if (result.status !== 'ok') console.log('CRDB CLUSTERS', JSON.stringify(result).slice(0, 300))
    equal(result.status, 'ok', 'cockroachdb list_clusters: ok')
    equal(result.data.clusters.length, 1, 'cockroachdb list_clusters: one cluster')
    equal(result.data.clusters[0].id, 'c-1', 'cockroachdb list_clusters: id mapped')
    equal(result.data.clusters[0].name, 'prod', 'cockroachdb list_clusters: name mapped')
    equal(requests.length, 1, 'cockroachdb list_clusters: one request')
    ok(requests[0].url.includes('console.ManagementConsole/ListClusters'), 'cockroachdb: gRPC method path')
    equal(requests[0].init.method, 'POST', 'cockroachdb: gRPC POST')
    equal(requests[0].init.headers['Content-Type'], 'application/grpc-web+proto', 'cockroachdb: grpc-web content type')
    equal(requests[0].init.headers['X-Grpc-Web'], '1', 'cockroachdb: X-Grpc-Web header')
    equal(requests[0].init.credentials, 'include', 'cockroachdb: session cookies sent')
  }

  section('com.cockroachdb.main: writes')

  {
    const { requests, page } = cockroachPage(() =>
      grpcResponse([
        { flag: 0, payload: {} },
        { flag: 128, payload: {} },
      ]),
    )
    const result = await runTool('com.cockroachdb.main', 'set_delete_protection', {
      input: { cluster_id: 'c-1', enabled: true },
      page,
    })
    if (result.status !== 'ok') console.log('CRDB PROT', JSON.stringify(result).slice(0, 300))
    equal(result.status, 'ok', 'cockroachdb set_delete_protection: ok')
    ok(requests[0].url.includes('console.ManagementConsole/'), 'cockroachdb set_delete_protection: gRPC path')
    equal(requests[0].init.method, 'POST', 'cockroachdb set_delete_protection: POST')
  }

  section('com.cockroachdb.main: failures')

  {
    // grpc-status 5 in the trailer → NOT_FOUND. The trailer frame is raw
    // HTTP/1-style header text, not JSON.
    const { page } = cockroachPage(() => {
      const encoder = new TextEncoder()
      const trailer = encoder.encode('grpc-status: 5\r\ngrpc-message: missing')
      const out = new Uint8Array(5 + 5 + trailer.length)
      let off = 0
      for (const [flag, bytes] of [
        [0, new Uint8Array(0)],
        [128, trailer],
      ]) {
        out[off] = flag
        new DataView(out.buffer).setUint32(off + 1, bytes.length)
        out.set(bytes, off + 5)
        off += 5 + bytes.length
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/grpc-web+proto' },
        async arrayBuffer() {
          return out.buffer
        },
      }
    })
    const result = await runTool('com.cockroachdb.main', 'get_cluster', {
      input: { cluster_id: 'missing' },
      page,
    })
    equal(result.status, 'error', 'cockroachdb grpc error: error status')
    equal(result.error_code, 'NOT_FOUND', 'cockroachdb grpc 5: NOT_FOUND')
  }

  section('com.cockroachdb.main: wrong page')

  {
    const { page } = cockroachPage(() => grpcResponse([]), {
      hostname: 'example.com',
      href: 'https://example.com/',
    })
    const result = await runTool('com.cockroachdb.main', 'list_clusters', { input: {}, page })
    equal(result.status, 'error', 'cockroachdb wrong host: error status')
    equal(result.error_code, 'UNSUPPORTED_PAGE', 'cockroachdb wrong host: UNSUPPORTED_PAGE')
  }
}
