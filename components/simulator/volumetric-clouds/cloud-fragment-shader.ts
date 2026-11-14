import { cloudFieldShader } from "./cloud-field-shader";

export const cloudFragmentShader = /* glsl */ `
precision highp float;

uniform sampler2D depthTexture;

uniform float u_useManualSun;
uniform vec3 u_manualSunDirection;
uniform int u_stepCount;
uniform int u_selfShadowSteps;
uniform float u_selfShadowStrength;
uniform float u_multipleScattering;
uniform vec3 u_cameraPosition;
uniform vec3 u_cameraDirection;
uniform vec3 u_cameraRight;
uniform vec3 u_cameraUp;

in vec2 v_textureCoordinates;

${cloudFieldShader}

vec3 cloudSunDirection() {
  return normalize(mix(
    czm_sunDirectionWC,
    u_manualSunDirection,
    step(0.5, u_useManualSun)
  ));
}

vec3 reconstructEyeRay(vec2 uv) {
  vec2 ndc = uv * 2.0 - 1.0;
  vec4 eye = czm_inverseProjection * vec4(ndc, 0.0, 1.0);
  return normalize(eye.xyz / eye.w);
}

vec3 reconstructSceneEyePosition(vec2 uv, float rawDepth) {
  vec2 windowCoordinate = czm_viewport.xy + uv * czm_viewport.zw;
  vec4 eye = czm_windowToEyeCoordinates(windowCoordinate, rawDepth);
  return eye.xyz / eye.w;
}

vec3 eyeToWorld(vec3 eyePosition) {
  return u_cameraPosition +
    u_cameraRight * eyePosition.x +
    u_cameraUp * eyePosition.y -
    u_cameraDirection * eyePosition.z;
}

vec3 eyeDirectionToWorld(vec3 eyeDirection) {
  return normalize(
    u_cameraRight * eyeDirection.x +
    u_cameraUp * eyeDirection.y -
    u_cameraDirection * eyeDirection.z
  );
}

float henyeyGreenstein(float cosineTheta, float g) {
  float g2 = g * g;
  return (1.0 - g2) /
    (4.0 * czm_pi * pow(max(1.0 + g2 - 2.0 * g * cosineTheta, 0.001), 1.5));
}

vec3 compressCloudHighlights(vec3 color) {
  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  const float knee = 0.72;
  if (luminance <= knee) {
    return color;
  }
  float excess = luminance - knee;
  float compressedLuminance = knee + excess / (1.0 + excess * 2.2);
  return color * (compressedLuminance / max(luminance, 0.0001));
}

float warpRayRatio(float ratio) {
  return (exp2(clamp(ratio, 0.0, 1.0) * 3.0) - 1.0) / 7.0;
}

const float CLOUD_EXTINCTION_SCALE = 0.00034;
const int MAX_SELF_SHADOW_STEPS = 8;

float integrateSunOpticalDepth(
  vec3 position,
  vec3 sunDirection,
  float jitter
) {
  float segmentStart;
  float segmentEnd;
  vec3 rayOrigin = position + sunDirection * 4.0;
  if (!nearestCloudSegment(
    rayOrigin,
    sunDirection,
    segmentStart,
    segmentEnd
  )) {
    return 0.0;
  }

  float maximumDistance = max(12000.0, u_thickness * 2.0);
  float rayLength = min(max(segmentEnd, 0.0), maximumDistance);
  if (rayLength <= 1.0) {
    return 0.0;
  }

  float lightStepCount = float(max(u_selfShadowSteps, 1));
  float lightStepLength = rayLength / lightStepCount;
  float opticalDepth = 0.0;

  for (int lightStep = 0; lightStep < MAX_SELF_SHADOW_STEPS; lightStep++) {
    if (lightStep >= u_selfShadowSteps) {
      break;
    }
    float cellOffset = clamp(0.5 + jitter * 0.35, 0.2, 0.8);
    float distanceToSun =
      (float(lightStep) + cellOffset) * lightStepLength;
    float density = sampleCloudDensity(
      rayOrigin + sunDirection * distanceToSun
    );
    opticalDepth += density * lightStepLength * CLOUD_EXTINCTION_SCALE;
  }

  return opticalDepth;
}

void main(void) {
  float rawDepth = texture(depthTexture, v_textureCoordinates).r;
  bool hasSceneGeometry = rawDepth < 0.9999999;

  vec3 cameraPosition = u_cameraPosition;
  vec3 eyeRay = reconstructEyeRay(v_textureCoordinates);
  vec3 rayDirection = eyeDirectionToWorld(eyeRay);

  float sceneDistance = 1.0e12;
  if (hasSceneGeometry) {
    vec3 sceneEye = reconstructSceneEyePosition(v_textureCoordinates, rawDepth);
    vec3 scenePosition = eyeToWorld(sceneEye);
    vec3 toScene = scenePosition - cameraPosition;
    sceneDistance = max(dot(toScene, rayDirection), 0.0);
  }

  float segmentStart;
  float segmentEnd;
  if (!nearestCloudSegment(cameraPosition, rayDirection, segmentStart, segmentEnd)) {
    out_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  segmentEnd = min(segmentEnd, sceneDistance);
  if (segmentEnd <= segmentStart) {
    out_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  float segmentLength = min(segmentEnd - segmentStart, 220000.0);
  float stepCount = float(max(u_stepCount, 1));
  float jitter = hash31(vec3(gl_FragCoord.xy, 17.0)) - 0.5;
  float transmittance = 1.0;
  vec3 radiance = vec3(0.0);

  vec3 sunDirection = cloudSunDirection();
  float cameraAltitude = approximateAltitude(cameraPosition);
  float cloudTopAltitude = u_baseAltitude + u_thickness;
  float aerialLightingControl = smoothstep(
    cloudTopAltitude + 1500.0,
    cloudTopAltitude + 12000.0,
    cameraAltitude
  );
  float viewLightCosine = dot(-rayDirection, sunDirection);
  float groundForwardPhase = henyeyGreenstein(viewLightCosine, 0.58);
  float groundSilverLining = clamp(groundForwardPhase * 4.0, 0.0, 0.8);
  const float isotropicPhase = 0.07957747154594767;
  float aerialForwardPhase = henyeyGreenstein(viewLightCosine, 0.52);
  float phaseRatio = aerialForwardPhase / isotropicPhase;
  float aerialSilverLining = clamp((phaseRatio - 1.0) * 0.1, 0.0, 0.52);
  float silverLining = mix(
    groundSilverLining,
    aerialSilverLining,
    aerialLightingControl
  );
  vec3 sunColor = mix(
    vec3(1.08, 0.98, 0.82),
    vec3(1.0, 0.94, 0.82),
    aerialLightingControl
  );
  float directLightFloor = mix(0.5, 0.46, aerialLightingControl);
  vec3 skyColor = vec3(0.42, 0.58, 0.78);

  for (int i = 0; i < 72; i++) {
    if (
      i >= u_stepCount ||
      transmittance < 0.015
    ) {
      break;
    }

    float cellStartRatio = float(i) / stepCount;
    float cellEndRatio = (float(i) + 1.0) / stepCount;
    float warpedStart = warpRayRatio(cellStartRatio);
    float warpedEnd = warpRayRatio(cellEndRatio);
    float currentStep = segmentLength * (warpedEnd - warpedStart);
    float cellSample = 0.5 + jitter * 0.72;
    float distanceAlongRay = segmentStart + segmentLength * mix(
      warpedStart,
      warpedEnd,
      cellSample
    );
    vec3 position = cameraPosition + rayDirection * distanceAlongRay;
    float localDensity = sampleCloudDensity(position);
    if (localDensity > 0.002) {
      float sunOpticalDepth = integrateSunOpticalDepth(
        position,
        sunDirection,
        jitter
      );
      float lightTransmittance = exp(
        -sunOpticalDepth * u_selfShadowStrength
      );
      float heightFraction = clamp(
        (approximateAltitude(position) - u_baseAltitude) / u_thickness,
        0.0,
        1.0
      );
      vec3 ambient = skyColor * mix(0.34, 0.48, heightFraction);
      vec3 direct = sunColor * lightTransmittance *
        (directLightFloor + silverLining);
      float occludedLight = 1.0 - lightTransmittance;
      vec3 diffuseColor = mix(skyColor, sunColor, 0.28);
      vec3 multipleScattering = diffuseColor *
        (occludedLight * u_multipleScattering * 0.32);
      vec3 lighting = ambient + direct + multipleScattering;

      float opticalStep =
        localDensity * currentStep * CLOUD_EXTINCTION_SCALE;
      float alpha = 1.0 - exp(-opticalStep);
      radiance += transmittance * alpha * lighting;
      transmittance *= 1.0 - alpha;
    }
  }

  radiance = mix(
    radiance,
    compressCloudHighlights(radiance),
    mix(0.42, 1.0, aerialLightingControl)
  );
  out_FragColor = vec4(radiance, transmittance);
}
`;
