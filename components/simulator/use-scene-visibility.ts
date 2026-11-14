"use client";

import { useEffect, useState, type RefObject } from "react";
import { observeSceneVisibility } from "./scene-visibility";

export function useSceneVisibility(ref: RefObject<Element | null>) {
  const [state, setState] = useState({ visible: false, hasBeenVisible: false });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    return observeSceneVisibility(element, (visible) => {
      setState((previous) => ({
        visible,
        hasBeenVisible: previous.hasBeenVisible || visible,
      }));
    });
  }, [ref]);
  return state;
}
