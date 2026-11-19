// Execution tests for com.confluence.main (scripts/tests, auto-loaded by npm test).
//
// The ported runtime reads the Confluence Cloud session identity and the wiki
// base path from the page's meta tags (ajs-atlassian-account-id,
// ajs-base-url, ajs-cloud-id) and talks to the same-origin
// /wiki/api/v2 and /wiki/rest/api endpoints with the page cookie. Every
// fixture supplies those meta tags and every assertion checks the exact
// request plus the parsed output.

import { readFileSync } from 'node:fs'
import path from 'node:path'

const SITE = 'https://acme.atlassian.net'
const BASE = `${SITE}/wiki`
const PAGE_URL = `${BASE}/spaces/SD/pages/456/Design-notes`

const META = {
  'ajs-atlassian-account-id': '5b10ac8d82e05b22cc7d4ef5',
  'ajs-base-url': BASE,
  'ajs-cloud-id': '11111111-2222-3333-4444-555555555555',
}

const jsonResponse = (payload, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => (status === 429 ? '30' : 'application/json') },
  async text() {
    return typeof payload === 'string' ? payload : JSON.stringify(payload)
  },
  async json() {
    if (typeof payload === 'string') return JSON.parse(payload)
    return payload
  },
})

/** A stubbed <site>.atlassian.net/wiki page. */
function pageWith(handler, overrides = {}) {
  const requests = []
  return {
    requests,
    page: {
      hostname: 'acme.atlassian.net',
      origin: SITE,
      href: PAGE_URL,
      meta: { ...META },
      fetch: async (url, init) => {
        requests.push({ url, init })
        return handler(url, init, requests.length)
      },
      ...overrides,
    },
  }
}

const spaceJson = {
  id: '123',
  key: 'SD',
  name: 'Software Development',
  type: 'global',
  status: 'current',
  description: { value: 'ignored' },
  homepageId: '456',
}

const pageJson = {
  id: '456',
  title: 'Design notes',
  spaceId: '123',
  status: 'current',
  parentId: null,
  authorId: '5b10ac8d82e05b22cc7d4ef5',
  createdAt: '2026-01-02T03:04:05.000Z',
  version: {
    number: 3,
    authorId: '5b10ac8d82e05b22cc7d4ef5',
    createdAt: '2026-02-03T04:05:06.000Z',
    message: 'tighten wording',
  },
  _links: { webui: '/spaces/SD/pages/456/Design-notes' },
}

const commentJson = {
  id: '900',
  pageId: '456',
  status: 'current',
  title: 'Re: Design notes',
  version: { authorId: 'acc-2', createdAt: '2026-03-01T00:00:00.000Z' },
  body: { storage: { value: '<p>Great work!</p>' } },
}

const nextLink = (cursor) => ({ _links: { next: `/wiki/api/v2/pages?cursor=${cursor}&limit=25` } })

export default async function register({ ok, equal, section, runTool, packagesDir }) {
  const P = 'com.confluence.main'
  const manifest = JSON.parse(readFileSync(path.join(packagesDir, P, 'manifest.json'), 'utf8'))

  section('urlRegex: com.confluence.main scopes to *.atlassian.net/wiki')

  {
    const mustMatch = [
      PAGE_URL,
      `${BASE}/spaces/SD/overview`,
      `${BASE}/spaces/SD/overview?homepageId=456`,
      `${BASE}/pages/viewpage.action?pageId=456#comment-1`,
      `${BASE}/`,
      `${SITE}/wiki/x`,
      `http://acme.atlassian.net/wiki/spaces/SD`,
    ]
    const mustNotMatch = [
      `${SITE}/jira/software/projects/SD/boards`,
      `${SITE}/`,
      'https://confluence.example.com/wiki/spaces/SD',
      'https://acme.atlassian.net.evil.com/wiki/spaces/SD',
      'https://acatlassian.net/wiki/spaces/SD',
    ]
    for (const tool of manifest.tools) {
      const regex = new RegExp(tool.urlRegex)
      for (const url of mustMatch)
        ok(regex.test(url), `confluence urlRegex matches ${url} (${tool.name})`)
      for (const url of mustNotMatch)
        ok(!regex.test(url), `confluence urlRegex rejects ${url} (${tool.name})`)
    }
  }

  section('execution: Confluence reads against a stubbed *.atlassian.net/wiki page')

  // --- spaces -------------------------------------------------------------
  {
    const { page, requests } = pageWith(() =>
      jsonResponse({ results: [spaceJson], ...nextLink('abc123') }),
    )
    const result = await runTool(P, 'list_spaces', {
      input: { limit: 10, cursor: 'prev' },
      page,
    })
    equal(result.status, 'ok', 'confluence list_spaces: status')
    equal(requests.length, 1, 'confluence list_spaces: one request')
    equal(
      requests[0].url,
      `${BASE}/api/v2/spaces?limit=10&cursor=prev`,
      'confluence list_spaces: endpoint + query',
    )
    equal(requests[0].init.method, 'GET', 'confluence list_spaces: GET')
    equal(requests[0].init.credentials, 'include', 'confluence list_spaces: page cookie')
    equal(requests[0].init.headers.Accept, 'application/json', 'confluence list_spaces: Accept')
    equal(result.data.spaces[0].id, '123', 'confluence list_spaces: id')
    equal(result.data.spaces[0].key, 'SD', 'confluence list_spaces: key')
    equal(result.data.spaces[0].homepage_id, '456', 'confluence list_spaces: homepage_id')
    equal(result.data.spaces[0].description, null, 'confluence list_spaces: non-string description')
    equal(result.data.cursor, 'abc123', 'confluence list_spaces: cursor from _links.next')
  }

  {
    const { page, requests } = pageWith(() => jsonResponse(spaceJson))
    const result = await runTool(P, 'get_space', { input: { space_id: '123' }, page })
    equal(result.status, 'ok', 'confluence get_space: status')
    equal(requests[0].url, `${BASE}/api/v2/spaces/123`, 'confluence get_space: endpoint')
    equal(result.data.space.name, 'Software Development', 'confluence get_space: name')
    equal(result.data.space.type, 'global', 'confluence get_space: type')
  }

  // --- pages --------------------------------------------------------------
  {
    const { page, requests } = pageWith(() => jsonResponse({ results: [pageJson], _links: {} }))
    const result = await runTool(P, 'list_pages', {
      input: { space_id: '123', sort: '-modified-date', limit: 5 },
      page,
    })
    equal(result.status, 'ok', 'confluence list_pages: status')
    equal(
      requests[0].url,
      `${BASE}/api/v2/spaces/123/pages?limit=5&sort=-modified-date`,
      'confluence list_pages: space-scoped endpoint',
    )
    equal(result.data.pages[0].id, '456', 'confluence list_pages: id')
    equal(result.data.pages[0].space_id, '123', 'confluence list_pages: space_id')
    equal(result.data.pages[0].version.number, 3, 'confluence list_pages: version number')
    equal(result.data.pages[0].parent_id, null, 'confluence list_pages: null parent')
    equal(result.data.cursor, null, 'confluence list_pages: no cursor')
  }

  {
    const { page, requests } = pageWith(() => jsonResponse({ results: [] }))
    const result = await runTool(P, 'list_pages', { input: {}, page })
    equal(result.status, 'ok', 'confluence list_pages (all spaces): status')
    equal(requests[0].url, `${BASE}/api/v2/pages?limit=25`, 'confluence list_pages: default limit')
  }

  {
    const { page, requests } = pageWith(() =>
      jsonResponse({ ...pageJson, body: { storage: { value: '<p>Body copy</p>' } } }),
    )
    const result = await runTool(P, 'get_page', {
      input: { page_id: '456', include_body: true },
      page,
    })
    equal(result.status, 'ok', 'confluence get_page: status')
    equal(
      requests[0].url,
      `${BASE}/api/v2/pages/456?body-format=storage`,
      'confluence get_page: body-format query',
    )
    equal(result.data.page.title, 'Design notes', 'confluence get_page: title')
    equal(result.data.page.body, '<p>Body copy</p>', 'confluence get_page: storage body')
    equal(
      result.data.page.web_url,
      '/spaces/SD/pages/456/Design-notes',
      'confluence get_page: web_url from _links.webui',
    )
  }

  {
    const { page, requests } = pageWith(() => jsonResponse(pageJson))
    const result = await runTool(P, 'get_page', { input: { page_id: '456' }, page })
    equal(requests[0].url, `${BASE}/api/v2/pages/456`, 'confluence get_page: no body query by default')
    equal(result.data.page.body, null, 'confluence get_page: body null when not requested')
  }

  {
    const { page, requests } = pageWith(() =>
      jsonResponse({
        results: [{ id: '789', title: 'Child', spaceId: '123', status: 'current', childPosition: 2 }],
        _links: {},
      }),
    )
    const result = await runTool(P, 'get_page_children', { input: { page_id: '456' }, page })
    equal(result.status, 'ok', 'confluence get_page_children: status')
    equal(
      requests[0].url,
      `${BASE}/api/v2/pages/456/children?limit=25`,
      'confluence get_page_children: endpoint',
    )
    equal(result.data.children[0].position, 2, 'confluence get_page_children: childPosition')
  }

  {
    const { page, requests } = pageWith(() =>
      jsonResponse({
        results: [
          {
            id: 'att-1',
            title: 'diagram.png',
            mediaType: 'image/png',
            fileSize: 2048,
            _links: { download: '/download/attachments/456/diagram.png' },
          },
        ],
      }),
    )
    const result = await runTool(P, 'list_page_attachments', { input: { page_id: '456' }, page })
    equal(requests[0].url, `${BASE}/api/v2/pages/456/attachments?limit=25`, 'confluence attachments: endpoint')
    equal(result.data.attachments[0].media_type, 'image/png', 'confluence attachments: media type')
    equal(
      result.data.attachments[0].download_url,
      '/download/attachments/456/diagram.png',
      'confluence attachments: download link',
    )
  }

  {
    const { page, requests } = pageWith(() =>
      jsonResponse({
        results: [
          {
            number: 2,
            message: 'tweak',
            createdAt: '2026-02-03T04:05:06.000Z',
            authorId: 'acc-2',
            minorEdit: true,
          },
        ],
      }),
    )
    const result = await runTool(P, 'list_page_versions', { input: { page_id: '456' }, page })
    equal(requests[0].url, `${BASE}/api/v2/pages/456/versions?limit=25`, 'confluence versions: endpoint')
    equal(result.data.versions[0].minor_edit, true, 'confluence versions: minor_edit')
    equal(result.data.versions[0].author_id, 'acc-2', 'confluence versions: author_id')
  }

  // --- search (v1 API) ----------------------------------------------------
  {
    const { page, requests } = pageWith(() =>
      jsonResponse({
        results: [
          {
            content: { id: '456', title: 'Design notes', type: 'page', status: 'current' },
            excerpt: 'the <b>design</b> notes',
            url: '/spaces/SD/pages/456/Design-notes',
            lastModified: '2026-02-03T04:05:06.000Z',
            resultGlobalContainer: { title: 'Software Development' },
          },
        ],
        totalSize: 1,
        size: 1,
      }),
    )
    const result = await runTool(P, 'search', {
      input: { cql: 'type=page AND text~"design"', limit: 10, start: 5 },
      page,
    })
    equal(result.status, 'ok', 'confluence search: status')
    equal(requests[0].url.startsWith(`${BASE}/rest/api/search?`), true, 'confluence search: v1 base path')
    const searchUrl = new URL(requests[0].url)
    equal(searchUrl.searchParams.get('cql'), 'type=page AND text~"design"', 'confluence search: cql')
    equal(searchUrl.searchParams.get('limit'), '10', 'confluence search: limit')
    equal(searchUrl.searchParams.get('start'), '5', 'confluence search: start')
    equal(result.data.total_size, 1, 'confluence search: total_size')
    equal(result.data.size, 1, 'confluence search: size')
    equal(result.data.results[0].id, '456', 'confluence search: result id')
    equal(result.data.results[0].title, 'Design notes', 'confluence search: result title')
    equal(result.data.results[0].space_title, 'Software Development', 'confluence search: space title')
  }

  // --- writes -------------------------------------------------------------
  section('execution: Confluence writes against a stubbed page')

  {
    const { page, requests } = pageWith(() => jsonResponse({ ...pageJson, id: '999', title: 'New page' }))
    const result = await runTool(P, 'create_page', {
      input: { space_id: '123', title: 'New page', body: '<p>Hello world</p>' },
      page,
    })
    equal(result.status, 'ok', 'confluence create_page: status')
    equal(requests[0].url, `${BASE}/api/v2/pages`, 'confluence create_page: endpoint')
    equal(requests[0].init.method, 'POST', 'confluence create_page: POST')
    equal(requests[0].init.headers['Content-Type'], 'application/json', 'confluence create_page: JSON content type')
    equal(
      requests[0].init.headers['X-Atlassian-Token'],
      'no-check',
      'confluence create_page: XSRF opt-out header',
    )
    const body = JSON.parse(requests[0].init.body)
    equal(body.spaceId, '123', 'confluence create_page: spaceId')
    equal(body.title, 'New page', 'confluence create_page: title')
    equal(body.status, 'current', 'confluence create_page: default status')
    equal(body.body.representation, 'storage', 'confluence create_page: storage representation')
    equal(body.body.value, '<p>Hello world</p>', 'confluence create_page: body value')
    equal('parentId' in body, false, 'confluence create_page: parentId omitted')
    equal(result.data.page.id, '999', 'confluence create_page: mapped page')
  }

  {
    const { page, requests } = pageWith(() => jsonResponse(pageJson))
    const result = await runTool(P, 'create_page', {
      input: { space_id: '123', title: 'Child page', body: '<p>x</p>', parent_id: '456', status: 'draft' },
      page,
    })
    equal(result.status, 'ok', 'confluence create_page (parent): status')
    const body = JSON.parse(requests[0].init.body)
    equal(body.parentId, '456', 'confluence create_page: parentId when supplied')
    equal(body.status, 'draft', 'confluence create_page: explicit status')
  }

  {
    const { page, requests } = pageWith(() => jsonResponse({ ...pageJson, version: { number: 4 } }))
    const result = await runTool(P, 'update_page', {
      input: { page_id: '456', title: 'Design notes', body: '<p>v2</p>', version_number: 3 },
      page,
    })
    equal(result.status, 'ok', 'confluence update_page: status')
    equal(requests[0].url, `${BASE}/api/v2/pages/456`, 'confluence update_page: endpoint')
    equal(requests[0].init.method, 'PUT', 'confluence update_page: PUT')
    const body = JSON.parse(requests[0].init.body)
    equal(body.id, '456', 'confluence update_page: id in body')
    equal(body.version.number, 4, 'confluence update_page: version incremented')
    equal(body.version.message, '', 'confluence update_page: empty version message default')
    equal(body.status, 'current', 'confluence update_page: default status')
    equal(body.body.value, '<p>v2</p>', 'confluence update_page: body value')
  }

  {
    const { page, requests } = pageWith(() => jsonResponse({}, 204))
    const result = await runTool(P, 'delete_page', { input: { page_id: '456' }, page })
    equal(result.status, 'ok', 'confluence delete_page: status')
    equal(requests[0].init.method, 'DELETE', 'confluence delete_page: DELETE')
    equal(result.data.deleted, true, 'confluence delete_page: deleted flag')
  }

  // --- comments -----------------------------------------------------------
  {
    const { page, requests } = pageWith(() => jsonResponse({ results: [commentJson] }))
    const result = await runTool(P, 'list_comments', {
      input: { page_id: '456', limit: 50 },
      page,
    })
    equal(result.status, 'ok', 'confluence list_comments: status')
    equal(
      requests[0].url,
      `${BASE}/api/v2/pages/456/footer-comments?limit=50&body-format=storage`,
      'confluence list_comments: endpoint + body-format default',
    )
    equal(result.data.comments[0].body, '<p>Great work!</p>', 'confluence list_comments: storage body')
    equal(result.data.comments[0].author_id, 'acc-2', 'confluence list_comments: author')
  }

  {
    const { page, requests } = pageWith(() =>
      jsonResponse({
        results: [
          {
            ...commentJson,
            resolutionStatus: 'open',
            properties: {
              inlineOriginalSelection: 'the exact text',
              inlineMarkerRef: 'marker-ref-1',
            },
          },
        ],
      }),
    )
    const result = await runTool(P, 'list_inline_comments', {
      input: { page_id: '456', resolution_status: 'open' },
      page,
    })
    equal(
      requests[0].url,
      `${BASE}/api/v2/pages/456/inline-comments?limit=25&body-format=storage&resolution-status=open`,
      'confluence list_inline_comments: endpoint + resolution-status',
    )
    equal(result.data.comments[0].resolution_status, 'open', 'confluence inline: resolution status')
    equal(result.data.comments[0].text_selection, 'the exact text', 'confluence inline: anchored text')
    equal(result.data.comments[0].inline_marker_ref, 'marker-ref-1', 'confluence inline: marker ref')
  }

  {
    const { page, requests } = pageWith(() => jsonResponse({ results: [commentJson] }))
    const result = await runTool(P, 'list_comment_replies', {
      input: { comment_id: '900', comment_type: 'footer' },
      page,
    })
    equal(
      requests[0].url,
      `${BASE}/api/v2/footer-comments/900/children?limit=25&body-format=storage`,
      'confluence list_comment_replies: footer endpoint',
    )
    equal(result.data.replies[0].id, '900', 'confluence list_comment_replies: reply id')
  }

  {
    const { page, requests } = pageWith(() => jsonResponse({ ...commentJson, id: '901' }, 200))
    const result = await runTool(P, 'create_comment', {
      input: { page_id: '456', body: '<p>Ship it</p>' },
      page,
    })
    equal(result.status, 'ok', 'confluence create_comment: status')
    equal(requests[0].url, `${BASE}/api/v2/footer-comments`, 'confluence create_comment: endpoint')
    equal(requests[0].init.method, 'POST', 'confluence create_comment: POST')
    const body = JSON.parse(requests[0].init.body)
    equal(body.pageId, '456', 'confluence create_comment: pageId')
    equal(body.body.representation, 'storage', 'confluence create_comment: storage representation')
    equal(body.body.value, '<p>Ship it</p>', 'confluence create_comment: body value')
    equal('parentCommentId' in body, false, 'confluence create_comment: no parent for a new comment')
    equal(result.data.comment.id, '901', 'confluence create_comment: mapped comment')
  }

  {
    const { page, requests } = pageWith(() => jsonResponse(commentJson))
    const result = await runTool(P, 'create_comment', {
      input: { parent_comment_id: '900', body: '<p>Reply</p>' },
      page,
    })
    equal(result.status, 'ok', 'confluence create_comment (reply): status')
    const body = JSON.parse(requests[0].init.body)
    equal(body.parentCommentId, '900', 'confluence create_comment: parentCommentId')
    equal('pageId' in body, false, 'confluence create_comment: no pageId for a reply')
  }

  {
    const { page, requests } = pageWith(() => jsonResponse(commentJson))
    const result = await runTool(P, 'create_comment', {
      input: { page_id: '456', parent_comment_id: '900', body: '<p>both</p>' },
      page,
    })
    equal(result.status, 'error', 'confluence create_comment: rejects both ids')
    equal(result.error_code, 'VALIDATION', 'confluence create_comment: VALIDATION code')
    equal(requests.length, 0, 'confluence create_comment: no request when both ids given')
  }

  {
    const { page, requests } = pageWith(() =>
      jsonResponse({
        id: '902',
        pageId: '456',
        status: 'current',
        resolutionStatus: 'open',
        version: { authorId: 'acc-1', createdAt: '2026-04-01T00:00:00.000Z' },
        body: { storage: { value: '<p>needs clarification</p>' } },
        properties: { inlineOriginalSelection: 'scope', inlineMarkerRef: 'ref-7' },
      }),
    )
    const result = await runTool(P, 'create_inline_comment', {
      input: {
        page_id: '456',
        body: '<p>needs clarification</p>',
        text_selection: 'scope',
        text_selection_match_count: 3,
        text_selection_match_index: 1,
      },
      page,
    })
    equal(result.status, 'ok', 'confluence create_inline_comment: status')
    equal(requests[0].url, `${BASE}/api/v2/inline-comments`, 'confluence create_inline_comment: endpoint')
    const body = JSON.parse(requests[0].init.body)
    equal(body.inlineCommentProperties.textSelection, 'scope', 'confluence inline: text selection')
    equal(body.inlineCommentProperties.textSelectionMatchCount, 3, 'confluence inline: match count is a number')
    equal(body.inlineCommentProperties.textSelectionMatchIndex, 1, 'confluence inline: match index')
    equal(result.data.comment.text_selection, 'scope', 'confluence inline: anchored text returned')
  }

  {
    const { page, requests } = pageWith(() => jsonResponse({}, 204))
    const result = await runTool(P, 'delete_comment', { input: { comment_id: '900' }, page })
    equal(requests[0].url, `${BASE}/api/v2/footer-comments/900`, 'confluence delete_comment: endpoint')
    equal(result.data.deleted, true, 'confluence delete_comment: deleted flag')
  }

  // --- labels (v1 base for writes) ---------------------------------------
  {
    const { page, requests } = pageWith(() =>
      jsonResponse({ results: [{ id: 'l1', name: 'design', prefix: 'global' }] }),
    )
    const result = await runTool(P, 'list_labels', { input: { page_id: '456' }, page })
    equal(requests[0].url, `${BASE}/api/v2/pages/456/labels?limit=25`, 'confluence list_labels: endpoint')
    equal(result.data.labels[0].prefix, 'global', 'confluence list_labels: prefix')
  }

  {
    const { page, requests } = pageWith(() =>
      jsonResponse({ results: [{ id: 'l2', name: 'meeting-notes', prefix: 'global' }] }),
    )
    const result = await runTool(P, 'add_label', {
      input: { page_id: '456', label: 'meeting-notes' },
      page,
    })
    equal(result.status, 'ok', 'confluence add_label: status')
    equal(requests[0].url, `${BASE}/rest/api/content/456/label`, 'confluence add_label: v1 endpoint')
    equal(requests[0].init.method, 'POST', 'confluence add_label: POST')
    const body = JSON.parse(requests[0].init.body)
    equal(Array.isArray(body), true, 'confluence add_label: array body')
    equal(body[0].prefix, 'global', 'confluence add_label: prefix global')
    equal(body[0].name, 'meeting-notes', 'confluence add_label: label name')
    equal(result.data.labels[0].name, 'meeting-notes', 'confluence add_label: labels returned')
  }

  {
    const { page, requests } = pageWith(() => jsonResponse({}, 204))
    const result = await runTool(P, 'remove_label', {
      input: { page_id: '456', label_name: 'e2e-test' },
      page,
    })
    equal(result.status, 'ok', 'confluence remove_label: status')
    equal(
      requests[0].url,
      `${BASE}/rest/api/content/456/label?name=e2e-test`,
      'confluence remove_label: DELETE with name query',
    )
    equal(requests[0].init.method, 'DELETE', 'confluence remove_label: DELETE')
    equal(result.data.removed, true, 'confluence remove_label: removed flag')
  }

  // --- user profile -------------------------------------------------------
  {
    const { page, requests } = pageWith(() =>
      jsonResponse({
        accountId: '5b10ac8d82e05b22cc7d4ef5',
        displayName: 'Ada Lovelace',
        publicName: 'ada',
        email: 'ada@example.com',
        accountType: 'atlassian',
        accountStatus: 'active',
        profilePicture: { path: '/wiki/aa-avatar/acc-1' },
      }),
    )
    const result = await runTool(P, 'get_user_profile', { input: {}, page })
    equal(result.status, 'ok', 'confluence get_user_profile: status')
    equal(
      requests[0].url,
      `${BASE}/rest/api/user?accountId=5b10ac8d82e05b22cc7d4ef5`,
      'confluence get_user_profile: current account from page meta',
    )
    equal(result.data.user.display_name, 'Ada Lovelace', 'confluence profile: display name')
    equal(result.data.user.avatar_url, '/wiki/aa-avatar/acc-1', 'confluence profile: avatar path')
  }

  // --- failures -----------------------------------------------------------
  section('execution: Confluence failure paths')

  {
    const { page, requests } = pageWith(() => jsonResponse({}, 401))
    const result = await runTool(P, 'list_spaces', { input: {}, page })
    equal(result.status, 'error', 'confluence list_spaces: 401 is an error')
    equal(result.error_code, 'AUTH', 'confluence list_spaces: 401 → AUTH')
    equal(requests.length, 1, 'confluence list_spaces: 401 made one request')
  }

  {
    const { page, requests } = pageWith(() =>
      jsonResponse({ statusCode: 401, message: 'Current user not permitted to use Confluence' }, 401),
    )
    const result = await runTool(P, 'get_page', { input: { page_id: '456' }, page })
    equal(result.error_code, 'AUTH', 'confluence auth failure: AUTH code')
    equal(
      result.message.includes('Current user not permitted to use Confluence'),
      true,
      'confluence auth failure: upstream message surfaced',
    )
    equal(requests.length, 1, 'confluence auth failure: one request')
  }

  {
    // No ajs-* meta tags: the page is logged out, so nothing is fetched.
    const { page, requests } = pageWith(() => jsonResponse({}), { meta: {} })
    const result = await runTool(P, 'search', { input: { cql: 'type=page' }, page })
    equal(result.status, 'error', 'confluence logged-out page: error')
    equal(result.error_code, 'UNAUTHENTICATED', 'confluence logged-out page: UNAUTHENTICATED')
    equal(requests.length, 0, 'confluence logged-out page: no request')
  }

  {
    const { page } = pageWith(() => jsonResponse({}))
    const result = await runTool(P, 'list_spaces', { input: {}, page })
    equal(result.status, 'ok', 'confluence list_spaces: sanity check on the happy fixture')
  }

  {
    const { page, requests } = pageWith(() => jsonResponse({}, 404))
    const result = await runTool(P, 'get_page', { input: { page_id: 'nope' }, page })
    equal(result.error_code, 'NOT_FOUND', 'confluence get_page: 404 → NOT_FOUND')
    equal(requests.length, 1, 'confluence get_page: 404 made one request')
  }

  {
    const { page, requests } = pageWith(() => jsonResponse({ message: 'Rate limited' }, 429))
    const result = await runTool(P, 'list_pages', { input: {}, page })
    equal(result.error_code, 'RATE_LIMITED', 'confluence list_pages: 429 → RATE_LIMITED')
    equal(result.message.includes('Retry-After: 30'), true, 'confluence rate limit: retry-after hint')
    equal(requests.length, 1, 'confluence list_pages: 429 made one request')
  }

  {
    // A Jira page on the same site must not run Confluence tools.
    const { page, requests } = pageWith(() => jsonResponse({}), {
      href: `${SITE}/jira/software/c/projects/SD/boards`,
    })
    const result = await runTool(P, 'list_spaces', { input: {}, page })
    equal(result.error_code, 'UNSUPPORTED_PAGE', 'confluence on a Jira path: UNSUPPORTED_PAGE')
    equal(requests.length, 0, 'confluence on a Jira path: no request')
  }
}
