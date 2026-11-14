"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import type { PreviewProject } from "@/lib/contracts/workspace-preview";
import { workspaceHref } from "@/lib/client/workspace-routes";

const CandidateMap = dynamic(() => import("./candidate-map"), {
  ssr: false,
  loading: () => <p role="status" className="grid h-96 place-items-center rounded-lg bg-paper">Loading map…</p>,
});

export function MapPreview({ project, selectedId }: { project: PreviewProject; selectedId?: string }) {
  const sites = project.sites.map((site) => ({ ...site, href: workspaceHref(project.id, "site", site.id) }));
  return (
    <>
      <CandidateMap projectId={project.id} sites={sites} selectedId={selectedId} />
      <ul aria-label="Candidate sites" className="mt-4 grid gap-3 sm:grid-cols-2">
        {sites.map((site) => (
          <li key={site.id}>
            <Link className="block rounded-lg border border-line p-4 hover:bg-mint" href={site.href}>
              <strong>{site.address}</strong><span className="block text-sm text-muted">{site.neighborhood}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
