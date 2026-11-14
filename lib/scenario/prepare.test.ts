import { describe, expect, it, vi } from "vitest";
import { createScenarioPreparer } from "./prepare";
import { createRootScenario } from "./model";
import { syntheticHoustonFixture } from "@/fixtures/houston-coffee";
import { EvaluationRequestSchema } from "@/lib/contracts/evaluation";
import { FIXTURE_PERSONA_SET, SITE_A } from "@/lib/demand/fixtures";
import type {
  AssembleEvaluationInput,
  AssemblyMetadata,
} from "@/lib/evaluation/assemble";
import type { Layout } from "@/lib/contracts/layout";
import { layoutFixture } from "@/lib/layout/layout.fixture";
import { applyLayoutOp } from "@/lib/layout";

const metric = (value: number, unit: string) => ({
  value,
  unit,
  origin: "founder" as const,
  evidenceIds: ["founder-evidence"],
});
const profile = {
  ...syntheticHoustonFixture.profile,
  projectId: "p1",
  id: "profile-v1",
};
const config = {
  hours: {
    weekday: { openMin: 360, closeMin: 1080 },
    weekend: { openMin: 360, closeMin: 1080 },
  },
  stations: { planned: 2, usableSf: 1800, sfPerStation: 100 },
  prices: { avgTicketUsd: 6.5 },
  staff: { headcount: 2, wageUsdPerHour: 16 },
  costs: { cogsPctOfRevenue: 0.28 },
  lease: {
    sf: 1800,
    askingRentUsdPerSfYear: 24,
    tripleNet: false,
    buildoutUsd: 30000,
    leaseTermMonths: 60,
  },
  calendar: { weekdayDaysPerMonth: 22, weekendDaysPerMonth: 8 },
};
function setup() {
  const assemble = vi.fn(async (input: AssembleEvaluationInput) => ({
    request: EvaluationRequestSchema.parse({
      projectId: "p1",
      profileId: input.profileId,
      profileVersion: 1,
      synthetic: true,
      city: "houston",
      category: "coffee",
      priceTier: "mid",
      personaSet: FIXTURE_PERSONA_SET,
      demandSource: "huff",
      sites: [{ siteId: SITE_A.id, storefront: SITE_A, config }],
    }),
    findings: [],
    assumptions: {} as AssemblyMetadata["assumptions"],
  }));
  const loadProfile = vi.fn(async () => profile);
  const loadLayout = vi.fn(async (): Promise<Layout | null> => null);
  const prepare = createScenarioPreparer({ assemble, loadProfile, loadLayout });
  return { assemble, loadProfile, loadLayout, prepare };
}
const scenario = (overrides = {}) =>
  createRootScenario({
    id: "s1",
    projectId: "p1",
    siteIds: [SITE_A.id],
    profileVersion: 1,
    label: "Variant",
    author: "founder",
    createdAt: "2026-11-14T17:00:00.000Z",
    overrides,
  });

describe("scenario evaluation preparation", () => {
  it("applies every numeric/hours/seed override without changing the saved profile", async () => {
    const { prepare, assemble } = setup();
    const s = scenario({
      staffHeadcount: metric(3, "people"),
      averageTicketCents: metric(900, "cents"),
      plannedStations: metric(3, "stations"),
      demandMultiplier: metric(1.5, "multiplier"),
      priceTier: {
        value: "premium",
        unit: "price_tier",
        origin: "founder",
        evidenceIds: ["e"],
      },
      seedSet: {
        value: [7, 42],
        unit: "seeds",
        origin: "default",
        evidenceIds: ["e"],
      },
      hours: {
        weekday: {
          openMinute: metric(420, "minute"),
          closeMinute: metric(900, "minute"),
        },
      },
    });
    const result = await prepare(s, "huff");
    expect(result.request.sites[0].config).toMatchObject({
      stations: { planned: 3 },
      staff: { headcount: 3 },
      prices: { avgTicketUsd: 9 },
      hours: {
        weekday: { openMin: 420, closeMin: 900 },
        weekend: { openMin: 360, closeMin: 1080 },
      },
    });
    expect(result.request.overrides.scaleMultiplier).toBe(1.5);
    expect(result.request.seedSet).toEqual([7, 42]);
    expect(result.request.priceTier).toBe("high");
    expect(
      assemble.mock.calls[0][0].profile.economics.averageTicketCents,
    ).toMatchObject({
      value: 900,
      origin: "founder",
      evidenceIds: ["founder-evidence"],
    });
    expect(profile.economics.averageTicketCents.value).toBe(650);
    expect(
      result.assumptions[`sites.${SITE_A.id}.config.hours.weekday.openMin`],
    ).toMatchObject({ value: 420, origin: "founder" });
  });
  it("refuses a missing/wrong profile snapshot before assembling", async () => {
    const { prepare, loadProfile, assemble } = setup();
    loadProfile.mockResolvedValueOnce({ ...profile, version: 2 });
    await expect(prepare(scenario(), "huff")).rejects.toMatchObject({
      code: "invalid",
    });
    expect(assemble).not.toHaveBeenCalled();
  });
  it("does not silently ignore a missing selected layout", async () => {
    const { prepare } = setup();
    await expect(
      prepare({ ...scenario(), layoutId: "missing" }, "huff"),
    ).rejects.toMatchObject({ code: "not_found" });
  });
  it("rejects layout category mismatches and snapshots derived capacity provenance", async () => {
    const { prepare, loadLayout, assemble } = setup();
    const layout = layoutFixture("selected", SITE_A.id);
    loadLayout.mockResolvedValueOnce({ ...layout, category: "fitness" });
    const s = { ...scenario(), layoutId: layout.layoutId };
    await expect(prepare(s, "huff")).rejects.toMatchObject({ code: "invalid" });
    loadLayout.mockResolvedValueOnce(layout);
    const assembled = await assemble({
      projectId: "p1",
      profileId: profile.id,
      profileVersion: 1,
      profile,
      candidateIds: [SITE_A.id],
    });
    assembled.assumptions[`sites.${SITE_A.id}.config.stations.planned`] = {
      value: 2,
      origin: "costar",
      evidenceIds: ["old-listing"],
    };
    assemble.mockResolvedValueOnce(assembled);
    const result = await prepare(s, "huff");
    expect(result.request.sites[0].config).toMatchObject({
      queueCapacity: 9,
      stations: { planned: 1 },
    });
    expect(
      result.assumptions[`sites.${SITE_A.id}.config.queueCapacity`],
    ).toMatchObject({ value: 9, origin: "default" });
    expect(result.scenario?.layout).toEqual(layout);
    expect(
      result.assumptions[`sites.${SITE_A.id}.config.stations.planned`],
    ).toMatchObject({ value: 1, origin: "default" });
    expect(result.assumptions).not.toHaveProperty(
      `${SITE_A.id}.config.stations.planned`,
    );
  });
  it("uses the selected layout capacity instead of rejecting it against the listing proxy", async () => {
    const { prepare, loadLayout, assemble } = setup();
    const baseLayout = layoutFixture("one", SITE_A.id);
    const layout = applyLayoutOp(
      baseLayout,
      {
        op: "add_station",
        station: {
          id: "station-two",
          type: "espresso",
          footprint: { x: 24, y: 20, width: 2, depth: 2 },
          origin: "agent-proposed",
          evidenceIds: ["layout-evidence"],
        },
      },
      { layoutId: "two" },
    );
    const assembled = await assemble({
      projectId: "p1",
      profileId: profile.id,
      profileVersion: 1,
      profile,
      candidateIds: [SITE_A.id],
    });
    assembled.request.sites[0].config.stations = {
      planned: 1,
      usableSf: 100,
      sfPerStation: 100,
    };
    assemble.mockResolvedValueOnce(assembled);
    loadLayout.mockResolvedValueOnce(layout);
    const result = await prepare(
      {
        ...scenario({ plannedStations: metric(2, "stations") }),
        layoutId: layout.layoutId,
      },
      "huff",
    );
    expect(result.request.sites[0].config.stations.planned).toBe(2);
  });
});
