"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { useSiteSearch } from "@/lib/client/use-site-search";
import { workspaceHref } from "@/lib/client/workspace-routes";
import type { PreviewProject } from "@/lib/contracts/workspace-preview";
import { AssistantPanel } from "./assistant-panel";
import { LocationPanel } from "./location-panel";
import { cityPhotoFor, selectedSpace, workspaceHeader } from "./model";
import { useIntakeConversation } from "./use-intake-conversation";

/**
 * HAC-128: the screen a founder lands on after onboarding. One city/budget header, one
 * selected-location panel and one assistant panel (Text / Voice over one conversation).
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
  const conversation = useIntakeConversation(projectId);
  const { state: search } = useSiteSearch(projectId);
  const [expanded, setExpanded] = useState(false);
  const header = workspaceHeader(conversation.session, project);
  const space = selectedSpace(search, project, siteId);
  const selected = space.kind === "space" ? space : undefined;
  const summary = [
    `City: ${header.city}`,
    `Business: ${header.business}`,
    header.budget,
    selected
      ? `Selected space: ${selected.name}${selected.example ? " (example)" : ""}`
      : "No space selected",
  ].join(". ");

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
          href={workspaceHref(projectId, "intake")}
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
      <div className="mt-5 grid min-w-0 gap-4 lg:h-[600px] lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
        <LocationPanel
          projectId={projectId}
          photo={cityPhotoFor(header.city)}
          space={space}
          expanded={expanded}
          onExpandedChange={setExpanded}
        />
        <AssistantPanel
          projectId={projectId}
          conversation={conversation}
          selectedSiteId={selected?.id}
          summary={summary}
        />
      </div>
    </section>
  );
}
