import type { ReactNode } from "react";
import { ProjectContextProvider } from "@/components/shell/context-bar";
import { getPreviewProject } from "@/lib/workspace-preview";
import { WorkspaceView } from "@/components/workspace-view";
import { SimulatorDemo } from "@/components/simulator/demo";
import { demoPlan, makeDemo } from "@/components/simulator/fixture";
import {
  loadStoredSimulator,
  simulatorSearchValue,
} from "@/components/simulator/load-stored";
import { SimulatorRecovery } from "@/components/simulator/recovery";
import { workspaceHref } from "@/lib/client/workspace-routes";
import { getSiteFixture } from "@/components/site/site-fixtures";
import { createPostgresComparisonStore } from "@/lib/evaluation/store-postgres";
import { RestoreSavedComparison } from "@/lib/client/project-store";
import { publicCafeScan } from "@/lib/interior/fixtures";

const cafeSweep = publicCafeScan.placement.serviceSweep;
const cafeViewpoint = cafeSweep?.rotation
  ? { sweepId: cafeSweep.sweepId, rotation: cafeSweep.rotation }
  : undefined;

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;
const one = simulatorSearchValue;

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
  const loaded = await loadStoredSimulator(
    { projectId, comparison: search.comparison, siteId: search.site },
    { createStore: createPostgresComparisonStore },
  );
  if (loaded.kind === "not_found" || loaded.kind === "error") {
    const retryQuery = new URLSearchParams();
    const comparisonId = one(search.comparison);
    const siteId = one(search.site);
    if (comparisonId !== undefined) retryQuery.set("comparison", comparisonId);
    if (siteId) retryQuery.set("site", siteId);
    return (
      <WorkspaceView
        projectId={projectId}
        view="simulator"
        decisionLayout
        title="Simulator"
        allowUnknownProject
      >
        <SimulatorRecovery
          kind={loaded.kind}
          workspaceHref={workspaceHref(projectId, "workspace")}
          exampleHref={`${workspaceHref(getPreviewProject(projectId) ? projectId : "houston-coffee", "simulator")}?example=1`}
          retryHref={`${workspaceHref(projectId, "simulator")}?${retryQuery}`}
        />
      </WorkspaceView>
    );
  }
  const stored = loaded.kind === "stored" ? loaded.value : null;
  // Explicit example recovery must not immediately restore the failed browser reference.
  const restore =
    loaded.kind !== "example" || search.example === "1" ? null : (
      <RestoreSavedComparison projectId={projectId} />
    );
  if (loaded.kind === "example" && !getPreviewProject(projectId))
    return (
      <>
        {restore}
        <WorkspaceView projectId={projectId} view="simulator" />
      </>
    );
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
              comparisonId:
                loaded.kind === "stored" ? loaded.comparisonId : undefined,
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
  return (
    <SimulatorContext projectId={projectId}>
      {restore}
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
          matterport={
            sdkKey
              ? {
                  sdkKey,
                  modelId: publicCafeScan.modelId,
                  // HAC-138: proposed service-area overlay from the café's
                  // registry row; not a measured business layout.
                  placement: {
                    origin: publicCafeScan.placement.origin,
                    rotationY: publicCafeScan.placement.rotationY,
                    scale: publicCafeScan.placement.scale,
                  },
                  viewpoint: cafeViewpoint,
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
