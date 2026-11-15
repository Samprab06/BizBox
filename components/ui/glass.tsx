import type { ComponentProps } from "react";
import { cn } from "./cn";

export type GlassProps = ComponentProps<"div"> & {
  /** Adds a soft top highlight. */
  sheen?: boolean;
  /** `glass` is translucent; `backed` uses the opaque fallback for text over arbitrary imagery. */
  backing?: "glass" | "backed";
  radius?: "control" | "panel" | "sheet";
};

const radii = {
  control: "rounded-control",
  panel: "rounded-panel",
  sheet: "rounded-sheet",
} as const;

/** Smoked-glass surface. Place over a dark underlay; use `backing="backed"` over bright imagery. */
export function Glass({
  sheen = false,
  backing = "glass",
  radius = "panel",
  className,
  ...props
}: GlassProps) {
  return (
    <div
      {...props}
      data-sheen={sheen ? "true" : undefined}
      data-backing={backing}
      className={cn(
        "relative border border-glass-edge text-ink shadow-glass backdrop-blur-glass",
        backing === "backed" ? "bg-glass-fallback" : "bg-glass-fill",
        radii[radius],
        sheen &&
          "isolate before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:rounded-[inherit] before:bg-gradient-to-b before:from-white/10 before:to-transparent",
        className,
      )}
    />
  );
}
