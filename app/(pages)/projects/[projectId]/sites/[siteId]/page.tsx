import { WorkspaceView } from "@/components/workspace-view";

export default async function SitePage({ params }: { params: Promise<{ projectId: string; siteId: string }> }) {
  const { projectId, siteId } = await params;
  return <WorkspaceView projectId={projectId} view="site" siteId={siteId} />;
}
