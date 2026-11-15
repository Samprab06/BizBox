# Spatial experiment data readiness

Checked November 15, 2026. Machine-readable inventory: `fixtures/spatial-data-readiness.json`. The original inventory is a local source audit; scoped preview activation and verified Model API access are documented below and in `spatial-implementation-status.md`.

## Furniture prepared

Four actual Poly Haven glTF 2.0 models, their binary buffers and 1k textures are available in `public/furniture/`: a round wooden table, a painted wooden chair, a painted wooden stool and wooden display shelving. Combined size is 4,759,804 bytes across 20 source files. The runtime catalog is `lib/furniture/catalog.ts`; preparation is `pnpm exec tsx scripts/prepare-furniture-catalog.ts`.

The script uses an identifying User-Agent, allows only the official API/download hosts, caps source files at 8 MiB and the full download at 24 MiB, checks upstream byte sizes and MD5 before publication, and records SHA-256 for every local file. Relative glTF buffer/image dependencies must be declared in the official file manifest; external and traversing paths fail validation. Repeat preparation reuses matching local bytes.

Geometry bounds are calculated from the selected glTF scene, POSITION accessor bounds and all node transforms. glTF uses metres and Y-up. The catalog records a centering/grounding offset for rendering; no hidden scaling is needed. Poly Haven metadata dimensions are retained separately in their original Blender XYZ millimetres. For the shelving export the two horizontal axes are swapped relative to metadata; this is explicitly recorded as `sourceFootprintAxes: swapped-in-gltf`, with actual glTF X/Z extents used for footprints. Height and footprint lengths agree within the preparation tolerance. These are mesh bounds, not verified manufacturer clearances.

Poly Haven assets are CC0. Sources and current API conditions: [asset license](https://polyhaven.com/license), [API documentation and terms](https://polyhaven.com/our-api). Live API usage requires clear attribution and identifying User-Agent. BizBox uses a prepared local snapshot and retains a visible source credit; no runtime catalog-provider call is needed.

The chair/stool each have a separately authored one-seat binding. The table supplies no seats by itself, avoiding double-counting adjacent chairs. These bindings are assumptions, not provider specifications. Prices are null. No source specifies checkout/service speed, salon chair suitability, gym-equipment capability, dwell time, furniture-purchase cost or maintenance cost.

All four existing business categories can use ordinary seating, tables and storage. Specialist salon equipment and fitness resources must use clearly labeled modeled zones/proxies with founder-entered operating specifications until sourced assets/specifications exist. The ordinary chair must not be represented as a verified salon service chair or gym machine.

## LA and Houston evidence

The original checkout's ignored licensed CoStar kit contains 3,339 property records and 13,147 property-to-Matterport mapping rows. Local CSV aggregation, normalizing city case:

| City        | Mapping rows | Unique properties | Unique model IDs | Timezone            |
| ----------- | -----------: | ----------------: | ---------------: | ------------------- |
| Houston     |        7,163 |             1,758 |            7,075 | America/Chicago     |
| Los Angeles |        5,984 |             1,581 |            5,921 | America/Los_Angeles |

These mappings do not establish render access, approved display/export rights, suite identity, walkable geometry or editable furniture inventories. At the original audit, no authenticated Matterport call had been made. Subsequent read-only access is documented below. No model was purchased/unlocked/downloaded and no supplier furniture service was found in the supplied kit schemas. Raw sponsor IDs, addresses and URLs are not copied into committed fixtures.

The existing Census verification artifact documents prior ACS/TIGER preparation for 12,816 block groups: 4,176 across Houston's ten counties and 8,640 in Los Angeles/Orange counties. It explicitly says `databaseVerified: false`. The inspected original checkout/worktree has no prepared public-data cache. LODES and Overture import code exists, but this audit does not prove current cached records or runtime database content. Listing/metro facts are not observed storefront arrivals.

The readiness manifest includes all eight combinations of the two cities and coffee, quick food, salon/barber and fitness. Every combination has existing authored category defaults and this shared furniture library. None is labeled calibrated or live-Jev-validated. Availability of a category default is not evidence that a corresponding full operating adapter has been implemented.

## Remaining acquisition gates

- Establish an isolated development database and import verified CoStar/ACS/LODES/Overture sources. Shared production/preview data is not a development write target.
- Verify each selected unit's actual scan access, rights, unit identity and geometry. Otherwise label the interior as authored/modeled.
- Acquire or author a verified baseline object inventory before claiming removal of photographed furniture. Ordinary overlay removal cannot erase scan photography; Matterport Defurnish is a separate account capability.
- Obtain aggregate business arrivals, transactions, service/dwell samples and category-specific resource specifications for calibration. Defaults remain explicit assumptions.
- Interior Jev behavior needs separate state coverage and controlled/live validation. No provider calls were made for catalog/data preparation; zero Jev spend.

## Activated selected-property slice

The follow-up user-approved development setup imports two reviewed public parent-property mappings for the selected Gage candidate into the existing preview database. Actual SDK rendering succeeds. A different tour title is supported by an alternate address in the licensed property record; exact selected-suite identity and dimensions remain unverified. The actual model reports no available Defurnish feature/view. This slice does not establish scan coverage for every LA/Houston candidate, and missing mappings still use the explicit modeled fallback.

The selected-address application path has also been exercised with genuine Jev policies and read-only Nessie sandbox funds. All arrivals, room layouts and operating assumptions in that live policy case remain synthetic/assumed. Live integration is distinct from business calibration or measured furniture inventory.
