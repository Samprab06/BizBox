import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { cssScreenTransform } from "./screen-transform.js";

const storyMode = !!document.querySelector("#story-journey");
const query = new URLSearchParams(location.search);
const textureOnly = query.has("texture");
const liveOnly = query.has("live");
const canvas = document.querySelector("#scene");
const surface = document.querySelector("#screen-surface");
const frame = document.querySelector("#product-screen");
const poster = document.querySelector("#screen-poster");
const sourceWidth = 1600,
  sourceHeight = 1036;
const clamp = (value) => Math.max(0, Math.min(1, value));
const smooth = (a, b, value) => {
  const t = clamp((value - a) / (b - a));
  return t * t * (3 - 2 * t);
};
let story = window.bizboxStory?.getState() ?? {
  progress: 0,
  entryMix: 0,
  fullscreen: false,
  reducedMotion: false,
};
let model,
  hinge,
  anchors = [],
  heroPose,
  alignedPose,
  posterReady = false;
let screenQuad = [],
  screenMatrix = null,
  draws = 0,
  pending = false;
function text(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
}
if (!storyMode)
  text(
    "#screen-description",
    textureOnly
      ? "Legacy texture inspection."
      : liveOnly
        ? "Actual live simulation."
        : "Simulation-style screen visual · GPT Image.",
  );
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.005, 10);
camera.position.set(storyMode ? 0.08 : 0.23, 0.32, 0.63);
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
});
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const generator = new THREE.PMREMGenerator(renderer),
  room = new RoomEnvironment();
scene.environment = generator.fromScene(room, 0.04).texture;
room.dispose();
generator.dispose();
scene.environmentIntensity = 0.65;
const light = new THREE.DirectionalLight(0xffffff, 2);
light.position.set(-0.3, 0.5, 0.7);
scene.add(light);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.115, -0.035);
controls.enableDamping = false;
controls.minDistance = 0.25;
controls.maxDistance = 4;
controls.enabled = !storyMode;
controls.update();
function fitModel() {
  if (!model) return;
  camera.clearViewOffset();
  const sphere = new THREE.Box3()
    .setFromObject(model)
    .getBoundingSphere(new THREE.Sphere());
  const vertical = THREE.MathUtils.degToRad(camera.fov);
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * camera.aspect);
  const distance =
    (sphere.radius / Math.sin(Math.min(vertical, horizontal) / 2)) * 1.08;
  const direction = storyMode
    ? new THREE.Vector3(0, 0.28, 0.96).normalize()
    : camera.position.clone().sub(controls.target).normalize();
  camera.position.copy(sphere.center).addScaledVector(direction, distance);
  camera.up.set(0, 1, 0);
  camera.lookAt(sphere.center);
  controls.target.copy(sphere.center);
  controls.update();
  heroPose = {
    position: camera.position.clone(),
    quaternion: camera.quaternion.clone(),
  };
  scene.updateMatrixWorld(true);
  const [tl, tr, , bl] = anchors.map((a) =>
    a.getWorldPosition(new THREE.Vector3()),
  );
  const center = tl
    .clone()
    .add(tr)
    .add(bl)
    .add(anchors[2].getWorldPosition(new THREE.Vector3()))
    .multiplyScalar(0.25);
  const right = tr.clone().sub(tl).normalize(),
    up = tl.clone().sub(bl).normalize();
  const normal = right.clone().cross(up).normalize();
  if (normal.dot(camera.position.clone().sub(center)) < 0) normal.negate();
  const cover =
    Math.min(
      tl.distanceTo(tr) / (2 * Math.tan(vertical / 2) * camera.aspect),
      tl.distanceTo(bl) / (2 * Math.tan(vertical / 2)),
    ) * 0.92;
  const aligned = new THREE.PerspectiveCamera(
    camera.fov,
    camera.aspect,
    0.005,
    10,
  );
  aligned.position.copy(center).addScaledVector(normal, cover);
  aligned.up.copy(up);
  aligned.lookAt(center);
  alignedPose = {
    position: aligned.position.clone(),
    quaternion: aligned.quaternion.clone(),
  };
}
function requestDraw() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(draw);
}
function draw() {
  pending = false;
  const entry = storyMode ? story.entryMix : 0;
  if (storyMode && heroPose && alignedPose) {
    camera.position.lerpVectors(heroPose.position, alignedPose.position, entry);
    camera.quaternion.slerpQuaternions(
      heroPose.quaternion,
      alignedPose.quaternion,
      entry,
    );
    const offset = (innerWidth < 700 ? 0.08 : 0.12) * (1 - entry);
    camera.setViewOffset(
      innerWidth,
      innerHeight,
      0,
      -innerHeight * offset,
      innerWidth,
      innerHeight,
    );
  }
  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  renderer.clear();
  if (!(storyMode && story.fullscreen)) renderer.render(scene, camera);
  const liveMix = textureOnly
    ? 0
    : liveOnly
      ? 1
      : storyMode
        ? story.returning || story.stage === "return"
          ? 1
          : smooth(0.8, 0.99, entry)
        : 0;
  if (anchors.length === 4 && !textureOnly) {
    const projected = anchors.map((a) =>
      a.getWorldPosition(new THREE.Vector3()).project(camera),
    );
    screenQuad = projected.map((p) => ({
      x: ((p.x + 1) * innerWidth) / 2,
      y: ((1 - p.y) * innerHeight) / 2,
    }));
    const fill = storyMode ? smooth(0.96, 1, entry) : 0;
    const rectangle = [
      { x: 0, y: 0 },
      { x: innerWidth, y: 0 },
      { x: innerWidth, y: innerHeight },
      { x: 0, y: innerHeight },
    ];
    screenQuad = screenQuad.map((p, i) => ({
      x: THREE.MathUtils.lerp(p.x, rectangle[i].x, fill),
      y: THREE.MathUtils.lerp(p.y, rectangle[i].y, fill),
    }));
    const width = storyMode && story.fullscreen ? innerWidth : sourceWidth;
    const height = storyMode && story.fullscreen ? innerHeight : sourceHeight;
    for (const element of [surface, frame, poster].filter(Boolean)) {
      element.style.width = `${width}px`;
      element.style.height = `${height}px`;
    }
    frame.style.transform = "none";
    screenMatrix = cssScreenTransform(screenQuad, width, height);
    const winding = screenQuad.reduce((sum, p, i) => {
      const q = screenQuad[(i + 1) % 4];
      return sum + p.x * q.y - q.x * p.y;
    }, 0);
    surface.hidden =
      !screenMatrix ||
      winding <= 0 ||
      projected.some((p) => p.z >= 1 || p.z <= -1);
    if (screenMatrix)
      surface.style.transform =
        storyMode && story.fullscreen
          ? "none"
          : `matrix3d(${screenMatrix.join(",")})`;
    surface.style.clipPath =
      storyMode && entry > 0.96
        ? "none"
        : "polygon(0 0,44.1% 0,44.7% 2.9%,55.3% 2.9%,55.9% 0,100% 0,100% 100%,0 100%)";
    if (poster) {
      poster.hidden = !posterReady || liveOnly || liveMix > 0.999;
      poster.style.opacity = String(1 - liveMix);
    }
    frame.style.opacity = String(liveMix);
    frame.style.pointerEvents = storyMode || liveMix < 1 ? "none" : "auto";
    frame.inert = storyMode || liveMix < 1;
    frame.setAttribute("aria-hidden", String(storyMode || liveMix < 1));
    if (!posterReady && !liveOnly && liveMix === 0) surface.hidden = true;
  } else surface.hidden = true;
  window.macbookReview = {
    loaded: !!model,
    draws: ++draws,
    triangles: renderer.info.render.triangles,
    drawCalls: renderer.info.render.calls,
    screen: !!model?.getObjectByName("HAC115_Screen"),
    hinge: hinge?.rotation.x ?? 0,
    screenMode: textureOnly
      ? "legacy-texture"
      : liveMix === 1
        ? "live-platform"
        : "gpt-poster",
    screenQuad,
    screenMatrix,
    progress: story.progress,
    entryMix: entry,
    fullscreen: !!(storyMode && story.fullscreen),
    posterReady,
    liveMix,
  };
}
function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight, false);
  fitModel();
  requestDraw();
}
controls.addEventListener("change", requestDraw);
addEventListener("resize", resize);
addEventListener("bizbox:story-progress", (event) => {
  story = event.detail;
  requestDraw();
});
document.querySelector("#lid")?.addEventListener("input", (event) => {
  if (hinge) hinge.rotation.x = Number(event.target.value);
  requestDraw();
});
if (poster && !textureOnly) {
  poster.addEventListener("load", () => {
    posterReady = true;
    requestDraw();
  });
  poster.src = "/assets/bizbox-simulation-screen-gpt-v2.png";
}
if (!textureOnly)
  fetch("/workspace-config.json")
    .then((response) => response.json())
    .then((config) => {
      const url = new URL(config.simulationUrl ?? config.workspaceUrl);
      if (!["http:", "https:"].includes(url.protocol))
        throw new Error("Invalid product URL");
      const open = document.querySelector("#open-workspace");
      if (open) open.href = url.href;
      const start = document.querySelector("#open-bizbox");
      if (start) start.href = config.productUrl ?? url.href;
      if (storyMode || liveOnly) {
        frame.src = url.href;
        frame.hidden = false;
      }
    })
    .catch(() => text("#scene-status", "Product screen unavailable."));
resize();
new GLTFLoader().load(
  `/assets/${innerWidth < 700 || query.has("mobile") ? "macbook-mobile.glb" : "macbook.glb"}`,
  (gltf) => {
    model = gltf.scene;
    hinge = model.getObjectByName("HAC115_LidPivot");
    const display = model.getObjectByName("HAC115_Screen");
    display.material = new THREE.MeshBasicMaterial({
      map: textureOnly
        ? (display.material.emissiveMap ?? display.material.map)
        : null,
      color: textureOnly ? 0xffffff : 0x101317,
      toneMapped: false,
    });
    anchors = ["TopLeft", "TopRight", "BottomRight", "BottomLeft"].map((name) =>
      model.getObjectByName(`HAC115_Screen${name}`),
    );
    scene.add(model);
    fitModel();
    text("#status", "MacBook preview");
    text("#scene-status", "");
    requestDraw();
  },
  undefined,
  (error) => {
    window.macbookReviewError = String(error);
    const message = document.querySelector("#error");
    if (message) {
      message.hidden = false;
      message.textContent = "The MacBook preview could not load.";
    }
  },
);
