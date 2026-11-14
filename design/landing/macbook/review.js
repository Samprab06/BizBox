import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { screenTransform } from "./screen-transform.js";

const canvas = document.querySelector("#scene");
const productFrame = document.querySelector("#product-screen");
const screenSurface = document.querySelector("#screen-surface");
const textureOnly = new URLSearchParams(location.search).has("texture");
const screenWidth = 1600;
const screenHeight = Math.round(screenWidth / 1.545103483121591);
// A power-of-two scale keeps the nested UI exact while avoiding tiny projective
// coefficients, which CSS serialization otherwise rounds enough to shift edges.
const surfaceScale = 1 / 16;
productFrame.style.width = `${screenWidth}px`;
productFrame.style.height = `${screenHeight}px`;
productFrame.style.transform = `scale(${surfaceScale})`;
screenSurface.style.width = `${screenWidth * surfaceScale}px`;
screenSurface.style.height = `${screenHeight * surfaceScale}px`;
let screenAnchors = [],
  screenQuad = [],
  screenMatrix = null;
if (textureOnly) {
  document.querySelector("#screen-description").textContent =
    "Legacy texture inspection · interim 2D capture retained.";
  document.querySelector("#open-workspace").hidden = true;
} else {
  fetch("/workspace-config.json")
    .then((response) => {
      if (!response.ok) throw new Error("Product screen config unavailable");
      return response.json();
    })
    .then(({ workspaceUrl }) => {
      const url = new URL(workspaceUrl);
      if (!["http:", "https:"].includes(url.protocol))
        throw new Error("Invalid product URL");
      productFrame.src = url.href;
      productFrame.hidden = false;
      document.querySelector("#open-workspace").href = url.href;
    })
    .catch(() => {
      document.querySelector("#screen-description").textContent =
        "Start the product app to load the live 3D screen.";
    });
}
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 10);
camera.position.set(0.23, 0.32, 0.63);
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
const pmrem = new THREE.PMREMGenerator(renderer);
const room = new RoomEnvironment();
scene.environment = pmrem.fromScene(room, 0.04).texture;
room.dispose();
pmrem.dispose();
scene.environmentIntensity = 0.65;
const light = new THREE.DirectionalLight(0xffffff, 2);
light.position.set(-0.3, 0.5, 0.7);
scene.add(light);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.115, -0.035);
controls.enableDamping = false;
controls.minDistance = 0.25;
controls.maxDistance = 4;
controls.update();
let model,
  hinge,
  draws = 0;
function fitModel() {
  if (!model) return;
  const sphere = new THREE.Box3()
    .setFromObject(model)
    .getBoundingSphere(new THREE.Sphere());
  const direction = camera.position.clone().sub(controls.target).normalize();
  const vertical = THREE.MathUtils.degToRad(camera.fov);
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * camera.aspect);
  const distance =
    (sphere.radius / Math.sin(Math.min(vertical, horizontal) / 2)) * 1.08;
  controls.target.copy(sphere.center);
  camera.position.copy(sphere.center).addScaledVector(direction, distance);
  controls.update();
}
function draw() {
  renderer.render(scene, camera);
  if (!textureOnly && screenAnchors.length === 4) {
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    const projected = screenAnchors.map((anchor) =>
      anchor.getWorldPosition(new THREE.Vector3()).project(camera),
    );
    screenQuad = projected.map((p) => ({
      x: ((p.x + 1) * innerWidth) / 2,
      y: ((1 - p.y) * innerHeight) / 2,
    }));
    screenMatrix = screenTransform(
      screenQuad,
      screenWidth * surfaceScale,
      screenHeight * surfaceScale,
    );
    const winding = screenQuad.reduce((area, p, i) => {
      const next = screenQuad[(i + 1) % 4];
      return area + p.x * next.y - next.x * p.y;
    }, 0);
    screenSurface.hidden =
      !screenMatrix ||
      winding <= 0 ||
      projected.some((p) => p.z >= 1 || p.z <= -1);
    if (screenMatrix)
      screenSurface.style.transform = `matrix3d(${screenMatrix.join(",")})`;
  }
  window.macbookReview = {
    loaded: !!model,
    draws: ++draws,
    triangles: renderer.info.render.triangles,
    drawCalls: renderer.info.render.calls,
    screen: !!model?.getObjectByName("HAC115_Screen"),
    hinge: hinge?.rotation.x ?? 0,
    screenMode: textureOnly ? "legacy-texture" : "live-platform",
    screenQuad,
    screenMatrix,
  };
}
function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight, false);
  fitModel();
  draw();
}
controls.addEventListener("change", draw);
addEventListener("resize", resize);
document.querySelector("#lid").addEventListener("input", (event) => {
  if (hinge) hinge.rotation.x = Number(event.target.value);
  draw();
});
resize();
const mobile =
  innerWidth < 700 || new URLSearchParams(location.search).has("mobile");
new GLTFLoader().load(
  `/assets/${mobile ? "macbook-mobile.glb" : "macbook.glb"}`,
  (gltf) => {
    model = gltf.scene;
    hinge = model.getObjectByName("HAC115_LidPivot");
    const display = model.getObjectByName("HAC115_Screen");
    display.material = new THREE.MeshBasicMaterial({
      map: textureOnly
        ? (display.material.emissiveMap ?? display.material.map)
        : null,
      color: textureOnly ? 0xffffff : 0x141819,
      toneMapped: false,
    });
    screenAnchors = ["TopLeft", "TopRight", "BottomRight", "BottomLeft"].map(
      (corner) => model.getObjectByName(`HAC115_Screen${corner}`),
    );
    scene.add(model);
    fitModel();
    document.querySelector("#status").textContent = mobile
      ? "Mobile geometry"
      : "Full geometry";
    draw();
  },
  undefined,
  (error) => {
    window.macbookReviewError = String(error);
    const message = document.querySelector("#error");
    message.hidden = false;
    message.textContent =
      "Model unavailable. See the console and asset handoff.";
    document.querySelector("#status").textContent = "Load failed";
  },
);
