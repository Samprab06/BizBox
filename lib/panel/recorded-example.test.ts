import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ArrivalSchedule } from "@/lib/demand/contracts";
import { recordJevExample } from "../../scripts/record-jev-example";
import { fakeJevClient } from "./__fixtures__";
import {
  loadRecordedExample,
  loadRecordedExampleFrom,
} from "./recorded-example-loader";
import {
  RECORDED_EXAMPLE_FILE,
  recordedExampleLabel,
  recordedExamplePersonas,
  recordedExampleSchedule,
  recordedTable,
  type RecordedJevExample,
} from "./recorded-example";
import { existsSync } from "node:fs";

let recorded: RecordedJevExample;
beforeAll(async () => {
  recorded = await recordJevExample({
    client: fakeJevClient(),
    now: () => new Date("2026-11-14T12:00:00Z"),
  });
}, 20_000);

const request = {
  seed: 7,
  dayType: "weekday",
  openMin: 420,
  closeMin: 900,
} as const;

describe("recordedExampleSchedule", () => {
  it("turns a recorded table into a valid, Jev-sourced, seeded arrival schedule", () => {
    const schedule = recordedExampleSchedule(recorded, "montrose", request);
    expect(() => ArrivalSchedule.parse(schedule)).not.toThrow();
    expect(schedule.siteId).toBe("montrose");
    expect(schedule.demandSource).toBe("jev");
    expect(schedule.customers.length).toBeGreaterThan(0);
    expect(recordedExampleSchedule(recorded, "montrose", request)).toEqual(
      schedule,
    );
    expect(
      recordedExampleSchedule(recorded, "montrose", { ...request, seed: 8 }),
    ).not.toEqual(schedule);
  });

  it("makes no network call and scales demand with the multiplier", () => {
    const calls = { n: 0 };
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      calls.n++;
      throw new Error("network is off");
    }) as typeof fetch;
    try {
      const base = recordedExampleSchedule(recorded, "heights", request);
      const more = recordedExampleSchedule(recorded, "heights", {
        ...request,
        scale: 1.2,
      });
      expect(more.customers.length).toBeGreaterThan(base.customers.length);
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(calls.n).toBe(0);
  });

  it("rejects a site that was not recorded", () => {
    expect(() => recordedExampleSchedule(recorded, "nowhere", request)).toThrow(
      /No recorded Jev table/,
    );
    expect(() => recordedTable(recorded, "nowhere")).toThrow(
      /No recorded Jev table/,
    );
  });

  it("describes personas the way the replay screen expects", () => {
    const personas = recordedExamplePersonas(recorded);
    expect(personas).toHaveLength(recorded.personaSet.personas.length);
    expect(personas[0]).toMatchObject({
      id: recorded.personaSet.personas[0]!.id,
      label: expect.any(String),
    });
    expect(personas[0]!.destinations.map((d) => d.label)).toContain(
      "Example site",
    );
  });
});

describe("recordedExampleLabel", () => {
  it("names the model version and the recording date", () => {
    expect(recordedExampleLabel(recorded)).toBe(
      `Recorded Jev answers, ${recorded.modelVersion}, 2026-11-14`,
    );
  });
});

describe("loadRecordedExampleFrom", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("returns undefined when no recording exists", () => {
    expect(
      loadRecordedExampleFrom(join(tmpdir(), "no-such-recording.json")),
    ).toBeUndefined();
  });

  it("loads a valid recording and rejects an incomplete or malformed one", () => {
    dir = mkdtempSync(join(tmpdir(), "recorded-example-"));
    const path = join(dir, "rec.json");
    writeFileSync(path, JSON.stringify(recorded));
    expect(loadRecordedExampleFrom(path)?.modelVersion).toBe(
      recorded.modelVersion,
    );

    const incomplete = structuredClone(recorded);
    incomplete.sites[0]!.table.failedPersonaIds = [
      incomplete.personaSet.personas[0]!.id,
    ];
    writeFileSync(path, JSON.stringify(incomplete));
    expect(() => loadRecordedExampleFrom(path)).toThrow(/incomplete/);

    writeFileSync(path, JSON.stringify({ schemaVersion: 1 }));
    expect(() => loadRecordedExampleFrom(path)).toThrow();
  });
});

describe("the checked-in recording", () => {
  it("is absent or valid, never half-written", () => {
    // Without JEV_API_KEY no recording is checked in and the example stays on Huff.
    const present = existsSync(RECORDED_EXAMPLE_FILE);
    expect(() => loadRecordedExample()).not.toThrow();
    expect(loadRecordedExample() !== undefined).toBe(present);
  });
});
