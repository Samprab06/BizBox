import { isDeepStrictEqual } from "node:util";
import type { CopilotEvent } from "@/lib/contracts/copilot-runtime";
import { diffScenarios } from "@/lib/scenario/model";
import { createCopilotRuntime } from "../copilot";
import type { CopilotDecisionModel } from "../copilot-model";
import { createMemoryThreadStore } from "./memory-thread-store";
import { createEvalWorkspace, type EvalWorkspace } from "./workspace";
import {
  ANY,
  EVAL_CASES,
  type EvalCase,
  type EvalStep,
  type ExpectedCall,
  type ExpectedDiff,
} from "./cases";

/** Replaces `$BASE`/`$RUN` placeholders with this workspace's IDs. */
export function bindArgs(value: unknown, workspace: EvalWorkspace): unknown {
  if (value === "$BASE") return workspace.base.id;
  if (value === "$RUN") return workspace.weekdayRunId;
  if (Array.isArray(value)) return value.map((v) => bindArgs(v, workspace));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, bindArgs(v, workspace)]),
    );
  return value;
}

/** Offline model: returns the case's golden decisions in order, then finishes. */
export function scriptedModel(
  steps: readonly EvalStep[],
  workspace: EvalWorkspace,
): CopilotDecisionModel {
  const queue = [...steps];
  return async () => {
    const step = queue.shift() ?? { tool: "finish" };
    return {
      tool: step.tool,
      argsJson: JSON.stringify(bindArgs(step.args ?? {}, workspace)),
      findings: [],
      reply: step.reply ?? "",
      todos: [],
    };
  };
}

export type ObservedCall = {
  tool: string;
  args: unknown;
  outcome: "completed" | "blocked";
};
export type EvalResult = {
  id: string;
  request: string;
  calls: ObservedCall[];
  diffs: ExpectedDiff[];
  stripped: string[];
  toolCallsCorrect: boolean;
  diffsCorrect: boolean;
  guardCorrect: boolean;
  error?: string;
};

function partialMatch(expected: unknown, actual: unknown): boolean {
  if (expected === ANY) return actual !== undefined;
  if (expected && typeof expected === "object" && !Array.isArray(expected))
    return (
      !!actual &&
      typeof actual === "object" &&
      Object.entries(expected).every(([key, value]) =>
        partialMatch(value, (actual as Record<string, unknown>)[key]),
      )
    );
  return isDeepStrictEqual(expected, actual);
}

export function callsMatch(
  expected: readonly ExpectedCall[],
  observed: readonly ObservedCall[],
) {
  return (
    expected.length === observed.length &&
    expected.every(
      (call, i) =>
        call.tool === observed[i].tool &&
        (call.outcome ?? "completed") === observed[i].outcome &&
        (call.args === undefined || partialMatch(call.args, observed[i].args)),
    )
  );
}

export function diffsMatch(
  expected: readonly ExpectedDiff[],
  observed: readonly ExpectedDiff[],
) {
  return (
    expected.length === observed.length &&
    expected.every((diff, i) => isDeepStrictEqual(diff, observed[i]))
  );
}

/** Human-readable diff of a created child against its parent. */
function summarizeDiff(workspace: EvalWorkspace, childId: string) {
  const child = workspace.scenarios().find((s) => s.id === childId);
  const parent = workspace
    .scenarios()
    .find((s) => child && s.id === child.parentId);
  if (!child || !parent) return {};
  const diff = diffScenarios(parent, child);
  const out: ExpectedDiff = {};
  for (const row of diff.overrides) out[row.key] = row.to?.value ?? null;
  for (const row of diff.scalars)
    if (row.field === "label" || row.field === "profileVersion")
      out[row.field] = row.to;
  if (diff.sites.added.length || diff.sites.removed.length)
    out.sites = diff.sites;
  return out;
}

/** Runs one case through the real copilot runtime and tools, and scores it. */
export async function runEvalCase(
  testCase: EvalCase,
  model: (workspace: EvalWorkspace) => CopilotDecisionModel,
): Promise<EvalResult> {
  const workspace = await createEvalWorkspace();
  const runtime = createCopilotRuntime({
    store: createMemoryThreadStore(),
    tools: workspace.tools as unknown as Parameters<
      typeof createCopilotRuntime
    >[0]["tools"],
    choose: model(workspace),
    validateContext: async () => {},
    newId: (() => {
      let n = 0;
      return () => `${testCase.id}-${++n}`;
    })(),
  });
  const events: CopilotEvent[] = [];
  let error: string | undefined;
  try {
    for await (const event of runtime.start(
      workspace.context.projectId,
      {
        message: testCase.request,
        requestId: `eval:${testCase.id}`,
        context: workspace.context,
      },
      AbortSignal.timeout(30_000),
    ))
      events.push(event);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Turn failed";
  }
  const snapshot = await runtime.snapshot(workspace.context.projectId);
  const calls: ObservedCall[] = snapshot.toolCalls.map((call) => ({
    tool: call.name,
    args: call.input,
    outcome: call.status === "completed" ? "completed" : "blocked",
  }));
  const diffs = snapshot.proposals.map((proposal) =>
    summarizeDiff(workspace, proposal.proposedScenarioId!),
  );
  const stripped = snapshot.messages.flatMap((message) => {
    const guard = message.metadata?.numberGuard as
      { removed?: string[] } | undefined;
    return guard?.removed ?? [];
  });
  return {
    id: testCase.id,
    request: testCase.request,
    calls,
    diffs,
    stripped,
    toolCallsCorrect: callsMatch(testCase.expected.calls, calls),
    diffsCorrect: diffsMatch(testCase.expected.diffs, diffs),
    guardCorrect: isDeepStrictEqual(
      testCase.expected.strippedNumbers ?? [],
      stripped,
    ),
    ...(error ? { error } : {}),
  };
}

export type EvalReport = {
  model: string;
  cases: number;
  toolCallAccuracy: number;
  diffAccuracy: number;
  guardAccuracy: number;
  results: EvalResult[];
};

export async function runEvalSuite(
  model: (workspace: EvalWorkspace, testCase: EvalCase) => CopilotDecisionModel,
  label: string,
  cases: readonly EvalCase[] = EVAL_CASES,
): Promise<EvalReport> {
  const results: EvalResult[] = [];
  for (const testCase of cases)
    results.push(
      await runEvalCase(testCase, (workspace) => model(workspace, testCase)),
    );
  const share = (pick: (r: EvalResult) => boolean) =>
    results.length ? results.filter(pick).length / results.length : 0;
  return {
    model: label,
    cases: results.length,
    toolCallAccuracy: share((r) => r.toolCallsCorrect),
    diffAccuracy: share((r) => r.diffsCorrect),
    guardAccuracy: share((r) => r.guardCorrect),
    results,
  };
}

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

/** Markdown report for docs/copilot-evals.md. */
export function formatEvalReport(report: EvalReport): string {
  const mark = (ok: boolean) => (ok ? "pass" : "FAIL");
  return [
    `### ${report.model}`,
    "",
    `- Cases: ${report.cases}`,
    `- Tool-call accuracy: ${percent(report.toolCallAccuracy)}`,
    `- Diff accuracy: ${percent(report.diffAccuracy)}`,
    `- Number-guard accuracy: ${percent(report.guardAccuracy)}`,
    "",
    "| Case | Request | Tool calls | Diff | Guard |",
    "|---|---|---|---|---|",
    ...report.results.map(
      (r) =>
        `| ${r.id} | ${r.request} | ${mark(r.toolCallsCorrect)} | ${mark(r.diffsCorrect)} | ${mark(r.guardCorrect)} |`,
    ),
    "",
  ].join("\n");
}
