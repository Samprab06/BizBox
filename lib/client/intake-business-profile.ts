import {
  intakeSessionSchema,
  missingFields,
  type Profile,
} from "@/components/intake/profile";
import {
  BusinessProfileSchema,
  type BusinessProfile,
  type AssumedFlag,
  type AssumedValue,
} from "@/lib/contracts";
import { categoryDefaults } from "@/lib/agent/defaults";

export type IntakeProfileResult = {
  profile: BusinessProfile | null;
  reason: string | null;
  notes: string[];
};
const categories = {
  "Coffee shop": "coffee",
  "Quick-service food": "quick_food",
  "Salon or barber": "salon_barber",
  "Fitness studio": "fitness",
} as const;
const tiers = {
  Budget: "budget",
  Midrange: "mid",
  Premium: "premium",
} as const;

function operatingHours(text: string) {
  // Accept a single explicit same-day range. Never guess that "9-5" means PM.
  const matches = [
    ...text
      .toLowerCase()
      .matchAll(
        /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|—|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/g,
      ),
  ];
  if (matches.length !== 1) return null;
  const m = matches[0];
  const minute = (
    h: string,
    mins: string | undefined,
    period: string | undefined,
    closing: boolean,
  ) => {
    const hour = Number(h),
      minutes = Number(mins ?? 0);
    if (minutes > 59 || (period ? hour < 1 || hour > 12 : hour > 24))
      return null;
    if (!period && hour === 24) return closing && minutes === 0 ? 1440 : null;
    return (
      (period ? (hour % 12) + (period === "pm" ? 12 : 0) : hour) * 60 + minutes
    );
  };
  // A suffix on only one endpoint makes a 12-hour range ambiguous.
  if (!!m[3] !== !!m[6]) return null;
  const openMinute = minute(m[1], m[2], m[3], false);
  const closeMinute = minute(m[4], m[5], m[6], true);
  return openMinute !== null && closeMinute !== null && closeMinute > openMinute
    ? { openMinute, closeMinute }
    : null;
}

function mustHaves(
  answer: NonNullable<Profile["requirements"]>,
): BusinessProfile["mustHaves"] {
  const text = answer.value.toLowerCase();
  const none =
    /^(?:none|no (?:requirements|must[- ]haves)|any|flexible)[.!]?$/i.test(
      text.trim(),
    );
  const terms = {
    frontage: "frontage|storefront",
    corner: "corner|end[- ]?cap",
    parking: "parking",
    groundFloor: "ground[- ]floor|street[- ]level",
  };
  return Object.fromEntries(
    Object.entries(terms).map(([key, term]) => {
      const present = new RegExp(`\\b(?:${term})\\b`).test(text);
      const optional = new RegExp(
        `(?:(?:no|not)\\s+(?:need\\s+for\\s+|required\\s+)?(?:${term})|(?:don['’]t|do not)\\s+(?:need|require)\\s+(?:${term})|(?:prefer|would like|nice to have)\\s+(?:${term})|(?:${term})\\s+(?:is\\s+)?(?:optional|preferred|not\\s+(?:needed|required)|not\\s+a\\s+must|would\\s+be\\s+nice|nice\\s+to\\s+have)|(?:${term})\\s+(?:isn['’]t|is not)\\s+(?:needed|required))`,
      ).test(text);
      const value = none || optional ? false : present ? true : null;
      const flag: AssumedFlag = {
        value,
        unit: "boolean",
        origin: answer.origin,
        evidenceIds: ["browser-intake-requirements"],
        ...(value === null
          ? {
              unknownReason:
                "Not explicitly specified in the founder's must-haves",
            }
          : {}),
      };
      return [key, flag];
    }),
  ) as BusinessProfile["mustHaves"];
}

/** Convert the actual completed form; never borrow founder facts from demo fixtures. */
export function profileFromIntake(
  rawSession: unknown,
  projectId: string,
): IntakeProfileResult {
  const parsed = intakeSessionSchema.safeParse(rawSession);
  const unavailable = (reason: string): IntakeProfileResult => ({
    profile: null,
    reason,
    notes: [],
  });
  if (!parsed.success || missingFields(parsed.data.profile).length)
    return unavailable("Complete your intake to search live listings.");
  if (projectId !== "houston-coffee")
    return unavailable("This project is not available.");
  const answers = parsed.data.profile;
  const category =
    categories[answers.category!.value as keyof typeof categories];
  const defaults = categoryDefaults(category);
  const hours = operatingHours(answers.hours!.value);
  if (!hours)
    return unavailable(
      "Use one clear same-day opening range, such as 7am–5pm or 07:00–17:00, to search live listings.",
    );
  const rent = Number(answers.rent!.value) * 100;
  const buildout = Number(answers.buildout!.value) * 100;
  if (!Number.isSafeInteger(rent) || !Number.isSafeInteger(buildout))
    return unavailable(
      "Your budget is too large to convert safely. Review it in intake.",
    );
  if (!defaults)
    return unavailable("This service category is not supported yet.");
  const numeric = (
    value: number,
    unit: string,
    key: keyof Profile,
  ): AssumedValue => ({
    value,
    unit,
    origin: answers[key]!.origin,
    evidenceIds: [`browser-intake-${key}`],
  });
  const unknown = (unit: string, reason: string): AssumedValue => ({
    value: null,
    unit,
    origin: "default",
    evidenceIds: ["browser-intake-uncollected"],
    unknownReason: reason,
  });
  const profile = BusinessProfileSchema.safeParse({
    id: `browser-profile:${projectId}`,
    projectId,
    version: 1,
    synthetic: false,
    // The form has a concept, not a separate business-name question; use that
    // exact answer as its display label rather than inventing a business name.
    businessName: answers.concept!.value.trim(),
    concept: answers.concept!.value.trim(),
    category,
    city: answers.city!.value,
    preferredAreas: [],
    avoidedAreas: [],
    targetCustomers: [answers.customers!.value.trim()],
    mustHaves: mustHaves(answers.requirements!),
    objective: `Compare service-business locations. Area preferences (verbatim): ${answers.areas!.value}. Other requirements (verbatim): ${answers.requirements!.value}.`,
    operatingHours: hours,
    capacity: {
      servers: numeric(Number(answers.staff!.value), "servers", "staff"),
      serviceMinutes: defaults.values.serviceMinutes,
    },
    economics: {
      averageTicketCents: unknown(
        "USD cents/customer",
        "The intake collected a price tier, not an average transaction amount",
      ),
      startupBudgetCents: unknown(
        "USD cents",
        "Startup budget was not collected by this form",
      ),
      monthlyOperatingBudgetCents: unknown(
        "USD cents/month",
        "Operating budget was not collected by this form",
      ),
      monthlyRentCeilingCents: numeric(rent, "USD cents/month", "rent"),
      buildoutBudgetCents: numeric(buildout, "USD cents", "buildout"),
      priceTier: {
        value: tiers[answers.price!.value as keyof typeof tiers],
        unit: "price_tier",
        origin: answers.price!.origin,
        evidenceIds: ["browser-intake-price"],
      },
    },
    derivedDefaults: {
      wageRateCentsPerHour: defaults.values.wageRateCentsPerHour,
      cogsFraction: defaults.values.cogsFraction,
      travelMinutes: defaults.values.travelMinutes,
      patienceMinutes: defaults.values.patienceMinutes,
    },
  });
  if (!profile.success)
    return unavailable(
      "Review the intake values before searching live listings.",
    );
  return {
    profile: profile.data,
    reason: null,
    notes: [
      "Area preferences and additional requirements are retained for review; this search filters city, rent, size and supported listing features.",
    ],
  };
}
