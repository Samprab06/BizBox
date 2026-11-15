import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "./cn";

export type PanelProps = Omit<ComponentProps<"section">, "title"> & {
  title?: ReactNode;
  /** Controls beside the title. */
  actions?: ReactNode;
  footer?: ReactNode;
  /** `raised` is opaque for dense content; `glass` is translucent. */
  tone?: "raised" | "glass";
};

/** Titled content region on a raised or glass surface. */
export function Panel({
  title,
  actions,
  footer,
  tone = "raised",
  className,
  children,
  ...props
}: PanelProps) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={title ? titleId : undefined}
      {...props}
      data-tone={tone}
      className={cn(
        "flex min-w-0 flex-col rounded-panel border text-ink shadow-glass",
        tone === "raised"
          ? "border-line bg-panel-raised"
          : "border-glass-edge bg-glass-fill backdrop-blur-glass",
        className,
      )}
    >
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 px-5 pt-5">
          {title && (
            <h2 id={titleId} className="text-base font-semibold">
              {title}
            </h2>
          )}
          {actions}
        </header>
      )}
      <div className="min-w-0 p-5">{children}</div>
      {footer && (
        <footer className="border-t border-line px-5 py-3">{footer}</footer>
      )}
    </section>
  );
}
