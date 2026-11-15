import { describe, expect, it, vi } from "vitest";
import { liveComparisonSearch } from "@/tests/e2e/live-comparison-fixtures";
import { fields } from "@/components/intake/profile";
import {
  loadSiteSearch,
  searchBriefSnapshot,
  siteSearchReadiness,
} from "./use-site-search";

// Invented founder answers/API fixtures; no inventory or provider service is called.
const values = {
  concept: "Test coffee shop",
  category: "Coffee shop",
  city: "Houston",
  areas: "Favor the west side; avoid malls",
  rent: "4000",
  buildout: "80000",
  price: "Midrange",
  customers: "Commuters",
  hours: "7am–5pm",
  staff: "2",
  requirements: "None",
};
function brief() {
  return {
    profile: Object.fromEntries(
      fields.map(({ key }) => [key, { value: values[key], origin: "founder" }]),
    ),
    messages: [],
  };
}
function inventory() {
  const result = structuredClone(liveComparisonSearch);
  for (const entry of result.candidates) entry.candidate.synthetic = false;
  return result;
}

describe("listing readiness from actual saved criteria", () => {
  it("never requests inventory for missing, invalid or unsupported brief values", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const unsupported = brief();
    unsupported.profile.city!.value = "New York";
    for (const raw of [null, { profile: {}, messages: [] }, unsupported]) {
      const state = await loadSiteSearch(raw, "houston-coffee", fetcher);
      expect(siteSearchReadiness(state).status).toBe("needs_brief");
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sends the founder's exact supported criteria without widening filters", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(inventory()));
    const state = await loadSiteSearch(brief(), "houston-coffee", fetcher);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]![0]).toBe("/api/sites");
    const body = JSON.parse(fetcher.mock.calls[0]![1]!.body as string);
    expect(Object.keys(body).sort()).toEqual(["limit", "profile"]);
    expect(body.limit).toBe(8);
    expect(body.profile).toMatchObject({
      city: "Houston",
      category: "coffee",
      economics: {
        monthlyRentCeilingCents: { value: 400000, origin: "founder" },
      },
    });
    expect(body.profile.objective).toContain(values.areas);
    expect(body.profile.preferredAreas).toEqual([]);
    expect(siteSearchReadiness(state).status).toBe("ready");
  });

  it("distinguishes a service or identity failure from a real empty inventory response", async () => {
    const wrongProject = inventory();
    wrongProject.candidates[0]!.candidate.projectId = "another-project";
    for (const response of [
      Response.json({}, { status: 503 }),
      Response.json({}),
      Response.json(wrongProject),
    ]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
      expect(
        siteSearchReadiness(
          await loadSiteSearch(brief(), "houston-coffee", fetcher),
        ).status,
      ).toBe("error");
    }
    const empty = {
      ...inventory(),
      candidates: [],
      totalMatched: 0,
      emptyReason: "No sites remain; most restrictive filter: rentCeiling",
      mostRestrictiveFilter: "rentCeiling",
      filters: [{ name: "rentCeiling", before: 3, removed: 3, after: 0 }],
    };
    const state = await loadSiteSearch(
      brief(),
      "houston-coffee",
      vi.fn<typeof fetch>().mockResolvedValue(Response.json(empty)),
    );
    expect(siteSearchReadiness(state)).toMatchObject({
      status: "empty",
      emptyReason: empty.emptyReason,
      filters: empty.filters,
      mostRestrictiveFilter: "rentCeiling",
      totalMatched: 0,
    });
  });

  it("does not present a synthetic-only response as verified inventory readiness", async () => {
    const state = await loadSiteSearch(
      brief(),
      "houston-coffee",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json(liveComparisonSearch)),
    );
    expect(siteSearchReadiness(state).status).toBe("error");
  });

  it("fingerprints criteria changes but ignores conversation-only saves", () => {
    const saved = brief();
    const before = searchBriefSnapshot(JSON.stringify(saved));
    expect(
      searchBriefSnapshot(
        JSON.stringify({
          ...saved,
          messages: [{ role: "agent", text: "A conversation-only update" }],
        }),
      ),
    ).toBe(before);
    saved.profile.rent!.value = "3000";
    expect(searchBriefSnapshot(JSON.stringify(saved))).not.toBe(before);
    expect(() => JSON.parse(searchBriefSnapshot("{"))).not.toThrow();
  });
});
