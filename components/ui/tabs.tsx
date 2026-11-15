"use client";

import { useId, useRef, type KeyboardEvent } from "react";
import { cn, focusRing, pressable } from "./cn";

export type TabItem = { value: string; label: string; disabled?: boolean };

type Props = {
  items: readonly TabItem[];
  value: string;
  onValueChange: (value: string) => void;
  "aria-label": string;
  className?: string;
};

function Group({
  kind,
  items,
  value,
  onValueChange,
  className,
  ...rest
}: Props & { kind: "tabs" | "segmented" }) {
  const id = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const tabs = kind === "tabs";

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const enabled = items.flatMap((item, i) => (item.disabled ? [] : [i]));
    const current = items.findIndex((item) => item.value === value);
    let pos = enabled.indexOf(current);
    if (event.key === "ArrowRight" || event.key === "ArrowDown")
      pos = (pos + 1) % enabled.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      pos = (pos - 1 + enabled.length) % enabled.length;
    else if (event.key === "Home") pos = 0;
    else if (event.key === "End") pos = enabled.length - 1;
    else return;
    event.preventDefault();
    const next = enabled[pos];
    onValueChange(items[next].value);
    refs.current[next]?.focus();
  }

  return (
    <div
      role={tabs ? "tablist" : "radiogroup"}
      aria-label={rest["aria-label"]}
      onKeyDown={onKeyDown}
      className={cn(
        tabs
          ? "inline-flex gap-1 border-b border-line"
          : "inline-flex gap-1 rounded-control border border-glass-edge bg-field p-1",
        className,
      )}
    >
      {items.map((item, i) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            id={`${id}-${item.value}`}
            role={tabs ? "tab" : "radio"}
            aria-selected={tabs ? selected : undefined}
            aria-checked={tabs ? undefined : selected}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onValueChange(item.value)}
            className={cn(
              "h-9 px-4 text-sm disabled:cursor-not-allowed disabled:opacity-60",
              pressable,
              focusRing,
              tabs
                ? cn(
                    "rounded-t-control border-b-2",
                    selected
                      ? "border-accent font-semibold text-ink"
                      : "border-transparent text-muted hover:text-ink",
                  )
                : cn(
                    "rounded-[10px]",
                    selected
                      ? "bg-accent font-semibold text-on-accent"
                      : "text-ink hover:bg-line",
                  ),
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

/** Switches between views of the same content. The consumer renders the panel. */
export function Tabs(props: Props) {
  return <Group kind="tabs" {...props} />;
}

/** Compact single-choice control (e.g. Baseline / Alternative). */
export function Segmented(props: Props) {
  return <Group kind="segmented" {...props} />;
}
