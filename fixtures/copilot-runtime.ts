import {
  CopilotContextSchema,
  CopilotEventSchema,
  type CopilotEvent,
  type CopilotSourceLabel,
} from "@/lib/contracts/copilot-runtime";

/** Presentation/scripted-model examples only: no real geometry, traffic, paid
 * calls or simulation results are asserted by these synthetic transcripts. */
export function createCopilotRuntimeFixture(
  city: "Houston" | "Los Angeles",
  category: "coffee" | "quick_food" | "salon_barber" | "fitness",
) {
  const key = `${city === "Houston" ? "houston" : "los-angeles"}-${category}`;
  const context = CopilotContextSchema.parse({
    projectId: `fixture:${key}`,
    profileId: `fixture:${key}:profile`,
    profileVersion: 1,
    siteId: `fixture:${key}:site`,
    scenarioId: `fixture:${key}:baseline`,
    runId: `fixture:${key}:run`,
    day: "weekday",
    minute: 485,
    page: `/projects/fixture:${key}/replay`,
    view: "city",
    selectedCustomerId: `fixture:${key}:customer`,
    chartId: "queue",
    revision: 1,
  });
  const sources: CopilotSourceLabel[] = [
    {
      kind: "modeled",
      label: "Synthetic example, not measured pedestrian traffic",
      evidenceIds: [],
    },
    {
      kind: "default",
      label: "Illustrative category assumptions, not calibrated predictions",
      evidenceIds: [],
      origin: "default",
    },
    {
      kind: "fallback",
      label: "Modeled fallback demand; Jev was not called",
      evidenceIds: [],
    },
    {
      kind: "interior",
      label: "Modeled interior; no measured geometry available",
      evidenceIds: [],
      interiorSource: "modeled",
    },
  ];
  const proposal = {
    id: `fixture:${key}:proposal`,
    baseScenarioId: context.scenarioId!,
    title: "Review a lower-cost alternative",
    description:
      "A proposed staffing change needs your Run approval before evaluation; Keep or Revert remains your choice.",
    status: "pending" as const,
    evidenceIds: [],
  };
  const payloads = [
    { type: "turn_started", requestId: `fixture:${key}:request` },
    {
      type: "todos",
      todos: [
        {
          id: "review",
          content: "Review the selected baseline",
          status: "in_progress",
        },
      ],
    },
    {
      type: "tool_started",
      callId: "fixture:read",
      tool: "explain_comparison",
    },
    {
      type: "tool_completed",
      callId: "fixture:read",
      tool: "explain_comparison",
      result: { synthetic: true, availability: "example_only" },
      sources,
    },
    {
      type: "assistant_delta",
      text: `${city} ${category.replaceAll("_", " ")}: this example proposes an alternative; no new simulation has run.`,
      sources,
    },
    { type: "proposal", proposal },
    {
      type: "ui",
      action: "focus_view",
      target: { ...context, view: "comparison" },
    },
    {
      type: "todos",
      todos: [
        {
          id: "review",
          content: "Review the selected baseline",
          status: "completed",
        },
      ],
    },
    {
      type: "turn_finished",
      status: "completed",
      message: "Proposal saved. Choose Run to evaluate it.",
    },
  ];
  const events: CopilotEvent[] = payloads.map((payload, sequence) =>
    CopilotEventSchema.parse({
      threadId: `fixture:${key}:thread`,
      turnId: `fixture:${key}:turn`,
      sequence,
      context,
      ...payload,
    }),
  );
  return {
    city,
    category,
    synthetic: true as const,
    context,
    proposal,
    events,
  };
}

export const copilotRuntimeFixtures = (
  ["Houston", "Los Angeles"] as const
).flatMap((city) =>
  (["coffee", "quick_food", "salon_barber", "fitness"] as const).map(
    (category) => createCopilotRuntimeFixture(city, category),
  ),
);
