import { describe, expect, it } from "vitest";
import { createLocationStory } from "./location-data";

describe("prepared location story", () => {
  it("reproduces two runs while preserving the original one-counter morning", () => {
    const data = createLocationStory();
    expect(data).toEqual(createLocationStory());
    expect(data.sites[0]).toMatchObject({
      id: "montrose",
      arrivals: 110,
      served: 55,
      revenueUsd: 440,
      laborUsd: 72,
      cogsUsd: 132,
    });
    expect(data.sites[1]).toMatchObject({
      arrivals: 180,
      served: 58,
      revenueUsd: 464,
    });
    expect(data.sites[1].laborUsd).toBe(72);
  });
  it("compares contribution on the same four-hour horizon including rent and setup allocation", () => {
    const [montrose, heights] = createLocationStory().sites;
    expect(montrose.rentPerMorningUsd).toBeCloseTo(3000 / 22, 8);
    expect(heights.rentPerMorningUsd).toBeCloseTo(4300 / 22, 8);
    expect(heights.contributionUsd).toBeCloseTo(45.98181818, 6);
    expect(montrose.buildoutPerMorningUsd).toBeCloseTo(9000 / 36 / 22, 8);
    expect(montrose.contributionUsd).toBeCloseTo(88.27272727, 6);
    expect(montrose.breakEvenCustomers).toBe(40);
    for (const site of [montrose, heights]) {
      expect(site.contributionUsd).toBeCloseTo(
        site.revenueUsd -
          site.cogsUsd -
          site.laborUsd -
          site.rentPerMorningUsd -
          site.buildoutPerMorningUsd,
        8,
      );
      expect(site.checkpoints.at(-1)).toMatchObject({
        minute: 720,
        arrivals: site.arrivals,
        served: site.served,
      });
      expect(
        site.checkpoints.every(
          (p, i, a) =>
            i === 0 ||
            (p.arrivals >= a[i - 1].arrivals && p.served >= a[i - 1].served),
        ),
      ).toBe(true);
    }
  });
  it("derives a recommendation from results and exposes authored demand assumptions", () => {
    const data = createLocationStory();
    const winner = [...data.sites].sort(
      (a, b) => b.contributionUsd - a.contributionUsd,
    )[0];
    expect(data.selectedId).toBe(winner.id);
    expect(data.consultant.messages.join(" ")).toContain(winner.name);
    expect(data.assumptions.join(" ")).toMatch(/110.*180/);
    expect(data.assumptions.join(" ")).toMatch(/not.*measured/i);
    expect(data.assumptions.join(" ")).toMatch(/taxes/i);
  });
});
