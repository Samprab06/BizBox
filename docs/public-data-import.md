# Public data import (HAC-12)

This is a local preparation command, not a live demo dependency:

```sh
pnpm exec tsx scripts/fetch-public-data.ts
```

Prerequisites: Node 22/24, installed pnpm dependencies, an approved PostGIS
`DATABASE_URL`, `CENSUS_API_KEY` in `.env.local`, and the DuckDB CLI on PATH
(or its absolute path in `DUCKDB_BIN`). DuckDB's signed `spatial` and `httpfs`
extensions must be installable. No Python or DuckDB is deployed with the app.

`--download-only` prepares caches without a database. Source requests need the
Census key: an unauthenticated Census data request currently returns HTML
"Missing Key", not a usable dataset. Do not commit the key or key-bearing URLs.

## Coverage and pinned vintages

- **ACS 2020–2024 5-year detailed tables**, block groups: population
  (`B01003_001E`), households (`B11001_001E`), median household income
  (`B19013_001E`, 2024 dollars), and sex/age estimates (`B01001`). Derived age
  bands require every component; suppression/negative sentinels remain unknown.
- **TIGERweb ACS2024 block groups**, January 1, 2024 geographic vintage,
  layer 10, county-filtered GeoJSON with pagination. Geometry is Polygon or
  MultiPolygon, WGS84. The importer converts to PostGIS MultiPolygon.
- **LODES8 WAC 2024 S000 JT00**: all jobs, not only primary jobs, and not unique
  employed residents. `C000` is total jobs. The state crosswalk joins
  `w_geocode = tabblk2020`; `blklatdd`/`blklondd` are **internal points**, not
  building coordinates or geometric centroids. County selection uses current
  crosswalk `cty`, not a historical block-GEOID prefix.
- **Overture places 2026-10-21.0**, v2 schema: `taxonomy` hierarchy, not removed
  `categories`. Local DuckDB reads remote Parquet, filters service-category
  descendants and metro bounding boxes, and exports NDJSON. The PostGIS import
  then performs exact county membership against block-group polygons. Permanently
  closed places are excluded; missing confidence/status stays unknown. Broad
  restaurant mapping is an explicit competitor category, not proof of quick-food
  business suitability.

Houston coverage is Austin, Brazoria, Chambers, Fort Bend, Galveston, Harris,
Liberty, Montgomery, **San Jacinto**, and Waller counties. Los Angeles metro
coverage is Los Angeles and Orange counties. County FIPS preserve leading zeros.
Metro definitions: [Houston BLS](https://www.bls.gov/regions/southwest/news-release/occupationalemploymentandwages_houston.htm),
[Los Angeles BLS](https://www.bls.gov/regions/west/news-release/occupationalemploymentandwages_losangeles.htm).

## Cache, attribution and persistence

Raw downloads, conversion outputs, source manifests and license notices live in
git-ignored `data/public/`. Each manifest records the original safe source URL,
retrieval timestamp and SHA-256. Reruns reuse matching verified bytes; corrupt or
incomplete caches are downloaded again. Changing a pinned vintage changes cache
filenames. No authentication-bearing URL is saved in a manifest or source row.

Census/LEHD US government data is generally public domain; attribute the U.S.
Census Bureau with product, table/file, vintage and source URL, distinguish our
derived analysis, and do not imply endorsement. See the
[Census citation policy](https://www.census.gov/about/policies/citation.html).

Overture attribution: **Overture Maps Foundation, overturemaps.org; contributing
providers and their original `sources` are retained**. Places is not uniformly
ODbL or CDLA: Foursquare is Apache-2.0 (retain its NOTICE), AllThePlaces is CC0,
and other listed providers use CDLA-Permissive-2.0 according to Overture's
[attribution registry](https://docs.overturemaps.org/attribution/#places).
The command caches registry, license texts and Foursquare NOTICE beside the
converted files. Our transformations are geographic/category filtering and
GeoJSON/relational conversion. Retain these notices when distributing derived
data; a null per-record license is not permission to erase provider attribution.

Three isolated Drizzle tables (`lib/db/public-schema.ts`) retain values, geometry,
source URL, vintage and retrieval dates. Census rows also retain geometry-source
metadata; job rows retain crosswalk attribution. Source DDL is
`scripts/public-schema.sql`, separate from the application migration journal.
One advisory-locked transaction replaces all three source tables; any failed
load rolls back that replacement. Downloads/conversion occur before the database
transaction. Runtime catchment code must query Postgres, never these files or
external sources.

## Verification boundary

Official source metadata, current vintages and a TIGER county GeoJSON request were
checked during research. Synthetic tests exercise the adapters, CSV streaming,
query construction, cache reuse, corruption detection and secret exclusion.
This environment currently has no Census key, approved PostGIS connection or
DuckDB installation. Full authenticated downloads, real import/reload and hosted
preview are acceptance gaps, not results established by offline tests.
