# Interior registry and API (HAC-96)

The lead approved fixture-first acceptance on 2026-11-14 in HAC-6 comment
`fc1d415a`: official public-demo metadata plus the tested offline adapter satisfies
HAC-96 before private access lands. Public-demo dimensions stay unknown. A genuine
geometry recording and the private zip adapter remain part of HAC-14 activation;
they do not block this approved ticket scope. No paid or authenticated vendor
request is required for this implementation or its checks.

`GET /api/sites/[siteId]/interior` returns a strict discriminated union from
`lib/contracts/interior.ts`:

| Kind        | Fields                                                                                |
| ----------- | ------------------------------------------------------------------------------------- |
| `scan`      | `modelId`, optional `showcaseParams: { sdkKey }`, optional `dimensions`, `provenance` |
| `floorplan` | `floorPlanUri`, `provenance`                                                          |
| `modeled`   | `provenance`                                                                          |

Unknown fields and contradictory branch fields are rejected. Geometry uses
meters, square feet for areas, and a Y-up coordinate frame. Floors and rooms
carry IDs, positive area and ordered bounds; rooms must fit their floor.
Dimensions have separate provenance. The local interior `origin` also supports
`matterport` for actual vendor-derived estimates; the global enum stays unchanged.
`provider` identifies `matterport`, `costar` or `modeled`, `mode` distinguishes
synthetic/recorded/live source paths, and `scope` distinguishes demo/space/property.
No global `matterport` origin or simulation capacity behavior is introduced.

## Offline examples

With `pnpm dev`, these paths work without database or vendor credentials:

```text
/api/sites/interior-fixture-scan/interior
/api/sites/interior-fixture-floorplan/interior
/api/sites/interior-fixture-modeled/interior
/api/sites/interior-public-demo/interior
```

The scan shape contains authored geometry and the invented, nonrenderable model
ID `Synthetic01`. It is **not** Matterport's public demo. The floor plan points to
an authored SVG served locally by the same route directory. Neither example is
licensed source material. Fixtures compile into the server; runtime does not
read files from disk. Unknown ordinary sites never fall back to demo content.

`interior-public-demo` returns `SxQL3iGyoDo`, the sample model published in the
[official Embed SDK guide](https://developers.matterport.com/embed-sdk/).
`lib/interior/__fixtures__/public-demo.json` captures only that published metadata,
its source URL and retrieval time. Provenance says `public`, `recorded`, `demo`
and explicitly identifies a documentation-metadata capture, **not** a recorded
Model API response. No rooms, areas, bounds or measurements are invented.
Dimensions are absent. Serving this path does not fetch the public model;
consumers can use its ID with Showcase after configuring an approved-domain SDK
key. No frames, images or model files are copied.

## Ordinary sites and access gate

Use canonical CoStar space IDs (`listingId:spaceId`), encoded as a URL component
when necessary. Next decodes the URL component; the handler rejects residual
percent escapes, malformed identifiers and all
query options, and returns 404 for unknown spaces. A database/provider failure or
missing migration produces a sanitized 503. Every JSON response is
`Cache-Control: private, no-store`.

The repository selects canonical space/property IDs, the space's `floorPlan` URI,
matching registry columns and bounded Matterport attachment projections from the
space, parent property and optional normalized attachment rows. It never returns
whole source payloads. Missing normalized attachments do not prevent discovery
from the existing property projections. Discovery does not grant display approval.

On November 15, 2026, Akshar authorized automatic viewing of verified public Matterport scans linked to the selected candidate in canonical CoStar data. The configured getter supports both existing reviewed/public registry mappings and trusted discovered references after a bounded current public check. This does not grant registry approval or establish suite geometry. SDK configuration is client-permitted; Model API credentials remain server-only. Private/unavailable references retain floorplan/modeled fallback. See “User-authorized automatic public source viewing” below for limits.

The independently testable resolver supports approved exact-space scans first,
then approved property scans, with trusted current-public discoveries considered by
exact-space priority, then a valid HTTPS space floor plan, then modeled fallback. A property scan is explicitly marked as parent-building geometry in
both response and dimensions provenance; it must not determine suite capacity.
Cached dimensions are optional and their absence does not invent measurements.
No modeled rectangle is generated here; the layout owner derives it separately.
HAC-86's layout inputs use `widthFt` and `depthFt`. A future scan-to-layout bridge
must convert the horizontal X/Z extents from meters to feet by dividing by
`0.3048` and respect the space/property scope; this API does not apply that bridge.

## Model API adapter and cache

The [official authentication guide](https://developers.matterport.com/api/)
specifies HTTP Basic using a Token ID and Token Secret. The server-only adapter
in `lib/interior/model-api.ts` accepts `TokenID:TokenSecret` and an explicit
allowlist of approved model IDs. It sends only a read-only query to the fixed
official endpoint, with redirects disabled, a 3-second default timeout (maximum
5 seconds), a 1 MiB response limit and no automatic retries, mutations, asset
unlocks or purchases.

The query follows the official
[dimension estimates](https://developers.matterport.com/api/property-intelligence/dimensions/)
and [vector data](https://developers.matterport.com/api/property-intelligence/vector-data/)
references:

```graphql
query InteriorDimensions($modelId: ID!) {
  model(id: $modelId) {
    id
    floors {
      id
      dimensionEstimates(units: metric) {
        area
        units
      }
    }
    rooms {
      id
      floor {
        id
      }
      dimensionEstimates(units: metric) {
        area
        height
        lowerElevation
        units
      }
      boundary {
        edges {
          vertices {
            position {
              x
              y
            }
          }
        }
      }
    }
  }
}
```

Property Intelligence requires an Enterprise subscription. No upgrade,
entitlement change or authenticated vendor call was made for verification.
Native model XY boundary coordinates and Z elevation map to SDK `(x,y,z) = (API x, API z, -API y)`, with min/max reordered after the sign reversal, following the [official coordinate basis](https://developers.matterport.com/overview/concepts/#api-to-sdk-conversions);
metric areas convert to square feet. These are vendor estimates and enclosing
boxes, not usable-capacity guarantees. Missing floors, rooms, area, height,
elevation, boundary or metric units means no dimensions. Any GraphQL error,
including partial-data errors, rejects the whole geometry response. Network,
HTTP, parse, size and timeout failures likewise return no geometry.

`createInteriorGetter` accepts an explicitly injected client and access decision.
Only an approved selected registry mapping can use the provider. The Postgres
cache rechecks approval, serializes model misses with a transaction advisory
lock, validates complete dimensions before writing both cache columns, and
reuses existing geometry without a new request. Concurrent warming may return
a scan without dimensions for that request. Failures never replace cache data;
the response includes a dimensions-unavailable limitation. The configured application getter uses a separate read-only dimensions path: it lazily constructs a client allowlisting only the already-approved selected model, if a canonical `MATTERPORT_API_TOKEN` exists. It never calls the Postgres warming/cache writer. No dimensions are fetched for rejected/private/unapproved mappings; existing validated dimensions are reused. The explicitly injected `modelClient` path in `createInteriorGetter` still supports the existing cache implementation for separately authorized callers, and is not selected by the default runtime.

## Registry and import

`matterport_models` is an application-migrated table (migration `0004`). Run the
normal migration command against an approved database before importing. Source
IDs intentionally have no CoStar foreign keys: application migrations run before
source creation and CoStar imports replace their tables independently.

Mappings are unique by `(model_id, costar_property_id, costar_space_id)`, including
null space IDs using PostgreSQL 15+ `NULLS NOT DISTINCT`. The primary key is a
deterministic SHA-256 of that tuple. The repository target is PostgreSQL 16.
`has_exterior: null` means unknown. Dimensions and their timestamp are both null
or both present. An absent cache stays absent.

The importer accepts a normalized JSON manifest with `version: 1` and `models`.
The checked-in authored example is `lib/interior/__fixtures__/registry.json`.
The offline default prints aggregate counts only and does not load env files:

```sh
pnpm exec tsx scripts/load-matterport.ts lib/interior/__fixtures__/registry.json --report-only
```

To import into an explicitly approved local/development database, configure
`DATABASE_URL` privately, migrate, and invoke:

```sh
pnpm db:migrate
pnpm exec tsx scripts/load-matterport.ts /path/to/normalized-manifest.json --write
```

Do not run these write commands against an unapproved database. The importer
does not unpack an unknown private zip, fetch URLs or call vendor APIs. An import
validates the entire manifest before connecting. Exact duplicates collapse;
conflicting duplicate mappings fail. A transaction-scoped advisory lock
serializes imports, and upserts preserve unrelated mappings and cached dimensions
when no replacement geometry is supplied. A transaction failure rolls back all
updates. Import never authorizes display: manifests reject `displayApproved:true`
and metadata upserts preserve the existing approval value.

## Environment and verification

`MATTERPORT_SDK_KEY` is optional, deliberately client-permitted, and passed only for a selected approved scan. The resolver's `showcaseParams.sdkKey` is
application-owned configuration, not a pass-through vendor payload.
`MATTERPORT_API_TOKEN` is always server-only and holds `TokenID:TokenSecret` for
the bounded read-only configured dimensions integration. It must contain the documented `TokenID:TokenSecret` pair. Separate key/secret roles are never guessed or combined automatically. Both template values stay empty.

The env/bundle guards reject the private token's name and configured value in
client output (including Basic-encoded credentials) and reject reuse through
public env variables. Diagnostics name
the variable and artifact, never its value. Existing credential-like
`NEXT_PUBLIC_*_KEY` names remain disallowed; the SDK key is not automatically
inlined through a new public alias.
The client-permitted SDK slot is also checked against configured private values,
so copying the API credential pair into that slot is rejected.

Tests exercise authored fixtures, official public-demo metadata, precedence,
closed access, unknown sites, invalid/partial/oversized provider responses,
timeouts, manifest normalization and token guards. Authored Model API wire data
in `__fixtures__/model-api.ts` is synthetic, never called recorded.

Local PostgreSQL integration is opt-in and restricted to loopback connections
whose explicitly named disposable base database begins with `hac96_`:

```sh
RUN_INTERIOR_DB_TESTS=1 INTERIOR_TEST_DATABASE_URL=postgres://USER:PASSWORD@127.0.0.1:PORT/hac96_test pnpm exec vitest run lib/interior/postgres.test.ts
```

The suite creates and removes its own random child database. It verifies the
complete migration chain and rerun, nullable mapping uniqueness, actual import
and reload, cached geometry preservation, denied/failed/invalid providers,
concurrent cache misses, and rollback after a later database failure. These
checks ran against isolated local PostgreSQL 17/PostGIS; they do not establish
hosted migration, live model rendering or vendor access.

An approved recorded Model API geometry response and the actual HAC-14 zip format
remain external dependencies. The loader supports the documented normalized
manifest; it does not pretend that an unknown private zip follows that format.
Synthetic examples must never be called recordings or measured candidate
geometry. No CoStar fetch or authenticated Matterport call is part of offline verification. The bounded selected-candidate diagnostic described below performed unauthenticated issuer oEmbed checks only.

## Selected-candidate diagnostics and current local availability

The read-only preparation command `scripts/candidate-interior-diagnostics.ts` inspects the supplied kit outside application runtime. Supply the kit directory and one to five exact `--address` arguments. Exact normalized address ambiguity is rejected; canonical site IDs remain the primary runtime lookup. `--check-public` opts into at most two unauthenticated Matterport oEmbed checks per selected property, spaced 500 ms apart with the existing checker's 10-second timeout. It does not write imports, registry approvals, geometry, provider flags or production data. Output contains licensed identifiers and should remain local, outside committed fixtures.

The November 15 local check found public metadata for four checked parent-property models across the requested Western/Gage examples. The Gage property has one active 1,200-square-foot canonical lease-space observation, but no exact-space model attachment in the inspected kit; the Western example has property model mappings but no lease-space observation. These facts do not establish suite geometry, SDK rendering, provider Defurnish capability or approval to display every model. Use property-scope provenance and a separate modeled suite when no verified exact-suite evidence exists.

The initial worktree audit had no configured `DATABASE_URL`. Its configured SDK key is sufficient for an independently verified public viewer, not for resolving the Postgres site registry. A read-only Docker daemon check returned an internal-server error; no containers, volumes, databases or hosted data were changed. At that stage the private token slot was not in canonical pair form. Subsequent verified Model API access and scoped preview activation, documented below, supersede those setup blockers. Runtime filesystem reads, CoffeePort substitution and an ad hoc local data server are not used to fill these gaps.

Additional tests exercise configured approved-only activation, SDK injection, private/unapproved provider suppression and a read-only dimensions fetch that cannot touch a database cache. Diagnostics cover exact-address ambiguity. Live rendering and native geometry remain separate acceptance checks.

Coordinate normalization correction (November 15): previous native boundary-Y-to-positive-SDK-Z bounds were mirrored. New Model API normalization reuses `fromApiToSdk` and has an asymmetric bounds regression. Any geometry cached under the old conversion requires explicit reviewed regeneration before it is treated as verified SDK alignment; this change performs no cache writes or automatic migration.

Fresh normalized geometry carries `coordinateFrame: showcase-y-up-v1`. Legacy dimensions remain readable for backward compatibility, but selected-space calibration requires the marker. For an approved selected mapping, the resolver attempts a bounded read-only refresh when its existing dimensions lack the marker. A failed/unavailable refresh retains the legacy evidence with an explicit uncalibrated-frame limitation; no cache is rewritten.

A subsequent explicitly authorized inspection of the existing same-project hosted preview source used both PostgreSQL `default_transaction_read_only=on` and `BEGIN READ ONLY`, checking `transaction_read_only` before source queries. Relevant CoStar spaces exist, including the Gage canonical space, but the Matterport registry had no rows for the ten inspected Western/Gage property IDs. No imports, row approvals, migrations or cache writes occurred. A read-only source connection alone therefore cannot produce selected-property scans; reviewed model mappings and correct geometry remain necessary. The hosted URL was not copied into this application's global database configuration.

After the read-only audit, Akshar explicitly approved a narrow development write to the existing preview source. Two locally prepared, freshly public-checked Gage **parent-property** mappings were imported and display-approved, with no dimensions or placement fabricated. The active canonical source space remained 1,200 square feet and unchanged. Other Western/Gage addresses remain inventory-dependent; this approval did not populate or approve all properties. Reviewed local artifacts are `/tmp/bizbox-gage-interior-manifest.json`, `/tmp/bizbox-gage-public-check.json`, and `/tmp/bizbox-gage-display-approval.sql`. The same atomic setup added only the separately reviewed Jev policy migration/grant. This supersedes the earlier audit's empty-registry state for these two mappings only.

### Generic selected-candidate scan discovery

Every real canonical lease-space lookup now projects bounded Matterport references
from its own attachments, its parent property's attachments (external reference
36/234), and normalized property attachment records. An optional `discovery`
response lists at most eight model references with source field, exact-space or
parent-property scope, registry approval and current public-view eligibility. Trusted
canonical discoveries can become `kind:scan` after a bounded current public check,
as explicitly authorized by the user; no registry approval is written. Account-wide
search is not implemented, and an SDK key alone does not establish that capability.

Read-only checks on 2026-11-15 confirmed source discovery for actual Houston site
`10888419:13425682` (one parent-property reference, no approved scan) and Los Angeles
Gage site `15423321:13450779` (five parent-property references, two reviewed mappings).
The sampled 1057 S Western Ave, 1 Hermann Park Ct and 10 Crawford St properties have
no canonical lease-space rows in this database, so they are not normal selectable
lease candidates. Public embed availability alone establishes neither suite
identity, SDK operation, calibration nor Defurnish availability.

### Verified provided Model API access (2026-11-15)

A later explicitly authorized two-query read-only check resolved the earlier
credential-format uncertainty: the provided API key/token slots work as the
Model API Token ID/Token Secret pair. The ignored local application's canonical
`MATTERPORT_API_TOKEN` slot now holds that pair privately; the SDK and other
provider configuration were preserved. No source credential values or raw model
responses were recorded, and no account enumeration, unlocking, generation or
provider mutation was performed. A running server must restart to load the change.

The approved Gage model returned HTTP 200 without GraphQL errors and matched the
requested identity. It reported one floor with area and four rooms with area,
lower elevation and boundary vertices, but only two rooms had a positive height.
The existing conservative normalizer requires complete metrics for every room,
so it correctly returns no normalized dimensions. Credentials are therefore no
longer the local access blocker; incomplete room metrics and parent-property
scope still prevent verified selected-suite calibration. No guessed heights or
partial geometry were substituted. This supersedes the earlier credential-shape
readiness note, not the per-model display-approval requirements.

### User-authorized automatic public source viewing

Akshar subsequently explicitly approved: “Automatically open verified public
CoStar-linked scans; keep property/suite warnings.” This supersedes the earlier
requirement for per-row display approval **only for canonical selected-candidate
source references that pass the bounded current public check**. Registry
`displayApproved` remains unchanged and continues to describe registry review.
Existing approved public mappings still resolve first, with exact-space priority.
Untrusted/injected discovery metadata cannot activate this path.

Configured runtime checks at most three canonical references, exact-space before
parent-property, using only Matterport's fixed HTTPS oEmbed endpoint. Each check
has a 1.8-second timeout, redirects disabled, a 64 KiB JSON response cap and no
retry. The process-local checker coalesces identical in-flight requests and caches
results for five minutes (unknown for 30 seconds), bounded to 200 entries. A
successful metadata response authorizes viewing, not measured geometry, SDK
operation, business identity or Defurnish. Discovery optionally reports
`publicStatus` and `viewingEligible` separately from `displayApproved`.

No registry/public-approval writes, private-model unlocks, account searches or
paid Jev calls occur. Parent-property geometry remains unsuitable for selected
suite calibration. Newly discovered exact-space models can be viewed, but live
geometry is withheld until the authoritative stored-geometry validation path can
verify that binding; no guessed bounds are substituted.

An unmocked read-only check verified Houston candidate `10888419:13425682` now
resolves a public **property-scoped scan**, with `displayApproved:false`,
`publicStatus:public`, and `viewingEligible:true`. The existing Gage approved scan
continues to resolve. These checks did not request native geometry or mutate
source records. This supersedes the earlier Houston modeled-fallback observation.

### FDE controlled furniture experiment

The `test_interior_change` FDE tool queues one scoped
`propose_interior_experiment` action with the selected site/comparison/draft,
expected revision, catalog item, question and optional room position. It returns
`queued:true, completed:false`; it does not claim that native placement, Jev
preparation or a simulation has completed. The screen resolves placement before
requesting provider decisions. No LLM-supplied metrics enter this action.

`prepareControlledFurnitureExperiment` takes the current proposal as the new
baseline and adds exactly one catalog item. Settings, fixed service resources,
existing proposed objects, room and anchors stay unchanged. Paired simulations
use the same workload and random seeds. A table alone adds no seats or capacity.
`buildControlledExperimentFinding` rejects extra-variable edits and mismatched
result inputs, then derives before/after ranges and paired changes for routing,
walking delay, served/left, queue wait, revenue and operating contribution. Walking
delay uses the existing engine's route metres / 60 minutes convention. Furniture
purchase, rent and other overhead remain excluded; zero/unfavorable results and
uncovered behavior states are explicit limitations.

`read_interior_experiment` recomputes metrics from current validated inputs and
verifies Jev policy receipts. A controlled finding is emitted only when the
completed-run revision matches the current draft and the pair is actually a
single furniture addition. Otherwise it labels the response a preview, rather
than reporting an asynchronous queued run as finished.

Automatic public discovery also excludes clearly residential unit or communal
amenity titles (for example `2BR, 2BA`, apartment, or Screening Room). Public
availability is retained as `publicStatus:public`, while `viewingEligible:false`
and the reason explain the business-interior mismatch. This conservative title
screen does not establish positive commercial/suite identity for other titles.
Approved registry/reference behavior remains unchanged.

A bounded four-model title check for selected site `18263192:15256242` found three
bed/bath dwelling tours and one Screening Room amenity, rather than a verified
selected commercial-space scan. It must not automatically open those as the
founder's business interior; the modeled response explains that source gap.

Reviewed report persistence: a refresh of public-discovery status/reason or viewer
SDK configuration does not invalidate an unchanged model/geometry experiment.
Identical late interior callbacks preserve the final report and unlocked final
step. Real source/model/geometry or draft edits still invalidate review. Optional
grounded narrative failure cannot block the verified result summary; verification
failures surface a retry message and preserve the kept experiment. The shared
screen/print interior report recomputes controlled findings from its saved pair,
including the current question, before/after seed ranges and causal limitations.
