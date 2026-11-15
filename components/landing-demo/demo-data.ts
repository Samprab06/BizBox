/** Prepared offline-style demo data. Import this in the server page only. */
import { demoPlan, makeDemo } from "@/components/simulator/fixture";

export type LandingSetup = {
  label: string;
  stations: number;
  staff: number;
  served: number;
  walkaways: number;
  p90WaitMin: number | null;
  revenueUsd: number;
  laborUsd: number;
  contributionUsd: number;
};

/** Reuses the product's actual seeded one-vs-two-station fixture, never a new engine. */
export function createLandingDemo() {
  const runs = makeDemo();
  const setup = (index: number): LandingSetup => {
    const { run, monthly } = runs[index];
    return {
      label: index === 0 ? "Current setup" : "Proposed change",
      stations: index + 1,
      staff: index + 1,
      served: run.metrics.served,
      walkaways: run.metrics.abandoned,
      p90WaitMin: run.metrics.p90WaitMin,
      revenueUsd: run.metrics.revenueUsd,
      laborUsd: monthly.costs.laborUsd / 22,
      contributionUsd: monthly.contributionUsd / 22,
    };
  };
  return {
    business: {
      name: "A neighborhood café",
      category: "Coffee shop",
      concept: "Good coffee. A place to stay.",
      city: "Houston",
      area: "Montrose",
      rentLimit: 4500,
      buildout: demoPlan.alternativeBuildout,
      staff: 1,
      hours: "8 AM–noon",
    },
    property: {
      name: "The Montrose café",
      area: "Montrose, Houston",
      rent: (demoPlan.area * demoPlan.rentPerSquareFoot) / 12,
      size: demoPlan.area,
      note: "Example space · generated interior, not a real listing or Matterport scan",
    },
    shortlist: {
      heights: {
        name: "The Heights café",
        area: "The Heights, Houston",
        rent: 3400,
        size: 1350,
      },
    },
    experiment: {
      current: setup(0),
      proposed: setup(1),
      arrivals: runs[0].run.metrics.arrivals,
      seed: 45,
      period: "8 AM–noon",
      wageUsdPerHour: demoPlan.wage,
      additionalBuildoutUsd:
        demoPlan.alternativeBuildout - demoPlan.baselineBuildout,
      definitions: {
        served: "Completed services during the four-hour example morning.",
        walkaways:
          "Balked plus reneged customers; excludes those unfinished at closing.",
        p90WaitMin: "90th percentile waiting time among served customers only.",
        laborUsd: "One or two staff × 4 hours × $18/hour.",
        contributionUsd:
          "Daily equivalent of monthly modeled contribution divided by 22 repeated example mornings; includes ingredients, labor, rent and 36-month buildout amortization, excludes taxes and other overhead.",
      },
    },
    source:
      "Illustrative example · 110 generated customers · seed 45 · same demand and service draws · modeled, not a forecast",
  };
}

export const DEMO = createLandingDemo();
export type LandingDemoData = ReturnType<typeof createLandingDemo>;
