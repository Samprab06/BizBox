import { beforeAll, describe, expect, it, vi } from "vitest";
import { recordJevExample } from "../../scripts/record-jev-example";
import { fakeJevClient } from "@/lib/panel/__fixtures__";
import type { RecordedJevExample } from "@/lib/panel/recorded-example";
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
