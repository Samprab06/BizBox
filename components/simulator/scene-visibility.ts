/** Keep the page's graphics suspended unless their section and document are visible. */
export function observeSceneVisibility(
  element: Element,
  onChange: (visible: boolean) => void,
) {
  const document = element.ownerDocument;
  let inViewport = typeof IntersectionObserver === "undefined";
  let stopped = false;
  let previous: boolean | undefined;
  const update = () => {
    if (stopped) return;
    const fullscreen = document.fullscreenElement;
    const visible =
      inViewport &&
      !document.hidden &&
      (!fullscreen || fullscreen.contains(element));
    if (visible !== previous) {
      previous = visible;
      onChange(visible);
    }
  };
  const observer =
    typeof IntersectionObserver === "undefined"
      ? undefined
      : new IntersectionObserver(([entry]) => {
          inViewport = entry?.isIntersecting ?? false;
          update();
        });
  document.addEventListener("visibilitychange", update);
  document.addEventListener("fullscreenchange", update);
  observer?.observe(element);
  update();
  return () => {
    stopped = true;
    observer?.disconnect();
    document.removeEventListener("visibilitychange", update);
    document.removeEventListener("fullscreenchange", update);
  };
}
