import "server-only";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  costarProperties,
  costarPropertySearch,
  costarSpaces,
} from "@/lib/db/costar-schema";
import { SiteInventorySchema } from "@/lib/contracts/sites";

/** Select only search inputs; raw broker/attachment payloads stay in Postgres. */
export async function loadSiteInventory() {
  return getDb().transaction(
    async (tx) => {
      const [properties, spaces] = await Promise.all([
        tx
          .select({
            id: costarProperties.id,
            city: costarProperties.city,
            latitude: costarProperties.latitude,
            longitude: costarProperties.longitude,
            retail: costarProperties.retail,
            source: costarProperties.source,
            // HAC-59: slim projection; reading costarProperties.data detoasts ~0.5 MB per row.
            data: sql<
              Record<string, unknown>
            >`coalesce(${costarPropertySearch.data}, '{}'::jsonb)`,
          })
          .from(costarProperties)
          .leftJoin(
            costarPropertySearch,
            eq(costarPropertySearch.propertyId, costarProperties.id),
          ),
        tx
          .select({
            id: costarSpaces.id,
            listingId: costarSpaces.listingId,
            propertyId: costarSpaces.propertyId,
            active: costarSpaces.active,
            retail: costarSpaces.retail,
            sizeSqFt: costarSpaces.sizeSqFt,
            source: costarSpaces.source,
            data: sql<Record<string, unknown>>`jsonb_build_object(
          'spaceUse', ${costarSpaces.data}->'spaceUse',
          'position', ${costarSpaces.data}->'position',
          'floor', ${costarSpaces.data}->'floor',
          'askingRentUsdPerSfYearLow', ${costarSpaces.data}->'askingRentUsdPerSfYearLow',
          'askingRentUsdPerSfYearHigh', ${costarSpaces.data}->'askingRentUsdPerSfYearHigh',
          'serviceTypeName', ${costarSpaces.data}->'serviceTypeName',
          'provenance', ${costarSpaces.data}->'provenance'
        )`,
          })
          .from(costarSpaces),
      ]);
      // The kit has no verified anchor-tenant field. Search marks this attribute
      // unknown rather than inferring it from tenant names or size.
      return SiteInventorySchema.parse({
        properties,
        spaces,
        tenancies: [],
        synthetic: false,
      });
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
