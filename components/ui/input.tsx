import type { ComponentProps } from "react";
import { cn, focusRing } from "./cn";

const field =
  "w-full rounded-control border bg-field px-3 text-sm text-ink placeholder:text-muted transition duration-question ease-question motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-60";

function fieldClass(
  invalid: boolean | undefined,
  extra: string,
  className?: string,
) {
  return cn(
    field,
    focusRing,
    invalid ? "border-danger" : "border-glass-edge",
    extra,
    className,
  );
}

type FieldProps = { invalid?: boolean };

export type InputProps = ComponentProps<"input"> & FieldProps;
export function Input({ invalid, className, ...props }: InputProps) {
  return (
    <input
      {...props}
      aria-invalid={invalid || props["aria-invalid"]}
      className={fieldClass(invalid, "h-10", className)}
    />
  );
}

export type TextareaProps = ComponentProps<"textarea"> & FieldProps;
export function Textarea({ invalid, className, ...props }: TextareaProps) {
  return (
    <textarea
      {...props}
      aria-invalid={invalid || props["aria-invalid"]}
      className={fieldClass(invalid, "min-h-20 py-2", className)}
    />
  );
}

export type SelectProps = ComponentProps<"select"> & FieldProps;
export function Select({ invalid, className, ...props }: SelectProps) {
  return (
    <select
      {...props}
      aria-invalid={invalid || props["aria-invalid"]}
      className={fieldClass(invalid, "h-10", className)}
    />
  );
}
