import type { ComponentPropsWithoutRef } from "react";

export type CardProps = ComponentPropsWithoutRef<"div"> & {
  /** Omit to inherit the surrounding surface; the workspace defaults to paper. */
  surface?: "paper" | "viewport";
};

/** Solid analysis surface. Glass belongs exclusively to spatial controls. */
export function Card({ surface, className = "", ...props }: CardProps) {
  return (
    <div {...props} data-surface={surface} className={`sw-card ${className}`} />
  );
}
