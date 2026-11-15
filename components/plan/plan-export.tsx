"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useWorkspaceReport } from "@/lib/client/use-workspace-context";
import { useProjectComparisonId } from "@/lib/client/project-store";
import {
  planContextSource,
  type WorkspaceObservation,
} from "@/lib/client/workspace-context";
import { workspaceHref } from "@/lib/client/workspace-routes";
import {
  PlanExportRefusal,
  preparePlanExport,
  type PrintablePlan,
} from "@/lib/export/plan";

type State =
  | { kind: "loading" }
  | { kind: "ready"; plan: PrintablePlan }
  | { kind: "outdated" }
  | { kind: "error"; message: string };

const ORIGIN_LABEL: Record<string, string> = {
  costar: "CoStar",
  public: "Public data",
  founder: "Founder",
  default: "Default",
};

/** HAC-26: printable plan for a saved, current comparison. */
export function PlanExport({
  projectId,
  comparisonId: urlComparisonId,
  investigationId,
}: {
  projectId: string;
  comparisonId?: string;
  investigationId?: string;
}) {
  // HAC-135: without ?comparison= the plan opens the project's saved comparison.
  // `undefined` means storage hasn't been read yet (server render, first paint).
  const resolved = useProjectComparisonId(projectId, urlComparisonId);
  const comparisonId = resolved ?? undefined;
  const [state, setState] = useState<State>({ kind: "loading" });
  const contextOwner = JSON.stringify([
    projectId,
    comparisonId,
    investigationId,
  ]);
  const [contextState, setContextState] = useState<{
    owner: string;
    observation: Extract<WorkspaceObservation, { kind: "plan" }>;
  } | null>(null);
  const context = useMemo<WorkspaceObservation>(
    () =>
      contextState?.owner === contextOwner
        ? contextState.observation
        : { kind: "plan", phase: "loading", comparisonId, siteIds: [] },
    [contextState, contextOwner, comparisonId],
  );
  useWorkspaceReport(projectId, context);

  useEffect(() => {
    if (!comparisonId) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ projectId });
    const id = encodeURIComponent(comparisonId);
    const planQuery = new URLSearchParams(query);
    if (investigationId) planQuery.set("investigationId", investigationId);
    (async () => {
      let source: ReturnType<typeof planContextSource> = null;
      try {
        const [comparison, plan] = await Promise.all(
          [
            `/api/comparisons/${id}?${query}`,
            `/api/comparisons/${id}/plan?${planQuery}`,
          ].map(async (url) => {
            const response = await fetch(url, {
              signal: controller.signal,
              cache: "no-store",
            });
            if (!response.ok)
              throw new Error(`Request failed (${response.status})`);
            return response.json();
          }),
        );
        source = planContextSource(comparison, projectId, comparisonId);
        const printable = preparePlanExport({
          projectId,
          comparisonId,
          comparison,
          plan,
        });
        setState({ kind: "ready", plan: printable });
        if (!controller.signal.aborted)
          setContextState({
            owner: contextOwner,
            observation: {
              kind: "plan",
              phase: "ready",
              comparisonId: printable.comparisonId,
              siteIds: [],
              ...source,
            },
          });
      } catch (error) {
        if (controller.signal.aborted) return;
        setContextState({
          owner: contextOwner,
          observation: {
            kind: "plan",
            phase:
              error instanceof PlanExportRefusal && error.code === "outdated"
                ? "outdated"
                : "error",
            comparisonId,
            siteIds: [],
            ...source,
          },
        });
        if (error instanceof PlanExportRefusal && error.code === "outdated")
          setState({ kind: "outdated" });
        else
          setState({
            kind: "error",
            message:
              error instanceof PlanExportRefusal
                ? error.message
                : "The plan could not be loaded.",
          });
      }
    })();
    return () => controller.abort();
  }, [projectId, comparisonId, investigationId, contextOwner]);

  const comparisonLink = workspaceHref(projectId, "comparison");
  if (resolved === undefined) return <p role="status">Preparing the plan…</p>;
  if (!comparisonId)
    return (
      <p role="status">
        Choose a saved comparison first.{" "}
        <Link
          className="font-semibold text-accent underline"
          href={comparisonLink}
        >
          Open the comparison
        </Link>
      </p>
    );
  if (state.kind === "loading") return <p role="status">Preparing the plan…</p>;
  if (state.kind === "outdated")
    return (
      <div role="alert" className="rounded-xl border border-line p-4">
        <p className="font-semibold">This comparison is outdated.</p>
        <p className="mt-1 text-sm">
          The profile changed after it ran. Rerun the comparison, then export
          its plan.
        </p>
        <Link
          className="mt-3 inline-block font-semibold text-accent underline"
          href={comparisonLink}
        >
          Rerun the comparison
        </Link>
      </div>
    );
  if (state.kind === "error")
    return (
      <p role="alert">
        {state.message}{" "}
        <Link
          className="font-semibold text-accent underline"
          href={comparisonLink}
        >
          Back to the comparison
        </Link>
      </p>
    );

  const { plan } = state;
  return (
    <article
      aria-labelledby="plan-title"
      className="space-y-6 print:space-y-4 print:text-[11pt]"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="plan-title" className="text-2xl font-semibold">
            {plan.title}
          </h2>
          <p className="text-sm text-muted">Comparison {plan.comparisonId}</p>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded bg-accent hover:bg-accent-hover px-3 py-2 text-sm font-semibold text-on-accent print:hidden"
        >
          Print or save as PDF
        </button>
      </header>
      <section
        aria-label="Recommendation"
        className="rounded-xl border border-line p-4 print:border-0 print:p-0"
      >
        <p className="font-semibold">{plan.recommendation}</p>
        <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted">Recommended site</dt>
            <dd>{plan.recommendedSite ?? "None yet"}</dd>
          </div>
          <div>
            <dt className="text-muted">Runner-up</dt>
            <dd>{plan.runnerUp ?? "None"}</dd>
          </div>
          {plan.tied.length > 0 && (
            <div className="sm:col-span-2">
              <dt className="text-muted">Effectively tied</dt>
              <dd>{plan.tied.join(", ")}</dd>
            </div>
          )}
        </dl>
      </section>
      {plan.sections.map((section) => (
        <section
          key={section.id}
          aria-labelledby={`plan-${section.id}`}
          className="break-inside-avoid-page"
        >
          <h3 id={`plan-${section.id}`} className="text-lg font-semibold">
            {section.title}
          </h3>
          {section.notes.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              {section.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
          {section.rows.length > 0 && (
            <table className="mt-2 w-full table-fixed border-collapse text-sm">
              <thead className="sr-only">
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col">Value</th>
                  <th scope="col">Origin and source</th>
                </tr>
              </thead>
              <tbody>
                {section.rows.map((row, i) => (
                  <tr
                    key={`${row.label}-${i}`}
                    className="border-t border-line align-top"
                  >
                    <th
                      scope="row"
                      className="w-2/5 py-1.5 pr-3 text-left font-medium break-words"
                    >
                      {row.label}
                    </th>
                    <td className="w-1/4 py-1.5 pr-3 break-words">
                      {row.value}
                    </td>
                    <td className="py-1.5 text-xs text-muted break-words">
                      {row.origins.map((o) => ORIGIN_LABEL[o] ?? o).join(", ")}
                      {row.citations.length > 0 && (
                        <span className="block">
                          {row.citations.join("; ")}
                        </span>
                      )}
                      {row.note && <span className="block">{row.note}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}
      <footer className="border-t border-line pt-4 text-xs text-muted">
        <h3 className="font-semibold text-ink">Sources</h3>
        <ul className="mt-1 space-y-1">
          {plan.attributions.map((a) => (
            <li key={a.label}>
              <strong>{a.label}</strong> · {a.detail}
            </li>
          ))}
        </ul>
        <ul className="mt-3 space-y-1">
          {plan.limitations.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </footer>
    </article>
  );
}
