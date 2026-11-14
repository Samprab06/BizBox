import {
  Cartesian3,
  Ellipsoid,
  PostProcessStage,
  PostProcessStageComposite,
  type Scene,
} from "cesium";
import { cloudFragmentShader } from "./cloud-fragment-shader";

// Volume shaders from Cesium Volumetric Cloud Lab, revision 810a680 (MIT).
// https://github.com/tatsuya-ogawa/cesium-volumetric-clouds
export function addVolumetricClouds(scene: Scene, minute: () => number) {
  const base = 1100;
  const thickness = 1300;
  const scaleMeters = 6200;
  const radii = Ellipsoid.WGS84.radii;
  const inverseRadii = (height: number) =>
    new Cartesian3(
      1 / (radii.x + height),
      1 / (radii.y + height),
      1 / (radii.z + height),
    );

  const volume = new PostProcessStage({
    name: "sitework-cloud-volume",
    fragmentShader: cloudFragmentShader,
    textureScale: 0.5,
    uniforms: {
      u_time: () => minute() * 60,
      u_coverage: 0.64,
      u_density: 0.8,
      u_baseAltitude: base,
      u_thickness: thickness,
      u_cloudScale: radii.x / scaleMeters,
      u_windOffset: () => (minute() * 60 * 9) / scaleMeters,
      u_shapeEvolution: 0.15,
      u_invEarthRadii: inverseRadii(0),
      u_invInnerRadii: inverseRadii(base),
      u_invOuterRadii: inverseRadii(base + thickness),
      u_meanEarthRadius: radii.x,
      u_useManualSun: 0,
      u_manualSunDirection: Cartesian3.UNIT_X,
      u_stepCount: 40,
      u_selfShadowSteps: 5,
      u_selfShadowStrength: 0.85,
      u_multipleScattering: 0.65,
      u_cameraPosition: () => scene.camera.positionWC,
      u_cameraDirection: () => scene.camera.directionWC,
      u_cameraRight: () => scene.camera.rightWC,
      u_cameraUp: () => scene.camera.upWC,
    },
  });

  const composite = new PostProcessStage({
    fragmentShader: `
      uniform sampler2D colorTexture;
      uniform sampler2D cloudTexture;
      in vec2 v_textureCoordinates;

      void main() {
        vec4 sceneColor = texture(colorTexture, v_textureCoordinates);
        ivec2 size = textureSize(cloudTexture, 0);
        vec2 pixel = v_textureCoordinates * vec2(size) - 0.5;
        ivec2 origin = ivec2(floor(pixel));
        vec2 f = fract(pixel);
        ivec2 upper = size - 1;
        vec4 a = texelFetch(cloudTexture, clamp(origin, ivec2(0), upper), 0);
        vec4 b = texelFetch(cloudTexture, clamp(origin + ivec2(1, 0), ivec2(0), upper), 0);
        vec4 c = texelFetch(cloudTexture, clamp(origin + ivec2(0, 1), ivec2(0), upper), 0);
        vec4 d = texelFetch(cloudTexture, clamp(origin + ivec2(1), ivec2(0), upper), 0);
        vec4 cloud = mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        out_FragColor = vec4(sceneColor.rgb * cloud.a + cloud.rgb, sceneColor.a);
      }
    `,
    uniforms: { cloudTexture: volume.name },
  });

  return scene.postProcessStages.add(
    new PostProcessStageComposite({
      name: "sitework-volumetric-clouds",
      stages: [volume, composite],
      inputPreviousStageTexture: false,
    }),
  );
}
