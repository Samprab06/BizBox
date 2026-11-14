import type { Layout } from "@/lib/contracts/layout";
import type { LayoutDiffHook } from "@/lib/scenario/model";
import { solidElements } from "./geometry";
import { deriveSimParams, layoutError, parseLayout } from "./model";

/** Synchronous resolver: persistence belongs to the caller, not to this pure hook. */
export function createLayoutDiffHook(
  resolve: (layoutId: string) => Layout | null,
): LayoutDiffHook {
  const get = (id: string | null) => {
    if (id === null) return null;
    const layout = resolve(id);
    if (!layout || layout.layoutId !== id)
      return layoutError("layoutId", `Layout ${id} was not resolved`);
    return parseLayout(layout);
  };
  const elements = (layout: Layout | null) =>
    new Map<string, unknown>(
      layout
        ? [
            [layout.entrance.id, layout.entrance] as const,
            [layout.queuePath.id, layout.queuePath] as const,
            ...solidElements(layout).map(
              ({ element }) => [element.id, element] as const,
            ),
          ]
        : [],
    );
  const summary = (layout: Layout | null) =>
    layout === null
      ? null
      : {
          layoutId: layout.layoutId,
          ...deriveSimParams(layout),
          room: layout.room,
          policy: layout.policy,
          elementIds: [...elements(layout).keys()].sort(),
        };
  return {
    summarize(fromId, toId) {
      const from = get(fromId),
        to = get(toId);
      const a = elements(from),
        b = elements(to);
      const changedElementIds = [...new Set([...a.keys(), ...b.keys()])]
        .filter((id) => JSON.stringify(a.get(id)) !== JSON.stringify(b.get(id)))
        .sort();
      return { from: summary(from), to: summary(to), changedElementIds };
    },
    invert(summary) {
      return {
        from: structuredClone(summary.to),
        to: structuredClone(summary.from),
        changedElementIds: structuredClone(summary.changedElementIds),
      };
    },
  };
}
