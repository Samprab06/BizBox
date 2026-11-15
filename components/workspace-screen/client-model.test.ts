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

import {
  candidateFitReasons,
  searchFilterLabel,
  searchPresentation,
} from "./client-model";
import { syntheticHoustonFixture } from "@/fixtures/houston-coffee";
import { liveComparisonSearch } from "@/tests/e2e/live-comparison-fixtures";

describe("listing explanations and readiness actions", () => {
  it("explains known rent/features, never treats unknowns as a confirmed fit", () => {
    const profile = structuredClone(syntheticHoustonFixture.profile);
    profile.economics.monthlyRentCeilingCents.value = 400000;
    profile.mustHaves.groundFloor.value = true;
    const entry = structuredClone(liveComparisonSearch.candidates[0]!);
    entry.baseRentCents = {
      value: 300000,
      unit: "USD cents/month",
      origin: "costar",
      evidenceIds: ["test-rent"],
    };
    entry.candidate.features.groundFloor = {
      value: true,
      unit: "boolean",
      origin: "costar",
      evidenceIds: ["test-ground"],
    };
    expect(candidateFitReasons(entry, profile)).toEqual([
      "Within rent limit",
      "Ground floor listed",
    ]);
    entry.baseRentCents = {
      value: null,
      unit: "USD cents/month",
      origin: "default",
      evidenceIds: [],
      unknownReason: "Not supplied",
    };
    entry.candidate.features.groundFloor.value = null;
    expect(candidateFitReasons(entry, profile)).not.toContain(
      "Within rent limit",
    );
    expect(candidateFitReasons(entry, profile)).not.toContain(
      "Ground floor listed",
    );
    expect(candidateFitReasons(entry, undefined)).toEqual([]);
  });

  it("offers the appropriate action for brief, service and actual no-match states", () => {
    expect(
      searchPresentation(
        { status: "needs_brief", message: "Complete intake" },
        false,
      ),
    ).toEqual({ label: "Complete your brief", action: "finish_brief" });
    expect(
      searchPresentation({ status: "error", message: "Service failed" }, false),
    ).toEqual({ label: "Listings unavailable", action: "retry" });
    expect(
      searchPresentation(
        {
          status: "empty",
          message: "",
          profile: syntheticHoustonFixture.profile,
          filters: [],
          mostRestrictiveFilter: null,
          emptyReason: null,
          totalMatched: 0,
          notes: [],
        },
        false,
      ),
    ).toEqual({ label: "No matching spaces", action: "revise" });
    expect(
      searchPresentation({ status: "loading", message: "" }, true).action,
    ).toBeNull();
    expect(searchFilterLabel("rentCeiling")).toBe("Rent limit");
  });
});
