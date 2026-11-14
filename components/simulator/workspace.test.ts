import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceView } from "@/components/workspace-view";
import { fixture } from "@/lib/agent/__fixtures__/plan";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  render: vi.fn(),
  currentProfileVersion: vi.fn(),
}));
vi.mock("@/components/simulator/demo", () => ({
  SimulatorDemo: (props: unknown) => {
    mocks.render(props);
    return h("div", null, "Simulator boundary");
  },
}));
vi.mock("@/components/shell/context-bar", () => ({
  ProjectContextProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}));
vi.mock("@/lib/evaluation/store-postgres", () => ({
  createPostgresComparisonStore: () => ({
    load: mocks.load,
    currentProfileVersion: mocks.currentProfileVersion,
  }),
}));

import SimulatorPage from "@/app/(pages)/projects/[projectId]/simulator/page";

describe("simulator workspace integration", () => {
  beforeEach(() => {
    mocks.load.mockReset();
    mocks.render.mockClear();
    mocks.currentProfileVersion.mockReset().mockResolvedValue(null);
  });
  it("selects the existing simulator navigation item", () => {
    const html = renderToStaticMarkup(
      h(
        WorkspaceView,
        { projectId: "houston-coffee", view: "simulator", title: "Simulator" },
        h("div", null, "Replay content"),
      ),
    );
    expect(html).toMatch(
      /<a[^>]*aria-current="page"[^>]*href="\/projects\/houston-coffee\/simulator\?site=montrose"/,
    );
    expect(html).toContain("Simulator");
    expect(html).toContain("Replay content");
  });
  it("keeps stored replay available for project IDs outside the bundled example", async () => {
    const stored = fixture().comparison;
    stored.id = "saved-comparison";
    stored.comparison.synthetic = false;
    mocks.load.mockResolvedValue(stored);
    const page = await SimulatorPage({
      params: Promise.resolve({ projectId: "saved-project" }),
      searchParams: Promise.resolve({ comparison: "saved-comparison" }),
    });
    const html = renderToStaticMarkup(page);
    expect(mocks.load).toHaveBeenCalledWith(
      "saved-project",
      "saved-comparison",
    );
    expect(mocks.render).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "saved-project",
        context: {
          kind: "simulator",
          phase: "ready",
          comparisonId: "saved-comparison",
          siteId: stored.evaluation.result.ranking[0],
          synthetic: false,
        },
        story: expect.objectContaining({
          compare: false,
          scenarioLabels: ["Weekday", "Weekend"],
          provenance: expect.objectContaining({
            label: expect.stringContaining("saved-comparison"),
          }),
        }),
        data: expect.arrayContaining([
          expect.objectContaining({
            run: expect.objectContaining({
              siteId: stored.evaluation.result.ranking[0],
            }),
          }),
        ]),
      }),
    );
    expect(html).not.toContain("Project unavailable");
    expect(html).toContain("/projects/saved-project/simulator");
  });
  it("publishes the actual Example fallback after stored loading fails", async () => {
    mocks.load.mockRejectedValue(new Error("Unavailable"));
    const page = await SimulatorPage({
      params: Promise.resolve({ projectId: "saved-project" }),
      searchParams: Promise.resolve({ comparison: "missing" }),
    });
    renderToStaticMarkup(page);
    expect(mocks.load).toHaveBeenCalledWith("saved-project", "missing");
    expect(mocks.render).toHaveBeenCalledWith(
      expect.objectContaining({
        context: {
          kind: "simulator",
          phase: "example",
          siteId: "montrose",
          synthetic: true,
        },
        data: expect.arrayContaining([
          expect.objectContaining({
            run: expect.objectContaining({ siteId: "demo-cafe" }),
          }),
        ]),
      }),
    );
  });
  it("forwards the saved robustness and detects an older profile without rerunning a model", async () => {
    const stored = fixture().comparison;
    stored.evaluation.robustness = {
      headline:
        "Site A leads under current assumptions; Site B leads below 0.70× demand.",
      leaderSiteId: stored.evaluation.result.ranking[0],
      tiedSiteIds: [],
      mostInfluential: null,
      robustTo: ["rent"],
      jevHuffAgree: false,
      missingInformation: [],
    };
    mocks.load.mockResolvedValue(stored);
    mocks.currentProfileVersion.mockResolvedValue(
      stored.evaluation.result.profileVersion + 1,
    );
    renderToStaticMarkup(
      await SimulatorPage({
        params: Promise.resolve({ projectId: "saved-project" }),
        searchParams: Promise.resolve({ comparison: stored.id }),
      }),
    );
    expect(mocks.currentProfileVersion).toHaveBeenCalledWith("saved-project");
    expect(mocks.render).toHaveBeenCalledWith(
      expect.objectContaining({
        robustness: stored.evaluation.robustness,
        outdated: true,
      }),
    );
  });
  it("retains the valid stored run if its freshness check is unavailable", async () => {
    const stored = fixture().comparison;
    mocks.load.mockResolvedValue(stored);
    mocks.currentProfileVersion.mockRejectedValue(
      new Error("Version read unavailable"),
    );
    renderToStaticMarkup(
      await SimulatorPage({
        params: Promise.resolve({ projectId: "saved-project" }),
        searchParams: Promise.resolve({ comparison: stored.id }),
      }),
    );
    expect(mocks.render).toHaveBeenCalledWith(
      expect.objectContaining({
        profileVersionUnknown: true,
        context: expect.objectContaining({ phase: "ready" }),
      }),
    );
  });
  it("does not invent an example project when an unknown project has no stored comparison", async () => {
    const page = await SimulatorPage({
      params: Promise.resolve({ projectId: "no-such-project" }),
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(page);
    expect(html).toContain("Project unavailable");
    expect(html).toContain("Open example project");
    expect(mocks.render).not.toHaveBeenCalled();
  });
});
