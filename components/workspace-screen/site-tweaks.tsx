"use client";

import type { SiteTweaks } from "@/lib/contracts/evaluation";
import { tweakChips } from "./workspace-flow";
import styles from "./workspace-glass.module.css";

/**
 * Scene 1: the per-site changes (hours, price, staff, rent) the next run applies to one unit.
 * The consultant sets them with `set_site_tweaks`; the founder can remove each one.
 */
export function SiteTweakChips({
  label,
  tweaks,
  onRemove,
  disabled,
}: {
  /** The unit's address, for the remove buttons' names. */
  label: string;
  tweaks: SiteTweaks | undefined;
  onRemove?: (field: keyof SiteTweaks) => void;
  disabled?: boolean;
}) {
  const chips = tweakChips(tweaks);
  if (!chips.length) return null;
  return (
    <ul className={styles.chips} aria-label={`Changes for ${label}`}>
      {chips.map((chip) => (
        <li key={chip.field} className={styles.chip}>
          {chip.label}
          {onRemove && (
            <button
              type="button"
              aria-label={`Remove ${chip.label} for ${label}`}
              disabled={disabled}
              onClick={() => onRemove(chip.field)}
            >
              ×
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
