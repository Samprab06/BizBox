import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export function createScene(host, onSelect) {
  const fallback = host.querySelector("#scene-fallback");
  const pinHost = document.querySelector("#map-pins");
  let renderer,
    renderFailed = false;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  } catch {
    fallback.hidden = false;
    return {
      update() {},
      resize() {},
      zoom() {},
      reset() {},
      dispose() {},
      get mode() {
        return "fallback";
      },
    };
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.setClearColor("#aaa6ad");
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.22;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.prepend(renderer.domElement);
  renderer.domElement.setAttribute(
    "aria-label",
    "Illustrative 3D neighborhood and modeled interior",
  );
  renderer.domElement.setAttribute("role", "img");
  const world = new THREE.Scene();
  world.fog = new THREE.Fog("#aaa6ad", 160, 360);
  const camera = new THREE.PerspectiveCamera(33, 1, 0.1, 600);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  controls.enablePan = true;
  controls.maxPolarAngle = Math.PI / 2.25;
  controls.minPolarAngle = 0.12;
  controls.minDistance = 20;
  controls.maxDistance = 245;
  controls.enableZoom = true;
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN,
  };
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  const ambient = new THREE.HemisphereLight("#d5ddfa", "#75665e", 2.3);
  world.add(ambient);
  const sun = new THREE.DirectionalLight("#ffcfaa", 4.2);
  sun.position.set(-75, 110, 50);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -130;
  sun.shadow.camera.right = 130;
  sun.shadow.camera.top = 130;
  sun.shadow.camera.bottom = -130;
  sun.shadow.normalBias = 0.08;
  sun.shadow.bias = -0.00015;
  world.add(sun);
  const city = new THREE.Group(),
    room = new THREE.Group();
  world.add(city, room);
  room.visible = false;
  const material = (color, roughness = 0.85) =>
    new THREE.MeshStandardMaterial({ color, roughness });
  const mats = {
    road: material("#666d79"),
    sidewalk: material("#b8afa7"),
    ground: material("#b9a992"),
    stone: material("#b4a69a"),
    roof: material("#a39387"),
    dark: material("#464953"),
    glass: material("#555565", 0.35),
    wood: material("#b79170"),
    floor: material("#ae957e"),
    wall: material("#b4a89f"),
    counter: material("#6f615c"),
    metal: material("#626875"),
    leaf: material("#897f68"),
    trunk: material("#8e7561"),
    blue: material("#9fafff"),
  };
  const windowMat = new THREE.MeshStandardMaterial({
    color: "#edd4af",
    emissive: "#d59b68",
    emissiveIntensity: 0.48,
    roughness: 0.5,
  });
  function box(w, h, d, mat, x, y, z, parent = city) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y + h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  box(400, 0.5, 400, mats.ground, 0, -1, 0);
  for (let i = -3; i <= 3; i++) {
    const pos = i * 42;
    box(400, 0.05, 9, mats.road, 0, -0.42, pos);
    box(9, 0.05, 400, mats.road, pos, -0.42, 0);
    box(400, 0.05, 2, mats.sidewalk, 0, -0.34, pos - 5.5);
    box(400, 0.05, 2, mats.sidewalk, 0, -0.34, pos + 5.5);
    box(2, 0.05, 400, mats.sidewalk, pos - 5.5, -0.34, 0);
    box(2, 0.05, 400, mats.sidewalk, pos + 5.5, -0.34, 0);
  }
  let seed = 3419;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let ix = -3; ix < 3; ix++)
    for (let iz = -3; iz < 3; iz++) {
      const cx = ix * 42 + 21,
        cz = iz * 42 + 21;
      for (let j = 0; j < 4; j++) {
        const x = cx + (j % 2 ? 8 : -8),
          z = cz + (j > 1 ? 8 : -8);
        const h = 5 + random() * 10,
          w = 10 + random() * 4,
          d = 10 + random() * 4;
        if (
          [
            [-20, 21],
            [22, -20],
            [63, 22],
          ].some(([a, b]) => Math.abs(x - a) < 19 && Math.abs(z - b) < 15)
        )
          continue;
        const mat = material(
          ["#c7b5a3", "#b5b1aa", "#a9998d", "#c6bbb0", "#a39e9b"][
            Math.floor(random() * 5)
          ],
        );
        box(w, h, d, mat, x, 0, z);
        box(w + 0.3, 0.45, d + 0.3, mats.roof, x, h, z);
        box(w * 0.34, 0.8, d * 0.2, mats.dark, x + 1, h + 0.45, z - 1);
        for (let k = 0; k < 3; k++) {
          box(
            0.95,
            2,
            0.07,
            random() > 0.35 ? windowMat : mats.glass,
            x - w * 0.3 + k * w * 0.3,
            1.5,
            z + d / 2 + 0.04,
          );
        }
      }
    }
  // Three fictional candidate spaces anchor the local illustrative geography.
  const candidates = {
    A: { x: -20, z: 21 },
    B: { x: 22, z: -20 },
    C: { x: 63, z: 22 },
  };
  const candidateMeshes = {};
  for (const [id, p] of Object.entries(candidates)) {
    box(20, 5.5, 13, mats.stone, p.x, 0, p.z);
    box(20.5, 0.45, 13.5, mats.roof, p.x, 5.5, p.z);
    box(18, 3, 0.13, mats.glass, p.x, 0.3, p.z + 6.56);
    box(18, 0.25, 1.4, mats.dark, p.x, 3.4, p.z + 7);
    for (let i = 0; i < 6; i++)
      box(1.5, 2.6, 0.15, windowMat, p.x - 7.5 + i * 3, 0.5, p.z + 6.65);
    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(20.5, 6.1, 13.6)),
      new THREE.LineBasicMaterial({ color: "#b0c0ff" }),
    );
    outline.position.set(p.x, 3, p.z);
    city.add(outline);
    candidateMeshes[id] = outline;
    const button = document.createElement("button");
    button.className = "map-pin";
    button.dataset.site = id;
    button.setAttribute("aria-label", "Select Space " + id);
    button.innerHTML = `<span class="pin-caption">Space ${id}</span><span class="pin-dot"><b>${id}</b></span>`;
    pinHost.append(button);
  }
  for (let i = 0; i < 46; i++) {
    const x = (random() - 0.5) * 240,
      z = (random() - 0.5) * 240;
    if (Math.abs(x % 42) < 8 || Math.abs(z % 42) < 8) continue;
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.25, 5, 6),
      mats.trunk,
    );
    trunk.position.set(x, 2.5, z);
    city.add(trunk);
    const crown = new THREE.Mesh(
      new THREE.SphereGeometry(2.1, 6, 4),
      mats.leaf,
    );
    crown.scale.set(1, 0.5, 1);
    crown.position.set(x, 5.8, z);
    crown.castShadow = true;
    city.add(crown);
  }
  // Intentionally modeled floorplan: no claim of a matched Matterport scan.
  box(24, 0.4, 20, mats.floor, 0, -0.4, 0, room);
  box(24, 5, 0.35, mats.wall, 0, 0, -10, room);
  box(0.35, 4.4, 20, mats.wall, -12, 0, 0, room);
  box(0.35, 4.4, 20, mats.wall, 12, 0, 0, room);
  box(24, 0.3, 0.35, mats.wall, 0, 0, 10, room);
  box(20, 2.5, 2.3, mats.wood, 0, 0, -5, room);
  box(20.3, 0.25, 2.5, mats.counter, 0, 2.5, -5, room);
  box(20, 2.1, 1.8, mats.counter, 0, 0, -8.3, room);
  box(20.3, 0.15, 2, mats.wood, 0, 2.1, -8.3, room);
  const stations = [];
  for (let i = 0; i < 5; i++) {
    const group = new THREE.Group();
    group.position.x = -7 + i * 3.5;
    room.add(group);
    box(1.25, 0.8, 0.8, mats.metal, 0, 2.76, -5, group);
    box(1.1, 0.12, 0.8, mats.dark, 0, 3.56, -5, group);
    box(0.45, 0.4, 0.45, mats.dark, 0.8, 2.76, -4.9, group);
    stations.push(group);
  }
  const tablePositions = [
    [-8, 4],
    [8, 3],
    [-7, 8],
    [7, 8],
  ];
  for (const [x, z] of tablePositions) {
    const table = new THREE.Mesh(
      new THREE.CylinderGeometry(1.6, 1.6, 0.22, 24),
      mats.wood,
    );
    table.position.set(x, 1.5, z);
    table.castShadow = true;
    room.add(table);
    box(0.3, 1.5, 0.3, mats.dark, x, 0, z, room);
    for (const side of [-1, 1]) {
      box(1.3, 0.22, 1.2, mats.wood, x + side * 2, 1, z, room);
      box(0.2, 1.2, 0.2, mats.dark, x + side * 2, 0, z, room);
      box(0.16, 1.4, 1.3, mats.wood, x + side * 2.5, 1, z, room);
    }
  }
  const queueGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-2, 0.09, 8),
    new THREE.Vector3(-2, 0.09, 1),
    new THREE.Vector3(4, 0.09, 1),
    new THREE.Vector3(4, 0.09, -3),
  ]);
  const queue = new THREE.Line(
    queueGeometry,
    new THREE.LineDashedMaterial({
      color: "#b8c6fa",
      dashSize: 0.55,
      gapSize: 0.4,
    }),
  );
  queue.computeLineDistances();
  room.add(queue);
  const customers = [];
  for (let i = 0; i < 12; i++) {
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.28, 0.6, 3, 7),
      material(i === 0 ? "#b4c6ff" : "#b4b6c4"),
    );
    body.castShadow = true;
    room.add(body);
    customers.push(body);
  }
  const labelPositions = [
    ["Entrance", 0, 0, 10],
    ["Queue", 0, 0.2, 2],
    ["Station 1", -7, 4, -5],
    ["Station 2", -3.5, 4, -5],
    ["Station 3", 0, 4, -5],
    ["Station 4", 3.5, 4, -5],
    ["Station 5", 7, 4, -5],
  ];
  const labelNodes = labelPositions.map(([name]) => {
    const el = document.createElement("span");
    el.className = "room-label" + (name === "Entrance" ? " entrance" : "");
    el.textContent = name;
    pinHost.append(el);
    return el;
  });
  let state = {
    view: "city",
    site: "A",
    stations: 2,
    minute: 0,
    playing: false,
    stage: 0,
  };
  let dragging = false;
  controls.addEventListener("start", () => {
    dragging = true;
  });
  controls.addEventListener("end", () => {
    dragging = false;
  });
  const ray = new THREE.Raycaster(),
    pointer = new THREE.Vector2();
  renderer.domElement.addEventListener("click", (event) => {
    if (dragging || state.view !== "city") return;
    const b = renderer.domElement.getBoundingClientRect();
    pointer.set(
      ((event.clientX - b.left) / b.width) * 2 - 1,
      (-(event.clientY - b.top) / b.height) * 2 + 1,
    );
    ray.setFromCamera(pointer, camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
      point = new THREE.Vector3();
    if (ray.ray.intersectPlane(plane, point)) {
      let nearest = null,
        d = 16;
      for (const [id, p] of Object.entries(candidates)) {
        const dist = Math.hypot(point.x - p.x, point.z - p.z);
        if (dist < d) {
          d = dist;
          nearest = id;
        }
      }
      if (nearest) onSelect(nearest);
    }
  });
  function project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(camera);
    return [
      (v.x * 0.5 + 0.5) * host.clientWidth,
      (-v.y * 0.5 + 0.5) * host.clientHeight,
      v.z,
    ];
  }
  function render() {
    if (document.hidden || renderFailed) return;
    renderer.render(world, camera);
    for (const [id, p] of Object.entries(candidates)) {
      const el = pinHost.querySelector(`[data-site="${id}"]`),
        [x, y, z] = project(p.x, 8, p.z);
      el.style.left = x + "px";
      el.style.top = y + "px";
      el.hidden =
        state.view !== "city" ||
        z > 1 ||
        x < 0 ||
        x > host.clientWidth ||
        y < 40 ||
        y > host.clientHeight;
      el.setAttribute("aria-pressed", String(state.site === id));
      el.querySelector(".pin-caption").hidden = state.site !== id;
    }
    labelPositions.forEach((p, i) => {
      const [x, y] = project(p[1], p[2], p[3]);
      labelNodes[i].style.left = x + "px";
      labelNodes[i].style.top = y + "px";
      labelNodes[i].hidden =
        state.view !== "interior" || (i > 1 && i - 2 >= state.stations);
    });
  }
  controls.addEventListener("change", render);
  function reset() {
    if (state.view === "city") {
      const p = candidates[state.site];
      if (state.stage === 0) {
        camera.position.set(135, 150, 175);
        controls.target.set(15, 0, 5);
      } else {
        camera.position.set(p.x + 65, 65, p.z + 78);
        controls.target.set(p.x, 0, p.z);
      }
    } else {
      camera.position.set(26, 35, 38);
      controls.target.set(0, 0, 0);
    }
    controls.update();
    render();
  }
  function resize() {
    const w = Math.max(1, host.clientWidth),
      h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    render();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  renderer.domElement.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    renderFailed = true;
    fallback.hidden = false;
    renderer.domElement.hidden = true;
    pinHost.hidden = true;
  });
  const restore = () => render();
  document.addEventListener("visibilitychange", restore);
  resize();
  reset();
  return {
    update(next) {
      const changedView = state.view !== next.view,
        changedSite = state.site !== next.site,
        changedStage = state.stage !== next.stage;
      state = { ...state, ...next };
      city.visible = state.view === "city";
      room.visible = state.view === "interior";
      world.fog =
        state.view === "city" ? new THREE.Fog("#aaa6ad", 160, 360) : null;
      renderer.setClearColor(state.view === "city" ? "#aaa6ad" : "#646675");
      Object.entries(candidateMeshes).forEach(
        ([id, m]) => (m.visible = id === state.site),
      );
      stations.forEach((m, i) => (m.visible = i < state.stations));
      customers.forEach((m, i) => {
        m.visible =
          state.minute > 0 &&
          i < Math.min(10, Math.floor(state.minute / 5) + 2);
        const progress = ((state.minute * 0.13 + i * 0.82) % 9) / 9;
        m.position.set(
          i < state.stations ? -7 + i * 3.5 : -2 + (i % 2) * 0.7,
          1,
          i < state.stations ? -3.2 : 6 - progress * 6,
        );
      });
      if (changedView || changedSite || changedStage) reset();
      render();
    },
    resize,
    reset,
    zoom(direction) {
      const offset = camera.position.clone().sub(controls.target);
      offset.multiplyScalar(direction > 0 ? 0.85 : 1.15);
      camera.position.copy(controls.target).add(offset);
      controls.update();
      render();
    },
    dispose() {
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      document.removeEventListener("visibilitychange", restore);
      world.traverse((o) => {
        o.geometry?.dispose();
        if (o.material) {
          for (const m of Array.isArray(o.material) ? o.material : [o.material])
            m.dispose();
        }
      });
    },
    get mode() {
      return renderFailed ? "fallback" : "webgl";
    },
  };
}
