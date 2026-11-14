import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeJevClient } from "../lib/panel/__fixtures__";
import {
  RecordedJevExampleSchema,
  recordedExampleIssues,
} from "../lib/panel/recorded-example";
import {
  EXAMPLE_SITES,
  main,
  plannedCalls,
  recordJevExample,
} from "./record-jev-example";

let dir: string;
let out: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "record-jev-"));
  out = join(dir, "recording.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function capture() {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    logs,
    errors,
    log: (m: string) => logs.push(m),
    error: (m: string) => errors.push(m),
  };
}

describe("record-jev-example without JEV_API_KEY", () => {
  it.each([{}, { JEV_API_KEY: "" }, { JEV_API_KEY: "   " }])(
    "exits with a clear message and writes nothing for %j",
    async (env) => {
      const io = capture();
      const client = fakeJevClient();
      const code = await main(["--out", out], env, { ...io, client });
      expect(code).toBe(1);
      expect(io.errors.join("\n")).toMatch(/JEV_API_KEY is not set/);
      expect(io.errors.join("\n")).toMatch(/no file was changed/);
      expect(client.calls).toBe(0);
      expect(existsSync(out)).toBe(false);
      expect(readdirSync(dir)).toEqual([]);
    },
  );

  it("--dry-run reports the planned call count without a key, calls and files", async () => {
    const io = capture();
    const client = fakeJevClient();
    const code = await main(["--dry-run", "--out", out], {}, { ...io, client });
    expect(code).toBe(0);
    expect(io.logs.join("\n")).toMatch(/up to \d+ Jev calls/);
    expect(client.calls).toBe(0);
    expect(existsSync(out)).toBe(false);
  });
});

describe("record-jev-example with a key (fake client, no network)", () => {
  const env = { JEV_API_KEY: "test-key-not-real" };

  it("records every persona at every example site and writes a valid fixture", async () => {
    const io = capture();
    const client = fakeJevClient();
    const code = await main(["--out", out], env, {
      ...io,
      client,
      now: () => new Date("2026-11-14T12:00:00Z"),
    });
    expect(code).toBe(0);

    const recorded = RecordedJevExampleSchema.parse(
      JSON.parse(readFileSync(out, "utf8")),
    );
    expect(recorded.recordedAt).toBe("2026-11-14T12:00:00.000Z");
    expect(recorded.modelVersion).toBe("jev-latest");
    expect(recorded.sites.map((s) => s.siteId)).toEqual(
      EXAMPLE_SITES.map((s) => s.site.id),
    );
    expect(recordedExampleIssues(recorded)).toEqual([]);
    // The cache answers identical requests once, so the planned count is an upper bound.
    expect(recorded.panel.calls).toBeLessThanOrEqual(
      plannedCalls(recorded.personaSet.personas.length),
    );
    expect(recorded.panel.calls).toBeGreaterThan(300);
    expect(client.calls).toBe(recorded.panel.calls);
    // The key never reaches the output or the file.
    expect(
      [...io.logs, ...io.errors, readFileSync(out, "utf8")].join("\n"),
    ).not.toContain(env.JEV_API_KEY);
  });

  it("refuses to replace an existing recording without --force", async () => {
    writeFileSync(out, "keep me");
    const client = fakeJevClient();
    const code = await main(["--out", out], env, { ...capture(), client });
    expect(code).toBe(1);
    expect(client.calls).toBe(0);
    expect(readFileSync(out, "utf8")).toBe("keep me");

    expect(
      await main(["--out", out, "--force"], env, { ...capture(), client }),
    ).toBe(0);
    expect(readFileSync(out, "utf8")).not.toBe("keep me");
  });

  it("writes nothing when a persona is still unanswered after the retry", async () => {
    const io = capture();
    const code = await main(["--out", out], env, {
      ...io,
      client: fakeJevClient({ fail: () => true }),
    });
    expect(code).toBe(1);
    expect(io.errors.join("\n")).toMatch(/no file was written/);
    expect(existsSync(out)).toBe(false);
  });

  it("recovers from a persona that fails once, because the panel retries it", async () => {
    const seen = new Set<string>();
    const client = fakeJevClient({
      fail: (req) => {
        const key = JSON.stringify(req);
        if (seen.has(key)) return false;
        seen.add(key);
        return seen.size === 1; // only the very first call fails, once
      },
    });
    const recorded = await recordJevExample({ client });
    expect(recorded.panel).toMatchObject({ retriedCalls: 1, failedCalls: 0 });
    expect(recordedExampleIssues(recorded)).toEqual([]);
  });
});
