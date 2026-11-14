import { describe, expect, it } from "vitest";
import {
  CallbackProperty,
  Cartesian3,
  Color,
  ColorMaterialProperty,
  Entity,
} from "cesium";
import { createAnimatedColor } from "./animated-color";

function ellipse(color: ReturnType<typeof createAnimatedColor>) {
  return new Entity({
    position: Cartesian3.fromDegrees(-95.4, 29.7),
    ellipse: {
      semiMajorAxis: 65,
      semiMinorAxis: 65,
      material: new ColorMaterialProperty(color.property),
    },
  });
}

describe("animated overlay color", () => {
  it("changes displayed color through forward/backward seeks without invalidating entity geometry", () => {
    const color = createAnimatedColor(
      Color.GREEN.withAlpha(0.82),
      CallbackProperty,
    );
    const entity = ellipse(color);
    const geometryChanges: string[] = [];
    entity.definitionChanged.addEventListener((_entity, name) =>
      geometryChanges.push(name),
    );
    const output = new Color();

    // Rush hour, midday, then seek back to rush hour.
    for (const expected of [Color.RED, Color.GREEN, Color.RED]) {
      color.setValue(expected.withAlpha(0.82));
      expect(color.property.getValue(undefined, output)).toBe(output);
      expect(output).toEqual(expected.withAlpha(0.82));
    }
    expect(geometryChanges).toEqual([]);
    expect(entity.ellipse!.semiMajorAxis!.isConstant).toBe(true);
    expect(color.property.isConstant).toBe(false);
  });

  it("updates demand opacity without leaking a mutable value to the renderer", () => {
    const color = createAnimatedColor(
      Color.BLUE.withAlpha(0.05),
      CallbackProperty,
    );
    const entity = ellipse(color);
    let geometryChanges = 0;
    entity.definitionChanged.addEventListener(() => geometryChanges++);
    color.setValue(Color.BLUE.withAlpha(0.5));
    const rendered = color.property.getValue() as Color;
    rendered.alpha = 0;
    expect((color.property.getValue() as Color).alpha).toBe(0.5);
    color.setValue(Color.BLUE.withAlpha(0.05));
    expect((color.property.getValue() as Color).alpha).toBe(0.05);
    expect(geometryChanges).toBe(0);
  });
});
