import "server-only";
import { resolveInterior } from "./service";
import { readInteriorSite } from "./repository";

export async function getInterior(siteId: string) {
  return resolveInterior(
    siteId,
    async (id) => {
      const { getDb } = await import("../db/client");
      return readInteriorSite(getDb(), id);
    },
    {
      // Deliberately closed. Neither query parameters, imported manifests nor the
      // presence of a token approve licensed display. HAC-14 must activate this in
      // a reviewed change after access and terms are established.
      allowLicensedAssets: false,
    },
  );
}
