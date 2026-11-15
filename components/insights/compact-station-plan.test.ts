import {
  Children,
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { stationPlan } from "@/tests/e2e/station-experiment-fixtures";
import {
  CompactStationPlan,
  type CompactStationPlanProps,
} from "./compact-station-plan";

const props = (
  overrides: Partial<CompactStationPlanProps> = {},
): CompactStationPlanProps => ({
  plan: stationPlan(),
  loading: false,
  writing: false,
  needsRead: false,
  error: null,
  onRun: vi.fn(),
  onRefresh: vi.fn(),
  ...overrides,
});
function findAction(
  node: ReactNode,
  match: (props: Record<string, unknown>) => boolean,
): ReactElement<Record<string, unknown>> | undefined {
  if (!isValidElement<Record<string, unknown>>(node)) return undefined;
  if (match(node.props)) return node;
  for (const child of Children.toArray(node.props.children as ReactNode)) {
    const found = findAction(child, match);
    if (found) return found;
  }
}

describe("compact workspace counter setup", () => {
  it("keeps no-room copy concise and preserves the full plan only in Details", () => {
    const plan = stationPlan();
    plan.status = "unavailable";
    plan.configurations = [];
    plan.nextConfigurationId = null;
    plan.unavailable = {
      code: "no_effective_variants",
      reason: "Detailed size and station fit diagnostic",
    };
    const html = renderToStaticMarkup(
      createElement(CompactStationPlan, props({ plan })),
    );
    const main = html.split("<details")[0];
    expect(main).toContain("No space for extra counters");
    expect(main).toContain("Refresh counter setup");
    expect(main).not.toContain("0 of 0");
    expect(main).not.toContain(plan.source.comparisonId);
    expect(main).not.toContain("paired seeds");
    expect(html).toContain("Detailed size and station fit diagnostic");
    expect(html).toContain(plan.source.comparisonId);
  });
  it("identifies the selected setup beside its revenue and contribution deltas", () => {
    const plan = stationPlan(3);
    const selected =
      plan.result?.status === "available" ? plan.result.selected : null;
    expect(selected).not.toBeNull();
    const main = renderToStaticMarkup(
      createElement(CompactStationPlan, props({ plan })),
    ).split("<details")[0];
    expect(main).toContain(
      `Selected setup: ${selected!.change.toEffectiveStations} counters · ${selected!.change.toStaffHeadcount} staff`,
    );
    expect(main).toContain("Added revenue / month");
    expect(main).toContain("Contribution change / month");
  });
  it("forwards Refresh to the controller's existing refresh callback", () => {
    const onRefresh = vi.fn();
    const tree = CompactStationPlan(
      props({ error: "Backend detail", onRefresh }),
    );
    const refresh = findAction(
      tree,
      (p) => p["aria-label"] === "Refresh counter setup",
    );
    expect(refresh?.props.disabled).toBe(false);
    (refresh!.props.onClick as () => void)();
    expect(onRefresh).toHaveBeenCalledOnce();
  });
  it("keeps explicit confirmation attached to the existing run callback", () => {
    const plan = stationPlan();
    plan.status = "needs_confirmation";
    plan.confirmation = {
      configurationId: "baseline",
      costUnits: 12,
      remainingUnits: 3,
    };
    const onRun = vi.fn();
    const tree = CompactStationPlan(props({ plan, onRun }));
    const action = findAction(
      tree,
      (p) =>
        typeof p.onClick === "function" &&
        p["aria-label"] !== "Refresh counter setup",
    );
    (action!.props.onClick as () => void)();
    expect(onRun).toHaveBeenCalledWith(true);
  });
  it("shows only actual available configurations and blocks writes while freshness must be reread", () => {
    const plan = stationPlan();
    plan.configurations = [plan.configurations[0]];
    const tree = CompactStationPlan(props({ plan, needsRead: true }));
    const html = renderToStaticMarkup(tree);
    expect(html.split("<details")[0]).toContain("Current");
    expect(html.split("<details")[0]).not.toContain("+1 counter");
    const run = findAction(
      tree,
      (p) =>
        typeof p.onClick === "function" &&
        p["aria-label"] !== "Refresh counter setup",
    );
    expect(run?.props.disabled).toBe(true);
  });
});
