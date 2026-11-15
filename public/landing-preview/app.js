const $ = (id) => document.getElementById(id);
const assetURL = (name) => new URL(`./assets/${name}`, import.meta.url).href;
const canvas = $('scene');
const copy = $('story-copy');
const title = $('story-title');
const shell = $('product-shell');
const productWindow = $('product-window');
const appFrame = $('app-frame');
const tourFrame = $('tour-frame');
const poster = $('screen-poster');
const loading = $('frame-loading');
const empty = $('frame-empty');
const controls = $('surface-controls');
const explore = $('explore-control');
const source = $('tour-source');
const finish = $('finish');
const status = $('scene-status');
const steps = [...document.querySelectorAll('[data-step]')];
const chapters = [...document.querySelectorAll('.chapter')];
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const headlines = [
  'Test business decisions before committing.',
  'Find a location.',
  'Walk through the space.',
  'See a business day unfold.',
  'Add a counter. Compare results.',
  'Test your next decision.'
];
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
let config = {}, THREE, renderer, camera, scene, backgroundScene, backgroundCamera, backgroundMaterial;
let laptop, screen, displayCorners, heroCamera, alignedCamera, screenCenter, screenNormal, screenUp;
let textures = [], modelLoaded = false, framePending = false, renderCount = 0, stage = -1, contentMode = 'laptop';
let activeFrame = null, activeURL = '', exploring = false, pagePosition = 0, disposed = false;
let heroPose, projectedScreen = null, cameraCoverDistance = 1, screenWorldWidth = 1, screenWorldHeight = 1;
let measuredTitleKey = '', measuredTitleBottom = 0;
let initializationComplete = false;
let headlineAnimation = null, revealedStage = 0, navigationIntent = null;

window.bizboxReady = false;
window.bizboxState = { progress: 0, stage: 0, modelLoaded: false, contentMode: 'laptop', renderCount: 0 };

function createRimMap() {
  // One static vector field. Only pane rims sample it; text never enters the filter.
  try {
    const map = document.createElement('canvas'); map.width = 128; map.height = 64;
    const context = map.getContext('2d');
    if (!context) return;
    const pixels = context.createImageData(map.width, map.height);
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
      const horizontal = x < map.width / 2 ? x : map.width - 1 - x;
      const vertical = y < map.height / 2 ? y : map.height - 1 - y;
      const edge = Math.min(horizontal, vertical);
      const strength = Math.pow(clamp(1 - edge / 9), 2);
      const index = (y * map.width + x) * 4;
      pixels.data[index] = 128 + (horizontal <= vertical ? (x < map.width / 2 ? 70 : -70) * strength : 0);
      pixels.data[index + 1] = 128 + (vertical <= horizontal ? (y < map.height / 2 ? 70 : -70) * strength : 0);
      pixels.data[index + 2] = 128; pixels.data[index + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    $('glass-displacement').setAttribute('href', map.toDataURL('image/png'));
    document.documentElement.classList.add('has-refraction');
  } catch { /* Existing glass remains a complete blur-only fallback. */ }
}

function selectProgress(index) {
  steps.forEach((a, i) => i === index ? a.setAttribute('aria-current', 'step') : a.removeAttribute('aria-current'));
  const selected = steps[index];
  document.querySelector('.progress-nav').style.setProperty('--selection-x', `${selected.offsetLeft + (selected.offsetWidth - 30) / 2}px`);
}

function selectIntent(index) {
  navigationIntent = { index, expires: performance.now() + 1800 };
  selectProgress(index);
}

steps.forEach((link, index) => link.addEventListener('click', () => selectIntent(index)));
const cancelIntent = () => { navigationIntent = null; requestDraw(); };
addEventListener('wheel', cancelIntent, { passive: true });
addEventListener('touchstart', cancelIntent, { passive: true });
document.addEventListener('pointerdown', (event) => { if (!event.target.closest('.progress-nav')) cancelIntent(); }, { passive: true });

function revealHeadline() {
  headlineAnimation?.cancel();
  headlineAnimation = null;
  if (reduced.matches || !title.animate) return;
  headlineAnimation = title.animate([
    { transform: 'translateY(8px)', opacity: 0, clipPath: 'inset(12% 0 0 0)' },
    { transform: 'translateY(0)', opacity: 1, clipPath: 'inset(0 0 0 0)' }
  ], { duration: 200, easing: 'cubic-bezier(.16,1,.3,1)' });
}

function verifiedURL(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try { const url = new URL(value, location.href); return /^(https?:)$/.test(url.protocol) ? url.href : ''; }
  catch { return ''; }
}

function setExploring(value) {
  exploring = value && !!activeURL;
  productWindow.classList.toggle('is-exploring', exploring);
  explore.setAttribute('aria-pressed', String(exploring));
  explore.innerHTML = `${exploring ? 'Return to scrolling' : contentMode === 'tour' ? 'Explore space' : 'Explore demo'} <span aria-hidden="true">${exploring ? '↓' : '↗'}</span>`;
  if (activeFrame) activeFrame.tabIndex = exploring ? 0 : -1;
}

explore.addEventListener('click', () => setExploring(!exploring));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { setExploring(false); return; }
  if (event.altKey || event.metaKey || event.ctrlKey || /^(INPUT|TEXTAREA|SELECT|IFRAME)$/.test(event.target.tagName)) return;
  if (event.target !== document.body && event.target !== document.documentElement && !event.target.closest('.progress-nav')) return;
  const current = Math.round(pagePosition);
  const next = event.key === 'ArrowDown' || event.key === 'PageDown' ? current + 1
    : event.key === 'ArrowUp' || event.key === 'PageUp' ? current - 1
    : event.key === 'Home' ? 0 : event.key === 'End' ? 5 : null;
  if (next === null) return;
  event.preventDefault();
  const index = clamp(next, 0, 5);
  selectIntent(index);
  chapters[index].scrollIntoView({ behavior: reduced.matches ? 'instant' : 'smooth' });
});
document.querySelectorAll('.demo-link').forEach((link) => link.addEventListener('click', (event) => {
  if (link.getAttribute('aria-disabled') === 'true') event.preventDefault();
}));

function unloadFrame(frame) {
  frame.hidden = true;
  frame.tabIndex = -1;
  frame.classList.remove('is-loaded');
  if (frame.hasAttribute('src')) frame.removeAttribute('src');
}

function showContent(mode, visible) {
  const url = mode === 'tour' ? config.MATTERPORT_URL : mode === 'location' ? config.PRODUCT_PREVIEW_URL : config.DEMO_URL;
  const frame = mode === 'tour' ? tourFrame : appFrame;
  if (contentMode === mode && activeURL === url && (activeFrame !== null) === visible) return;
  setExploring(false);
  contentMode = mode;
  if (!visible) {
    unloadFrame(appFrame); unloadFrame(tourFrame);
    activeFrame = null; activeURL = ''; controls.hidden = true;
    return;
  }
  // A single surface is reused. The real tour is never captured into a texture.
  unloadFrame(frame === tourFrame ? appFrame : tourFrame);
  activeFrame = frame;
  activeURL = url || '';
  controls.hidden = !url;
  source.hidden = mode !== 'tour' || !url;
  poster.hidden = mode === 'tour';
  empty.hidden = !!url;
  loading.hidden = !url;
  productWindow.setAttribute('aria-label', mode === 'tour' ? 'Matterport demo: The Coffee Port' : mode === 'location' ? 'BizBox location preview' : 'BizBox interactive demo');
  setExploring(false);
  if (url) {
    if (frame.getAttribute('src') !== url) {
      frame.classList.remove('is-loaded');
      frame.src = url;
    } else loading.hidden = frame.classList.contains('is-loaded');
    frame.hidden = false;
  } else unloadFrame(frame);
}

for (const frame of [appFrame, tourFrame]) {
  frame.addEventListener('load', () => {
    if (frame !== activeFrame || !frame.hasAttribute('src')) return;
    frame.classList.add('is-loaded');
    loading.hidden = true;
  });
  frame.addEventListener('error', () => {
    if (frame !== activeFrame) return;
    loading.hidden = true; empty.hidden = false;
  });
}

function desiredSurface() {
  const mobile = innerWidth <= 600, tablet = innerWidth <= 900;
  let width = mobile ? innerWidth * .94 : tablet ? innerWidth * .86 : Math.min(innerWidth * .76, innerWidth >= 1800 ? 1120 : 900);
  let centerY = innerHeight * (mobile ? .58 : tablet ? .55 : .54);
  if (innerHeight <= 650 && innerWidth > 600) { width = Math.min(630, innerWidth * .67); centerY = innerHeight * .58; }
  // Reserve the same clearance for every middle-stage title, including wrapped copy.
  // Measure once per viewport so the product does not shift when the headline changes.
  const key = `${innerWidth}x${innerHeight}`;
  if (measuredTitleKey !== key) {
    const probe = copy.cloneNode(true);
    probe.removeAttribute('id'); probe.className = 'story-copy';
    probe.style.cssText = 'visibility:hidden;pointer-events:none;opacity:0';
    probe.setAttribute('aria-hidden', 'true');
    const heading = probe.querySelector('h1'); heading.removeAttribute('id');
    document.body.append(probe);
    measuredTitleBottom = Math.max(...headlines.slice(1, 5).map((text) => { heading.textContent = text; return heading.getBoundingClientRect().bottom; }));
    probe.remove(); measuredTitleKey = key;
  }
  const topLimit = measuredTitleBottom + (mobile ? 38 : 40);
  const bottomLimit = innerHeight - (mobile ? 150 : 140);
  width = Math.min(width, Math.max(160, (bottomLimit - topLimit) * 16 / 9));
  const height = width * 9 / 16;
  centerY = Math.max(centerY, topLimit + height / 2);
  return { left: (innerWidth - width) / 2, top: centerY - height / 2, width, height };
}

function drawUI(x) {
  const nextStage = clamp(Math.round(x), 0, 5);
  if (stage !== nextStage) {
    headlineAnimation?.cancel();
    stage = nextStage;
    title.textContent = headlines[stage];
    status.textContent = headlines[stage];
    copy.className = `story-copy${stage === 0 ? ' is-opening' : stage === 5 ? ' is-final' : ''}`;
    setExploring(false);
  }
  if (navigationIntent && (Math.abs(x - navigationIntent.index) < .035 || performance.now() > navigationIntent.expires)) navigationIntent = null;
  selectProgress(navigationIntent?.index ?? stage);
  let opacity = 1;
  if (x < .96) opacity = x < .5 ? 1 - smooth(.09, .32, x) : smooth(.78, .98, x);
  copy.style.opacity = String(opacity);
  if (revealedStage !== stage && opacity > .05) { revealHeadline(); revealedStage = stage; }
  const visible = x > .56 && x < 4.5;
  const mode = !visible ? x >= 4.5 ? 'final' : 'laptop' : x < 1.5 ? 'location' : x < 2.5 ? 'tour' : 'demo';
  shell.hidden = !visible;
  showContent(mode, visible);
  // The screenshot only bridges the physical display handoff; settled stages show live content.
  poster.hidden = mode === 'tour' || x >= .98;
  const target = desiredSurface();
  const settle = reduced.matches ? 1 : smooth(.67, .99, x);
  const from = projectedScreen || target;
  const rect = x < 1 && !reduced.matches ? {
    left: mix(from.left, target.left, settle), top: mix(from.top, target.top, settle),
    width: mix(from.width, target.width, settle), height: mix(from.height, target.height, settle)
  } : target;
  const surfaceRadius = mix(0, innerWidth <= 600 ? 12 : 17, settle);
  const surfaceInset = mix(0, innerWidth <= 600 ? 3 : 5, settle);
  productWindow.style.cssText = `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;aspect-ratio:auto;transform:none;border-radius:${surfaceRadius}px;--surface-radius:${surfaceRadius}px;--surface-inset:${surfaceInset}px;padding:${surfaceInset}px`;
  shell.style.opacity = String((reduced.matches ? 1 : smooth(.56, .68, x)) * (1 - smooth(4.14, 4.5, x)));
  controls.style.top = `${target.top + target.height + 18}px`;
  controls.style.opacity = String(x < 1 ? smooth(.91, 1.02, x) : 1 - smooth(4.14, 4.4, x));
  controls.style.pointerEvents = x < .91 || x > 4.4 ? 'none' : '';
  controls.inert = x < .94 || x > 4.4;
  finish.hidden = x < 4.5;
  finish.style.opacity = String(smooth(4.5, 4.9, x));
  finish.inert = x < 4.62;
}

function requestDraw() {
  if (framePending || disposed) return;
  framePending = true;
  requestAnimationFrame(draw);
}

function readPosition() {
  const span = chapters[1].offsetTop - chapters[0].offsetTop || innerHeight;
  pagePosition = clamp(scrollY / span, 0, 5);
}

function projectedRect(object, points) {
  object.updateWorldMatrix(true, false);
  camera.updateMatrixWorld();
  const projected = points.map((point) => point.clone().applyMatrix4(object.matrixWorld).project(camera));
  const xs = projected.map((p) => (p.x + 1) * innerWidth / 2);
  const ys = projected.map((p) => (1 - p.y) * innerHeight / 2);
  return { left: Math.min(...xs), top: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

function establishHero() {
  if (!laptop || !screen) return;
  const mobile = innerWidth <= 600;
  camera.position.set(.35, 4.3, 15);
  camera.up.set(0, 1, 0);
  camera.lookAt(0, 1.2, 0);
  laptop.position.set(0, 0, 0);
  laptop.rotation.set(.01, -.09, 0);
  laptop.scale.setScalar(1);
  laptop.updateWorldMatrix(true, true);
  const localBounds = new THREE.Box3().setFromObject(laptop);
  const corners = [];
  for (const x of [localBounds.min.x, localBounds.max.x]) for (const y of [localBounds.min.y, localBounds.max.y]) for (const z of [localBounds.min.z, localBounds.max.z]) corners.push(new THREE.Vector3(x, y, z));
  // The laptop's total bounds, not an arbitrary CSS size, determine hero framing.
  const worldProbe = { matrixWorld: new THREE.Matrix4(), updateWorldMatrix() {} };
  const first = projectedRect(worldProbe, corners);
  const scale = Math.min(innerWidth * (mobile ? .94 : .63) / first.width, innerHeight * (mobile ? .35 : .43) / first.height);
  laptop.scale.setScalar(scale);
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  const desiredY = innerHeight * (mobile ? .68 : .65);
  for (let i = 0; i < 4; i++) {
    laptop.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(laptop);
    const p = [];
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) p.push(new THREE.Vector3(x, y, z));
    const rect = projectedRect(worldProbe, p);
    const distance = camera.position.distanceTo(bounds.getCenter(new THREE.Vector3()));
    const unitsPerPixel = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / innerHeight;
    laptop.position.addScaledVector(right, (innerWidth / 2 - rect.left - rect.width / 2) * unitsPerPixel);
    laptop.position.addScaledVector(up, -(desiredY - rect.top - rect.height / 2) * unitsPerPixel);
  }
  laptop.updateWorldMatrix(true, true);
  heroPose = { position: laptop.position.clone(), quaternion: laptop.quaternion.clone(), scale: laptop.scale.clone() };
  heroCamera = { position: camera.position.clone(), quaternion: camera.quaternion.clone() };

  screen.geometry.computeBoundingBox();
  const bounds = screen.geometry.boundingBox;
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const axes = ['x', 'y', 'z'].sort((a, b) => size[b] - size[a]);
  const wide = axes[0], tall = axes[1];
  displayCorners = [];
  for (const w of [bounds.min[wide], bounds.max[wide]]) for (const h of [bounds.min[tall], bounds.max[tall]]) {
    const point = center.clone(); point[wide] = w; point[tall] = h; displayCorners.push(point);
  }
  const widthVector = new THREE.Vector3(); widthVector[wide] = size[wide];
  const heightVector = new THREE.Vector3(); heightVector[tall] = size[tall];
  const basis = new THREE.Matrix3().setFromMatrix4(screen.matrixWorld);
  widthVector.applyMatrix3(basis); heightVector.applyMatrix3(basis);
  screenWorldWidth = widthVector.length(); screenWorldHeight = heightVector.length();
  screenCenter = center.applyMatrix4(screen.matrixWorld);
  screenUp = heightVector.normalize();
  if (screenUp.y < 0) screenUp.negate();
  screenNormal = widthVector.clone().cross(screenUp).normalize();
  if (screenNormal.dot(heroCamera.position.clone().sub(screenCenter)) < 0) screenNormal.negate();
  const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  cameraCoverDistance = Math.min(screenWorldHeight / (2 * tan), screenWorldWidth / (2 * tan * camera.aspect)) * .98;
  const aligned = camera.clone(); aligned.up.copy(screenUp);
  aligned.position.copy(screenCenter).addScaledVector(screenNormal, heroCamera.position.distanceTo(screenCenter));
  aligned.lookAt(screenCenter);
  alignedCamera = { position: aligned.position.clone(), quaternion: aligned.quaternion.clone() };
}

function updateCamera(x) {
  if (!laptop || !heroCamera) return;
  laptop.position.copy(heroPose.position); laptop.quaternion.copy(heroPose.quaternion); laptop.scale.copy(heroPose.scale);
  const entry = reduced.matches ? 0 : smooth(.08, .28, x);
  camera.position.lerpVectors(heroCamera.position, alignedCamera.position, entry);
  camera.quaternion.slerpQuaternions(heroCamera.quaternion, alignedCamera.quaternion, entry);
  if (!reduced.matches && x > .28) {
    const approach = smooth(.28, .65, x);
    const end = screenCenter.clone().addScaledVector(screenNormal, cameraCoverDistance);
    camera.position.lerpVectors(alignedCamera.position, end, approach);
    camera.quaternion.copy(alignedCamera.quaternion);
  }
  laptop.visible = x < .69;
  projectedScreen = projectedRect(screen, displayCorners);
}

function updateBackground(x) {
  if (!backgroundMaterial || textures.length !== 3) return;
  const uniforms = backgroundMaterial.uniforms;
  let a = 0, b = 1, transition = smooth(.2, 1.05, x);
  if (x >= 1.05 && x < 3.9) { a = 1; b = 2; transition = smooth(1.2, 2.15, x); }
  else if (x >= 3.9) { a = 2; b = 0; transition = smooth(4.0, 5, x); }
  uniforms.uA.value = textures[a]; uniforms.uB.value = textures[b];
  uniforms.uMix.value = transition;
  uniforms.uMotion.value = reduced.matches ? 0 : 1;
}

function draw() {
  framePending = false;
  readPosition();
  updateCamera(pagePosition);
  updateBackground(pagePosition);
  drawUI(pagePosition);
  if (renderer && backgroundScene && textures.length === 3 && !document.hidden) {
    renderer.clear();
    renderer.render(backgroundScene, backgroundCamera);
    if (laptop?.visible) { renderer.clearDepth(); renderer.render(scene, camera); }
    renderCount++;
  }
  window.bizboxState = {
    progress: Number((pagePosition / 5).toFixed(4)), stage, modelLoaded, contentMode, renderCount,
    screenBounds: projectedScreen ? Object.fromEntries(Object.entries(projectedScreen).map(([k,v]) => [k, Number(v.toFixed(2))])) : null,
    productBounds: !shell.hidden ? productWindow.getBoundingClientRect().toJSON() : null,
    reducedMotion: reduced.matches
  };
  if (initializationComplete) window.bizboxReady = true;
}

function resize() {
  if (camera) { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
  if (renderer) {
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, innerWidth <= 600 ? 1.4 : 1.25, Math.sqrt(2400000 / (innerWidth * innerHeight))));
    renderer.setSize(innerWidth, innerHeight);
  }
  if (backgroundMaterial) backgroundMaterial.uniforms.uAspect.value = innerWidth / innerHeight;
  establishHero();
  requestDraw();
}

addEventListener('scroll', requestDraw, { passive: true });
addEventListener('resize', resize, { passive: true });
addEventListener('visibilitychange', () => { if (!document.hidden) requestDraw(); });
reduced.addEventListener('change', () => { if (reduced.matches) headlineAnimation?.cancel(); requestDraw(); });
canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  document.body.classList.add('webgl-fallback');
  window.bizboxError = 'The WebGL context was lost.';
  renderer = null; modelLoaded = false; requestDraw();
});

async function start() {
  createRimMap();
  try {
    const { ENTRY_URL, PRODUCT_PREVIEW_URL, DEMO_URL, MATTERPORT_URL } = await import('./config.js');
    config = { ENTRY_URL: verifiedURL(ENTRY_URL), PRODUCT_PREVIEW_URL: verifiedURL(PRODUCT_PREVIEW_URL), DEMO_URL: verifiedURL(DEMO_URL), MATTERPORT_URL: verifiedURL(MATTERPORT_URL) };
  } catch { config = { ENTRY_URL: '', PRODUCT_PREVIEW_URL: '', DEMO_URL: '', MATTERPORT_URL: '' }; }
  document.querySelectorAll('.demo-link').forEach((link) => {
    if (config.ENTRY_URL) { link.href = config.ENTRY_URL; link.removeAttribute('aria-disabled'); }
  });
  if (config.MATTERPORT_URL) source.href = config.MATTERPORT_URL;
  source.firstChild.textContent = 'Matterport demo · The Coffee Port ';
  requestDraw();
  try {
    THREE = await import('./vendor.js');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'default' });
    renderer.autoClear = false;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    // No shadow maps or idle frame loop: scroll, resize and asset events are the render clock.
    renderer.shadowMap.enabled = false;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, .03, 100);
    scene.add(new THREE.HemisphereLight(0xe1e7ff, 0x8b6658, 1.1));
    const key = new THREE.DirectionalLight(0xffdec5, 2.5); key.position.set(-4, 7, 8); scene.add(key);
    const rim = new THREE.DirectionalLight(0xd2e0ff, 1.8); rim.position.set(6, 5, -4); scene.add(rim);
    const front = new THREE.DirectionalLight(0xffffff, .5); front.position.set(0, 3, 10); scene.add(front);
    if (THREE.RoomEnvironment) {
      const generator = new THREE.PMREMGenerator(renderer), room = new THREE.RoomEnvironment();
      scene.environment = generator.fromScene(room, .06).texture;
      room.dispose(); generator.dispose();
    }
    backgroundScene = new THREE.Scene();
    backgroundCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    backgroundMaterial = new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false, toneMapped: false,
      uniforms: { uA: { value: null }, uB: { value: null }, uMix: { value: 0 }, uAspect: { value: innerWidth / innerHeight }, uMotion: { value: reduced.matches ? 0 : 1 } },
      vertexShader: 'varying vec2 vUv; void main(){vUv=uv; gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader: `uniform sampler2D uA; uniform sampler2D uB; uniform float uMix; uniform float uAspect; uniform float uMotion; varying vec2 vUv;
        vec2 cover(vec2 p){p-=.5;float a=1.773;p.x*=min(1.,uAspect/a);p.y*=min(1.,a/uAspect);p+=vec2(uAspect<1.?.59:.5,.5);return p;}
        void main(){float t=clamp(uMix,0.,1.);float s=sin(t*3.14159265)*uMotion;vec2 warp=(vUv-.5)*.012*s;float n=sin(vUv.x*8.+vUv.y*6.)*.012;float m=smoothstep(-.35,.35,(t-.5)*1.8+(vUv.y-.5)*.12+n);vec3 c=mix(texture2D(uA,cover(vUv-warp)).rgb,texture2D(uB,cover(vUv+warp)).rgb,m);gl_FragColor=vec4(c,1.);
        #include <colorspace_fragment>
        }`
    });
    backgroundScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), backgroundMaterial));
    resize();
    const loader = new THREE.TextureLoader();
    textures = await Promise.all(['houston-sunset.jpg', 'storefront-sunset.jpg', 'interior-sunset.jpg'].map(async (name) => {
      const texture = await loader.loadAsync(assetURL(name));
      texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    }));
    requestDraw();
    const gltf = await new THREE.GLTFLoader().loadAsync(assetURL('bizbox-scene.glb'));
    // GLTFLoader suffixes duplicate Blender names, including unreachable export nodes.
    const named = (name) => {
      let found = null;
      gltf.scene.traverse((object) => { if (object.name === name || new RegExp(`^${name}_\\d+$`).test(object.name)) found ||= object; });
      return found;
    };
    laptop = named('LaptopRoot');
    screen = named('Actual_Product_Screen');
    if (!laptop || !screen) throw new Error('The laptop model needs LaptopRoot and Actual_Product_Screen.');
    // Only the laptop is shown. The public scan is the actual Matterport embed.
    laptop.removeFromParent(); scene.add(laptop);
    laptop.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = false; object.receiveShadow = false;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => {
        if (!material) return;
        if ('envMapIntensity' in material) material.envMapIntensity = .65;
        if (/V3_Black_(Keyboard_Recess|Keycap)|Bezel|Notch/.test(material.name)) {
          material.envMapIntensity = .08; material.metalness = 0; material.roughness = .6;
        }
        if (/V3_Camera_Glass/.test(material.name)) material.envMapIntensity = .05;
      });
    });
    modelLoaded = true;
    establishHero();
  } catch (error) {
    window.bizboxError = String(error);
    console.warn('BizBox 3D preview:', error);
    modelLoaded = false;
    if (textures.length !== 3) document.body.classList.add('webgl-fallback');
  } finally {
    initializationComplete = true;
    document.body.classList.add('ready');
    requestDraw();
  }
}

start();
