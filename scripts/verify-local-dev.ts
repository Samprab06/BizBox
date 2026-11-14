import { config } from "dotenv";
import { syntheticHoustonFixture } from "../fixtures/houston-coffee";
import { SiteSearchResultSchema } from "../lib/contracts/sites";
import { CatchmentResponseSchema } from "../lib/contracts/catchment";
import { localRowCounts, verifyLocalCounts } from "./load-local-data";

config({ path: [".env.local", ".env"], quiet: true });
async function verify() {
  if (!process.env.DATABASE_URL) throw new Error("Set a local DATABASE_URL");
  const base = new URL(process.env.LOCAL_APP_URL || "http://127.0.0.1:3000");
  if (!["127.0.0.1", "localhost", "[::1]"].includes(base.hostname))
    throw new Error("Local verification only");
  const counts = await localRowCounts(process.env.DATABASE_URL);
  verifyLocalCounts(counts);
  const health = await fetch(new URL("/api/health", base), {
    signal: AbortSignal.timeout(15000),
  });
  const healthBody = await health.json();
  if (!health.ok || healthBody.database?.postgis !== true)
    throw new Error("Health did not confirm PostGIS");
  const cities = [];
  for (const city of ["Houston", "Los Angeles"] as const) {
    // Synthetic business requirements, but actual candidate/source observations.
    const profile = structuredClone(syntheticHoustonFixture.profile);
    profile.projectId = "local-dev";
    profile.id = "local-smoke-profile";
    profile.city = city;
    for (const flag of Object.values(profile.mustHaves)) flag.value = false;
    profile.economics.monthlyRentCeilingCents.value = null;
    profile.economics.monthlyRentCeilingCents.unknownReason =
      "No rent ceiling in the local API smoke test";
    const response = await fetch(new URL("/api/sites", base), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile, limit: 1 }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw new Error(`Site API failed for ${city}: HTTP ${response.status}`);
    const sites = SiteSearchResultSchema.parse(await response.json());
    const candidate = sites.candidates[0]?.candidate;
    if (!candidate || candidate.synthetic)
      throw new Error(`No real candidate returned for ${city}`);
    const endpoint = new URL(
      `/api/sites/${encodeURIComponent(candidate.id)}/catchment`,
      base,
    );
    endpoint.searchParams.set("projectId", "local-dev");
    endpoint.searchParams.set("category", "coffee");
    endpoint.searchParams.set("radiusMeters", "500");
    const catchmentResponse = await fetch(endpoint, {
      signal: AbortSignal.timeout(30000),
    });
    if (!catchmentResponse.ok)
      throw new Error(
        `Catchment API failed for ${city}: HTTP ${catchmentResponse.status}`,
      );
    const catchment = CatchmentResponseSchema.parse(
      await catchmentResponse.json(),
    );
    if (
      !catchment.residents.blockGroups.length ||
      catchment.catchment.synthetic
    )
      throw new Error(`Catchment lacked real resident rows for ${city}`);
    cities.push({
      city,
      matchedSites: sites.totalMatched,
      residentBlockGroups: catchment.residents.blockGroups.length,
      workplaceBlocks: catchment.workers.blocks.length,
      competitors: catchment.competitors.length,
      coTenants: catchment.coTenants.length,
    });
  }
  // Aggregates only; never write licensed addresses, names or source payloads.
  console.log(JSON.stringify({ health: healthBody, counts, cities }, null, 2));
}
verify().catch((error: unknown) => {
  console.error(
    error instanceof Error && !error.message.includes("://")
      ? error.message
      : "Local verification failed",
  );
  process.exitCode = 1;
});
