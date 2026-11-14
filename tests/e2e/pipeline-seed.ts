/** HAC-34: invented observations in a dedicated local PostGIS database only. */
import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = new URL(process.env.HAC34_TEST_DATABASE_URL ?? "");
if (
  !["127.0.0.1", "localhost"].includes(url.hostname) ||
  !/^\/hac34_test_[a-z0-9_]+$/.test(url.pathname)
)
  throw new Error("Use a dedicated loopback hac34_test_ database");
const db = postgres(url.toString(), {
  max: 1,
  connect_timeout: 5,
  onnotice: () => {},
});
try {
  await migrate(drizzle(db), { migrationsFolder: "drizzle" });
  await db.unsafe(await readFile("scripts/costar-schema.sql", "utf8"));
  await db.unsafe(await readFile("scripts/public-schema.sql", "utf8"));
  await db`INSERT INTO projects(id,name) VALUES('houston-coffee','HAC-34 synthetic pipeline') ON CONFLICT DO NOTHING`;
  // Re-running preserves existing rows; no replacement of other source data.
  for (let i = 1; i <= 3; i++) {
    const id = String(3400 + i);
    const source = {
      origin: "costar",
      dataset: "HAC-34 synthetic inventory",
      recordId: id,
      field: "fixture",
    };
    const data = {
      buildingName: `Synthetic pipeline café ${i}`,
      primaryAddress: {
        streetNumber: String(i),
        streetName: "Invented",
        streetType: "St",
        city: "Houston",
      },
      propertyRetail: {
        frontage: [{ frontageInFeet: 25, trafficCount: 1000 }],
      },
    };
    await db`INSERT INTO costar_properties(id,city,retail,latitude,longitude,point,data,source)
      VALUES(${id},'Houston',true,29.76,${-95.37 + i * 0.001},ST_SetSRID(ST_MakePoint(${-95.37 + i * 0.001},29.76),4326),${JSON.stringify(data)},${JSON.stringify(source)}) ON CONFLICT(id) DO NOTHING`;
    await db`INSERT INTO costar_property_search(property_id,data) VALUES(${id},${JSON.stringify(data)}) ON CONFLICT DO NOTHING`;
    const space = {
      spaceUse: "Retail",
      position: "Corner",
      floor: "Ground",
      askingRentUsdPerSfYearLow: 20 + i * 4,
      askingRentUsdPerSfYearHigh: 20 + i * 4,
      serviceTypeName: "FullService",
    };
    await db`INSERT INTO costar_spaces(id,listing_id,property_id,active,retail,size_sq_ft,data,source)
      VALUES(${`${id}:1`},${id},${id},true,true,${1200 + i * 100},${JSON.stringify(space)},${JSON.stringify(source)}) ON CONFLICT DO NOTHING`;
  }
  const publicSource = {
    dataset: "HAC-34 synthetic public observations",
    retrievedAt: "2026-11-14T00:00:00Z",
  };
  await db`INSERT INTO public_block_groups(geoid,county_fips,population,households,median_household_income,geom,data,source)
    VALUES('hac34-bg','48201',3000,1200,65000,ST_Multi(ST_MakeEnvelope(-95.38,29.75,-95.36,29.77,4326)),${JSON.stringify({ ageBands: { "18-34": 1000 } })},${JSON.stringify(publicSource)}) ON CONFLICT DO NOTHING`;
  await db`INSERT INTO public_jobs(geoid,county_fips,jobs,point,data,source)
    VALUES('hac34-job','48201',500,ST_SetSRID(ST_MakePoint(-95.37,29.76),4326),'{}',${JSON.stringify(publicSource)}) ON CONFLICT DO NOTHING`;
  await db`INSERT INTO public_places(id,name,category,county_fips,point,data,source)
    VALUES('hac34-place','Synthetic competing café','coffee','48201',ST_SetSRID(ST_MakePoint(-95.371,29.761),4326),'{}',${JSON.stringify(publicSource)}) ON CONFLICT DO NOTHING`;
  console.log(
    "HAC-34: three invented retail spaces and synthetic public catchment seeded locally.",
  );
} finally {
  await db.end();
}
