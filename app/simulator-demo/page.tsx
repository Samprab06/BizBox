import { SimulatorDemo } from "@/components/simulator/demo";
import { demoPlan, makeDemo } from "@/components/simulator/fixture";
import { storedSimulator } from "@/components/simulator/stored";
import { getSiteFixture } from "@/components/site/site-fixtures";
import { createPostgresComparisonStore } from "@/lib/evaluation/store-postgres";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) =>
  typeof v === "string" && v.length <= 300 ? v : undefined;

/** HAC-63: ?comparison=<id>[&site=<siteId>][&project=<projectId>] opens a stored run; otherwise the labelled example. */
async function loadStored(search: Search) {
  const comparisonId = one(search.comparison);
  if (!comparisonId) return null;
  const projectId = one(search.project) ?? "houston-coffee";
  try {
    const stored = await createPostgresComparisonStore().load(
      projectId,
      comparisonId,
    );
    if (!stored) return null;
    return storedSimulator({
      comparisonId: stored.id,
      request: stored.evaluation.request,
      result: stored.evaluation.result,
      runs: stored.runs,
      ...(stored.evaluation.assembly
        ? { assembly: stored.evaluation.assembly }
        : {}),
      ...(one(search.site) ? { siteId: one(search.site) } : {}),
    });
  } catch {
    // Database unavailable or stored record invalid: fall back to the labelled example.
    return null;
  }
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const search = await searchParams;
  const tilesetUrl = process.env.VEXCEL_API_KEY?.trim()
    ? "/api/vexcel/3d/tileset"
    : undefined;
  const stored = await loadStored(search);
  if (stored)
    return (
      <SimulatorDemo
        data={stored.data}
        plan={stored.plan}
        story={stored.story}
        coordinates={
          tilesetUrl ? { ...stored.coordinates, tilesetUrl } : undefined
        }
      />
    );
  const site = getSiteFixture("montrose");
  const coordinates =
    site && tilesetUrl
      ? { longitude: site.longitude, latitude: site.latitude, tilesetUrl }
      : undefined;
  return (
    <SimulatorDemo
      data={makeDemo()}
      plan={demoPlan}
      coordinates={coordinates}
    />
  );
}
