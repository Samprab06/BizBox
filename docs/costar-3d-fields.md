# What CoStar can feed the 3D scene (HAC-72, SIM-1)

A spike on the loaded CoStar kit: which building-size fields and which attachment
kinds exist, how well they cover Houston and Los Angeles, and what that means for
the 3D scene (SIM-5 and SIM-12). Everything here is an aggregate count. No record
IDs, addresses, URLs or screenshots from the licensed kit are recorded.

## Decisions

1. **Extrude CoStar buildings from stories when the tile has no `render_height`:
   yes.**
   - Stories (`numStoriesAboveGrade`) exist for 100% of retail properties in both
     cities and for 99.4% to 99.8% of all properties. `buildingHeightInFeet` exists
     for only 18.0% (Houston) and 8.1% (Los Angeles) of retail properties, so height
     alone would leave most retail buildings flat.
   - Use this order: tile `render_height`, then CoStar `buildingHeightInFeet`, then
     stories times a floor height, then a plain pin.
   - **Assumed floor height: 12 ft (3.7 m) per story, and 20 ft (6.1 m) for a
     one-story building.** Where CoStar has both height and stories, the median is
     12.0 ft per story for 2-story buildings, 12.0 ft for 3 to 5 stories, 12.2 ft for
     6 to 15 and 11.5 ft for 16 or more (p10 to p90 spans roughly 9 to 15 ft).
     One-story buildings are taller per story (median 20.0 ft, p10 14.4, p90 28.0,
     n=65), which is what big-box and warehouse-style shells look like.
   - Label the result as estimated from CoStar stories, not measured. Stories
     describe the whole building. In Los Angeles 51.7% of retail properties have 6
     to 15 stories (retail space inside an office or mixed-use tower), so the
     extruded volume is the parent building, not the founder's suite.
   - CoStar gives a point, not a footprint. The extrusion only applies where the
     tile has a footprint at that point. With no footprint, SIM-5 falls back to a
     pin column of the estimated height.
2. **Show the primary photo in the site card: yes, behind HAC-14's terms.**
   - Coverage is 100% of retail properties in both cities with a primary photo that
     carries a link (97.7% to 98.3% of non-retail).
   - The links point at CoStar's image CDN, not at our storage. Until HAC-14
     confirms that displaying (not just storing) licensed photos in a demo is
     allowed, ship the card field as optional and off by default, render it only
     through a server route handler (the kit must not reach client bundles), and
     show a CoStar credit next to it. If HAC-14 says no, the card simply has no
     photo. Floor plans are much thinner (below), so do not plan UI around them.
3. **Does any attachment link to a Matterport model: yes, by model ID, not by URL.**
   - 14,626 attachment references of type Matterport3DScan (43) carry an
     11-character `matterportModelId`, as do 2,334 floor-plan references and a few
     photo references. In total 16,974 references (16,968 `MatterportScan` plus 6
     `MatterportStreamingKey`) carry a model ID.
   - Distinct model IDs: 7,066 in Houston and 5,918 in Los Angeles (193 and 914 on
     retail properties). 96.7% (Houston) and 98.7% (Los Angeles) of retail
     properties have at least one.
   - No attachment URI contains a Matterport domain (0 of 242,934). The `uri` on
     these records is a still image on the CoStar image CDN, so the model has to be
     opened through the Matterport API with the model ID. That access is the
     separate package named in the kit index and is tracked in HAC-14.
   - For SIM-12: use `matterportModelId` as the key, treat the thumbnail as the
     card image, and build on the fixture until HAC-14 delivers access.

## Method

- Data: the full kit loaded into a local PostGIS database with `pnpm db:load`
  (3,339 properties, 3,955 lease spaces, 242,934 attachment references). Queries
  were read-only: `SELECT` only, in a session set to read-only.
- Reproduce with `scripts/costar-3d-report.ts` (also read-only; it prints only
  counts and percentages):

  ```sh
  DATABASE_URL=postgres://localhost/<local-db> pnpm exec tsx scripts/costar-3d-report.ts
  ```

  It takes a few minutes because it scans all attachment references several times.

- City: `lower(trim(city))`, as the site search does. Properties in a city other
  than Houston or Los Angeles: 0. (Source spellings vary in case, for example
  upper-case city names.)
- Retail: the site search (`lib/data/sites.ts`) keeps spaces that are active for
  lease and whose `spaceUse` is `Retail` or `OfficeRetail`. A property counts as
  **retail** when it has at least one such space. Non-retail is every other
  property (mostly multifamily). Houston has 61 retail properties and Los Angeles
  has 149. Ten active retail spaces belong to buildings outside the property
  dataset and cannot be placed in a city, so they are not counted.
- Field keys, found by sampling `jsonb_object_keys(data)`:

  | Target           | Key used                                                         | Notes                                                          |
  | ---------------- | ---------------------------------------------------------------- | -------------------------------------------------------------- |
  | Stories          | `numStoriesAboveGrade`                                           | `floors[]` (a per-floor list) is also always present           |
  | Building height  | `buildingHeightInFeet`                                           | feet                                                           |
  | RBA              | `rentableBuildingAreaSquareFeet`                                 | partial; `grossBuildingAreaSquareFeet` (GBA) is near-universal |
  | Typical floor SF | `grossTypicalFloorSquareFeet`                                    |                                                                |
  | Land area        | `lotSize`                                                        | unit in `lotSizeMeasurementType` (code 2 = acres, 1 = SF)      |
  | Year built       | `constructionEvents[]` with `eventType` 2 (ConstructionComplete) | there is no plain "year built" key                             |

  A field counts as present when it is a number greater than zero.

- Attachment kinds, by the kit's `AttachmentType` code and the source location of
  the reference:

  | Kind                      | Rule                                                                                                                                                                                                                                      |
  | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Primary photo             | type 3, or the property or listing `primaryPhoto` field                                                                                                                                                                                   |
  | Gallery photo             | Aerial, BuildingPhoto, Lobby, TenantPhoto, DirectoryPhoto, InteriorPhoto, ConstructionPhoto, CityPhoto, NeighborhoodPhoto, PlacardPrimaryPhoto, PlaneView, PlacardHighlightPhoto, AmenityPhoto, PylonPhoto, ViewFromUnit, CommonAreaPhoto |
  | Floor plan                | FloorPlan or TypicalFloorPlan, or a listing space `floorPlan`                                                                                                                                                                             |
  | Site plan                 | SitePlan                                                                                                                                                                                                                                  |
  | 3D tour / Matterport-like | Matterport3DScan or VirtualTour, or any reference with a `matterportModelId`                                                                                                                                                              |
  | Other                     | everything else (logos, maps, brochures, documents)                                                                                                                                                                                       |

  A reference matching more than one rule takes the first in this order: 3D,
  primary, floor plan, site plan, gallery. The property tables count properties
  (not references), which avoids the duplication of one attachment across source
  locations (242,934 references, 205,299 distinct attachment IDs).

- URL patterns were matched case-insensitively on `uri` or `attachmentUri` and
  only counted (last table).
- 223 attachment references belong to buildings outside the property dataset and
  are excluded from the per-city tables.

## Reading the numbers

- **Stories and size fields are essentially complete** for the retail set. Only
  height is thin, and RBA is partial (65.6% Houston, 24.8% Los Angeles for retail).
  Use GBA when RBA is missing and label it as such.
- **Photos are complete, floor plans are not.** Every retail property has a primary
  photo with a link. Floor plans exist for 67.2% (Houston) and 79.9% (Los Angeles)
  of retail properties, but only 41.0% and 30.2% carry a link. Most floor-plan
  references on non-retail properties are apartment models with no image at all.
- **Site plans are rare** (14.8% and 11.4% of retail properties) and not worth a
  feature.
- **Matterport coverage looks near-universal (about 97% to 99%).** That is the
  kit's coverage, not proof the models render or that our account can open them.
  Treat it as unverified until HAC-14 gives access.

## Coverage: property fields (share of properties with a usable value)

Retail = at least one active lease space with spaceUse Retail or OfficeRetail (the site-search filter). Non-retail = every other property. "Usable" = a number greater than zero.

### Houston

| Field                                                   | retail (n=61) | non-retail (n=1697) |   all (n=1758) |
| ------------------------------------------------------- | ------------: | ------------------: | -------------: |
| Stories above grade (`numStoriesAboveGrade`)            |   61 (100.0%) |       1,694 (99.8%) |  1,755 (99.8%) |
| Floor list (`floors[]`, non-empty)                      |   61 (100.0%) |      1,697 (100.0%) | 1,758 (100.0%) |
| Stories by either source                                |   61 (100.0%) |      1,697 (100.0%) | 1,758 (100.0%) |
| Building height (`buildingHeightInFeet`)                |    11 (18.0%) |         222 (13.1%) |    233 (13.3%) |
| RBA (`rentableBuildingAreaSquareFeet`)                  |    40 (65.6%) |         331 (19.5%) |    371 (21.1%) |
| GBA (`grossBuildingAreaSquareFeet`)                     |   61 (100.0%) |       1,695 (99.9%) |  1,756 (99.9%) |
| Building SF by either (RBA or GBA)                      |   61 (100.0%) |       1,695 (99.9%) |  1,756 (99.9%) |
| Typical floor SF (`grossTypicalFloorSquareFeet`)        |   61 (100.0%) |       1,422 (83.8%) |  1,483 (84.4%) |
| Land area (`lotSize`, unit in `lotSizeMeasurementType`) |   61 (100.0%) |       1,691 (99.6%) |  1,752 (99.7%) |
| Year built (`constructionEvents[]`, `eventType` 2)      |   61 (100.0%) |       1,693 (99.8%) |  1,754 (99.8%) |
| Stories or height (extrudable)                          |   61 (100.0%) |       1,694 (99.8%) |  1,755 (99.8%) |
| Stories but no height (needs a floor-height assumption) |    50 (82.0%) |       1,472 (86.7%) |  1,522 (86.6%) |
| Neither stories nor height                              |      0 (0.0%) |            3 (0.2%) |       3 (0.2%) |

### Los Angeles

| Field                                                   | retail (n=149) | non-retail (n=1432) |   all (n=1581) |
| ------------------------------------------------------- | -------------: | ------------------: | -------------: |
| Stories above grade (`numStoriesAboveGrade`)            |   149 (100.0%) |       1,423 (99.4%) |  1,572 (99.4%) |
| Floor list (`floors[]`, non-empty)                      |   149 (100.0%) |      1,432 (100.0%) | 1,581 (100.0%) |
| Stories by either source                                |   149 (100.0%) |      1,432 (100.0%) | 1,581 (100.0%) |
| Building height (`buildingHeightInFeet`)                |      12 (8.1%) |          116 (8.1%) |     128 (8.1%) |
| RBA (`rentableBuildingAreaSquareFeet`)                  |     37 (24.8%) |          142 (9.9%) |    179 (11.3%) |
| GBA (`grossBuildingAreaSquareFeet`)                     |   149 (100.0%) |       1,429 (99.8%) |  1,578 (99.8%) |
| Building SF by either (RBA or GBA)                      |   149 (100.0%) |       1,429 (99.8%) |  1,578 (99.8%) |
| Typical floor SF (`grossTypicalFloorSquareFeet`)        |    148 (99.3%) |       1,222 (85.3%) |  1,370 (86.7%) |
| Land area (`lotSize`, unit in `lotSizeMeasurementType`) |    148 (99.3%) |       1,426 (99.6%) |  1,574 (99.6%) |
| Year built (`constructionEvents[]`, `eventType` 2)      |   149 (100.0%) |       1,426 (99.6%) |  1,575 (99.6%) |
| Stories or height (extrudable)                          |   149 (100.0%) |       1,423 (99.4%) |  1,572 (99.4%) |
| Stories but no height (needs a floor-height assumption) |    137 (91.9%) |       1,307 (91.3%) |  1,444 (91.3%) |
| Neither stories nor height                              |       0 (0.0%) |            9 (0.6%) |       9 (0.6%) |

## Check: feet per story where both height and stories exist

| City        |      Group | Properties with both |  p10 | median |  p90 |
| ----------- | ---------: | -------------------: | ---: | -----: | ---: |
| Houston     |     retail |                   11 | 10.0 |   12.5 | 15.0 |
| Houston     | non-retail |                  222 | 11.0 |   13.0 | 20.0 |
| Houston     |        all |                  233 | 10.6 |   13.0 | 20.0 |
| Los Angeles |     retail |                   12 | 10.0 |   12.3 | 19.8 |
| Los Angeles | non-retail |                  116 |  8.0 |   11.0 | 15.6 |
| Los Angeles |        all |                  128 |  8.5 |   11.1 | 16.0 |

## Check: feet per story by story count (both cities, all properties with both)

| Stories | Properties |  p10 | median |  p90 |
| ------- | ---------: | ---: | -----: | ---: |
| 1       |         65 | 14.4 |   20.0 | 28.0 |
| 2       |        107 | 10.0 |   12.0 | 15.0 |
| 3-5     |        122 |  8.8 |   12.0 | 14.0 |
| 6-15    |         52 | 10.0 |   12.2 | 13.3 |
| 16+     |         15 | 10.0 |   11.5 | 13.8 |

## Check: stories distribution (properties with stories)

| City        |      Group | With stories |           1 |           2 |         3-5 |        6-15 |        16+ | max |
| ----------- | ---------: | -----------: | ----------: | ----------: | ----------: | ----------: | ---------: | --: |
| Houston     |     retail |           61 |  20 (32.8%) |    5 (8.2%) |  10 (16.4%) |   7 (11.5%) | 19 (31.1%) |  56 |
| Houston     | non-retail |         1694 |  159 (9.4%) | 627 (37.0%) | 716 (42.3%) |  144 (8.5%) |  48 (2.8%) |  71 |
| Houston     |        all |         1755 | 179 (10.2%) | 632 (36.0%) | 726 (41.4%) |  151 (8.6%) |  67 (3.8%) |  71 |
| Los Angeles |     retail |          149 |   10 (6.7%) |    3 (2.0%) |  34 (22.8%) |  77 (51.7%) | 25 (16.8%) |  58 |
| Los Angeles | non-retail |         1423 |   49 (3.4%) | 394 (27.7%) | 749 (52.6%) | 199 (14.0%) |  32 (2.2%) |  44 |
| Los Angeles |        all |         1572 |   59 (3.8%) | 397 (25.3%) | 783 (49.8%) | 276 (17.6%) |  57 (3.6%) |  58 |

## Check: land-area unit codes (1 = SF, 2 = acres, 3 = square metres; properties with `lotSize`)

| City        | Unit code | Properties |
| ----------- | --------: | ---------: |
| Houston     |         1 |        205 |
| Houston     |         2 |       1547 |
| Los Angeles |         1 |        204 |
| Los Angeles |         2 |       1370 |

## Coverage: attachments

Property coverage = share of properties with at least one reference of the kind. "With link" counts only references that carry a URI (for 3D, a Matterport model ID). References repeat across source locations, so distinct attachment IDs are given too.

### Houston

Property coverage (any reference):

| Kind                                                                  | retail (n=61) | non-retail (n=1697) |  all (n=1758) |
| --------------------------------------------------------------------- | ------------: | ------------------: | ------------: |
| Primary photo                                                         |   61 (100.0%) |       1,695 (99.9%) | 1,756 (99.9%) |
| Gallery photo (building, interior, aerial, lobby, ...)                |   61 (100.0%) |       1,695 (99.9%) | 1,756 (99.9%) |
| Floor plan (incl. typical floor plan)                                 |    41 (67.2%) |       1,255 (74.0%) | 1,296 (73.7%) |
| Site plan                                                             |     9 (14.8%) |           82 (4.8%) |     91 (5.2%) |
| 3D tour / Matterport-like (type 43, type 5, or a Matterport model ID) |    59 (96.7%) |       1,674 (98.6%) | 1,733 (98.6%) |
| Other (logos, maps, brochures, documents, ...)                        |    14 (23.0%) |         513 (30.2%) |   527 (30.0%) |
| Any attachment                                                        |   61 (100.0%) |       1,696 (99.9%) | 1,757 (99.9%) |

Property coverage with a link (URI, or Matterport model ID for 3D):

| Kind                                                                  | retail (n=61) | non-retail (n=1697) |  all (n=1758) |
| --------------------------------------------------------------------- | ------------: | ------------------: | ------------: |
| Primary photo                                                         |   61 (100.0%) |       1,658 (97.7%) | 1,719 (97.8%) |
| Gallery photo (building, interior, aerial, lobby, ...)                |   61 (100.0%) |       1,694 (99.8%) | 1,755 (99.8%) |
| Floor plan (incl. typical floor plan)                                 |    25 (41.0%) |          167 (9.8%) |   192 (10.9%) |
| Site plan                                                             |     9 (14.8%) |           82 (4.8%) |     91 (5.2%) |
| 3D tour / Matterport-like (type 43, type 5, or a Matterport model ID) |    59 (96.7%) |       1,674 (98.6%) | 1,733 (98.6%) |

Reference counts (distinct attachment IDs in brackets):

| Kind                                                                  |        retail |      non-retail |             all |
| --------------------------------------------------------------------- | ------------: | --------------: | --------------: |
| Primary photo                                                         |      170 (71) |   3,598 (1,727) |   3,768 (1,798) |
| Gallery photo (building, interior, aerial, lobby, ...)                | 4,512 (2,731) | 80,447 (72,024) | 84,959 (74,734) |
| Floor plan (incl. typical floor plan)                                 |     718 (656) | 20,104 (17,374) | 20,822 (18,029) |
| Site plan                                                             |       29 (22) |       169 (108) |       198 (130) |
| 3D tour / Matterport-like (type 43, type 5, or a Matterport model ID) |     228 (212) |   8,478 (7,845) |   8,706 (8,056) |
| Other (logos, maps, brochures, documents, ...)                        |       62 (37) |       886 (812) |       948 (849) |

Matterport model IDs on any attachment (any kind):

| Measure                               |     retail |    non-retail |           all |
| ------------------------------------- | ---------: | ------------: | ------------: |
| Properties with at least one model ID | 59 (96.7%) | 1,674 (98.6%) | 1,733 (98.6%) |
| Distinct model IDs                    |        193 |          6874 |          7066 |
| References carrying a model ID        |        228 |          8478 |          8706 |

### Los Angeles

Property coverage (any reference):

| Kind                                                                  | retail (n=149) | non-retail (n=1432) |   all (n=1581) |
| --------------------------------------------------------------------- | -------------: | ------------------: | -------------: |
| Primary photo                                                         |   149 (100.0%) |      1,432 (100.0%) | 1,581 (100.0%) |
| Gallery photo (building, interior, aerial, lobby, ...)                |   149 (100.0%) |       1,431 (99.9%) |  1,580 (99.9%) |
| Floor plan (incl. typical floor plan)                                 |    119 (79.9%) |         590 (41.2%) |    709 (44.8%) |
| Site plan                                                             |     17 (11.4%) |           31 (2.2%) |      48 (3.0%) |
| 3D tour / Matterport-like (type 43, type 5, or a Matterport model ID) |    147 (98.7%) |       1,407 (98.3%) |  1,554 (98.3%) |
| Other (logos, maps, brochures, documents, ...)                        |     83 (55.7%) |         594 (41.5%) |    677 (42.8%) |
| Any attachment                                                        |   149 (100.0%) |      1,432 (100.0%) | 1,581 (100.0%) |

Property coverage with a link (URI, or Matterport model ID for 3D):

| Kind                                                                  | retail (n=149) | non-retail (n=1432) |  all (n=1581) |
| --------------------------------------------------------------------- | -------------: | ------------------: | ------------: |
| Primary photo                                                         |   149 (100.0%) |       1,408 (98.3%) | 1,557 (98.5%) |
| Gallery photo (building, interior, aerial, lobby, ...)                |   149 (100.0%) |       1,429 (99.8%) | 1,578 (99.8%) |
| Floor plan (incl. typical floor plan)                                 |     45 (30.2%) |          104 (7.3%) |    149 (9.4%) |
| Site plan                                                             |     17 (11.4%) |           31 (2.2%) |     48 (3.0%) |
| 3D tour / Matterport-like (type 43, type 5, or a Matterport model ID) |    147 (98.7%) |       1,407 (98.3%) | 1,554 (98.3%) |

Reference counts (distinct attachment IDs in brackets):

| Kind                                                                  |          retail |      non-retail |              all |
| --------------------------------------------------------------------- | --------------: | --------------: | ---------------: |
| Primary photo                                                         |       433 (198) |   3,023 (1,485) |    3,456 (1,683) |
| Gallery photo (building, interior, aerial, lobby, ...)                | 15,709 (10,353) | 84,468 (72,634) | 100,177 (82,953) |
| Floor plan (incl. typical floor plan)                                 |   2,915 (2,525) |   6,888 (6,097) |    9,803 (8,612) |
| Site plan                                                             |         37 (32) |         53 (44) |          90 (76) |
| 3D tour / Matterport-like (type 43, type 5, or a Matterport model ID) |   1,303 (1,152) |   6,963 (6,271) |    8,266 (7,423) |
| Other (logos, maps, brochures, documents, ...)                        |       261 (151) |   1,257 (1,080) |    1,518 (1,231) |

Matterport model IDs on any attachment (any kind):

| Measure                               |      retail |    non-retail |           all |
| ------------------------------------- | ----------: | ------------: | ------------: |
| Properties with at least one model ID | 147 (98.7%) | 1,407 (98.3%) | 1,554 (98.3%) |
| Distinct model IDs                    |         914 |          5006 |          5918 |
| References carrying a model ID        |        1303 |          6962 |          8265 |

## Check: URL pattern classes (all attachment references, counts only)

| Pattern                               | References |
| ------------------------------------- | ---------: |
| matterport domain in URI              |          0 |
| video host (YouTube or Vimeo) in URI  |          0 |
| other 3D-tour vendor host in URI      |          0 |
| URI is an image file (jpg, jpeg, png) |     168004 |
| no URI                                |      72627 |
| total references                      |     242934 |

## Limits

- The kit is a sample dataset, so coverage here describes this kit, not CoStar in
  general.
- Retail height coverage rests on 11 (Houston) and 12 (Los Angeles) properties, and
  the one-story figure on 65 properties. Treat 12 ft and 20 ft as defaults to
  revisit when a tile height comparison is possible, not as measured constants.
- "Has a link" means the record carries a URI or model ID. No link was fetched, so
  availability, expiry and licence of the targets are untested.
