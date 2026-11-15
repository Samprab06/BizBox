import { describe, expect, it } from "vitest";
import {
  candidateCoordinates,
  comparisonMatchesSelection,
  comparisonStaleness,
  listingNotes,
  notModeledUnits,
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

describe("listingNotes", () => {
  const entry = (flags: string[]) => ({ flags }) as WorkspaceCandidate;
  it("maps known flags to plain text, drops noise and unknown flags, and de-duplicates", () => {
    expect(
      listingNotes(
        entry([
          "size_unknown",
          "rent_unknown",
          "anchor_cotenants_unknown",
          "position_unknown",
          "endcap_position",
          "endcap_position",
          "frontage_building_level",
          "nnn_opex_estimated",
          "nnn_opex_override",
          "opex_unknown",
          "opex_assumed_included",
          "something_new",
        ]),
      ),
    ).toEqual([
      "End-cap unit",
      "Frontage is for the whole building, not just this unit",
      "Triple-net lease: taxes, insurance and upkeep are extra (estimated)",
      "Using your estimate for extra lease costs",
      "Extra operating costs aren't listed",
      "Operating costs assumed included in rent",
    ]);
    expect(listingNotes(entry(["size_unknown"]))).toEqual([]);
  });
});

describe("unmodeled units and stale results", () => {
  const payload = {
    comparison: { synthetic: false },
    outdated: false,
    requestedIds: ["1:2", "3:4", "5:6"],
    result: { sites: [{ siteId: "1:2" }, { siteId: "3:4" }] },
    assembly: {
      findings: [
        { code: "DEFAULT_ASSUMPTION", message: "x" },
        { code: "INSUFFICIENT_AREA", message: "y", siteId: "5:6" },
      ],
      assumptions: {},
    },
  } as unknown as LiveComparisonPayload;
  it("explains why a requested unit is missing", () => {
    expect(notModeledUnits(payload, [])).toEqual([
      {
        id: "5:6",
        address: "Saved unit",
        reason: "the space is too small for your setup",
      },
    ]);
    expect(
      notModeledUnits(
        {
          ...payload,
          assembly: { findings: [], assumptions: {} },
        } as LiveComparisonPayload,
        [],
      )[0].reason,
    ).toBe("it couldn't be modeled");
  });
  it("tells a changed selection from changed answers, and keeps matching runs clean", () => {
    const all = ["1:2", "3:4", "5:6"];
    expect(comparisonStaleness(payload, all)).toBeNull();
    expect(comparisonStaleness(payload, ["1:2", "3:4"])).toBe("selection");
    expect(comparisonStaleness(payload, all, "other")).toBe("selection");
    expect(comparisonStaleness({ ...payload, outdated: true }, all)).toBe(
      "answers",
    );
    expect(comparisonStaleness(null, all)).toBeNull();
  });
});
