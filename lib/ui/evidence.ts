import type { AssumedValue } from "@/lib/contracts";
import type {
  EvaluationResult,
  EvaluationSite,
} from "@/lib/contracts/evaluation";
import type { Origin as SimOrigin } from "@/lib/sim/contracts";

export type EvidenceKind =
  "Source-backed" | "Your input" | "Assumption" | "Simulation";

type Derivation = NonNullable<EvaluationResult["derivation"]>;
/** UI-only provenance vocabulary; this does not extend the stored origin enum. */
export type EvidenceOrigin =
  | AssumedValue["origin"]
  | SimOrigin
  | NonNullable<EvaluationSite["serviceMeanOrigin"]>
  | Derivation[keyof Derivation]
  | "matterport";

const evidenceByOrigin = {
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
} as const satisfies Record<EvidenceOrigin, EvidenceKind>;

/** For modelled results pass derivation.output, not the origin of their inputs. */
export function evidenceFor(origin: EvidenceOrigin): EvidenceKind {
  if (!Object.hasOwn(evidenceByOrigin, origin)) {
    throw new Error(`Unmapped evidence origin: ${origin}`);
  }
  return evidenceByOrigin[origin];
}
