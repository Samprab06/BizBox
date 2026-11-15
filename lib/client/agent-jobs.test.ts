import { afterEach, describe, expect, it, vi } from "vitest";
import { fields } from "@/components/intake/profile";
import { syntheticHoustonFixture } from "@/fixtures/houston-coffee";
import { liveComparisonPayload } from "@/tests/e2e/live-comparison-fixtures";
import type { UiAction } from "@/lib/contracts/agent";
import { applyAgentJobActions } from "./agent-jobs";
import { runAgentComparison } from "./live-comparison";
import { comparisonStorageKey, shortlistStorageKey } from "./project-store";

const projectId = liveComparisonPayload.result.projectId;
const ids = liveComparisonPayload.result.sites.map((site) => site.siteId);
let n = 0;
const act = (a: Record<string, unknown>) =>
  ({ id: `act_${++n}`, ...a }) as UiAction;

afterEach(() => vi.unstubAllGlobals());

describe("applyAgentJobActions", () => {
  it("shortlists, runs the comparison, reports progress and lands on the result", async () => {
    const messages: string[] = [];
    const setShortlist = vi.fn();
    const runComparison = vi.fn(async () => ({}) as never);
    const { href } = await applyAgentJobActions(
      [
        act({ type: "set_shortlist", siteIds: ids }),
        act({ type: "run_comparison", siteIds: ids }),
      ],
      { projectId, report: (m) => messages.push(m), setShortlist, runComparison },
    );
    expect(setShortlist).toHaveBeenCalledWith(projectId, ids);
    expect(runComparison).toHaveBeenCalledWith(projectId, ids, expect.anything());
    expect(href).toBe(`/projects/${projectId}/comparison`);
    expect(messages).toHaveLength(3);
    expect(messages.at(-1)).toContain("Comparison ready");
  });

  it("does nothing twice for a replayed action", async () => {
    const setShortlist = vi.fn();
    const action = act({ type: "set_shortlist", siteIds: ids });
    const deps = { projectId, report: () => {}, setShortlist };
    await applyAgentJobActions([action], deps);
    await applyAgentJobActions([action], deps);
    expect(setShortlist).toHaveBeenCalledTimes(1);
  });

  it("reports a failed comparison and does not navigate", async () => {
    const messages: string[] = [];
    const { href } = await applyAgentJobActions(
      [act({ type: "run_comparison", siteIds: ids })],
      {
        projectId,
        report: (m) => messages.push(m),
        runComparison: async () => {
          throw new Error("Service unavailable");
        },
      },
    );
    expect(href).toBeNull();
    expect(messages.at(-1)).toContain("could not run");
  });

  it("starts the investigation feed and opens the comparison view with it", async () => {
    const setInvestigation = vi.fn();
    const { href } = await applyAgentJobActions(
      [act({ type: "show_comparison", investigationId: "inv_1" })],
      { projectId, report: () => {}, setInvestigation },
    );
    expect(setInvestigation).toHaveBeenCalledWith(projectId, "inv_1");
    expect(href).toBe(`/projects/${projectId}/comparison?investigation=inv_1`);
  });
});

describe("runAgentComparison", () => {
  it("runs the profile -> comparison path and saves the shortlist and the comparison", async () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    vi.stubGlobal("window", { dispatchEvent: () => true });
    const intake = {
      profile: Object.fromEntries(
        fields.map(({ key }) => [
          key,
          {
            value:
              {
                concept: "Neighborhood coffee for commuters",
                category: "Coffee shop",
                city: "Houston",
                areas: "Favor Montrose; avoid downtown",
                rent: "4000",
                buildout: "80000",
                price: "Midrange",
                customers: "Commuters",
                hours: "7am–5pm",
                staff: "2",
                requirements: "Ground floor, parking; corner not required",
              }[key] ?? "",
            origin: "founder",
          },
        ]),
      ),
      messages: [],
    };
    store.set(`sitework:intake:v1:${projectId}`, JSON.stringify(intake));
    const snapshot = {
      ...syntheticHoustonFixture.profile,
      projectId,
      id: liveComparisonPayload.result.profileId,
      version: liveComparisonPayload.result.profileVersion,
    };
    const fetcher = vi.fn<typeof fetch>(async (url) =>
      String(url).endsWith("/capabilities")
        ? Response.json({ jevConfigured: false })
        : String(url) === "/api/profiles"
          ? Response.json({ profile: snapshot, persisted: true })
          : Response.json(liveComparisonPayload),
    );
    await runAgentComparison(projectId, ids, { fetcher });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/comparisons/capabilities",
      "/api/profiles",
      "/api/comparisons",
    ]);
    expect(JSON.parse(store.get(shortlistStorageKey(projectId))!)).toEqual(ids);
    expect(JSON.parse(store.get(comparisonStorageKey(projectId))!)).toMatchObject({
      comparisonId: liveComparisonPayload.comparisonId,
    });
  });

  it("refuses to run without a complete saved intake", async () => {
    await expect(
      runAgentComparison(projectId, ids, {
        storage: { getItem: () => null },
        fetcher: vi.fn(),
      }),
    ).rejects.toThrow();
  });
});
