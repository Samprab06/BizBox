import { makeDemo } from "@/components/simulator/fixture";
import { CafeCounterCase } from "@/components/simulator/cafe-counter-case";
/** Explicit runnable example: never substitutes for a selected real property. */
export default function CafeCounterExamplePage() {
  return <CafeCounterCase data={makeDemo()} />;
}
