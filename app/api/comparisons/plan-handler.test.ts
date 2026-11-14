import { describe, expect, it, vi } from "vitest";
import { syntheticHoustonFixture } from "@/fixtures/houston-coffee";
import type { StoredComparison } from "@/lib/evaluation/store";
import type {
  InvestigationJob,
  InvestigationMilestone,
} from "@/lib/agent/jobs";
import type { buildLocationPlan } from "@/lib/agent/plan";
import { createComparisonPlanHandler } from "./plan-handler";

function setup() {
  const profile = structuredClone(syntheticHoustonFixture.profile);
  const comparison = {
    id: "cmp1",
    evaluation: {
      request: {
        projectId: profile.projectId,
        profileId: profile.id,
        profileVersion: profile.version,
      },
    },
  } as StoredComparison;
  const job = {
    id: "job1",
    projectId: profile.projectId,
    profileId: profile.id,
    attempt: 2,
    findings: ["UNVERIFIED_JOB"],
  } as InvestigationJob;
  const milestones: InvestigationMilestone[] = [];
  const result = { marker: "injected deterministic plan" };
  const build = vi.fn<typeof buildLocationPlan>(
    () => result as unknown as ReturnType<typeof buildLocationPlan>,
  );
  const store = {
    load: vi.fn(async () => comparison as StoredComparison | null),
  };
  const profiles = {
    load: vi.fn(async () => profile as typeof profile | null),
  };
  const investigations = {
    load: vi.fn(async () => job as InvestigationJob | null),
    listMilestones: vi.fn(async () => milestones),
  };
  const handler = createComparisonPlanHandler({
    store,
    profiles,
    investigations,
    build,
  });
  const read = (query = `projectId=${profile.projectId}`) =>
    handler(
      new Request(`http://test/api/comparisons/cmp1/plan?${query}`),
      "cmp1",
    );
  const milestone = (
    tool: string,
    output: Record<string, unknown>,
    overrides: Partial<InvestigationMilestone> = {},
  ) => {
    milestones.push({
      investigationId: job.id,
      attempt: job.attempt,
      seq: milestones.length,
      tool,
      inputHash: "test",
      createdAt: "2026-11-14T00:00:00Z",
      summary: {
        input: {},
        output: output as InvestigationMilestone["summary"],
        modelFindings: ["UNVERIFIED_MODEL"],
      },
      ...overrides,
    });
  };
  const withJob = () =>
    read(`projectId=${profile.projectId}&investigationId=job1`);
  return {
    profile,
    comparison,
    job,
    milestones,
    build,
    store,
    profiles,
    investigations,
    read,
    milestone,
    withJob,
    result,
  };
}

describe("GET comparison location plan", () => {
  it("reads scoped immutable artifacts and returns the injected plan without any network/provider calls", async () => {
    const f = setup();
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Network forbidden"));
    try {
      const response = await f.read();
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toEqual(f.result);
      expect(f.store.load).toHaveBeenCalledWith(f.profile.projectId, "cmp1");
      expect(f.profiles.load).toHaveBeenCalledWith(
        f.profile.projectId,
        f.profile.id,
      );
      expect(f.build).toHaveBeenCalledWith({
        projectId: f.profile.projectId,
        profile: f.profile,
        comparison: f.comparison,
      });
      expect(f.investigations.load).not.toHaveBeenCalled();
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      fetcher.mockRestore();
    }
  });

  it.each(["", "projectId=", "projectId=%20", "projectId=p&investigationId="])(
    "rejects missing/invalid scope before storage: %s",
    async (query) => {
      const f = setup();
      expect((await f.read(query)).status).toBe(422);
      expect(f.store.load).not.toHaveBeenCalled();
    },
  );

  it.each(["comparison", "profile", "job"])(
    "rejects foreign-project %s even if an adapter returns it",
    async (artifact) => {
      const f = setup();
      if (artifact === "comparison")
        f.comparison.evaluation.request.projectId = "foreign";
      if (artifact === "profile") f.profile.projectId = "foreign";
      if (artifact === "job") f.job.projectId = "foreign";
      const response = await f.read(
        `projectId=project-synthetic-houston${artifact === "job" ? "&investigationId=job1" : ""}`,
      );
      expect(response.status).toBe(404);
      expect(f.build).not.toHaveBeenCalled();
    },
  );

  it.each(["comparison", "profile", "job"])(
    "returns structured not-found for missing %s",
    async (artifact) => {
      const f = setup();
      if (artifact === "comparison") f.store.load.mockResolvedValue(null);
      if (artifact === "profile") f.profiles.load.mockResolvedValue(null);
      if (artifact === "job") f.investigations.load.mockResolvedValue(null);
      const response = artifact === "job" ? await f.withJob() : await f.read();
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ field_errors: {} });
    },
  );

  it("uses the latest saved snapshot and only verified findings for that attempt/profile", async () => {
    const f = setup();
    f.job.profileId = "original-profile";
    f.milestone("evaluate_sites", {
      profileId: "original-profile",
      comparisonId: "old",
      findings: ["STALE"],
    });
    f.milestone("save_profile", {
      profileId: f.profile.id,
      profileVersion: f.profile.version,
    });
    f.milestone("evaluate_sites", {
      profileId: f.profile.id,
      comparisonId: "cmp1",
      findings: ["Verified limitation"],
    });
    f.milestone(
      "run_sensitivity",
      { comparisonId: "cmp1" },
      {
        summary: {
          input: {},
          output: { comparisonId: "cmp1" },
          toolFindings: ["Verified tool finding"],
          modelFindings: ["UNVERIFIED_MODEL"],
        },
      },
    );
    f.milestone(
      "get_catchment",
      { profileId: f.profile.id, findings: ["OLD_ATTEMPT"] },
      { attempt: 1 },
    );
    f.milestone(
      "get_catchment",
      { profileId: f.profile.id, findings: ["FOREIGN_JOB"] },
      { investigationId: "foreign" },
    );
    f.milestone("get_catchment", {
      profileId: f.profile.id,
      missingInput: true,
      findings: ["FAILED"],
    });
    f.milestone("finish_investigation", {
      profileId: f.profile.id,
      findings: ["UNVERIFIED_FINISH"],
    });
    expect((await f.withJob()).status).toBe(200);
    expect(f.investigations.listMilestones).toHaveBeenCalledWith("job1", 2);
    expect(f.build).toHaveBeenCalledWith(
      expect.objectContaining({
        investigation: {
          findings: ["Verified limitation", "Verified tool finding"],
        },
      }),
    );
  });

  it.each([
    "unrelated",
    "old-profile",
    "old-attempt",
    "new-snapshot",
    "wrong-version",
  ])("rejects investigation/comparison mismatch: %s", async (reason) => {
    const f = setup();
    f.milestone(
      "evaluate_sites",
      {
        profileId: reason === "old-profile" ? "old" : f.profile.id,
        comparisonId: reason === "unrelated" ? "other" : "cmp1",
      },
      reason === "old-attempt" ? { attempt: 1 } : {},
    );
    if (reason === "new-snapshot")
      f.milestone("save_profile", {
        profileId: "new-profile",
        profileVersion: 2,
      });
    if (reason === "wrong-version")
      f.milestone("save_profile", {
        profileId: f.profile.id,
        profileVersion: 99,
      });
    expect((await f.withJob()).status).toBe(422);
    expect(f.build).not.toHaveBeenCalled();
  });

  it("rejects profile version drift and sanitizes builder validation failures", async () => {
    const f = setup();
    f.profile.version++;
    expect((await f.read()).status).toBe(422);
    f.profile.version--;
    f.build.mockImplementation(() => {
      throw new Error("SECRET_BUILDER_PAYLOAD");
    });
    const response = await f.read();
    expect(response.status).toBe(422);
    expect(await response.text()).not.toContain("SECRET");
  });

  it("sanitizes storage failures and reports unavailable optional repository", async () => {
    const f = setup();
    f.store.load.mockRejectedValue(new Error("SECRET_DATABASE_URL"));
    const response = await f.read();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("SECRET");
    const handler = createComparisonPlanHandler({
      store: { load: async () => f.comparison },
      profiles: f.profiles,
      build: f.build,
    });
    expect(
      (
        await handler(
          new Request(
            `http://test?projectId=${f.profile.projectId}&investigationId=job1`,
          ),
          "cmp1",
        )
      ).status,
    ).toBe(503);
  });
});
