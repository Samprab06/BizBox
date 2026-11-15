/** Official View.View.setActive(false) switches existing views; this module never generates one.
 * https://developers.matterport.com/reference/view/view/#setactive
 * Pinned declaration: public/matterport/sdk.d.ts (View and App.Feature.Defurnish).
 */
export type ViewEntry = {
  id: string;
  type: string;
  active: boolean;
  setActive: (returnToStart?: boolean) => Promise<void>;
};
type Subscription = { cancel: () => void };
export type DefurnishSdk = {
  App?: {
    Feature?: { Defurnish: string };
    features?: {
      subscribe: (observer: {
        onChanged: (features: Record<string, boolean | undefined>) => void;
      }) => Subscription;
    };
  };
  View?: {
    ViewType?: { DEFURNISH: string; BASE: string; LAYERED_BASE: string };
    views?: {
      subscribe: (observer: {
        onCollectionUpdated: (views: Record<string, ViewEntry>) => void;
      }) => Subscription;
    };
  };
};
export type DefurnishState = {
  availability: "pending" | "available" | "unavailable";
  reason: string;
  originalAvailable: boolean;
};
export const INITIAL_DEFURNISH_STATE: DefurnishState = {
  availability: "pending",
  reason: "Checking existing views for this model…",
  originalAvailable: false,
};
export function watchDefurnishedViews(
  sdk: DefurnishSdk,
  onChange: (state: DefurnishState) => void,
) {
  let disposed = false,
    busy = false,
    feature: boolean | undefined,
    settled = false,
    knownViews: ViewEntry[] = [];
  const types = sdk.View?.ViewType ?? {
    BASE: "viewtype.base",
    LAYERED_BASE: "viewtype.layeredbase",
    DEFURNISH: "viewtype.defurnish",
  };
  const original = () =>
    knownViews.find(
      (view) => view.type === types.BASE || view.type === types.LAYERED_BASE,
    );
  const defurnished = () =>
    knownViews.find((view) => view.type === types.DEFURNISH);
  const state = (): DefurnishState => {
    const originalAvailable = Boolean(original());
    if (!sdk.View?.views || !sdk.App?.features)
      return {
        availability: "unavailable",
        reason: "This SDK does not expose existing defurnished views.",
        originalAvailable,
      };
    if (feature === false)
      return {
        availability: "unavailable",
        reason: "Defurnish is not available for this model.",
        originalAvailable,
      };
    if (defurnished() && originalAvailable)
      return {
        availability: "available",
        reason: "An existing generated defurnished view is available.",
        originalAvailable,
      };
    if (settled)
      return {
        availability: "unavailable",
        reason:
          "This model has no existing generated defurnished view. No generation was requested.",
        originalAvailable,
      };
    return {
      availability: "pending",
      reason:
        feature === true
          ? "Defurnish is supported, but no generated view has been returned. No generation was requested."
          : "No generated defurnished view is available yet. No generation was requested.",
      originalAvailable,
    };
  };
  const emit = () => {
    if (!disposed) onChange(state());
  };
  const subscriptions: Subscription[] = [];
  if (sdk.App?.features)
    subscriptions.push(
      sdk.App.features.subscribe({
        onChanged: (features) => {
          feature =
            features[sdk.App?.Feature?.Defurnish ?? "feature.defurnish"];
          emit();
        },
      }),
    );
  if (sdk.View?.views)
    subscriptions.push(
      sdk.View.views.subscribe({
        onCollectionUpdated: (views) => {
          settled = true;
          knownViews = Object.values(views);
          emit();
        },
      }),
    );
  emit();
  return {
    state,
    async activate(target: "original" | "defurnished") {
      if (disposed) throw new Error("View controller is disposed");
      if (busy) throw new Error("A view switch is already running");
      if (target === "defurnished" && state().availability !== "available")
        throw new Error(state().reason);
      const view = target === "original" ? original() : defurnished();
      if (!view) throw new Error("Requested existing view is unavailable");
      busy = true;
      try {
        await view.setActive(false);
      } finally {
        busy = false;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      subscriptions.forEach((subscription) => subscription.cancel());
    },
  };
}
