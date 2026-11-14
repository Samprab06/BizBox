/**
 * Replay and comparison fixture arrival schedules (HAC-74).
 *
 * The fixtures used to draw arrival minutes from a power of a uniform, so the replay's "peak
 * hour" meant nothing. These schedules come from the demand model (`buildArrivalSchedule`)
 * with the category fixture's time blocks (`fixtures/categories/<category>.json`), smoothed
 * into a continuous curve, so the replay peaks where the category's day profile does.
 *
 * Seeds are the caller's: the comparison fixture keeps its scenario seeds (see
 * `fixtureScenarioSeeds`) and the same seed always gives the same schedule. Pure TypeScript,
 * no Math.random.
 */
import coffee from "@/fixtures/categories/coffee.json";
import fitness from "@/fixtures/categories/fitness.json";
import quickFood from "@/fixtures/categories/quick_food.json";
import salonBarber from "@/fixtures/categories/salon_barber.json";
import { syntheticHoustonFixture } from "@/fixtures/houston-coffee";
import type {
  ArrivalSchedule,
  BehaviorTable,
  Category,
  DayType,
  DemandInput,
  Persona,
  StayPoint,
  TimeBlock,
} from "@/lib/demand/contracts";
import { CATEGORY_DEFAULTS } from "@/lib/demand/defaults";
import { SITE_A } from "@/lib/demand/fixtures";
import {
  buildArrivalSchedule,
  estimateDemand,
  expectedDailyCustomers,
} from "@/lib/demand/model";

interface CategoryFixture {
  values: { serviceMinutes: { value: number } };
  peakHourProfile: Record<
    "earlyMorning" | "morning" | "midday" | "afternoon" | "evening",
    { value: number }
  >;
}

const CATEGORY_FIXTURES: Record<Category, CategoryFixture> = {
  coffee,
  quick_food: quickFood,
  salon: salonBarber,
  fitness,
};

/** The category fixture's share of a day's visits in each time block. */
export function categoryTimeBlocks(
  category: Category,
): Record<TimeBlock, number> {
  const p = CATEGORY_FIXTURES[category].peakHourProfile;
  return {
    early_morning: p.earlyMorning.value,
    morning: p.morning.value,
    midday: p.midday.value,
    afternoon: p.afternoon.value,
    evening: p.evening.value,
  };
}

/** Scenarios per site in the comparison fixture. */
export const FIXTURE_SCENARIO_COUNT = 24;

/**
 * The comparison fixture's seeds for scenario `index` (0-based): weekday `index + 1` and
 * weekend `index + 1 + FIXTURE_SCENARIO_COUNT`, as before.
 */
export function fixtureScenarioSeeds(index: number): {
  weekday: number;
  weekend: number;
} {
  return { weekday: index + 1, weekend: index + 1 + FIXTURE_SCENARIO_COUNT };
}

/** Default fixture opening hours: 07:00 to 15:00. */
export const FIXTURE_HOURS = { openMin: 420, closeMin: 900 } as const;

/**
 * Expected customers per day the fixture targets for a site (the comparison fixture's
 * existing figures): the first site 125 and the others 114 per visit multiplier, with
 * weekends at 0.85 of weekdays.
 */
export function fixtureDailyCustomers(
  siteIndex: number,
  dayType: DayType,
  visits = 1,
): number {
  return (
    (siteIndex === 0 ? 125 : 114) * visits * (dayType === "weekday" ? 1 : 0.85)
  );
}

export interface FixtureScheduleOptions {
  siteId: string;
  /** Position of the site in the comparison; picks its expected daily customers. Default 0. */
  siteIndex?: number;
  seed: number;
  dayType: DayType;
  /** Visit multiplier of the comparison fixture. Default 1. */
  visits?: number;
  /** Default "coffee". */
  category?: Category;
  /** Expected customers within opening hours; overrides the siteIndex and visits figures. */
  dailyCustomers?: number;
  /** Smooth the 3-hour blocks into a continuous curve. Default true. */
  smooth?: boolean;
  openMin?: number;
  closeMin?: number;
}

const PERSONA_KINDS: Persona["kind"][] = ["worker", "resident"];

/** Demand-model personas from the synthetic Houston fixture's persona set. */
function fixturePersonas(): Persona[] {
  const home = SITE_A.location;
  return syntheticHoustonFixture.personaSet.personas.map((p, i) => ({
    id: p.id,
    segment: p.label,
    weight: (p.weight.value ?? 0) * 1000,
    kind: PERSONA_KINDS[i % PERSONA_KINDS.length] ?? "resident",
    location: home,
    commuteMode: "drive",
    incomeUsd: 75_000,
    age: 35,
    hasKids: false,
    description: p.label,
  }));
}

function fixtureStayPoints(): StayPoint[] {
  const curve =
    syntheticHoustonFixture.arrivalSchedule.stayProbabilityByPersona[0]
      ?.curve ?? {};
  return Object.entries(curve)
    .map(([length, point]) => ({
      lineLength: Number(length),
      p: point.value ?? 0,
    }))
    .sort((a, b) => a.lineLength - b.lineLength);
}

function fixtureDemandInput(siteId: string, category: Category): DemandInput {
  const timeBlocks = categoryTimeBlocks(category);
  const stay = fixtureStayPoints();
  const behaviorByPersona = new Map(
    syntheticHoustonFixture.behaviorTable.personas.map((b) => [b.personaId, b]),
  );
  const behavior: BehaviorTable = {
    siteId,
    modelVersion: "synthetic-fixture-v1",
    failedPersonaIds: [],
    personas: syntheticHoustonFixture.personaSet.personas.map((p) => ({
      personaId: p.id,
      where: { [siteId]: 1 },
      visitsPerMonth:
        behaviorByPersona.get(p.id)?.expectedMonthlyVisits.value ?? 8,
      timeBlocks,
      stayByLineLength: stay,
      priceAcceptance: [{ price: 6.5, p: 0.8 }],
      confidence: { where: 0.2, howOften: 0.2, when: 0.2, stay: 0.2, price: 0.2 },
      orderSpread: 0,
      cacheKeys: [],
    })),
  };
  return {
    site: { ...SITE_A, id: siteId },
    personaSet: {
      catchmentId: "fixture-houston-coffee",
      personas: fixturePersonas(),
    },
    city: "houston",
    category,
    priceTier: "mid",
    demand: { source: "jev", behavior },
    serviceMeanMin: {
      value: CATEGORY_FIXTURES[category].values.serviceMinutes.value,
      origin: "default",
    },
    serviceCv: {
      value: CATEGORY_DEFAULTS[category].serviceCv,
      origin: "default",
    },
  };
}

/**
 * One fixture day of arrivals for a site, from the demand model with the category fixture's
 * time blocks. The market-share scale is fitted so the expected customers within opening
 * hours match the target (`dailyCustomers`, or the comparison fixture's figure for the site);
 * the actual count then varies with the seed, as in a real day.
 */
export function buildFixtureSchedule(
  opts: FixtureScheduleOptions,
): ArrivalSchedule {
  const category = opts.category ?? "coffee";
  const openMin = opts.openMin ?? FIXTURE_HOURS.openMin;
  const closeMin = opts.closeMin ?? FIXTURE_HOURS.closeMin;
  const smooth = opts.smooth ?? true;
  const target =
    opts.dailyCustomers ??
    fixtureDailyCustomers(opts.siteIndex ?? 0, opts.dayType, opts.visits ?? 1);

  const input = fixtureDemandInput(opts.siteId, category);
  const unit = expectedDailyCustomers(
    estimateDemand({ ...input, scale: { value: 1, origin: "default" } }),
    opts.dayType,
    openMin,
    closeMin,
    { smooth },
  );
  const scaled: DemandInput = {
    ...input,
    scale: { value: unit > 0 ? target / unit : 0, origin: "default" },
  };
  return buildArrivalSchedule(scaled, {
    seed: opts.seed,
    dayType: opts.dayType,
    openMin,
    closeMin,
    smoothTimeBlocks: smooth,
  });
}

/** Clock hour (0-23) with the most arrivals in a schedule; the earliest on a tie. */
export function peakArrivalHour(
  schedule: Pick<ArrivalSchedule, "customers">,
): number | null {
  const counts = new Array<number>(24).fill(0);
  for (const c of schedule.customers) {
    const h = Math.min(23, Math.floor(c.arrivalMin / 60));
    counts[h] = (counts[h] ?? 0) + 1;
  }
  let best = 0;
  let peak: number | null = null;
  counts.forEach((n, h) => {
    if (n > best) {
      best = n;
      peak = h;
    }
  });
  return peak;
}
