import { describe, expect, it } from "vitest";
import { buildLocationPlan } from "@/lib/agent/plan";
import { fixture } from "@/lib/agent/__fixtures__/plan";
import { SITE_A, SITE_B } from "@/lib/demand/fixtures";
import {
  ATTRIBUTIONS,
  OUTDATED_LIMITATION,
  formatFact,
  PlanExportRefusal,
  preparePlanExport,
} from "./plan";

function inputs(outdated = false) {
  const f = fixture();
  const plan = buildLocationPlan(f);
  const comparison = {
    comparisonId: f.comparison.id,
    outdated,
    result: f.comparison.evaluation.result,
  };
  return {
    projectId: f.projectId,
    comparisonId: f.comparison.id,
    comparison,
    plan,
  };
}

describe("printable location plan (HAC-26)", () => {
  it("projects the grounded plan into cited, range-only sections with attributions", () => {
    const out = preparePlanExport({
      ...inputs(),
      siteLabels: { [SITE_A.id]: "Site A storefront" },
    });
    expect(out.recommendedSite).toBe("Site A storefront");
    expect(out.runnerUp).toBe(SITE_B.id);
    expect(out.sections.map((s) => s.id)).toEqual(
      expect.arrayContaining(["comparison", "assumptions"]),
    );
    const rows = out.sections.flatMap((s) => s.rows);
    expect(rows.length).toBeGreaterThan(0);
    // Every figure row carries a citation; origins come from the closed vocabulary.
    for (const row of rows) {
      expect(row.citations.length).toBeGreaterThan(0);
      for (const origin of row.origins)
        expect(["costar", "public", "founder", "default"]).toContain(origin);
    }
    expect(out.attributions).toEqual(ATTRIBUTIONS);
    expect(out.limitations.join(" ")).toMatch(/not a sales forecast/);
  });

  it("never exports source free text, photos or private payload fields", () => {
    const base = inputs();
    const plan = structuredClone(base.plan) as Record<string, unknown>;
    (plan as { privateBrokerContact?: string }).privateBrokerContact =
      "MUST_NOT_LEAK";
    // The schema is strict, so unknown fields make the plan invalid rather than leaking.
    expect(() => preparePlanExport({ ...base, plan })).toThrow(
      PlanExportRefusal,
    );
    const text = JSON.stringify(preparePlanExport(base));
    expect(text).not.toMatch(/matterport|photo url|attachmentUri|broker/i);
  });

  it("still exports an outdated comparison, flagged with a limitation", () => {
    const out = preparePlanExport(inputs(true));
    expect(out.outdated).toBe(true);
    expect(out.limitations[0]).toBe(OUTDATED_LIMITATION);
    expect(out.sections.length).toBeGreaterThan(0);
    expect(preparePlanExport(inputs()).outdated).toBe(false);
  });

  it("refuses an unverifiable comparison", () => {
    expect(() =>
      preparePlanExport({ ...inputs(), comparison: { nope: true } }),
    ).toThrow(PlanExportRefusal);
  });

  it("refuses a plan or comparison from another project or comparison", () => {
    const base = inputs();
    expect(() => preparePlanExport({ ...base, projectId: "other" })).toThrow(
      /could not be verified/,
    );
    expect(() => preparePlanExport({ ...base, comparisonId: "other" })).toThrow(
      PlanExportRefusal,
    );
  });

  it("formats ranges, fixed inputs and money", () => {
    const fact = {
      reference: { comparisonId: "c", metric: "monthlyContributionUsd" },
      range: { low: 1000, high: 2000 },
      unit: "usd_per_month",
      origins: ["default" as const],
      evidenceIds: [],
      kind: "scenario_interval" as const,
    };
    expect(formatFact(fact)).toBe("$1,000 – $2,000 per month (range)");
    expect(
      formatFact({
        ...fact,
        range: { low: 2, high: 2 },
        unit: "staff",
        kind: "input",
      }),
    ).toBe("2 staff (set)");
  });
});
