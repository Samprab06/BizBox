import { describe, expect, it } from "vitest";
import { assertLocalDatabase, verifyLocalCounts } from "./load-local-data";

describe("local full-load safety", () => {
  it.each(["localhost", "127.0.0.1", "[::1]", "db"])(
    "accepts local host %s",
    (host) => {
      expect(() =>
        assertLocalDatabase(`postgresql://user:local@${host}:5432/dev`),
      ).not.toThrow();
    },
  );
  it.each([
    "postgresql://user:private@remote.example/db",
    "https://localhost/db",
    "postgresql://localhost.example/db",
  ])("rejects nonlocal targets", (url) => {
    expect(() => assertLocalDatabase(url)).toThrow(/local-only/);
  });
  it("requires actual pinned counts and nonempty full-source tables", () => {
    const counts = {
      costar_properties: 3339,
      costar_spaces: 3955,
      costar_tenancies: 11179,
      costar_attachments: 242934,
      public_block_groups: 12816,
      public_jobs: 100,
      public_places: 100,
    };
    expect(() => verifyLocalCounts(counts)).not.toThrow();
    expect(() => verifyLocalCounts({ ...counts, costar_spaces: 7910 })).toThrow(
      /count/,
    );
    expect(() => verifyLocalCounts({ ...counts, public_places: 0 })).toThrow(
      /complete/,
    );
  });
});
