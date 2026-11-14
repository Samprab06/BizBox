import { afterEach, describe, expect, it, vi } from "vitest";
import { observeSceneVisibility } from "./scene-visibility";

function fixture() {
  const document = Object.assign(new EventTarget(), {
    hidden: false,
    fullscreenElement: null as {
      contains: (element: Element) => boolean;
    } | null,
  });
  const element = { ownerDocument: document } as unknown as Element;
  let intersect: (entries: { isIntersecting: boolean }[]) => void = () => {};
  let disconnected = false;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: typeof intersect) {
        intersect = callback;
      }
      observe() {}
      disconnect() {
        disconnected = true;
      }
    },
  );
  return {
    document,
    element,
    intersect: (visible: boolean) => intersect([{ isIntersecting: visible }]),
    disconnected: () => disconnected,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("scene visibility", () => {
  it("only activates a scene when both its viewport and document are visible", () => {
    const f = fixture();
    const changes: boolean[] = [];
    const stop = observeSceneVisibility(f.element, (active) =>
      changes.push(active),
    );
    expect(changes).toEqual([false]);
    f.intersect(true);
    f.document.hidden = true;
    f.document.dispatchEvent(new Event("visibilitychange"));
    f.intersect(false);
    f.document.hidden = false;
    f.document.dispatchEvent(new Event("visibilitychange"));
    expect(changes).toEqual([false, true, false]);
    f.intersect(true);
    expect(changes).toEqual([false, true, false, true]);
    stop();
  });

  it("suspends a covered scene while another viewport is fullscreen and restores it on exit", () => {
    const f = fixture();
    const changes: boolean[] = [];
    const stop = observeSceneVisibility(f.element, (active) =>
      changes.push(active),
    );
    f.intersect(true);
    f.document.fullscreenElement = { contains: () => false };
    f.document.dispatchEvent(new Event("fullscreenchange"));
    f.document.fullscreenElement = {
      contains: (element) => element === f.element,
    };
    f.document.dispatchEvent(new Event("fullscreenchange"));
    f.document.fullscreenElement = null;
    f.document.dispatchEvent(new Event("fullscreenchange"));
    expect(changes).toEqual([false, true, false, true]);
    stop();
    f.document.fullscreenElement = { contains: () => false };
    f.document.dispatchEvent(new Event("fullscreenchange"));
    expect(changes).toEqual([false, true, false, true]);
  });

  it("disconnects observation and ignores late visibility notifications after cleanup", () => {
    const f = fixture();
    const changes: boolean[] = [];
    const stop = observeSceneVisibility(f.element, (active) =>
      changes.push(active),
    );
    stop();
    f.intersect(true);
    f.document.dispatchEvent(new Event("visibilitychange"));
    expect(f.disconnected()).toBe(true);
    expect(changes).toEqual([false]);
  });

  it("keeps supported content available when IntersectionObserver is unavailable", () => {
    const f = fixture();
    vi.stubGlobal("IntersectionObserver", undefined);
    const changes: boolean[] = [];
    const stop = observeSceneVisibility(f.element, (active) =>
      changes.push(active),
    );
    expect(changes).toEqual([true]);
    f.document.hidden = true;
    f.document.dispatchEvent(new Event("visibilitychange"));
    expect(changes).toEqual([true, false]);
    stop();
  });
});
