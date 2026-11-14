import Link from "next/link";
import type { ReactNode } from "react";
import {
  nextStep,
  taskForRoute,
  workspaceHref,
  workspaceTasks,
  type WorkspaceRoute,
} from "@/lib/client/workspace-routes";

/**
 * The workspace navigation: three founder tasks, the screens under each, the task the
 * founder is in, and the next step. The grouping lives in `lib/client/workspace-routes.ts`;
 * planned screens are skipped there, so only real routes are linked.
 */
export function TaskNav({
  projectId,
  route,
  siteId,
  compact = false,
  disclosureLabel,
  footer,
}: {
  projectId: string;
  route: WorkspaceRoute;
  siteId?: string;
  /** Decision pages keep the complete grouped navigation in a native disclosure. */
  compact?: boolean;
  disclosureLabel?: string;
  footer?: ReactNode;
}) {
  const currentTask = taskForRoute(route);
  const next = nextStep(route);

  const content = (
    <>
      <ol aria-label="Tasks" className="grid gap-4 md:grid-cols-3 md:gap-6">
        {workspaceTasks.map((task, index) => {
          const active = task.id === currentTask.id;
          return (
            <li key={task.id}>
              <p
                aria-current={active ? "step" : undefined}
                className={`mb-2 flex items-center gap-2 text-sm font-semibold ${active ? "text-ink" : "text-muted"}`}
              >
                <span
                  aria-hidden="true"
                  className={`grid size-6 shrink-0 place-items-center rounded-full text-xs ${
                    active ? "bg-pine text-on-pine" : "border border-line"
                  }`}
                >
                  {index + 1}
                </span>
                <span>{task.label}</span>
                {active && (
                  <span className="text-xs font-medium text-muted">
                    (current task)
                  </span>
                )}
              </p>
              <ul aria-label={task.label} className="flex flex-wrap gap-1">
                {task.entries.map((entry) => (
                  <li key={entry.route}>
                    <Link
                      href={workspaceHref(projectId, entry.route, siteId)}
                      prefetch={false}
                      aria-current={entry.route === route ? "page" : undefined}
                      className="block rounded-lg px-3 py-2 text-sm font-medium text-muted hover:bg-surface aria-[current=page]:bg-pine aria-[current=page]:text-on-pine"
                    >
                      {entry.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ol>
      {next && (
        <p className="mt-4 text-sm text-muted">
          <Link
            href={workspaceHref(projectId, next.route, siteId)}
            prefetch={false}
            data-next-step
            className="font-semibold text-pine underline"
          >
            Next: {next.step}
          </Link>
        </p>
      )}
    </>
  );

  return (
    <nav
      aria-label="Project views"
      className={
        "border-b border-line print:hidden " + (compact ? "pb-2" : "pb-4")
      }
    >
      {compact ? (
        <details>
          <summary className="cursor-pointer rounded text-sm font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-pine">
            {disclosureLabel ?? `Workspace tasks · ${currentTask.label}`}
            <span className="mt-1 block text-xs font-normal text-muted">
              {workspaceTasks.map((task) => task.label).join(" · ")}
            </span>
          </summary>
          <div className="mt-3">
            {content}
            {footer}
          </div>
        </details>
      ) : (
        content
      )}
    </nav>
  );
}
