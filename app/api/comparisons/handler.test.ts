import { describe, expect, it, vi } from "vitest";
import { SiteComparisonSchema, SiteRunSchema } from "@/lib/contracts";
import type { EvaluationRequestInput, EvaluationSite } from "@/lib/contracts/evaluation";
import { COMPETITORS, FIXTURE_PERSONA_SET, SITE_A, SITE_B, makeBehaviorTable } from "@/lib/demand/fixtures";
import { createMemoryComparisonStore } from "@/lib/evaluation/store";
import type { SiteConfigInput } from "@/lib/sim/contracts";
import { createSensitivityHandler } from "./[comparisonId]/sensitivity/handler";
import { createComparisonReadHandler, createComparisonsHandler } from "./handler";

const hours = { openMin: 360, closeMin: 1080 };
const config = (rent: number, sf: number) =>
  ({
    hours: { weekday: hours, weekend: hours },
    stations: { planned: 2, usableSf: sf, sfPerStation: 250 },
    prices: { avgTicketUsd: 6.5 },
    staff: { headcount: 2, wageUsdPerHour: 16 },
    costs: { cogsPctOfRevenue: 0.28 },
    lease: { sf, askingRentUsdPerSfYear: rent, tripleNet: false, buildoutUsd: 30_000, leaseTermMonths: 60 },
    calendar: { weekdayDaysPerMonth: 21.7, weekendDaysPerMonth: 8.7 },
  }) satisfies SiteConfigInput as EvaluationSite["config"];

const evaluationRequest = (): EvaluationRequestInput => ({
  projectId: "p1",
  profileId: "profile-v1",
  profileVersion: 1,
  synthetic: true,
  city: "houston",
  category: "coffee",
  priceTier: "mid",
  personaSet: FIXTURE_PERSONA_SET,
  competitors: COMPETITORS,
  seeds: 6,
  sites: [
    { siteId: "site-a", storefront: SITE_A, config: config(48, 1800), behaviorTable: makeBehaviorTable("site-a") },
    { siteId: "site-b", storefront: SITE_B, config: config(22, 1300), behaviorTable: makeBehaviorTable("site-b") },
  ],
});

const post = (body: unknown) =>
  new Request("http://test/api/comparisons", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

function setup() {
  const store = createMemoryComparisonStore({ p1: 1 });
  let n = 0;
  const create = createComparisonsHandler({ store, newId: () => `cmp_${++n}` });
  return { store, create, read: createComparisonReadHandler({ store }), sensitivity: createSensitivityHandler({ store }) };
}

describe("POST /api/comparisons", () => {
  it("evaluates, stores canonical records and returns the Huff-only ranking check", async () => {
    const { store, create } = setup();
    const response = await create(post(evaluationRequest()));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.comparisonId).toBe("cmp_1");
    expect(body.outdated).toBe(false);
    expect(body.result.demandSource).toBe("jev");
    expect(body.demandSourceCheck.huffRanking).toHaveLength(2);
    expect(SiteComparisonSchema.parse(body.comparison).results).toHaveLength(2);
    const stored = store.records.get("p1/cmp_1")!;
    expect(stored.runs).toHaveLength(4);
    for (const run of stored.runs) SiteRunSchema.parse(run);
    const weekdayRun = stored.evaluation.result.sites[0]!.representative.weekday.runId;
    expect(stored.runs.map((r) => r.id)).toContain(weekdayRun);
  });

  it("reruns a stored comparison from cached behavior tables, reproducing identical metrics without Jev", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { create } = setup();
    await create(post(evaluationRequest()));
    const response = await create(post({ projectId: "p1", rerunComparisonId: "cmp_1" }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({ comparisonId: "cmp_2", rerunOf: "cmp_1", reproduces: true });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("labels the comparison huff when Jev behavior tables are missing", async () => {
    const { create } = setup();
    const req = evaluationRequest();
    req.sites = req.sites.map((s) => ({ ...s, behaviorTable: undefined }));
    const body = await (await create(post(req))).json();
    expect(body.result.demandSource).toBe("huff");
    expect(body.result.fallbackReason).toMatch(/unavailable/);
    expect(body.demandSourceCheck).toBeNull();
  });

  it("rejects invalid requests and unknown reruns", async () => {
    const { create } = setup();
    expect((await create(post("{not json"))).status).toBe(422);
    expect((await create(post({ ...evaluationRequest(), sites: [] }))).status).toBe(422);
    expect((await create(post({ projectId: "p1", rerunComparisonId: "nope" }))).status).toBe(404);
  });

  it("returns 503 without leaking details when the store fails", async () => {
    const store = createMemoryComparisonStore({ p1: 1 });
    store.save = async () => {
      throw new Error("connection refused at 10.0.0.1");
    };
    const response = await createComparisonsHandler({ store, newId: () => "x" })(post(evaluationRequest()));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toMatch(/10\.0\.0\.1/);
  });
});

describe("GET /api/comparisons/[comparisonId]", () => {
  it("marks older comparisons outdated once the profile is edited", async () => {
    const { store, create, read } = setup();
    await create(post(evaluationRequest()));
    const get = () => read(new Request("http://test/api/comparisons/cmp_1?projectId=p1"), "cmp_1");
    expect((await (await get()).json()).outdated).toBe(false);
    store.profileVersions.p1 = 2;
    expect((await (await get()).json()).outdated).toBe(true);
    expect((await read(new Request("http://test/api/comparisons/x?projectId=p1"), "x")).status).toBe(404);
    expect((await read(new Request("http://test/api/comparisons/cmp_1"), "cmp_1")).status).toBe(422);
  });
});

describe("POST /api/comparisons/[comparisonId]/sensitivity", () => {
  it("runs a sweep, reports the break-even value and stores it on the comparison", async () => {
    const { store, create, sensitivity } = setup();
    await create(post(evaluationRequest()));
    const response = await sensitivity(
      post({ projectId: "p1", assumption: "market_share_scale", values: [0.25, 0.5, 1, 2, 3], seeds: 4 }),
      "cmp_1",
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.sensitivity.topChanges).toBe(true);
    expect(body.sensitivity.breakEven.value).toBeGreaterThan(0.25);
    expect(body.comparison.sensitivity[0].parameter).toBe("market_share_scale");
    expect(store.records.get("p1/cmp_1")!.evaluation.sensitivity).toHaveLength(1);
  });

  it("defaults rent to ±10% and validates the assumption", async () => {
    const { create, sensitivity } = setup();
    await create(post(evaluationRequest()));
    const body = await (await sensitivity(post({ projectId: "p1", assumption: "rent", seeds: 3 }), "cmp_1")).json();
    expect(body.sensitivity.points.map((p: { value: number }) => p.value)).toEqual([0.9, 0.95, 1, 1.05, 1.1]);
    expect((await sensitivity(post({ projectId: "p1", assumption: "weather" }), "cmp_1")).status).toBe(422);
    expect((await sensitivity(post({ projectId: "p1", assumption: "rent" }), "missing")).status).toBe(404);
  });
});
