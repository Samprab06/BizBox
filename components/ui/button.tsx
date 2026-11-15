import type { ComponentProps } from "react";
import { cn, disabledState, focusRing, pressable } from "./cn";

export type ButtonVariant = "primary" | "glass" | "quiet" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-on-accent hover:bg-accent-hover font-semibold",
  glass:
    "border border-glass-edge bg-glass-fill text-ink backdrop-blur-glass hover:bg-panel-raised",
  quiet: "bg-transparent text-ink hover:bg-line",
  danger:
    "border border-danger bg-panel-raised text-danger hover:bg-glass-fallback",
};

export const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

export type ButtonProps = ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Disables the button, sets aria-busy and shows a spinner. */
  loading?: boolean;
};

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none",
        className,
      )}
    />
  );
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  type = "button",
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-variant={variant}
      data-loading={loading ? "true" : undefined}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-control",
        pressable,
        focusRing,
        disabledState,
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}
