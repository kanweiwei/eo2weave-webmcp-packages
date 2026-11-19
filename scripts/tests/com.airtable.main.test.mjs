/**
 * Execution tests for com.airtable.main.
 *
 * The Airtable port talks to the web client's own /v0.3 API from inside the
 * airtable.com tab: auth is window.initData (sessionUserId + csrfToken), reads
 * are GETs with a `stringifiedObjectParams` query, writes are POSTs with the same
 * params JSON plus `_csrf` in the body. Every test stubs fetch, asserts the
 * request the runtime actually makes (URL, method, headers, body) and the parsed
 * output.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

const HOST = 'airtable.com'
const AUTH = { sessionUserId: 'usrABC123', csrfToken: 'csrf-xyz' }

function jsonResponse(payload, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name] ?? null },
    async text() {
      return JSON.stringify(payload)
    },
    async json() {
      return payload
    },
  }
}

function textResponse(body, status) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    async text() {
      return body
    },
  }
}

function emptyResponse(status) {
  return {
    ok: true,
    status,
    headers: { get: () => null },
    async text() {
      return ''
    },
  }
}

/** A stubbed airtable.com tab that records every request. */
function airtablePage(handler, { globals = { initData: AUTH }, hostname = HOST } = {}) {
  const requests = []
  const page = {
    hostname,
    href: `https://${hostname}/app1/tbl1/viw1`,
    globals,
    fetch: async (url, init = {}) => {
      requests.push({ url: String(url), init })
      return handler(String(url), init)
    },
  }
  return { requests, page }
}

function query(url) {
  return new URL(url).searchParams
}

export default async function register({ ok, equal, section, runTool, packagesDir }) {
  const manifest = JSON.parse(
    readFileSync(path.join(packagesDir, 'com.airtable.main', 'manifest.json'), 'utf8'),
  )

  // --- urlRegex probe: airtable.com ------------------------------------------

  section('urlRegex probe: airtable.com')

  {
    const mustMatch = [
      'https://airtable.com/',
      'https://airtable.com/app1/tbl1/viw1',
      'https://airtable.com/app1/tbl1/viw1?blocks=hide',
      'https://airtable.com/app1/tbl1/viw1#modal',
      'https://airtable.com/app1/tbl1/viw1?blocks=hide#modal',
      'https://airtable.com/invite/l?inviteId=inv1&inviteToken=tok',
      'https://airtable.com/shrABC/tbl1/viw1',
    ]
    const mustNotMatch = [
      'http://airtable.com/app1/tbl1',
      'https://evildomain.com/airtable.com/app1',
      'https://notairtable.com/app1/tbl1',
      'https://airtable.com.evil.example/app1/tbl1',
      'https://airtable.com:8443/app1/tbl1',
      'https://airtableXcom/app1/tbl1',
      'ftp://airtable.com/app1/tbl1',
    ]
    for (const tool of manifest.tools) {
      const regex = new RegExp(tool.urlRegex)
      for (const url of mustMatch) ok(regex.test(url), `airtable urlRegex matches ${url} (${tool.name})`)
      for (const url of mustNotMatch)
        ok(!regex.test(url), `airtable urlRegex rejects ${url} (${tool.name})`)
    }
  }

  // --- execution -------------------------------------------------------------

  section('execution: Airtable tools against a stubbed page')

  {
    // list_workspaces: no appId header, empty params, workspace/base mapping.
    const { requests, page } = airtablePage(() =>
      jsonResponse({
        data: {
          workspaceRecordById: {
            wsp1: {
              id: 'wsp1',
              name: 'Acme HQ',
              sharedWithCurrentUser: { directPermissionLevel: 'owner' },
              visibleApplicationOrder: ['app1', 'app2'],
            },
            wsp2: { id: 'wsp2', name: 'Personal' },
          },
          applicationRecordById: {
            app1: {
              id: 'app1',
              name: 'Roadmap',
              color: 'blue',
              currentUserEffectivePermissionLevel: 'editor',
            },
          },
        },
      }),
    )
    const result = await runTool('com.airtable.main', 'list_workspaces', { input: {}, page })
    equal(result.status, 'ok', 'airtable list_workspaces: status')
    equal(result.message, null, 'airtable list_workspaces: null message on success')
    equal(result.data.workspaces.length, 2, 'airtable list_workspaces: workspace count')
    equal(result.data.workspaces[0].id, 'wsp1', 'airtable list_workspaces: workspace id')
    equal(result.data.workspaces[0].name, 'Acme HQ', 'airtable list_workspaces: workspace name')
    equal(
      result.data.workspaces[0].permission_level,
      'owner',
      'airtable list_workspaces: direct permission level',
    )
    equal(result.data.workspaces[0].base_count, 2, 'airtable list_workspaces: base count')
    equal(
      result.data.workspaces[1].permission_level,
      '',
      'airtable list_workspaces: missing permission falls back to empty string',
    )
    equal(result.data.workspaces[1].base_count, 0, 'airtable list_workspaces: missing order is 0')
    equal(result.data.bases[0].id, 'app1', 'airtable list_workspaces: base id')
    equal(
      result.data.bases[0].permission_level,
      'editor',
      'airtable list_workspaces: effective permission level',
    )
    ok(
      requests[0].url.startsWith(
        'https://airtable.com/v0.3/user/usrABC123/listApplicationsAndPageBundlesForDisplay?',
      ),
      'airtable list_workspaces: reads the user-scoped workspace endpoint',
    )
    equal(query(requests[0].url).get('stringifiedObjectParams'), '{}', 'airtable list_workspaces: empty params')
    ok(
      /^req[a-z0-9]{8}$/.test(query(requests[0].url).get('requestId')),
      'airtable list_workspaces: requestId shape',
    )
    equal(requests[0].init.method, 'GET', 'airtable list_workspaces: GET')
    equal(requests[0].init.credentials, 'include', 'airtable list_workspaces: sends cookies')
    equal(
      requests[0].init.headers['x-airtable-inter-service-client'],
      'webClient',
      'airtable list_workspaces: web-client header',
    )
    equal(
      requests[0].init.headers['x-requested-with'],
      'XMLHttpRequest',
      'airtable list_workspaces: xhr header',
    )
    ok(
      typeof requests[0].init.headers['x-time-zone'] === 'string' &&
        requests[0].init.headers['x-time-zone'].length > 0,
      'airtable list_workspaces: timezone header',
    )
    ok(
      !('x-airtable-application-id' in requests[0].init.headers),
      'airtable list_workspaces: no application header without a base',
    )
    equal(requests[0].init.body, undefined, 'airtable list_workspaces: GET has no body')
  }

  {
    // get_base_schema: the schema read carries the base as x-airtable-application-id
    // and the upstream params verbatim.
    const { requests, page } = airtablePage(() =>
      jsonResponse({
        data: {
          tableSchemas: [
            {
              id: 'tbl1',
              name: 'Tasks',
              columns: [
                {
                  id: 'fldA',
                  name: 'Status',
                  type: 'select',
                  description: 'Where the task stands',
                  typeOptions: {
                    choices: {
                      sel1: { id: 'sel1', name: 'Todo', color: 'grayLight2' },
                      sel2: { id: 'sel2', name: 'Done', color: 'greenLight2' },
                    },
                    choiceOrder: ['sel1', 'sel2'],
                  },
                },
                { id: 'fldB', name: 'Notes', type: 'multilineText' },
              ],
              views: [{ id: 'viw1', name: 'Grid view', type: 'grid' }],
            },
          ],
        },
      }),
    )
    const result = await runTool('com.airtable.main', 'get_base_schema', {
      input: { base_id: 'app1' },
      page,
    })
    equal(result.status, 'ok', 'airtable get_base_schema: status')
    equal(result.data.tables.length, 1, 'airtable get_base_schema: table count')
    equal(result.data.tables[0].id, 'tbl1', 'airtable get_base_schema: table id')
    equal(result.data.tables[0].name, 'Tasks', 'airtable get_base_schema: table name')
    equal(result.data.tables[0].fields.length, 2, 'airtable get_base_schema: field count')
    equal(result.data.tables[0].fields[0].id, 'fldA', 'airtable get_base_schema: field id')
    equal(result.data.tables[0].fields[0].type, 'select', 'airtable get_base_schema: field type')
    equal(
      result.data.tables[0].fields[0].description,
      'Where the task stands',
      'airtable get_base_schema: field description',
    )
    equal(
      result.data.tables[0].fields[1].description,
      '',
      'airtable get_base_schema: missing description is empty',
    )
    equal(result.data.tables[0].views[0].id, 'viw1', 'airtable get_base_schema: view id')
    equal(result.data.tables[0].views[0].type, 'grid', 'airtable get_base_schema: view type')
    ok(
      requests[0].url.startsWith('https://airtable.com/v0.3/application/app1/read?'),
      'airtable get_base_schema: base read endpoint',
    )
    equal(
      query(requests[0].url).get('stringifiedObjectParams'),
      '{"includeDataForTableIds":[],"shouldIncludeSchemaChecksum":false,"mayOnlyIncludeRowAndCellDataForIncludedViews":true,"allowMsgpackOfResult":false}',
      'airtable get_base_schema: schema-only params',
    )
    equal(
      requests[0].init.headers['x-airtable-application-id'],
      'app1',
      'airtable get_base_schema: application header',
    )
  }

  {
    // list_records: row data for one table, cells keyed by field id, and the
    // tableDatas lookup honouring both the `id` and `tableId` shapes.
    const { requests, page } = airtablePage(() =>
      jsonResponse({
        data: {
          tableDatas: [
            {
              tableId: 'tbl9',
              rows: [{ id: 'recX', createdTime: '2026-11-01T00:00:00.000Z', cellValuesByColumnId: {} }],
            },
            {
              id: 'tbl1',
              rows: [
                {
                  id: 'rec1',
                  createdTime: '2026-11-17T08:00:00.000Z',
                  cellValuesByColumnId: { fldA: { id: 'sel1' }, fldB: 'Write the port' },
                },
                { id: 'rec2', createdTime: '2026-11-18T09:30:00.000Z' },
              ],
            },
          ],
        },
      }),
    )
    const result = await runTool('com.airtable.main', 'list_records', {
      input: { base_id: 'app1', table_id: 'tbl1' },
      page,
    })
    equal(result.status, 'ok', 'airtable list_records: status')
    equal(result.data.records.length, 2, 'airtable list_records: only the requested table')
    equal(result.data.records[0].id, 'rec1', 'airtable list_records: record id')
    equal(
      result.data.records[0].created_time,
      '2026-11-17T08:00:00.000Z',
      'airtable list_records: created time',
    )
    equal(
      result.data.records[0].cell_values.fldB,
      'Write the port',
      'airtable list_records: cell keyed by field id',
    )
    equal(result.data.records[0].cell_values.fldA.id, 'sel1', 'airtable list_records: select cell')
    equal(
      JSON.stringify(result.data.records[1].cell_values),
      '{}',
      'airtable list_records: missing cells become an empty object',
    )
    equal(
      query(requests[0].url).get('stringifiedObjectParams'),
      '{"includeDataForTableIds":["tbl1"],"shouldIncludeSchemaChecksum":false,"mayOnlyIncludeRowAndCellDataForIncludedViews":false,"allowMsgpackOfResult":false}',
      'airtable list_records: row-data params',
    )
    equal(
      requests[0].init.headers['x-airtable-application-id'],
      'app1',
      'airtable list_records: application header',
    )
  }

  {
    // get_record: same read, narrowed to one row in page context.
    const { requests, page } = airtablePage(() =>
      jsonResponse({
        data: {
          tableDatas: [
            {
              id: 'tbl1',
              rows: [
                { id: 'rec1', createdTime: '2026-11-17T08:00:00.000Z', cellValuesByColumnId: { fldB: 'A' } },
                { id: 'rec2', createdTime: '2026-11-18T09:30:00.000Z', cellValuesByColumnId: { fldB: 'B' } },
              ],
            },
          ],
        },
      }),
    )
    const result = await runTool('com.airtable.main', 'get_record', {
      input: { base_id: 'app1', table_id: 'tbl1', record_id: 'rec2' },
      page,
    })
    equal(result.status, 'ok', 'airtable get_record: status')
    equal(result.data.record.id, 'rec2', 'airtable get_record: requested record')
    equal(result.data.record.cell_values.fldB, 'B', 'airtable get_record: cells')
    equal(requests.length, 1, 'airtable get_record: one read')

    // A record that is not in the table is NOT_FOUND, not an empty record.
    const missing = await runTool('com.airtable.main', 'get_record', {
      input: { base_id: 'app1', table_id: 'tbl1', record_id: 'rec404' },
      page: airtablePage(() => jsonResponse({ data: { tableDatas: [] } })).page,
    })
    equal(missing.status, 'error', 'airtable get_record missing: error status')
    equal(missing.error_code, 'NOT_FOUND', 'airtable get_record missing: NOT_FOUND')
    ok(
      String(missing.message).includes('rec404'),
      'airtable get_record missing: names the record',
    )
  }

  {
    // get_field_choices: choices follow choiceOrder, not the choices map order.
    const schemaResponse = () =>
      jsonResponse({
        data: {
          tableSchemas: [
            {
              id: 'tbl1',
              name: 'Tasks',
              columns: [
                {
                  id: 'fldA',
                  name: 'Status',
                  type: 'multiSelect',
                  typeOptions: {
                    choices: {
                      sel2: { id: 'sel2', name: 'Done', color: 'greenLight2' },
                      sel1: { id: 'sel1', name: 'Todo', color: 'grayLight2' },
                    },
                    choiceOrder: ['sel1', 'sel2'],
                  },
                },
                { id: 'fldB', name: 'Notes', type: 'multilineText' },
              ],
              views: [],
            },
          ],
        },
      })

    const { requests, page } = airtablePage(schemaResponse)
    const result = await runTool('com.airtable.main', 'get_field_choices', {
      input: { base_id: 'app1', table_id: 'tbl1', field_id: 'fldA' },
      page,
    })
    equal(result.status, 'ok', 'airtable get_field_choices: status')
    equal(result.data.choices.length, 2, 'airtable get_field_choices: choice count')
    equal(result.data.choices[0].id, 'sel1', 'airtable get_field_choices: choice order')
    equal(result.data.choices[0].name, 'Todo', 'airtable get_field_choices: choice name')
    equal(result.data.choices[1].color, 'greenLight2', 'airtable get_field_choices: choice color')
    equal(
      query(requests[0].url).get('stringifiedObjectParams'),
      '{"includeDataForTableIds":[],"shouldIncludeSchemaChecksum":false,"mayOnlyIncludeRowAndCellDataForIncludedViews":true,"allowMsgpackOfResult":false}',
      'airtable get_field_choices: schema-only params',
    )

    // A non-select field is a caller mistake: VALIDATION, no second request.
    const wrongType = await runTool('com.airtable.main', 'get_field_choices', {
      input: { base_id: 'app1', table_id: 'tbl1', field_id: 'fldB' },
      page: airtablePage(schemaResponse).page,
    })
    equal(wrongType.status, 'error', 'airtable get_field_choices non-select: error status')
    equal(wrongType.error_code, 'VALIDATION', 'airtable get_field_choices non-select: VALIDATION')
    ok(
      String(wrongType.message).includes('not a select field'),
      'airtable get_field_choices non-select: explains the field type',
    )

    // Unknown table / field are NOT_FOUND.
    const noTable = await runTool('com.airtable.main', 'get_field_choices', {
      input: { base_id: 'app1', table_id: 'tbl404', field_id: 'fldA' },
      page: airtablePage(schemaResponse).page,
    })
    equal(noTable.error_code, 'NOT_FOUND', 'airtable get_field_choices unknown table: NOT_FOUND')

    const noField = await runTool('com.airtable.main', 'get_field_choices', {
      input: { base_id: 'app1', table_id: 'tbl1', field_id: 'fld404' },
      page: airtablePage(schemaResponse).page,
    })
    equal(noField.error_code, 'NOT_FOUND', 'airtable get_field_choices unknown field: NOT_FOUND')
  }

  {
    // update_cell: POST with the params JSON and the page csrf token in the body.
    const { requests, page } = airtablePage(() => jsonResponse({ data: {} }))
    const result = await runTool('com.airtable.main', 'update_cell', {
      input: {
        base_id: 'app1',
        table_id: 'tbl1',
        record_id: 'rec1',
        field_id: 'fldA',
        value: { id: 'sel2' },
      },
      page,
    })
    equal(result.status, 'ok', 'airtable update_cell: status')
    equal(result.data.success, true, 'airtable update_cell: success flag')
    equal(
      requests[0].url,
      'https://airtable.com/v0.3/row/rec1/updatePrimitiveCell',
      'airtable update_cell: endpoint has no query string',
    )
    equal(requests[0].init.method, 'POST', 'airtable update_cell: POST')
    equal(requests[0].init.credentials, 'include', 'airtable update_cell: sends cookies')
    equal(
      requests[0].init.headers['Content-Type'],
      'application/json',
      'airtable update_cell: JSON body',
    )
    equal(
      requests[0].init.headers['x-airtable-application-id'],
      'app1',
      'airtable update_cell: application header',
    )
    const body = JSON.parse(requests[0].init.body)
    equal(
      body.stringifiedObjectParams,
      '{"tableId":"tbl1","rowId":"rec1","columnId":"fldA","cellValue":{"id":"sel2"}}',
      'airtable update_cell: cell params',
    )
    equal(body._csrf, 'csrf-xyz', 'airtable update_cell: csrf token from initData')
    ok(/^req[a-z0-9]{8}$/.test(body.requestId), 'airtable update_cell: requestId shape')
  }

  {
    // create_comment: POST, and a 204 answer still counts as success.
    const { requests, page } = airtablePage(() => emptyResponse(204))
    const result = await runTool('com.airtable.main', 'create_comment', {
      input: { base_id: 'app1', table_id: 'tbl1', record_id: 'rec1', text: 'Nice work' },
      page,
    })
    equal(result.status, 'ok', 'airtable create_comment: status')
    equal(result.data.success, true, 'airtable create_comment: success flag on 204')
    equal(
      requests[0].url,
      'https://airtable.com/v0.3/row/rec1/createRowComment',
      'airtable create_comment: endpoint',
    )
    equal(requests[0].init.method, 'POST', 'airtable create_comment: POST')
    const body = JSON.parse(requests[0].init.body)
    equal(
      body.stringifiedObjectParams,
      '{"tableId":"tbl1","text":"Nice work"}',
      'airtable create_comment: comment params',
    )
    equal(body._csrf, 'csrf-xyz', 'airtable create_comment: csrf token')

    // update_cell on a 204 as well (the web client answers some writes empty).
    const update = await runTool('com.airtable.main', 'update_cell', {
      input: { base_id: 'app1', table_id: 'tbl1', record_id: 'rec1', field_id: 'fldB', value: 'x' },
      page: airtablePage(() => emptyResponse(204)).page,
    })
    equal(update.status, 'ok', 'airtable update_cell 204: status')
    equal(update.data.success, true, 'airtable update_cell 204: success flag')
  }

  {
    // get_record_activity: activities and comments interleaved by the ordered id
    // list, HTML stripped from the change summary.
    const { requests, page } = airtablePage(() =>
      jsonResponse({
        data: {
          orderedActivityAndCommentIds: ['act1', 'cmt1', 'act2'],
          rowActivityOrCommentUserObjById: {
            usr1: { name: 'Ada Lovelace' },
            usr2: { name: 'Grace Hopper' },
          },
          rowActivityInfoById: {
            act1: {
              groupType: 'cellUpdate',
              originatingUserId: 'usr1',
              createdTime: '2026-11-18T09:00:00.000Z',
              diffRowHtml: '<span>Name</span> changed to <b>Roadmap</b>',
            },
            act2: {
              groupType: 'rowCreated',
              originatingUserId: 'usr2',
              createdTime: '2026-11-17T08:00:00.000Z',
            },
          },
          commentsById: {
            cmt1: { userId: 'usr2', text: 'Looks good', createdTime: '2026-11-18T10:00:00.000Z' },
          },
        },
      }),
    )
    const result = await runTool('com.airtable.main', 'get_record_activity', {
      input: { base_id: 'app1', table_id: 'tbl1', record_id: 'rec1' },
      page,
    })
    equal(result.status, 'ok', 'airtable get_record_activity: status')
    equal(result.data.activities.length, 2, 'airtable get_record_activity: activity count')
    equal(result.data.activities[0].id, 'act1', 'airtable get_record_activity: activity order')
    equal(result.data.activities[0].type, 'cellUpdate', 'airtable get_record_activity: activity type')
    equal(result.data.activities[0].user_name, 'Ada Lovelace', 'airtable get_record_activity: user')
    equal(
      result.data.activities[0].description,
      'Name changed to Roadmap',
      'airtable get_record_activity: html stripped from the diff',
    )
    equal(
      result.data.activities[1].description,
      '',
      'airtable get_record_activity: missing diff is empty',
    )
    equal(result.data.comments.length, 1, 'airtable get_record_activity: comment count')
    equal(
      result.data.comments[0].author_name,
      'Grace Hopper',
      'airtable get_record_activity: comment author',
    )
    equal(result.data.comments[0].text, 'Looks good', 'airtable get_record_activity: comment text')
    ok(
      requests[0].url.startsWith('https://airtable.com/v0.3/row/rec1/readRowActivitiesAndComments?'),
      'airtable get_record_activity: activity endpoint',
    )
    equal(
      query(requests[0].url).get('stringifiedObjectParams'),
      '{"tableId":"tbl1"}',
      'airtable get_record_activity: table param',
    )
  }

  // --- auth + failure paths --------------------------------------------------

  section('execution: Airtable auth and error paths')

  {
    // No initData: AUTH before any request leaves the tab.
    for (const globals of [{}, { initData: { sessionUserId: 'usr1' } }, { initData: { sessionUserId: 'usrPAGESHAREabc', csrfToken: 't' } }]) {
      const { requests, page } = airtablePage(() => jsonResponse({}), { globals })
      const result = await runTool('com.airtable.main', 'get_base_schema', {
        input: { base_id: 'app1' },
        page,
      })
      equal(result.status, 'error', `airtable logged-out (${JSON.stringify(globals)}): error status`)
      equal(result.error_code, 'AUTH', `airtable logged-out (${JSON.stringify(globals)}): AUTH`)
      equal(requests.length, 0, `airtable logged-out (${JSON.stringify(globals)}): makes no request`)
    }

    // A share-page visitor has no userId: list_workspaces is AUTH and silent.
    const share = airtablePage(() => jsonResponse({}), {
      globals: { initData: { sessionUserId: 'usrPAGESHARE1', csrfToken: 'csrf' } },
    })
    const shareResult = await runTool('com.airtable.main', 'list_workspaces', {
      input: {},
      page: share.page,
    })
    equal(shareResult.error_code, 'AUTH', 'airtable share-page visitor: AUTH')
    equal(share.requests.length, 0, 'airtable share-page visitor: makes no request')

    // 401 from the web client is AUTH and keeps the server text.
    const unauthorized = await runTool('com.airtable.main', 'list_records', {
      input: { base_id: 'app1', table_id: 'tbl1' },
      page: airtablePage(() => textResponse('{"error":"AUTHENTICATION_REQUIRED"}', 401)).page,
    })
    equal(unauthorized.error_code, 'AUTH', 'airtable 401: AUTH')
    ok(String(unauthorized.message).includes('AUTHENTICATION_REQUIRED'), 'airtable 401: server text')

    // 403 is auth unless the body says INVALID_PERMISSIONS, which is VALIDATION.
    const forbidden = await runTool('com.airtable.main', 'get_base_schema', {
      input: { base_id: 'app1' },
      page: airtablePage(() => textResponse('{"error":"INVALID_PERMISSIONS"}', 403)).page,
    })
    equal(forbidden.error_code, 'VALIDATION', 'airtable 403 INVALID_PERMISSIONS: VALIDATION')

    const forbiddenAuth = await runTool('com.airtable.main', 'get_base_schema', {
      input: { base_id: 'app1' },
      page: airtablePage(() => textResponse('<html>login</html>', 403)).page,
    })
    equal(forbiddenAuth.error_code, 'AUTH', 'airtable 403 without permissions body: AUTH')

    // 404 / 422 / 429 keep their classifications; Retry-After is surfaced.
    const notFound = await runTool('com.airtable.main', 'get_base_schema', {
      input: { base_id: 'app404' },
      page: airtablePage(() => textResponse('{"error":"NOT_FOUND"}', 404)).page,
    })
    equal(notFound.error_code, 'NOT_FOUND', 'airtable 404: NOT_FOUND')

    const invalid = await runTool('com.airtable.main', 'update_cell', {
      input: { base_id: 'app1', table_id: 'tbl1', record_id: 'rec1', field_id: 'fldA', value: 'x' },
      page: airtablePage(() => textResponse('{"error":"INVALID_CELL_VALUE"}', 422)).page,
    })
    equal(invalid.error_code, 'VALIDATION', 'airtable 422: VALIDATION')

    const limited = await runTool('com.airtable.main', 'list_workspaces', {
      input: {},
      page: airtablePage(() => jsonResponse({}, 429, { 'Retry-After': '2' })).page,
    })
    equal(limited.error_code, 'RATE_LIMITED', 'airtable 429: RATE_LIMITED')
    ok(String(limited.message).includes('2000ms'), 'airtable 429: parses Retry-After')

    // A JSON-level error object is classified too.
    const jsonError = await runTool('com.airtable.main', 'update_cell', {
      input: { base_id: 'app1', table_id: 'tbl1', record_id: 'rec1', field_id: 'fldA', value: 'x' },
      page: airtablePage(() =>
        jsonResponse({ error: { type: 'INVALID_REQUEST', message: 'cell value rejected' } }),
      ).page,
    })
    equal(jsonError.error_code, 'VALIDATION', 'airtable json INVALID_REQUEST: VALIDATION')
    ok(String(jsonError.message).includes('cell value rejected'), 'airtable json error: message')

    const jsonMissing = await runTool('com.airtable.main', 'get_base_schema', {
      input: { base_id: 'app404' },
      page: airtablePage(() =>
        jsonResponse({ error: { type: 'MODEL_ID_NOT_FOUND', message: 'no such base' } }),
      ).page,
    })
    equal(jsonMissing.error_code, 'NOT_FOUND', 'airtable json MODEL_ID_NOT_FOUND: NOT_FOUND')

    // A tab on another host is refused before any request.
    const wrongHost = airtablePage(() => jsonResponse({}), { hostname: 'example.com' })
    const offsite = await runTool('com.airtable.main', 'list_workspaces', {
      input: {},
      page: wrongHost.page,
    })
    equal(offsite.status, 'error', 'airtable wrong host: error status')
    equal(offsite.error_code, 'UNSUPPORTED_PAGE', 'airtable wrong host: UNSUPPORTED_PAGE')
    equal(wrongHost.requests.length, 0, 'airtable wrong host: makes no request')
  }
}
