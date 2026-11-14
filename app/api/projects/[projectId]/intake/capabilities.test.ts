import { describe, expect, it } from "vitest";
import { createIntakeCapabilitiesHandler } from "./capabilities";

describe("intake capabilities", () => {
  it.each([undefined, "", "  "])("reports no model for key %j", async (key) => {
    const response = await createIntakeCapabilitiesHandler({ OPENAI_API_KEY: key })();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ modelConfigured: false });
  });
  it("reports presence only", async () => {
    const response = await createIntakeCapabilitiesHandler({
      OPENAI_API_KEY: "sk-private",
      DATABASE_URL: "private",
    })();
    expect(await response.json()).toEqual({ modelConfigured: true });
  });
});
