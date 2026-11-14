import { describe, expect, it, vi } from "vitest";
import { syntheticHoustonFixture } from "@/fixtures/houston-coffee";
import { EvaluationRequestSchema } from "@/lib/contracts/evaluation";
import { FIXTURE_PERSONA_SET, SITE_A, SITE_B } from "@/lib/demand/fixtures";
import { evaluateSites } from "@/lib/evaluation/evaluate";
import { buildStoredComparison } from "@/lib/evaluation/store";
import type { InvestigationJob, InvestigationMilestone } from "./jobs";
import { createInvestigationPlanFinalizer } from "./plan-finalizer";

function setup() {
  const profile = structuredClone(syntheticHoustonFixture.profile);
  const hours = { openMin: 420, closeMin: 1020 };
  const request = EvaluationRequestSchema.parse({
    projectId: profile.projectId,
    profileId: profile.id,
    profileVersion: profile.version,
    synthetic: true,
    city: "houston",
    category: "coffee",
    priceTier: "mid",
    personaSet: FIXTURE_PERSONA_SET,
    seeds: 1,
    demandSource: "huff",
    sites: [SITE_A, SITE_B].map((storefront) => ({
      siteId: storefront.id,
      storefront,
      config: {
        hours: { weekday: hours, weekend: hours },
        stations: {
          planned: 2,
          usableSf: storefront.sizeSqft,
          sfPerStation: 250,
        },
        staff: { headcount: 2, wageUsdPerHour: 16 },
        prices: { avgTicketUsd: 6.5 },
        costs: { cogsPctOfRevenue: 0.28 },
        lease: {
          sf: storefront.sizeSqft,
          askingRentUsdPerSfYear: 24,
          tripleNet: false,
          buildoutUsd: 30000,
          leaseTermMonths: 60,
        },
        calendar: { weekdayDaysPerMonth: 22, weekendDaysPerMonth: 8 },
      },
    })),
  });
  const comparison = buildStoredComparison(
    "cmp1",
    request,
    evaluateSites(request),
  );
  const job = {
    id: "job1",
    projectId: profile.projectId,
    profileId: profile.id,
    attempt: 2,
    findings: ["MODEL_JOB"],
  } as InvestigationJob;
  const milestones: InvestigationMilestone[] = [];
  const controller = new AbortController();
  const store = { load: vi.fn(async () => comparison) };
  const profiles = { load: vi.fn(async () => profile) };
  const finalize = createInvestigationPlanFinalizer({ store, profiles });
  const milestone = (
    tool: string,
    output: Record<string, unknown>,
    toolFindings: string[] = [],
    overrides: Partial<InvestigationMilestone> = {},
  ) => {
    milestones.push({
      investigationId: job.id,
      attempt: job.attempt,
      seq: milestones.length,
      tool,
      inputHash: "hash",
      createdAt: "2026-11-14T00:00:00Z",
      summary: JSON.parse(
        JSON.stringify({
          input: {},
          output,
          toolFindings,
          modelFindings: ["MODEL_DECISION"],
        }),
      ),
      ...overrides,
    });
  };
  const run = () =>
    finalize({
      job,
      milestones,
      signal: controller.signal,
      nextSeq: milestones.length,
    });
  return {
    profile,
    comparison,
    job,
    milestones,
    controller,
    store,
    profiles,
    milestone,
    run,
  };
}

describe("investigation plan finalizer", () => {
  it("builds a scoped plan from the latest evaluation and verified tool findings only", async () => {
    const f = setup();
    f.milestone("evaluate_sites", {
      profileId: f.profile.id,
      comparisonId: "old",
    });
    f.milestone(
      "evaluate_sites",
      {
        profileId: f.profile.id,
        comparisonId: "cmp1",
        findings: ["Verified legacy"],
      },
      ["Verified tool"],
    );
    f.milestone("run_sensitivity", { comparisonId: "cmp1" }, [
      "Verified without profile ID",
    ]);
    f.milestone("get_catchment", { missingInput: true }, [
      "Verified missing-input limitation",
    ]);
    f.milestone("finish_investigation", { findings: ["MODEL_FINISH"] }, [
      "MODEL_CONTROL",
    ]);
    f.milestone("get_site_run", {}, ["FOREIGN_JOB"], {
      investigationId: "foreign",
    });
    f.milestone("get_site_run", {}, ["OLD_ATTEMPT"], { attempt: 1 });
    const result = await f.run();
    expect(result?.plan.comparisonId).toBe("cmp1");
    expect(f.store.load).toHaveBeenCalledWith(f.job.projectId, "cmp1");
    expect(f.profiles.load).toHaveBeenCalledWith(f.job.projectId, f.profile.id);
    const serialized = JSON.stringify(result);
    for (const text of [
      "Verified tool",
      "Verified legacy",
      "Verified without profile ID",
      "Verified missing-input limitation",
    ])
      expect(serialized).toContain(text);
    for (const text of ["MODEL_", "FOREIGN_JOB", "OLD_ATTEMPT"])
      expect(serialized).not.toContain(text);
  });

  it("returns null without a current evaluation, preserving the missing-input handoff", async () => {
    const f = setup();
    f.milestone("evaluate_sites", {
      profileId: "other-profile",
      comparisonId: "cmp1",
    });
    expect(await f.run()).toBeNull();
    expect(f.store.load).not.toHaveBeenCalled();
    expect(f.profiles.load).not.toHaveBeenCalled();
  });

  it("orders snapshots by sequence, excludes stale findings, and ignores unsuccessful saves", async () => {
    const f = setup();
    f.job.profileId = "original";
    f.milestone("get_site_run", {}, ["STALE_FINDING"]);
    f.milestone("save_profile", {
      profileId: f.profile.id,
      profileVersion: f.profile.version,
    });
    f.milestone("get_site_run", {}, ["CURRENT_FINDING"]);
    f.milestone("evaluate_sites", {
      profileId: f.profile.id,
      comparisonId: "cmp1",
    });
    f.milestone("save_profile", {
      missingInput: true,
      profileId: "failed-save",
    });
    f.milestones.reverse();
    const result = JSON.stringify(await f.run());
    expect(result).toContain("CURRENT_FINDING");
    expect(result).not.toContain("STALE_FINDING");
    f.milestone("save_profile", { profileId: "newer", profileVersion: 3 }, [], {
      seq: 99,
    });
    expect(await f.run()).toBeNull();
  });

  it.each([
    "comparison-project",
    "comparison-id",
    "comparison-profile",
    "profile-project",
    "profile-version",
    "snapshot-version",
  ])("throws on foreign or mismatched scope: %s", async (scope) => {
    const f = setup();
    f.milestone("evaluate_sites", {
      profileId: f.profile.id,
      comparisonId: "cmp1",
    });
    if (scope === "comparison-project")
      f.comparison.evaluation.request.projectId = "foreign";
    if (scope === "comparison-id") f.comparison.id = "foreign";
    if (scope === "comparison-profile")
      f.comparison.evaluation.request.profileId = "foreign";
    if (scope === "profile-project") f.profile.projectId = "foreign";
    if (scope === "profile-version") f.profile.version++;
    if (scope === "snapshot-version") {
      f.milestone("save_profile", {
        profileId: f.profile.id,
        profileVersion: 99,
      });
      f.milestone("evaluate_sites", {
        profileId: f.profile.id,
        comparisonId: "cmp1",
      });
    }
    await expect(f.run()).rejects.toThrow();
  });

  it.each(["before", "comparison-load", "profile-load"])(
    "honors cancellation %s",
    async (when) => {
      const f = setup();
      f.milestone("evaluate_sites", {
        profileId: f.profile.id,
        comparisonId: "cmp1",
      });
      if (when === "before") f.controller.abort();
      if (when === "comparison-load")
        f.store.load.mockImplementation(async () => {
          f.controller.abort();
          return f.comparison;
        });
      if (when === "profile-load")
        f.profiles.load.mockImplementation(async () => {
          f.controller.abort();
          return f.profile;
        });
      await expect(f.run()).rejects.toThrow();
      if (when === "before") expect(f.store.load).not.toHaveBeenCalled();
      if (when !== "profile-load")
        expect(f.profiles.load).not.toHaveBeenCalled();
    },
  );
});
