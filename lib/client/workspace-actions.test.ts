import { describe, expect, it } from "vitest";
import type { UiAction } from "@/lib/contracts/agent";
import { planWorkspaceActions } from "./agent-jobs";
import { initialFlowState, reachStep, type FlowState } from "./flow-progress";
import {
  initialProgressReported,
  progressBand,
  progressReport,
  PROGRESS_REPORT_INTERVAL_MS,
} from "./live-comparison";
import { pickSiteTweaks, siteTweaksKey } from "./project-store";

let n = 0;
const act = (a: Record<string, unknown>) =>
  ({ id: `act_${++n}`, ...a }) as UiAction;
const ids = ["1:1", "2:2", "3:3", "4:4"];
const atLocations: FlowState = reachStep(initialFlowState(), "locations");
const atResults: FlowState = reachStep(initialFlowState(), "results");

describe("planWorkspaceActions", () => {
  it("presents the top sites and shortlists them only when nothing is chosen", () => {
    const action = act({ type: "present_top_sites", siteIds: ids.slice(0, 3) });
    expect(
      planWorkspaceActions([action], {
        candidateIds: ids,
        selectedIds: [],
        flow: atLocations,
      }),
    ).toEqual([
      { kind: "present", siteIds: ids.slice(0, 3) },
      { kind: "select", siteIds: ids.slice(0, 3) },
    ]);
    expect(
      planWorkspaceActions([action], {
        candidateIds: ids,
        selectedIds: ["4:4"],
        flow: atLocations,
      }),
    ).toEqual([{ kind: "present", siteIds: ids.slice(0, 3) }]);
  });

  it("drops unknown ids and caps a shortlist at three units", () => {
    const effects = planWorkspaceActions(
      [act({ type: "set_shortlist", siteIds: ["9:9", ...ids] })],
      { candidateIds: ids, selectedIds: [], flow: atLocations },
    );
    expect(effects).toEqual([{ kind: "select", siteIds: ids.slice(0, 3) }]);
    expect(
      planWorkspaceActions([act({ type: "set_shortlist", siteIds: ["9:9"] })], {
        candidateIds: ids,
        selectedIds: [],
        flow: atLocations,
      }),
    ).toEqual([]);
  });

  it("runs a comparison: selection, the compare step, then the run", () => {
    expect(
      planWorkspaceActions(
        [act({ type: "run_comparison", siteIds: ["1:1", "2:2"] })],
        { candidateIds: ids, selectedIds: ["1:1"], flow: atLocations },
      ),
    ).toEqual([
      { kind: "select", siteIds: ["1:1", "2:2"] },
      { kind: "step", step: "compare" },
      { kind: "run", siteIds: ["1:1", "2:2"] },
    ]);
  });

  it("go_to_step counts what earlier actions in the reply unlock, never a locked step", () => {
    const shortlistThenCompare = [
      act({ type: "set_shortlist", siteIds: ["1:1", "2:2"] }),
      act({ type: "go_to_step", step: "compare" }),
    ];
    expect(
      planWorkspaceActions(shortlistThenCompare, {
        candidateIds: ids,
        selectedIds: [],
        flow: atLocations,
      }).at(-1),
    ).toEqual({ kind: "step", step: "compare" });
    expect(
      planWorkspaceActions([act({ type: "go_to_step", step: "results" })], {
        candidateIds: ids,
        selectedIds: [],
        flow: atLocations,
      }),
    ).toEqual([]);
    // A tweak makes the results outdated within the same reply.
    expect(
      planWorkspaceActions(
        [
          act({
            type: "set_site_tweaks",
            candidateId: "1:1",
            tweaks: { priceUsd: 7 },
          }),
          act({ type: "go_to_step", step: "results" }),
        ],
        { candidateIds: ids, selectedIds: ["1:1", "2:2"], flow: atResults },
      ),
    ).toEqual([
      { kind: "tweaks", candidateId: "1:1", tweaks: { priceUsd: 7 } },
    ]);
  });

  it("moves to a step at most once per reply, and never to the step on screen", () => {
    // C's typical "yes": set_shortlist, run_comparison, go_to_step compare.
    expect(
      planWorkspaceActions(
        [
          act({ type: "set_shortlist", siteIds: ["1:1", "2:2"] }),
          act({ type: "run_comparison", siteIds: ["1:1", "2:2"] }),
          act({ type: "go_to_step", step: "compare" }),
        ],
        {
          candidateIds: ids,
          selectedIds: [],
          flow: atLocations,
          step: "locations",
        },
      ),
    ).toEqual([
      { kind: "select", siteIds: ["1:1", "2:2"] },
      { kind: "step", step: "compare" },
      { kind: "run", siteIds: ["1:1", "2:2"] },
    ]);
    // comparison_finished's go_to_step results after the client already opened results.
    expect(
      planWorkspaceActions([act({ type: "go_to_step", step: "results" })], {
        candidateIds: ids,
        selectedIds: ["1:1", "2:2"],
        flow: atResults,
        step: "results",
      }),
    ).toEqual([]);
  });

  it("ignores navigate-away actions and replayed ids, and passes highlight/finalize through", () => {
    const replayed = act({ type: "set_shortlist", siteIds: ["1:1", "2:2"] });
    const effects = planWorkspaceActions(
      [
        replayed,
        act({ type: "navigate", stage: "simulator" }),
        act({ type: "show_plan", comparisonId: "c1" }),
        act({ type: "highlight", target: "comparison_table" }),
        act({
          type: "finalize_plan",
          comparisonId: "c1",
          chosenSiteId: "1:1",
          rationale: "Best margin",
        }),
      ],
      {
        candidateIds: ids,
        selectedIds: [],
        flow: atResults,
        handled: new Set([replayed.id]),
      },
    );
    expect(effects).toEqual([
      { kind: "highlight", target: "comparison_table" },
      {
        kind: "finalize",
        comparisonId: "c1",
        chosenSiteId: "1:1",
        rationale: "Best margin",
      },
    ]);
  });
});

describe("progress throttling", () => {
  const p = (completedPersonas: number, totalPersonas = 40) => ({
    completedPersonas,
    totalPersonas,
  });

  it("maps persona counts to quarter bands", () => {
    expect(progressBand(p(0))).toBe(0);
    expect(progressBand(p(9))).toBe(0);
    expect(progressBand(p(10))).toBe(1);
    expect(progressBand(p(39))).toBe(3);
    expect(progressBand(p(40))).toBe(4);
    expect(progressBand(p(5, 0))).toBe(0);
  });

  it("reports at most once per 25% band, never on every poll", () => {
    let reported = initialProgressReported(0);
    // One poll a second: band changes only.
    const events = [0, 3, 10, 12, 19, 21, 22, 35, 40, 40].flatMap((done, i) => {
      const report = progressReport(reported, p(done), i * 1000);
      reported = report.reported;
      return report.event ? [report.event] : [];
    });
    expect(events).toEqual([
      { kind: "comparison_progress", completed: 10, total: 40 },
      { kind: "comparison_progress", completed: 21, total: 40 },
      { kind: "comparison_progress", completed: 35, total: 40 },
      { kind: "comparison_progress", completed: 40, total: 40 },
    ]);
    // A jump straight to the end is a single report.
    expect(
      progressReport(initialProgressReported(0), p(40), 1).event,
    ).toEqual({ kind: "comparison_progress", completed: 40, total: 40 });
    expect(
      progressReport({ band: 2, at: 0, completed: 0 }, p(40, 0), 1).event,
    ).toBeNull();
  });

  it("still reports a slow panel every 20 seconds while personas keep answering", () => {
    const last = { band: 1, at: 0, completed: 10 };
    expect(progressReport(last, p(12), 19_999).event).toBeNull();
    expect(progressReport(last, p(12), PROGRESS_REPORT_INTERVAL_MS).event).toEqual({
      kind: "comparison_progress",
      completed: 12,
      total: 40,
    });
    // A stalled panel (no new personas) is not re-reported.
    expect(progressReport(last, p(10), 60_000).event).toBeNull();
  });
});

describe("site tweaks key", () => {
  it("is stable across id order and key order, and empty without tweaks", () => {
    const a = { "1:1": { priceUsd: 7, staff: 3 }, "9:9": { staff: 1 } };
    const b = { "1:1": { staff: 3, priceUsd: 7 } };
    expect(siteTweaksKey(["2:2", "1:1"], a)).toBe(
      siteTweaksKey(["1:1", "2:2"], b),
    );
    expect(siteTweaksKey(["1:1", "2:2"], {})).toBe("");
    expect(siteTweaksKey(["1:1"], { "1:1": {} })).toBe("");
    expect(siteTweaksKey(["1:1"], { "1:1": { priceUsd: 8 } })).not.toBe(
      siteTweaksKey(["1:1"], b),
    );
  });

  it("picks only the selected units' tweaks for the request body", () => {
    expect(
      pickSiteTweaks(["1:1", "2:2"], {
        "1:1": { staff: 2 },
        "3:3": { staff: 4 },
        "2:2": {},
      }),
    ).toEqual({ "1:1": { staff: 2 } });
  });
});
