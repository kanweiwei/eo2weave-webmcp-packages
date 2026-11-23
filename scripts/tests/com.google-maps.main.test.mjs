/**
 * com.google-maps.main — execution tests against a stubbed Google Maps tab.
 *
 * Maps works anonymously (HttpOnly session cookies only), so there is no
 * signed-out identity gate: page-state tools parse the @lat,lng,zoom URL
 * shape, and navigation tools assign `window.location.href` — the tests
 * assert the assigned URL value returned by the tool, never navigation.
 */

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    async text() {
      return JSON.stringify(payload)
    },
    async json() {
      return payload
    },
  }
}

function mapsPage(handler, extra = {}) {
  const requests = []
  const page = {
    hostname: 'www.google.com',
    href: 'https://www.google.com/maps/@37.7749,-122.4194,15z',
    fetch: async (url, init) => {
      requests.push({ url: String(url), init })
      return handler(String(url), init)
    },
    ...extra,
  }
  return { requests, page }
}

export default async function register({ ok, equal, section, runTool }) {
  section('com.google-maps.main: page-state reads')

  {
    const { requests, page } = mapsPage(() => jsonResponse({}))
    const result = await runTool('com.google-maps.main', 'get_current_view', { input: {}, page })
    if (result.status !== 'ok') console.log('MAPS VIEW', JSON.stringify(result).slice(0, 300))
    equal(result.status, 'ok', 'maps get_current_view: ok')
    equal(result.data.view.lat, 37.7749, 'maps get_current_view: lat from URL')
    equal(result.data.view.lng, -122.4194, 'maps get_current_view: lng from URL')
    equal(result.data.view.zoom, 15, 'maps get_current_view: zoom from URL')
    equal(result.data.view.url, 'https://www.google.com/maps/@37.7749,-122.4194,15z', 'maps: url passthrough')
    equal(requests.length, 0, 'maps get_current_view: no network requests')
  }

  {
    const { page } = mapsPage(() => jsonResponse({}))
    const result = await runTool('com.google-maps.main', 'get_directions_info', {
      input: {},
      page: { ...page, href: 'https://www.google.com/maps/dir/Hayward+Ferry/Alameda+Ferry/data=!4m2!4m1!3e1' },
    })
    equal(result.status, 'ok', 'maps get_directions_info: ok')
    equal(result.data.route.origin, 'Hayward Ferry', 'maps get_directions_info: origin decoded')
    equal(result.data.route.destination, 'Alameda Ferry', 'maps get_directions_info: destination decoded')
    equal(result.data.route.travel_mode, 'transit', 'maps get_directions_info: !3e1 → transit')
  }

  {
    const { requests, page } = mapsPage(() =>
      jsonResponse(
        ")]}'\n[[\"0x808f7c3:0xbe2c8f\", \"Ferry Building\"], [\"0x55:0x66\", \"Pier 39\"]]",
      ),
    )
    const result = await runTool('com.google-maps.main', 'search_places', {
      input: { query: 'coffee' },
      page,
    })
    if (result.status !== 'ok') console.log('MAPS SEARCH', JSON.stringify(result).slice(0, 300))
    equal(result.status, 'ok', 'maps search_places: ok')
    equal(result.data.query, 'coffee', 'maps search_places: query passthrough')
    equal(result.data.places.length, 2, 'maps search_places: place ids parsed')
    equal(result.data.places[0].place_id, '0x808f7c3:0xbe2c8f', 'maps search_places: hex id captured')
    equal(requests.length, 1, 'maps search_places: one request')
    ok(requests[0].url.startsWith('/search?'), 'maps search_places: same-origin /search path')
    ok(requests[0].url.includes('q=coffee'), 'maps search_places: query param')
    ok(requests[0].url.includes('pb='), 'maps search_places: pb viewport param')
  }

  {
    const { requests, page } = mapsPage(() => {
      const state = JSON.stringify([
        null,
        null,
        null,
        [")]}'\n[[null, \"Golden Gate Bridge\", [[null, -122.4783, 37.8199]], [null, null, 37.8199, -122.4783], [\"Golden Gate Bridge, Golden Gate Brg, San Francisco, CA 94129, United States\"], [\"Monument / landmark\"], null, null, null, [\"(415) 000-0000\", null, null, null, null, null, null, null, null, null, null, null], null, null, null, null, null, null, [\"https://www.goldengate.org/bridge/\"]]]"],
      ])
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'text/html' },
        async text() {
          return `<html><script>window.APP_INITIALIZATION_STATE=${state};window.x=1</script></html>`
        },
      }
    })
    const result = await runTool('com.google-maps.main', 'get_place_details', {
      input: { query: 'Golden Gate Bridge' },
      page,
    })
    if (result.status !== 'ok') console.log('MAPS PLACE', JSON.stringify(result).slice(0, 300))
    equal(result.status, 'ok', 'maps get_place_details: ok')
    equal(result.data.place.name, 'Golden Gate Bridge', 'maps get_place_details: name extracted')
    equal(result.data.place.lat, 37.8199, 'maps get_place_details: lat from viewport')
    equal(result.data.place.lng, -122.4783, 'maps get_place_details: lng from viewport')
    ok(requests[0].url.startsWith('/maps/place/Golden%20Gate%20Bridge'), 'maps: place page path')
  }

  section('com.google-maps.main: URL builders (pure)')

  {
    const { page } = mapsPage(() => jsonResponse({}))
    const result = await runTool('com.google-maps.main', 'get_map_url', {
      input: { type: 'location', lat: 1.5, lng: 2.5, zoom: 12 },
      page,
    })
    equal(result.status, 'ok', 'maps get_map_url: ok')
    equal(result.data.url, 'https://www.google.com/maps/@1.5,2.5,12z', 'maps get_map_url: location URL built')
  }

  {
    const { page } = mapsPage(() => jsonResponse({}))
    const result = await runTool('com.google-maps.main', 'get_directions_url', {
      input: { origin: 'A', destination: 'B', travel_mode: 'bicycling' },
      page,
    })
    equal(result.data.url.includes('/maps/dir/A/B/'), true, 'maps get_directions_url: path built')
    ok(result.data.url.includes('!3e3'), 'maps get_directions_url: bicycling mode code')
  }

  section('com.google-maps.main: navigation via window.location.href')

  {
    const { page } = mapsPage(() => jsonResponse({}))
    const result = await runTool('com.google-maps.main', 'navigate_to_location', {
      input: { lat: -33.8568, lng: 151.2153, zoom: 17 },
      page,
    })
    equal(result.status, 'ok', 'maps navigate_to_location: ok')
    equal(result.data.success, true, 'maps navigate_to_location: success flag')
    equal(
      result.data.url,
      'https://www.google.com/maps/@-33.8568,151.2153,17z',
      'maps navigate_to_location: assigned href value',
    )
  }

  {
    const { page } = mapsPage(() => jsonResponse({}))
    const result = await runTool('com.google-maps.main', 'navigate_to_search', {
      input: { query: 'ramen' },
      page,
    })
    equal(result.data.url, 'https://www.google.com/maps/search/ramen/@37.7749,-122.4194,15z', 'maps navigate_to_search: search href with current view')
  }

  {
    const { page } = mapsPage(() => jsonResponse({}))
    const result = await runTool('com.google-maps.main', 'zoom_map', { input: { zoom: 19 }, page })
    equal(result.data.url.includes('@37.7749,-122.4194,19z'), true, 'maps zoom_map: keeps center, new zoom')
  }

  {
    const { page } = mapsPage(() => jsonResponse({}))
    const result = await runTool('com.google-maps.main', 'toggle_layer', { input: { layer: 'traffic' }, page })
    equal(result.data.url.includes('!5m1!1e1'), true, 'maps toggle_layer: traffic layer code')
    equal(result.data.success, true, 'maps toggle_layer: success flag')
  }

  {
    const { page } = mapsPage(() => jsonResponse({}))
    const result = await runTool('com.google-maps.main', 'share_location', { input: {}, page })
    equal(result.status, 'ok', 'maps share_location: ok')
    equal(result.data.lat, 37.7749, 'maps share_location: center lat')
  }

  section('com.google-maps.main: wrong page')

  {
    const { page } = mapsPage(() => jsonResponse({}), {
      hostname: 'example.com',
      href: 'https://example.com/',
    })
    const result = await runTool('com.google-maps.main', 'get_current_view', { input: {}, page })
    equal(result.status, 'error', 'maps wrong host: error status')
    equal(result.error_code, 'UNSUPPORTED_PAGE', 'maps wrong host: UNSUPPORTED_PAGE')
  }
}
