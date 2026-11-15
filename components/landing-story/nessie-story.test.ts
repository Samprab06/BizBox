import { describe, expect, it } from "vitest";
import { createLocationStory } from "./location-data";
import { nessieAt, nessieExample, nessieSchedule } from "./nessie-story";
const data = createLocationStory();
describe("Nessie landing demo", () => {
  it("reserves the same setup and three months of each property's rent, without treating cash as profit", () => {
    const example = nessieExample(data);
    expect(example.sites.map((site) => site.remaining)).toEqual([14000, 10100]);
    expect(example.difference).toBe(3900);
    for (const site of example.sites)
      expect(site.remaining + site.reserve + example.setup).toBe(example.cash);
    expect(example.replies.join(" ")).toContain(
      "Other operating costs still need a budget",
    );
  });
  it("shows data checks before the final answer and skips animation under reduced motion", () => {
    const schedule = nessieSchedule(data);
    expect(nessieAt(data, 0, false).stage).toBe("prompt");
    expect(nessieAt(data, schedule.sentAt + 10, false).stage).toBe("checking");
    expect(nessieAt(data, schedule.sentAt + 2000, false).stage).toBe(
      "snapshot",
    );
    expect(nessieAt(data, schedule.sentAt + 5000, false).stage).toBe(
      "comparison",
    );
    expect(nessieAt(data, schedule.duration, false)).toMatchObject({
      stage: "answer",
      complete: true,
    });
    expect(nessieAt(data, 0, true)).toMatchObject({
      stage: "answer",
      complete: true,
    });
    expect(nessieAt(data, schedule.sentAt + 5000, false).replyVisible).toBe(
      false,
    );
  });
});
