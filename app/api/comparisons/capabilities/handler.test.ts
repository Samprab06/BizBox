import { describe, expect, it } from "vitest";
import { createComparisonCapabilitiesHandler } from "./handler";

describe("comparison server capabilities", () => {
  it.each([undefined, "", "   "])(
    "reports Jev unconfigured for an absent or blank key",
    async (key) => {
      const response = await createComparisonCapabilitiesHandler({
        JEV_API_KEY: key,
      })();
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toEqual({ jevConfigured: false });
    },
  );
  it("reports only presence, never credentials or other server configuration", async () => {
    const response = await createComparisonCapabilitiesHandler({
      JEV_API_KEY: " configured-private-value ",
      DATABASE_URL: "private-database-config",
    })();
    expect(await response.json()).toEqual({ jevConfigured: true });
  });
});
