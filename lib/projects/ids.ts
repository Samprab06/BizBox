/**
 * HAC-136: project IDs. A new brief gets a generated ID (`p-` and 20 lowercase hex
 * characters, 80 random bits) from `POST /api/projects`; the seeded demo project keeps
 * its fixed ID. Safe to import from client and server code.
 */
import { DEMO_PROJECT_ID } from "@/fixtures/demo-project";

export { DEMO_PROJECT_ID };

const GENERATED_ID = /^p-[0-9a-f]{20}$/;

/** A fresh, unguessable project ID. Uses Web Crypto, never `Math.random`. */
export function newProjectId(
  random: (bytes: Uint8Array) => Uint8Array = (bytes) =>
    crypto.getRandomValues(bytes),
): string {
  const bytes = random(new Uint8Array(10));
  return `p-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function isGeneratedProjectId(projectId: string): boolean {
  return GENERATED_ID.test(projectId);
}

/** The demo project, or an ID in the shape `POST /api/projects` hands out. */
export function isKnownProjectId(projectId: string): boolean {
  return projectId === DEMO_PROJECT_ID || isGeneratedProjectId(projectId);
}
