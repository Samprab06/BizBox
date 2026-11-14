import { describe, expect, it, vi } from "vitest";
import { stationPlan } from "@/tests/e2e/station-experiment-fixtures";
import {
  parseStationRun,
  runStationBatch,
  boundedStationWrite,
} from "./station-callout-client";

const source = stationPlan().source;
describe("explicit station batch", () => {
  it("executes each completed configuration sequentially only within the explicit action", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(stationPlan(1))
      .mockResolvedValueOnce(stationPlan(2))
      .mockResolvedValueOnce(stationPlan(3));
    const result = await runStationBatch(stationPlan(), {
      request,
      onUpdate: vi.fn(),
      isCurrent: () => true,
    });
    expect(request.mock.calls.map((call) => call[0])).toEqual([
      { configurationId: "baseline", confirm: false },
      { configurationId: "plus-one", confirm: false },
      { configurationId: "plus-two", confirm: false },
    ]);
    expect(result?.status).toBe("ready");
  });
  it("stops on real confirmation after preserving completed baseline and confirms only that configuration", async () => {
    const plan = stationPlan(1);
    plan.status = "needs_confirmation";
    plan.confirmation = {
      configurationId: "plus-one",
      costUnits: 6,
      remainingUnits: 2,
    };
    const request = vi.fn().mockResolvedValue(plan),
      onUpdate = vi.fn();
    await runStationBatch(stationPlan(), {
      request,
      onUpdate,
      isCurrent: () => true,
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith(plan);
    const resume = vi
      .fn()
      .mockResolvedValueOnce(stationPlan(2))
      .mockResolvedValueOnce(stationPlan(3));
    await runStationBatch(plan, {
      request: resume,
      onUpdate: vi.fn(),
      isCurrent: () => true,
      confirm: true,
    });
    expect(resume.mock.calls.map((call) => call[0])).toEqual([
      { configurationId: "plus-one", confirm: true },
      { configurationId: "plus-two", confirm: false },
    ]);
  });
  it("stops partial jobs and never writes the next configuration after source invalidation", async () => {
    const partial = stationPlan();
    partial.status = "running";
    partial.configurations[0].status = "running";
    const request = vi.fn().mockResolvedValue(partial);
    await runStationBatch(stationPlan(), {
      request,
      onUpdate: vi.fn(),
      isCurrent: () => true,
    });
    expect(request).toHaveBeenCalledTimes(1);
    let current = true;
    const changed = vi.fn(async () => {
      current = false;
      return stationPlan(1);
    });
    const update = vi.fn();
    await runStationBatch(stationPlan(), {
      request: changed,
      onUpdate: update,
      isCurrent: () => current,
    });
    expect(changed).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });
  it("rejects responses for another baseline, site, profile or seed set", () => {
    for (const changes of [
      { comparisonId: "wrong" },
      { siteId: "wrong" },
      { profileVersion: 999 },
      { seeds: [99], seedCount: 1 },
    ]) {
      const payload = stationPlan(3);
      Object.assign(payload.source, changes);
      expect(() => parseStationRun(payload, source)).toThrow();
    }
  });
  it("keeps completed progress and stops if the next request fails", async () => {
    const update = vi.fn(),
      request = vi
        .fn()
        .mockResolvedValueOnce(stationPlan(1))
        .mockRejectedValueOnce(new Error("offline"));
    await expect(
      runStationBatch(stationPlan(), {
        request,
        onUpdate: update,
        isCurrent: () => true,
      }),
    ).rejects.toThrow("offline");
    expect(request).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledExactlyOnceWith(stationPlan(1));
  });
  it("rejects unverified confirmation and selected/evaluated-baseline data", () => {
    const missing = stationPlan(1);
    missing.status = "needs_confirmation";
    expect(() => parseStationRun(missing, source)).toThrow();
    const wrong = stationPlan(3);
    if (wrong.result?.status === "available")
      wrong.result.identity.baselineComparisonId = source.comparisonId;
    expect(() => parseStationRun(wrong, source)).toThrow();
    const value = stationPlan(3);
    if (value.result?.status === "available" && value.result.selected)
      value.result.selected.monthlyRevenueChangeUsd.mean += 1;
    expect(() => parseStationRun(value, source)).toThrow();
  });
  it("bounds an unknown write without cancellation, late updates or automatic retries", async () => {
    vi.useFakeTimers();
    try {
      let complete!: (value: ReturnType<typeof stationPlan>) => void;
      const pending = new Promise<ReturnType<typeof stationPlan>>((resolve) => {
        complete = resolve;
      });
      const update = vi.fn(),
        request = vi.fn(() => boundedStationWrite(pending));
      const outcome = runStationBatch(stationPlan(), {
        request,
        onUpdate: update,
        isCurrent: () => true,
      });
      const observed = outcome.catch((error) => error);
      await vi.advanceTimersByTimeAsync(70000);
      expect(await observed).toEqual(
        expect.objectContaining({ message: expect.stringContaining("status") }),
      );
      complete(stationPlan(1));
      await Promise.resolve();
      await Promise.resolve();
      expect(request).toHaveBeenCalledTimes(1);
      expect(update).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it("validates known synthetic provenance and the ready model version", () => {
    expect(() =>
      parseStationRun(stationPlan(), { ...source, synthetic: false }),
    ).toThrow();
    expect(() =>
      parseStationRun(stationPlan(3), {
        ...source,
        modelVersion: "different-model",
      }),
    ).toThrow();
  });
});
