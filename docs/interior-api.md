# Interior registry and API (HAC-96)

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
Dimensions have separate provenance. `origin` retains the existing global enum;
`provider` identifies `matterport`, `costar` or `modeled`, `mode` distinguishes
synthetic/recorded/live source paths, and `scope` distinguishes demo/space/property.
No global `matterport` origin or simulation capacity behavior is introduced.

## Offline examples

With `pnpm dev`, these paths work without database or vendor credentials:

```text
/api/sites/interior-fixture-scan/interior
/api/sites/interior-fixture-floorplan/interior
/api/sites/interior-fixture-modeled/interior
```

The scan shape contains authored geometry and the invented, nonrenderable model
ID `Synthetic01`. It is **not** Matterport's public demo. The floor plan points to
an authored SVG served locally by the same route directory. Neither example is
licensed source material. Fixtures compile into the server; runtime does not
read files from disk. Unknown ordinary sites never fall back to demo content.

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

`lib/interior/runtime.ts` deliberately sets `allowLicensedAssets: false`.
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
`MATTERPORT_API_TOKEN` is always server-only and is unused until a separately
verified Model API adapter exists. Both template values stay empty.

The env/bundle guards reject the private token's name and configured value in
client output and reject reuse through public env variables. Diagnostics name
the variable and artifact, never its value. Existing credential-like
`NEXT_PUBLIC_*_KEY` names remain disallowed; the SDK key is not automatically
inlined through a new public alias.

Tests exercise all branches with authored fixtures, precedence, closed access,
unknown sites, invalid geometry, provider failures, manifest normalization and
token guards. These offline checks do not establish actual PostgreSQL
load/reload/rollback, hosted migration, model rendering or vendor access.

The approved recorded fixture, verified public demo model, private zip format and
live Model API adapter are pending HAC-14. Synthetic examples must never be called
recordings or measured candidate geometry. No implementation in this slice makes
Matterport or CoStar network requests.
