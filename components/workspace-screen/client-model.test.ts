import { describe, expect, it } from "vitest";
import {
  candidateCoordinates,
  comparisonMatchesSelection,
  scannedInterior,
} from "./client-model";
import type { WorkspaceCandidate } from "./client-model";
import type { LiveComparisonPayload } from "@/lib/client/live-comparison";
import type { InteriorResponse } from "@/lib/contracts/interior";

describe("founder workspace source boundaries", () => {
  it("does not invent a camera location for missing coordinates", () => {
    expect(candidateCoordinates(undefined)).toBeNull();
    expect(
      candidateCoordinates({
        candidate: { latitude: { value: null }, longitude: { value: -118 } },
      } as WorkspaceCandidate),
    ).toBeNull();
  });
  it("rejects old, example and differently selected comparison results", () => {
    const payload = {
      comparison: { synthetic: false },
      outdated: false,
      result: { sites: [{ siteId: "1:2" }, { siteId: "3:4" }] },
    } as LiveComparisonPayload;
    expect(comparisonMatchesSelection(payload, ["3:4", "1:2"])).toBe(true);
    expect(comparisonMatchesSelection(payload, ["1:2"])).toBe(false);
    expect(
      comparisonMatchesSelection({ ...payload, outdated: true }, [
        "1:2",
        "3:4",
      ]),
    ).toBe(false);
    expect(
      comparisonMatchesSelection(
        { ...payload, comparison: { synthetic: true } },
        ["1:2", "3:4"],
      ),
    ).toBe(false);
    expect(
      comparisonMatchesSelection({ ...payload, comparison: undefined }, [
        "1:2",
        "3:4",
      ]),
    ).toBe(false);
  });
  it("never substitutes a demo scan for a selected property", () => {
    const scan = {
      kind: "scan",
      modelId: "abcdefghijk",
      provenance: { scope: "demo", mode: "recorded" },
    } as InteriorResponse;
    expect(scannedInterior(scan)).toBeNull();
    expect(
      scannedInterior({
        ...scan,
        provenance: { ...scan.provenance, scope: "space", mode: "synthetic" },
      }),
    ).toBeNull();
    expect(
      scannedInterior({
        ...scan,
        provenance: { ...scan.provenance, scope: "space", mode: "live" },
      })?.modelId,
    ).toBe("abcdefghijk");
  });
});
