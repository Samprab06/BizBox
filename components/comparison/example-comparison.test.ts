import { beforeAll, describe, expect, it, vi } from "vitest";
import { recordJevExample } from "../../scripts/record-jev-example";
import { fakeJevClient } from "@/lib/panel/__fixtures__";
import type { RecordedJevExample } from "@/lib/panel/recorded-example";
import {
  buildFixtureSchedule,
  peakArrivalHour,
} from "@/lib/sim/fixtures/arrival-schedule";
import { getPreviewProject } from "@/lib/workspace-preview";

const state = vi.hoisted(() => ({
  recorded: undefined as RecordedJevExample | undefined,
}));
vi.mock("@/lib/panel/recorded-example-loader", () => ({
  loadRecordedExample: () => state.recorded,
}));

const sites = getPreviewProject("houston-coffee")!.sites;

describe("example comparison", () => {
  describe("without a recorded Jev table", () => {
    it("keeps the Huff example with no Jev label", async () => {
      state.recorded = undefined;
      vi.resetModules();
      const mod = await import("./example-comparison");
      expect(mod.exampleDemandLabel(sites)).toBeNull();
      const rows = mod.exampleComparison(sites);
      expect(rows).toHaveLength(2);
    });

    it("peaks between 08:00 and 11:00 in the replayed arrivals (HAC-110)", async () => {
      state.recorded = undefined;
      vi.resetModules();
      const mod = await import("./example-comparison");
      for (const visits of [1, 0.8]) {
        for (const { run } of mod.exampleComparison(sites, visits)) {
          const arrivals = run.events.filter((e) => e.type === "arrival");
          const peak = peakArrivalHour({
            customers: arrivals.map((e) => ({ arrivalMin: e.timeMin })) as never,
          });
          expect(peak).not.toBeNull();
          expect(peak!).toBeGreaterThanOrEqual(8);
          expect(peak!).toBeLessThan(11);
        }
      }
    });

    it("gives the same replay for the same seed", async () => {
      state.recorded = undefined;
      vi.resetModules();
      const first = (await import("./example-comparison")).exampleComparison(sites);
      vi.resetModules();
      const second = (await import("./example-comparison")).exampleComparison(sites);
      expect(second.map(({ runId, run }) => [runId, run.events])).toEqual(
        first.map(({ runId, run }) => [runId, run.events]),
      );
      const options = { siteId: "s", seed: 5, dayType: "weekday" as const };
      expect(buildFixtureSchedule(options)).toEqual(buildFixtureSchedule(options));
    });
  });

  describe("with a recorded Jev table", () => {
    beforeAll(async () => {
      state.recorded = await recordJevExample({
        client: fakeJevClient(),
        now: () => new Date("2026-11-14T12:00:00Z"),
      });
    }, 20_000);

    it("labels the example with the model version and recording date", async () => {
      vi.resetModules();
      const mod = await import("./example-comparison");
      expect(mod.exampleDemandLabel(sites)).toBe(
        `Recorded Jev answers, ${state.recorded!.modelVersion}, 2026-11-14`,
      );
    });

    it(
      "renders from the recorded table with no network call",
      { timeout: 60_000 },
      async () => {
        vi.resetModules();
        const mod = await import("./example-comparison");
        const realFetch = globalThis.fetch;
        let fetched = 0;
        globalThis.fetch = (() => {
          fetched++;
          throw new Error("network is off");
        }) as typeof fetch;
        try {
          const rows = mod.exampleComparison(sites);
          expect(rows).toHaveLength(2);
          expect(
            rows.every((r) => Number.isFinite(r.mean) && r.low <= r.high),
          ).toBe(true);
          expect(mod.exampleComparison(sites)).toBe(rows); // computed once per process
          expect(rows[0]!.run.metrics.arrivals).toBeGreaterThan(0);
          expect(mod.examplePersonas[0]!.id).toBe(
            state.recorded!.personaSet.personas[0]!.id,
          );
        } finally {
          globalThis.fetch = realFetch;
        }
        expect(fetched).toBe(0);
      },
    );

    it("falls back to the Huff example when the recording does not cover the project's sites", async () => {
      vi.resetModules();
      const mod = await import("./example-comparison");
      const other = [{ ...sites[0]!, id: "elsewhere" }];
      expect(mod.exampleDemandLabel(other)).toBeNull();
      expect(mod.exampleComparison(other)).toHaveLength(1);
    });
  });
});
