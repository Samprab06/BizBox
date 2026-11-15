import { areaPreferencesFromAnswer } from "@/lib/client/area-preferences";
import { writeAreaMap } from "@/components/onboarding/area-map-data";
/**
 * HAC-66: maps between the intake screen's form fields and the intake API's draft state.
 * Pure, so it is unit-tested without a browser. The form stays the shape the map and
 * comparison read (lib/client/intake-business-profile.ts); the API state rides along.
 */
import { z } from "zod";
import type { IntakeState } from "@/lib/contracts/intake";
import { IntakeStateSchema } from "@/lib/contracts/intake";
import { UiActionListSchema } from "@/lib/contracts/agent";
import {
  mustHaves,
  operatingHours,
} from "@/lib/client/intake-business-profile";
import type { IntakeSession, Profile } from "./profile";

type Key = keyof Profile;
type Origin = "default" | "founder";

const CATEGORY = {
  "Coffee shop": "coffee",
  "Quick-service food": "quick_food",
  "Salon or barber": "salon_barber",
  "Fitness studio": "fitness",
} as const;
const TIER = { Budget: "budget", Midrange: "mid", Premium: "premium" } as const;
const FEATURE_LABEL = {
  frontage: "frontage",
  corner: "corner",
  parking: "parking",
  groundFloor: "ground-floor",
} as const;
const invert = <T extends Record<string, string>>(map: T) =>
  Object.fromEntries(Object.entries(map).map(([k, v]) => [v, k])) as Record<
    string,
    string
  >;
const CATEGORY_LABEL = invert(CATEGORY);
const TIER_LABEL = invert(TIER);

/** Response fields the screen renders, validated loosely so a newer server cannot break it. */
export const IntakeResponseSchema = z.object({
  draft: IntakeStateSchema.shape.draft,
  assumptions: IntakeStateSchema.shape.assumptions,
  missingRequiredFields: z.array(z.string()),
  findings: z.array(z.string()),
  nextQuestion: z.object({ question: z.string() }).passthrough().nullable(),
  assistantMessage: z.string(),
  /**
   * HAC-144: UI actions the consultant asked for (at most 3). A list this client cannot read
   * (e.g. a newer action type) is dropped rather than failing the reply. Not dispatched yet.
   */
  actions: UiActionListSchema.optional().catch(undefined),
});
export type IntakeResponse = z.infer<typeof IntakeResponseSchema>;

export type LiveState = NonNullable<IntakeSession["live"]>;

const dollars = (cents: number | null | undefined) =>
  cents === null || cents === undefined || cents % 100 !== 0
    ? undefined
    : String(cents / 100);
const clock = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

/**
 * Form values the API draft determines, with their origins. Fields the draft leaves unset
 * are omitted so the form keeps what the founder typed.
 */
export function formFromDraft(
  draft: IntakeState["draft"],
): Partial<Record<Key, { value: string; origin: Origin }>> {
  const out: Partial<Record<Key, { value: string; origin: Origin }>> = {};
  const set = (
    key: Key,
    value: string | undefined,
    origin: Origin = "founder",
  ) => {
    if (value !== undefined && value.trim()) out[key] = { value, origin };
  };
  set("concept", draft.concept);
  if (draft.category) set("category", CATEGORY_LABEL[draft.category]);
  set("city", draft.city);
  const areas = [
    ...(draft.preferredAreas ?? []).map((a) => `Favor ${a}`),
    ...(draft.avoidedAreas ?? []).map((a) => `Avoid ${a}`),
  ];
  if (draft.areaPreferences?.rectangles.length) {
    set(
      "areas",
      writeAreaMap(
        [],
        draft.areaPreferences.city,
        areas.join("; "),
        draft.areaPreferences.rectangles,
      ),
    );
  } else if (areas.length) set("areas", areas.join("; "));
  const economics = draft.economics ?? {};
  const rent = economics.monthlyRentCeilingCents;
  if (rent)
    set(
      "rent",
      dollars(rent.value),
      rent.origin === "default" ? "default" : "founder",
    );
  const buildout = economics.buildoutBudgetCents;
  if (buildout)
    set(
      "buildout",
      dollars(buildout.value),
      buildout.origin === "default" ? "default" : "founder",
    );
  const tier = economics.priceTier;
  if (tier?.value)
    set(
      "price",
      TIER_LABEL[tier.value],
      tier.origin === "default" ? "default" : "founder",
    );
  if (draft.targetCustomers?.length)
    set("customers", draft.targetCustomers.join(", "));
  const hours = draft.operatingHours;
  if (hours?.openMinute !== undefined && hours.closeMinute !== undefined)
    set("hours", `${clock(hours.openMinute)}–${clock(hours.closeMinute)}`);
  const servers = draft.capacity?.servers;
  if (
    servers &&
    servers.value !== null &&
    Number.isInteger(servers.value) &&
    servers.value >= 1
  )
    set(
      "staff",
      String(servers.value),
      servers.origin === "default" ? "default" : "founder",
    );
  const flags = draft.mustHaves;
  if (flags && Object.keys(FEATURE_LABEL).every((k) => k in flags)) {
    const wanted = (
      Object.keys(FEATURE_LABEL) as (keyof typeof FEATURE_LABEL)[]
    )
      .filter((k) => flags[k]?.value === true)
      .map((k) => FEATURE_LABEL[k]);
    const allFalse = Object.values(flags).every((f) => f?.value === false);
    if (wanted.length) set("requirements", wanted.join(", "));
    else if (allFalse) set("requirements", "none");
  }
  return out;
}

/** A structured patch for the founder's form edits; fields that cannot be mapped are skipped. */
export function patchFromForm(profile: Profile, keys: readonly Key[]) {
  const patch: Record<string, unknown> = {};
  const economics: Record<string, unknown> = {};
  // Area and city edits carry an explicit empty selection when the map is cleared.
  if (keys.includes("areas") || (keys.includes("city") && profile.areas)) {
    const city = profile.city?.value;
    if (city === "Houston" || city === "Los Angeles") {
      const area = areaPreferencesFromAnswer(profile.areas?.value, city);
      if (!area.error) patch.areaPreferences = area.preferences;
    }
  }
  const money = (key: "rent" | "buildout", unit: string) => {
    const n = Number(profile[key]?.value);
    return Number.isSafeInteger(n * 100) && n >= 0
      ? {
          value: n * 100,
          unit,
          origin: "founder",
          evidenceIds: [`browser-intake-${key}`],
        }
      : undefined;
  };
  for (const key of new Set(keys)) {
    const answer = profile[key];
    if (!answer || answer.origin !== "founder") continue;
    const text = answer.value.trim();
    if (!text) continue;
    if (key === "concept") patch.concept = text;
    else if (key === "category" && text in CATEGORY)
      patch.category = CATEGORY[text as keyof typeof CATEGORY];
    else if (key === "city" && (text === "Houston" || text === "Los Angeles"))
      patch.city = text;
    else if (key === "rent") {
      const v = money("rent", "USD cents/month");
      if (v) economics.monthlyRentCeilingCents = v;
    } else if (key === "buildout") {
      const v = money("buildout", "USD cents");
      if (v) economics.buildoutBudgetCents = v;
    } else if (key === "price" && text in TIER)
      economics.priceTier = {
        value: TIER[text as keyof typeof TIER],
        unit: "price_tier",
        origin: "founder",
        evidenceIds: ["browser-intake-price"],
      };
    else if (key === "customers") patch.targetCustomers = [text];
    else if (key === "hours") {
      const hours = operatingHours(text);
      if (hours) patch.operatingHours = hours;
    } else if (key === "staff") {
      const n = Number(text);
      if (Number.isSafeInteger(n) && n >= 1)
        patch.capacity = {
          servers: {
            value: n,
            unit: "servers",
            origin: "founder",
            evidenceIds: ["browser-intake-staff"],
          },
        };
    } else if (key === "requirements") patch.mustHaves = mustHaves(answer);
    // Named preferences remain text; drawn selections use areaPreferences above.
  }
  if (Object.keys(economics).length) patch.economics = economics;
  return Object.keys(patch).length ? patch : undefined;
}

/** Assumptions with their origins, for display. */
export function assumptionRows(assumptions: IntakeState["assumptions"]) {
  const label = {
    visitsPerMonth: "Visits per customer per month",
    squareFeetPerStation: "Square feet per station",
    minimumFrontOfHouseSqFt: "Minimum front of house (sq ft)",
  } as const;
  const rows: { key: string; label: string; value: string; origin: string }[] =
    [];
  for (const key of Object.keys(label) as (keyof typeof label)[]) {
    const text = label[key];
    const entry = assumptions[key];
    if (entry)
      rows.push({
        key,
        label: text,
        value: entry.value === null ? "Unknown" : String(entry.value),
        origin: entry.origin,
      });
  }
  const peak = assumptions.peakHourProfile;
  if (peak) {
    const origins = new Set(Object.values(peak).map((e) => e.origin));
    rows.push({
      key: "peakHourProfile",
      label: "Peak-hour profile",
      value: Object.entries(peak)
        .map(([k, e]) => `${k} ${Math.round((e.value ?? 0) * 100)}%`)
        .join(", "),
      origin: origins.size === 1 ? [...origins][0]! : "mixed",
    });
  }
  return rows;
}

const plain = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s.:]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
const amount = (text: string) => {
  const n = Number(text.replace(/[$,\s]/g, ""));
  return text.trim() && Number.isFinite(n) ? n : null;
};
/** Area text as a set of "favor:x" / "avoid:y" entries, ignoring wording and order. */
const areaSet = (text: string) =>
  new Set(
    text
      .split(/[;,\n]+/)
      .map((part) => plain(part))
      .filter(Boolean)
      .map((part) => {
        const avoid = /^(?:avoid|not|no|away from)\s+/.test(part);
        const name = part
          .replace(
            /^(?:(?:avoid|not|no|away from|favor|favour|prefer|near)\s+)+/,
            "",
          )
          .trim();
        return `${avoid ? "avoid" : "favor"}:${name}`;
      }),
  );
const sameSet = (a: Set<string>, b: Set<string>) =>
  a.size === b.size && [...a].every((x) => b.has(x));

/**
 * True when `incoming` says the same thing as the founder's `existing` answer for `key`
 * (same hours, numbers, requirement flags, areas or customers), so a chat reply that merely
 * restates it leaves the saved wording and origin alone.
 */
export function sameAnswer(
  key: Key,
  existing: string,
  incoming: string,
): boolean {
  if (plain(existing) === plain(incoming)) return true;
  switch (key) {
    case "rent":
    case "buildout":
    case "staff": {
      const a = amount(existing);
      return a !== null && a === amount(incoming);
    }
    case "hours": {
      const a = operatingHours(existing);
      const b = operatingHours(incoming);
      return Boolean(
        a &&
        b &&
        a.openMinute === b.openMinute &&
        a.closeMinute === b.closeMinute,
      );
    }
    case "requirements": {
      const a = mustHaves({ value: existing, origin: "founder" });
      const b = mustHaves({ value: incoming, origin: "founder" });
      return (["frontage", "corner", "parking", "groundFloor"] as const).every(
        (f) => a[f]?.value === b[f]?.value,
      );
    }
    case "areas":
      return sameSet(areaSet(existing), areaSet(incoming));
    case "customers": {
      const list = (t: string) =>
        new Set(
          t
            .split(/[;,\n]+|\band\b/)
            .map(plain)
            .filter(Boolean),
        );
      return sameSet(list(existing), list(incoming));
    }
    default:
      return false;
  }
}
