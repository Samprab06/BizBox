# BizBox Insights frontend

The Insights panel reads the approved `SiteInsights` contract. It does not
recompute seed distributions, infer legacy bands, run models, or turn modeled
persona locations into sampled trip origins. Backend model/callout ownership stays
in `lib/insights`; station experiments are HAC-102. The manager coordinates the narrow city drawer
mount with HAC-77’s scene owner.

## Composition

- One weekday/weekend control selects real day data. Callouts show factual peak
  and quiet-hour values from the canonical helper, without a misleading hourly
  walk-away percentage or unsupported business advice.
- Demand/served/capacity, mean/p90 wait, balked/reneged, hourly/cumulative revenue,
  arrival mix/distance, and served-origin map use solid analysis cards. Each has
  a named chart, persistent summary, provenance and a readable data disclosure.
- The wait chart separates the mean, p5–p95 variation across seeds and mean
  within-seed p90. A p90 value is not a confidence bound or necessarily above the
  mean. Cumulative revenue bands arrive precomputed per seed, never summed from
  hourly quantiles. Capacity accounts for actual open minutes and identifies its
  station/service-time input provenance, including unknown values.
- Origin-map geometry and availability come from `servedOriginMap`. Authored
  fixture origins are explicitly synthetic. Missing live map inputs show the
  actual reason; no invented geography fills the gap.

## Boundaries

Frontend owns `components/insights`, site-page/site-screen/site-detail mounts,
Recharts package/lock entries, chart/browser tests and this document. The server
site page builds known fixture data and passes a typed prop, keeping engine code
out of the browser bundle. Live panels read the selected saved comparison and
validate project/site/profile identity; they never start inventory/model writes
or backfill old comparisons. `InsightsPanel` is exported for a city drawer. The proposed host is the existing
SimulatorDemo neighborhood controls slot for its selected site; no city scene or
parcel selection changes are included. Until the actual host is integrated and
verified, exported components alone do not satisfy city-drawer acceptance.

## Chart implementation and verification

Use exactly Recharts 3.10.1 and its required `react-is` peer at 19.3.1 to match
React 19.3.1. Recharts' installed README requires matching React/React-is versions;
pnpm initially reused an incompatible older transitive peer, so the explicit
matching pin is intentional. No other direct dependency is added. Its [ComposedChart](https://recharts.github.io/en-US/api/ComposedChart/)
supports combined series and keyboard accessibility. [Ranged areas](https://recharts.github.io/en-US/api/Area/)
accept the supplied lower/upper tuples; disable animation and preserve null gaps.
[ResponsiveContainer](https://recharts.github.io/en-US/api/ResponsiveContainer/)
tracks its parent size; supply explicit chart height and minimum width rules.
Use inherited paper/viewport tokens, persistent units and captions, and HTML
tables alongside charts. Do not rely on color or tooltips alone.

Verify both days, actual callout values, mean/p90 distinction, source/missing/stale
states, mobile 375 px, intermediate and desktop widths, keyboard chart/day/table
interaction, reduced motion, axe, console/network errors and both surface themes.
Run narrow checks first; manager serializes the final four repository checks.

Checkpoint verification: owned ESLint, TypeScript and all three server-rendered
component tests passed. Browser chart/theme/interaction checks and page mounts
remain pending at this component checkpoint; this is not full ticket acceptance.

## Site integration checkpoint

The server site page creates authored example data via `lib/insights/fixture` and
passes only typed aggregates through `SiteScreen` to `SiteDetail`. No client
imports that fixture builder or the simulation engine. Non-fixture sites mount a
GET-only `InsightsWorkspace` independently of inventory success: explicit saved
comparison links work without a local intake. The loader validates canonical
comparison, project, site, saved profile/version (when present), aggregate seed
count and synthetic source identity. It aborts abandoned reads, supports retry,
and retains an outdated-scenario warning. Legacy records without insights stay
unavailable; opening the page never evaluates or backfills data.

The initial browser audit found the dark header/callout area inheriting dark-theme
text over a transparent white parent. The panel now paints its local solid surface;
no global token changed. A separate collection failure from evaluation importing
fixture JSON was resolved by the backend's fixture-only module extraction, with
no Playwright loader change.

Narrow verification passed: owned ESLint, TypeScript, seven component/parser
checks, and seven Chromium browser cases. Browser cases exercise 375/768/1280 px,
weekday/weekend and revenue toggles, keyboard table/chart interaction, exact peak
callout values, saved/outdated/legacy/retry/profile states, reduced motion, serious
and critical axe violations, actual SVG tick contrast at least 4.5:1 and line contrast
at least 3:1 on both paper and viewport surfaces. At 375, panel width is 277px, each plot
235px and body width 375px with no horizontal overflow; at 1280, panel width 902px,
full plots 860px and paired plots 399px. Screenshots are in
`/tmp/hac94-evidence/` (`panel-375-paper.png`, `panel-375-viewport.png`,
`panel-1280-paper.png`, `panel-1280-viewport.png`, plus demand chart crops).

## City integration checkpoint

The actual `SimulatorDemo` neighborhood controls now open `InsightsDrawer`; the
existing no-imagery fallback card exposes the same action. No neighborhood or
scene implementation changed. The server forwards only the selected stored
site's validated aggregate; invalid or absent insights leave a valid saved scene
intact. The one-day simulator fixture explicitly reports unavailable rather than
borrowing the unrelated 12-seed authored example.

The native modal keeps the city inert, supports Close/Escape and focus return,
and pauses playback on open. Chart code loads only when a matching retained
aggregate is opened. The dialog repeats saved profile version and stale or
unknown-current-version qualifiers, including them in its accessible description;
those warnings remain visible while the outer page is inert.

Narrow checks passed: owned lint, TypeScript and 18 frontend/server-boundary tests.
Nine Chromium cases pass, including the actual city drawer at 375/1280 px with
imagery requests intercepted, keyboard/background-inert/focus-return behavior,
playback pause, unavailable provenance, axe and no model writes. Native Chrome
permits browser-chrome focus between its sole modal Close control; tests verify
that the modal remains active and background focus attempts are blocked rather
than asserting an artificial custom focus trap.

A console guard caught cross-engine floating-point differences in authored hex
projection during hydration. SVG coordinates now round to 0.001px; the unrounded
contract values remain unchanged. Fixture flows now assert no console or page
errors as well as no page overflow. City drawer screenshots are
`/tmp/hac94-evidence/city-drawer-{375,1280}-chromium.png`.

The final four checks and Chromium/WebKit/mobile matrix follow this checkpoint.
Without a local database seed, the stored-city server boundary is covered by
real seeded-record tests and modal warning markup tests; stored aggregates and
stale reads are browser-tested on the actual site detail route through canonical
GET fixtures. The city route browser tests cover its explicit example-unavailable
state and actual controls/fallback integration. No database, model, tile service,
or paid call is required for these tests.
