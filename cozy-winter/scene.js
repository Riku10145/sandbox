import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';

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
const FOG = new THREE.Color(0x9c8682);
scene.background = FOG.clone();
scene.fog = new THREE.FogExp2(FOG, 0.03);

const camera = new THREE.PerspectiveCamera(40, W / H, 0.05, 200);

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

function weave(repeat, cell = 8) {
  return canvasTexture(256, 256, (g, w, h) => {
    for (let y = 0; y < h; y += cell) {
      for (let x = 0; x < w; x += cell) {
        const across = ((x + y) / cell) % 2 === 0;
        const grd = across ? g.createLinearGradient(0, y, 0, y + cell) : g.createLinearGradient(x, 0, x + cell, 0);
        const hi = Math.round(rand(190, 235));
        grd.addColorStop(0, '#3a3a3a'); grd.addColorStop(0.5, `rgb(${hi},${hi},${hi})`); grd.addColorStop(1, '#3a3a3a');
        g.fillStyle = grd; g.fillRect(x, y, cell, cell);
      }
    }
  }, { repeat, color: false });
}

const grainRough = canvasTexture(512, 512, (g, w, h) => {
  g.fillStyle = '#7a7a7a'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 3000; i++) {
    g.fillStyle = `rgba(${pick(['30,30,30', '230,230,230'])},${rand(0.03, 0.1)})`;
    g.fillRect(rand(0, w), rand(0, h), rand(20, 160), rand(1, 3));
  }
}, { repeat: [2.5, 2.5], color: false });

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
  interior({ map: floorTex, roughness: 0.85, roughnessMap: grainRough, bumpMap: floorTex, bumpScale: 0.7, color: 0xc8a888 }),
  (ROOM.left + ROOM.right) / 2, 0, (ROOM.front + ROOM.back) / 2);
floor.rotation.x = -Math.PI / 2;

const wallMat = interior({ color: 0xbfa68a, roughness: 0.92, bumpMap: blobNoise(512, 1400, 3, 18, [5, 3]), bumpScale: 0.5 });
const trimMat = interior({ color: 0xe6d6bd, roughness: 0.6 });
const T = 0.22;
function box(w, h, d, mat, x, y, z, parent = scene) {
  return mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z, parent);
}
box(ROOM.right - ROOM.left, WIN.y0, T, wallMat, (ROOM.left + ROOM.right) / 2, WIN.y0 / 2, ROOM.back - T / 2);
box(ROOM.right - ROOM.left, ROOM.ceil - WIN.y1, T, wallMat, (ROOM.left + ROOM.right) / 2, (WIN.y1 + ROOM.ceil) / 2, ROOM.back - T / 2);
box(WIN.x0 - ROOM.left, WIN.y1 - WIN.y0, T, wallMat, (ROOM.left + WIN.x0) / 2, (WIN.y0 + WIN.y1) / 2, ROOM.back - T / 2);
box(ROOM.right - WIN.x1, WIN.y1 - WIN.y0, T, wallMat, (WIN.x1 + ROOM.right) / 2, (WIN.y0 + WIN.y1) / 2, ROOM.back - T / 2);
box(T, ROOM.ceil, ROOM.front - ROOM.back, wallMat, ROOM.left - T / 2, ROOM.ceil / 2, (ROOM.front + ROOM.back) / 2);
box(T, ROOM.ceil, ROOM.front - ROOM.back, wallMat, ROOM.right + T / 2, ROOM.ceil / 2, (ROOM.front + ROOM.back) / 2);
box(ROOM.right - ROOM.left, T, ROOM.front - ROOM.back, interior({ color: 0x9c7a58, roughness: 1 }),
  (ROOM.left + ROOM.right) / 2, ROOM.ceil + T / 2, (ROOM.front + ROOM.back) / 2);
box(ROOM.right - ROOM.left, 0.12, 0.04, trimMat, (ROOM.left + ROOM.right) / 2, 0.06, ROOM.back + 0.02);

{
  const z = ROOM.back + 0.02;
  const f = 0.09;
  const midX = [-0.2, 2.35];
  box(WIN.x1 - WIN.x0 + f * 2, f, 0.14, trimMat, (WIN.x0 + WIN.x1) / 2, WIN.y0, z);
  box(WIN.x1 - WIN.x0 + 0.5, 0.05, 0.3, trimMat, (WIN.x0 + WIN.x1) / 2, WIN.y0 - 0.02, ROOM.back + 0.1);
  box(WIN.x1 - WIN.x0 + f * 2, f, 0.14, trimMat, (WIN.x0 + WIN.x1) / 2, WIN.y1, z);
  box(WIN.x1 - WIN.x0, 0.12, 0.16, trimMat, (WIN.x0 + WIN.x1) / 2, 3.0, z);
  box(f, WIN.y1 - WIN.y0, 0.14, trimMat, WIN.x0, (WIN.y0 + WIN.y1) / 2, z);
  box(f, WIN.y1 - WIN.y0, 0.14, trimMat, WIN.x1, (WIN.y0 + WIN.y1) / 2, z);
  for (const x of midX) box(0.12, WIN.y1 - WIN.y0, 0.16, trimMat, x, (WIN.y0 + WIN.y1) / 2, z);
  for (const x of [-2.2, -1.1, 0.9, 1.65]) box(0.04, WIN.y1 - 3.0, 0.08, trimMat, x, (3.0 + WIN.y1) / 2, z);
  box(ROOM.right - ROOM.left, 0.18, 0.18, interior({ color: 0x7a5a3e, roughness: 0.8 }),
    (ROOM.left + ROOM.right) / 2, ROOM.ceil - 0.09, 1.2);
}

// ---------- outside ----------
const GROUND_Y = 0.55;

const skyEnv = (() => {
  const sky = new THREE.Scene();
  sky.add(new THREE.Mesh(new THREE.SphereGeometry(50, 48, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: {
      uTop: { value: new THREE.Color(0x5e5466) },
      uHorizon: { value: new THREE.Color(0xc4aca6) },
      uGround: { value: new THREE.Color(0xd9ccc8) },
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
        c += uWarm * 0.35 * pow(max(0.0, vDir.z), 4.0) * smoothstep(0.5, 0.0, abs(y - 0.1));
        gl_FragColor = vec4(c, 1.0);
      }`,
  })));
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(sky, 0.02).texture;
  pm.dispose();
  return tex;
})();

const outdoor = (opts) => new THREE.MeshStandardMaterial({ envMap: skyEnv, envMapIntensity: 1, roughness: 0.9, ...opts });

const snowBump = canvasTexture(512, 512, (g, w, h) => {
  g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 1800; i++) {
    const v = pick([60, 200]);
    const r = rand(4, 28);
    const x = rand(0, w), y = rand(0, h);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, `rgba(${v},${v},${v},${rand(0.08, 0.25)})`);
    grd.addColorStop(1, `rgba(${v},${v},${v},0)`);
    g.fillStyle = grd; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
}, { repeat: [3, 3], color: false });

const groundTex = canvasTexture(2048, 2048, (g, w, h) => {
  const X = (x) => (x + 40) / 80 * w;
  const Z = (z) => (z + 3.3) / -80 * h;
  g.fillStyle = '#f3ebe7'; g.fillRect(0, 0, w, h);
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
  const bump = snowBump.clone();
  bump.repeat.set(70, 70);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    outdoor({ map: groundTex, bumpMap: bump, bumpScale: 2, roughness: 0.85 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, GROUND_Y, -3.3 - 40);
  scene.add(ground);
}

const snowWhite = outdoor({ color: 0xf4efed, bumpMap: snowBump, bumpScale: 1.5 });
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

function pineTree(x, z, height, radius) {
  const tiers = 9, parts = [];
  for (let i = 0; i < tiers; i++) {
    const k = i / tiers;
    const r = radius * (1 - k * 0.88);
    const h = height * 0.24;
    const g = new THREE.ConeGeometry(r, h, 14, 3);
    const p = g.attributes.position;
    for (let v = 0; v < p.count; v++) {
      if (p.getY(v) < h / 2 - 0.01) {
        const j = rand(0.75, 1.2);
        p.setX(v, p.getX(v) * j);
        p.setZ(v, p.getZ(v) * j);
        p.setY(v, p.getY(v) + rand(-0.1, 0.05) * h);
      }
    }
    g.computeVertexNormals();
    g.translate(0, height * 0.1 + k * height * 0.76 + h / 2, 0);
    parts.push(g);
  }
  const geo = colorByUp(mergeGeometries(parts), new THREE.Color(0x14211b), snowCol, 0.25, 0.65, 0.45);
  const m = new THREE.Mesh(geo, treeMat);
  m.position.set(x, GROUND_Y, z);
  scene.add(m);
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

function house({ x, z, w, d, h, rot = 0, color = 0xd9ceb4, porchLight = 0 }) {
  const g = new THREE.Group();
  g.position.set(x, GROUND_Y, z);
  g.rotation.y = rot;
  scene.add(g);
  const wallM = outdoor({ color, map: sidingTex, bumpMap: sidingTex, bumpScale: 1.2, roughness: 0.8 });
  box(w, h, d, wallM, 0, h / 2, 0, g);
  const roofH = w * 0.32;
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2 - 0.4, -0.05); shape.lineTo(0, roofH); shape.lineTo(w / 2 + 0.4, -0.05); shape.lineTo(-w / 2 - 0.4, -0.05);
  const roof = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: d + 0.8, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 2 }), snowWhite);
  roof.position.set(0, h, -d / 2 - 0.4);
  g.add(roof);
  const fascia = outdoor({ color: 0xece4d8, roughness: 0.7 });
  for (const sx of [-1, 1]) {
    const len = Math.hypot(w / 2 + 0.4, roofH + 0.05);
    const trim = box(len, 0.14, 0.08, fascia, sx * (w / 4 + 0.2), h + roofH / 2 - 0.12, d / 2 + 0.42, g);
    trim.rotation.z = -sx * Math.atan2(roofH + 0.05, w / 2 + 0.4);
  }
  const gable = new THREE.Shape();
  gable.moveTo(-w / 2, 0); gable.lineTo(0, roofH * 0.92); gable.lineTo(w / 2, 0);
  const gm = new THREE.Mesh(new THREE.ShapeGeometry(gable), outdoor({ color, roughness: 0.8 }));
  gm.position.set(0, h, d / 2 + 0.01);
  g.add(gm);
  box(0.6, 1.4, 0.6, outdoor({ color: 0x7a5646 }), w * 0.25, h + roofH * 0.6, -d * 0.1, g);
  mesh(new RoundedBoxGeometry(0.78, 0.2, 0.78, 2, 0.08), snowWhite, w * 0.25, h + roofH * 0.6 + 0.75, -d * 0.1, g);

  const lit = new THREE.MeshBasicMaterial({ map: windowTex });
  const litDim = new THREE.MeshBasicMaterial({ map: windowTex, color: 0x6a5048 });
  const frameM = outdoor({ color: 0xf0e8dc, roughness: 0.6 });
  const cols = Math.max(2, Math.floor(w / 1.6));
  for (let fl = 0; fl < 2; fl++) {
    for (let c = 0; c < cols; c++) {
      const wx = -w / 2 + (c + 0.5) * (w / cols);
      const wy = fl === 0 ? 1.3 : h - 1.0;
      box(1.0, 1.3, 0.06, frameM, wx, wy, d / 2 + 0.02, g);
      box(0.82, 1.1, 0.06, rand() < 0.6 ? lit : litDim, wx, wy, d / 2 + 0.04, g);
      mesh(new RoundedBoxGeometry(1.05, 0.1, 0.22, 2, 0.04), snowWhite, wx, wy - 0.68, d / 2 + 0.1, g);
    }
  }
  box(1.4, 1.6, 0.06, lit, 0, h + roofH * 0.35, d / 2 + 0.03, g);
  const porch = new THREE.Group();
  g.add(porch);
  porch.position.set(0, 0, d / 2 + 1.1);
  mesh(new RoundedBoxGeometry(w * 0.72, 0.26, 2.5, 2, 0.1), snowWhite, 0, 2.55, 0, porch);
  for (const px of [-w * 0.33, -w * 0.11, w * 0.11, w * 0.33]) box(0.14, 2.5, 0.14, frameM, px, 1.25, 1.1, porch);
  box(w * 0.7, 0.08, 0.08, frameM, 0, 0.9, 1.1, porch);
  for (let i = 0; i < 22; i++) box(0.04, 0.5, 0.04, frameM, -w * 0.33 + i * (w * 0.66 / 21), 0.65, 1.1, porch);
  mesh(new RoundedBoxGeometry(w * 0.7, 0.1, 0.16, 2, 0.04), snowWhite, 0, 0.96, 1.1, porch);
  const halo = glow(0xffb070, 2.2, 0.8, true);
  halo.position.set(0, 2.0, 0.9);
  porch.add(halo);
  if (porchLight) {
    const pl = new THREE.PointLight(0xffa860, porchLight, 16, 2);
    pl.position.set(0, 2.1, 0.8);
    porch.add(pl);
  }
  return g;
}

house({ x: 2.2, z: -21, w: 8, d: 6, h: 4.6, porchLight: 10 });
house({ x: -7.5, z: -27, w: 7, d: 6, h: 4.2, rot: 0.35, color: 0xcdbca0 });
house({ x: 11, z: -25, w: 7, d: 6, h: 4.4, rot: -0.3, color: 0xd6c8b8 });
house({ x: -2.5, z: -36, w: 6, d: 5, h: 4.0, color: 0xc8b8a6 });

for (const [x, z, h, r] of [
  [-6.5, -10, 3.2, 1.3], [-5.4, -13.5, 2.4, 1.0], [5.8, -18, 3.6, 1.5], [7.2, -17, 2.6, 1.1],
  [-1.8, -18.5, 2.2, 0.9], [-10, -20, 4.2, 1.7], [10, -30, 4.5, 1.8], [-14, -32, 5, 2],
  [0.2, -26, 3.2, 1.2], [14, -20, 3.5, 1.4],
]) pineTree(x, z, h, r);

bareTree(2.9, -7.6, 9.0, 1.05, 7);
bareTree(-4.6, -11.5, 7.5, 1.0, 6);
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
  const poleM = outdoor({ color: 0x1e1a18, roughness: 0.45, metalness: 0.6 });
  const headM = new THREE.MeshBasicMaterial({ color: 0xffc070, fog: false });
  for (const [x, z, heads, power] of [[-3.9, -12.5, 2, 14], [0.9, -14.5, 1, 10], [-12, -18, 1, 0], [8.5, -19.5, 1, 0], [-1.2, -30, 1, 0]]) {
    const g = new THREE.Group();
    g.position.set(x, GROUND_Y, z);
    scene.add(g);
    mesh(new THREE.CylinderGeometry(0.045, 0.07, 3.4, 10), poleM, 0, 1.7, 0, g);
    const offs = heads === 2 ? [-0.32, 0.32] : [0];
    if (heads === 2) box(0.7, 0.05, 0.05, poleM, 0, 3.3, 0, g);
    for (const o of offs) {
      box(0.22, 0.3, 0.22, headM, o, 3.55, 0, g);
      box(0.3, 0.05, 0.3, poleM, o, 3.71, 0, g);
      mesh(new RoundedBoxGeometry(0.32, 0.08, 0.32, 2, 0.03), snowWhite, o, 3.76, 0, g);
      const halo = glow(0xffa858, 3.4, 1.0);
      halo.position.set(o, 3.55, 0);
      g.add(halo);
      const halo2 = glow(0xff9a50, 8, 0.28);
      halo2.position.set(o, 3.4, 0);
      g.add(halo2);
    }
    if (power) {
      const pl = new THREE.PointLight(0xffa050, power, 18, 2);
      pl.position.set(0, 3.4, 0.3);
      g.add(pl);
    }
  }
  const strings = [
    [[-11, 2.6, -16], [-6, 2.9, -17.5], 18], [[-6, 2.9, -17.5], [-1.5, 2.7, -18.5], 16],
    [[-16, 3.0, -22], [-10, 3.2, -24], 16], [[6, 2.6, -16.5], [12, 2.9, -18], 16],
  ];
  for (const [a, b, n] of strings) {
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      const p = new THREE.Vector3(...a).lerp(new THREE.Vector3(...b), k);
      p.y -= Math.sin(k * Math.PI) * 0.45;
      const s = glow(0xffc27a, 0.32, 0.9);
      s.position.copy(p);
      scene.add(s);
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
    mesh(new THREE.PlaneGeometry(pw, ph), frostMat, (xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2, ROOM.back - 0.06);
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
  mesh(new THREE.CylinderGeometry(r, r, h, 20), interior({ color: 0xf2e3c8, emissive: 0x6a3a12, emissiveIntensity: 0.6, roughness: 0.6 }), 0, h / 2, 0, g);
  mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.02, 4), interior({ color: 0x111111 }), 0, h + 0.01, 0, g);
  if (jar) {
    mesh(new THREE.CylinderGeometry(r * 1.45, r * 1.45, h * 1.9, 24, 1, true),
      glass(),
      0, h * 0.95, 0, g);
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
  const fabric = cloth({ color: 0xcdb89e, bumpMap: weave([18, 18]), bumpScale: 0.5 });
  const sofa = new THREE.Group();
  sofa.position.set(-1.95, 0, 2.6);
  scene.add(sofa);
  mesh(new RoundedBoxGeometry(1.25, 0.42, 4.4, 4, 0.12), fabric, 0, 0.29, 0, sofa);
  mesh(new RoundedBoxGeometry(1.05, 0.2, 2.1, 4, 0.09), fabric, 0.1, 0.58, -1.05, sofa);
  mesh(new RoundedBoxGeometry(1.05, 0.2, 2.1, 4, 0.09), fabric, 0.1, 0.58, 1.08, sofa);
  const back = mesh(new RoundedBoxGeometry(0.34, 0.82, 4.4, 4, 0.15), fabric, -0.5, 0.86, 0, sofa);
  back.rotation.z = 0.12;
  mesh(new RoundedBoxGeometry(1.25, 0.62, 0.32, 4, 0.14), fabric, 0, 0.55, -2.15, sofa);
  for (const [px, pz, ry] of [[-0.18, -1.4, 0.25], [-0.2, -0.75, -0.15]]) {
    const p = mesh(new RoundedBoxGeometry(0.17, 0.52, 0.55, 4, 0.08), cloth({ map: plaidTex, bumpMap: weave([10, 10], 4), bumpScale: 0.4 }), px, 0.95, pz, sofa);
    p.rotation.set(0, ry, 0.28);
  }
  const knit = cloth({ map: knitTex, bumpMap: knitTex, bumpScale: 3, color: 0xf0e4d0, sheenRoughness: 0.6 });
  const throwTop = mesh(new RoundedBoxGeometry(1.15, 0.1, 1.5, 4, 0.05), knit, 0.12, 0.72, 1.2, sofa);
  throwTop.rotation.set(0.04, 0.12, -0.05);
  const drape = mesh(new RoundedBoxGeometry(0.09, 0.45, 1.3, 3, 0.04), knit, 0.68, 0.5, 1.3, sofa);
  drape.rotation.set(0.05, 0.08, 0.15);
  contactShadow(-1.95, 2.6, 2.2, 5.4, 0.9);
}

{
  const wood = interior({ color: 0x6a4428, roughness: 0.75, roughnessMap: grainRough, map: floorTex, bumpMap: floorTex, bumpScale: 0.4 });
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
        float n = fbm(vec2(vUv.x * 2.5 + uSeed, vUv.y * 2.2 - uTime * 0.45));
        float x = vUv.x - 0.5 + (n - 0.5) * 0.9 * vUv.y;
        float wisp = smoothstep(0.16, 0.0, abs(x)) * smoothstep(0.0, 0.15, vUv.y) * smoothstep(1.0, 0.35, vUv.y);
        gl_FragColor = vec4(vec3(1.0, 0.93, 0.85), wisp * n * 0.35);
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

  const vase = new THREE.Group();
  vase.position.set(0.95, 0.505, 1.85);
  scene.add(vase);
  const vp = [[0, 0], [0.07, 0], [0.09, 0.08], [0.06, 0.2], [0.05, 0.26], [0.06, 0.28]].map(([a, b]) => new THREE.Vector2(a, b));
  mesh(new THREE.LatheGeometry(vp, 32), glass({ color: 0xf6ecdc }), 0, 0, 0, vase);
  const stems = [], heads = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.014, 1), interior({ color: 0xe6d6bc, emissive: 0x4a3420, roughness: 1 }), 420);
  const m4 = new THREE.Matrix4();
  let hi = 0;
  for (let i = 0; i < 28; i++) {
    const az = rand(0, Math.PI * 2), tilt = rand(0.1, 0.6), len = rand(0.26, 0.42);
    const dir = new THREE.Vector3(Math.sin(tilt) * Math.cos(az), Math.cos(tilt), Math.sin(tilt) * Math.sin(az));
    const g = new THREE.CylinderGeometry(0.002, 0.003, len, 3);
    g.translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
    g.translate(0, 0.1, 0);
    stems.push(g);
    const tip = dir.clone().multiplyScalar(len).add(new THREE.Vector3(0, 0.1, 0));
    for (let k = 0; k < 15 && hi < 420; k++, hi++) {
      const p = tip.clone().add(new THREE.Vector3(rand(-0.05, 0.05), rand(-0.035, 0.035), rand(-0.05, 0.05)));
      const s = rand(0.6, 1.3);
      m4.compose(p, new THREE.Quaternion(), new THREE.Vector3(s, s, s));
      heads.setMatrixAt(hi, m4);
    }
  }
  heads.count = hi;
  vase.add(heads);
  mesh(mergeGeometries(stems), interior({ color: 0x8a7458, roughness: 1 }), 0, 0, 0, vase);

  const mini = new THREE.Group();
  mini.position.set(1.25, 0.505, 2.35);
  scene.add(mini);
  mesh(new THREE.CylinderGeometry(0.07, 0.055, 0.1, 20), interior({ color: 0x6a3a22, roughness: 0.8 }), 0, 0.05, 0, mini);
  for (let i = 0; i < 4; i++) mesh(new THREE.ConeGeometry(0.13 - i * 0.025, 0.14, 12), interior({ color: 0x1f3a26, roughness: 0.9 }), 0, 0.15 + i * 0.07, 0, mini);
}

{
  const side = new THREE.Group();
  side.position.set(-1.25, 0, -2.45);
  scene.add(side);
  const wood = interior({ color: 0x6b4a2e, roughness: 0.6 });
  box(1.3, 0.05, 0.42, wood, 0, 0.58, 0, side);
  box(1.3, 0.04, 0.42, wood, 0, 0.04, 0, side);
  box(0.05, 0.56, 0.42, wood, -0.63, 0.3, 0, side);
  box(0.05, 0.56, 0.42, wood, 0.63, 0.3, 0, side);
  const bookCols = [0x6a4a3a, 0x8a7a62, 0x4a3a32, 0xa89070, 0x5a4a40];
  for (let i = 0; i < 4; i++) box(0.5, 0.06, 0.3, interior({ color: bookCols[i], roughness: 0.9 }), -0.25 + rand(-0.04, 0.04), 0.09 + i * 0.065, 0, side);
  for (let i = 0; i < 3; i++) box(0.45, 0.07, 0.3, interior({ color: bookCols[i + 2], roughness: 0.9 }), 0.3, 0.095 + i * 0.075, 0, side);
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
  const wood = interior({ color: 0x5a3c24, roughness: 0.6 });
  box(0.6, 0.72, 0.55, wood, 0, 0.36, 0, lamp);
  const base = [[0, 0], [0.12, 0], [0.13, 0.05], [0.09, 0.12], [0.11, 0.3], [0.05, 0.42], [0.02, 0.5], [0, 0.5]].map(([a, b]) => new THREE.Vector2(a, b));
  mesh(new THREE.LatheGeometry(base, 32), interior({ color: 0x3a2214, roughness: 0.3, metalness: 0.2 }), 0, 0.72, 0, lamp);
  const shade = mesh(new THREE.CylinderGeometry(0.2, 0.34, 0.38, 40, 1, true),
    interior({ color: 0xf0c890, emissive: 0xffa040, emissiveIntensity: 1.4, roughness: 1, side: THREE.DoubleSide }), 0, 1.45, 0, lamp);
  shade.userData.noShadow = true;
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
{
  const tree = new THREE.Group();
  tree.position.set(2.35, 0, -1.85);
  scene.add(tree);
  const BASE = 0.42, TOP = 3.05, R = 0.95;
  const radiusAt = (y) => R * Math.pow(1 - (y - BASE) / (TOP - BASE), 0.92) + 0.03;

  mesh(new THREE.CylinderGeometry(0.42, 0.34, 0.38, 24), interior({ color: 0x8a6a44, roughness: 1, map: knitTex }), 0, 0.19, 0, tree);
  mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.6, 8), interior({ color: 0x3a2a1c }), 0, 0.5, 0, tree);
  mesh(new THREE.ConeGeometry(R * 0.72, TOP - BASE, 16), interior({ color: 0x0a150d, roughness: 1 }), 0, (BASE + TOP) / 2, 0, tree);

  const branchGeo = new THREE.ConeGeometry(0.075, 1, 5);
  branchGeo.translate(0, 0.5, 0);
  branchGeo.rotateZ(-Math.PI / 2);
  branchGeo.scale(1, 0.55, 1.3);
  const branchMat = interior({ color: 0xffffff, roughness: 0.85 });
  const MAX = 6000;
  const branches = new THREE.InstancedMesh(branchGeo, branchMat, MAX);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  let n = 0;
  const tips = [];
  for (let y = BASE; y < TOP - 0.05; y += 0.022) {
    const r = radiusAt(y);
    const count = Math.max(6, Math.round(r * 42));
    for (let i = 0; i < count && n < MAX; i++, n++) {
      const az = rand(0, Math.PI * 2);
      const len = r * rand(0.8, 1.1);
      const droop = rand(0.15, 0.45);
      q.setFromEuler(new THREE.Euler(rand(-0.4, 0.4), az, -droop, 'YXZ'));
      m4.compose(new THREE.Vector3(0, y, 0), q, new THREE.Vector3(len, rand(0.8, 1.3), 1));
      branches.setMatrixAt(n, m4);
      branches.setColorAt(n, new THREE.Color().setHSL(rand(0.34, 0.42), rand(0.3, 0.5), rand(0.06, 0.13)));
      tips.push({ y: y - Math.sin(droop) * len, az, r: Math.cos(droop) * len });
    }
  }
  branches.count = n;
  tree.add(branches);

  const lightsN = 340;
  const lpos = new Float32Array(lightsN * 3), ldata = new Float32Array(lightsN * 2);
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.014, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffd9a0, fog: false }), lightsN);
  for (let i = 0; i < lightsN; i++) {
    const tip = pick(tips);
    const k = rand(0.82, 1.0);
    const p = new THREE.Vector3(Math.cos(tip.az) * tip.r * k, tip.y + 0.03, -Math.sin(tip.az) * tip.r * k);
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
        gl_Position = projectionMatrix * mv;
        vI = 0.65 + 0.35 * sin(uTime * data.y + data.x);
        gl_PointSize = 0.22 * uScale / -mv.z;
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

  const ornGeo = new THREE.SphereGeometry(0.055, 18, 12);
  const ornMats = [
    interior({ color: 0x7a0e12, metalness: 0.55, roughness: 0.25 }),
    interior({ color: 0xc89a48, metalness: 0.85, roughness: 0.25 }),
    interior({ color: 0x1e2a58, metalness: 0.6, roughness: 0.25 }),
  ];
  for (let i = 0; i < 52; i++) {
    const tip = pick(tips.filter((t) => t.y < TOP - 0.3));
    const k = rand(0.7, 0.9);
    const o = mesh(ornGeo, pick(ornMats), Math.cos(tip.az) * tip.r * k, tip.y - 0.04, -Math.sin(tip.az) * tip.r * k, tree);
    o.scale.setScalar(rand(0.8, 1.35));
  }

  const star = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = i / 10 * Math.PI * 2 + Math.PI / 2, r = i % 2 ? 0.06 : 0.15;
    i ? star.lineTo(Math.cos(a) * r, Math.sin(a) * r) : star.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const starMesh = mesh(new THREE.ExtrudeGeometry(star, { depth: 0.03, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.01, bevelSegments: 1 }),
    interior({ color: 0xd8b060, emissive: 0xffb040, emissiveIntensity: 1.6, metalness: 0.8, roughness: 0.3 }), 0, TOP + 0.08, 0, tree);
  starMesh.rotation.y = 0.3;
  const starGlow = glow(0xffc070, 0.9, 0.5);
  starGlow.position.set(0, TOP + 0.08, 0.05);
  tree.add(starGlow);

  const tl = castShadows(new THREE.PointLight(0xffb060, 5, 0, 2));
  tl.position.set(-0.4, 1.5, 0.9);
  tree.add(tl);
  updates.push((t) => {
    lmat.uniforms.uTime.value = t;
    tl.intensity = 5 + Math.sin(t * 1.3) * 0.4;
  });

  const giftMats = [
    interior({ color: 0xb08a4a, metalness: 0.5, roughness: 0.35 }),
    interior({ color: 0x8a6a38, metalness: 0.4, roughness: 0.4 }),
    interior({ color: 0x6a1a18, roughness: 0.6 }),
  ];
  const ribbon = interior({ color: 0xe8d098, metalness: 0.6, roughness: 0.3 });
  for (const [gx, gz, w, h, d, ry] of [[-0.8, 0.55, 0.45, 0.35, 0.4, 0.3], [-0.25, 0.75, 0.35, 0.28, 0.35, -0.2], [0.55, 0.6, 0.55, 0.42, 0.45, 0.1], [0.3, 0.98, 0.3, 0.22, 0.3, 0.5], [-1.15, 0.0, 0.4, 0.3, 0.4, 0.6]]) {
    const gg = new THREE.Group();
    gg.position.set(gx, 0, gz);
    gg.rotation.y = ry;
    tree.add(gg);
    box(w, h, d, pick(giftMats), 0, h / 2, 0, gg);
    box(w + 0.01, h + 0.01, 0.04, ribbon, 0, h / 2, 0, gg);
    box(0.04, h + 0.01, d + 0.01, ribbon, 0, h / 2, 0, gg);
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
  stove.position.set(3.95, 0, -0.75);
  stove.rotation.y = -0.95;
  scene.add(stove);
  const iron = interior({ color: 0x141212, roughness: 0.55, metalness: 0.5 });
  box(1.5, 0.06, 1.3, interior({ color: 0x5a4a40, roughness: 0.9 }), 0, 0.03, 0.2, stove);
  box(0.9, 0.75, 0.6, iron, 0, 0.55, 0, stove);
  box(0.98, 0.06, 0.68, iron, 0, 0.95, 0, stove);
  for (const lx of [-0.38, 0.38]) for (const lz of [-0.22, 0.22]) box(0.06, 0.18, 0.06, iron, lx, 0.09, lz, stove);
  mesh(new THREE.CylinderGeometry(0.11, 0.11, 3.5, 20), iron, 0, 0.98 + 1.75, -0.05, stove);

  const fireBack = mesh(new THREE.PlaneGeometry(0.66, 0.5), new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: UV_VERT,
    fragmentShader: GLSL_NOISE + /* glsl */`
      uniform float uTime;
      varying vec2 vUv;
      void main(){
        float n = fbm(vUv * vec2(5.0, 3.0) + vec2(0.0, -uTime * 0.3));
        float g = smoothstep(0.55, 0.0, vUv.y) * (0.2 + n * 0.8);
        vec3 c = mix(vec3(0.02, 0.008, 0.004), vec3(0.6, 0.16, 0.03), g * g);
        gl_FragColor = vec4(c, 1.0);
      }`,
  }), 0, 0.57, 0.302, stove);
  const logMat = interior({ color: 0x0e0906, emissive: 0xff3a08, emissiveIntensity: 0.12, roughness: 0.95 });
  for (const [lx, ly, rz] of [[-0.06, 0.39, 0.1], [0.08, 0.42, -0.14]]) {
    const log = mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.55, 10), logMat, lx, ly, 0.29, stove);
    log.rotation.z = Math.PI / 2 + rz;
  }
  const fireMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 } },
    vertexShader: UV_VERT,
    fragmentShader: GLSL_NOISE + /* glsl */`
      uniform float uTime;
      varying vec2 vUv;
      void main(){
        vec2 uv = vUv;
        float n = fbm(vec2(uv.x * 4.0, uv.y * 2.6 - uTime * 2.1));
        float n2 = fbm(vec2(uv.x * 9.0 + 3.1, uv.y * 5.0 - uTime * 3.3));
        float xd = abs(uv.x - 0.5) * 2.0;
        float tongues = 0.5 + 0.5 * sin(uv.x * 19.0 + n * 6.0);
        float body = 0.95 - uv.y * (1.35 - tongues * 0.45) - xd * xd * 1.1;
        float f = body + (n - 0.5) * 1.0 + (n2 - 0.5) * 0.45;
        float a = smoothstep(0.02, 0.22, f);
        vec3 c = mix(vec3(0.7, 0.08, 0.0), vec3(1.0, 0.42, 0.06), smoothstep(0.05, 0.35, f));
        c = mix(c, vec3(1.0, 0.86, 0.5), smoothstep(0.35, 0.75, f));
        gl_FragColor = vec4(c * a * 2.2, 1.0);
      }`,
  });
  mesh(new THREE.PlaneGeometry(0.64, 0.46), fireMat, 0, 0.58, 0.305, stove);
  const frameMat = interior({ color: 0x0c0b0b, roughness: 0.35, metalness: 0.6 });
  box(0.9, 0.08, 0.04, frameMat, 0, 0.32, 0.31, stove);
  box(0.9, 0.12, 0.04, frameMat, 0, 0.86, 0.31, stove);
  box(0.12, 0.5, 0.04, frameMat, -0.39, 0.57, 0.31, stove);
  box(0.12, 0.5, 0.04, frameMat, 0.39, 0.57, 0.31, stove);
  mesh(new THREE.PlaneGeometry(0.66, 0.5), interior({ color: 0x221a14, transparent: true, opacity: 0.12, roughness: 0.05, metalness: 0.2, depthWrite: false }), 0, 0.57, 0.322, stove);

  const fireGlow = glow(0xff7a30, 2.2, 0.35);
  fireGlow.position.set(0, 0.6, 0.45);
  stove.add(fireGlow);
  const fl = castShadows(new THREE.PointLight(0xff7a2e, 6, 0, 2));
  fl.position.set(0, 0.6, 0.9);
  stove.add(fl);
  updates.push((t) => {
    fireMat.uniforms.uTime.value = t;
    fireBack.material.uniforms.uTime.value = t;
    const f = 1 + 0.18 * Math.sin(t * 7.1) * Math.sin(t * 2.3 + 1) + 0.1 * Math.sin(t * 13.7 + 2);
    fl.intensity = 6 * f;
    fireGlow.material.opacity = 0.32 * f;
    logMat.emissiveIntensity = 0.1 + 0.06 * f;
  });
  contactShadow(3.95, -0.6, 1.8, 1.6, 0.6);
}

scene.add(new THREE.HemisphereLight(0xffd8c0, 0x3a2418, REAL ? 0.12 : 0.28));
if (!REAL) scene.add(new THREE.AmbientLight(0x6a4028, 0.12));

const AO_LAYER = 1;
scene.traverse((o) => {
  const m = o.material;
  if (!o.isMesh || !m.isMeshStandardMaterial || m.transparent || m.transmission > 0 || m.fog !== false) return;
  o.layers.enable(AO_LAYER);
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
      c = pow(c, vec3(0.96, 1.0, 1.06));
      c = mix(c, c * vec3(1.04, 0.99, 0.92), 0.6);
      float v = smoothstep(1.15, 0.3, length((vUv - 0.5) * vec2(1.5, 1.1)));
      c *= mix(0.62, 1.0, v);
      c += (h(vUv * 1371.0 + fract(uTime * 7.13)) - 0.5) * 0.03;
      gl_FragColor = vec4(c * uFade, 1.0);
    }`,
});
composer.addPass(grade);

// ---------- timeline ----------
const camFrom = { p: new THREE.Vector3(0.35, 1.68, 6.4), t: new THREE.Vector3(0.35, 1.22, -3) };
const camTo = { p: new THREE.Vector3(0.05, 1.6, 5.75), t: new THREE.Vector3(0.15, 1.28, -3) };
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
