import { z } from "zod";

const longitude = z.number().finite().min(-180).max(180);
const latitude = z.number().finite().min(-90).max(90);

/** Founder-drawn geographic rectangles; bounds are west, south, east, north. */
export const AreaPreferencesSchema = z
  .object({
    city: z.enum(["Houston", "Los Angeles"]),
    rectangles: z.array(
      z
        .object({
          bounds: z
            .tuple([longitude, latitude, longitude, latitude])
            .refine(
              ([west, south, east, north]) => west < east && south < north,
              {
                message:
                  "Rectangle bounds must run west to east and south to north",
              },
            ),
          brush: z.enum(["favor", "avoid"]),
        })
        .strict(),
    ),
  })
  .strict();

export type AreaPreferences = z.infer<typeof AreaPreferencesSchema>;

/** Partial interviews may have no city yet; completed profiles must match it. */
export const areaPreferencesMatchCity = (value: {
  city?: string;
  areaPreferences?: AreaPreferences;
}): boolean =>
  !value.areaPreferences ||
  value.city === undefined ||
  value.areaPreferences.city === value.city;
