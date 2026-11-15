/**
 * HAC-127: the guided BizBox onboarding over the existing intake profile.
 *
 * Pure, so it is unit-tested without a browser. Every answer is stored in the existing
 * intake session (components/intake/profile.ts) under the intake field it maps to; this
 * module only translates between the guided screens and those fields. It adds no schema
 * or store of its own. The field mapping follows the HAC-112 handoff (HANDOFF.md).
 */
import { operatingHours } from "@/lib/client/intake-business-profile";
import { fields, missingFields, profileValidationMessage, type Profile } from "@/components/intake/profile";
import { DEFAULT_RANGE, formatHoursValue, formatTime, parseHoursValue } from "./clock-dial-math";

export type FieldKey = (typeof fields)[number]["key"];

/** One concise question per screen, in order. Step ids are the intake field keys. */
export const questionSteps = [
  "category",
  "concept",
  "customers",
  "city",
  "areas",
  "rent",
  "buildout",
  "price",
  "hours",
  "staff",
  "requirements",
] as const satisfies readonly FieldKey[];

export type QuestionStep = (typeof questionSteps)[number];
export type Step = QuestionStep | "review";

export const titles: Record<Step, string> = {
  category: "What are you opening?",
  concept: "Describe your business.",
  customers: "Who is it for?",
  city: "Where are you looking?",
  areas: "Which areas should we favor or avoid?",
  rent: "What’s your monthly rent limit?",
  buildout: "What’s your buildout budget?",
  price: "Where will your prices sit?",
  hours: "When will you be open?",
  staff: "How many people will be on shift?",
  requirements: "Anything the space must have?",
  review: "Review your business",
};

/** Prototype label → intake value. "Other" is shown disabled as Coming soon. */
export const categoryChoices = [
  { label: "Coffee shop", value: "Coffee shop" },
  { label: "Quick food", value: "Quick-service food" },
  { label: "Salon", value: "Salon or barber" },
  { label: "Fitness", value: "Fitness studio" },
] as const;

/** Prototype price label → intake price tier. */
export const priceChoices = [
  { label: "Value", value: "Budget" },
  { label: "Mid-range", value: "Midrange" },
  { label: "Premium", value: "Premium" },
] as const;

export const cityChoices = [
  { value: "Houston", photo: "/onboarding/houston-real.jpg", alt: "Downtown Houston at dusk" },
  { value: "Los Angeles", photo: "/onboarding/la-real.jpg", alt: "Los Angeles city lights at night" },
] as const;

/** Placeholders only; not launch dates or a roadmap commitment. */
export const comingSoonCities = ["New York", "Chicago", "Miami"] as const;

/** Decorative generated artwork, separate from the real photos of supported cities. */
export const comingSoonCityPhotos: Record<(typeof comingSoonCities)[number], string> = {
  "New York": "/onboarding/generated/new-york.jpg",
  Chicago: "/onboarding/generated/chicago.jpg",
  Miami: "/onboarding/generated/miami.jpg",
};

/** Photo credits from the handoff's photos/manifest.json (also in public/onboarding/). */
export const photoCredits = {
  Houston: {
    author: "Carol M. Highsmith",
    source: "https://commons.wikimedia.org/wiki/File:Houston,Texas_by_Carol_M._Highsmith.jpg",
    license: "Public domain",
    licenseUrl: "https://commons.wikimedia.org/wiki/File:Houston,Texas_by_Carol_M._Highsmith.jpg#Licensing",
  },
  "Los Angeles": {
    author: "Rlumstead / Rachel L. Umstead",
    source: "https://commons.wikimedia.org/wiki/File:Los_Angeles_at_night_from_Griffith_Observatory.jpg",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
  },
} as const;

export type City = (typeof cityChoices)[number]["value"];

export const neighborhoods: Record<City, readonly string[]> = {
  Houston: ["Montrose", "The Heights", "Rice Village"],
  "Los Angeles": ["Silver Lake", "Echo Park", "Culver City"],
};

/** Curved-ruler settings. Steps are UI aids only; any valid typed amount is kept exactly. */
export const rulers = {
  rent: { min: 500, max: 20000, step: 100, start: 4500, currency: true, label: "Monthly rent limit" },
  buildout: { min: 5000, max: 500000, step: 5000, start: 80000, currency: true, label: "Buildout budget" },
  staff: { min: 1, max: 30, step: 1, start: 2, currency: false, label: "People on shift" },
} as const;

export type RulerStep = keyof typeof rulers;

export const isRulerStep = (step: Step): step is RulerStep => step in rulers;

/** Explicit answers for the Skip buttons. "None" is read by mustHaves() as no requirements. */
export const skipValues: Partial<Record<QuestionStep, string>> = {
  areas: "No preference",
  requirements: "None",
};

const field = (key: FieldKey) => fields.find((entry) => entry.key === key)!;

/** The message to show before the founder can continue, or undefined when the answer is valid. */
export function stepError(step: QuestionStep, value: string): string | undefined {
  const text = value.trim();
  if (step === "category" && !categoryChoices.some((choice) => choice.value === text))
    return "Choose an available business type.";
  if (step === "city" && !cityChoices.some((choice) => choice.value === text)) return "Choose Houston or Los Angeles.";
  if (step === "price" && !priceChoices.some((choice) => choice.value === text)) return "Choose a price tier.";
  if (step === "areas" && !text) return "Choose an area, add a note, or skip.";
  if (step === "requirements" && !text) return "Add what the space needs, or skip.";
  if (step === "staff" && !text) return "Enter how many people will be on shift.";
  if (step === "rent" || step === "buildout") {
    const amount = Number(text);
    const { max } = rulers[step];
    if (!/^\d+$/.test(text) || amount < 1 || amount > max)
      return `Enter a whole dollar amount from $1 to ${money(max)}.`;
  }
  if (!text) return "Add your answer to continue.";
  if (step === "hours" && !operatingHours(text)) return "Use one same-day range, such as 7am–5pm or 07:00–17:00.";
  return profileValidationMessage(field(step), text);
}

/**
 * Where a returning founder resumes: the first question still missing or holding only an
 * app default (category and city start as defaults), or the review once nothing is missing.
 */
export function resumeStep(profile: Profile): Step {
  if (!missingFields(profile).length) return "review";
  return questionSteps.find((step) => {
    const answer = profile[step];
    return !answer || answer.origin !== "founder" || stepError(step, answer.value) !== undefined;
  }) ?? "review";
}

/**
 * The value the screen shows first: the saved answer, or a valid app default for choices.
 * Hours start at 9:00 AM – 5:00 PM (HAC-154) unless a readable range is saved. Like the
 * other starting values, this is only a draft until the founder presses Continue.
 */
export function initialValue(step: QuestionStep, profile: Profile): string {
  const saved = profile[step]?.value ?? "";
  if (step === "hours") return parseHoursValue(saved) ? saved : formatHoursValue(DEFAULT_RANGE);
  const choice = step === "category" || step === "city" || step === "price";
  return choice && stepError(step, saved) ? "" : saved;
}

export type AreaChoices = { favor: string[]; avoid: string[]; notes: string };

/**
 * Reads the intake `areas` text into the guided screen's picks. Only this city's known
 * neighborhoods become picks; every other part is kept verbatim as a note so nothing typed
 * in the detailed form is lost.
 */
export function parseAreas(text: string, city: string): AreaChoices {
  const known = neighborhoods[city as City] ?? [];
  const result: AreaChoices = { favor: [], avoid: [], notes: "" };
  const notes: string[] = [];
  if (text.trim() === skipValues.areas) return result;
  for (const part of text.split(";").map((entry) => entry.trim()).filter(Boolean)) {
    const match = /^(favor|avoid)\s+(.+)$/i.exec(part);
    const names = match ? match[2].split(",").map((name) => name.trim()) : [];
    if (match && names.length && names.every((name) => known.includes(name))) {
      const list = match[1].toLowerCase() === "favor" ? result.favor : result.avoid;
      for (const name of names) if (!result.favor.includes(name) && !result.avoid.includes(name)) list.push(name);
    } else {
      notes.push(part);
    }
  }
  result.notes = notes.join("; ");
  return result;
}

/** Writes the picks back as intake `areas` text, e.g. "Favor Montrose; Avoid Rice Village; near offices". */
export function formatAreas({ favor, avoid, notes }: AreaChoices): string {
  return [
    favor.length ? `Favor ${favor.join(", ")}` : "",
    avoid.length ? `Avoid ${avoid.join(", ")}` : "",
    notes.trim(),
  ]
    .filter(Boolean)
    .join("; ");
}

/** Snaps toward the next ruler detent in a direction, so an exact typed value moves cleanly. */
export function nudge(value: number, step: number, min: number, direction: 1 | -1, detents = 1): number {
  const index = (value - min) / step;
  const base = direction > 0 ? Math.floor(index + 1e-9) : Math.ceil(index - 1e-9);
  return min + (base + direction * detents) * step;
}

/** A valid exact value can extend the visual range without exceeding the budget cap. */
export function rulerBounds(step: RulerStep, value: number) {
  const ruler = rulers[step];
  return {
    min: Number.isSafeInteger(value) && value >= 1 ? Math.min(ruler.min, value) : ruler.min,
    max: !ruler.currency && Number.isSafeInteger(value) ? Math.max(ruler.max, value) : ruler.max,
  };
}

export const money = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);

/** The review's display value for one field. */
export function reviewValue(step: QuestionStep, value: string): string {
  if (step === "category") return categoryChoices.find((choice) => choice.value === value)?.label ?? value;
  if (step === "price") return priceChoices.find((choice) => choice.value === value)?.label ?? value;
  if (step === "areas") {
    return value.split(";").map((part) => {
      const text = part.trim();
      const match = /^(favor|avoid)(?::\s*|\s+)(.+)$/i.exec(text);
      if (!match) return text;
      const label = match[1].toLowerCase() === "favor" ? "Favor" : "Avoid";
      const constraint = match[2].replace(/^(anything|anywhere)\b/i, (word) => word.toLowerCase());
      return `${label}: ${constraint}`;
    }).filter(Boolean).join("; ");
  }
  if ((step === "rent" || step === "buildout") && /^\d+$/.test(value)) return money(Number(value));
  if (step === "staff" && /^\d+$/.test(value)) return `${value} on shift`;
  if (step === "hours") {
    const range = parseHoursValue(value);
    if (range) return `${formatTime(range.open)} – ${formatTime(range.close)}`;
  }
  return value;
}

export const reviewLabels: Record<QuestionStep, string> = {
  category: "Business type",
  concept: "Concept",
  customers: "Customers",
  city: "City",
  areas: "Areas",
  rent: "Monthly rent",
  buildout: "Buildout",
  price: "Price tier",
  hours: "Hours",
  staff: "Staff",
  requirements: "Must-haves",
};
