import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  createMatterportModelClient,
  normalizeMatterportDimensions,
} from "./model-api";
import { syntheticModelApiResponse as wire } from "./__fixtures__/model-api";

describe("verified Matterport Model API boundary", () => {
  it("maps native XY floor coordinates and Z elevation to Y-up bounds with explicit metric conversion", () => {
    const dimensions = normalizeMatterportDimensions(wire, "Synthetic01");
    expect(dimensions?.floors[0]?.rooms[0]?.bounds).toEqual({
      min: { x: -5, y: 2, z: -4 },
      max: { x: 5, y: 5, z: 6 },
    });
    expect(dimensions?.floors[0]?.areaSqFt).toBeCloseTo(1076.3910416709722);
    expect(dimensions?.provenance).toMatchObject({
      origin: "matterport",
      provider: "matterport",
      mode: "live",
    });
  });
  it.each([
    "errors",
    "wrong-model",
    "missing-elevation",
    "missing-boundary",
    "wrong-units",
    "nonfinite",
  ])("does not claim geometry for %s", (change) => {
    const input = structuredClone(wire);
    if (change === "errors")
      Object.assign(input, { errors: [{ message: "private" }] });
    if (change === "wrong-model") input.data.model.id = "Different01";
    if (change === "missing-elevation")
      Object.assign(input.data.model.rooms[0]!.dimensionEstimates, {
        lowerElevation: null,
      });
    if (change === "missing-boundary")
      input.data.model.rooms[0]!.boundary.edges = [];
    if (change === "wrong-units")
      input.data.model.rooms[0]!.dimensionEstimates.units = "imperial";
    if (change === "nonfinite")
      input.data.model.rooms[0]!.dimensionEstimates.area = Infinity;
    expect(normalizeMatterportDimensions(input, "Synthetic01")).toBeUndefined();
  });
  it("uses only the fixed official endpoint, a read-only query and Basic tokenID:secret auth", async () => {
    const client = createMatterportModelClient({
      token: "synthetic-id:synthetic-secret",
      approvedModelIds: ["Synthetic01"],
      fetch: async (url, options) => {
        expect(url).toBe("https://api.matterport.com/api/models/graph");
        expect(options?.method).toBe("POST");
        expect(options?.redirect).toBe("error");
        expect(new Headers(options?.headers).get("authorization")).toBe(
          `Basic ${Buffer.from("synthetic-id:synthetic-secret").toString("base64")}`,
        );
        const body = JSON.parse(String(options?.body));
        expect(body.variables).toEqual({ modelId: "Synthetic01" });
        expect(body.query).not.toMatch(/mutation|bundle|unlock/);
        expect(String(options?.body)).not.toContain("synthetic-secret");
        return Response.json(wire);
      },
    });
    expect((await client.getDimensions("Synthetic01"))?.floors).toHaveLength(1);
  });
  it("never requests an unapproved or malformed model", async () => {
    const client = createMatterportModelClient({
      token: "id:secret",
      approvedModelIds: [],
      fetch: async () => {
        throw new Error("Unexpected outbound request");
      },
    });
    expect(await client.getDimensions("Synthetic01")).toBeUndefined();
    expect(await client.getDimensions("bad/id")).toBeUndefined();
  });
  it("rejects a bearer-style or malformed credential before requests", () => {
    expect(() =>
      createMatterportModelClient({
        token: "bearer-only",
        approvedModelIds: [],
      }),
    ).toThrow(/configuration/);
  });
  it.each([401, 429, 500])(
    "returns no dimensions for HTTP %s without exposing response details",
    async (status) => {
      const client = createMatterportModelClient({
        token: "id:secret",
        approvedModelIds: ["Synthetic01"],
        fetch: async () => new Response("private credential echo", { status }),
      });
      expect(await client.getDimensions("Synthetic01")).toBeUndefined();
    },
  );
  it("bounds provider response size and request duration", async () => {
    const huge = createMatterportModelClient({
      token: "id:secret",
      approvedModelIds: ["Synthetic01"],
      fetch: async () => new Response("x".repeat(1_048_577)),
    });
    expect(await huge.getDimensions("Synthetic01")).toBeUndefined();
    const timeout = createMatterportModelClient({
      token: "id:secret",
      approvedModelIds: ["Synthetic01"],
      timeoutMs: 5,
      fetch: async (_url, options) =>
        new Promise((_resolve, reject) =>
          options?.signal?.addEventListener("abort", () =>
            reject(new Error("private timeout detail")),
          ),
        ),
    });
    expect(await timeout.getDimensions("Synthetic01")).toBeUndefined();
  });
});
