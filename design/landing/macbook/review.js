import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const canvas = document.querySelector("#scene");
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
  window.macbookReview = {
    loaded: !!model,
    draws: ++draws,
    triangles: renderer.info.render.triangles,
    drawCalls: renderer.info.render.calls,
    screen: !!model?.getObjectByName("HAC115_Screen"),
    hinge: hinge?.rotation.x ?? 0,
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
      map: display.material.emissiveMap ?? display.material.map,
      toneMapped: false,
    });
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
