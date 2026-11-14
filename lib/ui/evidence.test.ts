import { describe, expect, it } from "vitest";
import { z } from "zod";
import { OriginSchema } from "@/lib/contracts";
import { OriginSchema as SimOriginSchema } from "@/lib/sim/contracts";
import { EvaluationResultSchema } from "@/lib/contracts/evaluation";
import { evidenceFor, type EvidenceOrigin } from "./evidence";

const expected = {
  costar: "Source-backed",
  public: "Source-backed",
  matterport: "Source-backed",
  founder: "Your input",
  default: "Assumption",
  none: "Assumption",
  synthetic_personas: "Simulation",
  jev: "Simulation",
  huff: "Simulation",
  modelled_arrivals: "Simulation",
} as const;

describe("evidenceFor", () => {
  it.each(Object.entries(expected))("labels %s as %s", (origin, kind) => {
    expect(evidenceFor(origin as EvidenceOrigin)).toBe(kind);
  });

  it("covers both canonical origin enums without a fallback", () => {
    for (const origin of [
      ...OriginSchema.options,
      ...SimOriginSchema.options,
    ]) {
      expect(evidenceFor(origin)).toBe(expected[origin]);
    }
  });

  it("keeps modelled outputs Simulation for both models and calibrations", () => {
    const schema = EvaluationResultSchema.shape.derivation.unwrap();
    for (const behaviorModel of ["jev", "huff"]) {
      for (const calibration of ["none", "founder"]) {
        const derivation = schema.parse({
          inputs: "public",
          transformation: "synthetic_personas",
          behaviorModel,
          calibration,
          output: "modelled_arrivals",
        });
        expect(evidenceFor(derivation.inputs)).toBe("Source-backed");
        expect(evidenceFor(derivation.output)).toBe("Simulation");
      }
    }
  });

  it("fails closed for an unknown runtime origin", () => {
    expect(() =>
      evidenceFor("new-unreviewed-origin" as EvidenceOrigin),
    ).toThrow();
  });

  it("requires a deliberate mapping for every origin field and derivation category in contracts", () => {
    // Inspect exported schemas, including inline/nested origin enums, so an added
    // field or enum cannot quietly bypass the canonical OriginSchema guard.
    const modules = import.meta.glob(
      ["../contracts/*.ts", "!../contracts/*.test.ts", "../sim/contracts.ts"],
      { eager: true },
    );
    const found = new Set<string>();
    const visit = (
      node: unknown,
      context: boolean,
      seen: Map<object, number>,
    ): void => {
      if (!node || typeof node !== "object") return;
      const flag = context ? 2 : 1;
      if (((seen.get(node) ?? 0) & flag) !== 0) return;
      seen.set(node, (seen.get(node) ?? 0) | flag);
      if (node instanceof z.ZodObject) {
        for (const [key, child] of Object.entries(node.shape)) {
          visit(
            child,
            /origins?$/i.test(key) || key === "derivation" || context,
            seen,
          );
        }
      } else if (context && node instanceof z.ZodEnum) {
        node.options.forEach((value) => found.add(String(value)));
      } else if (context && node instanceof z.ZodLiteral) {
        node.values.forEach((value) => found.add(String(value)));
      } else {
        for (const child of Object.values(
          node instanceof z.ZodType ? node.def : node,
        )) {
          if (typeof child === "object") visit(child, context, seen);
        }
      }
    };
    for (const contractModule of Object.values(modules)) {
      for (const [name, value] of Object.entries(
        contractModule as Record<string, unknown>,
      )) {
        if (value instanceof z.ZodType)
          visit(value, /OriginSchema$/.test(name), new Map());
      }
    }
    expect(found.size).toBeGreaterThanOrEqual(9);
    for (const origin of found) {
      expect(
        expected,
        `Unmapped contract provenance: ${origin}`,
      ).toHaveProperty(origin);
      expect(evidenceFor(origin as EvidenceOrigin)).toBe(
        expected[origin as keyof typeof expected],
      );
    }
  });
});
