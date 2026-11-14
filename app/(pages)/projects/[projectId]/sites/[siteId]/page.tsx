import { notFound } from "next/navigation";
import { getPreviewProject } from "@/lib/workspace-preview";
import { WorkspaceView } from "@/components/workspace-view";
import { SiteScreen } from "@/components/site/site-screen";
import { buildFixtureInsights } from "@/lib/insights/fixture";
import { STATION_EXPERIMENT_FIXTURES } from "@/lib/insights/station-experiment-fixture";

export default async function SitePage({
  params,
}: {
  params: Promise<{ projectId: string; siteId: string }>;
}) {
  const { projectId, siteId: rawSiteId } = await params;
  let siteId: string;
  try {
    siteId = decodeURIComponent(rawSiteId);
  } catch {
    notFound();
  }
  const project = getPreviewProject(projectId);
  if (
    !project ||
    (siteId !== "unselected" &&
      !/^\d+:\d+$/.test(siteId) &&
      !project.sites.some((site) => site.id === siteId))
  ) {
    notFound();
  }
  const fixtureInsights = project.sites.some((site) => site.id === siteId)
    ? buildFixtureInsights({ siteId })
    : undefined;
  return (
    <WorkspaceView projectId={projectId} view="site" siteId={siteId}>
      <SiteScreen
        key={siteId}
        project={project}
        siteId={siteId}
        fixtureInsights={fixtureInsights}
        fixtureStationCallouts={
          fixtureInsights ? STATION_EXPERIMENT_FIXTURES[siteId] : undefined
        }
      />
    </WorkspaceView>
  );
}
