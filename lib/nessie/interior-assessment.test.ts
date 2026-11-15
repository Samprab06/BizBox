import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { liveComparisonRecord } from "@/tests/e2e/live-comparison-fixtures";
import { createSpatialDraft, applySpatialCommand } from "@/lib/spatial";
import { FURNITURE_CATALOG } from "@/lib/furniture/catalog";
import { createNessieConsultantReader } from "./consultant";
import { assessInteriorAffordability } from "./interior-assessment";
import {
  InteriorAffordabilityRequestSchema,
  interiorAffordabilityFingerprint,
} from "@/lib/contracts/interior-affordability";
const record = liveComparisonRecord;
const projectId = record.evaluation.request.projectId,
  siteId = record.evaluation.request.sites[0]!.siteId;
const baseline = createSpatialDraft({ projectId, siteId, city: "houston" });
const input = {
  comparisonId: record.id,
  siteId,
  baseline,
  draft: baseline,
  ranRevision: 0,
  reviewedRevision: 0,
};
const clock = () => new Date("2026-11-15T12:00:00Z");
function setup(selected = record, configured = true) {
  const fetcher = vi.fn<typeof fetch>(async (url) =>
    Response.json({
      items:
        new URL(String(url)).pathname === "/accounts"
          ? [
              {
                id: "demo",
                nickname: "Sandbox",
                type: "Checking",
                balance_cents: 5000000,
                available_cents: 5000000,
              },
            ]
          : [],
    }),
  );
  const readNessie = vi.fn(
    createNessieConsultantReader({
      env: configured ? { NESSIE_API_KEY: "test" } : {},
      fetcher,
      now: clock,
    }),
  );
  const ports = {
    loadComparison: async () => selected,
    currentProfileVersion: async () =>
      selected.evaluation.request.profileVersion,
    readNessie,
    verifyPolicies: async () => true,
    now: clock,
  };
  return { ports, readNessie, fetcher };
}
describe("reviewed interior Nessie assessment", () => {
  it("reuses stored operating contribution before amortization and subtracts known upfront only once", async () => {
    const { ports } = setup();
    const result = await assessInteriorAffordability(
      projectId,
      input,
      new AbortController().signal,
      ports,
    );
    const stored = record.evaluation.result.sites[0]!.monthlyContributionUsd;
    expect(result.nessie.scenario?.monthlyContributionUsd).toEqual({
      low: stored.low,
      mean: stored.mean,
      high: stored.high,
    });
    expect(result.knownUpfrontBuildoutCents).toBe(2400000);
    expect(result.nessie.scenario?.projection.cashAfterOneMonthCents.mean).toBe(
      5000000 - 2400000 + Math.round(stored.mean * 100),
    );
    expect(result.projectionBasis).toBe("stored-exterior-operating-only");
    expect(result.operatingImpact.appliedToMonthlyProjection).toBe(false);
    expect(result.proposalProjection).toBeNull();
    expect(result.completeAffordability).toBe(false);
  });
  it("retains unknown furniture/counter costs and exact proposal version instead of inventing ROI", async () => {
    const chair = FURNITURE_CATALOG.find((item) => item.role === "seating")!;
    const draft = applySpatialCommand(baseline, {
      type: "add",
      id: "chair",
      catalogId: chair.id,
      x: 2,
      z: 3,
      rotation: 0,
    });
    const { ports } = setup();
    const request = {
      ...input,
      draft,
      ranRevision: draft.revision,
      reviewedRevision: draft.revision,
    };
    const result = await assessInteriorAffordability(
      projectId,
      request,
      new AbortController().signal,
      ports,
    );
    expect(result.missingCosts.join(" ")).toMatch(/furniture/i);
    expect(result.fingerprint).toBe(
      await interiorAffordabilityFingerprint(projectId, request),
    );
    expect(result.revision).toBe(draft.revision);
    expect(result.fingerprint).not.toBe(
      await interiorAffordabilityFingerprint(projectId, input),
    );
  });
  it("derives a separately labeled interior monthly scenario only for a weekday-only stored calendar", async () => {
    const selected = structuredClone(record);
    selected.evaluation.request.sites[0]!.config.calendar.weekendDaysPerMonth = 0;
    const { ports } = setup(selected);
    const result = await assessInteriorAffordability(
      projectId,
      input,
      new AbortController().signal,
      ports,
    );
    expect(result.proposalProjection?.basis).toBe(
      "reviewed-interior-weekdays-only",
    );
    expect(result.proposalProjection?.weekdayDaysPerMonth).toBe(22);
    expect(result.nessie.scenario?.monthlyContributionUsd).toEqual({
      low: record.evaluation.result.sites[0]!.monthlyContributionUsd.low,
      mean: record.evaluation.result.sites[0]!.monthlyContributionUsd.mean,
      high: record.evaluation.result.sites[0]!.monthlyContributionUsd.high,
    });
  });
  it("refuses stale/foreign/unowned evidence before touching the sandbox", async () => {
    for (const request of [
      { ...input, ranRevision: 99 },
      { ...input, siteId: "other" },
      { ...input, baseline: { ...baseline, projectId: "other" } },
    ]) {
      const { ports, readNessie } = setup();
      await expect(
        assessInteriorAffordability(
          projectId,
          request,
          new AbortController().signal,
          ports,
        ),
      ).rejects.toThrow();
      expect(readNessie).not.toHaveBeenCalled();
    }
    const { ports, readNessie } = setup();
    await expect(
      assessInteriorAffordability(
        "foreign",
        input,
        new AbortController().signal,
        ports,
      ),
    ).rejects.toThrow();
    expect(readNessie).not.toHaveBeenCalled();
  });
  it("returns an honest unconfigured assessment without inventing balance/projection", async () => {
    const { ports, fetcher } = setup(record, false);
    const result = await assessInteriorAffordability(
      projectId,
      input,
      new AbortController().signal,
      ports,
    );
    expect(result.status).toBe("unconfigured");
    expect(result.nessie.selectedAccount).toBeNull();
    expect(result.proposalProjection).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not accept model/browser-authored banking balances or financial outputs", () => {
    expect(
      InteriorAffordabilityRequestSchema.safeParse({
        ...input,
        availableFundsCents: 999999999,
      }).success,
    ).toBe(false);
  });
});

it("requires current profile and verified policies before sandbox reads", async () => {
  const { ports, readNessie } = setup();
  ports.currentProfileVersion = async () => 99;
  await expect(
    assessInteriorAffordability(
      projectId,
      input,
      new AbortController().signal,
      ports,
    ),
  ).rejects.toThrow(/Current owned/);
  expect(readNessie).not.toHaveBeenCalled();
});

it("preserves the stored comparison's rent override in the separate proposal scenario", async () => {
  const selected = structuredClone(record);
  selected.evaluation.request.sites[0]!.config.calendar.weekendDaysPerMonth = 0;
  const plain = await assessInteriorAffordability(
    projectId,
    input,
    new AbortController().signal,
    setup(selected).ports,
  );
  selected.evaluation.request.overrides.rentMultiplier = 2;
  const overridden = await assessInteriorAffordability(
    projectId,
    input,
    new AbortController().signal,
    setup(selected).ports,
  );
  const baseRent =
    (selected.evaluation.request.sites[0]!.config.lease.askingRentUsdPerSfYear *
      selected.evaluation.request.sites[0]!.config.lease.sf) /
    12;
  expect(
    plain.proposalProjection!.monthlyOperatingContributionUsd.mean -
      overridden.proposalProjection!.monthlyOperatingContributionUsd.mean,
  ).toBeCloseTo(baseRent, 8);
});
