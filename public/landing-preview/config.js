// Same-origin routes make the landing portable across local and preview hosts.

// Where the call-to-action goes (HAC-129). /start sends a first visit into the guided
// onboarding and offers a returning visitor their workspace, reading the existing
// intake session; the landing keeps no state of its own.
export const ENTRY_URL = new URL("/start", window.location.origin).href;

// The supported live map surface: the real Cesium + Vexcel simulator route.
export const PRODUCT_PREVIEW_URL = new URL(
  "/projects/houston-coffee/simulator",
  window.location.origin,
).href;

// The staffed-counter comparison is still being integrated (HAC-104, HAC-120).
// Until then the stage shows the existing example replay.
export const DEMO_URL = new URL(
  "/projects/houston-coffee/replay?site=montrose",
  window.location.origin,
).href;

// A public café reference, not a scan of a Houston candidate property.
export const MATTERPORT_URL =
  "https://my.matterport.com/show/?m=qfmMbTLt4Bo&play=1&qs=1";
