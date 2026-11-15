import { z } from "zod";
import snapshot from "./catalog-data.json";

export const FurnitureCatalogItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  sourceUrl: z.string().url(),
  license: z.literal("CC0-1.0"),
  provider: z.literal("poly-haven"),
  assetUrl: z.string().startsWith("/furniture/"),
  widthM: z.number().positive(),
  depthM: z.number().positive(),
  heightM: z.number().positive(),
  role: z.enum(["seating", "table", "storage", "decor", "service"]),
  seats: z.number().int().nonnegative(),
  dimensionsStatus: z.literal("source-model-bounds"),
  sourceDimensionsMm: z.array(z.number().positive()).length(3),
  sourceFootprintAxes: z.enum(["direct", "swapped-in-gltf"]),
  /** Apply to an inner loaded-model group: center X/Z and ground minimum Y. Models are already Y-up meters. */
  modelOffsetM: z.tuple([z.number(), z.number(), z.number()]),
  polycount: z.number().int().nonnegative().nullable(),
  /** Geometry is not evidence for a price or operational throughput. */
  priceUsd: z.null(),
  businessSpecificationStatus: z.literal("not-provided"),
});
export type FurnitureCatalogItem = z.infer<typeof FurnitureCatalogItemSchema>;
export const FURNITURE_CATALOG: readonly FurnitureCatalogItem[] = Object.freeze(
  snapshot.map((item) =>
    Object.freeze(
      FurnitureCatalogItemSchema.parse({
        ...item,
        priceUsd: null,
        businessSpecificationStatus: "not-provided",
      }),
    ),
  ),
);
export const FURNITURE_CATALOG_VERSION = "poly-haven-curated-2026-11-15-v1";
export const FURNITURE_ATTRIBUTION = "Furniture models by Poly Haven · CC0";
export type FurnitureBusinessCategory =
  "coffee" | "quick_food" | "salon_barber" | "fitness";
/** Shared ordinary furniture only; none of these models is certified specialist equipment. */
export function furnitureForCategory(
  category: FurnitureBusinessCategory,
): readonly FurnitureCatalogItem[] {
  if (!["coffee", "quick_food", "salon_barber", "fitness"].includes(category))
    return [];
  return FURNITURE_CATALOG;
}
export function furnitureById(id: string): FurnitureCatalogItem | undefined {
  return FURNITURE_CATALOG.find((item) => item.id === id);
}
