import Link from "next/link";
import { IntakeScreen } from "@/components/intake/intake-screen";
import { workspaceHref, views, type View } from "@/lib/client/workspace-routes";
import { getPreviewProject } from "@/lib/workspace-preview";
import type { PreviewProject } from "@/lib/contracts/workspace-preview";

export type PreviewPageProps = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ site?: string | string[] }>;
};

export function WorkspaceView({ projectId, view, siteId }: { projectId: string; view: View; siteId?: string }) {
  const project = getPreviewProject(projectId);
  const selectedId = siteId ?? project?.sites[0]?.id;
  const site = project?.sites.find((entry) => entry.id === selectedId);

  return (
    <>
      <nav aria-label="Project views" className="flex flex-wrap gap-1 border-b border-line pb-3">
        {(Object.keys(views) as View[]).map((item) => (
          <Link key={item} href={workspaceHref(projectId, item, selectedId)}
            aria-current={item === view ? "page" : undefined}
            className="rounded-lg px-4 py-2 text-sm font-medium text-muted hover:bg-white aria-[current=page]:bg-pine aria-[current=page]:text-white">
            {views[item]}
          </Link>
        ))}
      </nav>
      <header className="my-10">
        <p className="mb-2 text-sm font-medium text-muted">{project?.name ?? projectId}</p>
        <h1 className="text-4xl font-semibold tracking-tight">{views[view]}</h1>
      </header>
      <section aria-label={views[view]} className="rounded-2xl border border-line bg-white p-7">
        {project && (view !== "site" || site) ? (
          <>
            <PreviewContent view={view} project={project} site={site} />
            {view !== "intake" && <p className="mt-6 text-xs text-muted">Example data</p>}
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold">{project ? "Site unavailable" : "Project unavailable"}</h2>
            <Link className="mt-4 inline-block font-semibold text-pine underline"
              href={project ? workspaceHref(projectId, "map") : "/"}>
              {project ? "Browse spaces" : "Open example project"}
            </Link>
          </>
        )}
      </section>
    </>
  );
}

function PreviewContent({ view, project, site }: {
  view: View;
  project: PreviewProject;
  site?: PreviewProject["sites"][number];
}) {
  switch (view) {
    case "intake":
      return <IntakeScreen projectId={project.id} />;
    case "map":
      return (
        <ul className="grid gap-4 sm:grid-cols-2">
          {project.sites.map((entry) => (
            <li key={entry.id}>
              <Link href={workspaceHref(project.id, "site", entry.id)} className="block rounded-xl border border-line p-5 hover:bg-mint">
                <strong>{entry.address}</strong>
                <span className="mt-1 block text-sm text-muted">{entry.neighborhood}</span>
              </Link>
            </li>
          ))}
        </ul>
      );
    case "site":
      return site && (
        <div>
          <h2 className="text-xl font-semibold">{site.address}</h2>
          <p className="mt-2 text-muted">{site.neighborhood} · {site.squareFeet.toLocaleString("en-US")} sq ft</p>
        </div>
      );
    case "comparison":
      return (
        <div className="overflow-x-auto">
          <table className="w-full min-w-96 text-left">
            <thead><tr><th scope="col">Space</th><th scope="col">Neighborhood</th><th scope="col">Area</th></tr></thead>
            <tbody>{project.sites.map((entry) => (
              <tr key={entry.id} className="border-t border-line">
                <th scope="row" className="py-3"><Link className="underline" href={workspaceHref(project.id, "site", entry.id)}>{entry.address}</Link></th>
                <td>{entry.neighborhood}</td><td>{entry.squareFeet.toLocaleString("en-US")} sq ft</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      );
    case "replay":
      return (
        <ol className="list-decimal space-y-3 pl-5">
          <li>Business profile recorded for {project.business.toLowerCase()} in {project.city}.</li>
          <li>{project.sites.length} example spaces added to the shortlist.</li>
        </ol>
      );
  }
}
