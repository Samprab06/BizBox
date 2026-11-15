"use client";

import { useEffect, useRef, useState } from "react";
import {
  createAnchorPicker,
  initialPickerState,
  type PointerSdk,
} from "./pick-anchor";

/** HAC-138: development-only calibration panel; render behind `pickAnchorEnabled()`. */
export default function PickAnchorPanel({ sdk }: { sdk: PointerSdk }) {
  const picker = useRef<ReturnType<typeof createAnchorPicker> | null>(null);
  const [state, setState] = useState(initialPickerState);
  useEffect(() => {
    const created = createAnchorPicker(sdk, { onChange: setState });
    picker.current = created;
    return () => {
      created.dispose();
      picker.current = null;
    };
  }, [sdk]);
  return (
    <details className="mx-4 mb-3 rounded-lg border border-dashed border-white/25 p-3 text-xs text-white/70">
      <summary>Dev: pick placement anchors</summary>
      <p className="mt-2" aria-live="polite">
        {state.next
          ? `Hover the floor at room point (${state.next.x} ft, ${state.next.y} ft), then record.`
          : "All anchors recorded."}
      </p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          className="rounded border border-white/25 px-2 py-1 disabled:opacity-40"
          disabled={!state.next}
          onClick={() => picker.current?.record()}
        >
          Record anchor
        </button>
        <button
          type="button"
          className="rounded border border-white/25 px-2 py-1 disabled:opacity-40"
          disabled={state.picked.length === 0}
          onClick={() => picker.current?.undo()}
        >
          Undo
        </button>
      </div>
      {state.error && (
        <p role="alert" className="mt-2 text-red-300">
          {state.error}
        </p>
      )}
      {state.solved && state.placement && (
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap">
          {`rms ${state.solved.rmsErrorM.toFixed(3)} m · unit ratio ${state.solved.unitRatio.toFixed(3)}\n`}
          {JSON.stringify(state.placement, null, 2)}
        </pre>
      )}
    </details>
  );
}
