import Link from "next/link";
import type { ReactNode } from "react";
import { IntakeScreen } from "@/components/intake/intake-screen";
import { MapPreview } from "@/components/map/map-preview";
import { SiteScreen } from "@/components/site/site-screen";
import { TaskNav } from "@/components/shell/task-nav";
import { workspaceHref, views, type View } from "@/lib/client/workspace-routes";
import { getPreviewProject } from "@/lib/workspace-preview";
import type { PreviewProject } from "@/lib/contracts/workspace-preview";

export type PreviewPageProps = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{
    site?: string | string[];
    visits?: string | string[];
    comparison?: string | string[];
    investigation?: string | string[];
    day?: string | string[];
  }>;
};

export function WorkspaceView({
  projectId,
  view,
  siteId,
  children,
  title,
  allowUnknownProject = false,
}: {
  projectId: string;
  view: View;
  siteId?: string;
  children?: ReactNode;
  title?: string;
  allowUnknownProject?: boolean;
}) {
  const project = getPreviewProject(projectId);
  const selectedId = siteId ?? project?.sites[0]?.id;
  const site = project?.sites.find((entry) => entry.id === selectedId);

  return (
    <>
      <TaskNav projectId={projectId} route={view} siteId={selectedId} />
      <header className="my-10">
        <p className="mb-2 text-sm font-medium text-muted">
          {project?.name ?? projectId}
        </p>
        <h1 className="text-4xl font-semibold tracking-tight">
          {title ?? views[view]}
        </h1>
      </header>
      <section
        aria-label={view === "map" ? "Candidate locations" : views[view]}
        className="rounded-2xl border border-line bg-white p-7"
      >
        {project || allowUnknownProject ? (
          <>
            {children ??
              (project ? (
                <PreviewContent
                  view={view}
                  project={project}
                  site={site}
                  mapSelection={siteId}
                />
              ) : null)}
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold">
              {project ? "Site unavailable" : "Project unavailable"}
            </h2>
            <Link
              className="mt-4 inline-block font-semibold text-pine underline"
              href={project ? workspaceHref(projectId, "map") : "/"}
            >
              {project ? "Browse spaces" : "Open example project"}
            </Link>
          </>
        )}
      </section>
    </>
  );
}

function PreviewContent({
  view,
  project,
  site,
  mapSelection,
}: {
  view: View;
  project: PreviewProject;
  site?: PreviewProject["sites"][number];
  mapSelection?: string;
}) {
  switch (view) {
    case "intake":
      return <IntakeScreen projectId={project.id} />;
    case "map":
      return <MapPreview project={project} selectedId={mapSelection} />;
    case "site":
      return (
        <SiteScreen
          key={mapSelection ?? site?.id ?? "unselected"}
          project={project}
          siteId={mapSelection ?? site?.id ?? "unselected"}
        />
      );
    case "comparison":
    case "replay":
    case "simulator":
      return null;
  }
}
