import { describe, expect, it, vi } from "vitest";
import { PlanNarrativeSchema, type PlanFact } from "@/lib/contracts/plan";
import { generatePlanNarrative } from "./plan-narrative";

vi.mock("server-only", () => ({}));
const enabled =
  process.env.RUN_LIVE_PLAN_NARRATIVE === "1" &&
  Boolean(process.env.OPENAI_API_KEY?.trim());

describe.skipIf(!enabled)("live optional plan narrative", () => {
  it("selects closed templates citing only synthetic safe references", async () => {
    const { ChatOpenAI } = await import("@langchain/openai");
    const { DEFAULT_INTAKE_MODEL } = await import("./runner");
    const model = new ChatOpenAI({
      apiKey: process.env.OPENAI_API_KEY!.trim(),
      model: process.env.OPENAI_MODEL?.trim() || DEFAULT_INTAKE_MODEL,
      temperature: 0,
      reasoning: { effort: "none" },
      maxTokens: 500,
      maxRetries: 0,
      timeout: 10_000,
      configuration: { timeout: 10_000, maxRetries: 0 },
    });
    const reference = {
      comparisonId: "synthetic-safe-comparison",
      metric: "scenarioRange",
    };
    const facts: PlanFact[] = [
      {
        reference,
        range: { low: 10, high: 20 },
        unit: "synthetic units",
        origins: ["default"],
        evidenceIds: [],
        kind: "scenario_interval",
      },
    ];
    const narrative = await generatePlanNarrative(facts, async (prompt) => {
      const message = await model.invoke(prompt);
      if (typeof message.content !== "string")
        throw new Error("Expected JSON text");
      return JSON.parse(message.content);
    });
    expect(PlanNarrativeSchema.safeParse(narrative).success).toBe(true);
    expect(narrative.claims.length).toBeGreaterThan(0);
    for (const claim of narrative.claims)
      for (const cited of claim.references) expect(cited).toEqual(reference);
  }, 20_000);
});
