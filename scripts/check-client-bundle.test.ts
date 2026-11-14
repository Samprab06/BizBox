import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { publicEnvIssues, scanClientBundle } from "./check-client-bundle";

test("rejects a server-only env name in emitted client code", () => {
  const directory = mkdtempSync(join(tmpdir(), "client-env-"));
  const bundle = join(directory, "chunk.js");
  try {
    writeFileSync(bundle, "console.log('safe')");
    expect(scanClientBundle(directory)).toEqual([]);
    writeFileSync(bundle, "console.log(env.DATABASE_URL)");
    expect(scanClientBundle(directory)).toEqual([
      `${bundle}: found server-only name DATABASE_URL`,
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("flags public credential names, credential values and reused server values", () => {
  expect(
    publicEnvIssues({
      DATABASE_URL: "internal",
      NEXT_PUBLIC_DB: "internal",
      NEXT_PUBLIC_TOKEN: "example",
      NEXT_PUBLIC_SETTINGS: "ghp_1234567890123456789012345",
      NEXT_PUBLIC_ORIGIN: "https://example.com",
    }),
  ).toEqual([
    "NEXT_PUBLIC_DB appears to contain a credential",
    "NEXT_PUBLIC_TOKEN appears to contain a credential",
    "NEXT_PUBLIC_SETTINGS appears to contain a credential",
  ]);
});

test("detects Matterport API names and values while allowing the SDK key", () => {
  const directory = mkdtempSync(join(tmpdir(), "matterport-client-env-"));
  const bundle = join(directory, "chunk.js");
  const env = {
    MATTERPORT_API_TOKEN: "synthetic-private-token",
    MATTERPORT_SDK_KEY: "synthetic-sdk-key",
  };
  try {
    writeFileSync(bundle, "console.log('synthetic-sdk-key')");
    expect(scanClientBundle(directory, env)).toEqual([]);
    writeFileSync(bundle, "console.log('synthetic-private-token')");
    expect(scanClientBundle(directory, env)).toEqual([
      `${bundle}: found server-only value for MATTERPORT_API_TOKEN`,
    ]);
    writeFileSync(bundle, "console.log(env.MATTERPORT_API_TOKEN)");
    expect(scanClientBundle(directory, env)).toEqual([
      `${bundle}: found server-only name MATTERPORT_API_TOKEN`,
    ]);
    expect(
      publicEnvIssues({
        ...env,
        NEXT_PUBLIC_INTERIOR: env.MATTERPORT_API_TOKEN,
      }),
    ).toEqual(["NEXT_PUBLIC_INTERIOR appears to contain a credential"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("detects the Basic-encoded Matterport credential without printing it", () => {
  const directory = mkdtempSync(join(tmpdir(), "matterport-basic-env-"));
  const bundle = join(directory, "chunk.js");
  const token = "synthetic-id:synthetic-secret";
  try {
    writeFileSync(
      bundle,
      `const auth='Basic ${Buffer.from(token).toString("base64")}'`,
    );
    expect(
      scanClientBundle(directory, { MATTERPORT_API_TOKEN: token }),
    ).toEqual([`${bundle}: found server-only value for MATTERPORT_API_TOKEN`]);
    expect(
      publicEnvIssues({
        MATTERPORT_API_TOKEN: token,
        NEXT_PUBLIC_CONFIG: Buffer.from(token).toString("base64"),
      }),
    ).toEqual(["NEXT_PUBLIC_CONFIG appears to contain a credential"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("allows a genuine SDK value but rejects accidental reuse of the private credential in its public slot", () => {
  expect(publicEnvIssues({ MATTERPORT_SDK_KEY: "synthetic-sdk-key" })).toEqual(
    [],
  );
  expect(
    publicEnvIssues({
      MATTERPORT_API_TOKEN: "id:private-secret",
      MATTERPORT_SDK_KEY: "id:private-secret",
    }),
  ).toEqual(["MATTERPORT_SDK_KEY appears to contain a credential"]);
});
