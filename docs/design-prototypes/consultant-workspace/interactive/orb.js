/* Copyright (C) 2026 Goldie contributors. MIT; see LICENSE.
 * Shader adapted unchanged from components/voice/gradient-orb.tsx at
 * afce9ed11302b9db2c87693f64459debe7a35b16. Only the DOM/demo driver differs. */
const vertexShader = `attribute vec3 position; attribute vec2 uv;

  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;
const fragmentShader = `
  precision highp float;

  uniform float iTime;
  uniform float flowTime;
  uniform vec3 iResolution;
  uniform float hue;
  uniform float rot;
  uniform float noiseScale;
  uniform float innerRadius;
  uniform float audioLevel;
  uniform float ambientMotion;

  varying vec2 vUv;

  vec3 rgb2yiq(vec3 c) {
    return vec3(
      dot(c, vec3(0.299, 0.587, 0.114)),
      dot(c, vec3(0.596, -0.274, -0.322)),
      dot(c, vec3(0.211, -0.523, 0.312))
    );
  }

  vec3 yiq2rgb(vec3 c) {
    return vec3(
      c.x + 0.956 * c.y + 0.621 * c.z,
      c.x - 0.272 * c.y - 0.647 * c.z,
      c.x - 1.106 * c.y + 1.703 * c.z
    );
  }

  vec3 adjustHue(vec3 color, float hueDeg) {
    float hueRad = radians(hueDeg);
    vec3 yiq = rgb2yiq(color);
    float cosA = cos(hueRad);
    float sinA = sin(hueRad);
    yiq.yz = vec2(yiq.y * cosA - yiq.z * sinA, yiq.y * sinA + yiq.z * cosA);
    return yiq2rgb(yiq);
  }

  vec3 hash33(vec3 p3) {
    p3 = fract(p3 * vec3(0.1031, 0.11369, 0.13787));
    p3 += dot(p3, p3.yxz + 19.19);
    return -1.0 + 2.0 * fract(vec3(p3.x + p3.y, p3.x + p3.z, p3.y + p3.z) * p3.zyx);
  }

  float snoise3(vec3 p) {
    const float K1 = 0.333333333;
    const float K2 = 0.166666667;
    vec3 i = floor(p + (p.x + p.y + p.z) * K1);
    vec3 d0 = p - (i - (i.x + i.y + i.z) * K2);
    vec3 e = step(vec3(0.0), d0 - d0.yzx);
    vec3 i1 = e * (1.0 - e.zxy);
    vec3 i2 = 1.0 - e.zxy * (1.0 - e);
    vec3 d1 = d0 - (i1 - K2);
    vec3 d2 = d0 - (i2 - K1);
    vec3 d3 = d0 - 0.5;
    vec4 h = max(0.6 - vec4(dot(d0, d0), dot(d1, d1), dot(d2, d2), dot(d3, d3)), 0.0);
    vec4 n = h * h * h * h * vec4(
      dot(d0, hash33(i)),
      dot(d1, hash33(i + i1)),
      dot(d2, hash33(i + i2)),
      dot(d3, hash33(i + 1.0))
    );
    return dot(vec4(31.316), n);
  }

  vec4 extractAlpha(vec3 colorIn) {
    float a = max(max(colorIn.r, colorIn.g), colorIn.b);
    return vec4(colorIn.rgb / (a + 1e-5), a);
  }

  const vec3 baseColor0 = vec3(0.239, 0.353, 1.0);
  const vec3 baseColor1 = vec3(0.616, 0.0, 1.0);
  const vec3 baseColor2 = vec3(1.0, 0.373, 0.122);
  const vec3 baseColor3 = vec3(0.0);

  float light1(float intensity, float attenuation, float dist) {
    return intensity / (1.0 + dist * attenuation);
  }

  float light2(float intensity, float attenuation, float dist) {
    return intensity / (1.0 + dist * dist * attenuation);
  }

  vec4 draw(vec2 uv) {
    vec3 color0 = adjustHue(baseColor0, hue);
    vec3 color1 = adjustHue(baseColor1, hue);
    vec3 color2 = adjustHue(baseColor2, hue);
    vec3 color3 = adjustHue(baseColor3, hue);

    float len = length(uv);
    float invLen = len > 0.0 ? 1.0 / len : 0.0;
    float pulse = sin(iTime * 1.35) * 0.012 * ambientMotion;
    float energy = pow(audioLevel, 0.78);
    float reactiveScale = 1.0 + energy * 0.14;
    uv /= reactiveScale;
    len = length(uv);
    invLen = len > 0.0 ? 1.0 / len : 0.0;

    float noiseFlow = mix(iTime * 0.35, flowTime, 0.78);
    float n0 = snoise3(vec3(uv * (noiseScale + energy * 0.28), noiseFlow)) * 0.5 + 0.5;
    float deformation = (n0 - 0.5) * energy * 0.16;
    float r0 = mix(
      mix(innerRadius + pulse, 1.0, 0.4),
      mix(innerRadius + pulse, 1.0, 0.6),
      n0
    ) + deformation;

    float d0 = distance(uv, (r0 * invLen) * uv);
    float v0 = light1(1.0 + energy * 0.8, mix(10.0, 5.8, energy), d0);
    v0 *= (1.0 - smoothstep(r0, r0 * (1.05 + energy * 0.035), len));
    float cl = cos(atan(uv.y, uv.x) + flowTime * 1.7) * 0.5 + 0.5;

    float a = flowTime * -0.9;
    vec2 pos = vec2(cos(a), sin(a)) * r0;
    float d = distance(uv, pos);
    float v1 = light2(1.5 + energy * 1.1, 5.0, d);
    v1 *= light1(1.0, mix(50.0, 25.0, energy), d0);

    float v2 = (1.0 - smoothstep(mix(innerRadius, 1.0, n0 * 0.5), 1.0, len));
    float v3 = smoothstep(innerRadius, mix(innerRadius, 1.0, 0.5), len);

    vec3 col = mix(color1, color2, cl);
    col = mix(col, color0, n0);
    col = mix(color3, col, v0);
    col = (col + v1) * v2 * v3 * (1.0 + energy * 0.18);
    col = clamp(col, 0.0, 1.0);

    return extractAlpha(col);
  }

  void main() {
    vec2 center = iResolution.xy * 0.5;
    float size = min(iResolution.x, iResolution.y);
    vec2 uv = (vUv * iResolution.xy - center) / size * 2.0;

    float s = sin(rot);
    float c = cos(rot);
    uv = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y);

    vec4 col = draw(uv);
    gl_FragColor = vec4(col.rgb * col.a, col.a);
  }
`;

export function createVoiceOrb(canvas) {
  const wrap = canvas.parentElement;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let gl,
    program,
    raf = 0,
    phase = "idle",
    previous = 0,
    time = 0,
    flow = 0,
    rotation = 0;
  let visible = true,
    level = 0,
    disposed = false,
    failed = false;
  const buffers = [],
    shaders = [];
  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
    previous = 0;
  }
  function fallback() {
    failed = true;
    stop();
    wrap.classList.add("static");
    canvas.dataset.orbMode = "static";
  }
  try {
    gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
    });
    if (!gl) throw new Error("WebGL unavailable");
    function compile(type, source) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(shader));
      shaders.push(shader);
      return shader;
    }
    program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexShader));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentShader));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    for (const [name, values, size] of [
      ["position", [-1, -1, 0, 3, -1, 0, -1, 3, 0], 3],
      ["uv", [0, 0, 2, 0, 0, 2], 2],
    ]) {
      const buffer = gl.createBuffer();
      buffers.push(buffer);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), gl.STATIC_DRAW);
      const attr = gl.getAttribLocation(program, name);
      gl.enableVertexAttribArray(attr);
      gl.vertexAttribPointer(attr, size, gl.FLOAT, false, 0, 0);
    }
    gl.clearColor(0, 0, 0, 0);
  } catch {
    fallback();
    return { setState() {}, setVisible() {}, dispose() {} };
  }
  const uniforms = Object.fromEntries(
    [
      "iTime",
      "flowTime",
      "iResolution",
      "hue",
      "rot",
      "noiseScale",
      "innerRadius",
      "audioLevel",
      "ambientMotion",
    ].map((name) => [name, gl.getUniformLocation(program, name)]),
  );
  function draw(now) {
    raf = 0;
    if (disposed || failed || !visible || document.hidden) return;
    const moving = !reduced.matches && !["idle", "muted"].includes(phase);
    const dt = previous ? Math.min(0.05, (now - previous) / 1000) : 0.016;
    previous = now;
    if (moving) time += dt;
    let target = 0;
    if (phase === "listening")
      target =
        0.12 +
        0.34 * Math.pow(Math.sin(time * 3.2), 2) +
        0.1 * Math.sin(time * 9.3);
    if (phase === "speaking")
      target =
        0.24 +
        0.43 * Math.pow(Math.sin(time * 5.1), 2) +
        0.15 * Math.pow(Math.sin(time * 12.3), 2);
    if (phase === "thinking") target = 0.1 + 0.08 * Math.sin(time * 1.6);
    if (reduced.matches) target = 0;
    level += (target - level) * 0.13;
    if (moving) {
      flow += dt * (0.42 + level * 2.4);
      rotation += dt * 0.23 * (1 + level * 1.8);
    }
    const bounds = canvas.getBoundingClientRect(),
      dpr = Math.min(devicePixelRatio || 1, 1.5);
    const width = Math.max(1, Math.round(bounds.width * dpr)),
      height = Math.max(1, Math.round(bounds.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.useProgram(program);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(uniforms.iTime, time);
    gl.uniform1f(uniforms.flowTime, flow);
    gl.uniform3f(uniforms.iResolution, width, height, width / height);
    gl.uniform1f(uniforms.hue, 0);
    gl.uniform1f(uniforms.rot, rotation);
    gl.uniform1f(uniforms.noiseScale, 0.65);
    gl.uniform1f(uniforms.innerRadius, 0.1);
    gl.uniform1f(uniforms.audioLevel, level);
    gl.uniform1f(uniforms.ambientMotion, moving ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    canvas.dataset.orbMode = moving ? "reactive-demo" : "static";
    canvas.dataset.voicePhase = phase;
    if (moving) raf = requestAnimationFrame(draw);
  }
  function schedule() {
    stop();
    if (!failed && visible && !document.hidden)
      raf = requestAnimationFrame(draw);
  }
  const onVisibility = () => {
    if (document.hidden) stop();
    else schedule();
  };
  document.addEventListener("visibilitychange", onVisibility);
  reduced.addEventListener("change", schedule);
  const observer = new ResizeObserver(schedule);
  observer.observe(canvas);
  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    fallback();
  });
  schedule();
  return {
    setState(next) {
      phase = next;
      schedule();
    },
    setVisible(value) {
      visible = value;
      schedule();
    },
    dispose() {
      disposed = true;
      stop();
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      reduced.removeEventListener("change", schedule);
      buffers.forEach((b) => gl.deleteBuffer(b));
      shaders.forEach((s) => gl.deleteShader(s));
      gl.deleteProgram(program);
    },
  };
}
