import { describe, expect, it } from "vitest";
import { getPreviewProject } from "@/lib/workspace-preview";
import type { IntakeSession } from "@/components/intake/profile";
import type { SiteSearchResult } from "@/lib/contracts/sites";
import {
  cityPhotoFor,
  metricText,
  nextAssistantMode,
  selectedSpace,
  workspaceHeader,
} from "./model";

const project = getPreviewProject("houston-coffee")!;
const metric = (value: number | null, unit: string) => ({
  value,
  unit,
  origin: "costar" as const,
  evidenceIds: ["e1"],
  ...(value === null ? { unknownReason: "Not listed" } : {}),
});

describe("assistant mode tabs", () => {
  it("moves with arrows (wrapping), Home and End, and ignores other keys", () => {
    expect(nextAssistantMode("text", "ArrowRight")).toBe("voice");
    expect(nextAssistantMode("voice", "ArrowRight")).toBe("text");
    expect(nextAssistantMode("text", "ArrowLeft")).toBe("voice");
    expect(nextAssistantMode("voice", "Home")).toBe("text");
    expect(nextAssistantMode("text", "End")).toBe("voice");
    expect(nextAssistantMode("text", "Enter")).toBeNull();
  });
});

describe("city photo", () => {
  it("labels the Houston and Los Angeles photos as previews, not maps", () => {
    expect(cityPhotoFor("Houston, TX")?.src).toBe(
      "/workspace/houston-real.jpg",
    );
    expect(cityPhotoFor("Los Angeles")?.src).toBe("/workspace/la-real.jpg");
    expect(cityPhotoFor("Los Angeles")?.alt).toMatch(
      /not the selected space or a map/,
    );
    expect(cityPhotoFor("Chicago")).toBeNull();
    expect(cityPhotoFor(undefined)).toBeNull();
  });
});

describe("workspace header", () => {
  it("uses the founder's brief for city, business and rent limit", () => {
    const session: IntakeSession = {
      profile: {
        city: { value: "Los Angeles", origin: "founder" },
        category: { value: "Salon or barber", origin: "founder" },
        rent: { value: "6355", origin: "founder" },
      },
      messages: [],
    };
    expect(workspaceHeader(session, project)).toEqual({
      city: "Los Angeles",
      business: "Salon or barber",
      budget: "$6,355/mo rent limit",
      budgetIsDefault: false,
    });
  });

  it("falls back to the preview project and never invents a budget", () => {
    expect(workspaceHeader(null, project)).toEqual({
      city: "Houston",
      business: "Coffee shop",
      budget: "Rent limit not set",
      budgetIsDefault: false,
    });
    expect(workspaceHeader(null, null).city).toBe("City not set");
  });
});

describe("selected space", () => {
  it("shows the requested example site, labelled as an example with its rent marked unavailable", () => {
    const space = selectedSpace(
      { mode: "example", message: "Complete your intake." },
      project,
      "heights",
    );
    expect(space).toMatchObject({
      kind: "space",
      id: "heights",
      name: "Heights storefront",
      example: true,
    });
    if (space.kind !== "space") throw new Error("expected a space");
    expect(space.stats).toEqual([
      { label: "Monthly rent", value: "Not listed" },
      expect.objectContaining({ label: "Area" }),
    ]);
  });

  it("falls back to the first example site and reports loading and empty states", () => {
    expect(
      selectedSpace({ mode: "example", message: "m" }, project, "nope"),
    ).toMatchObject({ id: "montrose" });
    expect(selectedSpace({ mode: "loading" }, project, undefined)).toEqual({
      kind: "loading",
    });
    expect(
      selectedSpace(
        { mode: "example", message: "Complete your intake." },
        null,
        undefined,
      ),
    ).toEqual({
      kind: "none",
      message: "Complete your intake.",
    });
  });

  it("uses live listing values, including unknown rent", () => {
    const candidate = {
      id: "c1",
      projectId: "p",
      synthetic: false,
      name: "Corner retail",
      address: "100 Main St",
      city: "Houston",
      floorAreaSqFt: metric(1450, "sq ft"),
    };
    const result = {
      candidates: [
        {
          candidate,
          position: "corner",
          score: 72,
          flags: [],
          baseRentCents: metric(null, "USD cents/month"),
        },
      ],
      emptyReason: null,
    } as unknown as SiteSearchResult;
    const space = selectedSpace({ mode: "live", result }, project, undefined);
    expect(space).toMatchObject({
      kind: "space",
      id: "c1",
      name: "100 Main St",
      example: false,
    });
    if (space.kind !== "space") throw new Error("expected a space");
    expect(space.stats).toEqual([
      { label: "Monthly rent", value: "Unknown", note: "costar" },
      { label: "Area", value: "1,450", note: "sq ft" },
    ]);
    const empty = {
      ...result,
      candidates: [],
      emptyReason: "Nothing under your rent limit.",
    };
    expect(
      selectedSpace({ mode: "live", result: empty }, project, undefined),
    ).toEqual({
      kind: "none",
      message: "Nothing under your rent limit.",
    });
  });

  it("formats monthly rent from cents", () => {
    expect(metricText(metric(386_700, "USD cents/month"))).toBe("$3,867");
  });
});
