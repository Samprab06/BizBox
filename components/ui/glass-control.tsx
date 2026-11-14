import type { ComponentPropsWithoutRef } from "react";

export type GlassControlProps = Omit<
  ComponentPropsWithoutRef<"div">,
  "role" | "aria-label" | "aria-labelledby"
> & {
  /** Only place this group over a map or a 3D viewport. */
  over: "map" | "viewport";
  "aria-label": string;
};

export function GlassControl({
  over,
  className = "",
  ...props
}: GlassControlProps) {
  return (
    <div
      {...props}
      role="group"
      data-surface={over === "viewport" ? "viewport" : "paper"}
      className={`sw-glass-control ${className}`}
    />
  );
}
