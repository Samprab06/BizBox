import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  EvaluationRequestSchema,
  type EvaluationRequestInput,
  type EvaluationSite,
  type SiteTweakMap,
} from "@/lib/contracts/evaluation";
import {
  COMPETITORS,
  FIXTURE_PERSONA_SET,
  SITE_A,
  SITE_B,
  makeBehaviorTable,
} from "@/lib/demand/fixtures";
import {
  WEEKDAYS_PER_MONTH,
  WEEKEND_DAYS_PER_MONTH,
} from "@/lib/demand/defaults";
import { MemoryJevCache } from "@/lib/panel/cache";
import { fakeJevClient } from "@/lib/panel/__fixtures__";
import type { SiteConfigInput } from "@/lib/sim/contracts";
import {
  assembleEvaluation,
  PanelInProgressError,
  type AssembledEvaluation,
  type AssembleEvaluationInput,
} from "./assemble";
import { evaluateSites } from "./evaluate";
import { assemblyDependencies, assemblyInput } from "./__fixtures__/assembly";

/** Scene 1: per-site tweaks (hours, price, staff, rent) applied while assembling. */

const withTweaks = (
  siteTweaks: SiteTweakMap,
  raw: AssembleEvaluationInput = assemblyInput(),
): AssembleEvaluationInput => ({ ...raw, siteTweaks });
const assemble = (raw: AssembleEvaluationInput) =>
  assembleEvaluation(raw, assemblyDependencies(raw));
const site = (out: AssembledEvaluation, id: string) =>
  out.request.sites.find((s) => s.siteId === id)!;
/** Per-site metrics that do not depend on the other sites (rank and ties do). */
const metrics = (out: AssembledEvaluation) =>
  Object.fromEntries(
    evaluateSites(out.request).result.sites.map((s) => [
      s.siteId,
      {
        contribution: s.monthlyContributionUsd,
        bySeed: s.contributionBySeed,
        revenue: s.monthlyRevenueUsd,
        served: s.monthlyServedCustomers,
        wait: s.weekdayMeanWaitMin,
      },
    ]),
  );
const DAYS_PER_MONTH = WEEKDAYS_PER_MONTH + WEEKEND_DAYS_PER_MONTH;

describe("per-site tweaks in assembly (Scene 1)", () => {
  it("changes only the tweaked site's config and metrics, and reports the tweaks", async () => {
    const base = await assemble(assemblyInput());
    const tweaks = {
      "102:2": {
        hours: { openMinute: 480, closeMinute: 900 },
        priceUsd: 8,
        staff: 3,
        monthlyRentUsd: 2000,
      },
    };
    const out = await assemble(withTweaks(tweaks));
    for (const id of ["101:1", "103:3"])
      expect(site(out, id)).toEqual(site(base, id));
    expect(out.request.personaSet).toEqual(base.request.personaSet);
    const tweaked = site(out, "102:2");
    expect(tweaked.config).toEqual({
      ...site(base, "102:2").config,
      hours: {
        weekday: { openMin: 480, closeMin: 900 },
        weekend: { openMin: 480, closeMin: 900 },
      },
      prices: { avgTicketUsd: 8 },
      staff: { ...site(base, "102:2").config.staff, headcount: 3 },
      lease: {
        ...site(base, "102:2").config.lease,
        askingRentUsdPerSfYear: (2000 * 12) / 1300,
      },
    });
    // The profile price Jev answers (would be) collected at, for per-site repricing.
    expect(tweaked.jevBasePriceUsd).toBe(6.5);
    expect(site(base, "102:2").jevBasePriceUsd).toBeUndefined();

    const before = metrics(base);
    const after = metrics(out);
    expect(after["101:1"]).toEqual(before["101:1"]);
    expect(after["103:3"]).toEqual(before["103:3"]);
    expect(after["102:2"]).not.toEqual(before["102:2"]);

    expect(out.siteTweaks).toEqual(tweaks);
    expect(base.siteTweaks).toBeUndefined();
    expect(out.findings).toContainEqual(
      expect.objectContaining({ code: "SITE_TWEAKS_APPLIED", siteId: "102:2" }),
    );
    expect(out.assumptions["sites.102:2.config.prices.avgTicketUsd"]).toEqual({
      value: 8,
      origin: "founder",
      evidenceIds: ["siteTweaks:102:2:priceUsd"],
    });
    expect(
      out.assumptions["sites.102:2.config.hours.weekend.closeMin"],
    ).toMatchObject({ value: 900, origin: "founder" });
    expect(out.assumptions["sites.101:1.config.prices.avgTicketUsd"]).toEqual(
      base.assumptions["sites.101:1.config.prices.avgTicketUsd"],
    );
  });

  it("moves contribution by exactly the rent delta for a rent tweak", async () => {
    const base = await assemble(assemblyInput());
    const out = await assemble(
      withTweaks({ "101:1": { monthlyRentUsd: 1000 } }),
    );
    // Listing rent: $24/SF/year over 1,200 SF = $2,400 a month.
    expect(site(base, "101:1").config.lease.askingRentUsdPerSfYear).toBe(24);
    expect(site(out, "101:1").config.lease.askingRentUsdPerSfYear).toBeCloseTo(
      10,
      10,
    );
    const before = metrics(base)["101:1"]!;
    const after = metrics(out)["101:1"]!;
    expect(after.revenue).toEqual(before.revenue);
    expect(after.contribution.mean - before.contribution.mean).toBeCloseTo(
      1400,
      6,
    );
    after.bySeed.forEach((value, i) =>
      expect(value - before.bySeed[i]!).toBeCloseTo(1400, 6),
    );
  });

  it("changes labor cost, not demand, for a staff tweak", async () => {
    const base = await assemble(assemblyInput());
    const out = await assemble(withTweaks({ "101:1": { staff: 4 } }));
    const config = site(out, "101:1").config;
    expect(config.staff.headcount).toBe(4);
    expect(site(base, "101:1").config.staff.headcount).toBe(2);
    const openHours = (1080 - 420) / 60;
    const extraLabor =
      2 * openHours * DAYS_PER_MONTH * config.staff.wageUsdPerHour;
    expect(extraLabor).toBeGreaterThan(0);
    const before = metrics(base)["101:1"]!;
    const after = metrics(out)["101:1"]!;
    expect(after.served).toEqual(before.served);
    expect(after.revenue).toEqual(before.revenue);
    expect(before.contribution.mean - after.contribution.mean).toBeCloseTo(
      extraLabor,
      6,
    );
  });

  it("changes served customers for an hours tweak", async () => {
    const base = await assemble(assemblyInput());
    // 07:00-10:00 instead of 07:00-18:00.
    const out = await assemble(
      withTweaks({ "101:1": { hours: { openMinute: 420, closeMinute: 600 } } }),
    );
    const before = metrics(base)["101:1"]!;
    const after = metrics(out)["101:1"]!;
    expect(after.served.mean).toBeLessThan(before.served.mean);
    expect(after.revenue.mean).toBeLessThan(before.revenue.mean);
    const run = evaluateSites(out.request).result.sites.find(
      (s) => s.siteId === "101:1",
    )!.representative.weekday;
    expect(Math.max(...run.hourly.map((h) => h.hour))).toBe(9);
  });

  it("accepts a close at minute 1440 (end of the modeled day), like the profile", async () => {
    const out = await assemble(
      withTweaks({
        "101:1": { hours: { openMinute: 360, closeMinute: 1440 } },
      }),
    );
    expect(site(out, "101:1").config.hours.weekday).toEqual({
      openMin: 360,
      closeMin: 1440,
    });
    expect(() => evaluateSites(out.request)).not.toThrow();
  });

  it("rejects tweaks for IDs that are not candidates, and impossible hours", async () => {
    const unknown = assemble(withTweaks({ "999:9": { staff: 1 } }));
    await expect(unknown).rejects.toBeInstanceOf(ZodError);
    await expect(unknown).rejects.toMatchObject({
      issues: [expect.objectContaining({ path: ["siteTweaks", "999:9"] })],
    });
    await expect(
      assemble(
        withTweaks({
          "101:1": { hours: { openMinute: 600, closeMinute: 600 } },
        }),
      ),
    ).rejects.toMatchObject({
      issues: [
        expect.objectContaining({
          path: ["siteTweaks", "101:1", "hours", "closeMinute"],
        }),
      ],
    });
  });

  it("reports tweaks for an excluded candidate instead of applying them", async () => {
    const raw = withTweaks({ "101:1": { staff: 5 }, "102:2": { staff: 3 } });
    const deps = assemblyDependencies(raw);
    const search = deps.searchSites;
    deps.searchSites = async (...args) => {
      const out = await search(...args);
      out.result.candidates[0]!.baseRentCents = {
        ...out.result.candidates[0]!.baseRentCents,
        value: null,
        unknownReason: "Unknown",
      };
      return out;
    };
    const out = await assembleEvaluation(raw, deps);
    expect(out.siteTweaks).toEqual({ "102:2": { staff: 3 } });
    expect(out.findings).toContainEqual(
      expect.objectContaining({ code: "SITE_TWEAKS_IGNORED", siteId: "101:1" }),
    );
  });
});

describe("per-site tweaks with Jev demand (Scene 1)", () => {
  const jevInput = (siteTweaks?: SiteTweakMap): AssembleEvaluationInput => ({
    ...assemblyInput(),
    candidateIds: ["101:1"],
    demandSource: "jev",
    ...(siteTweaks ? { siteTweaks } : {}),
  });

  it("reuses every cached Jev answer when hours, staff, rent or price change", async () => {
    const client = fakeJevClient();
    const cache = new MemoryJevCache();
    const jev = (raw: AssembleEvaluationInput) =>
      assembleEvaluation(raw, {
        ...assemblyDependencies(raw),
        jev: { client, cache },
      });
    const base = await jev(jevInput());
    const calls = client.calls;
    expect(calls).toBeGreaterThan(0);
    const out = await jev(
      jevInput({
        "101:1": {
          hours: { openMinute: 480, closeMinute: 1200 },
          staff: 3,
          monthlyRentUsd: 1800,
          priceUsd: 7.25,
        },
      }),
    );
    expect(client.calls).toBe(calls);
    const [before, after] = [base.request.sites[0]!, out.request.sites[0]!];
    expect(after.behaviorTable).toEqual(before.behaviorTable);
    expect(after.behaviorTableId).toBe(before.behaviorTableId);
    expect(after.jevPersonaSet).toEqual(before.jevPersonaSet);
    expect(after.config.prices.avgTicketUsd).toBe(7.25);
    expect(after.jevBasePriceUsd).toBe(6.5);
    expect(out.findings.map((f) => f.code)).toContain("SITE_TWEAKS_JEV");
    expect(evaluateSites(out.request).result.demandSource).toBe("jev");
  });

  it("resumes a deadline-limited Jev panel with tweaks to the unbounded tweaked request (HAC-155)", async () => {
    const tweaks = {
      "101:1": { hours: { openMinute: 480, closeMinute: 1200 }, staff: 3 },
    };
    const raw = jevInput(tweaks);
    const client = fakeJevClient();
    const deps = {
      ...assemblyDependencies(raw),
      jev: { client, cache: new MemoryJevCache() },
    };
    let clock = 0;
    const ask = client.ask.bind(client);
    client.ask = async (req) => {
      clock += 1000;
      return ask(req);
    };
    await expect(
      assembleEvaluation(raw, deps, {
        deadlineAt: clock + 8_000,
        deadlineReserveMs: 1_000,
        now: () => clock,
      }),
    ).rejects.toBeInstanceOf(PanelInProgressError);
    // Same body again (here without a deadline): resumes from the cached answers.
    const resumed = await assembleEvaluation(raw, deps);
    const unbounded = await assembleEvaluation(raw, {
      ...assemblyDependencies(raw),
      jev: { client: fakeJevClient(), cache: new MemoryJevCache() },
    });
    expect(resumed.request).toEqual(unbounded.request);
    expect(resumed.siteTweaks).toEqual(tweaks);
  });
});

describe("per-site Jev price rescaling in evaluation (Scene 1)", () => {
  const hours = { openMin: 360, closeMin: 1080 };
  const config = (rent: number, sf: number, price = 6.5) =>
    ({
      hours: { weekday: hours, weekend: hours },
      stations: { planned: 2, usableSf: sf, sfPerStation: 250 },
      prices: { avgTicketUsd: price },
      staff: { headcount: 2, wageUsdPerHour: 16 },
      costs: { cogsPctOfRevenue: 0.28 },
      lease: {
        sf,
        askingRentUsdPerSfYear: rent,
        tripleNet: false,
        buildoutUsd: 30_000,
        leaseTermMonths: 60,
      },
      calendar: { weekdayDaysPerMonth: 21.7, weekendDaysPerMonth: 8.7 },
    }) satisfies SiteConfigInput as EvaluationSite["config"];
  const request = (
    siteA: Partial<EvaluationSite>,
    overrides: EvaluationRequestInput["overrides"] = {},
  ): EvaluationRequestInput => ({
    projectId: "p1",
    profileId: "profile-v1",
    profileVersion: 1,
    synthetic: true,
    city: "houston",
    category: "coffee",
    priceTier: "mid",
    personaSet: FIXTURE_PERSONA_SET,
    competitors: COMPETITORS,
    seeds: 3,
    demandSource: "jev",
    overrides,
    sites: [
      {
        siteId: "site-a",
        storefront: SITE_A,
        config: config(48, 1800),
        behaviorTable: makeBehaviorTable("site-a"),
        ...siteA,
      },
      {
        siteId: "site-b",
        storefront: SITE_B,
        config: config(22, 1300),
        behaviorTable: makeBehaviorTable("site-b"),
      },
    ],
  });
  const siteResult = (input: EvaluationRequestInput, id: string) => {
    const { contributionBySeed, monthlyServedCustomers, monthlyRevenueUsd } =
      evaluateSites(input).result.sites.find((s) => s.siteId === id)!;
    return { contributionBySeed, monthlyServedCustomers, monthlyRevenueUsd };
  };

  it("rescales only that site's Jev visits, exactly as the global price override does", async () => {
    // Fixture acceptance: 0.9 at $4, 0.6 at $6 (and above). $6.50 -> $5 lifts visits 25%.
    const perSite = request({
      config: config(48, 1800, 5),
      jevBasePriceUsd: 6.5,
    });
    const global = request({}, { priceUsd: 5 });
    const ticketOnly = request({ config: config(48, 1800, 5) });
    expect(siteResult(perSite, "site-a")).toEqual(siteResult(global, "site-a"));
    expect(
      siteResult(perSite, "site-a").monthlyServedCustomers.mean,
    ).toBeGreaterThan(
      siteResult(ticketOnly, "site-a").monthlyServedCustomers.mean,
    );
    // The other site keeps its own price and demand.
    expect(siteResult(perSite, "site-b")).toEqual(
      siteResult(request({}), "site-b"),
    );
    expect(
      EvaluationRequestSchema.parse(perSite).sites[0]!.jevBasePriceUsd,
    ).toBe(6.5);
  });
});
