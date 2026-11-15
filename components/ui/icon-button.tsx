import type { ComponentProps } from "react";
import {
  buttonVariants,
  Spinner,
  type ButtonSize,
  type ButtonVariant,
} from "./button";
import { cn, disabledState, focusRing, pressable } from "./cn";

export type IconButtonProps = Omit<ComponentProps<"button">, "aria-label"> & {
  /** Required: an icon has no visible text. */
  "aria-label": string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
};

const sizes: Record<ButtonSize, string> = {
  sm: "size-8",
  md: "size-10",
  lg: "size-12",
};

export function IconButton({
  variant = "glass",
  size = "md",
  loading = false,
  disabled,
  type = "button",
  className,
  children,
  ...props
}: IconButtonProps) {
  return (
    <button
      {...props}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-variant={variant}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-control",
        pressable,
        focusRing,
        disabledState,
        buttonVariants[variant],
        sizes[size],
        className,
      )}
    >
      {loading ? <Spinner /> : children}
    </button>
  );
}
