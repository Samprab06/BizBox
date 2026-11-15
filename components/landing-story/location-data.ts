/** Server-prepared authored scenarios. No live demand or listing claim. */
import { makeDemoInputs } from "@/components/simulator/fixture";
import { simulateDay } from "@/lib/sim/engine";
import { computeMonthlyEconomics } from "@/lib/sim/economics";
import { createRng } from "@/lib/sim/random";

export type LocationId = "montrose" | "heights";
export function createLocationStory() {
  const { configs } = makeDemoInputs();
  const { schedule } = makeDemoInputs();
  const rng = createRng(45);
  const customers = Array.from({ length: 180 }, (_, i) => ({
    id: `customer-${i + 1}`,
    personaId: "morning-visitor",
    arrivalMin: 480 + 239 * rng.next() ** 1.55,
    stayDraw: rng.next(),
    serviceMin: 2 + 4 * rng.next(),
  }));
  const sites = [
    {
      id: "montrose" as const,
      name: "Montrose",
      rent: 3000,
      size: 1200,
      longitude: -95.391,
      latitude: 29.7426,
      demand: 110,
    },
    {
      id: "heights" as const,
      name: "The Heights",
      rent: 4300,
      size: 1350,
      longitude: -95.399,
      latitude: 29.79,
      demand: 180,
    },
  ].map(({ demand, ...site }) => {
    const config = {
      ...configs[0],
      stations: { ...configs[0].stations, usableSf: site.size },
      lease: {
        ...configs[0].lease,
        sf: site.size,
        askingRentUsdPerSfYear: (site.rent * 12) / site.size,
      },
    };
    const run = simulateDay(
      { ...schedule, siteId: site.id, customers: customers.slice(0, demand) },
      config,
    );
    const monthly = computeMonthlyEconomics(config, {
      weekday: run.metrics,
      weekend: { served: 0, revenueUsd: 0 },
    });
    const laborUsd = monthly.costs.laborUsd / 22;
    const rentPerMorningUsd = monthly.costs.baseRentUsd / 22;
    const buildoutPerMorningUsd = monthly.costs.buildoutAmortizationUsd / 22;
    return {
      ...site,
      arrivals: run.metrics.arrivals,
      served: run.metrics.served,
      revenueUsd: run.metrics.revenueUsd,
      laborUsd,
      cogsUsd: monthly.costs.cogsUsd / 22,
      rentPerMorningUsd,
      buildoutPerMorningUsd,
      contributionUsd: monthly.contributionUsd / 22,
      breakEvenCustomers: Math.ceil(
        (laborUsd + rentPerMorningUsd + buildoutPerMorningUsd) / (8 * 0.7),
      ),
      checkpoints: Array.from({ length: 49 }, (_, i) => {
        const minute = 480 + i * 5;
        return {
          minute,
          served: run.events.filter(
            (e) => e.timeMin <= minute && e.type === "completion",
          ).length,
          arrivals: run.events.filter(
            (e) => e.timeMin <= minute && e.type === "arrival",
          ).length,
        };
      }),
    };
  });
  const [winner, other] = [...sites].sort(
    (a, b) => b.contributionUsd - a.contributionUsd,
  );
  const delta = winner.contributionUsd - other.contributionUsd;
  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(n);
  return {
    seed: 45,
    period: "8 AM–noon",
    sites,
    selectedId: winner.id,
    consultant: {
      question: "Is the higher rent worth it?",
      messages: [
        `The higher rent leaves ${other.name} with less money after modeled costs.`,
        `The Heights has ${sites[1].arrivals - sites[0].arrivals} extra assumed arrivals, but one counter serves just ${sites[1].served - sites[0].served} more customers.`,
        `${winner.name} keeps ${fmt(delta)} more each morning in this example. Let's look inside.`,
      ],
    },
    assumptions: [
      "Example properties and neighborhood positions, not verified listings or entrances. Rent and size are authored demo inputs.",
      "Demand: 110 potential customers in Montrose and 180 in The Heights; authored assumptions, not measured foot traffic. Example rents: $3,000 and $4,300/month. Same seed and shared customer draws.",
      "Same café: one staffed counter, $8 ticket, $18/hour labor, 30% ingredients, 8 AM–noon. Model includes queue abandonment and unfinished service at closing.",
      "Rent is allocated across 22 identical four-hour mornings per month. $9,000 setup is amortized over 36 months and allocated across those mornings.",
      "Money remaining is modeled contribution after ingredients, labor, allocated rent and setup. Excludes taxes, utilities and other overhead; not a profit forecast.",
    ],
  };
}
export type LocationStoryData = ReturnType<typeof createLocationStory>;
