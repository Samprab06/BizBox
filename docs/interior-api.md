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

The repository selects only space/property IDs, the space's `floorPlan` URI, and
matching registry columns. It does not read raw property payloads or depend on
`costar_attachments`, which hosted loads omit.

`lib/interior/runtime.ts` creates the default getter with licensed display closed
and no model client.
Ordinary existing spaces therefore return `modeled`. Setting a token, supplying
query parameters or importing a manifest cannot open licensed display. After
HAC-14 establishes access and display terms, activation requires a reviewed
change to this gate and to the appropriate asset-access policy.

The independently testable resolver supports approved exact-space scans first,
then approved property scans, then a valid HTTPS space floor plan, then modeled
fallback. A property scan is explicitly marked as parent-building geometry in
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
Native model XY boundary coordinates and Z elevation map to app Y-up bounds;
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
the response includes a dimensions-unavailable limitation. The default getter
never reads token credentials or constructs this client. HAC-14 must approve
private access/display before activation.

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

`MATTERPORT_SDK_KEY` is optional, deliberately client-permitted, and currently
unused by the closed production path. The resolver's `showcaseParams.sdkKey` is
application-owned configuration, not a pass-through vendor payload.
`MATTERPORT_API_TOKEN` is always server-only and holds `TokenID:TokenSecret` for
an approved server integration. It is not consumed by the closed default route.
Both template values stay empty.

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
geometry. No CoStar fetch or authenticated Matterport call is part of verification.
