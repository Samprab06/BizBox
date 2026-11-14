import { simulateDay } from "@/lib/sim/engine";
import { computeMonthlyEconomics } from "@/lib/sim/economics";
import type { SiteConfigInput } from "@/lib/sim/contracts";
import { createRng } from "@/lib/sim/random";

export const demoPlan = {
  concept: "Counter-service coffee shop",
  area: 1200,
  rentPerSquareFoot: 30,
  ticket: 8,
  wage: 18,
  baselineBuildout: 9000,
  alternativeBuildout: 15000,
};

export function makeDemo() {
  const hours = { openMin: 480, closeMin: 720 };
  const random = createRng(45);
  const schedule = {
    ...hours,
    siteId: "demo-cafe",
    seed: 45,
    dayType: "weekday",
    demandSource: "huff",
    params: {},
    stayCurves: [
      {
        personaId: "morning-visitor",
        points: [
          { lineLength: 0, p: 1 },
          { lineLength: 2, p: 0.8 },
          { lineLength: 6, p: 0.3 },
        ],
      },
    ],
    customers: Array.from({ length: 110 }, (_, index) => ({
      id: `customer-${index + 1}`,
      personaId: "morning-visitor",
      arrivalMin: hours.openMin + 239 * random.next() ** 1.55,
      stayDraw: random.next(),
      serviceMin: 2 + 4 * random.next(),
    })),
  };

  return [1, 2].map((stations) => {
    const config: SiteConfigInput = {
      hours: { weekday: hours, weekend: hours },
      stations: {
        planned: stations,
        usableSf: demoPlan.area,
        sfPerStation: 250,
      },
      prices: { avgTicketUsd: demoPlan.ticket },
      staff: { headcount: stations, wageUsdPerHour: demoPlan.wage },
      costs: { cogsPctOfRevenue: 0.3 },
      lease: {
        sf: demoPlan.area,
        askingRentUsdPerSfYear: demoPlan.rentPerSquareFoot,
        tripleNet: false,
        buildoutUsd:
          stations === 2
            ? demoPlan.alternativeBuildout
            : demoPlan.baselineBuildout,
        leaseTermMonths: 36,
      },
      calendar: { weekdayDaysPerMonth: 22, weekendDaysPerMonth: 0 },
    };
    const run = simulateDay(schedule, config);
    const monthly = computeMonthlyEconomics(config, {
      weekday: run.metrics,
      weekend: { revenueUsd: 0, served: 0 },
    });
    return { run, monthly };
  });
}

export type DemoData = ReturnType<typeof makeDemo>;
