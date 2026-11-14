export const cloudFieldShader = /* glsl */ `
uniform float u_time;
uniform float u_coverage;
uniform float u_density;
uniform float u_baseAltitude;
uniform float u_thickness;
uniform float u_cloudScale;
uniform float u_windOffset;
uniform float u_shapeEvolution;
uniform vec3 u_invEarthRadii;
uniform vec3 u_invInnerRadii;
uniform vec3 u_invOuterRadii;
uniform float u_meanEarthRadius;

float hash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float valueNoise(vec3 p) {
  vec3 cell = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);

  float n000 = hash31(cell + vec3(0.0, 0.0, 0.0));
  float n100 = hash31(cell + vec3(1.0, 0.0, 0.0));
  float n010 = hash31(cell + vec3(0.0, 1.0, 0.0));
  float n110 = hash31(cell + vec3(1.0, 1.0, 0.0));
  float n001 = hash31(cell + vec3(0.0, 0.0, 1.0));
  float n101 = hash31(cell + vec3(1.0, 0.0, 1.0));
  float n011 = hash31(cell + vec3(0.0, 1.0, 1.0));
  float n111 = hash31(cell + vec3(1.0, 1.0, 1.0));

  float nx00 = mix(n000, n100, f.x);
  float nx10 = mix(n010, n110, f.x);
  float nx01 = mix(n001, n101, f.x);
  float nx11 = mix(n011, n111, f.x);
  return mix(mix(nx00, nx10, f.y), mix(nx01, nx11, f.y), f.z);
}

float cloudEvolutionPhase() {
  return u_time * u_shapeEvolution * 0.04;
}

float cloudNoise(vec3 p, float evolution) {
  float first = valueNoise(
    p + vec3(0.11, -0.08, 0.09) * evolution
  );
  float second = valueNoise(
    p * 2.03 +
    vec3(13.1, 7.7, 19.3) +
    vec3(-0.21, 0.17, 0.13) * evolution
  );
  float third = valueNoise(
    p * 4.11 +
    vec3(3.8, 29.2, 11.7) +
    vec3(0.31, 0.23, -0.27) * evolution
  );
  return first * 0.57 + second * 0.29 + third * 0.14;
}

float approximateAltitude(vec3 worldPosition) {
  return (length(worldPosition * u_invEarthRadii) - 1.0) * u_meanEarthRadius;
}

float prepareCloudSample(
  vec3 worldPosition,
  out vec3 domain,
  out float shapedHeight
) {
  float heightFraction = (approximateAltitude(worldPosition) - u_baseAltitude) / u_thickness;
  if (heightFraction <= 0.0 || heightFraction >= 1.0) {
    domain = vec3(0.0);
    shapedHeight = 0.0;
    return 0.0;
  }

  vec3 scaledNormal = normalize(worldPosition * u_invEarthRadii);
  vec3 east = vec3(-scaledNormal.y, scaledNormal.x, 0.0);
  float eastLength = length(east);
  east = eastLength > 0.0001 ? east / eastLength : vec3(0.0, 1.0, 0.0);
  vec3 north = normalize(cross(scaledNormal, east));
  vec3 windDirection = normalize(east * 0.82 + north * 0.57);
  vec3 surfaceDomain = scaledNormal * u_cloudScale;
  surfaceDomain += windDirection * u_windOffset;

  float evolution = cloudEvolutionPhase();
  float weather = valueNoise(
    surfaceDomain * 0.38 +
    vec3(17.0, 31.0, 11.0) +
    vec3(0.031, 0.019, -0.023) * evolution
  );
  float localBottom = mix(0.02, 0.14, 1.0 - weather);
  float localTop = mix(0.64, 1.0, smoothstep(0.22, 0.82, weather));
  if (heightFraction <= localBottom || heightFraction >= localTop) {
    domain = vec3(0.0);
    shapedHeight = heightFraction <= localBottom ? 0.0 : 1.0;
    return 0.0;
  }

  shapedHeight = (heightFraction - localBottom) / (localTop - localBottom);
  domain = surfaceDomain + scaledNormal * (heightFraction * 1.2);
  float vertical = smoothstep(0.0, 0.13, shapedHeight);
  vertical *= 1.0 - smoothstep(0.72, 1.0, shapedHeight);
  return vertical;
}

float sampleCloudDensity(vec3 worldPosition) {
  vec3 domain;
  float shapedHeight;
  float vertical = prepareCloudSample(worldPosition, domain, shapedHeight);
  if (vertical <= 0.0) {
    return 0.0;
  }

  float anvil = mix(0.94, 1.04, smoothstep(0.35, 0.82, shapedHeight));
  float evolution = cloudEvolutionPhase();
  float noiseValue = cloudNoise(domain, evolution);
  float threshold = mix(0.78, 0.34, u_coverage) / anvil;
  float body = smoothstep(threshold, threshold + 0.17, noiseValue);
  float erosion = valueNoise(
    domain * 7.7 +
    41.0 +
    vec3(0.43, -0.31, 0.37) * evolution
  );
  body = clamp(body - (1.0 - erosion) * 0.16 * (1.0 - body), 0.0, 1.0);
  return body * vertical * u_density;
}

vec2 intersectEllipsoid(vec3 rayOrigin, vec3 rayDirection, vec3 inverseRadii) {
  vec3 origin = rayOrigin * inverseRadii;
  vec3 scaledDirection = rayDirection * inverseRadii;
  float directionScale = length(scaledDirection);
  if (directionScale <= 1.0e-12) {
    return vec2(1.0, -1.0);
  }
  vec3 direction = scaledDirection / directionScale;
  float b = 2.0 * dot(origin, direction);
  float c = dot(origin, origin) - 1.0;
  float discriminant = b * b - 4.0 * c;
  if (discriminant < 0.0) {
    return vec2(1.0, -1.0);
  }
  float root = sqrt(discriminant);
  return vec2((-b - root) * 0.5, (-b + root) * 0.5) / directionScale;
}

bool nearestCloudSegment(
  vec3 rayOrigin,
  vec3 rayDirection,
  out float segmentStart,
  out float segmentEnd
) {
  vec2 outerHit = intersectEllipsoid(rayOrigin, rayDirection, u_invOuterRadii);
  if (outerHit.y <= 0.0 || outerHit.x > outerHit.y) {
    return false;
  }

  segmentStart = max(outerHit.x, 0.0);
  segmentEnd = outerHit.y;

  vec2 innerHit = intersectEllipsoid(rayOrigin, rayDirection, u_invInnerRadii);
  bool hasInnerHit = innerHit.y >= innerHit.x && innerHit.y > 0.0;
  bool insideInner = length(rayOrigin * u_invInnerRadii) < 1.0;
  if (insideInner && hasInnerHit) {
    segmentStart = max(segmentStart, innerHit.y);
  } else if (
    hasInnerHit &&
    innerHit.x > segmentStart &&
    innerHit.x < segmentEnd
  ) {
    segmentEnd = innerHit.x;
  }

  return segmentEnd > segmentStart;
}
`;
