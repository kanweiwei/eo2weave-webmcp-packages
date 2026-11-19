/**
 * Execution tests for com.powerpoint.main.
 *
 * The workflow runtimes are the upstream OpenTabs PowerPoint plugin compiled
 * verbatim, so these tests drive them against a stubbed page: a fake
 * graph.microsoft.com that records each request, a real (deflate) PPTX fixture
 * in the download path, and happy-dom for the DOMParser/XMLSerializer the OOXML
 * code needs.
 *
 * happy-dom parses the fixture as an HTML document, so namespace-prefixed
 * attributes (`r:id`, `r:embed`) are dropped during parsing — a harness
 * limitation, not a runtime one: the plugin's `getSlideList` has an explicit
 * numeric-suffix fallback for exactly that case and keeps slide order, so the
 * tests assert order/text/shape data rather than `r:` attributes.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import path from 'node:path'
import { Window } from 'happy-dom'

const PKG = 'com.powerpoint.main'
const GRAPH = 'https://graph.microsoft.com/v1.0'
const DRIVE = 'b!drive1'
const MSAL_CLIENT_ID = '2821b473-fe24-4c86-ba16-62834d6e80c3'
const TOKEN = 'GRAPH_TOKEN_VALUE_FOR_TESTS'
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

// --- zip helpers (independent of the package's own implementation) -----------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c
  }
  return table
})()

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** Build a deflated ZIP archive from [name, Buffer] pairs. */
function makeZip(entries) {
  const parts = []
  const central = []
  let offset = 0
  for (const [name, data] of entries) {
    const nameBuf = Buffer.from(name, 'utf8')
    const compressed = deflateRawSync(data)
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    parts.push(local, nameBuf, compressed)

    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt16LE(20, 4)
    entry.writeUInt16LE(20, 6)
    entry.writeUInt16LE(8, 10)
    entry.writeUInt32LE(crc, 16)
    entry.writeUInt32LE(compressed.length, 20)
    entry.writeUInt32LE(data.length, 24)
    entry.writeUInt16LE(nameBuf.length, 28)
    entry.writeUInt32LE(offset, 42)
    central.push(entry, nameBuf)
    offset += 30 + nameBuf.length + compressed.length
  }
  const centralOffset = offset
  let centralSize = 0
  for (const part of central) {
    parts.push(part)
    centralSize += part.length
  }
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralSize, 12)
  eocd.writeUInt32LE(centralOffset, 16)
  parts.push(eocd)
  return Buffer.concat(parts)
}

/** Read a ZIP archive into a Map of name → Buffer (deflate or stored). */
function readZip(buffer) {
  const buf = Buffer.from(buffer)
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('not a zip: no EOCD')
  const count = buf.readUInt16LE(eocd + 10)
  let offset = buf.readUInt32LE(eocd + 16)
  const entries = new Map()
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) throw new Error('bad central directory header')
    const method = buf.readUInt16LE(offset + 10)
    const compressedSize = buf.readUInt32LE(offset + 20)
    const nameLen = buf.readUInt16LE(offset + 28)
    const extraLen = buf.readUInt16LE(offset + 30)
    const commentLen = buf.readUInt16LE(offset + 32)
    const localOffset = buf.readUInt32LE(offset + 42)
    const name = buf.subarray(offset + 46, offset + 46 + nameLen).toString('utf8')
    const localNameLen = buf.readUInt16LE(localOffset + 26)
    const localExtraLen = buf.readUInt16LE(localOffset + 28)
    const start = localOffset + 30 + localNameLen + localExtraLen
    const raw = buf.subarray(start, start + compressedSize)
    entries.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw))
    offset += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

// --- PPTX fixture -----------------------------------------------------------

const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const NS_PKG = 'http://schemas.openxmlformats.org/package/2006/relationships'

const SLIDE_1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm></p:grpSpPr>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="914400" y="457200"/><a:ext cx="9144000" cy="1143000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="4400" b="1"/><a:t>Quarterly Review</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="TextBox 3"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="914400" y="2286000"/><a:ext cx="3657600" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
<a:solidFill><a:srgbClr val="FFCC00"/></a:solidFill></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="2400"/><a:t>Revenue up 12%</a:t></a:r></a:p>
<a:p><a:r><a:rPr lang="en-US" sz="2400"/><a:t>Second line</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld></p:sld>`

const SLIDE_2 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm></p:grpSpPr>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="TextBox 2"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9144000" cy="914400"/></a:xfrm></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>Agenda</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld></p:sld>`

const NOTES_1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm></p:grpSpPr>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>
<p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>Speaker note one</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld></p:notes>`

function deckEntries() {
  const rels = (body) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${NS_PKG}">${body}</Relationships>`
  return [
    [
      '[Content_Types].xml',
      Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
<Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
<Override PartName="/ppt/notesSlides/notesSlide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>
<Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/>
</Types>`,
        'utf8',
      ),
    ],
    [
      '_rels/.rels',
      Buffer.from(
        rels(
          `<Relationship Id="rId1" Type="${NS_R}/officeDocument" Target="ppt/presentation.xml"/>`,
        ),
        'utf8',
      ),
    ],
    [
      'ppt/presentation.xml',
      Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}">
<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId3"/></p:sldMasterIdLst>
<p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst>
<p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`,
        'utf8',
      ),
    ],
    [
      'ppt/_rels/presentation.xml.rels',
      Buffer.from(
        rels(
          `<Relationship Id="rId1" Type="${NS_R}/slide" Target="slides/slide1.xml"/>` +
            `<Relationship Id="rId2" Type="${NS_R}/slide" Target="slides/slide2.xml"/>` +
            `<Relationship Id="rId3" Type="${NS_R}/slideMaster" Target="slideMasters/slideMaster1.xml"/>`,
        ),
        'utf8',
      ),
    ],
    ['ppt/slides/slide1.xml', Buffer.from(SLIDE_1, 'utf8')],
    ['ppt/slides/slide2.xml', Buffer.from(SLIDE_2, 'utf8')],
    [
      'ppt/slides/_rels/slide1.xml.rels',
      Buffer.from(
        rels(`<Relationship Id="rId1" Type="${NS_R}/notesSlide" Target="../notesSlides/notesSlide1.xml"/>`),
        'utf8',
      ),
    ],
    [
      'ppt/slides/_rels/slide2.xml.rels',
      Buffer.from(rels(''), 'utf8'),
    ],
    ['ppt/notesSlides/notesSlide1.xml', Buffer.from(NOTES_1, 'utf8')],
    [
      'ppt/notesSlides/_rels/notesSlide1.xml.rels',
      Buffer.from(
        rels(
          `<Relationship Id="rId1" Type="${NS_R}/notesMaster" Target="../notesMasters/notesMaster1.xml"/>` +
            `<Relationship Id="rId2" Type="${NS_R}/slide" Target="../slides/slide1.xml"/>`,
        ),
        'utf8',
      ),
    ],
    [
      'ppt/notesMasters/notesMaster1.xml',
      Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notesMaster xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm></p:grpSpPr>
</p:spTree></p:cSld></p:notesMaster>`,
        'utf8',
      ),
    ],
    [
      'ppt/notesMasters/_rels/notesMaster1.xml.rels',
      Buffer.from(rels(''), 'utf8'),
    ],
  ]
}

/** Metadata Graph returns for the fixture deck. */
const DECK_ITEM = {
  id: 'item-1',
  name: 'Quarterly Review.pptx',
  size: 4096,
  webUrl: 'https://contoso.sharepoint.com/:p:/r/personal/u/Documents/Quarterly%20Review.pptx',
  eTag: '"etag-1"',
  file: { mimeType: PPTX_MIME },
  createdBy: { user: { displayName: 'Ada Lovelace' } },
  createdDateTime: '2026-01-02T03:04:05Z',
  lastModifiedBy: { user: { displayName: 'Grace Hopper' } },
  lastModifiedDateTime: '2026-02-03T04:05:06Z',
}

// --- page / fetch harness ---------------------------------------------------

const dom = new Window()

const PAGE_GLOBALS = {
  TextDecoder,
  TextEncoder,
  URL,
  URLSearchParams,
  AbortSignal,
  DOMException,
  Node: dom.Node,
  NodeFilter: dom.NodeFilter,
  XMLSerializer: dom.XMLSerializer,
  DecompressionStream,
  CompressionStream,
  Headers,
  btoa: (value) => Buffer.from(String(value), 'binary').toString('base64'),
}

function jsonResponse(payload, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name] ?? headers[String(name).toLowerCase()] ?? null },
    async text() {
      return typeof payload === 'string' ? payload : JSON.stringify(payload)
    },
    async json() {
      return typeof payload === 'string' ? JSON.parse(payload) : payload
    },
  }
}

function blobResponse(buffer, status = 200) {
  const bytes = Buffer.from(buffer)
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    async blob() {
      return new Blob([bytes])
    },
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    },
    async text() {
      return ''
    },
  }
}

const LOCAL_STORAGE_TOKEN_KEY = `msal.${MSAL_CLIENT_ID}.accesstoken-https://graph.microsoft.com/Files.Read.All`

/** A page on the PowerPoint cloud app with a plaintext MSAL Graph token. */
function makePowerPointPage({ handler, localStorage, href } = {}) {
  const requests = []
  const page = {
    hostname: 'powerpoint.cloud.microsoft',
    href: href ?? 'https://powerpoint.cloud.microsoft/design/deck1?driveId=b!drive1',
    localStorage: localStorage ?? {
      [LOCAL_STORAGE_TOKEN_KEY]: JSON.stringify({
        secret: TOKEN,
        expiresOn: String(Math.floor(Date.now() / 1000) + 3600),
      }),
    },
    globals: { ...PAGE_GLOBALS },
    fetch: async (url, init = {}) => {
      const record = { url: String(url), method: String(init.method ?? 'GET').toUpperCase(), init }
      requests.push(record)
      if (!handler) return jsonResponse({})
      return handler(record, requests.length - 1)
    },
  }
  return { page, requests }
}

/** Route the Graph calls of the read/write tests to the fixture deck. */
function deckHandler({ metadata = DECK_ITEM, deck = makeZip(deckEntries()), extra } = {}) {
  return (request) => {
    const { url, method } = request
    if (extra) {
      const handled = extra(request)
      if (handled) return handled
    }
    if (url.startsWith('https://download.example/')) return blobResponse(deck)
    if (!url.startsWith(GRAPH)) return jsonResponse({ error: { message: 'unexpected host' } }, 400)
    const { pathname } = new URL(url)
    if (pathname === `/v1.0/drives/${DRIVE}/items/item-1` && method === 'GET') {
      return jsonResponse({ ...metadata, '@microsoft.graph.downloadUrl': 'https://download.example/deck.pptx' })
    }
    if (pathname === `/v1.0/drives/${DRIVE}/items/item-1/content` && method === 'PUT') {
      return jsonResponse({}, 200)
    }
    return jsonResponse({ error: { message: `unrouted ${method} ${pathname}` } }, 500)
  }
}

export default async function ({ ok, equal, section, runTool, packagesDir }) {
  const pkgDir = path.join(packagesDir, PKG)
  const manifest = JSON.parse(readFileSync(path.join(pkgDir, 'manifest.json'), 'utf8'))

  // --- 1. package shape ----------------------------------------------------
  section('powerpoint: manifest, files and urlRegex')

  equal(manifest.id, PKG, 'powerpoint: manifest id')
  equal(manifest.version, '0.1.0', 'powerpoint: manifest version')
  equal(manifest.tools.length, 39, 'powerpoint: 39 tools (full upstream parity)')

  const upstreamNames = [
    'get_current_user', 'reauthenticate', 'get_drive', 'list_children', 'list_recent',
    'search_files', 'list_shared_with_me', 'get_item', 'get_download_url', 'get_thumbnails',
    'rename_item', 'delete_item', 'copy_item', 'move_item', 'create_folder',
    'create_presentation', 'get_preview_url', 'open_presentation', 'commit_presentation',
    'discard_presentation', 'list_presentation_sessions', 'get_slides', 'get_slide_content',
    'get_slide_layout', 'add_text_box', 'add_shape', 'add_image', 'update_slide_text',
    'update_shape', 'delete_shape', 'duplicate_shape', 'get_slide_notes', 'update_slide_notes',
    'delete_slide', 'duplicate_slide', 'list_permissions', 'create_sharing_link',
    'delete_permission', 'list_versions',
  ]
  equal(
    manifest.tools.map((tool) => tool.name).sort().join(','),
    [...upstreamNames].sort().join(','),
    'powerpoint: tool set is the upstream set',
  )

  const files = readdirSync(path.join(pkgDir, 'workflows')).filter((file) => file.endsWith('.js'))
  equal(files.length, 39, 'powerpoint: one workflow file per tool')

  let brokenFiles = []
  for (const file of files) {
    const full = path.join(pkgDir, 'workflows', file)
    try {
      execFileSync(process.execPath, ['--check', full], { stdio: 'pipe' })
    } catch (error) {
      brokenFiles.push(`${file}: ${error.stderr?.toString().split('\n')[0] ?? error.message}`)
    }
  }
  equal(brokenFiles.length, 0, `powerpoint: every workflow parses (${brokenFiles.join('; ')})`)

  const urlRegex = manifest.tools[0].urlRegex
  ok(
    manifest.tools.every((tool) => tool.urlRegex === urlRegex),
    'powerpoint: all tools share one urlRegex',
  )
  const matches = (href) => {
    const re = new RegExp(urlRegex)
    const match = href.match(re)
    return Boolean(match && match.index === 0 && match[0].length === href.length)
  }
  ok(matches('https://powerpoint.cloud.microsoft/'), 'powerpoint: urlRegex matches the cloud app root')
  ok(
    matches('https://powerpoint.cloud.microsoft/design/deck1?driveId=b!abc#/edit'),
    'powerpoint: urlRegex matches a deck with query and fragment',
  )
  ok(
    matches('https://contoso.sharepoint.com/:p:/r/personal/u/Documents/Deck.pptx?web=1'),
    'powerpoint: urlRegex matches a SharePoint /:p:/ viewer',
  )
  ok(
    matches('https://contoso.sharepoint.com/personal/u/Documents/Deck.pptx'),
    'powerpoint: urlRegex matches a SharePoint direct .pptx link',
  )
  ok(!matches('https://contoso.sharepoint.com/sites/team/Shared%20Documents'), 'powerpoint: urlRegex rejects a SharePoint folder')
  ok(!matches('https://example.com/design/deck1'), 'powerpoint: urlRegex rejects another host')
  ok(!matches('https://powerpoint.cloud.microsoft.evil.test/'), 'powerpoint: urlRegex rejects a lookalike host')
  ok(!matches('https://powerpoint.cloud.microsoft'), 'powerpoint: urlRegex needs the trailing slash')
  ok(!matches('http://powerpoint.cloud.microsoft/design/x'), 'powerpoint: urlRegex requires https')

  // --- 2. reads -----------------------------------------------------------
  section('powerpoint: reads')

  {
    const { page, requests } = makePowerPointPage({
      handler: (request) =>
        jsonResponse({
          id: 'user-1',
          displayName: 'Ada Lovelace',
          mail: '',
          userPrincipalName: 'ada@contoso.com',
        }),
    })
    const result = await runTool(PKG, 'get_current_user', { input: {}, page })
    equal(result.status, 'ok', 'powerpoint get_current_user: ok envelope')
    equal(requests.length, 1, 'powerpoint get_current_user: one request')
    equal(requests[0].url.startsWith(`${GRAPH}/me?`), true, 'powerpoint get_current_user: GET /me')
    equal(
      new URL(requests[0].url).searchParams.get('$select'),
      'displayName,mail,userPrincipalName,id',
      'powerpoint get_current_user: upstream $select list',
    )
    equal(result.data.user.display_name, 'Ada Lovelace', 'powerpoint get_current_user: display name')
    equal(result.data.user.email, 'ada@contoso.com', 'powerpoint get_current_user: email falls back to UPN')
  }

  {
    const { page, requests } = makePowerPointPage({
      handler: () =>
        jsonResponse({
          id: DRIVE,
          name: 'OneDrive',
          driveType: 'business',
          quota: { total: 1000, used: 250, remaining: 750, state: 'normal' },
        }),
    })
    const result = await runTool(PKG, 'get_drive', { input: {}, page })
    equal(result.status, 'ok', 'powerpoint get_drive: ok envelope')
    equal(
      requests[0].url,
      `${GRAPH}/drives/${DRIVE}?%24select=id%2Cname%2CdriveType%2Cquota`,
      'powerpoint get_drive: upstream drive path and $select',
    )
    equal(result.data.drive.drive_type, 'business', 'powerpoint get_drive: drive type mapped')
    equal(result.data.drive.remaining_bytes, 750, 'powerpoint get_drive: quota mapped')
  }

  {
    const { page, requests } = makePowerPointPage({
      handler: () =>
        jsonResponse({
          value: [
            {
              id: 'folder-1',
              name: 'Decks',
              folder: { childCount: 3 },
              webUrl: 'https://contoso.sharepoint.com/Decks',
              createdBy: { user: { displayName: 'Ada Lovelace' } },
            },
            {
              id: 'file-1',
              name: 'Q1.pptx',
              size: 2048,
              file: { mimeType: PPTX_MIME },
              lastModifiedBy: { user: { displayName: 'Grace Hopper' } },
              lastModifiedDateTime: '2026-03-04T05:06:07Z',
            },
          ],
        }),
    })
    const result = await runTool(PKG, 'list_children', { input: { top: 5 }, page })
    equal(result.status, 'ok', 'powerpoint list_children: ok envelope')
    equal(
      requests[0].url,
      `${GRAPH}/drives/${DRIVE}/root/children?%24top=5&%24select=id%2Cname%2Csize%2CwebUrl%2Cfile%2Cfolder%2CcreatedBy%2CcreatedDateTime%2ClastModifiedBy%2ClastModifiedDateTime`,
      'powerpoint list_children: upstream path, $top and $select',
    )
    equal(result.data.items.length, 2, 'powerpoint list_children: both items returned')
    equal(result.data.items[0].is_folder, true, 'powerpoint list_children: folder detected')
    equal(result.data.items[0].mime_type, '', 'powerpoint list_children: folder has no mime type')
    equal(result.data.items[1].mime_type, PPTX_MIME, 'powerpoint list_children: file mime type')
    equal(result.data.items[1].modified_by, 'Grace Hopper', 'powerpoint list_children: modifier mapped')
  }

  {
    const { page, requests } = makePowerPointPage({ handler: deckHandler() })
    const result = await runTool(PKG, 'get_slides', { input: { item_id: 'item-1' }, page })
    equal(result.status, 'ok', 'powerpoint get_slides: ok envelope')
    equal(requests.length, 2, 'powerpoint get_slides: metadata then download')
    equal(requests[0].url, `${GRAPH}/drives/${DRIVE}/items/item-1`, 'powerpoint get_slides: Graph metadata path')
    equal(requests[1].url, 'https://download.example/deck.pptx', 'powerpoint get_slides: pre-authenticated download URL')
    equal(result.data.total, 2, 'powerpoint get_slides: two slides')
    equal(result.data.slides[0].file, 'ppt/slides/slide1.xml', 'powerpoint get_slides: slide order from the deck')
    equal(result.data.slides[0].texts.join('|'), 'Quarterly Review|Revenue up 12%|Second line', 'powerpoint get_slides: slide 1 texts')
    equal(result.data.slides[1].texts.join('|'), 'Agenda', 'powerpoint get_slides: slide 2 texts')
    equal(result.data.slides[0].has_notes, true, 'powerpoint get_slides: slide 1 has notes')
    equal(result.data.slides[1].has_notes, false, 'powerpoint get_slides: slide 2 has no notes')
  }

  {
    const { page } = makePowerPointPage({ handler: deckHandler() })
    const content = await runTool(PKG, 'get_slide_content', { input: { item_id: 'item-1', slide_number: 1 }, page })
    equal(content.status, 'ok', 'powerpoint get_slide_content: ok envelope')
    equal(content.data.number, 1, 'powerpoint get_slide_content: slide number')
    equal(content.data.notes, 'Speaker note one', 'powerpoint get_slide_content: notes extracted')
    equal(content.data.texts.length, 3, 'powerpoint get_slide_content: all text runs')

    const notes = await runTool(PKG, 'get_slide_notes', { input: { item_id: 'item-1', slide_number: 2 }, page })
    equal(notes.status, 'ok', 'powerpoint get_slide_notes: ok envelope')
    equal(notes.data.has_notes, false, 'powerpoint get_slide_notes: slide 2 has no notes part')
    equal(notes.data.notes, '', 'powerpoint get_slide_notes: empty notes text')

    const missing = await runTool(PKG, 'get_slide_notes', { input: { item_id: 'item-1', slide_number: 9 }, page })
    equal(missing.error_code, 'NOT_FOUND', 'powerpoint get_slide_notes: out-of-range slide is NOT_FOUND')
  }

  {
    const { page } = makePowerPointPage({ handler: deckHandler() })
    const result = await runTool(PKG, 'get_slide_layout', { input: { item_id: 'item-1', slide_number: 1 }, page })
    equal(result.status, 'ok', 'powerpoint get_slide_layout: ok envelope')
    const layout = result.data.layout
    equal(layout.width, 13.333, 'powerpoint get_slide_layout: canvas width in inches')
    equal(layout.height, 7.5, 'powerpoint get_slide_layout: canvas height in inches')
    equal(layout.shapes.length, 2, 'powerpoint get_slide_layout: both shapes parsed')
    equal(layout.shapes[0].kind, 'placeholder', 'powerpoint get_slide_layout: title is a placeholder')
    equal(layout.shapes[0].placeholder_type, 'ctrTitle', 'powerpoint get_slide_layout: placeholder type')
    equal(layout.shapes[0].x, 1, 'powerpoint get_slide_layout: EMU → inches')
    equal(layout.shapes[0].text[0].runs[0].text, 'Quarterly Review', 'powerpoint get_slide_layout: run text')
    equal(layout.shapes[0].text[0].runs[0].size, 44, 'powerpoint get_slide_layout: font size in points')
    equal(layout.shapes[0].text[0].runs[0].bold, true, 'powerpoint get_slide_layout: bold flag')
    equal(layout.shapes[1].kind, 'textbox', 'powerpoint get_slide_layout: text box kind')
    equal(layout.shapes[1].fill, 'FFCC00', 'powerpoint get_slide_layout: solid fill colour')
    equal(layout.shapes[1].text[0].align, 'center', 'powerpoint get_slide_layout: paragraph alignment')
    equal(layout.shapes[1].text.length, 2, 'powerpoint get_slide_layout: both paragraphs')
  }

  // --- 3. writes ----------------------------------------------------------
  section('powerpoint: writes')

  {
    const { page, requests } = makePowerPointPage({
      handler: () => jsonResponse({ ...DECK_ITEM, name: 'Renamed.pptx' }),
    })
    const result = await runTool(PKG, 'rename_item', {
      input: { item_id: 'item-1', name: 'Renamed.pptx' },
      page,
    })
    equal(result.status, 'ok', 'powerpoint rename_item: ok envelope')
    equal(requests[0].method, 'PATCH', 'powerpoint rename_item: PATCH')
    equal(requests[0].url, `${GRAPH}/drives/${DRIVE}/items/item-1`, 'powerpoint rename_item: item path')
    equal(requests[0].init.body, JSON.stringify({ name: 'Renamed.pptx' }), 'powerpoint rename_item: JSON body')
    equal(result.data.item.name, 'Renamed.pptx', 'powerpoint rename_item: renamed item returned')
  }

  {
    const { page, requests } = makePowerPointPage({
      handler: () => jsonResponse({ id: 'folder-2', name: 'New folder', folder: { childCount: 0 } }),
    })
    const result = await runTool(PKG, 'create_folder', { input: { name: 'New folder' }, page })
    equal(result.status, 'ok', 'powerpoint create_folder: ok envelope')
    equal(requests[0].method, 'POST', 'powerpoint create_folder: POST')
    equal(requests[0].url, `${GRAPH}/drives/${DRIVE}/root/children`, 'powerpoint create_folder: root children path')
    equal(
      requests[0].init.body,
      JSON.stringify({ name: 'New folder', folder: {}, '@microsoft.graph.conflictBehavior': 'rename' }),
      'powerpoint create_folder: upstream body',
    )
    equal(result.data.item.is_folder, true, 'powerpoint create_folder: folder mapped')
  }

  {
    const { page, requests } = makePowerPointPage({ handler: () => jsonResponse({}, 202) })
    const result = await runTool(PKG, 'copy_item', { input: { item_id: 'item-1', name: 'Copy.pptx' }, page })
    equal(result.status, 'ok', 'powerpoint copy_item: ok envelope')
    equal(requests[0].method, 'POST', 'powerpoint copy_item: POST')
    equal(requests[0].url, `${GRAPH}/drives/${DRIVE}/items/item-1/copy`, 'powerpoint copy_item: /copy path')
    equal(
      requests[0].init.body,
      JSON.stringify({ name: 'Copy.pptx' }),
      'powerpoint copy_item: unspecified destination folder is omitted',
    )
    equal(result.data.success, true, 'powerpoint copy_item: success flag')
  }

  {
    const { page, requests } = makePowerPointPage({ handler: () => jsonResponse({}, 204) })
    const result = await runTool(PKG, 'delete_item', { input: { item_id: 'item-1' }, page })
    equal(result.status, 'ok', 'powerpoint delete_item: ok envelope')
    equal(requests[0].method, 'DELETE', 'powerpoint delete_item: DELETE')
    equal(requests[0].url, `${GRAPH}/drives/${DRIVE}/items/item-1`, 'powerpoint delete_item: item path')
    equal(result.data.success, true, 'powerpoint delete_item: success flag')
  }

  {
    const { page, requests } = makePowerPointPage({
      handler: () => jsonResponse({ id: 'item-new', name: 'Fresh.pptx', file: { mimeType: PPTX_MIME } }),
    })
    const result = await runTool(PKG, 'create_presentation', { input: { name: 'Fresh' }, page })
    equal(result.status, 'ok', 'powerpoint create_presentation: ok envelope')
    equal(requests[0].method, 'PUT', 'powerpoint create_presentation: binary PUT')
    equal(
      requests[0].url,
      `${GRAPH}/drives/${DRIVE}/root:/Fresh.pptx:/content`,
      'powerpoint create_presentation: filename-as-path upload URL',
    )
    equal(
      requests[0].init.headers['Content-Type'],
      PPTX_MIME,
      'powerpoint create_presentation: PPTX content type',
    )
    const uploaded = Buffer.from(await requests[0].init.body.arrayBuffer())
    ok(uploaded.length > 10000, 'powerpoint create_presentation: uploads the embedded blank deck')
    equal(uploaded.subarray(0, 2).toString('binary'), 'PK', 'powerpoint create_presentation: payload is a ZIP/PPTX')
    let blankParts = null
    try {
      blankParts = readZip(uploaded)
    } catch (error) {
      blankParts = null
    }
    ok(blankParts !== null && blankParts.has('ppt/presentation.xml'), 'powerpoint create_presentation: blank deck is a readable PPTX')
    equal(result.data.item.name, 'Fresh.pptx', 'powerpoint create_presentation: created item mapped')
  }

  {
    // Batched session: open → edit (no upload) → commit (conditional PUT).
    const sessions = new Map()
    const { page, requests } = makePowerPointPage({ handler: deckHandler() })
    page.globals.__opentabs_powerpoint_sessions = sessions

    const opened = await runTool(PKG, 'open_presentation', { input: { item_id: 'item-1' }, page })
    equal(opened.status, 'ok', 'powerpoint open_presentation: ok envelope')
    equal(opened.data.slides, 2, 'powerpoint open_presentation: slide count from the download')
    equal(opened.data.drive_id, DRIVE, 'powerpoint open_presentation: drive id resolved from ?driveId')
    equal(opened.data.etag, '"etag-1"', 'powerpoint open_presentation: eTag captured')
    equal(sessions.size, 1, 'powerpoint open_presentation: session cached in the tab')
    const requestsBeforeEdit = requests.length

    const edited = await runTool(PKG, 'add_text_box', {
      input: {
        item_id: 'item-1',
        slide_number: 1,
        text: 'Added by session',
        x: 1,
        y: 4,
        w: 4,
        h: 1,
      },
      page,
    })
    equal(edited.status, 'ok', 'powerpoint add_text_box: ok envelope')
    ok(typeof edited.data.new_shape_id === 'string' && edited.data.new_shape_id.length > 0, 'powerpoint add_text_box: new shape id')
    equal(
      requests.length,
      requestsBeforeEdit,
      'powerpoint add_text_box: session edit performs no HTTP (download/upload deferred)',
    )

    const discarded = await runTool(PKG, 'discard_presentation', { input: { item_id: 'none' }, page })
    equal(discarded.data.discarded, false, 'powerpoint discard_presentation: idempotent on an unopened item')

    const committed = await runTool(PKG, 'commit_presentation', { input: { item_id: 'item-1' }, page })
    equal(committed.status, 'ok', 'powerpoint commit_presentation: ok envelope')
    equal(committed.data.was_dirty, true, 'powerpoint commit_presentation: dirty session flushed')
    equal(sessions.size, 0, 'powerpoint commit_presentation: session closed')
    const put = requests.filter((request) => request.method === 'PUT').pop()
    ok(Boolean(put), 'powerpoint commit_presentation: uploaded via PUT')
    equal(
      put?.url,
      `${GRAPH}/drives/${DRIVE}/items/item-1/content`,
      'powerpoint commit_presentation: content path',
    )
    equal(put?.init.headers['If-Match'], '"etag-1"', 'powerpoint commit_presentation: If-Match carries the open eTag')
    const uploaded = readZip(Buffer.from(await put.init.body.arrayBuffer()))
    const slide1 = uploaded.get('ppt/slides/slide1.xml').toString('utf8')
    ok(slide1.includes('Added by session'), 'powerpoint commit_presentation: edit is present in the uploaded PPTX')
    ok(slide1.includes('Quarterly Review'), 'powerpoint commit_presentation: untouched content preserved')
  }

  {
    // update_slide_notes on a slide without a notes part creates one.
    const { page, requests } = makePowerPointPage({ handler: deckHandler() })
    const result = await runTool(PKG, 'update_slide_notes', {
      input: { item_id: 'item-1', slide_number: 2, notes: 'New note for slide two' },
      page,
    })
    equal(result.status, 'ok', 'powerpoint update_slide_notes: ok envelope')
    const put = requests.filter((request) => request.method === 'PUT').pop()
    ok(Boolean(put), 'powerpoint update_slide_notes: re-uploads the deck')
    const uploaded = readZip(Buffer.from(await put.init.body.arrayBuffer()))
    const notesParts = [...uploaded.keys()].filter((name) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name))
    equal(notesParts.length, 2, 'powerpoint update_slide_notes: creates a second notes part')
    ok(
      notesParts.some((name) => uploaded.get(name).toString('utf8').includes('New note for slide two')),
      'powerpoint update_slide_notes: note text is written into the new part',
    )
  }

  {
    const { page, requests } = makePowerPointPage({ handler: deckHandler() })
    const result = await runTool(PKG, 'duplicate_slide', {
      input: { item_id: 'item-1', source_slide_number: 1 },
      page,
    })
    equal(result.status, 'ok', 'powerpoint duplicate_slide: ok envelope')
    equal(result.data.total_slides, 3, 'powerpoint duplicate_slide: slide count grows')
    const put = requests.filter((request) => request.method === 'PUT').pop()
    const uploaded = readZip(Buffer.from(await put.init.body.arrayBuffer()))
    ok(uploaded.has('ppt/slides/slide3.xml'), 'powerpoint duplicate_slide: clone written as a new part')
    equal(
      uploaded.get('ppt/slides/slide3.xml').toString('utf8'),
      uploaded.get('ppt/slides/slide1.xml').toString('utf8'),
      'powerpoint duplicate_slide: clone is a byte copy of the source slide',
    )
  }

  {
    // Search embeds the query in the Graph path; the drive of a shared file is
    // not consulted (upstream uses /me/drive/root/search).
    const { page, requests } = makePowerPointPage({
      handler: () => jsonResponse({ value: [{ id: 'item-9', name: 'Quarterly Review.pptx', file: { mimeType: PPTX_MIME } }] }),
    })
    const result = await runTool(PKG, 'search_files', {
      input: { query: 'Quarterly Review', top: 3 },
      page,
    })
    equal(result.status, 'ok', 'powerpoint search_files: ok envelope')
    equal(
      requests[0].url,
      `${GRAPH}/me/drive/root/search(q='Quarterly%20Review')?%24top=3&%24select=id%2Cname%2Csize%2CwebUrl%2Cfile%2Cfolder%2CcreatedBy%2CcreatedDateTime%2ClastModifiedBy%2ClastModifiedDateTime`,
      'powerpoint search_files: upstream search(q=...) path',
    )
    equal(result.data.items[0].name, 'Quarterly Review.pptx', 'powerpoint search_files: mapped hit')
  }

  {
    const { page, requests } = makePowerPointPage({ handler: deckHandler() })
    const original = await runTool(PKG, 'get_download_url', { input: { item_id: 'item-1' }, page })
    equal(original.status, 'ok', 'powerpoint get_download_url: ok envelope')
    equal(original.data.download_url, 'https://download.example/deck.pptx', 'powerpoint get_download_url: derived property returned')
    equal(original.data.name, 'Quarterly Review.pptx', 'powerpoint get_download_url: file name returned')

    const converted = await runTool(PKG, 'get_download_url', {
      input: { item_id: 'item-1', format: 'pdf' },
      page,
    })
    equal(
      converted.data.download_url,
      `${GRAPH}/drives/${DRIVE}/items/item-1/content?format=pdf`,
      'powerpoint get_download_url: format branch builds the conversion URL',
    )
    equal(requests.length, 1, 'powerpoint get_download_url: format branch makes no request')
  }

  {
    const sessions = await runTool(PKG, 'list_presentation_sessions', { input: {}, page: makePowerPointPage({ handler: deckHandler() }).page })
    equal(sessions.status, 'ok', 'powerpoint list_presentation_sessions: ok envelope')
    equal(sessions.data.sessions.length, 0, 'powerpoint list_presentation_sessions: empty on a fresh tab')
  }

  {
    // reauthenticate is a no-op on the standalone app and clears state on a
    // SharePoint presentation (the only place MSAL's cache is encrypted).
    const standalone = makePowerPointPage({ handler: deckHandler() })
    const skipped = await runTool(PKG, 'reauthenticate', { input: {}, page: standalone.page })
    equal(skipped.data.status, 'skipped', 'powerpoint reauthenticate: skipped off SharePoint')

    const sharePoint = makePowerPointPage({
      handler: deckHandler(),
      href: 'https://contoso.sharepoint.com/:p:/r/personal/u/Documents/Deck.pptx',
      localStorage: { ['msal.' + MSAL_CLIENT_ID + '.active-account']: '{"homeAccountId":"x"}' },
    })
    sharePoint.page.hostname = 'contoso.sharepoint.com'
    sharePoint.page.globals.__openTabs = { preScript: { powerpoint: { graph: { token: 'stale', exp: 1 } } } }
    const reloading = await runTool(PKG, 'reauthenticate', { input: {}, page: sharePoint.page })
    equal(reloading.status, 'ok', 'powerpoint reauthenticate: ok envelope on SharePoint')
    equal(reloading.data.status, 'reloading', 'powerpoint reauthenticate: reloads the SharePoint tab')
    equal(
      sharePoint.page.globals.__openTabs.preScript.powerpoint.graph,
      undefined,
      'powerpoint reauthenticate: drops the cached captured token',
    )
  }

  {
    // Shape editing inside one session: create → restyle → duplicate → delete.
    const sessions = new Map()
    const { page, requests } = makePowerPointPage({ handler: deckHandler() })
    page.globals.__opentabs_powerpoint_sessions = sessions
    await runTool(PKG, 'open_presentation', { input: { item_id: 'item-1' }, page })

    const added = await runTool(PKG, 'add_shape', {
      input: {
        item_id: 'item-1',
        slide_number: 1,
        preset: 'ellipse',
        x: 1,
        y: 1,
        w: 2,
        h: 1,
        fill: '#00FF00',
        text: 'Hello shape',
      },
      page,
    })
    equal(added.status, 'ok', 'powerpoint add_shape: ok envelope')
    equal(added.data.new_shape_id, '4', 'powerpoint add_shape: id above the highest cNvPr id')

    const updated = await runTool(PKG, 'update_shape', {
      input: { item_id: 'item-1', slide_number: 1, shape_id: '4', text: 'Updated', fill: 'FF0000', x: 2 },
      page,
    })
    equal(updated.status, 'ok', 'powerpoint update_shape: ok envelope')

    const duplicated = await runTool(PKG, 'duplicate_shape', {
      input: { item_id: 'item-1', slide_number: 1, shape_id: '4' },
      page,
    })
    equal(duplicated.data.new_shape_id, '5', 'powerpoint duplicate_shape: reassigns cNvPr ids')

    const deleted = await runTool(PKG, 'delete_shape', {
      input: { item_id: 'item-1', slide_number: 1, shape_id: '5' },
      page,
    })
    equal(deleted.data.success, true, 'powerpoint delete_shape: success flag')

    equal(
      requests.filter((request) => request.method === 'PUT').length,
      0,
      'powerpoint session edits: nothing uploaded before commit',
    )
    await runTool(PKG, 'commit_presentation', { input: { item_id: 'item-1' }, page })
    const put = requests.filter((request) => request.method === 'PUT').pop()
    const uploaded = readZip(Buffer.from(await put.init.body.arrayBuffer()))
    const slide1 = uploaded.get('ppt/slides/slide1.xml').toString('utf8')
    ok(slide1.includes('prst="ellipse"'), 'powerpoint add_shape: preset geometry written to the slide')
    ok(slide1.includes('Updated'), 'powerpoint update_shape: new text written')
    ok(!slide1.includes('Hello shape'), 'powerpoint update_shape: old text replaced')
    ok(slide1.includes('FF0000'), 'powerpoint update_shape: fill replaced')
    ok(slide1.includes('x="1828800"'), 'powerpoint update_shape: inches converted to EMU')
    equal(
      (slide1.match(/prst="ellipse"/g) ?? []).length,
      1,
      'powerpoint duplicate/delete_shape: clone added then removed',
    )
  }

  // --- 4. auth and page failures ------------------------------------------
  section('powerpoint: auth and page failures')

  {
    const { page, requests } = makePowerPointPage({ localStorage: {} })
    const result = await runTool(PKG, 'get_slides', { input: { item_id: 'item-1' }, page })
    equal(result.status, 'error', 'powerpoint no token: error envelope')
    equal(result.error_code, 'AUTH', 'powerpoint no token: AUTH')
    ok(
      String(result.message).includes('Not authenticated'),
      'powerpoint no token: actionable message',
    )
    equal(requests.length, 0, 'powerpoint no token: sends no request')
  }

  {
    // A SharePoint presentation gets the recovery hint appended to AUTH.
    const sharePoint = makePowerPointPage({
      href: 'https://contoso.sharepoint.com/:p:/r/personal/u/Documents/Deck.pptx',
      localStorage: {},
      handler: () => jsonResponse({}),
    })
    sharePoint.page.hostname = 'contoso.sharepoint.com'
    const result = await runTool(PKG, 'get_slides', { input: { item_id: 'item-1' }, page: sharePoint.page })
    equal(result.error_code, 'AUTH', 'powerpoint SharePoint without a token: AUTH')
    ok(
      String(result.message).includes('Call `reauthenticate` to recover.'),
      'powerpoint SharePoint without a token: points at reauthenticate',
    )
    equal(sharePoint.requests.length, 0, 'powerpoint SharePoint without a token: sends no request')
  }

  {
    const { page, requests } = makePowerPointPage({
      href: 'https://example.com/whatever',
      handler: () => jsonResponse({}),
    })
    page.hostname = 'example.com'
    const result = await runTool(PKG, 'get_drive', { input: {}, page })
    equal(result.error_code, 'UNSUPPORTED_PAGE', 'powerpoint wrong host: UNSUPPORTED_PAGE')
    equal(requests.length, 0, 'powerpoint wrong host: sends no request')
  }

  {
    // 401 from Graph is auth, 404 keeps its own code.
    const { page } = makePowerPointPage({
      handler: () => jsonResponse({ error: { message: 'InvalidAuthenticationToken' } }, 401),
    })
    const unauthorized = await runTool(PKG, 'get_drive', { input: {}, page })
    equal(unauthorized.error_code, 'AUTH', 'powerpoint Graph 401: AUTH')

    const missingPage = makePowerPointPage({
      handler: () => jsonResponse({ error: { message: 'itemNotFound' } }, 404),
    })
    const missing = await runTool(PKG, 'get_item', { input: { item_id: 'nope' }, page: missingPage.page })
    equal(missing.error_code, 'NOT_FOUND', 'powerpoint Graph 404: NOT_FOUND')
  }

  {
    // A session map that was never opened for the item reports NOT_FOUND.
    const { page } = makePowerPointPage({ handler: deckHandler() })
    page.globals.__opentabs_powerpoint_sessions = new Map()
    const result = await runTool(PKG, 'commit_presentation', { input: { item_id: 'ghost' }, page })
    equal(result.error_code, 'NOT_FOUND', 'powerpoint commit without a session: NOT_FOUND')
    ok(existsSync(path.join(pkgDir, 'config.json')), 'powerpoint: config.json present')
    equal(readFileSync(path.join(pkgDir, 'config.json'), 'utf8').trim(), '{}', 'powerpoint: config.json ships no activation')
  }
}
