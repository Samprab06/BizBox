"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { useSiteSearch } from "@/lib/client/use-site-search";
import { workspaceHref } from "@/lib/client/workspace-routes";
import type { PreviewProject } from "@/lib/contracts/workspace-preview";
import { useConsultant } from "@/components/shell/consultant-shell";
import { parseIntakeSession } from "./intake-conversation";
import { LocationPanel } from "./location-panel";
import { cityPhotoFor, selectedSpace, workspaceHeader } from "./model";
import { useContextIntake } from "@/lib/client/use-workspace-context";

/**
 * HAC-128: the screen a founder lands on after onboarding: one city/budget header and one
 * selected-location panel. HAC-143: the assistant (Text / Voice over one conversation) is
 * the consultant shell's dock in the project layout, so it is not mounted here.
 */
export function WorkspaceScreen({
  projectId,
  project,
  siteId,
}: {
  projectId: string;
  project: PreviewProject | null;
  siteId?: string;
}) {
  const headingId = useId();
  const consultant = useConsultant();
  // Outside a project layout (no shell) the saved session is read directly.
  const raw = useContextIntake(projectId);
  const session = consultant?.conversation.session ?? parseIntakeSession(raw);
  const { state: search } = useSiteSearch(projectId);
  const [expanded, setExpanded] = useState(false);
  const header = workspaceHeader(session, project);
  const space = selectedSpace(search, project, siteId);
  const selected = space.kind === "space" ? space : undefined;
  return (
    <section
      aria-labelledby={headingId}
      className="mt-6 min-w-0 rounded-3xl bg-viewport-canvas p-4 text-viewport-ink sm:p-6"
    >
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1
            id={headingId}
            className="text-xs font-semibold tracking-widest text-viewport-muted uppercase"
          >
            Workspace
          </h1>
          <p className="mt-1 text-3xl font-semibold tracking-tight [overflow-wrap:anywhere]">
            {header.city}
          </p>
          <p className="mt-2 flex flex-wrap gap-x-2 text-sm text-viewport-muted">
            <span>{header.business}</span>
            <span aria-hidden="true">/</span>
            <span>
              {header.budget}
              {header.budgetIsDefault && " (default)"}
            </span>
          </p>
        </div>
        <Link
          href={workspaceHref(projectId, "intake", selected?.id)}
          prefetch={false}
          className="flex items-center gap-2 rounded-xl border border-viewport-line px-4 py-2.5 text-sm hover:bg-viewport-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-viewport-ink"
        >
          Edit brief
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            aria-hidden="true"
            className="size-4"
          >
            <path d="m12 4 4 4M3 17l4-1L17 6l-3-3L4 13l-1 4Z" />
          </svg>
        </Link>
      </header>
      <div className="mt-5 grid min-w-0 gap-4 lg:h-[560px]">
        <LocationPanel
          projectId={projectId}
          photo={cityPhotoFor(header.city)}
          space={space}
          expanded={expanded}
          onExpandedChange={setExpanded}
        />
      </div>
    </section>
  );
}
