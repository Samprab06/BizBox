import type { APIResponse } from "@playwright/test";
import { syntheticHoustonFixture } from "../../../fixtures/houston-coffee";
import type { BusinessProfile } from "../../../lib/contracts";

/**
 * HAC-33 API contract suite. Two tiers:
 * - always (CI, no database): validation, not-found and secret checks that must never 500;
 * - E2E_DB=1: happy paths against a loaded database (local Docker `pnpm db:load`, or a seeded
 *   deployment via E2E_BASE_URL). E2E_PROJECT_ID names an existing project (default
 *   `local-dev`, which `pnpm db:load` creates; use `houston-coffee` on the hosted DB).
 * - E2E_MODEL=1 additionally advances an investigation through the OpenAI planner.
 */
export const WITH_DB = process.env.E2E_DB === "1";
export const WITH_MODEL = process.env.E2E_MODEL === "1";
export const PROJECT_ID = process.env.E2E_PROJECT_ID ?? "local-dev";

/** The synthetic Houston coffee profile, re-scoped to the test project. */
export function testProfile(): BusinessProfile {
  const profile = structuredClone(syntheticHoustonFixture.profile);
  // The fixture requires ground floor and frontage; no Houston space meets both, which is a
  // correct empty result but leaves the happy paths nothing to compare.
  profile.mustHaves.groundFloor.value = false;
  profile.mustHaves.frontage.value = false;
  return { ...profile, projectId: PROJECT_ID };
}

const SECRET_PATTERNS = [
  /postgres(?:ql)?:\/\//i,
  /\bnpg_[A-Za-z0-9]+/,
  /\bsk-[A-Za-z0-9_-]{10,}/,
  /JEV_API_KEY|OPENAI_API_KEY|DATABASE_URL/,
  /\n\s+at .+\(.+:\d+:\d+\)/, // stack trace frame
];

/** Fails if a response body or header leaks a credential, connection string or stack trace. */
export async function expectNoSecrets(response: APIResponse) {
  const text = `${JSON.stringify(response.headers())}\n${await response.text()}`;
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text))
      throw new Error(`Response leaks ${pattern} (${response.url()})`);
  }
}

/** Every object carrying an `origin` uses one of the four allowed origins. */
export function expectKnownOrigins(value: unknown, path = "$"): void {
  if (Array.isArray(value))
    return value.forEach((v, i) => expectKnownOrigins(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    for (const [key, v] of Object.entries(value)) {
      if (
        key === "origin" &&
        typeof v === "string" &&
        !["costar", "public", "founder", "default"].includes(v)
      )
        throw new Error(`Unknown origin "${v}" at ${path}.origin`);
      expectKnownOrigins(v, `${path}.${key}`);
    }
  }
}

/** Client errors must be 4xx with a readable code and message, never a 500. */
export async function expectClientError(
  response: APIResponse,
  statuses = [400, 404, 422],
) {
  if (!statuses.includes(response.status()))
    throw new Error(
      `Expected ${statuses.join("/")} from ${response.url()}, got ${response.status()}`,
    );
  await expectNoSecrets(response);
}
