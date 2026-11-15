import type { SpatialCustomer, SpatialRun } from "@/lib/contracts/spatial";

type Walking = Pick<
  SpatialCustomer,
  "route" | "walkStartMin" | "queueArrivalMin"
>;
/** Playback follows saved route geometry; it never re-runs customer decisions. */
export function routePointAt(customer: Walking, minute: number) {
  const route = customer.route;
  if (!route.length) return { x: 0, z: 0 };
  const fraction = Math.max(
    0,
    Math.min(
      1,
      (minute - customer.walkStartMin) /
        Math.max(0.00001, customer.queueArrivalMin - customer.walkStartMin),
    ),
  );
  const lengths = route
    .slice(1)
    .map((point, i) =>
      Math.hypot(point.x - route[i]!.x, point.z - route[i]!.z),
    );
  let distance = lengths.reduce((sum, n) => sum + n, 0) * fraction;
  for (let i = 0; i < lengths.length; i++) {
    const length = lengths[i]!;
    if (distance <= length) {
      const a = route[i]!,
        b = route[i + 1]!,
        t = length ? distance / length : 0;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    }
    distance -= length;
  }
  return route[route.length - 1]!;
}

export function visibleCustomers(run: SpatialRun, minute: number) {
  return run.customers
    .filter((customer) => {
      if (minute < customer.walkStartMin) return false;
      return !run.events.some(
        (e) =>
          "customerId" in e &&
          e.customerId === customer.id &&
          e.timeMin <= minute &&
          (["completion", "abandonment"].includes(e.type) ||
            (e.type === "arrival" && e.decision === "leave")),
      );
    })
    .map((customer) => ({ ...customer, ...routePointAt(customer, minute) }));
}
