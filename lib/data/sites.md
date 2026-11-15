# Site search (HAC-16)

`searchSites(request, inventory)` is a pure, deterministic `search_sites` function
over the normalized HAC-11 rows. It reads no files, database or external service.
`lib/contracts/sites.ts` defines its request, inventory and response boundaries.
The canonical `BusinessProfile` optionally carries founder map geometry as
`areaPreferences`; `Candidate` remains unchanged.

## Request and API

`POST /api/sites` accepts a complete canonical `profile` and optional
`minSizeSqFt`, `maxSizeSqFt`, `limit` (1–8, default 8), and
`nnnExpenseUsdPerSfYear` (nonnegative, illustrative default 10). Minimum size
cannot exceed maximum size. Unknown request fields and invalid profiles return
422 with `{code, message, field_errors}`; requests are limited to 64 KiB.

The route reads whitelisted search fields from `costar_properties` and
`costar_spaces` in one read-only, repeatable-read transaction. It requires a
configured `DATABASE_URL` and the HAC-11 import. An empty inventory returns an
empty result; missing/unprepared databases and invalid stored data return a
sanitized 503. There is no fixture fallback, network call, runtime file access,
profile write or automatic database migration. Responses disable caching.

`profile.areaPreferences` is `{city, rectangles: [{bounds: [west, south, east,
north], brush: "favor" | "avoid"}]}`. Coordinates must be finite geographic
coordinates with west < east and south < north, and the map city must match the
profile city. Invalid geometry or city mismatch returns 422 rather than widening
the search. There is no rectangle count limit; the existing request byte limit
still applies. Omission preserves older profiles; an empty rectangle array clears
map preferences. Textual area descriptions are not geocoded or used as filters.
Profile version tracking treats omitted and explicitly empty map preferences as
equivalent, so switching between those representations does not stale comparisons.
Legacy painted points contain no geographic radius and must be redrawn as rectangles
by the client before they can drive search.

The opt-in development read-through forwards geometry unchanged. An older hosted
backend may reject this new profile field, yielding the existing unavailable error;
use the local inventory database or a compatible backend. It must not drop map
preferences or filter the upstream's already limited result list.

The result contains `candidates`, sequential `filters` with before/removed/after
counts, `mostRestrictiveFilter`, `emptyReason`, `totalMatched`, resolvable
`evidence`, and `modelVersion: "site-prescore-v1"`. Each shortlist entry contains a
canonical `candidate`, normalized property/listing IDs, `position`, `score`,
`scoreComponents`, source references and flags. Candidate IDs retain HAC-11's
`listingId:spaceId` format so the catchment API can resolve them directly.

## Selection and ranking

Filters run in this order: city, active availability, Retail/OfficeRetail space
use, map eligibility when red rectangles exist, size, monthly base-rent ceiling,
then required ground floor, corner-or-endcap,
frontage and parking. OfficeRetail in mixed-use properties is eligible. Unknown
size/rent remains visible and flagged; an unknown mandatory feature cannot
establish a match. `mostRestrictiveFilter` names the stage removing the most rows,
with the first stage winning a tie. Counts describe sequential effects, not
independent counterfactual filter effects.

Red rectangles exclude the union of their areas, including edges; red wins any
green overlap. Missing latitude or longitude cannot prove that a listing is outside
red and is excluded whenever any red rectangle exists. Diagnostics separate these
removals (`areaLocationKnown`) from known locations inside red (`avoidedAreas`).
With green alone, unknown coordinates remain eligible without green preference.
All geographic matching uses building coordinates, not the leased unit's footprint.

Eligible matches in the union of green rectangles sort first; outside-green matches
remain eligible. Within each group, known-rent matches sort before unknown rent,
then by score descending and stable site ID. Eligibility and ordering run across the
entire supplied inventory **before** the eight-result cap; `totalMatched` counts
all eligible spaces. The same function serves browser searches, agent discovery,
current/saved-profile lookups and comparison assembly. Founder map evidence uses
`origin: "founder"`, no CoStar sources, and returned entries flag `preferred_area`
or `area_location_unknown` where applicable. Map ordering does not change numeric
pre-scores and is not a predicted-sales or profit adjustment.

The authored pre-score awards up to 40 for rent fit, 20 for size fit,
15 for Corner/EndCap position and 15 for building frontage. The remaining anchor
component earns zero: the imported schemas do not verify anchors. No anchor is
inferred from tenant names, brands or occupied area. These weights are transparent
heuristics, not calibrated demand or sales predictions.

The optional geometry survives full JSONB profile snapshots and intake drafts.
Browser patches may edit it; model-authored `save_profile` patches cannot. A city
change clears inherited geometry; explicitly supplied city-mismatched geometry is
rejected. Profile content/version tracking includes map changes, retaining old snapshots and marking
their comparisons outdated once a new profile is saved. Historical cached reruns
continue to replay their original request; new comparison assembly applies the
saved profile's current map eligibility to the explicitly requested candidates.

Building frontage uses `propertyRetail.frontage[].frontageInFeet`; it does not
verify the leased unit's own frontage. Parking uses observed counts or ratios.
Ground-floor status requires explicit `Ground`; ambiguous floor labels remain
unknown. EndCap satisfies the ticket's corner-or-endcap filter but does not become
`Candidate.features.corner: true`. Source payloads, contacts and attachments are
never returned.

## Rent and expense assumptions

Monthly base rent in cents is `USD/SF/year × sizeSqFt × 100 / 12`, rounded to the
nearest cent. The higher known asking-rate endpoint is used; a sole endpoint is
flagged. Both rent and size must be known to calculate base rent. Unknown rent
never earns a cheap-rent bonus. The profile's rent ceiling filters **base rent**;
`Candidate.monthlyRentCents` retains that meaning.

`opexCents` and `totalMonthlyCostCents` are separate modeled lease-cost components,
not total business operating costs. TripleNet adds an explicitly flagged,
uncalibrated assumption of $10/SF/year unless the caller overrides it. Omission
has `origin: "default"`; an explicit override has `origin: "founder"`, including
an explicit value of 10. FullService has no additional modeled building opex;
other service arrangements remain unknown. Taxes, insurance and maintenance
estimates require verification; the API does not claim an observed NNN quote.

Pass the original validated request to `searchSites`, rather than the
default-filled parsed request, to preserve omitted-versus-overridden provenance.
The response includes evidence definitions for every returned assumption and
computed score. Synthetic tests use invented records only. Hosted PostGIS/data
and Vercel preview verification are separate from offline test/build results.
