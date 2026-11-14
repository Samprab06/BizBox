import type { ReactNode } from "react";
import { ProjectContextProvider } from "@/components/shell/context-bar";
import { getPreviewProject } from "@/lib/workspace-preview";
import { WorkspaceView } from "@/components/workspace-view";
import { SimulatorDemo } from "@/components/simulator/demo";
import {
  demoPlan,
  makeDemo,
  makeDemoInputs,
} from "@/components/simulator/fixture";
import { exampleTrips } from "@/components/city/example-trips";
import { storedSimulator } from "@/components/simulator/stored";
import { getSiteFixture } from "@/components/site/site-fixtures";
import { createPostgresComparisonStore } from "@/lib/evaluation/store-postgres";
import { parseStoredInsights } from "@/components/insights/stored-insights";
import type { SiteInsights } from "@/lib/contracts/insights";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) =>
  typeof v === "string" && v.length <= 300 ? v : undefined;

/** HAC-63: ?comparison=<id>[&site=<siteId>][&project=<projectId>] opens a stored run; otherwise the labelled example. */
async function loadStored(projectId: string, search: Search) {
  const comparisonId = one(search.comparison);
  if (!comparisonId) return null;
  try {
    const store = createPostgresComparisonStore();
    const stored = await store.load(projectId, comparisonId);
    if (!stored) return null;
    const currentProfileVersion = await store
      .currentProfileVersion(projectId)
      .catch(() => null);
    const simulator = storedSimulator({
      comparisonId: stored.id,
      request: stored.evaluation.request,
      result: stored.evaluation.result,
      runs: stored.runs,
      ...(stored.evaluation.assembly
        ? { assembly: stored.evaluation.assembly }
        : {}),
      ...(one(search.site) ? { siteId: one(search.site) } : {}),
    });
    let insights: SiteInsights | undefined;
    let insightsUnavailableReason: string | undefined;
    if (simulator) {
      try {
        insights = parseStoredInsights(
          {
            comparisonId: stored.id,
            outdated: false,
            result: stored.evaluation.result,
            comparison: stored.comparison,
          },
          {
            projectId,
            comparisonId: stored.id,
            siteId: simulator.data[0].run.siteId,
          },
        ).site.insights;
      } catch {
        // An insights mismatch must not replace an otherwise valid recorded scene.
        insightsUnavailableReason =
          "Retained insights could not be verified for this selected saved site and scenario.";
      }
    }
    return simulator
      ? {
          ...simulator,
          synthetic: stored.comparison.synthetic,
          robustness: stored.evaluation.robustness ?? null,
          insights,
          insightsUnavailableReason,
          profileVersion: stored.evaluation.result.profileVersion,
          profileVersionUnknown: currentProfileVersion === null,
          outdated:
            currentProfileVersion !== null &&
            currentProfileVersion !== stored.evaluation.result.profileVersion,
        }
      : null;
  } catch {
    // Database unavailable or stored record invalid: fall back to the labelled example.
    return null;
  }
}

export default async function Page({
  searchParams,
  params,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Search>;
}) {
  const [search, { projectId }] = await Promise.all([searchParams, params]);
  const tilesetUrl = process.env.VEXCEL_API_KEY?.trim()
    ? "/api/vexcel/3d/tileset"
    : undefined;
  // A browser SDK key is domain-restricted and intentionally client-permitted.
  // The API key/token never cross this server-component boundary. The public
  // cafe scan is a demonstration reference, never a stored candidate site, so it
  // is passed to the labelled example only.
  const sdkKey = process.env.MATTERPORT_SDK_KEY?.trim();
  const stored = await loadStored(projectId, search);
  if (!stored && !getPreviewProject(projectId) && !one(search.comparison))
    return <WorkspaceView projectId={projectId} view="simulator" />;
  if (stored)
    return (
      <SimulatorContext projectId={projectId}>
        <WorkspaceView
          projectId={projectId}
          view="simulator"
          decisionLayout
          title="Simulator"
          allowUnknownProject
          siteId={one(search.site)}
        >
          <SimulatorDemo
            projectId={projectId}
            context={{
              kind: "simulator",
              phase: "ready",
              comparisonId: one(search.comparison),
              siteId: stored.data[0].run.siteId,
              synthetic: stored.synthetic,
            }}
            data={stored.data}
            plan={stored.plan}
            story={stored.story}
            robustness={stored.robustness}
            outdated={stored.outdated}
            profileVersionUnknown={stored.profileVersionUnknown}
            insights={stored.insights}
            insightsUnavailableReason={stored.insightsUnavailableReason}
            profileVersion={stored.profileVersion}
            coordinates={
              tilesetUrl ? { ...stored.coordinates, tilesetUrl } : undefined
            }
          />
        </WorkspaceView>
      </SimulatorContext>
    );
  const site = getSiteFixture("montrose");
  const coordinates =
    site && tilesetUrl
      ? { longitude: site.longitude, latitude: site.latitude, tilesetUrl }
      : undefined;
  // HAC-77: build the example trips here, from the same run the page shows. The
  // browser and server can round the seeded arrival times differently.
  const demo = makeDemo();
  const cityTrips = site
    ? exampleTrips(makeDemoInputs().schedule, demo[0].run, site)
    : undefined;
  return (
    <SimulatorContext projectId={projectId}>
      <WorkspaceView
        projectId={projectId}
        view="simulator"
        decisionLayout
        title="Simulator"
        allowUnknownProject
        siteId="montrose"
      >
        <SimulatorDemo
          projectId={projectId}
          context={{
            kind: "simulator",
            phase: "example",
            siteId: "montrose",
            synthetic: true,
          }}
          data={demo}
          cityTrips={cityTrips}
          plan={demoPlan}
          coordinates={coordinates}
          matterport={
            sdkKey
              ? {
                  sdkKey,
                  modelId: "qfmMbTLt4Bo",
                  // Proposed service-area overlay, registered against the public
                  // scan's floor intersections; not a measured business layout.
                  placement: {
                    origin: { x: 17.1, y: 0.04, z: 10.3 },
                    rotationY: Math.PI,
                    scale: 0.5,
                  },
                  viewpoint: {
                    sweepId: "y0xe63ayfyepf8cg51cua77hb",
                    rotation: { x: -17, y: 168 },
                  },
                }
              : undefined
          }
        />
      </WorkspaceView>
    </SimulatorContext>
  );
}

/** The existing layout provides known projects; saved IDs retain context without fixture facts. */
function SimulatorContext({
  projectId,
  children,
}: {
  projectId: string;
  children: ReactNode;
}) {
  if (getPreviewProject(projectId)) return children;
  return (
    <ProjectContextProvider
      project={{
        id: projectId,
        name: projectId,
        city: "",
        business: "",
        sites: [],
      }}
    >
      {children}
    </ProjectContextProvider>
  );
}
