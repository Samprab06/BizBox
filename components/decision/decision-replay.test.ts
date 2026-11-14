import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { SiteRun } from "@/lib/contracts";
import type { RepresentativeRun } from "@/lib/contracts/evaluation";
import { DecisionReplay } from "./decision-replay";

it("depicts canonical served as service start and departed as completed, with an accessible manual replay", () => {
  const run: SiteRun = {
    id: "run",
    projectId: "project",
    synthetic: true,
    siteId: "site",
    profileId: "profile",
    arrivalScheduleId: "schedule",
    modelVersion: "test",
    seed: 1,
    dayType: "weekday",
    outputKind: "simulated",
    metrics: {
      completedCustomers: 1,
      unservedCustomers: 0,
      revenueCents: 500,
      includedCostCents: 100,
      operatingContributionCents: 400,
      averageWaitMinutes: 1,
    },
    events: [
      { type: "arrived", customerId: "one", minute: 480 },
      { type: "joined", customerId: "one", minute: 480 },
      { type: "served", customerId: "one", minute: 481 },
      { type: "departed", customerId: "one", minute: 485 },
    ],
  };
  const representative: RepresentativeRun = {
    runId: "run",
    seed: 1,
    dayType: "weekday",
    utilization: 0.1,
    served: 1,
    abandoned: 0,
    meanWaitMin: 1,
    hourly: [],
    eventIds: [],
  };
  const html = renderToStaticMarkup(
    h(DecisionReplay, {
      run,
      representative,
      label: "Stored weekday",
      fullReplayHref: "/replay",
    }),
  );
  expect(html).toContain("0 waiting, 1 in service, 0 served, 0 left at 08:01");
  expect(html).toContain('aria-label="Decision replay time"');
  expect(html).toContain('href="/replay"');
  expect(html).toContain("schematic");
});
