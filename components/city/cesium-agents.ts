/**
 * HAC-77: draws `AgentGraphics` into a Cesium viewer. Points and trail dots come
 * from one pooled PointPrimitiveCollection that is reused every update, so 500
 * customers with trails never recreate primitives. The scene only redraws when
 * the caller requests a render.
 */
import type * as CesiumModule from "cesium";
import type { PointPrimitive, Viewer } from "cesium";
import type { Position } from "@/lib/sim/trips";
import type { AgentGraphics } from "./agent-graphics";

type Cesium = typeof CesiumModule;

const RING_SEGMENTS = 48;
const AGENT_PIXELS = 8;
const TRAIL_PIXELS = 4;
/** Height above the sampled ground so dots sit on, not inside, the mesh. */
const LIFT_METERS = 1.8;
const PIN_METERS = 45;

export type AgentLayer = {
  update(graphics: AgentGraphics | null): void;
  setGroundHeight(meters: number): void;
  setVisible(visible: boolean): void;
  destroy(): void;
};

export function createAgentLayer(
  Cesium: Cesium,
  viewer: Viewer,
  site: Position,
): AgentLayer {
  const { Cartesian3, Color } = Cesium;
  const points = viewer.scene.primitives.add(
    new Cesium.PointPrimitiveCollection(),
  ) as CesiumModule.PointPrimitiveCollection;
  const lines = viewer.scene.primitives.add(
    new Cesium.PolylineCollection(),
  ) as CesiumModule.PolylineCollection;
  const pool: PointPrimitive[] = [];
  let used = 0;
  let ground = 0;
  let visible = true;
  let last: AgentGraphics | null = null;
  const colors = new Map<string, CesiumModule.Color>();
  const color = (css: string, alpha = 1) => {
    const key = `${css}/${alpha.toFixed(2)}`;
    let value = colors.get(key);
    if (!value) {
      value = Color.fromCssColorString(css).withAlpha(alpha);
      colors.set(key, value);
    }
    return value;
  };
  const at = ([lng, lat]: Position, lift = LIFT_METERS) =>
    Cartesian3.fromDegrees(lng, lat, ground + lift);

  const take = () => {
    const point =
      pool[used] ??
      (pool[used] = points.add({
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      }));
    used++;
    point.show = true;
    return point;
  };

  // The selected site: a pin from the ground with a marker at the top.
  const pinMaterial = Cesium.Material.fromType("Color", {
    color: color("#c7d2fe", 0.95),
  });
  const pin = lines.add({ width: 3, material: pinMaterial });
  const pinHead = points.add({
    pixelSize: 14,
    color: color("#818cf8"),
    outlineColor: color("#ffffff"),
    outlineWidth: 2,
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
  });
  const ring = lines.add({
    width: 3,
    loop: true,
    material: Cesium.Material.fromType("Color", {
      color: color("#818cf8", 0.9),
    }),
  });
  const placeSite = () => {
    pin.positions = [at(site, 0), at(site, PIN_METERS)];
    pinHead.position = at(site, PIN_METERS);
  };
  placeSite();

  const draw = () => {
    for (let i = 0; i < used; i++) pool[i].show = false;
    used = 0;
    ring.show = false;
    if (!visible || !last) return;
    for (const agent of last.agents) {
      for (const dot of agent.trail) {
        const trail = take();
        trail.position = at(dot.position);
        trail.pixelSize = TRAIL_PIXELS;
        trail.color = color(agent.color, 0.55 * dot.opacity);
        trail.outlineWidth = 0;
      }
      const point = take();
      point.position = at(agent.position);
      point.pixelSize = AGENT_PIXELS;
      point.color = color(agent.color);
      point.outlineColor = color("#0f172a", 0.8);
      point.outlineWidth = 1;
    }
    if (last.queue) {
      const [lng, lat] = last.queue.center;
      const metersPerLng = 111_320 * Math.cos((lat * Math.PI) / 180);
      ring.positions = Array.from({ length: RING_SEGMENTS }, (_, i) => {
        const angle = (i / RING_SEGMENTS) * 2 * Math.PI;
        return at([
          lng + (Math.cos(angle) * last!.queue!.radiusMeters) / metersPerLng,
          lat + (Math.sin(angle) * last!.queue!.radiusMeters) / 111_320,
        ]);
      });
      ring.show = true;
    }
  };

  return {
    update(graphics) {
      last = graphics;
      draw();
    },
    setGroundHeight(meters) {
      if (!Number.isFinite(meters) || meters === ground) return;
      ground = meters;
      placeSite();
      draw();
    },
    setVisible(show) {
      visible = show;
      draw();
    },
    destroy() {
      if (viewer.isDestroyed()) return;
      viewer.scene.primitives.remove(points);
      viewer.scene.primitives.remove(lines);
    },
  };
}
