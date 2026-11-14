import { describe, expect, it, vi } from "vitest";
import { getInteriorFixture } from "@/lib/interior/fixtures";
import { resolveInterior } from "@/lib/interior/service";
import {
  INTERIOR_SOURCE_LABELS,
  fetchInterior,
  interiorDisplay,
} from "./interior-source";

const ready = (id: string) => {
  const interior = getInteriorFixture(id);
  if (!interior) throw new Error(`missing fixture ${id}`);
  return { status: "ready" as const, interior };
};

describe("interiorDisplay", () => {
  it("labels each SIM-12 kind with its own source label", () => {
    expect(
      interiorDisplay(ready("interior-fixture-scan"), { sdkKey: "key" }),
    ).toMatchObject({
      kind: "scan",
      sourceKind: "scan",
      label: "Scanned interior",
      modelId: "Synthetic01",
      sdkKey: "key",
      fallbackReason: null,
    });
    expect(interiorDisplay(ready("interior-fixture-floorplan"))).toMatchObject({
      kind: "floorplan",
      label: "Listing floor plan",
      floorPlanUri: "/api/sites/interior-fixture-floorplan/interior/floorplan",
    });
    expect(interiorDisplay(ready("interior-fixture-modeled"))).toMatchObject({
      kind: "modeled",
      sourceKind: "modeled",
      label: "Modeled layout",
      fallbackReason: null,
    });
  });

  it("never labels a scan it cannot show as scanned", () => {
    const display = interiorDisplay(ready("interior-fixture-scan"));
    expect(display).toMatchObject({
      kind: "modeled",
      sourceKind: "scan",
      label: "Modeled layout",
    });
    expect(display.fallbackReason).toMatch(/SDK key/);
    // Recorded room bounds still reach the layout helper.
    expect(display.dimensions?.floors[0].rooms[0].id).toBe("synthetic-room");
  });

  it("falls back to the labelled modeled layout while loading or on failure", () => {
    for (const status of ["loading", "not_found", "error"] as const) {
      const display = interiorDisplay({ status }, { sdkKey: "key" });
      expect(display.kind).toBe("modeled");
      expect(display.label).toBe(INTERIOR_SOURCE_LABELS.modeled);
      expect(display.fallbackReason).toBeTruthy();
    }
  });

  it("keeps the gated modeled response's provenance and label", async () => {
    const response = await resolveInterior("12:34", async () => ({
      siteId: "12:34",
      propertyId: "12",
      floorPlanUri: null,
      models: [],
    }));
    const display = interiorDisplay({ status: "ready", interior: response });
    expect(display.label).toBe("Modeled layout");
    expect(display.provenance?.limitations.join(" ")).toMatch(/HAC-14/);
  });
});

describe("fetchInterior", () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  it("reads the SIM-12 route for the encoded site ID", async () => {
    const fetcher = vi.fn(async () =>
      json(getInteriorFixture("interior-fixture-modeled")),
    );
    const load = await fetchInterior("12:34", fetcher as typeof fetch);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/sites/12%3A34/interior",
      expect.anything(),
    );
    expect(load).toMatchObject({
      status: "ready",
      interior: { kind: "modeled" },
    });
  });

  it("maps missing, failing and malformed responses to fallbacks", async () => {
    const run = (response: Response) =>
      fetchInterior("1:2", (async () => response) as typeof fetch);
    expect(await run(json({ error: "x" }, 404))).toEqual({
      status: "not_found",
    });
    expect(await run(json({ error: "x" }, 503))).toEqual({ status: "error" });
    expect(await run(json({ kind: "scan" }))).toEqual({ status: "error" });
    expect(
      await fetchInterior("1:2", (async () => {
        throw new Error("offline");
      }) as typeof fetch),
    ).toEqual({ status: "error" });
  });
});
