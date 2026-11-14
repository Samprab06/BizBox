import { describe, expect, it } from "vitest";
import { createRootScenario } from "./model";
import { buildScenarioPatch } from "./patch";

const wrap = (value: number, unit: string) => ({
  value,
  unit,
  origin: "founder" as const,
  evidenceIds: ["original-answer"],
});
const parent = () =>
  createRootScenario({
    id: "root",
    projectId: "p1",
    siteIds: ["2:1", "1:1"],
    profileVersion: 1,
    author: "founder",
    label: "Baseline",
    createdAt: "2026-11-14T00:00:00Z",
    overrides: {
      staffHeadcount: wrap(2, "people"),
      hours: {
        weekend: {
          openMinute: wrap(480, "minute"),
          closeMinute: wrap(960, "minute"),
        },
      },
    },
  });
const founder = { origin: "founder" as const, evidenceIds: ["next-answer"] };

describe("shared UI/tool scenario patches", () => {
  it("merges one day without losing untouched values or relabeling their origin", () => {
    const base = parent();
    const patch = buildScenarioPatch(
      base,
      { kind: "hours", dayType: "weekday", openMinute: 360, closeMinute: 1080 },
      founder,
    );
    expect(patch.overrides).toEqual({
      ...base.overrides,
      hours: {
        ...base.overrides.hours,
        weekday: {
          openMinute: { ...wrap(360, "minute"), evidenceIds: ["next-answer"] },
          closeMinute: {
            ...wrap(1080, "minute"),
            evidenceIds: ["next-answer"],
          },
        },
      },
    });
    expect(base.overrides.hours?.weekday).toBeUndefined();
    expect(patch.overrides?.staffHeadcount).toEqual(
      base.overrides.staffHeadcount,
    );
  });

  it("keeps patch contents identical between UI and agent except the changed wrapper's declared source", () => {
    const ui = buildScenarioPatch(
      parent(),
      { kind: "staffing", headcount: 3 },
      founder,
    );
    const agent = buildScenarioPatch(
      parent(),
      { kind: "staffing", headcount: 3 },
      { ...founder, origin: "default" },
    );
    expect(ui.overrides?.staffHeadcount?.value).toBe(3);
    expect(agent.overrides?.staffHeadcount).toEqual({
      ...ui.overrides!.staffHeadcount,
      origin: "default",
    });
    expect(agent.overrides?.hours).toEqual(ui.overrides?.hours);
  });

  it("rejects invalid hours, fractional staff and duplicate/empty/oversize shortlists", () => {
    for (const change of [
      { kind: "hours", dayType: "weekday", openMinute: 900, closeMinute: 400 },
      { kind: "staffing", headcount: 2.5 },
      { kind: "add_sites", siteIds: ["1:1"] },
      { kind: "remove_sites", siteIds: ["1:1", "2:1"] },
      {
        kind: "add_sites",
        siteIds: Array.from({ length: 7 }, (_, i) => `${i + 3}:1`),
      },
    ])
      expect(() => buildScenarioPatch(parent(), change, founder)).toThrow();
  });

  it("creates detached sorted shortlist patches and validates dollar precision at the boundary", () => {
    expect(
      buildScenarioPatch(
        parent(),
        { kind: "add_sites", siteIds: ["3:1"] },
        founder,
      ),
    ).toEqual({ siteIds: ["1:1", "2:1", "3:1"] });
    expect(
      buildScenarioPatch(
        parent(),
        { kind: "price", averageTicketCents: 780 },
        founder,
      ).overrides?.averageTicketCents,
    ).toMatchObject({ value: 780, unit: "cents", origin: "founder" });
    expect(() =>
      buildScenarioPatch(
        parent(),
        { kind: "price", averageTicketCents: 780.5 },
        founder,
      ),
    ).toThrow();
  });
});
