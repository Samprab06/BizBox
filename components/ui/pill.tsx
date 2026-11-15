import type { ComponentProps } from "react";
import { cn, disabledState, focusRing, pressable } from "./cn";

export type PillTone = "neutral" | "accent" | "warn" | "danger";

const tones: Record<PillTone, string> = {
  neutral: "bg-white/10 text-ink",
  accent: "bg-accent text-on-accent",
  warn: "bg-white/10 text-warn",
  danger: "bg-white/10 text-danger",
};

export type PillProps = ComponentProps<"span"> & { tone?: PillTone };

/** Static label. Use `Chip` when it can be toggled. */
export function Pill({ tone = "neutral", className, ...props }: PillProps) {
  return (
    <span
      {...props}
      data-tone={tone}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
        tones[tone],
        className,
      )}
    />
  );
}

export type ChipProps = ComponentProps<"button"> & { selected?: boolean };

/** Toggle chip: exposes its state with aria-pressed. */
export function Chip({
  selected = false,
  type = "button",
  className,
  ...props
}: ChipProps) {
  return (
    <button
      {...props}
      type={type}
      aria-pressed={selected}
      className={cn(
        "inline-flex h-8 items-center gap-1 rounded-full border px-3 text-sm",
        pressable,
        focusRing,
        disabledState,
        selected
          ? "border-accent bg-accent text-on-accent"
          : "border-glass-edge bg-glass-fill text-ink hover:bg-panel-raised",
        className,
      )}
    />
  );
}
