import type { CallbackProperty, Color } from "cesium";

/**
 * Read changing color through Cesium's per-instance attribute path. Mutating a
 * ConstantProperty instead would emit entity geometry changes and rebuild batches.
 * The constructor is supplied by the caller's existing lazy Cesium import.
 */
export function createAnimatedColor(
  initial: Color,
  Property: typeof CallbackProperty,
) {
  const value = initial.clone();
  return {
    property: new Property(
      (_time, result?: Color) => value.clone(result),
      false,
    ),
    setValue(next: Color) {
      next.clone(value);
    },
  };
}
