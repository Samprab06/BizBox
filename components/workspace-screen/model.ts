/**
 * HAC-128: pure view-model helpers for the BizBox workspace screen. Every value shown comes
 * from the founder's saved intake, the preview project or the live listing search; nothing
 * here invents a listing, rent or staffing result.
 */
import type { AssumedValue } from "@/lib/contracts";
import type { SiteSearchResult } from "@/lib/contracts/sites";
import type { PreviewProject } from "@/lib/contracts/workspace-preview";
import type { IntakeSession } from "@/components/intake/profile";

export type AssistantMode = "text" | "voice";
export const assistantModes: readonly AssistantMode[] = ["text", "voice"];

/** Roving-focus tab keys (WAI-ARIA tabs pattern). `null` means the key is not a tab key. */
export function nextAssistantMode(
  current: AssistantMode,
  key: string,
): AssistantMode | null {
  const index = assistantModes.indexOf(current);
  const last = assistantModes.length - 1;
  switch (key) {
    case "ArrowRight":
      return assistantModes[index === last ? 0 : index + 1]!;
    case "ArrowLeft":
      return assistantModes[index === 0 ? last : index - 1]!;
    case "Home":
      return assistantModes[0]!;
    case "End":
      return assistantModes[last]!;
    default:
      return null;
  }
}

export type CityPhoto = {
  src: string;
  alt: string;
  credit: string;
  license: string;
};

/** Real city photographs (public/workspace/credits.html); they identify the city, not a listing. */
const CITY_PHOTOS: Record<"Houston" | "Los Angeles", CityPhoto> = {
  Houston: {
    src: "/workspace/houston-real.jpg",
    alt: "Downtown Houston skyline at dusk. A city preview photo, not the selected space or a map.",
    credit: "Carol M. Highsmith, Library of Congress",
    license: "Public domain",
  },
  "Los Angeles": {
    src: "/workspace/la-real.jpg",
    alt: "Los Angeles city lights at night from Griffith Observatory. A city preview photo, not the selected space or a map.",
    credit: "Rachel L. Umstead",
    license: "CC BY-SA 4.0",
  },
};

/** The supported city named in `city` ("Houston", "Houston, TX", ...), if any. */
export function supportedCity(city: string | undefined) {
  const text = city?.toLowerCase() ?? "";
  if (text.includes("houston")) return "Houston" as const;
  if (text.includes("los angeles")) return "Los Angeles" as const;
  return null;
}

export function cityPhotoFor(city: string | undefined): CityPhoto | null {
  const name = supportedCity(city);
  return name ? CITY_PHOTOS[name] : null;
}

const usd = (dollars: number) =>
  dollars.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

export type WorkspaceHeader = {
  city: string;
  business: string;
  budget: string;
  /** True when the rent limit is a category default rather than the founder's answer. */
  budgetIsDefault: boolean;
};

/** The one city/budget header: the founder's brief first, then the preview project. */
export function workspaceHeader(
  session: IntakeSession | null,
  project: PreviewProject | null,
): WorkspaceHeader {
  const profile = session?.profile ?? {};
  const city =
    profile.city?.value.trim() ||
    supportedCity(project?.city) ||
    project?.city ||
    "City not set";
  const business =
    profile.category?.value.trim() || project?.business || "Your business";
  const rent = profile.rent;
  const amount = rent ? Number(rent.value) : NaN;
  const budget =
    rent && /^\d+$/.test(rent.value.trim()) && Number.isSafeInteger(amount)
      ? `${usd(amount)}/mo rent limit`
      : "Rent limit not set";
  return {
    city,
    business,
    budget,
    budgetIsDefault: rent?.origin === "default",
  };
}

export type SpaceStat = { label: string; value: string; note?: string };

export type SelectedSpace =
  | { kind: "loading" }
  | { kind: "none"; message: string }
  | {
      kind: "space";
      id: string;
      name: string;
      subtitle: string;
      /** Example data (fixture or synthetic listing), never presented as a confirmed listing. */
      example: boolean;
      stats: SpaceStat[];
      details: string[];
    };

/** A listing metric as text; unknown values say so instead of showing a number. */
export function metricText(metric: AssumedValue): string {
  if (metric.value === null) return "Unknown";
  if (metric.unit === "USD cents/month")
    return usd(Math.round(metric.value / 100));
  return metric.value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

type SearchLike =
  | { mode: "loading" }
  | { mode: "example"; message: string }
  | { mode: "live"; result: SiteSearchResult };

/** The selected candidate: the `?site=` one when it exists, otherwise the first. */
export function selectedSpace(
  search: SearchLike,
  project: PreviewProject | null,
  requestedId: string | undefined,
): SelectedSpace {
  if (search.mode === "loading") return { kind: "loading" };
  if (search.mode === "live") {
    const { candidates } = search.result;
    const entry =
      candidates.find(({ candidate }) => candidate.id === requestedId) ??
      candidates[0];
    if (!entry)
      return {
        kind: "none",
        message:
          search.result.emptyReason ?? "No candidate spaces match your brief.",
      };
    const { candidate } = entry;
    const details = [
      `${candidate.name} · ${candidate.city}`,
      `Prescore ${entry.score} / 100 (default scoring)`,
    ];
    if (entry.position) details.push(`Position: ${entry.position}`);
    if (entry.flags.length) details.push(`Flags: ${entry.flags.join(", ")}`);
    return {
      kind: "space",
      id: candidate.id,
      name: candidate.address,
      subtitle: "Matched listing",
      example: candidate.synthetic,
      stats: [
        {
          label: "Monthly rent",
          value: metricText(entry.baseRentCents),
          note: entry.baseRentCents.origin,
        },
        {
          label: "Area",
          value: metricText(candidate.floorAreaSqFt),
          note: "sq ft",
        },
      ],
      details,
    };
  }
  const site =
    project?.sites.find((entry) => entry.id === requestedId) ??
    project?.sites[0];
  if (!site)
    return {
      kind: "none",
      message: search.message,
    };
  return {
    kind: "space",
    id: site.id,
    name: site.address,
    subtitle: site.neighborhood,
    example: true,
    stats: [
      {
        label: "Area",
        value: site.squareFeet.toLocaleString("en-US"),
        note: "sq ft",
      },
    ],
    details: [
      `Example space in ${site.neighborhood}. No listing rent is shown for examples.`,
      search.message,
    ],
  };
}
