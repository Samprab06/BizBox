"use client";

import { agentViewForRoute } from "@/lib/client/agent-view-context";
import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/card";
import type { PreviewProject } from "@/lib/contracts/workspace-preview";
import {
  conceptFromSession,
  reportsForRoute,
  resolveWorkspaceContext,
  type WorkspaceContextModel,
  type WorkspaceReport,
} from "@/lib/client/workspace-context";
import {
  useContextIntake,
  AgentViewContextState,
  WorkspacePublicationContext,
  type WorkspacePublisher,
} from "@/lib/client/use-workspace-context";

function ExampleBadge() {
  return (
    <span className="inline-block shrink-0 rounded bg-mint px-2 py-0.5 text-xs font-semibold text-pine">
      Example
    </span>
  );
}

/**
 * Scene 1: the context is display-only. The top stepper is the flow's only back/forth
 * navigation, so these fields carry no links (the model's hrefs stay for other consumers).
 */
function ContextFields({ model }: { model: WorkspaceContextModel }) {
  const fields = [
    { label: "Business concept", field: model.concept },
    { label: "Selected location", field: model.location },
    { label: "Scenario", field: model.scenario },
    { label: "Data and model", field: model.status },
  ];
  return (
    <dl className="grid min-w-0 gap-4 md:grid-cols-[1.1fr_1.4fr_0.6fr_1.2fr]">
      {fields.map(({ label, field }) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs font-medium text-muted">{label}</dt>
          <dd className="mt-1 text-sm font-medium [overflow-wrap:anywhere]">
            <span className="text-pine">{field.text}</span>
            {label === "Selected location" && model.example && (
              <span className="ml-2">
                <ExampleBadge />
              </span>
            )}
            {label === "Data and model" && model.qualifier && (
              <span className="mt-1 block text-xs font-normal text-muted">
                {model.qualifier}
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ContextBar({ model }: { model: WorkspaceContextModel }) {
  return (
    <aside aria-label="Project context" className="mb-6 min-w-0 print:hidden">
      <Card>
        <div className="hidden md:block">
          <ContextFields model={model} />
        </div>
        <details className="group md:hidden">
          <summary className="flex min-w-0 cursor-pointer list-none items-center gap-2 rounded text-sm [&::-webkit-details-marker]:hidden focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-pine">
            <span className="sr-only">Project context: </span>
            <span className="min-w-0 flex-1 truncate">
              {model.concept.text} · {model.location.text} ·{" "}
              {model.scenario.text}
            </span>
            {model.example && (
              <>
                <span className="sr-only"> · </span>
                <ExampleBadge />
              </>
            )}
            <span className="sr-only"> · {model.status.text}</span>
            <span
              aria-hidden="true"
              className="shrink-0 text-pine group-open:hidden"
            >
              +
            </span>
            <span
              aria-hidden="true"
              className="hidden shrink-0 text-pine group-open:inline"
            >
              −
            </span>
          </summary>
          <div className="mt-4 border-t border-line pt-4">
            <ContextFields model={model} />
          </div>
        </details>
      </Card>
    </aside>
  );
}

const ProjectContextModelState = createContext<WorkspaceContextModel | null>(
  null,
);

/** Optional presentation of the active registry model inside a lifted project provider. */
export function ProjectContextBar() {
  const model = useContext(ProjectContextModelState);
  return model ? <ContextBar model={model} /> : null;
}

/** Presentation alias used by the navigation shell's context chips. */
export const ProjectContextChips = ProjectContextBar;

export function ProjectContextProvider({
  project,
  children,
  showContextBar = true,
}: {
  project: PreviewProject;
  children: ReactNode;
  /** Keep the default standalone presentation; persistent shells can place the bar explicitly. */
  showContextBar?: boolean;
}) {
  const [reports, setReports] = useState<Record<string, WorkspaceReport>>({});
  const publish = useCallback<WorkspacePublisher>((source, report) => {
    setReports((current) => {
      if (report) return { ...current, [source]: report };
      if (!(source in current)) return current;
      const next = { ...current };
      delete next[source];
      return next;
    });
  }, []);
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const intake = useContextIntake(project.id);
  const model = resolveWorkspaceContext({
    project,
    pathname,
    search,
    concept: conceptFromSession(intake),
    observations: reportsForRoute(reports, project.id, `${pathname}?${search}`),
  });
  return (
    <WorkspacePublicationContext.Provider value={publish}>
      <AgentViewContextState.Provider
        value={agentViewForRoute(project.id, pathname, search, reports)}
      >
        <ProjectContextModelState.Provider value={model}>
          {showContextBar && <ProjectContextBar />}
          {children}
        </ProjectContextModelState.Provider>
      </AgentViewContextState.Provider>
    </WorkspacePublicationContext.Provider>
  );
}
