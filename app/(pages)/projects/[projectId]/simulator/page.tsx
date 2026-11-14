import type { ReactNode } from "react";
import { ProjectContextProvider } from "@/components/shell/context-bar";
import { getPreviewProject } from "@/lib/workspace-preview";
import { WorkspaceView } from "@/components/workspace-view";
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
    return simulator
      ? {
          ...simulator,
          synthetic: stored.comparison.synthetic,
          robustness: stored.evaluation.robustness ?? null,
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
  const stored = await loadStored(projectId, search);
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
          data={makeDemo()}
          plan={demoPlan}
          coordinates={coordinates}
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
