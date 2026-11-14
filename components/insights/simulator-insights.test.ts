import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixture } from "@/lib/agent/__fixtures__/plan";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  render: vi.fn(),
  currentVersion: vi.fn(),
}));
vi.mock("@/components/simulator/demo", () => ({
  SimulatorDemo: (props: unknown) => {
    mocks.render(props);
    return h("div", null, "Replay");
  },
}));
vi.mock("@/components/shell/context-bar", () => ({
  ProjectContextProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}));
vi.mock("@/lib/evaluation/store-postgres", () => ({
  createPostgresComparisonStore: () => ({
    load: mocks.load,
    currentProfileVersion: mocks.currentVersion,
  }),
}));
import SimulatorPage from "@/app/(pages)/projects/[projectId]/simulator/page";

describe("city Insights server boundary", () => {
  beforeEach(() => {
    mocks.load.mockReset();
    mocks.render.mockClear();
    mocks.currentVersion.mockReset().mockResolvedValue(1);
  });
  it("forwards the selected site's own retained aggregate, not the leader's", async () => {
    const stored = fixture().comparison;
    const selected = stored.evaluation.result.sites[1];
    mocks.load.mockResolvedValue(stored);
    renderToStaticMarkup(
      await SimulatorPage({
        params: Promise.resolve({ projectId: "p1" }),
        searchParams: Promise.resolve({
          comparison: stored.id,
          site: selected.siteId,
        }),
      }),
    );
    expect(mocks.render).toHaveBeenCalledWith(
      expect.objectContaining({
        insights: selected.insights,
        profileVersion: stored.evaluation.result.profileVersion,
        context: expect.objectContaining({
          phase: "ready",
          siteId: selected.siteId,
        }),
      }),
    );
  });
  it("keeps a valid saved scene when its aggregate is absent or cannot be verified", async () => {
    for (const invalid of [false, true]) {
      const stored = fixture().comparison;
      if (invalid)
        stored.evaluation.result.sites[0].insights!.siteId = "wrong-site";
      else
        stored.evaluation.result.sites.forEach((site) => {
          delete site.insights;
        });
      mocks.load.mockResolvedValue(stored);
      renderToStaticMarkup(
        await SimulatorPage({
          params: Promise.resolve({ projectId: "p1" }),
          searchParams: Promise.resolve({ comparison: stored.id }),
        }),
      );
      expect(mocks.render).toHaveBeenLastCalledWith(
        expect.objectContaining({
          insights: undefined,
          context: expect.objectContaining({ phase: "ready" }),
        }),
      );
      if (invalid)
        expect(mocks.render).toHaveBeenLastCalledWith(
          expect.objectContaining({
            insightsUnavailableReason: expect.stringContaining(
              "could not be verified",
            ),
          }),
        );
    }
  });
  it("forwards stale and unknown freshness without another read or evaluation", async () => {
    const stored = fixture().comparison;
    mocks.load.mockResolvedValue(stored);
    for (const current of [stored.evaluation.result.profileVersion + 1, null]) {
      mocks.currentVersion.mockResolvedValue(current);
      renderToStaticMarkup(
        await SimulatorPage({
          params: Promise.resolve({ projectId: "p1" }),
          searchParams: Promise.resolve({ comparison: stored.id }),
        }),
      );
      expect(mocks.render).toHaveBeenLastCalledWith(
        expect.objectContaining({
          outdated: current !== null,
          profileVersionUnknown: current === null,
          profileVersion: stored.evaluation.result.profileVersion,
        }),
      );
    }
  });
  it("does not attach the separate 12-seed fixture to the one-day simulator example", async () => {
    renderToStaticMarkup(
      await SimulatorPage({
        params: Promise.resolve({ projectId: "houston-coffee" }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(mocks.render).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ phase: "example" }),
      }),
    );
    expect(mocks.render.mock.calls[0][0]).not.toHaveProperty("insights");
  });
});
