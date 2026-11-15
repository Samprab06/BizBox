# Candidate map sizing and style boundary (HAC-163)

The map keeps MapLibre's native container `ResizeObserver`. In the pinned
MapLibre 5.24.1 implementation, that observer deliberately skips its first delivery.
A map constructed while its shell is hidden measures zero width and uses MapLibre's
400px fallback. If the shell reveals it before that first delivery, the real width
is discarded and no further resize arrives. `CandidateMapCanvas` reconciles size
once in its existing `onLoad` callback, before fitting live coordinates. Subsequent
container changes and assistant focus/dock changes use the native observer; no
second observer, animation loop or window listener is added.

The canvas still requests the existing [OpenFreeMap Liberty style](https://tiles.openfreemap.org/styles/liberty).
A component-owned fetch prepares the style before handing it to MapLibre as an
object. The request is aborted on unmount; an HTTP, JSON or preparation failure uses
the existing map-unavailable/retry UI. CORS and network availability remain required
for the same public style host. There is no new provider, local style fork or live
inventory change.

The supplied style numerically compares optional `rank` and `ref_length` values in
its POI, country-label and road-shield filters. Missing or nonnumeric values generate
MapLibre worker warnings and fail those original filters. Preparation adds a numeric
type guard before each confirmed comparison, preserving valid values and the
original filter. Unknown values continue to omit the label. Only the named Liberty
layers with those comparisons are guarded; unrelated expressions remain untouched.
The building extrusion's direct `render_height` / `render_min_height` reads use the
renderer’s zero default for unknown values, preserving numeric heights.

Relative glyph, sprite and source resource URLs resolve against the fetched style's
response URL. Template placeholders remain intact, and already absolute URLs,
attribution, data and imagery are preserved. A changed upstream style with new
numeric operands needs a separate diagnosis; there is no generic expression rewrite
or console suppression.

## Verification

`components/map/map-style.test.ts` executes MapLibre's installed expression compiler
against unknown and valid numeric fields, checks extrusion defaults, input immutability,
attribution and resource/template URL resolution. It requires no WebGL or provider.

`tests/e2e/map.spec.ts` reproduces a hidden initial mount revealed before the first
native observer notification, then checks that the actual canvas matches the map
container through 400px/700px parent changes and an assistant focus/dock round trip
without a viewport resize. An offline style with sparse GeoJSON features exercises
the numeric boundaries through the real browser renderer and checks console output.
The remaining map cases cover selection, overlays, loading geometry, failure/retry,
canonical listings, unknown coordinates, keyboard and accessibility. Public tiles,
listing services and paid SDKs are mocked in browser verification.
