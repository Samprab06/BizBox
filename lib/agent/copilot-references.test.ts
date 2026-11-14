import { describe, expect, it } from "vitest";
import { createCopilotExample } from "@/fixtures/copilot";
import { deriveScenario } from "@/lib/scenario/model";
import { buildScenarioPatch } from "@/lib/scenario/patch";
import { resolveCopilotReference } from "./copilot-references";

function setup() {
  const example = createCopilotExample();
  const child = deriveScenario(
    example.scenario,
    buildScenarioPatch(
      example.scenario,
      { kind: "price", averageTicketCents: 600 },
      { origin: "default", evidenceIds: ["action"] },
    ),
    {
      id: "proposal",
      author: "agent",
      rationale: "Try cached price",
      createdAt: "2026-11-14T01:00:00Z",
    },
  );
  const scope = {
    projectId: example.profile.projectId,
    scenarios: [example.scenario, child],
    comparisons: [example.comparison],
  };
  const resolve = (reference: unknown) =>
    resolveCopilotReference({
      ...scope,
      reference,
      issuedReferences: [reference],
    });
  return { ...example, child, scope, resolve };
}
describe("copilot reference display resolver", () => {
  it("resolves only issued references and closed scenario value paths", () => {
    const { scope, child, resolve } = setup();
    const reference = {
      kind: "scenario_value",
      scenarioId: child.id,
      path: "overrides.averageTicketCents",
    };
    expect(resolve(reference)).toMatchObject({
      value: 600,
      unit: "cents",
      origin: "default",
      evidenceIds: ["action"],
    });
    expect(() =>
      resolveCopilotReference({ ...scope, reference, issuedReferences: [] }),
    ).toThrow(/not issued/);
    expect(() =>
      resolve({ ...reference, path: "__proto__.constructor" }),
    ).toThrow(/cannot be resolved/);
  });
  it("resolves a recorded metric rather than a model-authored number", () => {
    const { resolve, comparison, scenario } = setup();
    expect(
      resolve({
        kind: "comparison_metric",
        comparisonId: comparison.id,
        siteId: scenario.siteIds[0],
        metric: "monthlyRevenueUsd",
        statistic: "low",
      }),
    ).toMatchObject({
      value: comparison.evaluation.result.sites[0].monthlyRevenueUsd.low,
      origin: "default",
    });
    expect(() =>
      resolve({
        kind: "comparison_metric",
        comparisonId: comparison.id,
        siteId: scenario.siteIds[0],
        metric: "monthlyRevenueUsd",
        statistic: "low",
        value: 999999,
      }),
    ).toThrow();
  });
  it("uses conservative unpaired interval subtraction, not low-minus-low confidence", () => {
    const { scope, comparison, scenario } = setup();
    const alternative = structuredClone(comparison);
    alternative.id = "other";
    alternative.comparison.id = "other";
    comparison.evaluation.result.sites[0].monthlyRevenueUsd = {
      low: 10,
      mean: 20,
      median: 20,
      high: 30,
    };
    alternative.evaluation.result.sites[0].monthlyRevenueUsd = {
      low: 20,
      mean: 40,
      median: 40,
      high: 60,
    };
    const reference = {
      kind: "comparison_delta",
      comparisonIdA: comparison.id,
      comparisonIdB: alternative.id,
      siteId: scenario.siteIds[0],
      metric: "monthlyRevenueUsd",
      statistic: "low",
    };
    expect(
      resolveCopilotReference({
        ...scope,
        comparisons: [comparison, alternative],
        reference,
        issuedReferences: [reference],
      }),
    ).toMatchObject({
      value: -10,
      limitation: expect.stringContaining("not paired"),
    });
  });
  it("resolves saved representative hourly data only", () => {
    const { comparison, resolve } = setup();
    const run = comparison.runs[0];
    const trace =
      comparison.evaluation.result.sites[0].representative[run.dayType]
        .hourly[0];
    expect(
      resolve({
        kind: "hour_metric",
        runId: run.id,
        hour: trace.hour,
        metric: "arrivals",
      }),
    ).toMatchObject({
      value: trace.arrivals,
      limitation: "Saved representative run only",
    });
    expect(() =>
      resolve({
        kind: "hour_metric",
        runId: run.id,
        hour: 23,
        metric: "arrivals",
      }),
    ).toThrow();
  });
  it("resolves cached acceptance shifts per persona without averaging them into invented evidence", () => {
    const { resolve, comparison, child, scenario } = setup();
    const output = resolve({
      kind: "price_acceptance_shift",
      comparisonId: comparison.id,
      scenarioId: child.id,
      siteId: scenario.siteIds[0],
    });
    expect(output).toMatchObject({
      value: expect.arrayContaining([
        expect.objectContaining({
          before: 0.9,
          after: 0.6,
          shift: expect.closeTo(-0.3),
        }),
      ]),
      limitation: expect.stringContaining("not a new panel"),
    });
  });
  it("refuses foreign artifacts, missing parent context and wrong scenario lineage", () => {
    const { scope, comparison, child, scenario, resolve } = setup();
    const reference = {
      kind: "price_acceptance_shift",
      comparisonId: comparison.id,
      scenarioId: child.id,
      siteId: scenario.siteIds[0],
    };
    expect(() =>
      resolveCopilotReference({
        ...scope,
        projectId: "foreign",
        reference,
        issuedReferences: [reference],
      }),
    ).toThrow();
    expect(() =>
      resolveCopilotReference({
        ...scope,
        scenarios: [child],
        reference,
        issuedReferences: [reference],
      }),
    ).toThrow();
    expect(() => resolve({ ...reference, scenarioId: scenario.id })).toThrow();
    comparison.evaluation.result.profileId = "foreign";
    expect(() => resolve(reference)).toThrow();
  });
});
