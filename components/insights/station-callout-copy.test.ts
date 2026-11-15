import { describe, expect, it } from "vitest";
import {
  amountRange,
  counterWord,
  founderOptionTitle,
  founderRecommendation,
  founderSourceLine,
  founderStatusBadge,
  hoursLine,
  moneyRange,
  progressLine,
  signedAmount,
  signedMoneyPerMonth,
  staffLine,
} from "./station-callout-copy";

describe("founder counters copy", () => {
  it("titles options", () => {
    expect(founderOptionTitle("baseline", 2, 2)).toBe("Today: 2 counters");
    expect(founderOptionTitle("plus-one", 3, 2)).toBe("+1 counter (3)");
    expect(founderOptionTitle("plus-two", 4, 2)).toBe("+2 counters (4)");
    expect(counterWord(1)).toBe("1 counter");
  });
  it("maps statuses to badges", () => {
    expect(founderStatusBadge("queued")?.label).toBe("Waiting");
    expect(founderStatusBadge("running")?.label).toBe("Running…");
    expect(founderStatusBadge("failed")?.label).toBe("Couldn't run");
    expect(founderStatusBadge("succeeded")).toBeNull();
    expect(founderStatusBadge("planned", true)?.label).toBe(
      "Needs confirmation",
    );
  });
  it("formats signed values and ranges", () => {
    expect(signedMoneyPerMonth(1800.4)).toBe("+$1,800/mo");
    expect(signedMoneyPerMonth(-300)).toBe("−$300/mo");
    expect(signedAmount(120, "customers")).toBe("+120 customers");
    expect(signedAmount(-6, "min wait")).toBe("−6 min wait");
    expect(moneyRange(-100, 2500)).toBe("−$100 to $2,500");
    expect(amountRange(-5, 40)).toBe("−5 to 40");
  });
  it("builds lines", () => {
    expect(progressLine(3, 3)).toBe("3 of 3 setups done");
    expect(staffLine(2)).toBe("2 staff on shift");
    expect(founderSourceLine("jev")).toContain("Jev customer panel");
    expect(founderSourceLine("huff")).toContain("Huff estimate");
    const h = { openMin: 420, closeMin: 900 };
    expect(hoursLine({ weekday: h, weekend: h })).toBe("Open 7am–3pm every day.");
    expect(
      hoursLine({ weekday: h, weekend: { openMin: 480, closeMin: 900 } }),
    ).toBe("Open 7am–3pm on weekdays, 8am–3pm on weekends.");
  });
  it("recommends without ids", () => {
    const text = founderRecommendation({
      fromEffectiveStations: 2,
      toEffectiveStations: 3,
      contributionMean: 1800,
    });
    expect(text).toBe(
      "Best option: +1 counter. It adds about $1,800 a month in contribution (modeled).",
    );
    expect(founderRecommendation(null)).toContain("today's setup does best");
  });
});
