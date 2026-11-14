import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { huffInput } from "@/lib/demand/fixtures";
import { SiteConfigSchema } from "@/lib/sim/contracts";
import { experimentSettings, runExperiment } from "@/lib/sim/experiment";
import {
  editExperimentLever,
  ExperimentPanel,
  type ExperimentLever,
  type ExperimentOrigins,
  type ExperimentPanelProps,
} from "./experiment-panel";

const input = {
  demand: huffInput(),
  seed: 45,
  dayType: "weekday" as const,
  config: SiteConfigSchema.parse({
    hours: {
      weekday: { openMin: 360, closeMin: 1140 },
      weekend: { openMin: 420, closeMin: 1080 },
    },
    stations: { planned: 1, usableSf: 1200, sfPerStation: 250 },
    service: { meanServiceMin: 5 },
    prices: { avgTicketUsd: 8 },
    staff: { headcount: 1, wageUsdPerHour: 18 },
    costs: { cogsPctOfRevenue: 0.3 },
    lease: {
      sf: 1200,
      askingRentUsdPerSfYear: 30,
      tripleNet: false,
      buildoutUsd: 9000,
      leaseTermMonths: 36,
    },
    calendar: { weekdayDaysPerMonth: 22, weekendDaysPerMonth: 8 },
  }),
};
const settings = experimentSettings(input);
const keys: ExperimentLever[] = [
  "averageTicketUsd",
  "plannedStations",
  "staffHeadcount",
  "weekdayOpen",
  "weekdayClose",
  "weekendOpen",
  "weekendClose",
  "demandMultiplier",
  "seed",
  "dayType",
];
const origins = Object.fromEntries(
  keys.map((key) => [key, "default"]),
) as ExperimentOrigins;
const props: ExperimentPanelProps = {
  settings,
  origins,
  onSettingsChange: vi.fn(),
  onRestart: vi.fn(),
};
const render = (extra: Partial<ExperimentPanelProps> = {}) =>
  renderToStaticMarkup(createElement(ExperimentPanel, { ...props, ...extra }));

describe("controlled experiment panel", () => {
  it("changes only the edited lever and its origin without mutating the host's data", () => {
    const before = structuredClone({ settings, origins });
    const edits = {
      averageTicketUsd: 9,
      plannedStations: 2,
      staffHeadcount: 3,
      weekdayOpen: 400,
      weekdayClose: 1100,
      weekendOpen: 480,
      weekendClose: 1000,
      demandMultiplier: 1.5,
      seed: 47,
    };
    for (const [key, value] of Object.entries(edits)) {
      const lever = key as Exclude<ExperimentLever, "dayType">;
      const next = editExperimentLever(settings, origins, lever, value);
      expect(next.origins).toEqual({ ...origins, [key]: "founder" });
      if (key.startsWith("weekday") || key.startsWith("weekend")) {
        const day = key.startsWith("weekday") ? "weekday" : "weekend";
        const bound = key.endsWith("Open") ? "openMin" : "closeMin";
        expect(next.settings).toEqual({
          ...settings,
          hours: {
            ...settings.hours,
            [day]: { ...settings.hours[day], [bound]: value },
          },
        });
      } else expect(next.settings).toEqual({ ...settings, [key]: value });
    }
    expect(
      editExperimentLever(settings, origins, "dayType", "weekend"),
    ).toEqual({
      settings: { ...settings, dayType: "weekend" },
      origins: { ...origins, dayType: "founder" },
    });
    expect({ settings, origins }).toEqual(before);
  });

  it("labels all settings and preserves the supplied provenance vocabulary", () => {
    const html = render({
      origins: {
        ...origins,
        averageTicketUsd: "costar",
        staffHeadcount: "founder",
        demandMultiplier: "public",
      },
    });
    for (const label of [
      "Average ticket ($)",
      "Planned stations",
      "Staff headcount",
      "Demand multiplier",
      "Seed",
      "Weekday opens",
      "Weekday closes",
      "Weekend opens",
      "Weekend closes",
      "Displayed day",
    ])
      expect(html).toContain(label);
    expect(html).toContain("origin: costar");
    expect(html).toContain("origin: founder");
    expect(html).toContain("origin: public");
    expect(html).toContain("origin: default");
    expect(html).toContain("Source-backed");
    expect(html).toContain("Your input");
    expect(html).toContain("Assumption");
  });

  it("keeps save disabled with an explanation until a host handler and displayed run exist", () => {
    expect(render()).toMatch(
      /<button[^>]*disabled=""[^>]*>Save baseline &amp; rerun<\/button>/,
    );
    expect(render()).toContain(
      "Saving a baseline is not connected in this view.",
    );
    const withHandler = render({ onSaveBaselineAndRerun: vi.fn() });
    expect(withHandler).toContain("Run a preview before pinning a baseline.");
    expect(withHandler).toMatch(
      /<button[^>]*disabled=""[^>]*>Save baseline &amp; rerun<\/button>/,
    );
  });

  it("renders engine results and all five alternative-minus-baseline metrics", () => {
    const baseline = runExperiment(input, settings);
    const alternative = runExperiment(input, {
      ...settings,
      plannedStations: 2,
    });
    const html = render({
      settings: alternative.settings,
      current: alternative,
      baseline,
      onSaveBaselineAndRerun: vi.fn(),
    });
    for (const label of [
      "Monthly contribution",
      "Served",
      "Walk-aways",
      "p90 wait (min)",
      "Peak-hour p90 wait (min)",
    ])
      expect(html).toContain(label);
    const delta =
      alternative.monthly.contributionUsd - baseline.monthly.contributionUsd;
    expect(html).toContain(
      `${delta > 0 ? "+" : "−"}${Math.abs(delta).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 })}`,
    );
    expect(html).toContain("Simulation");
    expect(html).toContain("not a sales forecast");
    expect(html).not.toContain("Settings changed.");
  });

  it("keeps displayed-day results explicit while the controlled draft changes", () => {
    const baseline = runExperiment(input, settings);
    const html = render({
      settings: { ...settings, dayType: "weekend" },
      current: baseline,
      baseline,
    });
    expect(html).toContain("Alternative: weekday");
    expect(html).toContain("Settings changed. Restart to update this preview.");
    const mismatch = render({
      current: baseline,
      baseline: { ...baseline, settings: { ...settings, dayType: "weekend" } },
    });
    expect(mismatch).toContain("different sites or day types");
    expect(mismatch).toMatch(/<td[^>]*>—<\/td>/);
    const otherSite = render({
      current: baseline,
      baseline: {
        ...baseline,
        selected: { ...baseline.selected, siteId: "other-site" },
      },
    });
    expect(otherSite).toContain("different sites or day types");
  });

  it("preserves unknown waits, blocks invalid hours and locks controls while busy", () => {
    const result = runExperiment(input, settings);
    const unknown = {
      ...result,
      selected: {
        ...result.selected,
        metrics: { ...result.selected.metrics, p90WaitMin: null },
      },
      peakHourP90WaitMin: null,
    };
    const html = render({ current: unknown, baseline: result, busy: true });
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Unknown");
    expect(html).toContain("Preparing preview…");
    const invalid = render({
      settings: {
        ...settings,
        hours: { ...settings.hours, weekday: { openMin: 700, closeMin: 600 } },
      },
    });
    expect(invalid).toContain("Closing must be later than opening");
    expect(invalid).toMatch(
      /<button[^>]*disabled=""[^>]*>Restart with settings<\/button>/,
    );
  });
});
