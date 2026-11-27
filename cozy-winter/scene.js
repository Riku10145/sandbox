import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const params = new URLSearchParams(location.search);
const W = Number(params.get('w') ?? 1920);
const H = Number(params.get('h') ?? 1080);
const DURATION = 10;
const FX = new Set((params.get('fx') ?? 'shadow,gtao,env').split(','));
const REAL = FX.size > 0 && !FX.has('none');

let seed = 20261127;
function rand(a = 0, b = 1) {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return a + (b - a) * (((t ^ (t >>> 14)) >>> 0) / 4294967296);
}
const pick = (arr) => arr[Math.floor(rand(0, arr.length))];
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
renderer.shadowMap.enabled = FX.has('shadow');
renderer.shadowMap.type = THREE.PCFShadowMap;

function castShadows(light, size = 1024) {
  if (!FX.has('shadow')) return light;
  light.castShadow = true;
  // The lamps flicker in intensity; their positions and all shadow casters are static.
  light.shadow.autoUpdate = false;
  light.shadow.needsUpdate = true;
  light.shadow.mapSize.set(size, size);
  light.shadow.radius = 6;
  light.shadow.bias = -0.0015;
  light.shadow.normalBias = 0.02;
  light.shadow.camera.near = 0.05;
  light.shadow.camera.far = 14;
  return light;
}
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const FOG = new THREE.Color(0x58677f);
scene.background = FOG.clone();
scene.fog = new THREE.FogExp2(FOG, 0.03);

const camera = new THREE.PerspectiveCamera(41, W / H, 0.05, 200);

const updates = [];

function canvasTexture(w, h, draw, { repeat = [1, 1], color = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  if (color) tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(...repeat);
  tex.anisotropy = 8;
  return tex;
}

const glowTex = canvasTexture(128, 128, (g, w, h) => {
  const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.15, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.12)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
});

const shadowTex = canvasTexture(128, 128, (g, w, h) => {
  const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  grd.addColorStop(0, 'rgba(0,0,0,0.75)');
  grd.addColorStop(0.6, 'rgba(0,0,0,0.35)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
});

function glow(color, size, opacity = 1, fog = false) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color, opacity, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, fog,
  }));
  s.scale.setScalar(size);
  return s;
}

function contactShadow(x, z, sx, sz, opacity = 0.8) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity, depthWrite: false, fog: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.004, z);
  m.scale.set(sx, sz, 1);
  scene.add(m);
}

const interior = (opts) => new THREE.MeshStandardMaterial({ fog: false, ...opts });
const cloth = (opts) => new THREE.MeshPhysicalMaterial({
  fog: false, roughness: 0.95, sheen: 1, sheenRoughness: 0.45, sheenColor: 0xfff0dc, ...opts,
});
const glass = (opts) => new THREE.MeshPhysicalMaterial({
  fog: false, color: 0xfff6ea, roughness: 0.06, transmission: 1, thickness: 0.004, ior: 1.5, depthWrite: false, ...opts,
});

const texLoader = new THREE.TextureLoader();
async function pbrSet(id) {
  const [map, normalMap, roughnessMap] = await Promise.all(
    ['Diffuse.jpg', 'nor_gl.jpg', 'Rough.jpg'].map((f) => texLoader.loadAsync(`./textures/${id}/${f}`)),
  );
  map.colorSpace = THREE.SRGBColorSpace;
  for (const t of [map, normalMap, roughnessMap]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
  return { map, normalMap, roughnessMap };
}
function tiled(set, rx, ry, keys = ['map', 'normalMap', 'roughnessMap']) {
  return Object.fromEntries(keys.map((k) => {
    const t = set[k].clone();
    t.repeat.set(rx, ry);
    return [k, t];
  }));
}
const [OAK, WALNUT, FLEECE, LINEN, WALL, SNOW] = await Promise.all(
  ['oak_wood_planks', 'walnut_veneer', 'polar_fleece', 'rough_linen', 'beige_wall_001', 'snow_02'].map(pbrSet),
);

function blobNoise(size, count, rMin, rMax, repeat) {
  return canvasTexture(size, size, (g, w, h) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < count; i++) {
      const v = pick([50, 210]);
      const r = rand(rMin, rMax), x = rand(0, w), y = rand(0, h);
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, `rgba(${v},${v},${v},${rand(0.08, 0.25)})`);
      grd.addColorStop(1, `rgba(${v},${v},${v},0)`);
      g.fillStyle = grd; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }, { repeat, color: false });
}

function mesh(geo, mat, x = 0, y = 0, z = 0, parent = scene) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

const GLSL_NOISE = /* glsl */`
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p){
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }
`;
const UV_VERT = /* glsl */`
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

function billboard(obj) {
  updates.push(() => obj.quaternion.copy(camera.quaternion));
}

// ---------- room ----------
const ROOM = { left: -4.4, right: 4.6, back: -3, front: 7, ceil: 4.4 };
const WIN = { x0: -3.3, x1: 3.0, y0: 0.85, y1: 4.0 };
const paneZ = ROOM.back - 0.14;

const floorTex = canvasTexture(1024, 1024, (g, w, h) => {
  const rows = 8;
  for (let r = 0; r < rows; r++) {
    let x = -rand(0, w * 0.5);
    while (x < w) {
      const len = rand(w * 0.35, w * 0.7);
      const l = rand(28, 40);
      g.fillStyle = `hsl(${rand(22, 28)}, ${rand(35, 45)}%, ${l}%)`;
      g.fillRect(x, r * h / rows, len, h / rows);
      for (let k = 0; k < 14; k++) {
        g.strokeStyle = `rgba(40,20,10,${rand(0.05, 0.18)})`;
        g.lineWidth = rand(1, 3);
        const yy = r * h / rows + rand(4, h / rows - 4);
        g.beginPath(); g.moveTo(x, yy);
        g.bezierCurveTo(x + len * 0.3, yy + rand(-6, 6), x + len * 0.6, yy + rand(-6, 6), x + len, yy + rand(-3, 3));
        g.stroke();
      }
      g.fillStyle = 'rgba(25,12,6,0.85)';
      g.fillRect(x, r * h / rows, 3, h / rows);
      x += len;
    }
    g.fillStyle = 'rgba(25,12,6,0.9)';
    g.fillRect(0, r * h / rows, w, 3);
  }
}, { repeat: [2.5, 2.5] });

const floor = mesh(new THREE.PlaneGeometry(ROOM.right - ROOM.left, ROOM.front - ROOM.back),
  interior({ ...tiled(OAK, (ROOM.right - ROOM.left) / 1.2, (ROOM.front - ROOM.back) / 1.2), roughness: 1, color: 0xe2c8ae }),
  (ROOM.left + ROOM.right) / 2, 0, (ROOM.front + ROOM.back) / 2);
floor.rotation.x = -Math.PI / 2;

const wallMat = (w, h) => interior({ ...tiled(WALL, w / 3, h / 3), color: 0xfff2e2, roughness: 1 });
const wallBox = (w, h, d, x, y, z) => box(w, h, d, wallMat(Math.max(w, d), h), x, y, z);
const trimMat = interior({
  ...tiled(OAK, 2.5, 0.4, ['normalMap', 'roughnessMap']),
  normalScale: new THREE.Vector2(0.16, 0.16),
  color: 0xe6d6bd, roughness: 0.72,
});
const sashMat = interior({
  ...tiled(OAK, 2.5, 0.4, ['normalMap', 'roughnessMap']),
  normalScale: new THREE.Vector2(0.14, 0.14),
  color: 0xdccbb2, roughness: 0.66,
});
const T = 0.22;
function box(w, h, d, mat, x, y, z, parent = scene) {
  return mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z, parent);
}
wallBox(ROOM.right - ROOM.left, WIN.y0, T, (ROOM.left + ROOM.right) / 2, WIN.y0 / 2, ROOM.back - T / 2);
wallBox(ROOM.right - ROOM.left, ROOM.ceil - WIN.y1, T, (ROOM.left + ROOM.right) / 2, (WIN.y1 + ROOM.ceil) / 2, ROOM.back - T / 2);
wallBox(WIN.x0 - ROOM.left, WIN.y1 - WIN.y0, T, (ROOM.left + WIN.x0) / 2, (WIN.y0 + WIN.y1) / 2, ROOM.back - T / 2);
wallBox(ROOM.right - WIN.x1, WIN.y1 - WIN.y0, T, (WIN.x1 + ROOM.right) / 2, (WIN.y0 + WIN.y1) / 2, ROOM.back - T / 2);
wallBox(T, ROOM.ceil, ROOM.front - ROOM.back, ROOM.left - T / 2, ROOM.ceil / 2, (ROOM.front + ROOM.back) / 2);
wallBox(T, ROOM.ceil, ROOM.front - ROOM.back, ROOM.right + T / 2, ROOM.ceil / 2, (ROOM.front + ROOM.back) / 2);
box(ROOM.right - ROOM.left, T, ROOM.front - ROOM.back, interior({ color: 0x9c7a58, roughness: 1 }),
  (ROOM.left + ROOM.right) / 2, ROOM.ceil + T / 2, (ROOM.front + ROOM.back) / 2);
box(ROOM.right - ROOM.left, 0.12, 0.04, trimMat, (ROOM.left + ROOM.right) / 2, 0.06, ROOM.back + 0.02);

{
  const molding = (w, h, d, mat, x, y, z, r = 0.008) =>
    mesh(new RoundedBoxGeometry(w, h, d, 2, r), mat, x, y, z);
  const winW = WIN.x1 - WIN.x0, winH = WIN.y1 - WIN.y0;
  const cx = (WIN.x0 + WIN.x1) / 2, cy = (WIN.y0 + WIN.y1) / 2;
  const casingW = 0.11, casingZ = ROOM.back + 0.016;
  const jambZ = ROOM.back - T / 2;
  const mullionZ = ROOM.back - 0.085;
  const sashZ = ROOM.back - 0.115;
  const midX = [-0.2, 2.35];

  // Outer wall casing (flush corners, stepped header cap)
  molding(casingW, winH, 0.032, trimMat, WIN.x0 - casingW / 2, cy, casingZ);
  molding(casingW, winH, 0.032, trimMat, WIN.x1 + casingW / 2, cy, casingZ);
  molding(winW + casingW * 2, casingW, 0.032, trimMat, cx, WIN.y1 + casingW / 2, casingZ);
  molding(winW + casingW * 2 + 0.04, 0.028, 0.046, trimMat, cx, WIN.y1 + casingW + 0.012, casingZ + 0.006, 0.006);

  // Chamfered window sill and under-sill apron
  molding(winW + 0.34, 0.048, 0.26, trimMat, cx, WIN.y0 - 0.018, ROOM.back + 0.055, 0.012);
  molding(winW + casingW * 2, 0.068, 0.026, trimMat, cx, WIN.y0 - 0.074, ROOM.back + 0.013, 0.006);

  // Recessed jambs lining the wall thickness
  molding(winW, 0.042, T, sashMat, cx, WIN.y1 - 0.021, jambZ, 0.006);
  molding(winW, 0.036, T, sashMat, cx, WIN.y0 + 0.018, jambZ, 0.006);
  molding(0.042, winH, T, sashMat, WIN.x0 + 0.021, cy, jambZ, 0.006);
  molding(0.042, winH, T, sashMat, WIN.x1 - 0.021, cy, jambZ, 0.006);

  // Recessed main mullions and transom bar
  molding(winW, 0.095, 0.09, sashMat, cx, 3.0, mullionZ, 0.008);
  for (const x of midX) molding(0.095, winH, 0.09, sashMat, x, cy, mullionZ, 0.008);

  // Deeper inner sash perimeter and upper muntins
  molding(winW - 0.06, 0.032, 0.045, sashMat, cx, WIN.y1 - 0.056, sashZ, 0.005);
  molding(winW - 0.06, 0.032, 0.045, sashMat, cx, WIN.y0 + 0.050, sashZ, 0.005);
  molding(0.032, winH - 0.06, 0.045, sashMat, WIN.x0 + 0.056, cy, sashZ, 0.005);
  molding(0.032, winH - 0.06, 0.045, sashMat, WIN.x1 - 0.056, cy, sashZ, 0.005);
  for (const x of [-2.2, -1.1, 0.9, 1.65]) {
    molding(0.03, WIN.y1 - 3.0 - 0.04, 0.045, sashMat, x, (3.0 + WIN.y1) / 2, sashZ, 0.005);
  }

  box(ROOM.right - ROOM.left, 0.18, 0.18, interior({ color: 0x7a5a3e, roughness: 0.8 }),
    (ROOM.left + ROOM.right) / 2, ROOM.ceil - 0.09, 1.2);
}

// ---------- CC0 3D models (tevy.dev) ----------
const gltfAssets = {};
{
  const ktx2 = new KTX2Loader()
    .setTranscoderPath('./node_modules/three/examples/jsm/libs/basis/')
    .detectSupport(renderer);
  const gltfLoader = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
  const entries = [
    ['villageHouse', './models/village-house-lod0.glb'],
    ['redCottage', './models/red-cottage-lod0.glb'],
    ['bareTree', './models/spooky-tree-lod1.glb'],
    ['snowySpruce', './models/snowy-spruce-lod2.glb'],
    ['woodStove', './models/wood-stove-lod1.glb'],
    ['giftSet', './models/gift-box-set-lod1.glb'],
    ['driedFlowers', './models/dried-flowers-lod0.glb'],
    ['tableLamp', './models/table-lamp-lod0.glb'],
    ['books', './models/books-lod1.glb'],
  ];
  const loaded = await Promise.all(entries.map(([, path]) => gltfLoader.loadAsync(path)));
  entries.forEach(([key], i) => { gltfAssets[key] = loaded[i]; });
  ktx2.dispose();
}

function prepInteriorModel(root, { cast = true, receive = true, envIntensity = 1.0 } = {}) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = cast;
    o.receiveShadow = receive;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      m.fog = false;
      m.envMapIntensity = envIntensity;
    }
  });
  return root;
}

// ---------- outside ----------
const GROUND_Y = 0.55;

const skyEnv = (() => {
  const sky = new THREE.Scene();
  sky.add(new THREE.Mesh(new THREE.SphereGeometry(50, 48, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: {
      uTop: { value: new THREE.Color(0x334c75) },
      uHorizon: { value: new THREE.Color(0x96aac6) },
      uGround: { value: new THREE.Color(0x9daec5) },
      uWarm: { value: new THREE.Color(0xffb070) },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform vec3 uTop, uHorizon, uGround, uWarm;
      varying vec3 vDir;
      void main(){
        float y = vDir.y;
        vec3 c = y > 0.0 ? mix(uHorizon, uTop, pow(y, 0.55)) : mix(uHorizon, uGround, smoothstep(0.0, 0.25, -y));
        c += uWarm * 0.05 * pow(max(0.0, vDir.z), 4.0) * smoothstep(0.5, 0.0, abs(y - 0.1));
        gl_FragColor = vec4(c, 1.0);
      }`,
  })));
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(sky, 0.02).texture;
  pm.dispose();
  return tex;
})();

const outdoor = (opts) => new THREE.MeshStandardMaterial({ envMap: skyEnv, envMapIntensity: 1, roughness: 0.9, ...opts });

const groundTex = canvasTexture(2048, 2048, (g, w, h) => {
  const X = (x) => (x + 40) / 80 * w;
  const Z = (z) => (z + 3.3) / -80 * h;
  g.fillStyle = '#f2f4f6'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2500; i++) {
    g.fillStyle = `rgba(${pick(['200,185,190', '255,250,245'])},${rand(0.04, 0.12)})`;
    g.beginPath(); g.arc(rand(0, w), rand(0, h), rand(4, 30), 0, Math.PI * 2); g.fill();
  }
  const road = [[-26, -6.5], [-12, -7.5], [-5, -9.5], [0, -12.5], [5, -14.0], [14, -14.8], [30, -15.2]];
  const path = (off) => {
    g.beginPath();
    g.moveTo(X(road[0][0]), Z(road[0][1] + off));
    for (let i = 1; i < road.length - 1; i++) {
      const mx = (road[i][0] + road[i + 1][0]) / 2, mz = (road[i][1] + road[i + 1][1]) / 2;
      g.quadraticCurveTo(X(road[i][0]), Z(road[i][1] + off), X(mx), Z(mz + off));
    }
    g.lineTo(X(road.at(-1)[0]), Z(road.at(-1)[1] + off));
  };
  g.lineCap = 'round';
  g.strokeStyle = '#ddd2ce'; g.lineWidth = 7.5 / 80 * w; path(0); g.stroke();
  g.strokeStyle = 'rgba(140,120,125,0.3)'; g.lineWidth = 0.35 / 80 * w;
  for (const off of [-1.6, -0.9, 0.9, 1.6]) { path(off); g.stroke(); }
  g.strokeStyle = 'rgba(150,135,140,0.3)'; g.lineWidth = 0.08 / 80 * w;
  for (const off of [-4.1, 4.1]) { path(off); g.stroke(); }
});
{
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    outdoor({ map: groundTex, ...tiled(SNOW, 40, 40, ['normalMap', 'roughnessMap']), roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, GROUND_Y, -3.3 - 40);
  scene.add(ground);
}

const snowWhite = outdoor({ color: 0xf4efed, ...tiled(SNOW, 1, 1, ['normalMap', 'roughnessMap']), roughness: 1 });
const barkCol = new THREE.Color(0x2e231e);
const snowCol = new THREE.Color(0xf0ebe9);

function colorByUp(geo, base, top, lo = 0.15, hi = 0.6, jitter = 0.25) {
  const n = geo.attributes.normal, cols = new Float32Array(n.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < n.count; i++) {
    const k = smooth(lo, hi, n.getY(i) + rand(-jitter, jitter));
    c.copy(base).lerp(top, k);
    cols.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return geo;
}

const treeMat = outdoor({ vertexColors: true, roughness: 1 });

function bareTree(x, z, height, spread, depth = 6) {
  const parts = [];
  const up = new THREE.Vector3(0, 1, 0);
  function branch(start, dir, len, rad, level) {
    const end = start.clone().addScaledVector(dir, len);
    const g = new THREE.CylinderGeometry(rad * 0.6, rad, len, level > 3 ? 3 : level > 1 ? 5 : 8, 1, true);
    g.translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir));
    g.translate(start.x, start.y, start.z);
    parts.push(g);
    if (level >= depth) return;
    const kids = level === 0 ? 4 : pick([2, 3, 3]);
    for (let i = 0; i < kids; i++) {
      const az = (i / kids) * Math.PI * 2 + rand(-0.6, 0.6);
      const tilt = (level === 0 ? 0.75 : 0.45) * spread + rand(-0.25, 0.3);
      const d = dir.clone().applyAxisAngle(new THREE.Vector3(Math.cos(az), 0, Math.sin(az)), tilt).normalize();
      d.y = Math.max(d.y, 0.1); d.normalize();
      const from = level === 0 ? start.clone().lerp(end, rand(0.55, 1)) : start.clone().lerp(end, rand(0.7, 1));
      branch(from, d, len * rand(0.6, 0.78), rad * 0.58, level + 1);
    }
  }
  branch(new THREE.Vector3(0, 0, 0), new THREE.Vector3(rand(-0.05, 0.05), 1, 0).normalize(), height * 0.42, height * 0.04, 0);
  const geo = colorByUp(mergeGeometries(parts), barkCol, snowCol, 0.35, 0.75, 0.12);
  const m = new THREE.Mesh(geo, treeMat);
  m.position.set(x, GROUND_Y, z);
  scene.add(m);
  return m;
}

gltfAssets.snowySpruce.scene.traverse((o) => {
  if (!o.isMesh) return;
  const m = o.material;
  m.envMap = skyEnv;
  m.envMapIntensity = 0.9;
  m.fog = true;
});
function pineTree(x, z, height) {
  const inst = gltfAssets.snowySpruce.scene.clone(true);
  const s = (height / 10.48) * rand(0.95, 1.15);
  inst.position.set(x, GROUND_Y - 0.15, z);
  inst.scale.set(s * 1.15, s, s * 1.15);
  inst.rotation.y = rand(0, Math.PI * 2);
  scene.add(inst);
}

const sidingTex = canvasTexture(256, 256, (g, w, h) => {
  const rows = 14;
  for (let i = 0; i < rows; i++) {
    const y = i * h / rows;
    const grd = g.createLinearGradient(0, y, 0, y + h / rows);
    grd.addColorStop(0, '#f2f2f2'); grd.addColorStop(0.8, '#c4c4c4'); grd.addColorStop(1, '#6a6a6a');
    g.fillStyle = grd; g.fillRect(0, y, w, h / rows);
  }
}, { repeat: [2, 1.6], color: false });

const windowTex = canvasTexture(128, 160, (g, w, h) => {
  const grd = g.createRadialGradient(w / 2, h * 0.55, 4, w / 2, h * 0.55, h * 0.75);
  grd.addColorStop(0, '#ffe2b0'); grd.addColorStop(1, '#a8652e');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(110,55,25,0.55)';
  g.fillRect(0, 0, w * 0.22, h); g.fillRect(w * 0.78, 0, w * 0.22, h);
  g.fillStyle = '#efe6da';
  g.fillRect(w / 2 - 3, 0, 6, h); g.fillRect(0, h * 0.48, w, 6);
});


{
  const villageHouseAsset = gltfAssets.villageHouse;
  const redCottageAsset = gltfAssets.redCottage;

  function styleWinterHouse(root) {
    root.traverse((o) => {
      if (!o.isMesh) return;
      const mat = o.material;
      mat.envMap = skyEnv;
      mat.envMapIntensity = 0.85;
      mat.fog = true;
      // Add snow accumulation on sloped roofs/ledges and warm interior glow on glossy window glass.
      mat.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying float vSnowUp;\nvarying vec3 vWorldPos;')
          .replace(
            '#include <beginnormal_vertex>',
            '#include <beginnormal_vertex>\nvSnowUp = normalize(mat3(modelMatrix) * objectNormal).y;',
          )
          .replace(
            '#include <worldpos_vertex>',
            '#include <worldpos_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
          );
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying float vSnowUp;\nvarying vec3 vWorldPos;')
          .replace(
            '#include <map_fragment>',
            '#include <map_fragment>\n' +
            'float snowDrift = 0.5 + 0.5 * sin(vWorldPos.x * 1.7 + vWorldPos.z * 1.3) * cos(vWorldPos.x * 0.8 - vWorldPos.z * 2.1);\n' +
            'float snowMask = smoothstep(0.38, 0.72, vSnowUp + (snowDrift - 0.5) * 0.14);\n' +
            'diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.89, 0.94), snowMask * 0.88);',
          )
          .replace(
            '#include <roughnessmap_fragment>',
            '#include <roughnessmap_fragment>\n' +
            'float glassMask = smoothstep(0.28, 0.10, roughnessFactor) * (1.0 - smoothstep(0.25, 0.5, abs(vSnowUp)));\n' +
            'roughnessFactor = mix(roughnessFactor, 0.95, snowMask * 0.85);',
          )
          .replace(
            '#include <emissivemap_fragment>',
            '#include <emissivemap_fragment>\n' +
            'totalEmissiveRadiance += vec3(1.22, 0.58, 0.18) * glassMask * 1.15;',
          );
      };
    });
  }
  styleWinterHouse(villageHouseAsset.scene);
  styleWinterHouse(redCottageAsset.scene);

  // Place Nordic timber houses along the snowy street (facing +Z toward the window).
  const placements = [
    { asset: villageHouseAsset, x: 2.5, z: -22.5, scale: 0.72, rotY: -0.22, porchLight: 12, porchY: 2.9, porchZ: 5.4 },
    { asset: redCottageAsset, x: -7.2, z: -25.2, scale: 0.84, rotY: 0.30, porchLight: 8, porchY: 2.2, porchZ: 4.2 },
    { asset: redCottageAsset, x: 11.8, z: -25.5, scale: 0.78, rotY: -0.35, porchLight: 0 },
    { asset: villageHouseAsset, x: -2.4, z: -37.0, scale: 0.66, rotY: 0.14, porchLight: 0 },
  ];
  for (const h of placements) {
    const inst = h.asset.scene.clone(true);
    inst.position.set(h.x, GROUND_Y - 0.08, h.z);
    inst.scale.setScalar(h.scale);
    inst.rotation.y = h.rotY;
    scene.add(inst);
    if (h.porchLight) {
      const halo = glow(0xffb470, 2.0, 0.65, true);
      halo.position.set(0, h.porchY, h.porchZ);
      inst.add(halo);
      const pl = new THREE.PointLight(0xffa860, h.porchLight, 16, 2);
      pl.position.set(0, h.porchY, h.porchZ + 0.3);
      inst.add(pl);
    }
  }
}

for (const [x, z, h, r] of [
  [-6.5, -10, 3.2, 1.3], [-5.4, -13.5, 2.4, 1.0], [5.8, -18, 3.6, 1.5], [7.2, -17, 2.6, 1.1],
  [-1.8, -18.5, 2.2, 0.9], [-10, -20, 4.2, 1.7], [10, -30, 4.5, 1.8], [-14, -32, 5, 2],
  [0.2, -26, 3.2, 1.2], [14, -20, 3.5, 1.4],
]) pineTree(x, z, h, r);

{
  const bareTreeAsset = gltfAssets.bareTree;
  bareTreeAsset.scene.traverse((o) => {
    if (!o.isMesh) return;
    const mat = o.material;
    mat.envMap = skyEnv;
    mat.envMapIntensity = 1.0;
    mat.fog = true;
    mat.roughness = Math.max(mat.roughness ?? 0.9, 0.85);
    // Dust upward-facing bark and limbs with winter snow.
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vSnowUp;')
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvSnowUp = normalize(mat3(modelMatrix) * objectNormal).y;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vSnowUp;')
        .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.89, 0.93), smoothstep(0.60, 0.92, vSnowUp) * 0.65);');
    };
  });
  for (const [x, z, scale, rotY] of [
    [2.9, -7.6, 0.94, 0.7],
    [-4.95, -11.5, 0.88, 2.55],
  ]) {
    const inst = bareTreeAsset.scene.clone(true);
    inst.position.set(x, GROUND_Y - 0.12, z);
    inst.scale.setScalar(scale);
    inst.rotation.y = rotY;
    scene.add(inst);
  }
}
for (const [x, z, h] of [
  [-9, -16, 6.5], [-12, -23, 7], [7.5, -12, 6], [-3.5, -23, 6.5], [6, -31, 7.5], [-6, -38, 7],
  [16, -27, 7], [1, -40, 8], [-17, -28, 7], [12, -36, 7.5],
]) bareTree(x, z, h, 0.95, 6);

{
  const bushGeo = new THREE.IcosahedronGeometry(1, 3);
  const p = bushGeo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = 1 + Math.sin(p.getX(i) * 5.1) * 0.05 + Math.sin(p.getZ(i) * 4.3 + p.getY(i) * 3) * 0.05;
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
  }
  bushGeo.computeVertexNormals();
  const bushes = new THREE.InstancedMesh(bushGeo, snowWhite, 60);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 60; i++) {
    const row = i < 30;
    const x = row ? -8 + i * 0.32 + rand(-0.2, 0.2) : rand(-2, 7);
    const z = row ? -8.2 + rand(-0.4, 0.4) - i * 0.03 : -17.5 + rand(-0.5, 0.5);
    const s = rand(0.25, 0.5);
    m4.compose(new THREE.Vector3(x, GROUND_Y + s * 0.2, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rand(0, 6), 0)), new THREE.Vector3(s * 1.4, s * 0.7, s));
    bushes.setMatrixAt(i, m4);
  }
  scene.add(bushes);
}

{
  const poleM = outdoor({ color: 0x1c1918, roughness: 0.42, metalness: 0.68 });
  const glassPaneM = new THREE.MeshBasicMaterial({ color: 0xffd18c, fog: false });
  const plinthPts = [[0,0],[0.15,0],[0.14,0.12],[0.11,0.18],[0.11,0.55],[0.085,0.62],[0.068,0.68]].map(([a,b])=>new THREE.Vector2(a,b));
  const plinthGeo = new THREE.LatheGeometry(plinthPts, 12);
  for (const [x, z, heads, power] of [[-3.9, -12.5, 2, 14], [0.9, -14.5, 1, 10], [-12, -18, 1, 0], [8.5, -19.5, 1, 0], [-1.2, -30, 1, 0]]) {
    const g = new THREE.Group();
    g.position.set(x, GROUND_Y, z);
    scene.add(g);
    mesh(plinthGeo, poleM, 0, 0, 0, g);
    mesh(new THREE.CylinderGeometry(0.042, 0.066, 2.72, 12), poleM, 0, 2.04, 0, g);
    mesh(new THREE.TorusGeometry(0.068, 0.016, 8, 16), poleM, 0, 1.35, 0, g).rotation.x = Math.PI / 2;
    mesh(new THREE.TorusGeometry(0.056, 0.015, 8, 16), poleM, 0, 3.25, 0, g).rotation.x = Math.PI / 2;
    const offs = heads === 2 ? [-0.34, 0.34] : [0];
    if (heads === 2) {
      mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.72, 8), poleM, 0, 3.30, 0, g).rotation.z = Math.PI / 2;
      mesh(new THREE.SphereGeometry(0.05, 10, 8), poleM, 0, 3.35, 0, g);
    }
    for (const o of offs) {
      // Hexagonal lantern cage with tapered warm glass, iron ribs, pyramidal cap, finial, and snow cap
      mesh(new THREE.CylinderGeometry(0.08, 0.045, 0.07, 6), poleM, o, 3.36, 0, g);
      mesh(new THREE.CylinderGeometry(0.13, 0.09, 0.30, 6), glassPaneM, o, 3.54, 0, g);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        const rib = mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.32, 5), poleM, o + Math.cos(a) * 0.115, 3.54, Math.sin(a) * 0.115, g);
        rib.rotation.z = -Math.cos(a) * 0.13;
        rib.rotation.x = Math.sin(a) * 0.13;
      }
      mesh(new THREE.ConeGeometry(0.19, 0.13, 6), poleM, o, 3.74, 0, g);
      mesh(new THREE.ConeGeometry(0.18, 0.07, 6), snowWhite, o, 3.78, 0, g);
      mesh(new THREE.SphereGeometry(0.026, 8, 6), poleM, o, 3.83, 0, g);
      const halo = glow(0xffa858, 1.7, 0.62);
      halo.position.set(o, 3.55, 0);
      g.add(halo);
      const halo2 = glow(0xff9a50, 3.8, 0.11);
      halo2.position.set(o, 3.4, 0);
      g.add(halo2);
    }
    if (power) {
      const pl = new THREE.PointLight(0xffa452, power, 16, 2);
      pl.position.set(0, 3.4, 0);
      g.add(pl);
    }
  }
}

{
  mesh(new RoundedBoxGeometry(WIN.x1 - WIN.x0 + 0.3, 0.16, 0.34, 3, 0.07), snowWhite,
    (WIN.x0 + WIN.x1) / 2, WIN.y0 - 0.02, ROOM.back - T - 0.14);
  const frostTex = canvasTexture(512, 512, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    let placed = 0;
    while (placed < 5000) {
      const x = rand(0, w), y = rand(0, h);
      const edge = Math.min(x / w, 1 - x / w, (1 - y / h) * 0.55, y / h * 2.5);
      if (rand() > Math.pow(Math.max(0, 1 - edge * 4.5), 3)) continue;
      placed++;
      g.fillStyle = `rgba(255,255,255,${rand(0.05, 0.22)})`;
      g.beginPath(); g.arc(x, y, rand(0.8, 3.5), 0, Math.PI * 2); g.fill();
      if (rand() < 0.08) {
        g.strokeStyle = `rgba(255,255,255,${rand(0.05, 0.18)})`;
        g.lineWidth = 0.8;
        const a = rand(0, Math.PI * 2), l = rand(6, 22);
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
      }
    }
  });
  const frostMat = new THREE.MeshBasicMaterial({ map: frostTex, color: 0xf2e2d6, transparent: true, opacity: 0.5, depthWrite: false, fog: false });
  const xs = [WIN.x0, -0.2, 2.35, WIN.x1], ys = [WIN.y0, 3.0, WIN.y1];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
    const pw = xs[i + 1] - xs[i], ph = ys[j + 1] - ys[j];
    mesh(new THREE.PlaneGeometry(pw, ph), frostMat, (xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2, paneZ);
  }
}

{
  const N = 9000;
  const pos = new Float32Array(N * 3), data = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    pos.set([rand(-16, 16), rand(0, 11), rand(-32, -3.4)], i * 3);
    data.set([rand(0.35, 0.8), rand(0, 6.28), rand(0.6, 1.6), rand(0.4, 1.2)], i * 4);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('data', new THREE.BufferAttribute(data, 4));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: { value: 0 }, uScale: { value: H * 0.5 } },
    vertexShader: /* glsl */`
      attribute vec4 data;
      uniform float uTime, uScale;
      varying float vFade;
      void main(){
        vec3 p = position;
        p.y = mod(p.y - uTime * data.x, 11.0) + ${GROUND_Y.toFixed(2)};
        p.x += sin(uTime * 0.7 * data.w + data.y) * 0.35 + uTime * 0.12;
        p.z += cos(uTime * 0.5 * data.w + data.y * 1.3) * 0.25;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float dist = -mv.z;
        gl_PointSize = data.z * 0.08 * uScale / dist;
        vFade = exp(-dist * 0.035) * smoothstep(0.0, 0.4, p.y - ${GROUND_Y.toFixed(2)});
      }`,
    fragmentShader: /* glsl */`
      varying float vFade;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.1, d) * vFade;
        gl_FragColor = vec4(vec3(1.0, 0.97, 0.95) * 1.1, a);
      }`,
  });
  const snow = new THREE.Points(geo, mat);
  snow.frustumCulled = false;
  scene.add(snow);
  updates.push((t) => { mat.uniforms.uTime.value = t + 30; });
}

// ---------- interior props ----------
const flameMat = (s) => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { uTime: { value: 0 }, uSeed: { value: s } },
  vertexShader: UV_VERT,
  fragmentShader: /* glsl */`
    uniform float uTime, uSeed;
    varying vec2 vUv;
    void main(){
      vec2 p = vUv - vec2(0.5, 0.28);
      float sway = sin(uTime * 9.0 + uSeed) * 0.025 + sin(uTime * 23.0 + uSeed * 3.0) * 0.012;
      p.x -= sway * smoothstep(0.0, 0.6, vUv.y);
      p.x *= 3.3;
      p.y *= p.y > 0.0 ? 1.15 : 2.8;
      float d = length(p);
      float core = smoothstep(0.32, 0.0, d);
      float halo = smoothstep(0.8, 0.0, d) * 0.18;
      vec3 c = mix(vec3(1.0, 0.42, 0.08), vec3(1.0, 0.93, 0.75), smoothstep(0.15, 0.7, core));
      gl_FragColor = vec4(c * (core * 5.0 + halo), 1.0);
    }`,
});

function candle({ x, y, z, r = 0.045, h = 0.1, jar = false, light = 0, shadow = false, s = rand(0, 100) }) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  scene.add(g);
  mesh(new THREE.CylinderGeometry(r, r, h, 20), interior({ color: 0xf5e5c8, emissive: 0xff8a2c, emissiveIntensity: 1.35, roughness: 0.55 }), 0, h / 2, 0, g);
  mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.02, 4), interior({ color: 0x111111 }), 0, h + 0.01, 0, g);
  if (jar) {
    mesh(new THREE.CylinderGeometry(r * 1.42, r * 1.36, h * 1.85, 24, 1, true),
      glass({ color: 0xffe4bc, roughness: 0.18, transmission: 0.78 }),
      0, h * 0.93, 0, g);
    mesh(new THREE.CylinderGeometry(r * 2.2, r * 2.2, 0.015, 24), interior({ color: 0xb08a4a, metalness: 0.7, roughness: 0.35 }), 0, 0.0, 0, g);
  }
  const fm = flameMat(s);
  const flame = mesh(new THREE.PlaneGeometry(0.06, 0.12), fm, 0, h + 0.045, 0, g);
  billboard(flame);
  const halo = glow(0xffa860, 0.55, 0.55);
  halo.position.set(0, h + 0.05, 0);
  g.add(halo);
  let pl = null;
  if (light) {
    pl = new THREE.PointLight(0xffa155, light, 0, 2);
    if (shadow) castShadows(pl, 512);
    pl.position.set(0, h + 0.12, 0);
    g.add(pl);
  }
  updates.push((t) => {
    fm.uniforms.uTime.value = t;
    const f = 1 + Math.sin(t * 11 + s) * 0.06 + Math.sin(t * 17.3 + s * 2) * 0.05 + Math.sin(t * 3.1 + s) * 0.04;
    flame.scale.set(1, f, 1);
    halo.material.opacity = 0.5 * f;
    if (pl) pl.intensity = light * f;
  });
  return g;
}

const plaidTex = canvasTexture(512, 512, (g, w, h) => {
  g.fillStyle = '#d8ccb8'; g.fillRect(0, 0, w, h);
  const bands = [[0, 70, 'rgba(45,42,40,0.85)'], [110, 18, 'rgba(45,42,40,0.7)'], [170, 40, 'rgba(90,80,70,0.55)'], [300, 70, 'rgba(45,42,40,0.85)'], [410, 18, 'rgba(45,42,40,0.7)']];
  for (const [o, s, c] of bands) { g.fillStyle = c; g.fillRect(o, 0, s, h); }
  for (const [o, s, c] of bands) { g.fillStyle = c; g.fillRect(0, o, w, s); }
  for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(255,255,255,${rand(0, 0.06)})`; g.fillRect(rand(0, w), rand(0, h), 2, 1); }
}, { repeat: [1.5, 1.5] });

const knitTex = canvasTexture(256, 256, (g, w, h) => {
  g.fillStyle = '#cdbba3'; g.fillRect(0, 0, w, h);
  const cols = 8, rows = 16, cw = w / cols, rh = h / rows;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const x = c * cw, y = r * rh;
      for (const side of [-1, 1]) {
        const grd = g.createLinearGradient(x + cw / 2, y, x + cw / 2 + side * cw / 2, y + rh);
        grd.addColorStop(0, '#efe2cc'); grd.addColorStop(1, '#a8957c');
        g.fillStyle = grd;
        g.beginPath();
        g.ellipse(x + cw / 2 + side * cw * 0.22, y + rh * 0.55, cw * 0.24, rh * 0.62, side * 0.45, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.fillStyle = 'rgba(80,60,40,0.5)'; g.fillRect(c * cw, 0, 2, h);
  }
}, { repeat: [5, 4] });

{
  const fabric = cloth({ ...tiled(FLEECE, 7, 7), normalScale: new THREE.Vector2(1.35, 1.35), color: 0xf2e4d0 });
  const sofa = new THREE.Group();
  sofa.position.set(-1.95, 0, 2.6);
  scene.add(sofa);

  // Softly crowned upholstery cushion with rounded edges and subtle fabric creases.
  function cushionGeo(w, h, d, {
    round = 0.28, crownX = 0.025, crownY = 0.05, crownZ = 0.02,
    wrinkle = 0.008, dip = 0, pinch = 0, segs = [18, 10, 22], phase = 0,
  } = {}) {
    const geo = new THREE.BoxGeometry(w, h, d, segs[0], segs[1], segs[2]);
    const pos = geo.attributes.position;
    const hw = w / 2, hh = h / 2, hd = d / 2;
    for (let i = 0; i < pos.count; i++) {
      const nx = pos.getX(i) / hw, ny = pos.getY(i) / hh, nz = pos.getZ(i) / hd;
      const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
      // Smooth superellipsoid corner/edge rounding
      const p = 2 / Math.max(0.12, round);
      const len = Math.pow(Math.pow(ax, p) + Math.pow(ay, p) + Math.pow(az, p), 1 / p);
      const shrink = len > 1 ? 1 / len : 1;
      let x = nx * hw * shrink, y = ny * hh * shrink, z = nz * hd * shrink;
      // Gentle convex crown across faces
      const cx = Math.cos(nx * Math.PI * 0.5);
      const cy = Math.cos(ny * Math.PI * 0.5);
      const cz = Math.cos(nz * Math.PI * 0.5);
      x += Math.sign(nx) * crownX * cy * cz;
      y += Math.sign(ny) * crownY * cx * cz;
      z += Math.sign(nz) * crownZ * cx * cy;
      // Subtle sitting depression on upper surface
      if (dip && ny > 0) y -= dip * ny * Math.exp(-((nx * 1.4) ** 2 + (nz * 1.6) ** 2));
      // Pinched-seam throw pillow profile (plump middle, tapered seam edges)
      if (pinch) {
        const edge = Math.max(ay, az);
        const belly = Math.pow(Math.max(0, 1 - ny * ny) * Math.max(0, 1 - nz * nz), 0.35);
        x = nx * hw * (0.14 + (1 - pinch + pinch * belly));
        const cornerPull = 0.045 * Math.pow(ay * az, 2);
        y += Math.sign(ny) * cornerPull;
        z += Math.sign(nz) * cornerPull;
        const seamRipple = 0.008 * Math.sin(ny * 7 + nz * 6 + phase) * edge;
        x += Math.sign(nx) * seamRipple;
      }
      // Organic cloth ripples
      const wv = wrinkle * (
        Math.sin(nx * 5.2 + nz * 4.7 + phase) * 0.55 +
        Math.sin(nz * 9.3 - ny * 6.1 + phase * 1.7) * 0.3 +
        Math.cos(nx * 8.1 + ny * 5.4 - phase) * 0.15
      );
      x += nx * wv; y += ny * wv; z += nz * wv;
      pos.setXYZ(i, x, y, z);
    }
    geo.computeVertexNormals();
    return geo;
  }

  // Upholstered base frame and short walnut legs
  const legMat = interior({ ...tiled(WALNUT, 0.5, 0.5), roughness: 0.75, color: 0x5c3e2c });
  for (const [lx, lz] of [[0.52, -2.05], [-0.52, -2.05], [0.52, 2.05], [-0.52, 2.05]]) {
    mesh(new THREE.CylinderGeometry(0.032, 0.022, 0.10, 12), legMat, lx, 0.05, lz, sofa);
  }
  mesh(cushionGeo(1.24, 0.38, 4.38, { round: 0.22, crownX: 0.018, crownY: 0.01, crownZ: 0.012, wrinkle: 0.004, segs: [16, 8, 28], phase: 0.4 }), fabric, 0, 0.28, 0, sofa);

  // Two plump seat cushions with slight sitting give and seam separation
  mesh(cushionGeo(1.06, 0.22, 2.04, { round: 0.36, crownX: 0.028, crownY: 0.055, crownZ: 0.022, wrinkle: 0.009, dip: 0.028, segs: [20, 10, 26], phase: 1.1 }), fabric, 0.11, 0.56, -1.04, sofa);
  mesh(cushionGeo(1.06, 0.22, 2.04, { round: 0.36, crownX: 0.028, crownY: 0.055, crownZ: 0.022, wrinkle: 0.009, dip: 0.022, segs: [20, 10, 26], phase: 2.7 }), fabric, 0.11, 0.56, 1.05, sofa);

  // Back frame + two separate plump back cushions
  const backFrame = mesh(cushionGeo(0.24, 0.78, 4.36, { round: 0.26, crownX: 0.015, crownY: 0.02, crownZ: 0.015, wrinkle: 0.004, segs: [10, 12, 24], phase: 0.8 }), fabric, -0.56, 0.84, 0, sofa);
  backFrame.rotation.z = 0.10;
  for (const [bz, ph] of [[-1.02, 3.4], [1.02, 5.2]]) {
    const bc = mesh(cushionGeo(0.28, 0.62, 1.98, { round: 0.44, crownX: 0.055, crownY: 0.035, crownZ: 0.025, wrinkle: 0.010, segs: [12, 16, 22], phase: ph }), fabric, -0.37, 0.94, bz, sofa);
    bc.rotation.z = 0.16;
  }

  // Softly rolled armrest
  mesh(cushionGeo(1.24, 0.60, 0.32, { round: 0.42, crownX: 0.022, crownY: 0.042, crownZ: 0.024, wrinkle: 0.006, segs: [18, 12, 10], phase: 4.1 }), fabric, 0.01, 0.54, -2.14, sofa);

  // Plump, edge-pinched plaid throw pillows
  const pillowMat = cloth({ map: plaidTex, ...tiled(LINEN, 2, 2, ['normalMap', 'roughnessMap']), normalScale: new THREE.Vector2(1.2, 1.2) });
  for (const [px, py, pz, ry, rz, ph] of [[-0.10, 0.92, -1.42, 0.24, 0.30, 0.9], [-0.12, 0.90, -0.78, -0.18, 0.26, 2.3]]) {
    const p = mesh(cushionGeo(0.21, 0.50, 0.52, { round: 0.50, crownX: 0.035, crownY: 0.015, crownZ: 0.015, wrinkle: 0.007, pinch: 0.82, segs: [10, 18, 18], phase: ph }), pillowMat, px, py, pz, sofa);
    p.rotation.set(0, ry, rz);
  }
  const knit = cloth({ map: knitTex, ...tiled(LINEN, 5, 4, ['normalMap', 'roughnessMap']),
    color: 0xe7dac5, sheenRoughness: 0.6, side: THREE.DoubleSide });
  // Walk one sheet over the seat, around the rounded cushion edge and down to its hem.
  const profile = new THREE.CatmullRomCurve3([
    [-0.24, 0.73], [0.08, 0.74], [0.40, 0.73], [0.57, 0.70],
    [0.65, 0.64], [0.67, 0.53], [0.68, 0.36], [0.71, 0.18],
  ].map(([x, y]) => new THREE.Vector3(x, y, 0)));
  const throwGeo = new THREE.PlaneGeometry(1, 1, 48, 80);
  const { position, uv } = throwGeo.attributes;
  for (let i = 0; i < position.count; i++) {
    const u = uv.getX(i), v = uv.getY(i);
    const center = profile.getPointAt(u), tangent = profile.getTangentAt(u);
    const hanging = smooth(0.54, 1, u);
    const phase = v * 27 + 1.4 * Math.sin(v * 7 + u) + u * 1.6;
    const fold = (0.5 + 0.5 * Math.cos(phase)) ** 2 * (0.035 + 0.07 * hanging);
    const x = center.x - tangent.y * fold;
    const y = center.y + tangent.x * fold + 0.055 * hanging * Math.sin(v * 9);
    const z = 0.50 + (0.5 - v) * (1.36 + hanging * 0.12) + u * 0.17 + 0.025 * Math.sin(5 * u + 8 * v);
    position.setXYZ(i, x, y, z);
  }
  throwGeo.computeVertexNormals();
  mesh(throwGeo, knit, 0, 0, 0, sofa);
  contactShadow(-1.95, 2.6, 2.2, 5.4, 0.9);
}

{
  const wood = interior({ ...tiled(WALNUT, 1, 1), roughness: 0.9 });
  const table = new THREE.Group();
  table.position.set(0.45, 0, 2.35);
  scene.add(table);
  mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.07, 48), wood, 0, 0.47, 0, table);
  mesh(new THREE.CylinderGeometry(0.62, 0.66, 0.42, 32), interior({ color: 0x4a2e1a, roughness: 0.7 }), 0, 0.22, 0, table);
  contactShadow(0.45, 2.35, 2.1, 2.1, 0.85);

  const rugTex = canvasTexture(1024, 1024, (g, w, h) => {
    g.fillStyle = '#c9b49a'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(120,90,70,0.6)'; g.lineWidth = 10;
    for (const r of [480, 440, 300]) { g.beginPath(); g.ellipse(w / 2, h / 2, r, r, 0, 0, Math.PI * 2); g.stroke(); }
    g.fillStyle = 'rgba(140,105,80,0.45)';
    for (let a = 0; a < 48; a++) {
      const ang = a / 48 * Math.PI * 2;
      g.save(); g.translate(w / 2 + Math.cos(ang) * 370, h / 2 + Math.sin(ang) * 370); g.rotate(ang);
      g.fillRect(-14, -14, 28, 28); g.restore();
    }
    for (let i = 0; i < 20000; i++) { g.fillStyle = `rgba(255,240,220,${rand(0, 0.08)})`; g.fillRect(rand(0, w), rand(0, h), 2, 2); }
  });
  const rug = mesh(new THREE.CircleGeometry(1, 64), cloth({ map: rugTex, bumpMap: blobNoise(256, 3000, 1, 3, [6, 6]), bumpScale: 0.8, sheenRoughness: 0.7 }), 0.6, 0.003, 2.2);
  rug.rotation.x = -Math.PI / 2;
  rug.scale.set(2.6, 1.9, 1);

  const mugTex = canvasTexture(512, 256, (g, w, h) => {
    g.fillStyle = '#ece0cb'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#6b5a45';
    for (let r = 0; r < 4; r++) for (let c = 0; c < 12; c++) {
      const x = (c + (r % 2) * 0.5) * w / 12, y = h * 0.3 + r * h * 0.14;
      g.save(); g.translate(x, y);
      for (let k = 0; k < 6; k++) { g.rotate(Math.PI / 3); g.fillRect(-1.5, 0, 3, 9); }
      g.restore();
    }
  });
  const mugMat = new THREE.MeshPhysicalMaterial({ fog: false, map: mugTex, roughness: 0.45, clearcoat: 0.8, clearcoatRoughness: 0.12 });
  const profile = [[0, 0], [0.072, 0], [0.08, 0.008], [0.085, 0.04], [0.085, 0.14], [0.08, 0.145], [0.075, 0.14], [0.075, 0.012], [0, 0.012]]
    .map(([a, b]) => new THREE.Vector2(a, b));
  const steamMat = (s) => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: { value: 0 }, uSeed: { value: s } },
    vertexShader: UV_VERT,
    fragmentShader: GLSL_NOISE + /* glsl */`
      uniform float uTime, uSeed;
      varying vec2 vUv;
      void main(){
        float n = fbm(vec2(vUv.x * 2.6 + uSeed, vUv.y * 2.0 - uTime * 0.38));
        float n2 = fbm(vec2(vUv.x * 5.2 - uSeed, vUv.y * 3.8 - uTime * 0.55));
        float x = vUv.x - 0.5 + (n - 0.5) * 0.65 * vUv.y;
        float wisp = smoothstep(0.28, 0.0, abs(x)) * smoothstep(0.0, 0.22, vUv.y) * smoothstep(1.0, 0.25, vUv.y);
        gl_FragColor = vec4(vec3(1.0, 0.94, 0.88), wisp * (0.45 + 0.55 * n2) * n * 0.16);
      }`,
  });
  for (const [mx, mz, ry, s] of [[-0.12, 0.25, 0.4, 1.0], [0.72, 0.18, 2.4, 7.0]]) {
    const mug = new THREE.Group();
    mug.position.set(mx, 0.505, mz);
    mug.rotation.y = ry;
    table.add(mug);
    mesh(new THREE.BoxGeometry(0.22, 0.012, 0.22), interior({ color: 0x3a2416, roughness: 0.8 }), 0, 0, 0, mug);
    const body = mesh(new THREE.LatheGeometry(profile, 40), mugMat, 0, 0.006, 0, mug);
    body.material.side = THREE.DoubleSide;
    const handle = mesh(new THREE.TorusGeometry(0.04, 0.011, 10, 20, Math.PI * 1.2), mugMat, 0.088, 0.08, 0, mug);
    handle.rotation.z = -Math.PI * 0.6;
    const coffee = mesh(new THREE.CircleGeometry(0.074, 32), interior({ color: 0x2a160c, roughness: 0.15 }), 0, 0.125, 0, mug);
    coffee.rotation.x = -Math.PI / 2;
    const sm = steamMat(s);
    const steam = mesh(new THREE.PlaneGeometry(0.22, 0.45), sm, mx, 0.505 + 0.36, mz, table);
    billboard(steam);
    updates.push((t) => { sm.uniforms.uTime.value = t; });
  }
  candle({ x: 0.55, y: 0.505, z: 2.15, r: 0.055, h: 0.11, jar: true, light: 0.7, shadow: true });

  const vase = prepInteriorModel(gltfAssets.driedFlowers.scene.clone(true));
  vase.position.set(0.96, 0.505, 1.84);
  vase.scale.setScalar(0.92);
  vase.rotation.y = 0.6;
  scene.add(vase);

  const mini = new THREE.Group();
  mini.position.set(1.26, 0.505, 2.34);
  scene.add(mini);
  const potProfile = [[0,0],[0.048,0],[0.062,0.09],[0.068,0.095],[0.068,0.11],[0.056,0.11],[0.052,0.095]].map(([a,b])=>new THREE.Vector2(a,b));
  mesh(new THREE.LatheGeometry(potProfile, 24), interior({ color: 0x7b4730, roughness: 0.78 }), 0, 0, 0, mini);
  mesh(new THREE.CylinderGeometry(0.052, 0.05, 0.012, 16), interior({ color: 0x261a12, roughness: 1 }), 0, 0.094, 0, mini);
  mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.28, 8), interior({ color: 0x3b2618, roughness: 0.95 }), 0, 0.22, 0, mini);
  const miniLeafM = interior({ color: 0x26442c, roughness: 0.88, side: THREE.DoubleSide });
  for (let t = 0; t < 6; t++) {
    const k = t / 5;
    const count = Math.round(10 - k * 5);
    const y = 0.12 + k * 0.23;
    const len = 0.13 * (1 - k * 0.65);
    for (let j = 0; j < count; j++) {
      const a = (j / count) * Math.PI * 2 + t * 0.7 + rand(-0.15, 0.15);
      const sprig = mesh(new THREE.ConeGeometry(0.022 * (1 - k * 0.4), len, 5), miniLeafM, Math.cos(a) * len * 0.42, y, Math.sin(a) * len * 0.42, mini);
      sprig.rotation.order = 'YXZ';
      sprig.rotation.y = -a + Math.PI / 2;
      sprig.rotation.x = Math.PI / 2 - 0.35 + k * 0.35;
    }
  }
}

{
  const side = new THREE.Group();
  side.position.set(-1.25, 0, -2.45);
  scene.add(side);
  const wood = interior({ ...tiled(WALNUT, 0.7, 0.7), roughness: 0.9, color: 0xc8a890 });
  box(1.3, 0.05, 0.42, wood, 0, 0.58, 0, side);
  box(1.3, 0.04, 0.42, wood, 0, 0.04, 0, side);
  box(0.05, 0.56, 0.42, wood, -0.63, 0.3, 0, side);
  box(0.05, 0.56, 0.42, wood, 0.63, 0.3, 0, side);
  for (const [bx, ry, scB] of [[-0.28, 0.08, 1.35], [0.22, -0.18, 1.25]]) {
    const bk = prepInteriorModel(gltfAssets.books.scene.clone(true));
    bk.position.set(bx, 0.06, 0.02);
    bk.scale.setScalar(scB);
    bk.rotation.y = ry;
    side.add(bk);
  }
  const mug = mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.1, 20), interior({ color: 0x5a524c, roughness: 0.5 }), -0.35, 0.655, 0.02, side);
  mug.castShadow = false;
  const cone = mesh(new THREE.SphereGeometry(0.05, 10, 8), interior({ color: 0x4a2e1c, roughness: 1 }), 0.12, 0.64, 0.05, side);
  cone.scale.set(0.8, 1.2, 0.8);
  for (let i = 0; i < 6; i++) {
    const b = mesh(new THREE.SphereGeometry(0.018, 8, 6), interior({ color: 0x8a1010, roughness: 0.4 }), -0.05 + rand(-0.05, 0.05), 0.62, 0.08 + rand(-0.03, 0.03), side);
    b.position.y += rand(0, 0.02);
  }
  for (let i = 0; i < 14; i++) {
    const needle = mesh(new THREE.ConeGeometry(0.02, 0.2, 5), interior({ color: 0x24402c, roughness: 0.9 }), -0.15 + rand(-0.15, 0.1), 0.62, 0.05, side);
    needle.rotation.set(Math.PI / 2 - 0.1, 0, rand(-1.5, 1.5));
  }
  candle({ x: -1.0, y: 0.605, z: -2.45, r: 0.05, h: 0.1, jar: true, light: 0.9 });
  contactShadow(-1.25, -2.45, 1.7, 0.8, 0.7);
}

{
  const lamp = new THREE.Group();
  lamp.position.set(-3.45, 0, -1.9);
  scene.add(lamp);
  const wood = interior({ ...tiled(WALNUT, 0.4, 0.4), roughness: 0.9, color: 0xb09080 });
  box(0.6, 0.72, 0.55, wood, 0, 0.36, 0, lamp);
  const lampModel = prepInteriorModel(gltfAssets.tableLamp.scene.clone(true), { cast: false });
  lampModel.position.set(0, 0.72, 0);
  lampModel.scale.setScalar(1.62);
  lampModel.rotation.y = 0.55;
  lampModel.traverse((o) => {
    if (!o.isMesh) return;
    o.userData.noShadow = true;
    const m = o.material;
    // Give the pleated linen shade a warm interior-bulb glow without washing out the wooden base.
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vLampY;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLampY = position.y;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vLampY;')
        .replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\n' +
          'float shadeBand = smoothstep(0.24, 0.30, vLampY) * (1.0 - smoothstep(0.47, 0.52, vLampY));\n' +
          'float bulbHot = 0.55 + 0.65 * exp(-pow((vLampY - 0.37) / 0.09, 2.0));\n' +
          'totalEmissiveRadiance += vec3(1.15, 0.68, 0.26) * shadeBand * bulbHot;',
        );
    };
  });
  lamp.add(lampModel);
  const bulbGlow = glow(0xffb060, 1.8, 0.35);
  bulbGlow.position.set(0, 1.4, 0);
  lamp.add(bulbGlow);
  const pl = castShadows(new THREE.PointLight(0xffa452, 5, 0, 2));
  pl.position.set(0, 1.35, 0.15);
  lamp.add(pl);
  contactShadow(-3.45, -1.9, 1.0, 0.9, 0.7);
}

{
  const shelfM = interior({ color: 0x5a3c24, roughness: 0.7 });
  box(1.0, 0.05, 0.28, shelfM, -3.85, 2.85, -2.75);
  box(0.9, 0.05, 0.28, shelfM, 3.8, 2.15, -2.75);
  candle({ x: -3.6, y: 2.875, z: -2.72, r: 0.05, h: 0.12, jar: true, light: 0.6 });
  candle({ x: 3.95, y: 2.175, z: -2.72, r: 0.05, h: 0.12, jar: true, light: 0.6 });
  mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.16, 16), interior({ color: 0xd8c8b0, roughness: 0.8 }), -4.05, 2.955, -2.75);
  mesh(new THREE.CylinderGeometry(0.08, 0.065, 0.14, 16), interior({ color: 0xd8c8b0, roughness: 0.8 }), 3.6, 2.245, -2.75);
  const leafGeo = new THREE.CircleGeometry(0.035, 6);
  leafGeo.scale(1, 1.6, 1);
  const leafMat = interior({ color: 0x3a5a2e, roughness: 0.8, side: THREE.DoubleSide });
  const ivy = new THREE.InstancedMesh(leafGeo, leafMat, 600);
  const m4 = new THREE.Matrix4();
  let n = 0;
  for (const [ox, oy, strands, len] of [[-4.05, 3.0, 7, 1.6], [3.6, 2.3, 5, 1.1]]) {
    for (let s = 0; s < strands; s++) {
      const dx = rand(-0.35, 0.35), dz = rand(0.0, 0.2), l = len * rand(0.5, 1);
      for (let k = 0; k < 40 && n < 600; k++, n++) {
        const u = k / 40;
        const p = new THREE.Vector3(ox + dx * Math.sin(u * 1.6) + Math.sin(u * 9 + s) * 0.04, oy - u * l, -2.75 + dz * u + 0.05);
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rand(-0.6, 0.6), rand(-1, 1), rand(-0.8, 0.8)));
        const sc = rand(0.7, 1.2) * (1 - u * 0.3);
        m4.compose(p.add(new THREE.Vector3(rand(-0.04, 0.04), 0, rand(-0.03, 0.05))), q, new THREE.Vector3(sc, sc, sc));
        ivy.setMatrixAt(n, m4);
        ivy.setColorAt(n, new THREE.Color().setHSL(rand(0.26, 0.31), rand(0.35, 0.5), rand(0.18, 0.3)));
      }
    }
  }
  ivy.count = n;
  scene.add(ivy);
}

// ---------- christmas tree ----------
// Paint one spruce bough with a woody spine, paired side shoots and individual needles.
function spruceTexture() {
  return canvasTexture(512, 256, (ctx, w, h) => {
    ctx.lineCap = 'round';
    function stroke(x, y, x1, y1, width, color) {
      ctx.lineWidth = width;
      ctx.strokeStyle = color;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x1, y1); ctx.stroke();
    }
    function shoot(x, y, dx, dy) {
      stroke(x, y, x + dx, y + dy, 3, '#504839');
      const length = Math.hypot(dx, dy);
      for (let n = 0; n < 33; n++) {
        const t = n / 33;
        for (const side of [-1, 1]) {
          const reach = rand(6, 15) * (1 - 0.55 * t) / length;
          const forward = rand(0.6, 1.5);
          const nx = x + dx * t, ny = y + dy * t;
          stroke(nx, ny, nx + reach * (forward * dx - side * dy),
            ny + reach * (forward * dy + side * dx), rand(1.5, 3.4),
            pick(['#324b38', '#425c43', '#54704f', '#667d5a']));
        }
      }
    }
    stroke(4, h / 2, w - 14, h / 2, 5, '#544537');
    for (const side of [-1, 1]) {
      for (let i = 0; i < 18; i++) {
        const t = (i + rand(0, 0.7)) / 18;
        const reach = (0.38 + 0.62 * Math.sin(Math.PI * t)) * (1 - 0.55 * t);
        shoot(8 + t * (w - 60), h / 2, rand(48, 88) * (1 - t * 0.55),
          side * reach * rand(92, 132));
      }
    }
    shoot(w * 0.83, h / 2, w * 0.15, 0);
  });
}

{
  const tree = new THREE.Group();
  tree.position.set(2.35, 0, -1.85);
  scene.add(tree);
  const BASE = 0.42, TOP = 3.05, R = 0.95;
  const radiusAt = (y) => R * Math.pow(1 - (y - BASE) / (TOP - BASE), 0.92) + 0.03;

  mesh(new THREE.CylinderGeometry(0.42, 0.34, 0.38, 24), interior({ color: 0x8a6a44, roughness: 1, map: knitTex }), 0, 0.19, 0, tree);
  mesh(new THREE.CylinderGeometry(0.012, 0.076, TOP - 0.25, 10), interior({ color: 0x4b3827 }),
    0, (TOP + 0.25) / 2, 0, tree);

  const branchGeo = new THREE.PlaneGeometry(1, 1, 12, 6);
  const { position, uv } = branchGeo.attributes;
  for (let i = 0; i < position.count; i++) {
    const u = uv.getX(i), across = 0.5 - uv.getY(i);
    const droop = -0.19 * Math.sin(u * Math.PI * 0.85) - 0.03 * u;
    position.setXYZ(i, u, droop - 0.14 * Math.abs(across), across);
  }
  branchGeo.computeVertexNormals();

  const variants = Array.from({ length: 3 }, () => ({
    material: interior({ map: spruceTexture(), side: THREE.DoubleSide, alphaTest: 0.32, alphaToCoverage: true, roughness: 0.95 }),
    transforms: [],
  }));
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const tips = [];
  const tip = new THREE.Vector3(0.98, -0.12, 0);
  for (let y = BASE + 0.13; y < TOP; y += 0.095) {
    const r = radiusAt(y);
    const count = Math.max(5, Math.round(r * 22));
    const start = rand(0, Math.PI * 2);
    for (let i = 0; i < count; i++) {
      const az = start + (i + rand(-0.3, 0.3)) * Math.PI * 2 / count;
      const length = r * rand(0.76, 1.13);
      q.setFromEuler(new THREE.Euler(rand(-0.55, 0.55), az, rand(-0.16, 0.26), 'YXZ'));
      m4.compose(new THREE.Vector3(0, y + rand(-0.035, 0.035), 0), q,
        new THREE.Vector3(length, length, 0.06 + length * rand(0.39, 0.64)));
      pick(variants).transforms.push(m4.clone());
      tips.push(tip.clone().applyMatrix4(m4));
    }
  }
  for (const { material, transforms } of variants) {
    const branches = new THREE.InstancedMesh(branchGeo, material, transforms.length);
    transforms.forEach((transform, i) => branches.setMatrixAt(i, transform));
    tree.add(branches);
  }

  const lightsN = 210;
  const lpos = new Float32Array(lightsN * 3), ldata = new Float32Array(lightsN * 2);
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.014, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffd9a0, fog: false }), lightsN);
  for (let i = 0; i < lightsN; i++) {
    const p = pick(tips).clone();
    const inset = rand(0.73, 1.0);
    p.x *= inset; p.z *= inset;
    p.y += rand(0, 0.025);
    lpos.set([p.x, p.y, p.z], i * 3);
    ldata.set([rand(0, 6.28), rand(0.6, 2.2)], i * 2);
    m4.makeTranslation(p.x, p.y, p.z);
    bulbs.setMatrixAt(i, m4);
  }
  tree.add(bulbs);
  const lgeo = new THREE.BufferGeometry();
  lgeo.setAttribute('position', new THREE.BufferAttribute(lpos, 3));
  lgeo.setAttribute('data', new THREE.BufferAttribute(ldata, 2));
  const lmat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uScale: { value: H * 0.5 } },
    vertexShader: /* glsl */`
      attribute vec2 data;
      uniform float uTime, uScale;
      varying float vI;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vI = 0.65 + 0.35 * sin(uTime * data.y + data.x);
        #ifdef WINDOW_REFLECTION
          // Intersect the sightline to the virtual bulb with the window.
          vec3 bulb = (modelMatrix * vec4(position, 1.0)).xyz;
          bulb.z = 2.0 * ${paneZ} - bulb.z;
          float t = (cameraPosition.z - ${paneZ}) / (cameraPosition.z - bulb.z);
          vec3 hit = mix(cameraPosition, bulb, t);
          if (t <= 0.0 || t >= 1.0 || hit.x < ${WIN.x0} || hit.x > ${WIN.x1.toFixed(1)} ||
              hit.y < ${WIN.y0} || hit.y > ${WIN.y1.toFixed(1)}) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            gl_PointSize = 1.0;
            return;
          }
          mv = viewMatrix * vec4(hit, 1.0);
          vI *= 0.10;
          gl_PointSize = 0.22 * uScale / -(viewMatrix * vec4(bulb, 1.0)).z;
        #else
          gl_PointSize = 0.22 * uScale / -mv.z;
        #endif
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying float vI;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        float core = smoothstep(0.12, 0.0, d);
        float halo = smoothstep(0.5, 0.0, d);
        vec3 c = vec3(1.0, 0.72, 0.38);
        gl_FragColor = vec4(c * (core * 3.0 + halo * halo * 0.6) * vI, 1.0);
      }`,
  });
  const lpoints = new THREE.Points(lgeo, lmat);
  lpoints.frustumCulled = false;
  tree.add(lpoints);
  const reflectionMat = lmat.clone();
  reflectionMat.defines = { WINDOW_REFLECTION: 1 };
  reflectionMat.uniforms.uTime = lmat.uniforms.uTime;
  const reflections = new THREE.Points(lgeo, reflectionMat);
  reflections.frustumCulled = false;
  tree.add(reflections);

  const ornGeo = new THREE.SphereGeometry(0.055, 18, 12);
  const ornMats = [
    interior({ color: 0x7a0e12, metalness: 0.55, roughness: 0.25 }),
    interior({ color: 0xc89a48, metalness: 0.85, roughness: 0.25 }),
    interior({ color: 0x1e2a58, metalness: 0.6, roughness: 0.25 }),
  ];
  const ornamentTips = tips.filter((t) => t.y < TOP - 0.3);
  for (let i = 0; i < 52; i++) {
    const tip = ornamentTips.splice(Math.floor(rand(0, ornamentTips.length)), 1)[0];
    const o = mesh(ornGeo, pick(ornMats), tip.x, tip.y - 0.055, tip.z, tree);
    o.scale.setScalar(rand(0.8, 1.35));
  }

  const starPos = [];
  const R_OUT = 0.145, R_IN = 0.056, Z_APEX = 0.048;
  for (let i = 0; i < 10; i++) {
    const a0 = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const a1 = ((i + 1) / 10) * Math.PI * 2 + Math.PI / 2;
    const r0 = i % 2 === 0 ? R_OUT : R_IN;
    const r1 = (i + 1) % 2 === 0 ? R_OUT : R_IN;
    const x0 = Math.cos(a0) * r0, y0 = Math.sin(a0) * r0;
    const x1 = Math.cos(a1) * r1, y1 = Math.sin(a1) * r1;
    starPos.push(0, 0, Z_APEX, x0, y0, 0, x1, y1, 0);
    starPos.push(0, 0, -Z_APEX, x1, y1, 0, x0, y0, 0);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  starGeo.computeVertexNormals();
  const starMesh = mesh(starGeo,
    interior({ color: 0xe6be68, emissive: 0xffa838, emissiveIntensity: 1.05, metalness: 0.86, roughness: 0.22 }), 0, TOP + 0.09, 0, tree);
  starMesh.rotation.y = 0.25;
  const starGlow = glow(0xffc070, 0.9, 0.5);
  starGlow.position.set(0, TOP + 0.08, 0.05);
  tree.add(starGlow);

  const tl = castShadows(new THREE.PointLight(0xffcf94, 5, 0, 2));
  tl.position.set(-0.4, 1.5, 0.9);
  tree.add(tl);
  updates.push((t) => {
    lmat.uniforms.uTime.value = t;
    tl.intensity = 5 + Math.sin(t * 1.3) * 0.4;
  });

  for (const [gx, gz, scG, ry] of [[-0.25, 0.72, 1.08, 0.25], [0.58, 0.56, 0.92, -1.35]]) {
    const gifts = prepInteriorModel(gltfAssets.giftSet.scene.clone(true));
    gifts.position.set(gx, 0, gz);
    gifts.scale.setScalar(scG);
    gifts.rotation.y = ry;
    tree.add(gifts);
  }
  for (let i = 0; i < 5; i++) {
    const b = mesh(new THREE.SphereGeometry(0.08, 18, 12), pick(ornMats), rand(-0.9, 0.9), 0.08, rand(0.7, 1.2), tree);
    b.scale.setScalar(rand(0.8, 1.2));
  }
  contactShadow(2.35, -1.85, 2.6, 2.6, 0.9);
}

// ---------- wood stove ----------
{
  const stove = new THREE.Group();
  stove.position.set(3.92, 0, -0.78);
  stove.rotation.y = -0.88;
  scene.add(stove);

  // Beveled dark slate hearth pad
  const hearth = mesh(
    new RoundedBoxGeometry(1.55, 0.06, 1.35, 2, 0.015),
    interior({ ...tiled(WALL, 1.2, 1.2, ['normalMap', 'roughnessMap']), color: 0x3b3532, roughness: 0.88 }),
    0, 0.03, 0.16, stove,
  );
  hearth.receiveShadow = true;

  // Cast-iron wood stove (CC0 3D model, 0.56 x 2.02 x 0.52 m -> scaled 1.55x)
  const stoveModel = prepInteriorModel(gltfAssets.woodStove.scene.clone(true));
  stoveModel.position.set(0, 0.055, 0);
  stoveModel.scale.setScalar(1.58);
  stove.add(stoveModel);
  // Extend the cast-iron flue pipe seamlessly into the ceiling
  mesh(new THREE.CylinderGeometry(0.115, 0.115, 1.1, 20), interior({ color: 0x151414, roughness: 0.52, metalness: 0.65 }), 0, 3.45, -0.04, stove);

  // Animated volumetric fire & glowing ember bed visible through the stove's glass window
  const fireBack = mesh(new THREE.PlaneGeometry(0.42, 0.34), new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: UV_VERT,
    fragmentShader: GLSL_NOISE + /* glsl */`
      uniform float uTime;
      varying vec2 vUv;
      void main(){
        float n = fbm(vUv * vec2(5.0, 3.0) + vec2(0.0, -uTime * 0.3));
        float g = smoothstep(0.58, 0.0, vUv.y) * (0.25 + n * 0.75);
        vec3 c = mix(vec3(0.02, 0.008, 0.004), vec3(0.7, 0.2, 0.04), g * g);
        gl_FragColor = vec4(c, 1.0);
      }`,
  }), 0, 0.72, 0.39, stove);
  const fireMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 } },
    vertexShader: UV_VERT,
    fragmentShader: GLSL_NOISE + /* glsl */`
      uniform float uTime;
      varying vec2 vUv;
      void main(){
        vec2 uv = vUv;
        float n = fbm(vec2(uv.x * 4.2, uv.y * 2.8 - uTime * 2.1));
        float n2 = fbm(vec2(uv.x * 9.0 + 3.1, uv.y * 5.0 - uTime * 3.3));
        float xd = abs(uv.x - 0.5) * 2.0;
        float tongues = 0.5 + 0.5 * sin(uv.x * 19.0 + n * 6.0);
        float body = 0.92 - uv.y * (1.35 - tongues * 0.45) - xd * xd * 1.15;
        float f = body + (n - 0.5) * 0.95 + (n2 - 0.5) * 0.45;
        float a = smoothstep(0.02, 0.22, f);
        vec3 c = mix(vec3(0.75, 0.09, 0.0), vec3(1.0, 0.42, 0.06), smoothstep(0.05, 0.35, f));
        c = mix(c, vec3(1.0, 0.88, 0.55), smoothstep(0.35, 0.75, f));
        gl_FragColor = vec4(c * a * 2.1, 1.0);
      }`,
  });
  mesh(new THREE.PlaneGeometry(0.40, 0.32), fireMat, 0, 0.72, 0.415, stove);

  const fireGlow = glow(0xff7a30, 1.9, 0.32);
  fireGlow.position.set(0, 0.74, 0.50);
  stove.add(fireGlow);
  const fl = castShadows(new THREE.PointLight(0xff7a2e, 6.2, 0, 2));
  fl.position.set(0, 0.72, 0.95);
  stove.add(fl);
  updates.push((t) => {
    fireMat.uniforms.uTime.value = t;
    fireBack.material.uniforms.uTime.value = t;
    const f = 1 + 0.18 * Math.sin(t * 7.1) * Math.sin(t * 2.3 + 1) + 0.1 * Math.sin(t * 13.7 + 2);
    fl.intensity = 6.2 * f;
    fireGlow.material.opacity = 0.30 * f;
  });
  contactShadow(3.92, -0.62, 1.8, 1.6, 0.6);
}

scene.add(new THREE.HemisphereLight(0xceceda, 0x443633, REAL ? 0.12 : 0.28));
if (!REAL) scene.add(new THREE.AmbientLight(0x6a4028, 0.12));

const windowLight = new THREE.SpotLight(0xc5d9ff, 17, 12, 1.0, 0.85, 2);
windowLight.position.set(-0.8, 2.9, -2.95);
windowLight.target.position.set(-1.0, 0.5, 1.6);
scene.add(windowLight, windowLight.target);
castShadows(windowLight);
const AO_LAYER = 1;
scene.traverse((o) => {
  const m = o.material;
  if (!o.isMesh || !m.isMeshStandardMaterial || m.transparent || m.transmission > 0 || m.fog !== false) return;
  // GTAO's normal override does not preserve the cutouts between spruce needles.
  if (!m.alphaTest) o.layers.enable(AO_LAYER);
  if (!FX.has('shadow') || o.userData.noShadow) return;
  o.castShadow = true;
  o.receiveShadow = true;
});

// ---------- post ----------
const target = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, target);
composer.setPixelRatio(1);
composer.setSize(W, H);
composer.addPass(new RenderPass(scene, camera));
if (FX.has('gtao')) {
  const aoCamera = camera.clone();
  aoCamera.layers.set(AO_LAYER);
  updates.push(() => {
    aoCamera.position.copy(camera.position);
    aoCamera.quaternion.copy(camera.quaternion);
    aoCamera.updateMatrixWorld();
  });
  const gtao = new GTAOPass(scene, aoCamera, W, H);
  gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.5, scale: 1.2, samples: 16 });
  gtao.blendIntensity = 1.0;
  composer.addPass(gtao);
}
composer.addPass(new UnrealBloomPass(new THREE.Vector2(W, H), 0.42, 0.55, 0.92));
composer.addPass(new OutputPass());
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uFade: { value: 1 } },
  vertexShader: UV_VERT,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uFade;
    varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float v = smoothstep(1.15, 0.3, length((vUv - 0.5) * vec2(1.5, 1.1)));
      c *= mix(0.62, 1.0, v);
      c += (h(vUv * 1371.0 + fract(uTime * 7.13)) - 0.5) * 0.03;
      gl_FragColor = vec4(c * uFade, 1.0);
    }`,
});
composer.addPass(grade);

// ---------- timeline ----------
const camFrom = { p: new THREE.Vector3(-0.56, 1.05, 5.10), t: new THREE.Vector3(0.88, 1.30, -3) };
const camTo = { p: new THREE.Vector3(-0.42, 1.03, 4.80), t: new THREE.Vector3(0.76, 1.34, -3) };
const look = new THREE.Vector3();
const debugCam = params.get('cam')?.split(',').map(Number);

function renderAt(t) {
  const k = smooth(0, DURATION, t);
  camera.position.lerpVectors(camFrom.p, camTo.p, k);
  camera.position.y += Math.sin(t * 0.7) * 0.008;
  camera.position.x += Math.sin(t * 0.43 + 1) * 0.01;
  look.lerpVectors(camFrom.t, camTo.t, k);
  if (debugCam) { camera.position.set(...debugCam.slice(0, 3)); look.set(...debugCam.slice(3)); }
  camera.lookAt(look);
  camera.updateMatrixWorld();
  for (const u of updates) u(t);
  grade.uniforms.uTime.value = t;
  grade.uniforms.uFade.value = smooth(0, 0.9, t) * (1 - smooth(DURATION - 0.8, DURATION, t));
  composer.render();
}

if (FX.has('env')) {
  for (const u of updates) u(5);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(scene, 0.04, 0.05, 60, { size: 256, position: new THREE.Vector3(0.4, 1.3, 1.2) }).texture;
  scene.environmentIntensity = 0.55;
  pmrem.dispose();
}

window.DURATION = DURATION;
window.renderAt = renderAt;
renderAt(Number(params.get('t') ?? 5));
window.ready = true;

if (params.has('preview')) {
  const start = performance.now();
  const loop = () => { renderAt(((performance.now() - start) / 1000) % DURATION); requestAnimationFrame(loop); };
  loop();
}
