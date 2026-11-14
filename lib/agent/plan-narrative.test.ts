import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlanFact, PlanReference } from "@/lib/contracts/plan";
import { generatePlanNarrative } from "./plan-narrative";

const references: PlanReference[] = [
  { comparisonId: "comparison-safe", metric: "profitRange" },
  { runId: "run-safe", metric: "staffing" },
  { evidenceId: "evidence-safe", metric: "rent" },
];
function facts(): PlanFact[] {
  return references.map((reference) => ({
    reference,
    range: { low: 912345, high: 987654 },
    unit: "private-unit-not-for-model",
    origins: ["default"],
    evidenceIds: ["private-source-not-for-model"],
    kind: "scenario_interval",
  }));
}
const statement = "Compare the scenario ranges before committing.";
const response = (reference: unknown = references[0], text = statement) => ({
  claims: [{ statement: text, references: [reference] }],
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("optional grounded plan narrative", () => {
  it("accepts all reference namespaces and closed templates without key-order dependence", async () => {
    const output = {
      claims: [
        {
          statement,
          references: [
            { metric: "profitRange", comparisonId: "comparison-safe" },
          ],
        },
        {
          statement: "Validate the cited assumption on site.",
          references: [references[2]],
        },
        {
          statement,
          references: [references[1]],
        },
      ],
    };
    await expect(
      generatePlanNarrative(facts(), async () => output),
    ).resolves.toEqual(output);
  });

  it("requires a tested sensitivity fact for the sensitivity template", async () => {
    const text = "Review the tested sensitivity before signing.";
    await expect(
      generatePlanNarrative(facts(), async () => response(references[0], text)),
    ).rejects.toThrow(/sensitivity/);
    const sensitivity: PlanFact = {
      ...facts()[0],
      reference: {
        comparisonId: "comparison-safe",
        metric: "sensitivity.rent",
      },
      kind: "tested_interval",
    };
    await expect(
      generatePlanNarrative([sensitivity], async () =>
        response(sensitivity.reference, text),
      ),
    ).resolves.toEqual(response(sensitivity.reference, text));
  });

  it("supplies only references, not fact values, origins, sources, or provider secrets", async () => {
    vi.stubEnv("OPENAI_API_KEY", "secret-provider-never-share");
    vi.stubEnv("OPENAI_MODEL", "private-provider-model");
    const invoke = vi.fn<(prompt: string) => Promise<unknown>>(async () =>
      response(),
    );
    await generatePlanNarrative(facts(), invoke);
    expect(invoke).toHaveBeenCalledTimes(1);
    const prompt = invoke.mock.calls[0]?.[0] as string;
    expect(prompt).toContain(JSON.stringify(references));
    expect(prompt).toContain("digits or spelled-out");
    for (const privateValue of [
      "912345",
      "987654",
      "private-unit",
      "private-source",
      "secret-provider",
      "private-provider",
      '"origins"',
      '"range"',
    ])
      expect(prompt).not.toContain(privateValue);
  });

  it.each([
    "Profit is 100 dollars.",
    "Profit is one hundred dollars.",
    "Compare the scenario ranges before committing. Rent is ten dollars.",
    "Guaranteed profit exceeds rent.",
  ])("rejects arbitrary prose: %s", async (text) => {
    await expect(
      generatePlanNarrative(facts(), async () => response(references[0], text)),
    ).rejects.toThrow();
  });

  it.each([
    { ...response(), value: 42 },
    { claims: [{ ...response().claims[0], value: 42 }] },
    response({ ...references[0], value: 42 }),
    response({ ...references[0], range: { low: 1, high: 2 } }),
    { claims: [{ ...response().claims[0], explanation: "one hundred" }] },
  ])("rejects injected fields %#", async (output) => {
    await expect(
      generatePlanNarrative(facts(), async () => output),
    ).rejects.toThrow();
  });

  it.each([
    { comparisonId: "unresolved", metric: "profitRange" },
    { comparisonId: "other-project-comparison", metric: "profitRange" },
    { runId: "other-project-run", metric: "staffing" },
    { evidenceId: "other-project-evidence", metric: "rent" },
    { comparisonId: "comparison-safe", metric: "__proto__.value" },
    { runId: "comparison-safe", metric: "profitRange" },
    { comparisonId: "comparison-safe", metric: "staffing" },
  ])("rejects unlisted exact reference identities %#", async (reference) => {
    await expect(
      generatePlanNarrative(facts(), async () => response(reference)),
    ).rejects.toThrow("unregistered reference");
  });

  it("checks every reference, not just the first", async () => {
    const output = response();
    output.claims[0].references.push({
      evidenceId: "unlisted",
      metric: "rent",
    });
    await expect(
      generatePlanNarrative(facts(), async () => output),
    ).rejects.toThrow("unregistered reference");
  });

  it("rejects empty fact inventories before invoking", async () => {
    const invoke = vi.fn();
    await expect(generatePlanNarrative([], invoke)).rejects.toThrow(
      "registered facts",
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it("never calls a default provider and propagates invocation failure without retries", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await generatePlanNarrative(facts(), async () => response());
    const failure = new Error("scripted failure");
    const invoke = vi.fn(async () => {
      throw failure;
    });
    await expect(generatePlanNarrative(facts(), invoke)).rejects.toBe(failure);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });
});
