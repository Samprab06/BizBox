import { createDevelopmentSitesHandler } from "./development-proxy";
import { loadSiteInventory } from "./inventory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createDevelopmentSitesHandler({
  loadInventory: loadSiteInventory,
});
