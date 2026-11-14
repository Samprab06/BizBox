// Same-origin routes make this checkpoint portable across local and preview hosts.
export const PRODUCT_PREVIEW_URL = new URL(
  "/projects/houston-coffee/map",
  window.location.origin,
).href;

// The full counter-comparison simulator is follow-up work (HAC-104).
// Until that route lands, the checkpoint opens main's existing example replay.
export const DEMO_URL = new URL(
  "/projects/houston-coffee/replay?site=montrose",
  window.location.origin,
).href;

// A public café reference, not a scan of a Houston candidate property.
export const MATTERPORT_URL =
  "https://my.matterport.com/show/?m=qfmMbTLt4Bo&play=1&qs=1";
