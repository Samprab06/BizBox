import { z } from "zod";
import {
  AreaPreferencesSchema,
  type AreaPreferences,
} from "@/lib/contracts/area-preferences";

// Existing saved map format. Keep this boundary strict: losing a malformed red
// rectangle must never quietly widen a search.
const marker = "\n[BizBox area map v1] ";
const SavedMapSchema = z
  .object({
    city: z.enum(["Houston", "Los Angeles"]),
    previous: z.string().optional(),
    marks: z.array(z.unknown()),
    rectangles: z.array(
      z.tuple([
        z.number(),
        z.number(),
        z.number(),
        z.number(),
        z.union([z.literal(0), z.literal(1)]),
      ]),
    ),
  })
  .strict();

export function areaPreferencesFromAnswer(
  value: string | undefined,
  city: AreaPreferences["city"],
): {
  preferences: AreaPreferences;
  mapped: boolean;
  error?: string;
} {
  const empty = { city, rectangles: [] } satisfies AreaPreferences;
  const text = value ?? "";
  const parts = text.split(marker);
  if (parts.length === 1) {
    if (text.includes("[BizBox area map"))
      return {
        preferences: empty,
        mapped: true,
        error:
          "Reopen the area map and redraw your selections before searching.",
      };
    return { preferences: empty, mapped: false };
  }
  try {
    if (parts.length !== 2) throw new Error("Multiple map payloads");
    const saved = SavedMapSchema.parse(JSON.parse(parts[1]));
    if (saved.city !== city) throw new Error("Different city");
    if (saved.marks.length)
      return {
        preferences: empty,
        mapped: true,
        error:
          "Redraw older brush selections as rectangles, or erase them, before searching.",
      };
    const preferences = AreaPreferencesSchema.parse({
      city,
      rectangles: saved.rectangles.map(([west, south, east, north, brush]) => ({
        bounds: [west, south, east, north],
        brush: brush === 0 ? "favor" : "avoid",
      })),
    });
    return { preferences, mapped: true };
  } catch {
    return {
      preferences: empty,
      mapped: true,
      error:
        "Reopen the area map and redraw your selections for the selected city before searching.",
    };
  }
}
