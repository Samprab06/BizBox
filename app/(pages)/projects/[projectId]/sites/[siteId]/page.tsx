import { notFound } from "next/navigation";
import { getPreviewProject } from "@/lib/workspace-preview";
import { WorkspaceView } from "@/components/workspace-view";

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
  return <WorkspaceView projectId={projectId} view="site" siteId={siteId} />;
}
