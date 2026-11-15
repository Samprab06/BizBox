import { it, expect, vi } from "vitest";
import {
  createInteriorPublicChecker,
  excludedBusinessTourTitle,
  propertyAmenityTourTitle,
} from "./public-checker";
it("validates fixed issuer response and coalesces cache without retries", async () => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({ title: "Public model", html: "<iframe></iframe>" }),
  );
  const check = createInteriorPublicChecker(fetcher);
  expect(
    await Promise.all([check("Abc12345678"), check("Abc12345678")]),
  ).toEqual(["public", "public"]);
  await check("Abc12345678");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]![0]).toMatch(
    /^https:\/\/my.matterport.com\/api\/v1\/models\/oembed/,
  );
  expect(fetcher.mock.calls[0]![1]?.redirect).toBe("error");
  expect(await check("https://foreign")).toBe("unknown");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("rejects private, malformed and failed metadata", async () => {
  for (const [response, want] of [
    [new Response("", { status: 403 }), "private"],
    [Response.json({}), "unknown"],
    [new Response("x".repeat(65537)), "unknown"],
  ] as const) {
    expect(
      await createInteriorPublicChecker(async () => response)("Abc12345678"),
    ).toBe(want);
  }
});

it("excludes clear dwelling and communal-amenity titles without blocking commercial titles", () => {
  for (const title of [
    "2BR, 2BA - 984SF",
    "1 Bed / 1 Bath",
    "Apartments",
    "Screening Room",
  ])
    expect(excludedBusinessTourTitle(title)).toBe(true);
  for (const title of ["Cafe and bakery", "Office suite 200", "460 N Gage Ave"])
    expect(excludedBusinessTourTitle(title)).toBe(false);
});

it("recognizes ambiguous parent-property pool and amenity tours", () => {
  for (const title of [
    "Pool",
    "Roof Deck",
    "Lobby",
    "Courtyard",
    "Leasing Office",
  ])
    expect(propertyAmenityTourTitle(title)).toBe(true);
  expect(propertyAmenityTourTitle("Coffee Shop")).toBe(false);
});
