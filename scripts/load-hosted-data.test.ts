import { describe, expect, it } from "vitest";
import {
  assertHostedTarget,
  verifyHostedCounts,
  type HostedRowCounts,
} from "./load-hosted-data";

const hosted =
  "postgresql://user:pw@ep-example-123.us-east-1.aws.neon.tech/neondb?sslmode=require";

describe("hosted load guards", () => {
  it("requires --confirm-hosted, a hosted host and the direct connection", () => {
    expect(() => assertHostedTarget(hosted, [])).toThrow(/--confirm-hosted/);
    expect(() =>
      assertHostedTarget(hosted, ["--confirm-hosted"]),
    ).not.toThrow();
    expect(() =>
      assertHostedTarget("postgres://u:p@127.0.0.1:5432/x", [
        "--confirm-hosted",
      ]),
    ).toThrow(/use db:load/);
    expect(() =>
      assertHostedTarget(
        hosted.replace("ep-example-123.", "ep-example-123-pooler."),
        ["--confirm-hosted"],
      ),
    ).toThrow(/unpooled/);
    expect(() =>
      assertHostedTarget("mysql://u:p@h/x", ["--confirm-hosted"]),
    ).toThrow(/PostgreSQL/);
  });

  it("verifies pinned counts and that attachments were skipped", () => {
    const counts: HostedRowCounts = {
      costar_properties: 3339,
      costar_spaces: 3955,
      costar_tenancies: 11179,
      costar_attachments: 0,
      public_block_groups: 12816,
      public_jobs: 114284,
      public_places: 137469,
    };
    expect(() => verifyHostedCounts(counts)).not.toThrow();
    expect(() => verifyHostedCounts({ ...counts, costar_spaces: 1 })).toThrow(
      /costar_spaces/,
    );
    expect(() => verifyHostedCounts({ ...counts, public_jobs: 0 })).toThrow(
      /public_jobs/,
    );
    expect(() =>
      verifyHostedCounts({ ...counts, costar_attachments: 5 }),
    ).toThrow(/costar_attachments/);
  });
});
