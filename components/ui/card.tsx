import type { ComponentPropsWithoutRef } from "react";
import { cn } from "./cn";

export type CardProps = ComponentPropsWithoutRef<"div"> & {
  /** Omit to inherit the surrounding surface; the workspace uses the shared neutral theme. */
  surface?: "paper" | "viewport";
};

/** Opaque analysis backing within the shared smoked-glass system. */
export function Card({ surface, className, ...props }: CardProps) {
  return (
    <div
      {...props}
      data-surface={surface}
      className={cn(
        "sw-card rounded-panel border-line bg-panel-raised text-ink",
        className,
      )}
    />
  );
}
