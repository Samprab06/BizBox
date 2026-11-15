import { describe, expect, it } from "vitest";
import {
  InteriorResponseSchema,
  MatterportManifestSchema,
  ScanPlacementSchema,
} from "../contracts/interior";
import { publicCafeScan } from "./fixtures";
import { readInteriorSite } from "./repository";
import { NO_PLACEMENT_REASON, resolveInterior, scanOverlay } from "./service";

const provenance = {
  origin: "costar" as const,
  provider: "costar" as const,
  mode: "live" as const,
  scope: "space" as const,
  description: "Synthetic test mapping",
  limitations: [],
};
const model = {
  modelId: "Synthetic01",
  spaceId: "12:34",
  displayApproved: true,
  isPublic: true,
  hasExterior: null,
  dimensions: null,
  source: provenance,
};
const site = (placement?: typeof publicCafeScan.placement | null) => ({
  siteId: "12:34",
  propertyId: "56",
  floorPlanUri: null,
  models: [{ ...model, ...(placement === undefined ? {} : { placement }) }],
});

describe("HAC-138 scan placement", () => {
  it("keeps the café's hand-calibrated values in its registry row", () => {
    expect(publicCafeScan.modelId).toBe("qfmMbTLt4Bo");
    // The exact values the simulator page previously hard-coded.
    expect(publicCafeScan.placement).toEqual({
      origin: { x: 17.1, y: 0.04, z: 10.3 },
      rotationY: Math.PI,
      scale: 0.5,
      floorY: 0.04,
      entranceSweep: null,
      serviceSweep: {
        sweepId: "y0xe63ayfyepf8cg51cua77hb",
        rotation: { x: -17, y: 168 },
      },
    });
  });

  it("validates placements", () => {
    const valid = publicCafeScan.placement;
    expect(ScanPlacementSchema.safeParse(valid).success).toBe(true);
    for (const invalid of [
      { ...valid, scale: 0 },
      { ...valid, rotationY: Number.NaN },
      { ...valid, floorY: undefined },
      { ...valid, extra: 1 },
      { ...valid, serviceSweep: { sweepId: "" } },
    ])
      expect(ScanPlacementSchema.safeParse(invalid).success).toBe(false);
  });

  it("returns a registry placement with an approved scan", async () => {
    const result = await resolveInterior(
      "12:34",
      async () => site(publicCafeScan.placement),
      { allowLicensedAssets: true },
    );
    expect(result).toMatchObject({
      kind: "scan",
      placement: publicCafeScan.placement,
    });
    expect(result.provenance.limitations).not.toContain(NO_PLACEMENT_REASON);
    expect(scanOverlay(result)).toEqual({
      mode: "scan",
      placement: publicCafeScan.placement,
    });
  });

  it.each([undefined, null])(
    "falls back to Modeled layout with a reason when placement is %s",
    async (placement) => {
      const result = await resolveInterior(
        "12:34",
        async () => site(placement),
        {
          allowLicensedAssets: true,
        },
      );
      expect(result.kind).toBe("scan");
      expect(result).not.toHaveProperty("placement");
      expect(result.provenance.limitations).toContain(NO_PLACEMENT_REASON);
      expect(scanOverlay(result)).toEqual({
        mode: "modeled",
        reason: expect.stringMatching(/Modeled layout/),
      });
    },
  );

  it("non-scan responses explain why the overlay is modeled", async () => {
    const result = await resolveInterior("12:34", async () => site());
    expect(scanOverlay(result)).toMatchObject({ mode: "modeled" });
    expect(
      (scanOverlay(result) as { reason: string }).reason.length,
    ).toBeGreaterThan(0);
  });

  it("reads and validates a placement column", async () => {
    const responses = [
      [{ id: "12:34", property_id: "56", floor_plan_uri: null }],
      [
        {
          model_id: "Synthetic01",
          costar_space_id: "12:34",
          has_exterior: null,
          display_approved: true,
          dimensions: null,
          placement: publicCafeScan.placement,
          source: provenance,
        },
        {
          model_id: "Synthetic02",
          costar_space_id: null,
          has_exterior: null,
          display_approved: false,
          dimensions: null,
          placement: null,
          source: provenance,
        },
      ],
    ];
    const db = { execute: async () => responses.shift() };
    const read = await readInteriorSite(db, "12:34");
    expect(read?.models.map((m) => m.placement)).toEqual([
      publicCafeScan.placement,
      null,
    ]);
    const bad = [
      [{ id: "12:34", property_id: "56", floor_plan_uri: null }],
      [
        {
          model_id: "Synthetic01",
          placement: { origin: 1 },
          source: provenance,
        },
      ],
    ];
    await expect(
      readInteriorSite({ execute: async () => bad.shift() }, "12:34"),
    ).rejects.toThrow();
  });

  it("accepts placement on manifest rows and the scan response", () => {
    const row = {
      modelId: "Synthetic01",
      costarPropertyId: "56",
      costarSpaceId: "12:34",
      hasExterior: null,
      source: provenance,
      placement: publicCafeScan.placement,
    };
    expect(
      MatterportManifestSchema.parse({ version: 1, models: [row] }).models[0]
        .placement,
    ).toEqual(publicCafeScan.placement);
    expect(
      InteriorResponseSchema.safeParse({
        kind: "modeled",
        placement: publicCafeScan.placement,
        provenance,
      }).success,
    ).toBe(false);
  });
});
