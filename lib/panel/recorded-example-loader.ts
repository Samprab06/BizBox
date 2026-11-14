/**
 * Server-side loader for the recorded Jev example (HAC-101). Node only: it reads a checked-in
 * JSON file, so keep it out of client components.
 *
 * The recording is optional. Without the file (no one has run `scripts/record-jev-example.ts`,
 * or the TypeSafe terms do not allow checking it in) this returns undefined and the example
 * keeps its Huff numbers. A file that exists but is malformed or incomplete throws, so a bad
 * recording fails tests instead of silently showing Huff.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  RECORDED_EXAMPLE_FILE,
  RecordedJevExampleSchema,
  recordedExampleIssues,
  type RecordedJevExample,
} from "./recorded-example";

export function loadRecordedExampleFrom(
  path: string,
): RecordedJevExample | undefined {
  if (!existsSync(path)) return undefined;
  const recorded = RecordedJevExampleSchema.parse(
    JSON.parse(readFileSync(path, "utf8")),
  );
  const issues = recordedExampleIssues(recorded);
  if (issues.length)
    throw new Error(`Recorded Jev example is incomplete: ${issues.join("; ")}`);
  return recorded;
}

let cached: { value: RecordedJevExample | undefined } | undefined;

/** The checked-in recording, or undefined when none exists. Read once per process. */
export function loadRecordedExample(): RecordedJevExample | undefined {
  cached ??= {
    value: loadRecordedExampleFrom(join(process.cwd(), RECORDED_EXAMPLE_FILE)),
  };
  return cached.value;
}
