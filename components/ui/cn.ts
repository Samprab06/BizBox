/** Joins class names, skipping falsy values. No dependency needed for this. */
export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/** The one keyboard-focus ring: matches the global `:focus-visible` rule in workspace.css. */
export const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus-ring";

/** Press feedback and motion: transitions are off under prefers-reduced-motion. */
export const pressable =
  "transition duration-question ease-question active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100";

export const disabledState =
  "disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100";
