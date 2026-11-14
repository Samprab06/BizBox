/**
 * Model-facing helpers for the intake agent (HAC-113): the unknown-answer guard, provenance
 * filling for slim model patches, and a compact view of the draft. Pure TypeScript, no SDKs.
 */
import type { IntakeResult } from "./intake";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The founder's own don't-know phrasing. A missing answer is never an unknown. */
const UNKNOWN_SIGNAL =
  /\b(?:(?:don'?t|do not|dont|doesn'?t|does not|not)\s+(?:really\s+|yet\s+)?(?:know|sure|certain|decided|determined)|no (?:idea|clue)|unknown|unsure|undecided|tbd|idk|haven'?t (?:decided|figured|determined|settled|thought)|not (?:yet )?(?:figured|settled)|skip)\b/i;

const TOPIC: Record<string, RegExp> = {
  monthlyRentCeilingCents: /\b(?:rent|lease|landlord)\b/i,
  buildoutBudgetCents:
    /\b(?:build-?\s?out|fit-?\s?out|renovations?|construction)\b/i,
  startupBudgetCents:
    /\b(?:start-?\s?up|opening (?:budget|costs?)|total (?:budget|costs?)|capital)\b/i,
  monthlyOperatingBudgetCents:
    /\b(?:operating|opex|running costs?|monthly (?:budget|costs?|expenses?))\b/i,
  averageTicketCents:
    /\b(?:ticket|average (?:spend|check|order|sale)|per (?:customer|order|visit)|basket)\b/i,
  priceTier: /\b(?:price|prices|pricing|tier)\b/i,
  targetCustomers:
    /\b(?:customers?|audience|clientele|demographics?|target)\b/i,
  servers:
    /\b(?:staff|servers?|employees?|stations?|baristas?|headcount|team|workers?)\b/i,
  serviceMinutes:
    /\b(?:service (?:time|duration)|how long|minutes? (?:per|to))\b/i,
  frontage: /\b(?:frontage|storefront)\b/i,
  corner: /\bcorner\b/i,
  parking: /\bparking\b/i,
  groundFloor: /\b(?:ground[- ]?floor|first floor|street level)\b/i,
  travelMinutes: /\b(?:travel|commute|drive|driving)\b/i,
  patienceMinutes: /\b(?:patien\w*|waiting)\b/i,
  wageRateCentsPerHour: /\b(?:wages?|pay|hourly)\b/i,
  cogsFraction: /\b(?:cogs|cost of goods|food costs?|margins?)\b/i,
  visitsPerMonth: /\b(?:visits?|how often|frequency)\b/i,
  squareFeetPerStation: /\b(?:square|sq\.? ?f\w*|floor area|space per)\b/i,
  minimumFrontOfHouseSqFt:
    /\b(?:square|sq\.? ?f\w*|front of house|floor area)\b/i,
  peakHourProfile: /\b(?:peak|rush|busiest|busy)\b/i,
};
/** Umbrella words ("my budget", "the must-haves") cover every field in the group. */
const GROUP_TOPIC: Array<[string[], RegExp]> = [
  [
    [
      "monthlyRentCeilingCents",
      "buildoutBudgetCents",
      "startupBudgetCents",
      "monthlyOperatingBudgetCents",
    ],
    /\b(?:budgets?|finances?|financial|money|costs?|funding|numbers|figures)\b/i,
  ],
  [
    ["frontage", "corner", "parking", "groundFloor"],
    /\b(?:must[- ]?haves?|requirements?)\b/i,
  ],
];
const ALL_TOPICS = [
  ...Object.values(TOPIC),
  ...GROUP_TOPIC.map(([, re]) => re),
];

const lastKey = (path: string) => path.split(".").at(-1) ?? path;
/** Does this clause name the field? A specific word wins over an umbrella word. */
function clauseNames(clause: string, path: string): boolean {
  const key = lastKey(path);
  if (TOPIC[key]?.test(clause)) return true;
  const group = GROUP_TOPIC.find(([keys]) => keys.includes(key));
  if (!group) return false;
  // "my rent budget" names rent only; "the budget numbers" names every budget field.
  return (
    group[1].test(clause) &&
    !group[0].some((other) => TOPIC[other]?.test(clause))
  );
}

/**
 * Whether the latest founder message supports recording `path` as an explicit unknown:
 * a don't-know signal in a clause that names the topic, or a bare "I don't know" that
 * answers the question currently being asked (`pendingFields`).
 */
export function founderSaidUnknown(
  message: string,
  path: string,
  pendingFields: readonly string[] = [],
): boolean {
  const pending = pendingFields.some(
    (field) => lastKey(field) === lastKey(path),
  );
  for (const clause of message.split(/[.;!?\n]+|\bbut\b/i)) {
    if (!UNKNOWN_SIGNAL.test(clause)) continue;
    if (clauseNames(clause, path)) return true;
    if (pending && !ALL_TOPICS.some((re) => re.test(clause))) return true;
  }
  return false;
}

/** Model patches carry value/unit/unknownReason only; provenance is always founder-owned. */
export function withFounderProvenance(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withFounderProvenance);
  if (!isRecord(value)) return value;
  if ("value" in value && "unit" in value && !("origin" in value))
    return { ...value, origin: "founder", evidenceIds: ["founder-answer"] };
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      withFounderProvenance(entry),
    ]),
  );
}

/**
 * Removes explicit unknowns that the founder's message does not support, so those fields
 * stay undefined. `patch` is null when nothing is left to save.
 */
export function stripUnsupportedUnknowns(
  patch: unknown,
  message: string,
  pendingFields: readonly string[] = [],
): { patch: unknown; dropped: string[] } {
  const dropped: string[] = [];
  const walk = (node: unknown, path: string): unknown => {
    if (node === null) {
      if (founderSaidUnknown(message, path, pendingFields)) return node;
      dropped.push(path);
      return undefined;
    }
    if (!isRecord(node)) return node;
    if ("value" in node) {
      if (
        node.value !== null ||
        founderSaidUnknown(message, path, pendingFields)
      )
        return node;
      dropped.push(path);
      return undefined;
    }
    const entries = Object.entries(node);
    const kept = entries.flatMap(([key, entry]) => {
      const next = walk(entry, path ? `${path}.${key}` : key);
      return next === undefined ? [] : [[key, next] as const];
    });
    if (entries.length > 0 && kept.length === 0) return undefined;
    return Object.fromEntries(kept);
  };
  const cleaned = walk(patch, "");
  return { patch: cleaned ?? null, dropped };
}

function brief(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if ("value" in value && "origin" in value) {
    if (value.origin === "default") return undefined;
    return value.value === null
      ? { value: null, unknown: true }
      : { value: value.value, unit: value.unit };
  }
  const entries = Object.entries(value).flatMap(([key, entry]) => {
    const next = brief(entry);
    return next === undefined ? [] : [[key, next] as const];
  });
  return entries.length ? Object.fromEntries(entries) : undefined;
}

/**
 * Compact view for the model: founder-supplied facts, what is missing and the next question.
 * Category defaults, source lists, the question list and the duplicated profile are left out
 * because the prompt already covers them.
 */
export function intakeBrief(result: IntakeResult) {
  return {
    draft: brief(result.draft) ?? {},
    assumptions: brief(result.assumptions) ?? {},
    profileComplete: result.profile !== null,
    missingRequiredFields: result.missingRequiredFields,
    nextQuestion: result.nextQuestion
      ? { id: result.nextQuestion.id, question: result.nextQuestion.question }
      : null,
  };
}
