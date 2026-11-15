import { describe, expect, it } from "vitest";
import { loadSelectedInterior } from "./selected-interior-loader";
const provenance = {
  origin: "default",
  provider: "modeled",
  mode: "live",
  scope: "space",
  description: "No approved scan",
  limitations: [],
};
describe("selected interior load identity", () => {
  it("requests exact selected site and validates source rather than substituting a cafe", async () => {
    let requested = "";
    const response = await loadSelectedInterior(
      "42:9",
      new AbortController().signal,
      async (input) => {
        requested = String(input);
        return Response.json({ kind: "modeled", provenance });
      },
    );
    expect(requested).toBe("/api/sites/42%3A9/interior");
    expect(response.kind).toBe("modeled");
  });
  it("fails closed on unavailable or malformed selected-source responses", async () => {
    await expect(
      loadSelectedInterior(
        "42:9",
        new AbortController().signal,
        async () => new Response("", { status: 503 }),
      ),
    ).rejects.toThrow();
    await expect(
      loadSelectedInterior("42:9", new AbortController().signal, async () =>
        Response.json({ kind: "scan", modelId: "bad" }),
      ),
    ).rejects.toThrow();
  });
});
