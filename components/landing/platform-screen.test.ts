import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({ neighborhood: vi.fn() }));

// The shared Cesium component requires a browser. Exercise the adapter boundary
// here; the existing renderer owns tile loading and camera behavior.
vi.mock("next/dynamic", () => ({
  default: () => (props: { children: ReactNode }) => {
    boundary.neighborhood(props);
    return h("div", null, props.children);
  },
}));

import LandingWorkspace from "@/app/landing-workspace/page";

describe("landing adapter of the actual platform components", () => {
  beforeEach(() => boundary.neighborhood.mockClear());
  afterEach(() => vi.unstubAllEnvs());

  it("keeps unavailable 3D honest without mounting a flat-map substitute", async () => {
    vi.stubEnv("VEXCEL_API_KEY", "");
    const html = renderToStaticMarkup(
      await LandingWorkspace({ searchParams: Promise.resolve({}) }),
    );
    expect(html).toContain("3D neighborhood unavailable");
    expect(html).toContain("Montrose storefront");
    expect(html).toContain("Heights storefront");
    expect(html).toContain("Example locations");
    expect(html).toContain("Consultant activity");
    expect(html).toContain("No investigation linked to this comparison.");
    expect(html).not.toContain("maplibre");
    expect(boundary.neighborhood).not.toHaveBeenCalled();
  });

  it("passes only the same-origin tileset URL and correct selected fixture coordinates", async () => {
    vi.stubEnv("VEXCEL_API_KEY", "private-test-secret-not-for-browser");
    const html = renderToStaticMarkup(
      await LandingWorkspace({
        searchParams: Promise.resolve({ site: "heights" }),
      }),
    );
    expect(boundary.neighborhood).toHaveBeenCalledWith(
      expect.objectContaining({
        longitude: -95.3988,
        latitude: 29.7998,
        tilesetUrl: "/api/vexcel/3d/tileset",
        locationLabel: "Heights storefront · Example location",
        quality: "balanced",
      }),
    );
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("1,820 sq ft");
    expect(html).toContain("Inline storefront");
    expect(html).toContain("Not provided");
    expect(html).not.toContain("private-test-secret-not-for-browser");
  });

  it("falls back to the known candidate for an invalid or ambiguous selected site", async () => {
    vi.stubEnv("VEXCEL_API_KEY", "configured");
    for (const site of ["unknown", ["heights", "montrose"]]) {
      boundary.neighborhood.mockClear();
      renderToStaticMarkup(
        await LandingWorkspace({ searchParams: Promise.resolve({ site }) }),
      );
      expect(boundary.neighborhood).toHaveBeenCalledWith(
        expect.objectContaining({ longitude: -95.3914, latitude: 29.7458 }),
      );
    }
  });
});
