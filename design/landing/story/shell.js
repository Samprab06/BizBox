import { storyTimeline } from "./story-timeline.js";

const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const hero = document.querySelector("#hero-copy");
const locationCopy = document.querySelector("#location-copy");
const finishCopy = document.querySelector("#finish-copy");
const openBizBox = document.querySelector("#open-bizbox");
const status = document.querySelector("#story-status");
const navigation = [...document.querySelectorAll("[data-story-target]")];
let pending = false;
let current = storyTimeline(0, { reducedMotion: reduced.matches });
let previousHeadline;

function scrollRange() {
  return Math.max(1, document.documentElement.scrollHeight - innerHeight);
}

function render() {
  pending = false;
  current = storyTimeline(scrollY / scrollRange(), {
    reducedMotion: reduced.matches,
  });
  document.documentElement.style.setProperty(
    "--hero-opacity",
    current.heroOpacity,
  );
  document.documentElement.style.setProperty(
    "--location-opacity",
    current.locationOpacity,
  );
  document.documentElement.style.setProperty(
    "--final-opacity",
    current.finalOpacity,
  );
  hero.hidden = current.heroOpacity === 0;
  locationCopy.hidden = current.locationOpacity === 0;
  finishCopy.hidden = current.finalOpacity === 0;
  navigation.forEach((button) => {
    if (button.dataset.storyTarget === current.stage)
      button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
  });
  if (current.headline !== previousHeadline) {
    previousHeadline = current.headline;
    status.textContent =
      current.headline === "hero"
        ? "Simulate business decisions."
        : current.headline === "location"
          ? "Find a place for your idea."
          : current.headline === "finish"
            ? "Test your business idea."
            : current.fullscreen
              ? "3D location workspace"
              : "";
  }
  window.bizboxStoryState = current;
  window.dispatchEvent(
    new CustomEvent("bizbox:story-progress", { detail: current }),
  );
}

function requestRender() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(render);
}

function goTo(progress) {
  window.scrollTo({
    top: Math.min(1, Math.max(0, progress)) * scrollRange(),
    behavior: reduced.matches ? "auto" : "smooth",
  });
}

navigation.forEach((button) =>
  button.addEventListener("click", () => {
    goTo(
      button.dataset.storyTarget === "hero"
        ? 0
        : button.dataset.storyTarget === "return"
          ? 1
          : 0.68,
    );
  }),
);

// The scene engine resolves the actual product destination from its config.
openBizBox.addEventListener("click", (event) => {
  if (openBizBox.getAttribute("href") === "#") event.preventDefault();
});

document.addEventListener("keydown", (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented)
    return;
  const target = event.target;
  if (
    target instanceof Element &&
    target.closest(
      "input, textarea, select, [contenteditable=true], a, button",
    ) &&
    !target.closest("#story-nav")
  )
    return;
  const progress =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? 1
        : event.key === "PageDown"
          ? current.progress + 0.22
          : event.key === "PageUp"
            ? current.progress - 0.22
            : undefined;
  if (progress === undefined) return;
  event.preventDefault();
  goTo(progress);
});

// Camera code can load before or after this shell and still read the same frame.
window.bizboxStory = Object.freeze({ getState: () => current });
window.bizboxStoryState = current;
addEventListener("scroll", requestRender, { passive: true });
addEventListener("resize", requestRender, { passive: true });
addEventListener("pageshow", requestRender);
reduced.addEventListener("change", requestRender);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) requestRender();
});
requestRender();
