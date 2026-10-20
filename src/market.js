import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createLive, createTown, connectWallet, knownWallet, levelOf, buyUrl, CHAIN } from '../client/live.js';

/* ───────── utils ───────── */
const $ = (q) => document.querySelector(q);
const Q = new URLSearchParams(location.search);
// live edition by default: every vendor comes from the live server; ?demo keeps the sample market
const LIVE = !Q.has('demo');
document.body.classList.toggle('live', LIVE);
const LS = { follow: false, cine: 0 }; // live camera state (filled in by the live layer at the end)
let seed = 20261020;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const rr = (a, b) => a + (b - a) * rnd(), pick = (a) => a[(rnd() * a.length) | 0];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const backOut = (t) => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const HEX = '0123456789abcdef';
const mkAddr = () => { let a = '0x'; for (let i = 0; i < 40; i++) a += HEX[(rnd() * 16) | 0]; return a; };
const short = (a) => a.slice(0, 6) + '…' + a.slice(-4);
const fmt = (n) => (n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 1 : 2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + 'K' : String(Math.round(n)));
const BAND = ['#ffc61a', '#e8434f', '#2f7cf6', '#1fb36b', '#f2f6f7', '#ff7a1a', '#9a63ff', '#ff5fa2', '#a3e635', '#22d3ee'];
const LIGHTB = new Set([0, 4, 8, 9]);
const IS_PHONE = Math.min(innerWidth, innerHeight) < 560;

/* ───────── renderer ───────── */
const cv = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance' });
let PR = Math.min(IS_PHONE ? 1.5 : 2, devicePixelRatio);
renderer.setPixelRatio(PR);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
const scene = new THREE.Scene();
const NIGHT = new THREE.Color('#141634');
scene.background = NIGHT.clone();
scene.fog = new THREE.FogExp2('#1a1838', 0.0062);
const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 2500);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.5, 0.8);
composer.addPass(bloom);
composer.addPass(new OutputPass());
let useBloom = Q.get('bloom') !== '0';

const hemi = new THREE.HemisphereLight('#6a7ad8', '#4a2c1c', 1.25); scene.add(hemi);
const moon = new THREE.DirectionalLight('#9fb2ff', 0.55); moon.position.set(-60, 90, -80); scene.add(moon);
const warm = new THREE.DirectionalLight('#ffa860', 0.35); warm.position.set(40, 25, 90); scene.add(warm);
const flash = new THREE.PointLight('#ffffff', 0, 220, 1.2); flash.position.set(0, 45, 0); scene.add(flash);
// a few warm street lights; everything else is emissive + glow sprites
const PL = [];
for (let i = 0; i < 7; i++) { const p = new THREE.PointLight('#ffa24d', 38, 26, 1.6); p.position.set(i % 2 ? 4 : -4, 5.2, 62 - i * 24); scene.add(p); PL.push(p); }

/* ───────── materials / geometry caches ───────── */
const MATS = {};
const mat = (c, o = {}) => { const k = c + JSON.stringify(o); return MATS[k] || (MATS[k] = new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, flatShading: true, ...o })); };
const emat = (c, i = 1.6) => mat(c, { emissive: c, emissiveIntensity: i, roughness: 0.6 });
const bmat = (c) => { const k = 'B' + c; return MATS[k] || (MATS[k] = new THREE.MeshBasicMaterial({ color: c, toneMapped: false })); };
const GEO = {};
const boxG = (w, h, d) => { const k = `b${w},${h},${d}`; return GEO[k] || (GEO[k] = new THREE.BoxGeometry(w, h, d)); };
const cylG = (a, b, h, s = 8) => { const k = `c${a},${b},${h},${s}`; return GEO[k] || (GEO[k] = new THREE.CylinderGeometry(a, b, h, s)); };
const sphG = (r, w = 8, h = 6) => { const k = `s${r},${w},${h}`; return GEO[k] || (GEO[k] = new THREE.SphereGeometry(r, w, h)); };
const coneG = (r, h, s = 8) => { const k = `k${r},${h},${s}`; return GEO[k] || (GEO[k] = new THREE.ConeGeometry(r, h, s)); };
const planeG = (w, h) => { const k = `p${w},${h}`; return GEO[k] || (GEO[k] = new THREE.PlaneGeometry(w, h)); };
function mesh(g, m, x = 0, y = 0, z = 0, parent) { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); if (parent) parent.add(o); return o; }

// Batch: collects transformed geometry per material and merges it into a few meshes
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
class Batch {
  constructor() { this.by = new Map(); }
  add(g, m, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    _m4.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
    const gg = g.index ? g.clone() : g.clone(); gg.applyMatrix4(_m4);
    let a = this.by.get(m); if (!a) this.by.set(m, (a = [])); a.push(gg); return this;
  }
  box(w, h, d, m, x, y, z, ry = 0, rx = 0, rz = 0) { return this.add(boxG(1, 1, 1), m, x, y, z, rx, ry, rz, w, h, d); }
  build(parent) {
    const out = [];
    for (const [m, a] of this.by) { const g = mergeGeometries(a, false); for (const x of a) x.dispose(); const o = new THREE.Mesh(g, m); o.matrixAutoUpdate = false; o.updateMatrix(); parent.add(o); out.push(o); }
    this.by.clear(); return out;
  }
}

/* ───────── canvas textures ───────── */
function canvasTex(w, h, draw, srgb = true) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
const NEON_WORDS = ['MIEPO', 'BAOZU', 'SATAYO', 'NOODLA', 'TEHKU', 'DIMDIM', 'WOKWOK', 'YUMLA', 'KOPILO', 'GYOZU', 'LAKSO', 'RAMEMO', 'TAKOYO', 'PANGO', 'SOTOO', 'BUNBUN', 'NASIKO', 'JIANBO', 'ONIGO', 'MOCHIMO', 'SIOMAI', 'TOFUYA'];
const NEON_COLS = ['#ff4f8b', '#35e0ff', '#ffd23a', '#7dff6a', '#ff7a2a', '#c86bff', '#ff3d3d'];
const TEXC = {};
function neonTex(word, col, vertical = false) {
  const k = word + col + vertical; if (TEXC[k]) return TEXC[k];
  const W = vertical ? 96 : 320, H = vertical ? 320 : 96;
  return (TEXC[k] = canvasTex(W, H, (x) => {
    x.fillStyle = '#120a1e'; x.fillRect(0, 0, W, H);
    x.strokeStyle = col; x.lineWidth = 4; x.shadowColor = col; x.shadowBlur = 14; x.strokeRect(7, 7, W - 14, H - 14);
    x.font = `800 ${vertical ? 52 : 58}px "Baloo 2", system-ui, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = '#fff'; x.shadowBlur = 18;
    if (vertical) { const ch = word.slice(0, 5).split(''), st = (H - 92) / Math.max(1, ch.length - 1); ch.forEach((c, i) => { const y = 46 + i * st; x.fillStyle = col; x.fillText(c, W / 2, y); x.fillStyle = '#fff'; x.globalAlpha = 0.55; x.fillText(c, W / 2, y); x.globalAlpha = 1; }); }
    else { x.fillStyle = col; x.fillText(word, W / 2, H / 2 + 4); x.globalAlpha = 0.6; x.fillStyle = '#fff'; x.fillText(word, W / 2, H / 2 + 4); }
  }));
}
function signTex(text, bg, fg, sub) {
  const k = 'S' + text + bg + fg + sub; if (TEXC[k]) return TEXC[k];
  return (TEXC[k] = canvasTex(512, 128, (x, W, H) => {
    x.fillStyle = bg; x.fillRect(0, 0, W, H); x.strokeStyle = fg; x.lineWidth = 6; x.strokeRect(8, 8, W - 16, H - 16);
    x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = `800 ${sub ? 54 : 66}px "Baloo 2", system-ui, sans-serif`; x.fillText(text, W / 2, sub ? 52 : H / 2 + 4);
    if (sub) { x.font = '700 26px "Baloo 2", system-ui, sans-serif'; x.globalAlpha = 0.85; x.fillText(sub, W / 2, 100); }
  }));
}
const corrTex = canvasTex(128, 128, (x, W, H) => { x.fillStyle = '#9aa0a8'; x.fillRect(0, 0, W, H); for (let i = 0; i < H; i += 8) { const g = x.createLinearGradient(0, i, 0, i + 8); g.addColorStop(0, '#c8ccd2'); g.addColorStop(0.5, '#8a9098'); g.addColorStop(1, '#5c626a'); x.fillStyle = g; x.fillRect(0, i, W, 8); } x.fillStyle = 'rgba(60,40,30,.25)'; for (let i = 0; i < 18; i++) x.fillRect(rnd() * W, rnd() * H, 3 + rnd() * 10, 2); });
corrTex.wrapS = corrTex.wrapT = THREE.RepeatWrapping;
const closedTex = canvasTex(256, 128, (x, W, H) => {
  x.fillStyle = '#f3e3c0'; x.fillRect(0, 0, W, H); x.strokeStyle = '#5a2a14'; x.lineWidth = 8; x.strokeRect(6, 6, W - 12, H - 12);
  x.fillStyle = '#b3202c'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = '800 50px "Baloo 2", system-ui, sans-serif'; x.fillText('CLOSED', W / 2, 46);
  x.font = '800 32px "Baloo 2", system-ui, sans-serif'; x.fillStyle = '#3a1a0c'; x.fillText('FOR GOOD', W / 2, 92);
});
// stone pavers for the wet street
const paver = (() => {
  const S = 512;
  const col = canvasTex(S, S, (x) => {
    x.fillStyle = '#17141c'; x.fillRect(0, 0, S, S);
    const n = 8, c = S / n;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const off = (j % 2) * c / 2, v = 28 + rnd() * 16 | 0;
      x.fillStyle = `rgb(${v + 6},${v + 2},${v + 10})`; x.fillRect(((i * c + off) % S) + 3, j * c + 3, c - 6, c - 6);
      if ((i * c + off) + c > S) x.fillRect(((i * c + off) % S) - S + 3, j * c + 3, c - 6, c - 6);
    }
  });
  const rough = canvasTex(S, S, (x) => {
    x.fillStyle = '#7a7a7a'; x.fillRect(0, 0, S, S);
    for (let i = 0; i < 9; i++) { const px = rnd() * S, py = rnd() * S, r = 30 + rnd() * 70; const g = x.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, '#0a0a0a'); g.addColorStop(0.7, '#141414'); g.addColorStop(1, 'rgba(122,122,122,0)'); x.fillStyle = g; x.beginPath(); x.ellipse(px, py, r * 1.4, r, rnd() * 3, 0, 7); x.fill(); }
    x.fillStyle = '#d0d0d0'; const n = 8, c = S / n; for (let j = 0; j <= n; j++) x.fillRect(0, j * c - 2, S, 4);
  }, false);
  for (const t of [col, rough]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(70, 70); }
  return { col, rough };
})();
function windowTex(v) {
  const t = canvasTex(256, 256, (x, W, H) => {
    const walls = ['#2a2238', '#33243a', '#232a3a', '#3a2a2a'];
    x.fillStyle = walls[v % 4]; x.fillRect(0, 0, W, H);
    x.fillStyle = 'rgba(0,0,0,.25)'; for (let i = 0; i < 40; i++) x.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 30, 1 + rnd() * 3);
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      const lit = rnd(), wx = i * 64 + 14, wy = j * 64 + 12;
      x.fillStyle = lit < 0.38 ? '#0d0b14' : lit < 0.8 ? pick(['#ffbf6a', '#ffd28a', '#ffa347', '#ffcf9a']) : pick(['#8fd8ff', '#b9a6ff', '#7fffd8']);
      x.fillRect(wx, wy, 36, 40);
      if (lit >= 0.38) { x.fillStyle = 'rgba(40,20,10,.35)'; x.fillRect(wx, wy, 36, 8); x.fillRect(wx + 17, wy, 2, 40); }
      x.fillStyle = 'rgba(0,0,0,.6)'; x.fillRect(wx - 3, wy + 40, 42, 4);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
const WIN = [0, 1, 2, 3].map((v) => { const t = windowTex(v); return new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: '#ffffff', emissiveIntensity: 0.9, roughness: 0.9 }); });
const softTex = canvasTex(64, 64, (x, W) => { const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.5, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, W, W); });

/* ───────── environment map (for the wet sheen) ───────── */
{
  const es = new THREE.Scene();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(50, 24, 12), new THREE.MeshBasicMaterial({ side: THREE.BackSide, vertexColors: true }));
  const g = sky.geometry, p = g.attributes.position, cols = [], c = new THREE.Color();
  for (let i = 0; i < p.count; i++) { const y = p.getY(i) / 50; c.set(y > 0.25 ? '#0c1238' : y > -0.05 ? '#4a2a48' : '#120c14'); cols.push(c.r, c.g, c.b); }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); es.add(sky);
  for (let i = 0; i < 18; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(4, 2.2, 0.5), new THREE.MeshBasicMaterial({ color: pick(['#ffaa50', '#ff7a40', '#ffd27a', '#ff4f8b', '#35e0ff']) })); const a = (i / 18) * Math.PI * 2; b.position.set(Math.cos(a) * 30, rr(2, 10), Math.sin(a) * 30); b.lookAt(0, 4, 0); es.add(b); }
  const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(es, 0.04).texture; scene.environmentIntensity = 0.4; pm.dispose();
}

/* ───────── glow points (lanterns, bulbs, fireworks) + their reflections on the wet street ───────── */
const GLOW_MAX = 7000;
const gPos = new Float32Array(GLOW_MAX * 3), gCol = new Float32Array(GLOW_MAX * 3), gSize = new Float32Array(GLOW_MAX);
const gGeo = new THREE.BufferGeometry();
gGeo.setAttribute('position', new THREE.BufferAttribute(gPos, 3).setUsage(THREE.DynamicDrawUsage));
gGeo.setAttribute('color', new THREE.BufferAttribute(gCol, 3).setUsage(THREE.DynamicDrawUsage));
gGeo.setAttribute('size', new THREE.BufferAttribute(gSize, 1).setUsage(THREE.DynamicDrawUsage));
gGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
const GU = { uScale: { value: 400 }, uTime: { value: 0 } };
const glowVS = (mirror) => `
uniform float uScale; uniform float uTime; attribute float size; attribute vec3 color; varying vec3 vC; varying float vF;
void main(){ vec3 p = position; float h = p.y; ${mirror ? 'p.y = -p.y;' : ''}
 vec4 mv = modelViewMatrix * vec4(p,1.0); gl_Position = projectionMatrix * mv;
 float d = -mv.z; vF = exp(-d*0.0052); vC = color;
 ${mirror ? 'vC *= 0.42*exp(-h*0.05); gl_PointSize = min(size*0.55*uScale/max(1.0,d), 180.0);' : 'gl_PointSize = min(size*0.36*uScale/max(1.0,d), 110.0);'}
 if(size<=0.0) gl_PointSize=0.0; }`;
const glowFS = (mirror) => `
varying vec3 vC; varying float vF;
void main(){ vec2 q = gl_PointCoord-0.5; ${mirror ? 'q.x*=3.2; q.y*=0.9;' : ''}
 float d = length(q)*2.0; if(d>1.0) discard; float a = pow(1.0-d, ${mirror ? '2.4' : '2.0'}) ${mirror ? '' : '+ smoothstep(0.25,0.0,d)*0.5'};
 gl_FragColor = vec4(vC*a*vF, 1.0); }`;
const glowMat = new THREE.ShaderMaterial({ uniforms: GU, vertexShader: glowVS(false), fragmentShader: glowFS(false), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
const mirrorMat = new THREE.ShaderMaterial({ uniforms: GU, vertexShader: glowVS(true), fragmentShader: glowFS(true), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: false });
const glowPts = new THREE.Points(gGeo, glowMat); glowPts.frustumCulled = false; glowPts.renderOrder = 5; scene.add(glowPts);
const mirrorPts = new THREE.Points(gGeo, mirrorMat); mirrorPts.frustumCulled = false; mirrorPts.renderOrder = -1; scene.add(mirrorPts);
const gFree = []; let gTop = 0;
const _c = new THREE.Color();
function glow(x, y, z, col, size) { const i = gFree.length ? gFree.pop() : gTop++; if (i >= GLOW_MAX) return -1; setGlow(i, x, y, z, col, size); return i; }
function setGlow(i, x, y, z, col, size) { if (i < 0) return; gPos[i * 3] = x; gPos[i * 3 + 1] = y; gPos[i * 3 + 2] = z; if (col != null) { _c.set(col); gCol[i * 3] = _c.r; gCol[i * 3 + 1] = _c.g; gCol[i * 3 + 2] = _c.b; } gSize[i] = size; }
function glowSize(i, s) { if (i >= 0) gSize[i] = s; }
function freeGlow(i) { if (i < 0) return; gSize[i] = 0; gFree.push(i); }
function flushGlow() { gGeo.setDrawRange(0, gTop); for (const k of ['position', 'color', 'size']) gGeo.attributes[k].needsUpdate = true; }

/* ───────── sky ───────── */
{
  const g = new THREE.SphereGeometry(1200, 32, 16), p = g.attributes.position, cols = [], c = new THREE.Color(), top = new THREE.Color('#03051a'), mid = new THREE.Color('#0f1a4e'), hor = new THREE.Color('#4a2856'), glo = new THREE.Color('#8a3e3a');
  for (let i = 0; i < p.count; i++) { const y = p.getY(i) / 1200, z = p.getZ(i) / 1200; if (y > 0.25) c.copy(mid).lerp(top, clamp((y - 0.25) / 0.6, 0, 1)); else if (y > 0.02) c.copy(hor).lerp(mid, (y - 0.02) / 0.23); else c.copy(glo).lerp(hor, clamp(y / 0.02 + 1, 0, 1)); if (y < 0.12) c.lerp(glo, clamp(0.12 - y, 0, 0.12) * 2.5 * (0.5 + 0.5 * Math.max(0, -z))); cols.push(c.r, c.g, c.b); }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const s = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })); s.renderOrder = -10; scene.add(s);
  // stars
  const n = 900, sp = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const a = rnd() * Math.PI * 2, y = 0.12 + rnd() * 0.88, r = Math.sqrt(1 - y * y); sp[i * 3] = Math.cos(a) * r * 1100; sp[i * 3 + 1] = y * 1100; sp[i * 3 + 2] = Math.sin(a) * r * 1100; }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: '#cfd8ff', size: 2.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8, depthWrite: false })));
  // moon with halo, low over the far end of the street
  const mm = new THREE.Mesh(new THREE.CircleGeometry(18, 32), new THREE.MeshBasicMaterial({ color: '#fff3d8', fog: false })); mm.position.set(-260, 330, -980); mm.lookAt(0, 0, 0); scene.add(mm);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color: '#8aa0ff', fog: false, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending })); halo.scale.setScalar(150); halo.position.copy(mm.position); scene.add(halo);
  // drifting rain clouds
  const cloudTex = canvasTex(256, 128, (x, W, H) => { for (let i = 0; i < 26; i++) { const px = rr(30, W - 30), py = rr(40, H - 30), r = rr(18, 46); const gg = x.createRadialGradient(px, py, 0, px, py, r); gg.addColorStop(0, 'rgba(255,255,255,.55)'); gg.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gg; x.fillRect(0, 0, W, H); } });
  window.CLOUDS = [];
  for (let i = 0; i < 9; i++) { const c2 = new THREE.Mesh(new THREE.PlaneGeometry(520, 200), new THREE.MeshBasicMaterial({ map: cloudTex, color: pick(['#3b3260', '#4a3466', '#2c2c58']), transparent: true, opacity: 0.7, fog: false, depthWrite: false })); c2.position.set(rr(-700, 700), rr(170, 330), rr(-950, -500)); c2.lookAt(0, 60, 200); c2.renderOrder = -9; scene.add(c2); CLOUDS.push(c2); }
}

/* ───────── layout ───────── */
const LOT_X = 6.7, LOT_W = 5.8, Z_IN = 80, Z_END = -92;
const CANAL_Z = -8.5, STAGE = { x: -11.5, z: 32 }, BOSS = { x: 0, z: -97 }, WHEEL = { z: -124, y: 21, r: 16 }, ARCH_Z = 76;
const LOTS = [];
for (const side of [-1, 1]) for (let z = 64; z >= -86.5; z -= LOT_W) {
  if (Math.abs(z - CANAL_Z) < 6.6) continue;
  if (side < 0 && z < 42 && z > 22) continue;
  LOTS.push({ side, x: side * LOT_X, z, ry: side < 0 ? Math.PI / 2 : -Math.PI / 2, owner: null, s: 1 });
}
LOTS.push({ side: 0, x: BOSS.x, z: BOSS.z, ry: 0, owner: null, s: 1.55, boss: true });
// local (stall frame) -> world
function lw(lot, lx, lz, out = { x: 0, z: 0 }) { const c = Math.cos(lot.ry), s = Math.sin(lot.ry); out.x = lot.x + (lx * c + lz * s) * lot.s; out.z = lot.z + (-lx * s + lz * c) * lot.s; return out; }
// walking height (the koi bridge arcs over the canal once it exists)
let canalOn = false;
function groundY(x, z) { if (canalOn && Math.abs(x) < 3.6 && z > CANAL_Z - 4.2 && z < CANAL_Z + 4.2) return Math.cos(((z - CANAL_Z) / 4.2) * Math.PI * 0.5) * 1.05; return 0; }

/* ───────── ground ───────── */
{
  const g = new THREE.PlaneGeometry(520, 520); g.rotateX(-Math.PI / 2);
  const m = new THREE.MeshStandardMaterial({ map: paver.col, roughnessMap: paver.rough, roughness: 0.75, metalness: 0.15, color: '#b8b0c8', envMapIntensity: 1.4 });
  const gm = new THREE.Mesh(g, m); gm.renderOrder = -3; scene.add(gm);
  // puddles: dark mirror patches on the street
  const pm = new THREE.MeshStandardMaterial({ color: '#0c0b14', roughness: 0.04, metalness: 0.6, envMapIntensity: 1.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const pb = new Batch();
  for (let i = 0; i < 46; i++) { const z = rr(Z_END + 4, Z_IN + 12); if (Math.abs(z - CANAL_Z) < 5) continue; const c = new THREE.CircleGeometry(1, 14); c.rotateX(-Math.PI / 2); pb.add(c, pm, rr(-5, 5), 0.004, z, 0, rr(0, 3), 0, rr(0.8, 2.4), 1, rr(0.5, 1.4)); }
  for (const o of pb.build(scene)) o.renderOrder = -2;
}
// curbs, gutters and lot pads
const SB = new Batch();
{
  const curb = mat('#3a3442'), pad = mat('#2a2230', { roughness: 0.5 });
  for (const s of [-1, 1]) {
    SB.box(0.3, 0.14, Z_IN - Z_END + 6, curb, s * 6.45, 0.07, (Z_IN + Z_END) / 2);
    SB.box(8.6, 0.06, Z_IN - Z_END + 6, pad, s * 10.9, 0.03, (Z_IN + Z_END) / 2);
  }
}

/* ───────── backdrop: shophouses, blade signs, cables ───────── */
const BLADES = [];
{
  const roof = mat('#1c1626'), trim = mat('#3b2c44'), ac = mat('#8b8e98'), tank = mat('#4a5262');
  const facade = (x, z, w, h, d, face, v) => {
    // body
    SB.box(face === 'z' ? w : d, h, face === 'z' ? d : w, roof, x, h / 2, z);
    // lit window face toward the street
    const pg = new THREE.PlaneGeometry(w, h - 3.2); const uv = pg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.round(w / 3.2), uv.getY(i) * Math.round((h - 3.2) / 3.4));
    const off = (face === 'z' ? d : d) / 2 + 0.02;
    if (face === 'z') SB.add(pg, WIN[v], x, 3.2 + (h - 3.2) / 2, z + off, 0, 0, 0);
    else SB.add(pg, WIN[v], x + (x < 0 ? off : -off), 3.2 + (h - 3.2) / 2, z, 0, x < 0 ? Math.PI / 2 : -Math.PI / 2, 0);
    pg.dispose();
    // parapet + roof bits
    if (face === 'z') SB.box(w + 0.4, 0.5, d + 0.4, trim, x, h + 0.25, z); else SB.box(d + 0.4, 0.5, w + 0.4, trim, x, h + 0.25, z);
    if (rnd() < 0.5) { const tx = x + (face === 'z' ? rr(-w / 3, w / 3) : 0), tz = z + (face === 'z' ? 0 : rr(-w / 3, w / 3)); SB.add(cylG(1, 1, 1, 10), tank, tx, h + 1.4, tz, 0, 0, 0, 1.1, 2, 1.1); SB.add(coneG(1.2, 0.6, 10), tank, tx, h + 2.7, tz); }
    // AC units on the facade
    if (face !== 'z') for (let k = 0; k < 3; k++) if (rnd() < 0.6) SB.box(0.5, 0.6, 0.9, ac, x + (x < 0 ? d / 2 + 0.25 : -d / 2 - 0.25), rr(5, h - 1), z + rr(-w / 2.6, w / 2.6));
  };
  for (const s of [-1, 1]) {
    let z = Z_IN + 10;
    while (z > Z_END - 22) { const w = rr(7, 11.5), h = rr(10, 21), d = 9; facade(s * (15.6 + d / 2), z - w / 2, w, h, d, 'x', (rnd() * 4) | 0);
      if (rnd() < 0.75) { const word = pick(NEON_WORDS), col = pick(NEON_COLS), hh = rr(4.5, 6.5), y = rr(6, Math.max(7, h - hh / 2 - 1)); BLADES.push({ x: s * 14.6, y, z: z - w / 2 + rr(-2, 2), word, col, hh }); }
      z -= w + rr(0, 0.6); }
  }
  // end of the street: a wall of taller blocks behind the boss and the wheel
  for (let x = -60; x < 60;) { const w = rr(8, 13), h = rr(15, 30); facade(x + w / 2, -152, w, h, 9, 'z', (rnd() * 4) | 0); x += w; }
  for (let x = -54; x < 54;) { const w = rr(10, 16), h = rr(22, 40); facade(x + w / 2, -175, w, h, 9, 'z', (rnd() * 4) | 0); x += w; }
  // side fillers between the street blocks and the end wall
  for (const s of [-1, 1]) facade(s * 28, -128, 30, rr(12, 18), 12, 'x', 1);
  // blade signs (vertical neon sticking out over the stalls)
  for (const b of BLADES) {
    const m = new THREE.MeshBasicMaterial({ map: neonTex(b.word, b.col, true), toneMapped: false, color: '#dddddd' });
    const sign = new THREE.Mesh(planeG(1.5, b.hh), m); sign.position.set(b.x, b.y, b.z); scene.add(sign);
    const back = sign.clone(); back.rotation.y = Math.PI; scene.add(back);
    SB.box(0.08, 0.08, 1.4, trim, b.x + (b.x < 0 ? -0.6 : 0.6), b.y + b.hh / 2 - 0.2, b.z, Math.PI / 2);
  }
  // distant skyline silhouettes
  const far = mat('#0e0c1c', { emissive: '#120e22', emissiveIntensity: 0.4 });
  for (let i = 0; i < 46; i++) { const a = rr(-1.3, 1.3), r = rr(230, 360), w = rr(16, 40), h = rr(25, 95); SB.box(w, h, w, far, Math.sin(a) * r, h / 2, -Math.cos(a) * r - 60); if (rnd() < 0.5) glow(Math.sin(a) * r, h + 2, -Math.cos(a) * r - 60, '#ff3d3d', 5); }
}
// overhead cables between the blocks
{
  const pts = [];
  for (let z = Z_IN; z > Z_END - 10; z -= rr(5, 9)) { const y1 = rr(11, 16), y2 = rr(11, 16), z2 = z + rr(-4, 4); let px = -15.4, py = y1, pz = z; for (let k = 1; k <= 12; k++) { const t = k / 12, x = lerp(-15.4, 15.4, t), y = lerp(y1, y2, t) - Math.sin(t * Math.PI) * 1.6, zz = lerp(z, z2, t); pts.push(px, py, pz, x, y, zz); px = x; py = y; pz = zz; } }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  scene.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#05040a', transparent: true, opacity: 0.85 })));
}
// base street lamps: red paper lanterns on poles next to the warm point lights
{
  const pole = mat('#2a1d1a'), lan = emat('#ff3b2a', 1.4), cap = mat('#1a1010');
  for (let i = 0; i < PL.length; i++) {
    const p = PL[i], x = p.position.x < 0 ? -6.2 : 6.2, z = p.position.z;
    SB.add(cylG(0.09, 0.12, 6.6, 6), pole, x, 3.3, z); SB.box(1.4, 0.08, 0.08, pole, x + (x < 0 ? 0.6 : -0.6), 6.4, z);
    const lx = x + (x < 0 ? 1.2 : -1.2); SB.add(sphG(0.55, 10, 8), lan, lx, 5.6, z, 0, 0, 0, 1, 1.2, 1); SB.add(cylG(0.3, 0.3, 0.14, 8), cap, lx, 6.3, z); SB.add(cylG(0.3, 0.3, 0.14, 8), cap, lx, 4.9, z);
    glow(lx, 5.6, z, '#ff6a3a', 4);
    p.position.x = lx;
  }
}
const CRATES = new THREE.Group(); scene.add(CRATES);
// plaza fixtures (before the canal exists): a bench and a vending machine, kept off the canal line
{
  const wood = mat('#6b4428'), vm = mat('#d23a3a', { roughness: 0.4 });
  SB.box(2.6, 0.15, 0.7, wood, -9.5, 0.55, CANAL_Z + 4.6); SB.box(0.15, 0.55, 0.6, wood, -10.6, 0.27, CANAL_Z + 4.6); SB.box(0.15, 0.55, 0.6, wood, -8.4, 0.27, CANAL_Z + 4.6);
  SB.box(1.2, 2.2, 0.9, vm, 10.4, 1.1, CANAL_Z - 4.8); const vf = mesh(planeG(0.9, 1.3), emat('#bfe8ff', 1.4), -0.0, 0, 0); vf.position.set(9.79, 1.35, CANAL_Z - 4.8); vf.rotation.y = -Math.PI / 2; scene.add(vf); glow(9.7, 1.35, CANAL_Z - 4.8, '#9fdcff', 3);
  // crates on the empty stage lot
  const cr = mat('#7a5634'), CB = new Batch();
  for (let i = 0; i < 6; i++) CB.box(1, 0.8, 1, cr, STAGE.x + rr(-2, 2), 0.4, STAGE.z - 4 + i * 1.6, rr(0, 1));
  CB.box(1, 0.8, 1, cr, STAGE.x, 1.2, STAGE.z - 2.4, 0.3);
  CB.build(CRATES);
}

/* ───────── rain, ripples, steam ───────── */
const RAIN_N = IS_PHONE ? 700 : 1400;
const rainPos = new Float32Array(RAIN_N * 6), rainV = new Float32Array(RAIN_N);
const rainGeo = new THREE.BufferGeometry(); rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3).setUsage(THREE.DynamicDrawUsage));
const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: '#9fb4ff', transparent: true, opacity: 0.32, depthWrite: false }));
rain.frustumCulled = false; scene.add(rain);
for (let i = 0; i < RAIN_N; i++) { rainV[i] = rr(26, 34); const x = rr(-45, 45), y = rr(0, 45), z = rr(-70, 70); rainPos.set([x, y, z, x - 0.12, y + 1.0, z + 0.05], i * 6); }
const RIP_N = 150, ripPos = new Float32Array(RIP_N * 3), ripT = new Float32Array(RIP_N);
const ripGeo = new THREE.BufferGeometry(); ripGeo.setAttribute('position', new THREE.BufferAttribute(ripPos, 3).setUsage(THREE.DynamicDrawUsage)); ripGeo.setAttribute('t', new THREE.BufferAttribute(ripT, 1).setUsage(THREE.DynamicDrawUsage));
const ripU = { uScale: GU.uScale, uSquash: { value: 0.35 } };
const ripples = new THREE.Points(ripGeo, new THREE.ShaderMaterial({ uniforms: ripU, transparent: true, depthWrite: false,
  vertexShader: 'uniform float uScale; attribute float t; varying float vT; void main(){ vT=t; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_Position=projectionMatrix*mv; gl_PointSize = (0.25+t*0.9)*uScale/max(1.0,-mv.z); }',
  fragmentShader: 'uniform float uSquash; varying float vT; void main(){ vec2 q=gl_PointCoord-0.5; q.y/=uSquash; float d=length(q)*2.0; float a=smoothstep(0.1,0.0,abs(d-0.8))*(1.0-vT)*0.22; if(a<0.01) discard; gl_FragColor=vec4(0.75,0.8,1.0,a); }' }));
ripples.frustumCulled = false; scene.add(ripples);
for (let i = 0; i < RIP_N; i++) { ripPos.set([rr(-6, 6), 0.03, rr(-80, 75)], i * 3); ripT[i] = rnd(); }

const STEAM_N = 900, stPos = new Float32Array(STEAM_N * 3), stA = new Float32Array(STEAM_N), stS = new Float32Array(STEAM_N), stV = new Float32Array(STEAM_N * 3);
const stGeo = new THREE.BufferGeometry(); stGeo.setAttribute('position', new THREE.BufferAttribute(stPos, 3).setUsage(THREE.DynamicDrawUsage)); stGeo.setAttribute('a', new THREE.BufferAttribute(stA, 1).setUsage(THREE.DynamicDrawUsage)); stGeo.setAttribute('size', new THREE.BufferAttribute(stS, 1).setUsage(THREE.DynamicDrawUsage));
const steam = new THREE.Points(stGeo, new THREE.ShaderMaterial({ uniforms: { uScale: GU.uScale }, transparent: true, depthWrite: false,
  vertexShader: 'uniform float uScale; attribute float a; attribute float size; varying float vA; void main(){ vA=a; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_Position=projectionMatrix*mv; gl_PointSize=size*uScale/max(1.0,-mv.z); }',
  fragmentShader: 'varying float vA; void main(){ float d=length(gl_PointCoord-0.5)*2.0; float a=pow(max(0.0,1.0-d),1.6)*vA; if(a<0.005) discard; gl_FragColor=vec4(1.0,0.93,0.86,a); }' }));
steam.frustumCulled = false; steam.renderOrder = 4; scene.add(steam);
let stHead = 0;
function puff(x, y, z, k = 1) { const i = stHead; stHead = (stHead + 1) % STEAM_N; stPos[i * 3] = x + rr(-0.12, 0.12); stPos[i * 3 + 1] = y; stPos[i * 3 + 2] = z + rr(-0.12, 0.12); stV[i * 3] = rr(-0.15, 0.15); stV[i * 3 + 1] = rr(0.9, 1.5) * k; stV[i * 3 + 2] = rr(-0.15, 0.15); stA[i] = 0.42; stS[i] = rr(0.5, 0.8) * k; }
function updateWeather(dt, tx, tz) {
  for (let i = 0; i < RAIN_N; i++) { const o = i * 6; let y = rainPos[o + 1] - rainV[i] * dt; if (y < 0) { y += 45; const x = tx + rr(-45, 45), z = tz + rr(-70, 50); rainPos[o] = x; rainPos[o + 2] = z; rainPos[o + 3] = x - 0.12; rainPos[o + 5] = z + 0.05; } rainPos[o + 1] = y; rainPos[o + 4] = y + 1.0; }
  rainGeo.attributes.position.needsUpdate = true;
  for (let i = 0; i < RIP_N; i++) { ripT[i] += dt * 1.4; if (ripT[i] >= 1) { ripT[i] = 0; const o = i * 3; ripPos[o] = rr(-6.2, 6.2); ripPos[o + 2] = clamp(tz + rr(-60, 40), Z_END, Z_IN + 20); ripPos[o + 1] = groundY(ripPos[o], ripPos[o + 2]) + 0.03; } }
  ripGeo.attributes.position.needsUpdate = true; ripGeo.attributes.t.needsUpdate = true;
  for (let i = 0; i < STEAM_N; i++) { if (stA[i] <= 0) continue; const o = i * 3; stPos[o] += stV[o] * dt; stPos[o + 1] += stV[o + 1] * dt; stPos[o + 2] += stV[o + 2] * dt; stV[o] *= 0.99; stS[i] += dt * 0.9; stA[i] -= dt * 0.22; if (stA[i] < 0) stA[i] = 0; }
  stGeo.attributes.position.needsUpdate = true; stGeo.attributes.a.needsUpdate = true; stGeo.attributes.size.needsUpdate = true;
}

/* ───────── stalls: 8 growth levels ───────── */
const LEVELS = ['Push cart', 'Cart with umbrella', 'Small stall with awning', 'Stall with stools and a queue', 'Two-bay stall with a neon sign', 'Small shop front', 'Two-storey eatery', 'Grand Restaurant'];
const THEMES = ['#d8452f', '#2c8f7a', '#e0a02a', '#3b6fd1', '#b5487d', '#5c9e3c', '#c46a2a', '#6a4fc0', '#1f8fae', '#a83a3a'];
const M = {
  wood: mat('#7a4a2a'), wood2: mat('#a8743f'), dark: mat('#231a22'), dark2: mat('#2e2430'), metal: mat('#9aa3ad', { metalness: 0.5, roughness: 0.4 }),
  tire: mat('#151515'), pot: mat('#2e2e34', { metalness: 0.6, roughness: 0.35 }), white: mat('#efe6d8'), red: mat('#b8262a'), tile: mat('#5a2a22'),
  roof: mat('#3a1c1c'), gold: mat('#ffc23a', { metalness: 0.7, roughness: 0.3, emissive: '#7a4a00', emissiveIntensity: 0.5 }), floor: mat('#8a6a4a', { roughness: 0.6 }),
  interior: emat('#ff9a4a', 0.55), win: emat('#ffb060', 0.5), jar: mat('#d8c8a0'), off: mat('#2a2228'), glass: mat('#3a4a5a', { roughness: 0.2 }),
};
const BULB = emat('#ffd27a', 1.3), LAN = emat('#ff4a2a', 1.1), GLAN = emat('#ffc61a', 1.8), DEAD = mat('#2c2428');
const SIGNM = {};
const signMat = (tex) => SIGNM[tex.uuid] || (SIGNM[tex.uuid] = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, color: '#e8e8e8' }));
const lampG = sphG(0.22, 10, 8), lanG = sphG(0.34, 10, 8), _v3 = new THREE.Vector3();

function clearStall(lot) {
  if (lot.body) { lot.g.remove(lot.body); lot.body.traverse((o) => { if (o.isMesh && o.geometry && !Object.values(GEO).includes(o.geometry)) o.geometry.dispose(); }); }
  for (const l of lot.lights || []) freeGlow(l.gi);
  lot.lights = []; lot.cook = []; lot.body = new THREE.Group(); lot.g.add(lot.body);
}
function addLight(lot, x, y, z, kind = 'bulb') {
  const g = kind === 'lan' ? lanG : lampG, m = kind === 'lan' ? LAN : BULB;
  const o = mesh(g, m, x, y, z, lot.body); if (kind === 'lan') { o.scale.set(1, 1.25, 1); mesh(cylG(0.2, 0.2, 0.1, 8), M.dark, 0, 0.33, 0, o); mesh(cylG(0.2, 0.2, 0.1, 8), M.dark, 0, -0.33, 0, o); }
  lot.g.updateMatrixWorld(true); o.getWorldPosition(_v3);
  const col = kind === 'lan' ? '#ff6a3a' : '#ffcf7a', size = (kind === 'lan' ? 2.2 : 0.9) * lot.s;
  lot.lights.push({ o, on: m, gi: glow(_v3.x, _v3.y, _v3.z, col, size), col, size });
}
function neon(lot, word, col, w, h, x, y, z, ry = 0) { const s = mesh(planeG(w, h), signMat(neonTex(word, col)), x, y, z, lot.body); s.rotation.y = ry; lot.g.updateMatrixWorld(true); s.getWorldPosition(_v3); lot.lights.push({ o: s, on: s.material, gi: glow(_v3.x, _v3.y, _v3.z, col, 3.2 * w * lot.s / 3), col, size: 3.2 * w * lot.s / 3, sign: true }); return s; }
function cook(lot, x, y, z) { lot.g.updateMatrixWorld(true); _v3.set(x, y, z); lot.g.localToWorld(_v3); lot.cook.push({ x: _v3.x, y: _v3.y, z: _v3.z }); }

function buildStall(lot) {
  const v = lot.owner, L = v.level; clearStall(lot);
  const B = new Batch(), th = mat(v.theme), th2 = mat(v.theme2), cloth = mat(v.theme, { roughness: 0.95 });
  let frontW, frontH, sz, top, stand, inside = false;
  if (L <= 2) {
    // push cart
    B.box(1.5, 0.6, 0.8, th, 0, 0.75, -0.35); B.box(1.66, 0.07, 0.94, M.wood2, 0, 1.08, -0.35);
    for (const s of [-1, 1]) { B.add(cylG(0.32, 0.32, 0.1, 12), M.tire, s * 0.82, 0.32, -0.35, 0, 0, Math.PI / 2); B.add(cylG(0.08, 0.08, 0.12, 6), M.metal, s * 0.82, 0.32, -0.35, 0, 0, Math.PI / 2); }
    B.box(0.07, 0.45, 0.07, M.metal, -0.6, 0.22, -0.05); B.box(0.07, 0.07, 0.7, M.metal, 0, 0.95, -0.95);
    B.add(cylG(0.3, 0.22, 0.22, 12), M.pot, -0.3, 1.23, -0.35); B.add(cylG(0.18, 0.18, 0.16, 10), M.metal, 0.4, 1.2, -0.35);
    const pl = mesh(planeG(1.1, 0.34), signMat(signTex(v.word, '#f3e6c8', v.theme)), 0, 0.78, 0.06, lot.body);
    cook(lot, -0.3, 1.4, -0.35);
    if (L === 1) { B.add(cylG(0.035, 0.035, 1.1, 6), M.wood, 0.72, 1.6, -0.72); B.box(0.04, 0.04, 0.35, M.wood, 0.72, 2.12, -0.56); addLight(lot, 0.72, 1.86, -0.4, 'lan'); }
    else {
      B.add(cylG(0.04, 0.04, 2.6, 6), M.wood, 0, 1.4, -0.8); B.add(coneG(1.6, 0.6, 10), cloth, 0, 2.86, -0.4); B.add(coneG(0.9, 0.36, 10), M.white, 0, 3.0, -0.4); B.add(sphG(0.08, 6, 4), M.gold, 0, 3.2, -0.4);
      for (const s of [-1, 1]) { B.box(0.02, 0.3, 0.02, M.dark, s * 1.15, 2.42, -0.4); addLight(lot, s * 1.15, 2.1, -0.4, 'lan'); }
      B.add(cylG(0.24, 0.24, 0.5, 8), M.wood, 1.25, 0.25, 0.25);
    }
    frontW = 2.2; frontH = L === 1 ? 1.9 : 2.3; sz = 0.55; top = L === 1 ? 2.5 : 3.4; stand = { x: 0, z: -1.2 };
  } else if (L <= 4) {
    const w = L === 3 ? 3 : 3.8, hw = w / 2;
    B.box(w, 1.0, 0.8, M.wood, 0, 0.5, -0.4); B.box(w + 0.2, 0.08, 1.0, M.wood2, 0, 1.04, -0.4); B.box(w, 0.6, 0.04, th, 0, 0.58, 0.02);
    for (const sx of [-hw, hw]) for (const z of [0, -2.4]) B.add(cylG(0.06, 0.06, 2.6, 6), M.wood, sx, 1.3, z);
    B.box(w, 1.7, 0.3, M.dark, 0, 0.85, -2.45); for (let i = 0; i < (L === 3 ? 5 : 7); i++) B.add(cylG(0.11, 0.11, 0.28, 8), M.jar, -hw + 0.4 + i * 0.5, 1.84, -2.4);
    B.box(w + 0.4, 0.08, 1.7, cloth, 0, 2.55, -0.1, 0, 0.25); B.box(w + 0.4, 0.28, 0.05, th2, 0, 2.28, 0.72);
    B.box(w + 0.2, 0.08, 2.6, M.dark2, 0, 2.66, -1.4);
    B.add(cylG(0.32, 0.18, 0.18, 12), M.pot, hw - 0.7, 1.18, -0.45); B.add(cylG(0.24, 0.24, 0.3, 10), M.metal, -hw + 0.7, 1.24, -0.45);
    cook(lot, hw - 0.7, 1.35, -0.45);
    mesh(planeG(w * 0.6, w * 0.15), signMat(signTex(v.word, '#2a1a12', '#ffd9a0')), 0, 2.08, -2.29, lot.body);
    if (L === 3) { addLight(lot, -0.8, 2.25, -0.3); addLight(lot, 0.8, 2.25, -0.3); }
    else { for (let i = 0; i < 5; i++) addLight(lot, -hw + 0.2 + i * (w - 0.4) / 4, 2.08, 0.74); for (const s of [-1.1, 0, 1.1]) B.add(cylG(0.2, 0.17, 0.6, 8), th2, s, 0.3, 0.85); }
    frontW = w + 0.1; frontH = 2.25; sz = 0.16; top = 3.5; stand = { x: 0, z: -1.25 };
  } else if (L === 5) {
    const w = 5.2, hw = 2.6;
    B.box(5, 1.0, 0.8, M.wood, 0, 0.5, -0.4); B.box(5.2, 0.08, 1.0, M.wood2, 0, 1.04, -0.4); B.box(2.4, 0.6, 0.04, th, -1.25, 0.58, 0.02); B.box(2.4, 0.6, 0.04, th2, 1.25, 0.58, 0.02);
    for (const sx of [-hw, 0, hw]) for (const z of [0, -2.6]) B.add(cylG(0.07, 0.07, 2.8, 6), M.wood, sx, 1.4, z);
    B.box(5.2, 2.7, 0.2, M.dark, 0, 1.35, -2.7); for (let i = 0; i < 9; i++) B.add(cylG(0.11, 0.11, 0.28, 8), M.jar, -2.2 + i * 0.55, 1.4, -2.5);
    B.box(2.8, 0.08, 1.7, cloth, -1.3, 2.7, -0.1, 0, 0.25); B.box(2.8, 0.08, 1.7, th2, 1.3, 2.7, -0.1, 0, 0.25); B.box(5.4, 0.28, 0.05, M.dark2, 0, 2.43, 0.72);
    B.box(5.3, 0.1, 2.9, M.dark2, 0, 2.8, -1.4);
    B.box(3.5, 1.1, 0.12, M.dark, 0, 3.45, -0.6); B.box(0.08, 0.6, 0.08, M.dark, -1.4, 3.0, -0.6); B.box(0.08, 0.6, 0.08, M.dark, 1.4, 3.0, -0.6);
    neon(lot, v.word, v.neon, 3.3, 0.95, 0, 3.45, -0.53);
    for (const s of [-1.7, 1.2]) { B.add(cylG(0.32, 0.18, 0.18, 12), M.pot, s, 1.18, -0.45); cook(lot, s, 1.35, -0.45); }
    for (let i = 0; i < 6; i++) addLight(lot, -2.4 + i * 0.96, 2.22, 0.74);
    for (const s of [-1.8, -0.6, 0.6, 1.8]) B.add(cylG(0.2, 0.17, 0.6, 8), th, s, 0.3, 0.85);
    frontW = 5.3; frontH = 2.4; sz = 0.16; top = 4.4; stand = { x: -0.6, z: -1.3 };
  } else {
    // shop front (L6), plus a second storey (L7), plus pagoda tiers (L8)
    const hw = 2.65, H1 = L === 8 ? 3.8 : 3.4;
    B.box(0.25, H1, 5, th2, -hw, H1 / 2, -3.1); B.box(0.25, H1, 5, th2, hw, H1 / 2, -3.1); B.box(5.3, H1, 0.25, M.dark, 0, H1 / 2, -5.6);
    B.box(5.6, 0.3, 5.4, M.dark2, 0, H1 + 0.15, -3.0); B.box(5.3, 0.72, 0.25, M.dark, 0, H1 - 0.36, -0.6);
    const ip = mesh(planeG(5, H1 - 0.8), M.interior, 0, (H1 - 0.8) / 2 + 0.05, -5.46, lot.body);
    B.box(5.1, 0.06, 5, M.floor, 0, 0.03, -3.1); B.box(4.6, 1.0, 0.7, M.wood, 0, 0.5, -1.05); B.box(4.8, 0.08, 0.9, M.wood2, 0, 1.04, -1.05);
    for (const s of [-1.4, 1.4]) { B.box(1.1, 0.7, 1.1, M.wood2, s, 0.72, -3.8); B.add(cylG(0.18, 0.18, 0.45, 8), M.red, s - 0.75, 0.22, -3.8); B.add(cylG(0.18, 0.18, 0.45, 8), M.red, s + 0.75, 0.22, -3.8); }
    B.add(cylG(0.32, 0.18, 0.18, 12), M.pot, 1.4, 1.18, -1.1); cook(lot, 1.4, 1.35, -1.1);
    B.box(5.8, 0.08, 1.4, cloth, 0, H1 - 0.85, 0.1, 0, 0.32);
    neon(lot, v.word, v.neon, 3.8, 0.62, 0, H1 - 0.36, -0.46);
    addLight(lot, -2.25, H1 - 1.3, 0.55, 'lan'); addLight(lot, 2.25, H1 - 1.3, 0.55, 'lan');
    addLight(lot, -1.2, H1 - 0.5, -3.2); addLight(lot, 1.2, H1 - 0.5, -3.2);
    frontW = 5.1; frontH = H1 - 0.72; sz = -0.42; top = H1 + 1.4; stand = { x: -0.8, z: -1.75 };
    if (L >= 7) {
      const H2 = 3.0, y2 = H1 + 0.3;
      B.box(5.2, H2, 5.2, th2, 0, y2 + H2 / 2, -3.1);
      for (const s of [-1.3, 1.3]) { mesh(planeG(1.4, 1.4), M.win, s, y2 + 1.5, -0.49, lot.body); B.box(1.6, 0.12, 0.12, M.dark, s, y2 + 0.75, -0.45); B.box(1.6, 0.12, 0.12, M.dark, s, y2 + 2.25, -0.45); }
      B.box(5.5, 0.12, 0.9, M.wood, 0, y2 + 0.06, -0.1); B.box(5.5, 0.5, 0.06, M.wood2, 0, y2 + 0.36, 0.33);
      for (let i = 0; i < 5; i++) addLight(lot, -2.2 + i * 1.1, y2 - 0.35, 0.36, 'lan');
      const rf = L === 8 ? M.tile : M.roof;
      B.add(coneG(4.0, 1.5, 4), rf, 0, y2 + H2 + 0.75, -3.1, 0, Math.PI / 4, 0, 1, 1, 1.02);
      const blade = mesh(planeG(0.75, 2.6), signMat(neonTex(v.word, v.neon, true)), 2.95, y2 + 1.5, -0.6, lot.body); blade.rotation.y = Math.PI / 2; const b2 = blade.clone(); b2.rotation.y = -Math.PI / 2; b2.position.x = 2.97; lot.body.add(b2);
      B.box(0.6, 0.06, 0.06, M.dark, 2.75, y2 + 2.8, -0.6);
      top = y2 + H2 + 2.2; inside = true;
      if (L === 8) {
        const y3 = y2 + H2 + 1.2;
        for (const s of [-hw + 0.1, hw - 0.1]) B.add(cylG(0.18, 0.18, H1, 10), M.red, s, H1 / 2, 0.15);
        B.box(5.6, 0.16, 0.16, M.gold, 0, H1 + 0.02, 0.18);
        B.box(3.4, 2.0, 3.4, th2, 0, y3 + 1.0, -3.1); mesh(planeG(1.6, 1.0), M.win, 0, y3 + 1.0, -1.39, lot.body);
        B.add(coneG(3.0, 1.4, 4), M.tile, 0, y3 + 2.7, -3.1, 0, Math.PI / 4, 0);
        B.add(cylG(0.05, 0.12, 1.0, 6), M.gold, 0, y3 + 3.8, -3.1); B.add(sphG(0.18, 8, 6), M.gold, 0, y3 + 4.35, -3.1);
        for (const [sx, sz2] of [[-2.7, -0.4], [2.7, -0.4], [-2.7, -5.8], [2.7, -5.8]]) addLight(lot, sx, y2 + H2 - 0.1, sz2, 'lan');
        const gs = mesh(planeG(4.6, 1.15), signMat(signTex('GRAND', '#6e0d12', '#ffd36a', v.word + ' RESTAURANT')), 0, y2 + H2 + 0.0, -0.45, lot.body);
        lot.g.updateMatrixWorld(true); gs.getWorldPosition(_v3); lot.lights.push({ o: gs, on: gs.material, gi: glow(_v3.x, _v3.y, _v3.z, '#ffb340', 6 * lot.s), col: '#ffb340', size: 6 * lot.s, sign: true });
        top = y3 + 5.0;
      }
    }
  }
  B.build(lot.body);
  Object.assign(lot, { frontW, frontH, sz, top, stand, inside });
  // guild lantern hangs above the stall
  if (!lot.gold) {
    lot.gold = new THREE.Group(); lot.g.add(lot.gold);
    const gl = mesh(sphG(0.55, 12, 10), GLAN, 0, 0, 0, lot.gold); gl.scale.set(1, 1.2, 1);
    mesh(cylG(0.32, 0.32, 0.16, 10), M.gold, 0, 0.7, 0, lot.gold); mesh(cylG(0.32, 0.32, 0.16, 10), M.gold, 0, -0.7, 0, lot.gold); mesh(cylG(0.02, 0.02, 0.5, 4), M.dark, 0, 1.05, 0, lot.gold);
    mesh(boxG(0.06, 0.5, 0.06), M.red, 0, -1.0, 0, lot.gold);
    lot.goldGi = glow(0, -100, 0, '#ffc61a', 0);
  }
  lot.gold.position.set(0, top + 1.0, -0.6);
  syncGold(lot);
}
function syncGold(lot) {
  const on = !!(lot.owner && lot.owner.rank && !lot.owner.sold);
  if (lot.gold) lot.gold.visible = on;
  if (lot.goldGi >= 0 && lot.gold) { lot.g.updateMatrixWorld(true); lot.gold.getWorldPosition(_v3); setGlow(lot.goldGi, _v3.x, _v3.y, _v3.z, '#e0a010', on ? 3.4 * lot.s : 0); }
}
// hit boxes for picking a stall (kept out of the scene)
const HIT = [];
for (const lot of LOTS) {
  lot.g = new THREE.Group(); lot.g.position.set(lot.x, 0, lot.z); lot.g.rotation.y = lot.ry; lot.g.scale.setScalar(lot.s); scene.add(lot.g);
  lot.lights = []; lot.cook = [];
  const h = new THREE.Mesh(boxG(5.4, 8, 6.4), new THREE.MeshBasicMaterial()); h.position.set(0, 4, -2.6); lot.g.add(h); h.visible = false; h.userData.lot = lot; HIT.push(h);
}

/* ───────── roller shutter ───────── */
const shutterG = boxG(1, 1, 1).clone().translate(0, -0.5, 0);
function makeShutter(lot) {
  const g = new THREE.Group(); g.position.set(0, 0, lot.sz + 0.08); lot.g.add(g);
  const w = lot.frontW, h = lot.frontH;
  const tex = corrTex.clone(); tex.needsUpdate = true; tex.repeat.set(w / 2, h / 1.2);
  const panel = new THREE.Mesh(shutterG, new THREE.MeshStandardMaterial({ map: tex, metalness: 0.55, roughness: 0.45, color: '#c8ccd4' }));
  panel.position.y = h; panel.scale.set(w, 0.001, 0.06); g.add(panel);
  mesh(boxG(w + 0.2, 0.26, 0.3), M.metal, 0, h + 0.1, 0, g);
  if (lot.owner.level <= 5) for (const s of [-1, 1]) { const p = mesh(boxG(0.1, h + 0.2, 0.12), M.metal, s * (w / 2 + 0.05), (h + 0.2) / 2, 0, g); }
  const sign = new THREE.Group(); sign.position.set(0, h * 0.62, 0.08); g.add(sign); sign.visible = false;
  mesh(planeG(1.5, 0.75), new THREE.MeshStandardMaterial({ map: closedTex, roughness: 0.8 }), 0, -0.55, 0.02, sign);
  for (const s of [-1, 1]) { const st = mesh(boxG(0.015, 0.5, 0.015), M.dark, s * 0.5, -0.05, 0.02, sign); st.rotation.z = -s * 0.5; }
  mesh(sphG(0.05, 6, 4), M.metal, 0, 0.18, 0, sign);
  return { g, panel, sign, h };
}
SB.build(scene);

/* ───────── people ───────── */
const SKINS = ['#f1c8a0', '#d9a77a', '#b07a52', '#8a5a3a', '#f5d6b8', '#c48c62'];
const SHIRTS = ['#3a4a7a', '#7a2f3a', '#2f6a5a', '#5a4a8a', '#8a6a2a', '#30343e', '#6a3a6a', '#2a5a8a', '#9a4a2a'];
const legG = boxG(0.2, 0.7, 0.24), armG = boxG(0.16, 0.62, 0.18).clone().translate(0, -0.28, 0);
function makePerson({ skin = pick(SKINS), shirt = pick(SHIRTS), apron = '#e9e1d2', hat = 'straw', hatC = '#d8b878', pack = false } = {}) {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const legL = mesh(legG, mat('#2a2a34'), -0.13, 0.35, 0, body), legR = mesh(legG, mat('#2a2a34'), 0.13, 0.35, 0, body);
  const torso = mesh(boxG(0.56, 0.66, 0.36), mat(shirt), 0, 1.03, 0, body);
  const ap = mesh(boxG(0.46, 0.7, 0.04), mat(apron), 0, 0.92, 0.2, body);
  const armL = mesh(armG, mat(shirt), -0.37, 1.32, 0, body), armR = mesh(armG, mat(shirt), 0.37, 1.32, 0, body);
  mesh(boxG(0.14, 0.14, 0.16), mat(skin), 0, -0.6, 0, armL); mesh(boxG(0.14, 0.14, 0.16), mat(skin), 0, -0.6, 0, armR);
  const head = new THREE.Group(); head.position.y = 1.6; body.add(head);
  mesh(boxG(0.42, 0.42, 0.4), mat(skin), 0, 0, 0, head);
  mesh(boxG(0.06, 0.06, 0.02), M.dark, -0.1, 0.03, 0.21, head); mesh(boxG(0.06, 0.06, 0.02), M.dark, 0.1, 0.03, 0.21, head);
  const hs = new THREE.Group(); hs.position.y = 0.21; head.add(hs);
  if (hat === 'straw') { mesh(coneG(0.52, 0.28, 10), mat(hatC), 0, 0.12, 0, hs); }
  else if (hat === 'band') { mesh(boxG(0.46, 0.1, 0.44), mat(hatC), 0, -0.04, 0, hs); mesh(boxG(0.44, 0.06, 0.42), mat('#1a1418'), 0, 0.04, 0, hs); }
  else if (hat === 'cap') { mesh(boxG(0.46, 0.14, 0.44), mat(hatC), 0, 0.05, 0, hs); mesh(boxG(0.4, 0.04, 0.22), mat(hatC), 0, 0, 0.3, hs); }
  else if (hat === 'toque' || hat === 'boss') { const big = hat === 'boss' ? 1.35 : 1; const hm = hat === 'boss' ? M.gold : mat(hatC); mesh(cylG(0.22, 0.2, 0.3 * big, 10), hm, 0, 0.14 * big, 0, hs); const pf = mesh(sphG(0.3, 10, 8), hm, 0, 0.36 * big, 0, hs); pf.scale.set(1, 0.7 * big, 1); mesh(boxG(0.46, 0.06, 0.44), mat(hatC), 0, 0.02, 0, hs); }
  const bp = mesh(boxG(0.44, 0.52, 0.26), mat('#3d6a3a'), 0, 1.06, -0.32, body); mesh(boxG(0.36, 0.18, 0.06), mat('#2c4a2a'), 0, 1.2, -0.15, bp); mesh(boxG(0.5, 0.12, 0.3), mat('#7a5634'), 0, 0.3, 0, bp); bp.visible = pack;
  const blob = mesh(new THREE.CircleGeometry(0.45, 12).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.35, depthWrite: false }), 0, 0.02, 0, g);
  return { g, body, legL, legR, armL, armR, torso, apron: ap, head, hs, pack: bp };
}
function animPerson(p, t, moving, ph, mode) {
  const s = moving ? Math.sin(t * 9 + ph) : 0;
  p.legL.rotation.x = s * 0.6; p.legR.rotation.x = -s * 0.6;
  if (mode === 'cook') { p.armR.rotation.x = -1.1 + Math.sin(t * 6 + ph) * 0.35; p.armL.rotation.x = -0.9 + Math.sin(t * 3 + ph) * 0.15; p.body.position.y = Math.abs(Math.sin(t * 3 + ph)) * 0.03; }
  else if (mode === 'wave') { p.armR.rotation.x = -2.6; p.armR.rotation.z = Math.sin(t * 10) * 0.4; p.armL.rotation.x = 0; }
  else if (mode === 'play') { p.armR.rotation.x = -1.2 + Math.sin(t * 12 + ph) * 0.5; p.armL.rotation.x = -1.0 + Math.cos(t * 12 + ph) * 0.4; p.body.position.y = Math.abs(Math.sin(t * 5.2 + ph)) * 0.12; }
  else { p.armL.rotation.x = -s * 0.5; p.armR.rotation.x = s * 0.5; p.armR.rotation.z = 0; p.body.position.y = moving ? Math.abs(s) * 0.06 : Math.sin(t * 1.6 + ph) * 0.01; }
}

/* ───────── crowd: instanced customers and strollers ───────── */
const CN = IS_PHONE ? 200 : 300;
const cLeg = new THREE.InstancedMesh(boxG(0.4, 0.7, 0.24), mat('#2a2a34'), CN), cTor = new THREE.InstancedMesh(boxG(0.54, 0.64, 0.34), new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true }), CN), cHead = new THREE.InstancedMesh(boxG(0.4, 0.4, 0.38), new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true }), CN);
const umbG = mergeGeometries([coneG(0.75, 0.32, 8).clone().translate(0, 2.35, 0), cylG(0.025, 0.025, 1.0, 4).clone().translate(0, 1.85, 0)]);
const cUmb = new THREE.InstancedMesh(umbG, new THREE.MeshStandardMaterial({ roughness: 0.6, flatShading: true }), CN);
for (const im of [cLeg, cTor, cHead, cUmb]) { im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.frustumCulled = false; scene.add(im); }
const UMBC = ['#e8434f', '#2f7cf6', '#ffc61a', '#1fb36b', '#f2f6f7', '#9a63ff', '#ff7a1a', '#22d3ee'];
const AG = [];
for (let i = 0; i < CN; i++) { const a = { i, st: 0, x: 0, z: 0, tx: 0, tz: 0, yaw: 0, ph: rnd() * 9, sp: rr(1.3, 1.9), umb: rnd() < 0.38, lot: null, wait: 0 }; AG.push(a); cTor.setColorAt(i, _c.set(pick(SHIRTS))); cHead.setColorAt(i, _c.set(pick(SKINS))); cUmb.setColorAt(i, _c.set(pick(UMBC))); }
const _o = new THREE.Object3D();
function freeAgent() { for (const a of AG) if (a.st === 0) return a; return null; }
function streetPoint(z) { return { x: rr(-4.6, 4.6), z: clamp(z, Z_END + 2, Z_IN + 6) }; }
function spawnAgent(a, x, z) { a.x = x; a.z = z; a.st = 1; a.wait = 0; }
function updateCrowd(dt, t) {
  for (const a of AG) {
    if (a.st === 0) { for (const im of [cLeg, cTor, cHead, cUmb]) { _o.position.set(0, -50, 0); _o.scale.setScalar(0.001); _o.updateMatrix(); im.setMatrixAt(a.i, _o.matrix); } continue; }
    let moving = false;
    if (a.st === 1 || a.st === 3 || a.st === 4) {
      const dx = a.tx - a.x, dz = a.tz - a.z, d = Math.hypot(dx, dz);
      if (d > 0.08) { const k = Math.min(d, a.sp * dt * SPEED.walk) / d; a.x += dx * k; a.z += dz * k; a.yaw = Math.atan2(dx, dz); moving = true; }
      else if (a.st === 1) a.st = 2;
      else if (a.st === 3) { a.wait -= dt; if (a.wait <= 0) { const p = streetPoint(a.z + rr(-30, 30)); a.tx = p.x; a.tz = p.z; a.wait = rr(1, 6); } }
      else if (a.st === 4) { a.st = 0; continue; }
      if (canalOn && Math.abs(a.z - CANAL_Z) < 4.6) a.x += (clamp(a.x, -3.0, 3.0) - a.x) * Math.min(1, dt * 6);
    }
    if (a.st === 2 && a.lot) { a.yaw += (a.fy - a.yaw) * Math.min(1, dt * 4); }
    const y = groundY(a.x, a.z), b = moving ? Math.abs(Math.sin(t * 9 + a.ph)) * 0.05 : Math.sin(t * 1.5 + a.ph) * 0.01;
    _o.rotation.set(0, a.yaw, 0); _o.scale.setScalar(1);
    _o.position.set(a.x, y + 0.35 + b, a.z); _o.updateMatrix(); cLeg.setMatrixAt(a.i, _o.matrix);
    _o.position.set(a.x, y + 1.02 + b, a.z); _o.updateMatrix(); cTor.setMatrixAt(a.i, _o.matrix);
    _o.position.set(a.x, y + 1.56 + b, a.z); _o.updateMatrix(); cHead.setMatrixAt(a.i, _o.matrix);
    if (a.umb) { _o.position.set(a.x, y + b, a.z); _o.rotation.set(0.12, a.yaw, 0); _o.updateMatrix(); cUmb.setMatrixAt(a.i, _o.matrix); }
    else { _o.position.set(0, -50, 0); _o.scale.setScalar(0.001); _o.updateMatrix(); cUmb.setMatrixAt(a.i, _o.matrix); }
  }
  for (const im of [cLeg, cTor, cHead, cUmb]) im.instanceMatrix.needsUpdate = true;
}
// queue slots in front of a stall (local frame: +z is the street)
function slotLocal(lot, i) { if (lot.boss) return { x: 1.1, z: 1.4 + i * 0.75 }; return i < 3 ? { x: 1.0, z: 1.5 + i * 0.75 } : { x: 1.0 + (i - 2) * 0.72, z: 3.0 }; }
function queueWant(v) { if (!v || v.sold) return 0; if (v.rank === 1) return 11; return [0, 0, 0, 1, 2, 3, 4, 5, 6][v.level] + (v.rank ? 1 : 0); }
const _w = { x: 0, z: 0 };
function syncQueue(lot) {
  lot.queue = lot.queue || [];
  const want = queueWant(lot.owner);
  while (lot.queue.length > want) leaveQueue(lot.queue.pop());
  while (lot.queue.length < want) {
    const a = freeAgent(); if (!a) break;
    const s = slotLocal(lot, lot.queue.length); lw(lot, s.x, s.z, _w);
    const p = streetPoint(lot.z + rr(-14, 14)); spawnAgent(a, p.x, p.z); a.tx = _w.x; a.tz = _w.z; a.lot = lot; a.st = 1;
    lw(lot, s.x, s.z - 1, _v2); a.fy = Math.atan2(_v2.x - _w.x, _v2.z - _w.z);
    lot.queue.push(a);
  }
}
const _v2 = { x: 0, z: 0 };
function leaveQueue(a) { if (!a) return; a.lot = null; a.st = 3; const p = streetPoint(a.z + rr(-25, 25)); a.tx = p.x; a.tz = p.z; a.wait = rr(0.5, 3); }
function exitAgent(a) { a.lot = null; a.st = 4; a.tx = rr(-3, 3); a.tz = Z_IN + 30; }

/* ───────── street upgrades (treasury milestones) ───────── */
const UPG = [
  { name: 'String lights across the street', eth: 0.25, at: { x: 0, z: 20, d: 60, p: 0.5 } },
  { name: 'A stage with a live band', eth: 0.5, at: { x: STAGE.x, z: STAGE.z, d: 30, p: 0.45, yaw: 1.0 } },
  { name: 'A koi canal with a little bridge', eth: 1, at: { x: 0, z: CANAL_Z, d: 30, p: 0.7 } },
  { name: 'A ferris wheel at the end of the street', eth: 2, at: { x: 0, z: -105, d: 75, p: 0.18 } },
  { name: 'A giant dragon lantern arch', eth: 3, at: { x: 0, z: ARCH_Z, d: 42, p: 0.22 } },
];
let upLevel = 0;
const UG = UPG.map(() => { const g = new THREE.Group(); g.visible = false; scene.add(g); return g; });
const UANIM = [];
// 1 · string lights
const STR = [];
{
  const g = UG[0], pts = [], B = new Batch(), pole = mat('#2a1d1a');
  const cols = ['#ffd27a', '#ff8a5a', '#ffe9b0', '#ff6f9a', '#9fe6ff', '#ffc65a'];
  for (let z = 70, k = 0; z > Z_END + 4; z -= 7, k++) {
    if (Math.abs(z - CANAL_Z) < 3) continue;
    const z1 = z, z2 = z - 3.5, ya = 7.4, n = 10;
    for (const [x, zz] of [[-6.35, z1], [6.35, z2]]) B.add(cylG(0.06, 0.08, ya, 6), pole, x, ya / 2, zz);
    let px = -6.35, py = ya, pz = z1;
    for (let i = 1; i <= n; i++) { const t = i / n, x = lerp(-6.35, 6.35, t), y = ya - Math.sin(t * Math.PI) * 1.1, zz = lerp(z1, z2, t); pts.push(px, py, pz, x, y, zz); if (i < n) STR.push({ x, y: y - 0.14, z: zz, col: cols[(i + k) % cols.length], gi: -1, d: (Z_IN - z) / (Z_IN - Z_END) }); px = x; py = y; pz = zz; }
  }
  B.build(g);
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); g.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: '#0a0808' })));
  const bm = new THREE.InstancedMesh(sphG(0.1, 6, 4), emat('#ffe2a0', 3), STR.length); STR.forEach((s, i) => { _o.position.set(s.x, s.y, s.z); _o.rotation.set(0, 0, 0); _o.scale.setScalar(1); _o.updateMatrix(); bm.setMatrixAt(i, _o.matrix); }); g.add(bm);
}
// 2 · stage with a band
const BANDP = [], SPOTS = [];
{
  const g = UG[1]; g.position.set(STAGE.x, 0, STAGE.z); const B = new Batch();
  B.box(6, 0.9, 11, mat('#3a2a2a'), 0, 0.45, 0); B.box(6.2, 0.1, 11.2, mat('#5a3a2a'), 0, 0.95, 0);
  for (let i = 0; i < 3; i++) B.box(0.55, 0.3 * (3 - i), 2.4, mat('#4a3430'), 3.28 + i * 0.55, 0.15 * (3 - i), 0); // steps down to the street
  B.box(0.3, 5.6, 11, mat('#1c1424'), -2.9, 2.8, 0);
  for (const z of [-5.4, 5.4]) { B.add(cylG(0.14, 0.14, 6.6, 8), M.metal, 2.8, 3.3, z); B.add(cylG(0.14, 0.14, 6.6, 8), M.metal, -2.8, 3.3, z); }
  B.box(0.25, 0.25, 11, M.metal, 2.8, 6.5, 0); B.box(0.25, 0.25, 11, M.metal, -2.8, 6.5, 0); B.box(5.8, 0.25, 0.25, M.metal, 0, 6.5, -5.4); B.box(5.8, 0.25, 0.25, M.metal, 0, 6.5, 5.4);
  for (const z of [-4.6, 4.6]) { B.box(1.1, 1.8, 1.1, mat('#15121a'), 1.8, 1.9, z); B.add(cylG(0.32, 0.32, 0.05, 12), mat('#4a4a52'), 2.36, 2.2, z, 0, 0, Math.PI / 2); B.add(cylG(0.2, 0.2, 0.05, 12), mat('#4a4a52'), 2.36, 1.45, z, 0, 0, Math.PI / 2); }
  // drum kit, keyboard, mic stand
  B.add(cylG(0.45, 0.45, 0.5, 12), mat('#c7312a'), -1.0, 1.35, 1.8, Math.PI / 2, 0, 0); B.add(cylG(0.25, 0.25, 0.3, 10), mat('#e0e0e0'), -0.6, 1.75, 1.0); B.add(cylG(0.35, 0.35, 0.02, 12), M.gold, -0.4, 2.1, 2.6);
  B.box(0.5, 0.1, 1.6, mat('#202024'), 0.6, 1.85, -2.2); B.box(0.08, 0.85, 0.08, M.metal, 0.6, 1.4, -2.8); B.box(0.08, 0.85, 0.08, M.metal, 0.6, 1.4, -1.6);
  B.add(cylG(0.03, 0.03, 1.5, 4), M.metal, 1.6, 1.7, 0); B.add(sphG(0.07, 6, 4), mat('#202024'), 1.6, 2.5, 0);
  B.build(g);
  const live = mesh(planeG(4.2, 1.3), signMat(neonTex('LIVE!', '#ff4f8b')), -2.72, 4.4, 0, g); live.rotation.y = Math.PI / 2;
  const looks = [{ hat: 'cap', hatC: '#ff4f8b', x: -1.6, z: 1.8, ry: Math.PI / 2 }, { hat: 'band', hatC: '#35e0ff', x: 0.9, z: 2.6, ry: Math.PI / 2.2 }, { hat: 'straw', hatC: '#ffd23a', x: 1.0, z: 0, ry: Math.PI / 2 }, { hat: 'cap', hatC: '#7dff6a', x: 0.0, z: -2.2, ry: Math.PI / 2 }];
  for (const L of looks) { const p = makePerson({ hat: L.hat, hatC: L.hatC, apron: L.hatC, shirt: '#1a1424' }); p.g.position.set(L.x, 0.95, L.z); p.g.rotation.y = L.ry; g.add(p.g); BANDP.push(p); }
  // guitar for one of them
  const gt = mesh(boxG(0.5, 0.14, 0.3), mat('#d86a2a'), 0, 0.95, 0.24, BANDP[1].body); mesh(boxG(0.5, 0.05, 0.06), mat('#3a2a1a'), 0.45, 1.05, 0.24, BANDP[1].body);
  const coneM = new THREE.MeshBasicMaterial({ color: '#ffd6a0', transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  for (let i = 0; i < 3; i++) { const cg = new THREE.ConeGeometry(1.4, 5.4, 16, 1, true).translate(0, -2.7, 0); const c = new THREE.Mesh(cg, coneM.clone()); c.position.set(1.2, 6.4, -3 + i * 3); g.add(c); SPOTS.push(c); }
  UG[1].notes = [];
}
// 3 · koi canal and bridge
const KOI = [];
{
  const g = UG[2], B = new Batch(), stone = mat('#4a4450'), red = mat('#b8262a'), wood = mat('#7a4a2a');
  const water = new THREE.Mesh(planeG(31, 4).clone().rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#0d2a36', roughness: 0.06, metalness: 0.4, transparent: true, opacity: 0.82, emissive: '#06222c', emissiveIntensity: 0.6, envMapIntensity: 1.6 }));
  water.position.set(0, 0.06, CANAL_Z); g.add(water);
  for (const s of [-1, 1]) for (const [x0, x1] of [[-15.5, -3.7], [3.7, 15.5]]) B.box(x1 - x0, 0.32, 0.36, stone, (x0 + x1) / 2, 0.16, CANAL_Z + s * 2.18);
  const n = 12, L = 8.4;
  for (let i = 0; i < n; i++) { const z0 = CANAL_Z - L / 2 + (i / n) * L, z1 = CANAL_Z - L / 2 + ((i + 1) / n) * L, y0 = groundYBridge(z0), y1 = groundYBridge(z1), zm = (z0 + z1) / 2, ym = (y0 + y1) / 2, ang = Math.atan2(y1 - y0, z1 - z0);
    B.box(7.2, 0.18, Math.hypot(z1 - z0, y1 - y0) + 0.04, wood, 0, ym - 0.09, zm, 0, -ang, 0);
    for (const s of [-1, 1]) { B.box(0.12, 0.7, 0.12, red, s * 3.5, ym + 0.3, zm); B.box(0.1, 0.1, Math.hypot(z1 - z0, y1 - y0) + 0.05, red, s * 3.5, ym + 0.66, zm, 0, -ang, 0); } }
  B.build(g);
  for (const s of [-1, 1]) for (const z of [CANAL_Z - 4.2, CANAL_Z + 4.2]) { const lm = mesh(lanG, LAN, s * 3.5, 1.15, z, g); lm.scale.set(0.8, 1, 0.8); g.userData.lan = g.userData.lan || []; g.userData.lan.push({ x: s * 3.5, y: 1.15, z }); }
  for (let i = 0; i < 9; i++) { const pad = mesh(cylG(0.4, 0.4, 0.02, 10), mat('#2f6a3a'), rr(-14, 14), 0.08, CANAL_Z + rr(-1.5, 1.5), g); if (Math.abs(pad.position.x) < 4) pad.position.x += 8; }
  for (let i = 0; i < 12; i++) { const k = new THREE.Group(); const col = pick(['#ff7a1a', '#f2f6f7', '#ff5a2a', '#ffb050']); mesh(boxG(0.5, 0.1, 0.18), mat(col, { emissive: col, emissiveIntensity: 0.25 }), 0, 0, 0, k); const tl = mesh(coneG(0.12, 0.25, 4), mat(col), -0.35, 0, 0, k); tl.rotation.z = Math.PI / 2; k.position.set(rr(-14, 14), 0.1, CANAL_Z + rr(-1.4, 1.4)); g.add(k); KOI.push({ k, ph: rnd() * 6, sp: rr(0.6, 1.4) * (rnd() < 0.5 ? -1 : 1), z0: k.position.z }); }
}
function groundYBridge(z) { return Math.cos(((z - CANAL_Z) / 4.2) * Math.PI * 0.5) * 1.05 * (Math.abs(z - CANAL_Z) < 4.2 ? 1 : 0); }
// 4 · ferris wheel
const FW = { rim: [], cabs: [], rot: 0 };
{
  const g = UG[3]; g.position.set(0, 0, WHEEL.z); const B = new Batch(), steel = mat('#d8dce6', { metalness: 0.6, roughness: 0.35 }), dk = mat('#3a3a48', { metalness: 0.4 });
  for (const s of [-1, 1]) for (const zz of [-1.6, 1.6]) { const ang = Math.atan2(7, WHEEL.y); B.box(0.5, Math.hypot(7, WHEEL.y), 0.5, dk, s * 3.5, WHEEL.y / 2, zz, 0, 0, s * ang); }
  B.box(9, 0.6, 4, dk, 0, 0.3, 0);
  const wheel = new THREE.Group(); wheel.position.y = WHEEL.y; g.add(wheel); FW.wheel = wheel;
  const WB = new Batch();
  for (const zz of [-0.9, 0.9]) WB.add(new THREE.TorusGeometry(WHEEL.r, 0.18, 6, 64), steel, 0, 0, zz);
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; for (const zz of [-0.9, 0.9]) WB.box(0.12, WHEEL.r, 0.12, steel, Math.cos(a) * WHEEL.r / 2, Math.sin(a) * WHEEL.r / 2, zz, 0, 0, a - Math.PI / 2); WB.box(0.12, 0.12, 1.9, steel, Math.cos(a) * WHEEL.r, Math.sin(a) * WHEEL.r, 0); }
  WB.add(cylG(1.1, 1.1, 2.6, 12), dk, 0, 0, 0, Math.PI / 2, 0, 0);
  WB.build(wheel);
  const cabC = ['#e8434f', '#ffc61a', '#2f7cf6', '#1fb36b', '#ff5fa2', '#22d3ee', '#ff7a1a', '#9a63ff'];
  for (let i = 0; i < 16; i++) { const c = new THREE.Group(); mesh(boxG(1.5, 1.3, 1.3), mat(cabC[i % 8]), 0, -1.0, 0, c); mesh(boxG(1.3, 0.5, 1.34), M.win, 0, -0.85, 0, c); mesh(coneG(1.05, 0.5, 4), mat('#f2f6f7'), 0, -0.1, 0, c).rotation.y = Math.PI / 4; g.add(c); FW.cabs.push({ c, a: (i / 16) * Math.PI * 2, gi: -1 }); }
  for (let i = 0; i < 64; i++) FW.rim.push({ a: (i / 64) * Math.PI * 2, gi: -1 });
  const ws = mesh(planeG(9, 2.2), signMat(signTex('SKY WHEEL', '#1a0e2a', '#ffd36a', 'ride the lanterns')), 0, 2.6, 2.1, g);
}
// 5 · dragon lantern arch at the entrance
const DRAGON = { segs: [], head: null };
{
  const g = UG[4]; g.position.z = ARCH_Z; const B = new Batch(), red = mat('#b8262a', { roughness: 0.6 }), dk = mat('#3a1414');
  for (const s of [-1, 1]) { B.add(cylG(0.55, 0.65, 10, 10), red, s * 7.6, 5, 0); B.box(1.8, 0.8, 1.8, mat('#4a4450'), s * 7.6, 0.4, 0); B.add(sphG(0.4, 8, 6), M.gold, s * 7.6, 10.4, 0); }
  B.box(18.5, 1.1, 1.3, red, 0, 9.1, 0); B.box(17, 0.5, 1.0, dk, 0, 7.7, 0); B.box(16, 0.18, 0.18, M.gold, 0, 8.45, 0.7);
  B.add(coneG(1, 1, 4), mat('#2a1418'), 0, 10.35, 0, 0, Math.PI / 4, 0, 14.2, 1.6, 1.6);
  B.build(g);
  const sign = mesh(planeG(7, 1.75), signMat(signTex('NIGHT MARKET', '#6e0d12', '#ffd36a', 'open while you hold')), 0, 8.0, 0.66, g);
  const sB = sign.clone(); sB.rotation.y = Math.PI; sB.position.z = -0.66; g.add(sB);
  const segM = emat('#ffb02a', 1.1), segM2 = emat('#ff3d2a', 1.1);
  for (let i = 0; i < 30; i++) { const m = mesh(sphG(0.62 - i * 0.012, 10, 8), i % 2 ? segM2 : segM, 0, 0, 0, g); m.scale.set(1, 0.9, 1.15); DRAGON.segs.push({ m, gi: -1 }); }
  const hd = new THREE.Group(); g.add(hd); DRAGON.head = hd;
  mesh(boxG(1.4, 1.0, 1.6), segM2, 0, 0, 0.2, hd); mesh(boxG(1.1, 0.4, 0.9), segM, 0, -0.35, 1.0, hd);
  for (const s of [-1, 1]) { const h = mesh(coneG(0.15, 1.0, 5), M.gold, s * 0.45, 0.85, -0.2, hd); h.rotation.x = -0.6; mesh(sphG(0.15, 6, 4), bmat('#ffffff'), s * 0.5, 0.2, 0.9, hd); const w = mesh(boxG(0.05, 0.05, 1.4), M.gold, s * 0.6, -0.3, 1.5, hd); w.rotation.y = s * 0.5; }
}
function revealUpgrade(k, instant) {
  const g = UG[k]; g.visible = true;
  if (k === 1) CRATES.visible = false;
  if (k === 2) canalOn = true;
  if (k === 0) for (const s of STR) s.gi = glow(s.x, s.y, s.z, s.col, 0);
  if (k === 2) for (const l of g.userData.lan) l.gi = glow(l.x, l.y, l.z, '#ff6a3a', 0);
  if (k === 3) { for (const r of FW.rim) r.gi = glow(0, 0, 0, '#ffffff', 0); for (const c of FW.cabs) c.gi = glow(0, 0, 0, '#ffd27a', 0); }
  if (k === 4) for (const s of DRAGON.segs) s.gi = glow(0, 0, 0, '#ffb02a', 0);
  UANIM.push({ k, t: instant ? 99 : 0 });
}

/* ───────── vendors (holders) ───────── */
const SPEED = { k: 1, walk: 1 };
const LEVEL_SEC = 12;              // demo: one level every 12 s (stands for 10 minutes held)
const SUPPLY = 1e9, LAMP_PER_ETH = 4.2e8;
const V = [];
const lvlOf = (h) => Math.min(8, 1 + Math.floor(h / LEVEL_SEC));
const heldTxt = (h) => { const m = Math.floor((h / LEVEL_SEC) * 10); return m < 60 ? m + ' min' : Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm'; };
const labels = $('#labels');
function dressPerson(v) {
  const old = v.p; const top = v.rank && v.rank <= 10, band = top ? BAND[v.rank - 1] : null;
  v.p = makePerson({ skin: v.skin, shirt: v.shirt, apron: top ? band : v.apronC, hat: v.rank === 1 ? 'boss' : top ? 'toque' : v.hatK, hatC: top ? band : v.hatC, pack: v.leaving });
  if (v.rank === 1) { const sash = mesh(boxG(0.1, 0.8, 0.4), M.gold, 0, 1.05, 0.02, v.p.body); sash.rotation.z = 0.7; v.p.g.scale.setScalar(1.12); }
  if (old) { v.p.g.position.copy(old.g.position); v.p.g.rotation.copy(old.g.rotation); v.p.g.visible = old.g.visible; scene.remove(old.g); }
  scene.add(v.p.g);
}
function makeVendor(bal, lot, held, opt = {}) {
  const v = { addr: mkAddr(), bal, held, level: lvlOf(held), lot, theme: pick(THEMES), theme2: pick(['#2a2238', '#3a2a24', '#24323a', '#3a2432', '#2e3a26']), word: pick(NEON_WORDS), neon: pick(NEON_COLS),
    rank: 0, online: false, sold: false, share: 0, hatK: pick(['straw', 'straw', 'band', 'cap']), hatC: pick(['#d8b878', '#c9a060', '#e8434f', '#2f7cf6', '#f2f6f7', '#3a3a44']), apronC: pick(['#e9e1d2', '#d9d0c0', '#bfc8d0', '#e0c8a8']),
    skin: pick(SKINS), shirt: pick(SHIRTS), x: 0, z: 0, yaw: 0, path: [], state: 'home', wait: rr(4, 12), ph: rnd() * 9, leaving: false, gone: false, born: clock.t, lastLv: 0 };
  lot.owner = v; V.push(v);
  dressPerson(v);
  v.lab = document.createElement('div'); v.lab.className = 'lab'; labels.appendChild(v.lab);
  buildStall(lot); goHomeNow(v); syncQueue(lot);
  if (opt.pop) lot.pop = 0;
  return v;
}
function standPos(v, out = _w) { const l = v.lot; return lw(l, l.stand.x, l.stand.z, out); }
function goHomeNow(v) { standPos(v); v.x = _w.x; v.z = _w.z; v.yaw = v.lot.ry; v.path.length = 0; v.state = 'home'; }
function renderLabel(v) {
  const r = v.rank, top = r && r <= 10, at = v.state === 'home' && v.lot.inside && !v.sold;
  v.lab.className = 'lab' + (v.sold ? ' sold' : '') + (at ? ' stall' : '');
  v.lab.innerHTML = (top && !v.sold ? `<span class="rk" style="background:${BAND[r - 1]}">${r}</span>` : '') + (r === 1 && !v.sold ? '<span class="bs">BOSS</span>' : '') +
    `<span class="ad">${v.sold ? '' : `<i class="dt${v.online ? ' on' : ''}"></i>`}${v.sold ? 'SOLD · ' : ''}${short(v.addr)}</span>`;
  v.labKey = '';
}
function rerank() {
  const act = V.filter((v) => !v.sold).sort((a, b) => b.bal - a.bal);
  act.forEach((v, i) => { const r = i < 10 ? i + 1 : 0; if (r !== v.rank) { const was = v.rank; v.rank = r; dressPerson(v); renderLabel(v); syncGold(v.lot); syncQueue(v.lot); } });
  renderLB(); syncStats();
}
function routeTo(v, tx, tz) {
  const lane = rr(-2.4, 2.4);
  v.path = [{ x: clamp(v.x, -5.2, 5.2) * 0.6 + lane * 0.4, z: v.z }, { x: lane, z: tz }, { x: tx, z: tz }];
  v.state = 'walk';
}
function frontOf(lot, d = 2.4) { return lw(lot, -1.2, d, { x: 0, z: 0 }); }
function setOnline(v, on) {
  if (v.sold || v.online === on) return; v.online = on;
  if (on) { const others = LOTS.filter((l) => l.owner && !l.owner.sold && l !== v.lot); const t = pick(others); const f = frontOf(t); v.visit = t; routeTo(v, f.x, f.z); }
  else { standPos(v); routeTo(v, _w.x, _w.z); v.state = 'return'; }
  renderLabel(v);
}
const _pv = new THREE.Vector3();
function updateVendor(v, dt, t) {
  if (v.gone) return;
  const P = v.p;
  // growth while holding
  if (!v.sold) { v.held += dt * SPEED.k; const L = lvlOf(v.held); if (L !== v.level) { v.level = L; v.lot.pop = 0; buildStall(v.lot); syncQueue(v.lot); if (Math.hypot(v.lot.x - camera.position.x, v.lot.z - camera.position.z) < 55 || tour.on) floatAt(v.lot.x, v.lot.top * v.lot.s + 1.6, v.lot.z, 'Lv ' + L + ' · ' + LEVELS[L - 1], 2.0, 'lv'); if (v.state === 'home') goHomeNow(v); renderLabel(v); if (cardFor === v) openCard(v); } }
  let moving = false;
  if (v.path.length) {
    const p = v.path[0], dx = p.x - v.x, dz = p.z - v.z, d = Math.hypot(dx, dz), sp = (v.leaving ? 2.6 : 2.1) * SPEED.walk;
    if (d < 0.1) v.path.shift(); else { const k = Math.min(d, sp * dt) / d; v.x += dx * k; v.z += dz * k; v.yaw = Math.atan2(dx, dz); moving = true; }
    if (canalOn && Math.abs(v.z - CANAL_Z) < 4.6) v.x += (clamp(v.x, -3.0, 3.0) - v.x) * Math.min(1, dt * 6);
    if (!v.path.length) {
      if (v.leaving) { v.gone = true; P.g.visible = false; v.lab.remove(); return; }
      if (v.state === 'walk') { v.state = 'visit'; v.wait = rr(4, 8); const l = v.visit; v.yaw = Math.atan2(l.x - v.x, l.z - v.z); }
      else if (v.state === 'return') { goHomeNow(v); renderLabel(v); }
    }
  } else if (v.state === 'visit') { v.wait -= dt; if (v.wait <= 0) { const others = LOTS.filter((l) => l.owner && !l.owner.sold && l !== v.lot && l !== v.visit); const tl = pick(others); v.visit = tl; const f = frontOf(tl); routeTo(v, f.x, f.z); } }
  const hidden = v.state === 'home' && v.lot.inside && !v.sold;
  P.g.visible = !hidden && !v.gone;
  P.g.position.set(v.x, groundY(v.x, v.z), v.z); P.g.rotation.y = v.yaw;
  animPerson(P, t, moving, v.ph, v.state === 'home' && !v.sold ? 'cook' : v.state === 'visit' ? (Math.sin(t * 0.7 + v.ph) > 0.6 ? 'wave' : 'idle') : 'idle');
  // label anchor
  const lab = v.lab; let ax, ay, az;
  if (hidden) { ax = v.lot.x; az = v.lot.z; ay = (v.lot.top + 0.5) * v.lot.s + (v.rank ? 2.4 : 0); lw(v.lot, 0, -1.2, _w); ax = _w.x; az = _w.z; }
  else { ax = v.x; az = v.z; ay = P.g.position.y + (v.rank === 1 ? 2.75 : 2.45); }
  _pv.set(ax, ay, az); const dist = _pv.distanceTo(camera.position); _pv.project(camera);
  const vis = _pv.z < 1 && _pv.x > -1.1 && _pv.x < 1.1 && _pv.y > -1.1 && _pv.y < 1.1;
  const far = dist > (v.rank ? 150 : IS_PHONE ? 60 : 85) || (!v.rank && labelsTopOnly);
  if (!vis || far) { if (lab.style.opacity !== '0') lab.style.opacity = '0'; }
  else { if (lab.style.opacity !== '1') lab.style.opacity = '1'; const sx = (_pv.x * 0.5 + 0.5) * innerWidth, sy = (-_pv.y * 0.5 + 0.5) * innerHeight; const sc = clamp(34 / dist + 0.55, 0.62, 1.15); lab.style.transform = `translate(${sx | 0}px,${sy | 0}px) translate(-50%,-100%) scale(${sc.toFixed(2)})`; lab.style.zIndex = v.rank ? 30 - v.rank : 1; }
  // steam from the woks
  if (!v.sold && v.lot.cook.length && rnd() < dt * (v.level >= 2 ? 7 : 3)) { const c = pick(v.lot.cook); puff(c.x, c.y, c.z, v.lot.s); }
}
let labelsTopOnly = false;

/* ───────── floating texts ───────── */
const floats = [], fxEl = $('#fx');
function floatAt(x, y, z, s, life = 1.8, cls = '') { const d = document.createElement('div'); d.className = 'fl ' + cls; d.textContent = s; fxEl.appendChild(d); floats.push({ d, x, y, z, t: 0, life }); }
function updateFloats(dt) {
  for (let i = floats.length - 1; i >= 0; i--) { const f = floats[i]; f.t += dt; if (f.t > f.life) { f.d.remove(); floats.splice(i, 1); continue; }
    _pv.set(f.x, f.y + f.t * 1.1, f.z).project(camera); const sx = (_pv.x * 0.5 + 0.5) * innerWidth, sy = (-_pv.y * 0.5 + 0.5) * innerHeight, a = Math.min(1, (f.life - f.t) * 2.5, f.t * 6);
    f.d.style.opacity = _pv.z < 1 ? a.toFixed(2) : '0'; f.d.style.transform = `translate(${sx | 0}px,${sy | 0}px) translate(-50%,-50%) scale(${(0.8 + Math.min(1, f.t * 5) * 0.2).toFixed(2)})`; }
}

/* ───────── fireworks ───────── */
const FWN = 2600, fwBase = gTop; for (let i = 0; i < FWN; i++) glow(0, -999, 0, '#000', 0);
const fx = { x: new Float32Array(FWN), y: new Float32Array(FWN), z: new Float32Array(FWN), vx: new Float32Array(FWN), vy: new Float32Array(FWN), vz: new Float32Array(FWN), l: new Float32Array(FWN), m: new Float32Array(FWN), s: new Float32Array(FWN), r: new Float32Array(FWN), g: new Float32Array(FWN), b: new Float32Array(FWN), k: new Uint8Array(FWN) };
let fwHead = 0; const rockets = [];
function spark(x, y, z, vx, vy, vz, life, size, col, kind = 0) { const i = fwHead; fwHead = (fwHead + 1) % FWN; fx.x[i] = x; fx.y[i] = y; fx.z[i] = z; fx.vx[i] = vx; fx.vy[i] = vy; fx.vz[i] = vz; fx.l[i] = life; fx.m[i] = life; fx.s[i] = size; _c.set(col); fx.r[i] = _c.r; fx.g[i] = _c.g; fx.b[i] = _c.b; fx.k[i] = kind; }
const FW_COLS = [['#ffd36a', '#fff1c0'], ['#ff4f6a', '#ffb0c0'], ['#5ad0ff', '#d0f4ff'], ['#9dff7a', '#eaffd0'], ['#c58bff', '#f0deff'], ['#ff9a3a', '#ffe0b0']];
function burst(x, y, z, type = (rnd() * 4) | 0) {
  const [c1, c2] = pick(FW_COLS), n = type === 2 ? 110 : 150;
  for (let i = 0; i < n; i++) {
    let u = rr(-1, 1), a = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u), sp = type === 1 ? 13 : rr(9, 14);
    let vx = r * Math.cos(a) * sp, vy = u * sp, vz = r * Math.sin(a) * sp;
    if (type === 1) { const aa = (i / n) * Math.PI * 2; vx = Math.cos(aa) * sp; vy = Math.sin(aa) * sp; vz = rr(-1, 1); }
    spark(x, y, z, vx, vy, vz, type === 2 ? rr(2.4, 3.2) : rr(1.4, 2.0), type === 2 ? 3.2 : 4.0, i % 3 ? c1 : c2, type === 2 ? 2 : type === 3 ? 3 : 1);
  }
  flashK = Math.min(1.6, flashK + 0.9); _c.set(c1); flash.color.copy(_c); flash.position.set(x, y, z);
}
let flashK = 0;
function launch(x, z, delay = 0) { rockets.push({ x, y: 0.5, z, vy: rr(26, 32), t: -delay, top: rr(32, 46), type: (rnd() * 4) | 0 }); }
function updateFireworks(dt) {
  for (let i = rockets.length - 1; i >= 0; i--) { const r = rockets[i]; r.t += dt; if (r.t < 0) continue; r.y += r.vy * dt; r.vy -= 3 * dt; spark(r.x + rr(-0.1, 0.1), r.y, r.z, rr(-0.5, 0.5), -2, rr(-0.5, 0.5), 0.5, 2.4, '#ffcf8a', 0); if (r.y >= r.top) { burst(r.x, r.y, r.z, r.type); rockets.splice(i, 1); } }
  const t = clock.t;
  for (let i = 0; i < FWN; i++) {
    const gi = fwBase + i; if (fx.l[i] <= 0) { if (gSize[gi] !== 0) gSize[gi] = 0; continue; }
    fx.l[i] -= dt; const k = fx.k[i], drag = k === 2 ? 0.94 : 0.965;
    fx.vx[i] *= Math.pow(drag, dt * 60); fx.vy[i] = fx.vy[i] * Math.pow(drag, dt * 60) - (k === 2 ? 5 : 7) * dt; fx.vz[i] *= Math.pow(drag, dt * 60);
    fx.x[i] += fx.vx[i] * dt; fx.y[i] += fx.vy[i] * dt; fx.z[i] += fx.vz[i] * dt;
    const life = fx.l[i] / fx.m[i]; let s = fx.s[i] * (0.4 + life * 0.8);
    if (k === 3 && life < 0.5) s *= (Math.sin(t * 40 + i) > 0 ? 1.4 : 0.2);
    const o = gi * 3; gPos[o] = fx.x[i]; gPos[o + 1] = fx.y[i]; gPos[o + 2] = fx.z[i];
    const f = Math.min(1, life * 1.6) * 2.2; gCol[o] = fx.r[i] * f; gCol[o + 1] = fx.g[i] * f; gCol[o + 2] = fx.b[i] * f; gSize[gi] = fx.l[i] > 0 ? s : 0;
  }
  flashK = Math.max(0, flashK - dt * 2.2); flash.intensity = flashK * 260; hemi.intensity = 1.25 + flashK * 0.25;
}

/* ───────── lantern parade (guild share) ───────── */
const PARADE = [];
for (let i = 0; i < 10; i++) { const m = mesh(sphG(0.75, 12, 10), emat('#ffc61a', 0.9), 0, -50, 0, scene); m.scale.set(1, 1.25, 1); m.visible = false; const base = mesh(cylG(0.35, 0.3, 0.14, 10), M.gold, 0, -0.75, 0, m); PARADE.push({ m, gi: glow(0, -50, 0, '#ffc61a', 0), on: false }); }
function startParade(list) {
  list.forEach((e, i) => { const p = PARADE[i]; Object.assign(p, { on: true, v: e.v, amt: e.amt, t: -i * 0.32, dur: 4.4 + (e.v.lot.z < 0 ? 1.4 : 0) + rnd() * 0.6, ph: rnd() * 6 }); p.m.visible = true; });
}
function paradePos(p, out) {
  const lot = p.v.lot, u = clamp(p.t / p.dur, 0, 1), e = ease(u);
  lot.g.updateMatrixWorld(true); lot.gold.getWorldPosition(_v3);
  const sx = Math.sin(p.ph) * 2, sy = 12 + (p.ph % 2), sz = ARCH_Z - 2;
  const hz = lerp(sz, _v3.z, e), hx = lerp(sx, _v3.x, Math.pow(u, 2.2)) + Math.sin(p.t * 1.7 + p.ph) * 1.2 * (1 - u), hy = lerp(sy, _v3.y, Math.pow(u, 3)) + Math.sin(p.t * 2.3 + p.ph) * 0.4 * (1 - u) + Math.sin(u * Math.PI) * 2.5;
  out.set(hx, hy, hz); return u;
}
const _pp = new THREE.Vector3();
function updateParade(dt) {
  for (const p of PARADE) {
    if (!p.on) continue; p.t += dt; if (p.t < 0) continue;
    const u = paradePos(p, _pp); p.m.position.copy(_pp); p.m.rotation.y += dt; setGlow(p.gi, _pp.x, _pp.y, _pp.z, '#ffb820', 1.6 + Math.sin(p.t * 8) * 0.25);
    if (rnd() < dt * 20) spark(_pp.x, _pp.y - 0.8, _pp.z, rr(-0.3, 0.3), -1.2, rr(-0.3, 0.3), 0.8, 0.7, '#ffd36a', 0);
    if (u >= 1) { p.on = false; p.m.visible = false; glowSize(p.gi, 0); const v = p.v; if (!LIVE) { v.share += p.amt; ENG.shared += p.amt; } floatAt(_pp.x, _pp.y + 1.2, _pp.z, '+' + fmt(p.amt) + ' $LAMP', 2.6, 'gold'); for (let k = 0; k < 26; k++) spark(_pp.x, _pp.y, _pp.z, rr(-4, 4), rr(-1, 5), rr(-4, 4), rr(0.6, 1.1), 1.0, '#ffd36a', 1); v.lot.goldPulse = 1; syncStats(); renderLB(); }
  }
}

/* ───────── tuk-tuk arrivals ───────── */
const TUK = { g: new THREE.Group(), on: false };
{
  const g = TUK.g, B = new Batch(), body = mat('#2fa36b', { roughness: 0.5 }), dk = mat('#1c1c22'), yel = mat('#ffc61a');
  B.box(1.7, 1.0, 2.6, body, 0, 0.9, 0); B.box(1.75, 0.12, 2.8, yel, 0, 0.42, 0); B.box(1.8, 0.1, 2.9, dk, 0, 2.3, -0.1);
  for (const s of [-1, 1]) B.box(0.08, 0.95, 0.08, dk, s * 0.85, 1.85, 1.2), B.box(0.08, 0.95, 0.08, dk, s * 0.85, 1.85, -1.3);
  B.box(1.5, 0.55, 0.06, mat('#8fd8ff', { roughness: 0.1 }), 0, 1.75, 1.22);
  for (const [x, z] of [[0, 1.2], [-0.8, -0.9], [0.8, -0.9]]) B.add(cylG(0.36, 0.36, 0.22, 12), dk, x, 0.36, z, 0, 0, Math.PI / 2);
  B.box(1.6, 0.5, 0.9, mat('#7a5634'), 0, 1.65, -1.0);
  B.build(g); scene.add(g); g.visible = false;
  TUK.hl = glow(0, -50, 0, '#fff4d0', 0); TUK.tl = glow(0, -50, 0, '#ff3030', 0);
}
function sendTuk(lot, bal) {
  const f = lw(lot, 0, 2.6, { x: 0, z: 0 }), tx = clamp(f.x, -3.6, 3.6);
  Object.assign(TUK, { on: true, lot, bal, phase: 'in', x: tx * 0.4, z: Z_IN + 46, tx, tz: lot.z, yaw: Math.PI, wait: 0 });
  TUK.g.visible = true;
}
function updateTuk(dt, t) {
  if (!TUK.on) return;
  const g = TUK.g;
  if (TUK.phase === 'in') { const dz = TUK.tz - TUK.z, dx = TUK.tx - TUK.x, d = Math.hypot(dx, dz); const sp = Math.min(14, 2 + d * 0.9); if (d < 0.15) { TUK.phase = 'drop'; TUK.wait = 0; } else { const k = Math.min(d, sp * dt) / d; TUK.x += dx * k; TUK.z += dz * k; TUK.yaw = Math.atan2(dx, dz); } }
  else if (TUK.phase === 'drop') {
    TUK.wait += dt;
    if (TUK.live && TUK.wait > 0.4 && !TUK.dropped) { TUK.dropped = true; if (TUK.onDrop) TUK.onDrop(); }
    if (!TUK.live && TUK.wait > 0.4 && !TUK.dropped) { TUK.dropped = true; const v = makeVendor(TUK.bal, TUK.lot, 0, { pop: true }); v.x = TUK.x + 1.2; v.z = TUK.z; standPos(v); routeTo(v, _w.x, _w.z); v.state = 'return'; renderLabel(v); rerank(); floatAt(TUK.lot.x, 3.4, TUK.lot.z, 'New stall · ' + short(v.addr), 2.4, 'up'); feed(`A tuk-tuk dropped ${short(v.addr)} with a push cart. Welcome to the market.`); if (cardFor === null && tour.on) openCard(v); }
    if (TUK.wait > 2.0) { TUK.phase = 'out'; TUK.dropped = false; }
  } else { if (TUK.dir == null) { TUK.dir = TUK.x > 0 ? 1 : -1; TUK.yaw = Math.PI; } TUK.sp = Math.min(13, (TUK.sp || 2) + dt * 4); const ty = Math.PI + TUK.dir * Math.PI; TUK.yaw = TUK.dir > 0 ? Math.min(ty, TUK.yaw + dt * 1.6) : Math.max(ty, TUK.yaw - dt * 1.6); TUK.x = clamp(TUK.x + Math.sin(TUK.yaw) * TUK.sp * dt, -4.5, 4.5); TUK.z += Math.cos(TUK.yaw) * TUK.sp * dt; if (TUK.z > Z_IN + 50) { TUK.on = false; TUK.sp = 0; TUK.dir = null; g.visible = false; glowSize(TUK.hl, 0); glowSize(TUK.tl, 0); return; } }
  g.position.set(TUK.x, groundY(TUK.x, TUK.z) + Math.abs(Math.sin(t * 18)) * 0.03, TUK.z); g.rotation.y = TUK.yaw;
  const sy = Math.sin(TUK.yaw), cy = Math.cos(TUK.yaw);
  setGlow(TUK.hl, TUK.x + sy * 1.4, 1.0, TUK.z + cy * 1.4, '#fff4d0', 3.2); setGlow(TUK.tl, TUK.x - sy * 1.45, 0.9, TUK.z - cy * 1.45, '#ff3030', 1.6);
}

/* ───────── sell: the shutter slams down ───────── */
const SHUTS = [];
function sellOut(v) {
  if (v.sold) return; v.sold = true; v.online = false; v.lot.shutAt = clock.t;
  if (v.state !== 'home' || v.lot.inside) goHomeNow(v);
  v.state = 'closing'; v.path.length = 0; v.p.g.visible = true;
  const lot = v.lot; lot.cook = [];
  const sh = makeShutter(lot); SHUTS.push({ v, lot, sh, t: 0, lit: lot.lights.slice(), clang: false, signed: false, walked: false });
  for (const a of lot.queue || []) leaveQueue(a); lot.queue = [];
  renderLabel(v); rerank(); syncGold(lot);
  toast(`${short(v.addr)} sold. The shutter comes down for good.`);
  feed(`${short(v.addr)} sold their $LAMP. Shutter down, stall closed for good.`);
}
function updateShutters(dt, t) {
  for (const s of SHUTS) {
    if (s.done) continue; s.t += dt;
    const n = s.lit.length, k = Math.min(n, Math.floor((s.t / 1.5) * n));
    for (let i = 0; i < k; i++) { const l = s.lit[i]; if (l.dead) continue; l.dead = true; if (l.sign) { l.o.material = DEAD; } else l.o.material = DEAD; glowSize(l.gi, 0); }
    if (s.t > 1.5 && !s.dark) { s.dark = true; s.lot.body.traverse((o) => { if (o.isMesh && (o.material === M.interior || o.material === M.win || o.material.map && SIGNM[o.material.map.uuid])) o.material = DEAD; }); }
    const u = clamp((s.t - 1.8) / 0.42, 0, 1), drop = u * u;
    const h = s.sh.h; let sc = drop; if (s.t > 2.22) { const b = s.t - 2.22; sc = 1 - Math.abs(Math.sin(b * 18)) * Math.exp(-b * 9) * 0.06; }
    s.sh.panel.scale.y = Math.max(0.001, sc * h);
    if (u >= 1 && !s.clang) { s.clang = true; s.lot.g.updateMatrixWorld(true); _v3.set(0, 0.2, s.lot.sz + 0.4); s.lot.g.localToWorld(_v3); floatAt(_v3.x, 2.6 * s.lot.s, _v3.z, 'CLANG!', 1.4, 'clang'); shake = 0.6; for (let i = 0; i < 12; i++) puff(_v3.x + rr(-1.5, 1.5), 0.2, _v3.z + rr(-0.2, 0.4), 0.5); }
    if (s.t > 2.5) { const sg = s.sh.sign; sg.visible = true; const b = s.t - 2.5; sg.rotation.z = Math.sin(b * 7) * 0.5 * Math.exp(-b * 1.2); if (!s.signed) { s.signed = true; s.lot.g.updateMatrixWorld(true); sg.getWorldPosition(_v3); floatAt(_v3.x, _v3.y + 0.6, _v3.z, 'CLOSED FOR GOOD', 2.2, 'up'); } }
    if (s.t > 3.0 && !s.walked && s.v.p) { s.walked = true; const v = s.v; v.leaving = true; dressPerson(v); const f = frontOf(v.lot, 2.0); v.path = [{ x: f.x, z: f.z }, { x: rr(-1.5, 1.5), z: v.lot.z + 2 }, { x: rr(-2, 2), z: Z_IN + 30 }]; v.state = 'leave'; }
    if (s.t > 3.0 && s.v.p) { const v = s.v; if (s.t < 4.2) { v.p.armR.rotation.x = -2.6; v.p.armR.rotation.z = Math.sin(t * 9) * 0.5; } }
    if (s.t > 6) s.done = true;
  }
}

/* ───────── engine round ───────── */
const ENG = { burned: 0, shared: 0, fund: 0, rounds: 0, busy: false, auto: 25, timer: 25 };
const seq = [];
function after(sec, fn) { seq.push({ t: sec, fn }); }
function runRound(withCam = true) {
  if (ENG.busy) return; ENG.busy = true; ENG.rounds++; $('#bRound').disabled = true; ENG.timer = ENG.auto;
  const burnAmt = 0.006 * LAMP_PER_ETH * rr(0.9, 1.1), shareAmt = 0.007 * LAMP_PER_ETH * rr(0.9, 1.1);
  toast('Engine round: 0.02 ETH of fees at work');
  feed(`Engine round #${ENG.rounds}: 30% burn, 35% to the guild, 35% to the street.`);
  // 1 · buyback and burn: fireworks
  if (withCam) camTo({ x: 0, z: -22, y: 21, d: 88, p: -0.06, yaw: 0 });
  after(0.3, () => { for (let i = 0; i < 18; i++) launch(rr(-16, 16), rr(-75, 30), i * 0.26); });
  after(2.0, () => { ENG.burned += burnAmt; floatAt(0, 30, -10, '-' + fmt(burnAmt) + ' $LAMP burned', 3.2, 'burn'); syncStats(); });
  // 2 · lantern parade to the top 10
  after(5.0, () => {
    const g = V.filter((v) => !v.sold && v.rank && v.rank <= 10), ok = g.filter((v) => v.held >= LEVEL_SEC), tot = ok.reduce((s, v) => s + v.bal, 0);
    const list = ok.map((v) => ({ v, amt: (shareAmt * v.bal) / tot }));
    for (const v of g) if (!ok.includes(v)) floatAt(v.lot.x, v.lot.top * v.lot.s + 2.5, v.lot.z, 'not 10 min yet', 2.2, 'lv');
    startParade(list); feed(`${list.length} golden lanterns float down to the Golden Lantern Guild.`);
    if (withCam) followParade = 6.8;
  });
  // 3 · treasury: the street grows
  after(12.4, () => {
    ENG.fund += 0.007;
    if (upLevel < UPG.length) {
      const u = UPG[upLevel], k = upLevel; upLevel++; revealUpgrade(k);
      toast('The street grows: ' + u.name);
      feed(`Street fund hit ${u.eth} ETH: ${u.name.toLowerCase()}.`);
      if (withCam) camTo({ x: u.at.x, z: u.at.z, y: 2, d: u.at.d, p: u.at.p, yaw: u.at.yaw || 0 }, 0.7);
      const a = u.at; for (let i = 0; i < 40; i++) spark(a.x + rr(-6, 6), rr(4, 12), a.z + rr(-6, 6), rr(-3, 3), rr(0, 6), rr(-3, 3), rr(0.8, 1.6), 1.2, pick(['#ffd36a', '#fff1c0', '#ff9a3a']), 1);
    } else { toast('Every street upgrade is built. The fund keeps growing for the next one.'); feed('Street fund: all five upgrades are up.'); }
    syncStats();
  });
  after(16.5, () => { ENG.busy = false; $('#bRound').disabled = false; });
}

/* ───────── buy / sell events ───────── */
function buyEvent(near) {
  if (TUK.on) return false;
  const free = LOTS.filter((l) => !l.owner);
  if (!free.length) { toast('Every spot on the street is taken in this preview'); return false; }
  const lot = near ? free.sort((a, b) => b.z - a.z)[0] : free.sort((a, b) => Math.abs(a.z - camState.tz) - Math.abs(b.z - camState.tz))[0];
  sendTuk(lot, Math.round(rr(1.1e5, 2.4e6))); toast('Someone bought $LAMP: a tuk-tuk is on its way'); return lot;
}
function sellEvent(prefer) {
  const c = V.filter((v) => !v.sold && v.rank !== 1 && !(v.rank && v.rank <= 3) && v.state !== 'walk' && !TUK.dropped);
  if (!c.length) return null;
  let v = prefer || c.sort((a, b) => Math.abs(a.lot.z - camState.tz) - Math.abs(b.lot.z - camState.tz))[(rnd() * Math.min(5, c.length)) | 0];
  sellOut(v); return v;
}

/* ───────── HUD ───────── */
function syncStats() {
  if (LIVE) return liveStats();
  const open = V.filter((v) => !v.sold).length, shut = V.filter((v) => v.sold).length;
  $('#sOpen').textContent = open; $('#sShut').textContent = shut;
  $('#sBurn').textContent = ((ENG.burned / SUPPLY) * 100).toFixed(2) + '%';
  $('#sShare').textContent = fmt(ENG.shared);
  $('#uCount').textContent = upLevel + ' / 5';
  [...$('#uBar').children].forEach((e, i) => e.classList.toggle('on', i < upLevel));
  const nx = UPG[upLevel];
  $('#uNext').innerHTML = nx ? `Next: <b>${nx.name}</b> <span>at ${nx.eth} ETH in the street fund · demo: one round = one milestone</span>` : '<b>All five upgrades built.</b> <span>The street fund keeps growing.</span>';
}
function renderLB() {
  if (LIVE) return liveLB();
  const top = V.filter((v) => !v.sold && v.rank).sort((a, b) => a.rank - b.rank);
  $('#lbList').innerHTML = top.map((v) => `<li data-a="${v.addr}"><span class="b" style="background:${BAND[v.rank - 1]}">${v.rank}</span><span class="n">${short(v.addr)}<small>${v.rank === 1 ? 'Market Boss' : 'Lv ' + v.level}${v.held < LEVEL_SEC ? ' · new' : ''}</small></span><span class="v">${fmt(v.bal)}<small>+${fmt(v.share)} shared</small></span></li>`).join('');
}
$('#lbList').addEventListener('click', (e) => { const li = e.target.closest('li'); if (!li) return; if (LIVE) return liveLBClick(li.dataset.a); const v = V.find((x) => x.addr === li.dataset.a); if (v) { openCard(v); camTo({ x: v.lot.x * 0.5, z: v.lot.z, y: 2, d: v.rank === 1 ? 40 : 22, p: 0.42, yaw: v.lot.side ? -v.lot.side * 0.7 : 0 }); } });
const feedEl = $('#feed');
function feed(s) { const li = document.createElement('li'); li.className = 'panel'; li.textContent = s; feedEl.prepend(li); while (feedEl.children.length > 4) feedEl.lastChild.remove(); }
let toastT = 0; function toast(s) { const t = $('#toast'); t.textContent = s; t.classList.add('in'); toastT = 3.2; }
let cardFor = null;
function openCard(v) {
  if (LIVE) return liveCard(v);
  cardFor = v; const lot = v.lot;
  $('#cardH').innerHTML = (v.rank && !v.sold ? `<span class="b" style="display:inline-grid;place-items:center;width:20px;height:20px;border-radius:6px;font-size:11px;color:#1a1230;background:${BAND[v.rank - 1]}">${v.rank}</span>` : '') + short(v.addr);
  const rows = [['Address', `<span class="mono">${v.addr.slice(0, 10)}…${v.addr.slice(-8)}</span>`], ['Balance', v.sold ? '0 $LAMP (sold)' : fmt(v.bal) + ' $LAMP'],
    ['Stall', v.sold ? 'Closed for good' : `Lv ${v.level} · ${LEVELS[v.level - 1]}`], ['Time held', v.sold ? '—' : heldTxt(v.held) + (v.level < 8 ? ` · next level in ${Math.ceil((LEVEL_SEC - (v.held % LEVEL_SEC)) / LEVEL_SEC * 10)} min` : '')],
    ['Status', v.sold ? 'Walked off with a backpack' : v.online ? '<span style="color:#3ee07a">online · out walking</span>' : 'offline · ' + (lot.inside ? 'inside the shop' : 'behind the counter')]];
  if (v.share) rows.push(['From the guild', '+' + fmt(v.share) + ' $LAMP']);
  $('#cardB').innerHTML = rows.map(([a, b]) => `<div class="row"><span>${a}</span><b>${b}</b></div>`).join('') +
    `<div class="tagz">${v.rank === 1 && !v.sold ? '<i>Market Boss</i>' : ''}${v.rank && !v.sold ? '<i>Golden Lantern Guild</i>' : ''}${v.held >= LEVEL_SEC && !v.sold ? '<i>held 10 min+</i>' : ''}<i>sample wallet</i></div>`;
  $('#card').classList.add('in');
}
$('#cardX').onclick = () => { $('#card').classList.remove('in'); cardFor = null; };
$('#mv').innerHTML = '<span>' + 'Hold 100K $LAMP and you get a stall. It grows every 10 minutes you hold. Every 0.02 ETH of fees: 30% buys $LAMP back and burns it (fireworks), 35% buys $LAMP for the Golden Lantern Guild (the top 10), 35% builds the street. Sell once and your shutter comes down for good.' + '</span>';
$('#mv').innerHTML += $('#mv').innerHTML;
$('#tlTog').onclick = () => { $('#tl').classList.toggle('min'); $('#tlTog').textContent = $('#tl').classList.contains('min') ? '+' : '–'; };
$('#lbTog').onclick = () => { $('#lb').classList.toggle('min'); $('#lbTog').textContent = $('#lb').classList.contains('min') ? '+' : '–'; };
if (innerWidth <= 720) { $('#lb').classList.add('min'); $('#lbTog').textContent = '+'; }

/* ───────── camera ───────── */
const camState = { tx: 0, ty: 3, tz: 18, yaw: 0, pitch: 0.24, dist: 92 };
const camGoal = { ...camState }; let camFly = 0, camK = 1.4, shake = 0;
const HOME = () => (innerWidth < innerHeight ? { x: 0, z: 8, y: 5, d: 104, p: 0.15, yaw: 0 } : { x: 0, z: 12, y: 0, d: 106, p: 0.2, yaw: 0 });
function camTo(o, k = 1.2) { Object.assign(camGoal, { tx: o.x, ty: o.y ?? 3, tz: o.z, dist: o.d, pitch: o.p, yaw: o.yaw ?? camState.yaw }); if (innerWidth < innerHeight) camGoal.dist *= 1.35; camFly = 1; camK = k; }
function applyCam(dt) {
  if (camFly) { const a = 1 - Math.exp(-dt * camK * 1.6); for (const k of ['tx', 'ty', 'tz', 'pitch', 'dist']) camState[k] += (camGoal[k] - camState[k]) * a; let dy = camGoal.yaw - camState.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); camState.yaw += dy * a; }
  const c = camState, h = Math.cos(c.pitch) * c.dist;
  camera.position.set(c.tx + Math.sin(c.yaw) * h, c.ty + Math.sin(c.pitch) * c.dist, c.tz + Math.cos(c.yaw) * h);
  if (camera.position.y < 1.2) camera.position.y = 1.2;
  if (camera.position.y < 24 && camera.position.z < Z_IN + 8 && Math.abs(camera.position.x) > 13.5) camera.position.x = Math.sign(camera.position.x) * 13.5;
  camera.lookAt(c.tx, c.ty, c.tz);
  if (shake > 0) { shake = Math.max(0, shake - dt * 1.6); camera.position.x += Math.sin(clock.t * 70) * shake * 0.25; camera.position.y += Math.cos(clock.t * 63) * shake * 0.2; }
}
const clampCam = () => { const c = camState; c.tx = clamp(c.tx, -24, 24); c.tz = clamp(c.tz, -135, 110); c.dist = clamp(c.dist, 8, 190); c.pitch = clamp(c.pitch, 0.04, 1.45); };
function resize() { renderer.setSize(innerWidth, innerHeight, false); composer.setSize(innerWidth, innerHeight); bloom.resolution.set(innerWidth / 2, innerHeight / 2); camera.aspect = innerWidth / innerHeight; camera.fov = innerWidth < innerHeight ? 58 : 40; camera.updateProjectionMatrix(); GU.uScale.value = (innerHeight * PR * 0.5) / Math.tan((camera.fov * Math.PI) / 360); }
addEventListener('resize', resize);
cv.addEventListener('wheel', (e) => { e.preventDefault(); camFly = 0; camState.dist *= e.deltaY > 0 ? 1.1 : 0.9; clampCam(); userT = 0; }, { passive: false });
cv.addEventListener('contextmenu', (e) => e.preventDefault());
const ptrs = new Map(); let drag = null, pinch = null, userT = 99;
cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); userT = 0;
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: camState.dist, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, tx: camState.tx, tz: camState.tz }; drag = null; }
  else drag = { x: e.clientX, y: e.clientY, yaw: camState.yaw, pitch: camState.pitch, tx: camState.tx, tz: camState.tz, pan: e.button === 2 || e.shiftKey, moved: 0 }; });
function panBy(dx, dy, base) { const k = camState.dist * Math.tan((camera.fov * Math.PI) / 360) * 2 / innerHeight, s = Math.sin(camState.yaw), c = Math.cos(camState.yaw), f = 1 / Math.max(0.35, Math.sin(camState.pitch) + 0.3);
  camState.tx = base.tx - (dx * c + dy * s * f) * k; camState.tz = base.tz - (-dx * s + dy * c * f) * k; clampCam(); }
cv.addEventListener('pointermove', (e) => {
  if (!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && ptrs.size === 2) { const [a, b] = [...ptrs.values()]; camFly = 0; camState.dist = pinch.dist * pinch.d / Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)); panBy((a.x + b.x) / 2 - pinch.mx, (a.y + b.y) / 2 - pinch.my, pinch); return; }
  if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.moved = Math.max(drag.moved, Math.abs(dx) + Math.abs(dy)); if (drag.moved < 5) return;
  cv.classList.add('drag'); camFly = 0;
  if (drag.pan) { panBy(dx, dy, drag); LS.follow = false; } else { camState.yaw = drag.yaw - dx * 0.006; camState.pitch = clamp(drag.pitch + dy * 0.004, 0.04, 1.45); }
});
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function pick2(sx, sy) {
  let best = null, bd = 30;
  for (const v of V) { if (v.gone || !v.p.g.visible) continue; _pv.set(v.x, v.p.g.position.y + 1.1, v.z).project(camera); if (_pv.z > 1) continue; const d = Math.hypot((_pv.x * 0.5 + 0.5) * innerWidth - sx, (-_pv.y * 0.5 + 0.5) * innerHeight - sy); if (d < bd) { bd = d; best = v; } }
  if (best) return best;
  ndc.set((sx / innerWidth) * 2 - 1, -(sy / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera);
  const h = ray.intersectObjects(HIT, false)[0]; return h && h.object.userData.lot.owner ? h.object.userData.lot.owner : null;
}
const endPtr = (e) => { ptrs.delete(e.pointerId); cv.classList.remove('drag'); if (ptrs.size < 2) pinch = null;
  if (LIVE && drag && drag.moved < 6 && e.type === 'pointerup') { liveClick(e.clientX, e.clientY); drag = null; return; }
  if (drag && drag.moved < 6 && e.type === 'pointerup') { const v = pick2(e.clientX, e.clientY); if (v) openCard(v); else { $('#card').classList.remove('in'); cardFor = null; } }
  drag = null; };
cv.addEventListener('pointerup', endPtr); cv.addEventListener('pointercancel', endPtr);
addEventListener('keydown', (e) => { if (LIVE && liveKey(e)) return; const s = 3; if (e.key === 'w' || e.key === 'ArrowUp') { camState.tz -= s; camFly = 0; } if (e.key === 's' || e.key === 'ArrowDown') { camState.tz += s; camFly = 0; } if (e.key === 'a' || e.key === 'ArrowLeft') camState.yaw += 0.08; if (e.key === 'd' || e.key === 'ArrowRight') camState.yaw -= 0.08; clampCam(); });

/* ───────── buttons + tour ───────── */
$('#bRound').onclick = () => { stopTour(); runRound(true); };
$('#bSell').onclick = () => { stopTour(); const v = sellEvent(); if (v) camTo(shutCam(v.lot)); };
$('#bBuy').onclick = () => { stopTour(); const l = buyEvent(); if (l) { camTo({ x: 0, z: l.z + 14, y: 2, d: 30, p: 0.38, yaw: 0 }); followTuk = 4; } };
const SPEEDS = [1, 4, 12];
$('#bSpeed').onclick = () => { const i = (SPEEDS.indexOf(SPEED.k) + 1) % SPEEDS.length; SPEED.k = SPEEDS[i]; SPEED.walk = 1 + (SPEED.k - 1) * 0.06; $('#speedT').textContent = SPEED.k === 1 ? 'Speed up time' : 'Time x' + SPEED.k; $('#bSpeed').classList.toggle('on', SPEED.k > 1); };
let followTuk = 0, followParade = 0;
function shutCam(lot) { return lot.boss ? { x: 0, z: lot.z + 6, y: 3, d: 30, p: 0.3, yaw: 0 } : { x: lot.x - lot.side * 1.6, z: lot.z, y: 1.9, d: 13.5, p: 0.34, yaw: -lot.side * 1.2 }; }
const tour = { on: false, t: 0, steps: [] };
function cap(s, b, t) { $('#capS').textContent = s; $('#capB').textContent = b; $('#capT').textContent = t; $('#cap').classList.add('in'); }
function stopTour() { if (!tour.on) return; tour.on = false; $('#cap').classList.remove('in'); $('#tourT').textContent = 'Tour'; $('#bTour').classList.remove('on'); }
function startTour() {
  tour.on = true; tour.t = 0; tour.i = 0; $('#tourT').textContent = 'Stop tour'; $('#bTour').classList.add('on'); $('#card').classList.remove('in'); cardFor = null;
  let lot = null, grow = null;
  tour.steps = [
    [0, () => { cap('1 · ARRIVAL', 'Someone buys 100K $LAMP or more', 'A tuk-tuk drops a new vendor with a push cart at a free spot.'); lot = buyEvent(true); if (lot) { camTo({ x: 0, z: lot.z + 16, y: 2, d: 30, p: 0.36, yaw: 0 }, 1.0); followTuk = 6; } }],
    [8, () => { grow = lot && lot.owner; if (!grow) grow = V.filter((v) => !v.sold && v.level < 4)[0]; cap('2 · HOLD', 'The stall grows every 10 minutes held', 'Sped up here: cart, umbrella, awning, stools, neon, shop, two storeys, Grand Restaurant.'); if (grow) camTo(shutCam(grow.lot), 1.2); }],
    [9.5, () => { if (grow) grow.held = Math.max(grow.held, LEVEL_SEC * 1 + 0.01); }],
    [11.5, () => { if (grow) grow.held = Math.max(grow.held, LEVEL_SEC * 2 + 0.01); }],
    [13.5, () => { if (grow) grow.held = Math.max(grow.held, LEVEL_SEC * 4 + 0.01); }],
    [15.5, () => { if (grow) { grow.held = Math.max(grow.held, LEVEL_SEC * 5 + 0.01); camTo({ ...shutCam(grow.lot), d: 19, y: 3, p: 0.3 }, 1.0); } }],
    [18, () => { cap('3 · ENGINE ROUND', 'Every 0.02 ETH of fees', '30% buyback and burn: fireworks over the market.'); runRound(true); }],
    [23, () => cap('3 · ENGINE ROUND', 'Golden lanterns for the guild', '35% buys $LAMP for the top 10, split by balance. Held 10 min+ only.')],
    [30.4, () => cap('3 · ENGINE ROUND', 'The street grows', '35% goes to the street fund. Each milestone builds something new.')],
    [36, () => { cap('4 · SELL ONCE', 'The shutter slams down', 'Lights out, shutter down, CLOSED FOR GOOD. The owner walks off. It never reopens.'); const c = V.filter((v) => !v.sold && v.rank !== 1 && v.level >= 4 && v.level <= 6 && v.state === 'home'); const v = c.sort((a, b) => Math.abs(a.lot.z - 20) - Math.abs(b.lot.z - 20))[0]; if (v) { camTo(shutCam(v.lot), 1.4); after(1.4, () => sellOut(v)); } }],
    [45, () => { cap('NIGHT MARKET', 'Hold and your stall keeps growing', 'Drag to look around. Click any stall or vendor.'); camTo(HOME(), 0.8); }],
    [50, () => stopTour()],
  ];
}
$('#bTour').onclick = () => (tour.on ? stopTour() : startTour());
function updateTour(dt) { if (!tour.on) return; tour.t += dt; while (tour.i < tour.steps.length && tour.t >= tour.steps[tour.i][0]) tour.steps[tour.i++][1](); }

/* ───────── per-frame upgrade animation ───────── */
const HUE = new THREE.Color();
function updateUpgrades(dt, t) {
  for (const a of UANIM) {
    a.t += dt; const g = UG[a.k], u = clamp(a.t / 1.4, 0, 1), s = a.t >= 99 ? 1 : backOut(u);
    if (a.k === 0) { for (const st of STR) glowSize(st.gi, a.t * 0.55 > st.d ? 1.25 + Math.sin(t * 3 + st.x) * 0.15 : 0); g.scale.set(1, 1, 1); }
    else if (a.k === 2) g.scale.set(Math.max(0.001, s), 1, 1);
    else g.scale.setScalar(Math.max(0.001, s));
  }
  if (UG[1].visible) { BANDP.forEach((p, i) => animPerson(p, t, false, i * 1.7, 'play')); SPOTS.forEach((c, i) => { c.rotation.z = Math.sin(t * 0.9 + i * 2) * 0.35; c.rotation.x = Math.cos(t * 0.7 + i) * 0.25; HUE.setHSL((t * 0.08 + i * 0.3) % 1, 0.8, 0.6); c.material.color.copy(HUE); }); }
  if (UG[2].visible) { for (const k of KOI) { k.k.position.x += k.sp * dt; if (k.k.position.x > 15) k.k.position.x = -15; if (k.k.position.x < -15) k.k.position.x = 15; k.k.position.z = k.z0 + Math.sin(t * 1.3 + k.ph) * 0.3; k.k.rotation.y = k.sp > 0 ? 0 : Math.PI; k.k.rotation.y += Math.sin(t * 6 + k.ph) * 0.2; } for (const l of UG[2].userData.lan) glowSize(l.gi, 2.6 * Math.min(1, UG[2].scale.x)); }
  if (UG[3].visible) {
    FW.rot += dt * 0.12; FW.wheel.rotation.z = FW.rot; const sc = UG[3].scale.x, cy = WHEEL.y * sc;
    FW.rim.forEach((r, i) => { const a = r.a + FW.rot; HUE.setHSL((i / 64 + t * 0.15) % 1, 0.9, 0.62); setGlow(r.gi, Math.cos(a) * WHEEL.r * sc, cy + Math.sin(a) * WHEEL.r * sc, WHEEL.z + 1.1, HUE, 2.0 * sc); });
    FW.cabs.forEach((c) => { const a = c.a + FW.rot; c.c.position.set(Math.cos(a) * WHEEL.r, WHEEL.y + Math.sin(a) * WHEEL.r, 0); c.c.rotation.z = Math.sin(t + c.a) * 0.05; setGlow(c.gi, Math.cos(a) * WHEEL.r * sc, cy + (Math.sin(a) * WHEEL.r - 0.9) * sc, WHEEL.z + 0.8, '#ffd27a', 2.4 * sc); });
  }
  if (UG[4].visible) {
    const n = DRAGON.segs.length, sc = UG[4].scale.x;
    for (let i = 0; i < n; i++) { const u = i / (n - 1), x = lerp(9.5, -9.5, u) + Math.sin(t * 0.8) * 0.6, y = 11.6 + Math.sin(t * 2.2 - u * 9) * 0.9, z = Math.cos(t * 1.6 - u * 7) * 0.9; const s = DRAGON.segs[i]; s.m.position.set(x, y, z); setGlow(s.gi, x * sc, y * sc, ARCH_Z + z * sc, i % 2 ? '#ff5a2a' : '#ffb02a', 0.9 * sc); }
    const h = DRAGON.head, x0 = 9.5 + Math.sin(t * 0.8) * 0.6 + 0.9; h.position.set(x0, 11.6 + Math.sin(t * 2.2 + 0.8) * 0.9, Math.cos(t * 1.6 + 0.7) * 0.9); h.rotation.y = Math.PI / 2 + Math.sin(t * 1.2) * 0.25; h.rotation.x = Math.sin(t * 2.2) * 0.15;
  }
}

/* ───────── seed the market ───────── */
const clock = { t: 0 };
if (!LIVE) {
  const lots = LOTS.filter((l) => !l.boss); const order = lots.map((l) => l).sort(() => rnd() - 0.5);
  const boss = LOTS.find((l) => l.boss); makeVendor(4.8e7, boss, LEVEL_SEC * 7.9);
  const n = Q.get('n') ? +Q.get('n') : 38;
  for (let i = 0; i < Math.min(n, order.length); i++) { const bal = Math.round(1e5 * Math.pow(10, rnd() * rnd() * 2.4) + rnd() * 2e5); const held = rnd() < 0.15 ? rr(0, 9) : rr(0, 85); makeVendor(bal, order[i], held); }
  // the next nine biggest wallets get a head start so the guild looks the part
  rerank();
  for (const v of V) if (v.rank && v.rank > 1 && v.held < 45) { v.held += 30; v.level = lvlOf(v.held); buildStall(v.lot); goHomeNow(v); syncQueue(v.lot); }
  for (const v of V) renderLabel(v);
  const online = V.filter((v) => v.rank !== 1).sort(() => rnd() - 0.5).slice(0, 6); for (const v of online) setOnline(v, true);
  const pre = +(Q.get('up') || 0); for (let k = 0; k < pre; k++) { revealUpgrade(k, true); upLevel++; }
}
// strollers and customers: decorative extras, not holders (no labels)
for (let i = 0; i < 46; i++) { const a = freeAgent(); if (!a) break; const p = streetPoint(rr(Z_END, Z_IN)); spawnAgent(a, p.x, p.z); a.st = 3; a.tx = p.x; a.tz = p.z; a.wait = rr(0, 4); }
if (!LIVE) { syncStats(); renderLB(); }

/* ───────── main loop ───────── */
let last = performance.now(), fpsAcc = 0, fpsN = 0, fpsChecked = false, onlineT = 12;
resize(); Object.assign(camState, (() => { const h = HOME(); return { tx: h.x, ty: h.y, tz: h.z, dist: h.d * (innerWidth < innerHeight ? 1 : 1), pitch: h.p, yaw: h.yaw }; })());
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now; clock.t += dt; const t = clock.t; GU.uTime.value = t;
  for (let i = seq.length - 1; i >= 0; i--) { seq[i].t -= dt; if (seq[i].t <= 0) { const f = seq[i].fn; seq.splice(i, 1); f(); } }
  updateTour(dt);
  if (!LIVE && !ENG.busy && !tour.on) { ENG.timer -= dt * Math.min(SPEED.k, 3); if (ENG.timer <= 0) runRound(userT > 20 ? false : false); }
  onlineT -= dt; if (!LIVE && onlineT <= 0) { onlineT = rr(8, 14); const on = V.filter((v) => v.online && !v.sold), off = V.filter((v) => !v.online && !v.sold && v.rank !== 1 && v.state === 'home'); if (on.length > 4 && rnd() < 0.6) setOnline(pick(on), false); if (off.length && on.length < 8) setOnline(pick(off), true); }
  for (const v of V) updateVendor(v, dt, t);
  for (const lot of LOTS) {
    if (lot.pop != null) { lot.pop += dt; const u = clamp(lot.pop / 0.6, 0, 1), s = 0.3 + 0.7 * backOut(u); lot.g.scale.setScalar(lot.s * s); if (u >= 1) { lot.pop = null; lot.g.scale.setScalar(lot.s); } }
    if (lot.goldPulse) { lot.goldPulse = Math.max(0, lot.goldPulse - dt * 0.8); if (lot.gold) lot.gold.scale.setScalar(1 + lot.goldPulse * 0.6); if (lot.goldGi >= 0 && lot.gold && lot.gold.visible) glowSize(lot.goldGi, (3.4 + lot.goldPulse * 9) * lot.s); }
    if (lot.gold && lot.gold.visible) lot.gold.rotation.y = Math.sin(t * 0.8 + lot.z) * 0.3;
  }
  if (LIVE) liveFrame(dt, t);
  updateShutters(dt, t); updateTuk(dt, t); updateCrowd(dt, t); updateFireworks(dt); updateParade(dt); updateUpgrades(dt, t); updateFloats(dt);
  if (followParade > 0) { followParade -= dt; let n = 0, sx = 0, sz = 0, sy = 0; for (const p of PARADE) if (p.on && p.t > 0) { sx += p.m.position.x; sy += p.m.position.y; sz += p.m.position.z; n++; } if (n) { camGoal.tx = sx / n * 0.5; camGoal.ty = Math.max(3, sy / n - 3); camGoal.tz = sz / n - 4; camGoal.dist = 36; camGoal.pitch = 0.3; camGoal.yaw = 0; camFly = 1; camK = 1.4; } }
  if (followTuk > 0 && TUK.on) { followTuk -= dt; camGoal.tz = TUK.z + 14; camGoal.tx = TUK.x * 0.5; camFly = 1; }
  for (const c of CLOUDS) { c.position.x += dt * 3; if (c.position.x > 800) c.position.x = -800; }
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('#toast').classList.remove('in'); }
  if (cardFor && ((t * 2) | 0) !== cardFor._ct) { cardFor._ct = (t * 2) | 0; openCard(cardFor); }
  userT += dt;
  if (LIVE) liveCam(dt);
  applyCam(dt); ripU.uSquash.value = clamp(Math.sin(camState.pitch) + 0.15, 0.2, 1);
  updateWeather(dt, camState.tx, camState.tz);
  flushGlow();
  if (useBloom) composer.render(); else renderer.render(scene, camera);
  if (!fpsChecked && t > 1.5) { fpsAcc += dt; fpsN++; if (fpsN > 90) { fpsChecked = true; const fps = fpsN / fpsAcc; if (fps < 32) { PR = Math.min(PR, 1); renderer.setPixelRatio(PR); resize(); } if (fps < 24) useBloom = false; window.__fps = fps; } }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
setTimeout(() => { const l = $('#loading'); l.style.opacity = 0; setTimeout(() => l.remove(), 700); }, 250);
window.NM = { scene, glowPts, mirrorPts, renderer, bloom, hemi, PL, V, LOTS, runRound, sellEvent, buyEvent, camTo, camState, revealUpgrade, UPG, get upLevel() { return upLevel; }, set upLevel(x) { upLevel = x; }, syncStats, startTour, burst, launch, PARADE, SPEED, HOME, sellOut, ENG };

/* ═════════════════════════ LIVE EDITION ═════════════════════════
   One shared market for every screen. The engine (/api/town via createTown) says who holds, their rank,
   time held, rounds and sells; the live server (createLive) owns where every vendor stands. Offline
   vendors are walked by the server between the stalls; your own vendor is driven here and sent back. */
const X_URL = 'https://x.com/'; // placeholder: the Night Market X account goes here
const PLOTS = LOTS.filter((l) => !l.boss); // plot k on every screen = PLOTS[k] = world.json plots[k]
const BOSS_LOT = LOTS.find((l) => l.boss);
const SPAWN = { x: 0, z: 82 }, PODIUM = { x: -7.8, z: 32 }, CROWD = { x: -1, z: 32, w: 6, d: 12 };
const doorOf = (lot) => (lot.boss ? lw(lot, -1.4, 1.6, { x: 0, z: 0 }) : lw(lot, -1.4, 1.1, { x: 0, z: 0 }));
const BOUNDS = { x0: -16, x1: 16, z0: -100, z1: 100 };
/** Where a vendor can stand: the street, the plaza in front of the boss stall, the stage apron, the bridge. */
function walkable(x, z) {
  if (x > -6.2 && x < 6.2 && z > -96 && z < 92) return !(canalOn && Math.abs(z - CANAL_Z) < 2.6 && Math.abs(x) > 3.3);
  if (z > -96 && z < -84.2 && x > -14.5 && x < 14.5) return true;
  if (x > -9.2 && x <= -6.2 && z > 22.5 && z < 41.5) return true;
  return false;
}
// the path graph the server's bots walk (exported to bot/world.json with a Playwright script)
window.__world = () => {
  const r2 = (v) => Math.round(v * 100) / 100, nodes = [], edges = [], seen = new Map();
  const add = (x, z) => { const k = r2(x) + ',' + r2(z); if (seen.has(k)) return seen.get(k); nodes.push([r2(x), r2(z)]); seen.set(k, nodes.length - 1); return nodes.length - 1; };
  const link = (a, b) => { if (a >= 0 && b >= 0 && a !== b) edges.push([a, b]); };
  const LANES = [-4.4, 0, 4.4], ZS = []; for (let z = 86; z >= -88; z -= 6) ZS.push(z);
  const nearCanal = (x, z) => Math.abs(x) > 3 && Math.abs(z - CANAL_Z) < 5; // only the bridge crosses the canal
  const grid = LANES.map((x) => ZS.map((z) => (nearCanal(x, z) ? -1 : add(x, z))));
  for (let i = 0; i < LANES.length; i++) for (let j = 0; j < ZS.length; j++) {
    const a = grid[i][j]; if (a < 0) continue;
    if (j + 1 < ZS.length && grid[i][j + 1] >= 0) link(a, grid[i][j + 1]);
    if (i + 1 < LANES.length && grid[i + 1][j] >= 0) link(a, grid[i + 1][j]);
  }
  for (const i of [0, 2]) for (let j = 0; j + 1 < ZS.length; j++) { // side lanes step onto the bridge
    if (grid[i][j] >= 0 && grid[i][j + 1] < 0) link(grid[i][j], grid[1][j + 1]);
    if (grid[i][j] < 0 && grid[i][j + 1] >= 0) link(grid[i][j + 1], grid[1][j]);
  }
  const plaza = [-12, -8, -4.4, 0, 4.4, 8, 12].map((x) => add(x, -91));
  for (let i = 0; i + 1 < plaza.length; i++) link(plaza[i], plaza[i + 1]);
  for (let i = 0; i < LANES.length; i++) link(grid[i][ZS.length - 1], add(LANES[i], -91));
  const bd = doorOf(BOSS_LOT), bn = add(bd.x, bd.z); link(bn, add(0, -91)); link(bn, add(-4.4, -91));
  const apron = [26, 32, 38].map((z) => add(PODIUM.x, z));
  for (let i = 0; i < apron.length; i++) { if (i) link(apron[i - 1], apron[i]); link(apron[i], add(-4.4, [26, 32, 38][i])); }
  const sp = add(SPAWN.x, SPAWN.z); link(sp, add(0, 80)); link(sp, add(0, 86)); link(sp, add(-4.4, 80)); link(sp, add(4.4, 80));
  const plots = PLOTS.map((lot) => {
    const d = doorOf(lot), lane = lot.side < 0 ? 0 : 2; let best = -1, bz = 1e9;
    for (let j = 0; j < ZS.length; j++) if (grid[lane][j] >= 0 && Math.abs(ZS[j] - d.z) < bz) { bz = Math.abs(ZS[j] - d.z); best = grid[lane][j]; }
    link(add(d.x, d.z), best); return [r2(d.x), r2(d.z)];
  });
  return { nodes, edges, plots, ranks: { 1: [r2(bd.x), r2(bd.z)] }, spawn: [SPAWN.x, SPAWN.z], podium: [PODIUM.x, PODIUM.z], crowd: { ...CROWD }, bounds: { ...BOUNDS } };
};

const LS2 = { st: null, townN: 0, round: -1, roundQ: [], keeper: 0, gotSlots: false, lvlT: 0, pendChat: '', pendSpeech: false, emoCd: 0, closedEmpty: false };
let SLOTS = {};
const CIT = new Map(); // addr -> the engine's holder: balance, rank, first buy, and its stall
const FIGS = new Map(); // live entity id -> a vendor on screen
const LEAVING = []; // sellers waving goodbye for a moment after the server dropped them
let ME = null; // your own vendor, driven by this screen
const nowSec = () => (live ? live.now() : Date.now() / 1000);
const hashA = (a) => { let h = 2166136261; for (const ch of a) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
// the same wallet looks the same on every screen: colours, hat and stall sign come from its address
const LOOKS = new Map();
function lookOf(a) {
  if (LOOKS.has(a)) return LOOKS.get(a);
  let s = hashA(a) || 1; const r = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const p = (arr) => arr[(r() * arr.length) | 0];
  const L = { theme: p(THEMES), theme2: p(['#2a2238', '#3a2a24', '#24323a', '#3a2432', '#2e3a26']), word: p(NEON_WORDS), neon: p(NEON_COLS), hatK: p(['straw', 'straw', 'band', 'cap']), hatC: p(['#d8b878', '#c9a060', '#e8434f', '#2f7cf6', '#f2f6f7', '#3a3a44']), apronC: p(['#e9e1d2', '#d9d0c0', '#bfc8d0', '#e0c8a8']), skin: p(SKINS), shirt: p(SHIRTS), ph: r() * 9 };
  LOOKS.set(a, L); return L;
}
const holder = (a) => { const v = CIT.get(a); return v && !v.sold ? v : null; };
function newRec(a, c) { return { addr: a, bal: parseFloat(c.balance) || 0, rank: c.rank || 0, firstIn: c.firstIn || 0, received: parseFloat(c.received) || 0, level: levelOf(c.firstIn || 0, nowSec()), lot: null, sold: false, lastRank: -1, ...lookOf(a) }; }

/* ───── stalls follow the engine and the server's plot numbers ───── */
function wantLot(v) { if (v.sold) return v.lot; if (v.rank === 1) return BOSS_LOT; const k = SLOTS[v.addr]; return k != null && PLOTS[k] ? PLOTS[k] : null; }
function emptyLot(lot) {
  for (const s of SHUTS) if (s.lot === lot && !s.gone) { s.done = s.gone = true; if (s.sh.g.parent) s.sh.g.parent.remove(s.sh.g); }
  clearStall(lot); lot.owner = null;
  for (const a of lot.queue || []) leaveQueue(a); lot.queue = [];
  if (lot.gold) { lot.gold.visible = false; if (lot.goldGi >= 0) glowSize(lot.goldGi, 0); }
  lot.cook = []; lot.pop = null; lot.g.scale.setScalar(lot.s);
}
function placeStall(v, quiet) {
  const L = wantLot(v); if (L === v.lot) return;
  if (v.lot && v.lot.owner === v) emptyLot(v.lot);
  v.lot = L; if (!L) return;
  if (L.owner && L.owner !== v) { const o = L.owner; emptyLot(L); o.lot = null; }
  L.owner = v; buildStall(L); syncQueue(L); if (!quiet) L.pop = 0;
}
function syncStalls(quiet) { for (const v of CIT.values()) if (!v.sold) placeStall(v, quiet); for (const v of CIT.values()) if (!v.sold && !v.lot) placeStall(v, quiet); }
function localSlots() { // only while the live server has not answered: the same rule it uses (move-in order)
  const taken = new Set(Object.values(SLOTS));
  const fresh = [...CIT.values()].filter((v) => !v.sold && SLOTS[v.addr] == null).sort((a, b) => a.firstIn - b.firstIn || (a.addr < b.addr ? -1 : 1));
  let k = 0; for (const v of fresh) { while (taken.has(k)) k++; SLOTS[v.addr] = k; taken.add(k); }
}
function levelTick(quiet) {
  const now = nowSec();
  for (const v of CIT.values()) {
    if (v.sold) continue; const L = levelOf(v.firstIn, now); if (L === v.level) continue; v.level = L;
    const lot = v.lot; if (!lot || lot.owner !== v) continue;
    buildStall(lot); syncQueue(lot);
    if (!quiet) { lot.pop = 0; floatAt(lot.x, lot.top * lot.s + 1.6, lot.z, 'Lv ' + L + ' · ' + LEVELS[L - 1], 2.0, 'lv'); }
  }
}
/** A holder sold (or left): lights out, the shutter slams, CLOSED FOR GOOD; the plot empties 20 s later. */
function liveSell(v, why) {
  if (v.sold) return; v.sold = true; v.emptyT = 20;
  const lot = v.lot;
  if (lot && lot.owner === v) {
    lot.cook = []; const sh = makeShutter(lot);
    SHUTS.push({ v, lot, sh, t: 0, lit: lot.lights.slice(), clang: false, signed: false, walked: false });
    for (const a of lot.queue || []) leaveQueue(a); lot.queue = []; syncGold(lot);
    if (!ME && userT > 10) camTo(shutCam(lot));
  }
  const me = ME && ME.addr === v.addr;
  toast(me ? 'You sold, so your shutter comes down for good' : `${short(v.addr)} ${why === 'sold' ? 'sold' : 'left'}. The shutter comes down for good.`);
  feed(`${short(v.addr)} ${why === 'sold' ? 'sold their $LAMP' : 'dropped under 100K $LAMP'}. Shutter down, stall closed for good.`);
  liveLB(); liveStats();
}

/* ───── engine data: holders, ranks, rounds, sells, the street fund ───── */
function applyTown(d) {
  const st = d.status || {}; LS2.st = st; LS2.townN++;
  const first = LS2.townN === 1, seen = new Set();
  for (const c of d.citizens || []) {
    const a = String(c.addr).toLowerCase(); seen.add(a);
    let v = CIT.get(a);
    if (v && v.sold) continue; // sell once and you are out for good
    if (!v) { v = newRec(a, c); CIT.set(a, v); }
    v.bal = parseFloat(c.balance) || 0; v.rank = c.rank || 0; v.firstIn = c.firstIn || 0; v.received = parseFloat(c.received) || 0;
  }
  const sold = new Set((d.sold || []).map((x) => String(x.addr).toLowerCase()));
  for (const [a, v] of CIT) if (!seen.has(a) && !v.sold) liveSell(v, sold.has(a) ? 'sold' : 'left');
  if (!LS2.gotSlots) localSlots();
  for (const v of CIT.values()) if (!v.sold && v.lastRank !== v.rank) { v.lastRank = v.rank; if (v.lot && v.lot.owner === v) { syncGold(v.lot); syncQueue(v.lot); } }
  syncStalls(first); levelTick(first); refreshLooks();
  const rounds = (d.rounds || []).slice().sort((a, b) => a.n - b.n);
  for (const r of rounds) { if (r.n <= LS2.round) continue; if (!first) LS2.roundQ.push(r); LS2.round = r.n; }
  if (first && LS2.round < 0) LS2.round = 0;
  LS2.keeper = parseFloat(st.totals && st.totals.keeperETH) || 0;
  if (first) { const n = fundTarget(); while (upLevel < n) { revealUpgrade(upLevel, true); upLevel++; } }
  else if (!ENG.busy && !LS2.roundQ.length) revealPending(false);
  nextRound();
  const ca = st.tokenAddress || '';
  $('#lBuy').hidden = $('#lCa').hidden = $('#lExp').hidden = !ca;
  if (ca) { $('#lBuy').href = buyUrl(ca); $('#lCa').innerHTML = `<svg viewBox="0 0 16 16"><rect x="5" y="5" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3 11V3.5A1.5 1.5 0 0 1 4.5 2H11" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>CA ${short(ca)}`; $('#lExp').href = `${CHAIN.explorer}/token/${ca}`; $('#emBuy').href = buyUrl(ca); }
  $('#emBuy').hidden = !ca;
  const open = [...CIT.values()].filter((v) => !v.sold).length;
  $('#emT').textContent = ca ? 'Open for its first vendors' : 'Coming soon';
  $('#emS').textContent = ca ? 'Hold 100K $LAMP or more and a tuk-tuk brings you a push cart on this street. It grows every 10 minutes you hold, up to a Grand Restaurant.' : '$LAMP launches on Pons. Hold 100K $LAMP or more and you get a stall on this street, one that grows every 10 minutes you hold. Follow on X for the CA.';
  $('#empty').classList.toggle('in', !LS2.closedEmpty && (!ca || !open));
  liveStats(); liveLB(); syncWalletUI();
}
const fundTarget = () => UPG.filter((u) => LS2.keeper >= u.eth - 1e-9).length;
/** Treasury milestones build the street: string lights, band stage, koi canal, ferris wheel, dragon arch. */
function revealPending(withCam) {
  const n = fundTarget(); let first = true;
  while (upLevel < n) {
    const k = upLevel, u = UPG[k]; upLevel++; revealUpgrade(k);
    toast('The street grows: ' + u.name); feed(`Street fund hit ${u.eth} ETH: ${u.name.toLowerCase()}.`);
    if (withCam && first) camTo({ x: u.at.x, z: u.at.z, y: 2, d: u.at.d, p: u.at.p, yaw: u.at.yaw || 0 }, 0.7);
    const a = u.at; for (let i = 0; i < 40; i++) spark(a.x + rr(-6, 6), rr(4, 12), a.z + rr(-6, 6), rr(-3, 3), rr(0, 6), rr(-3, 3), rr(0.8, 1.6), 1.2, pick(['#ffd36a', '#fff1c0', '#ff9a3a']), 1);
    first = false;
  }
  liveStats();
  return !first;
}
function nextRound() { if (ENG.busy || !LS2.roundQ.length) return; liveRound(LS2.roundQ.shift()); }
/** One engine round on screen: fireworks for the burn, golden lanterns to the guild, the street fund. */
function liveRound(r) {
  ENG.busy = true; ENG.rounds = r.n;
  const burned = parseFloat(r.tokensBurned) || 0, eth = parseFloat(r.treasuryETH) || 0;
  const drops = (r.drops || []).map((d) => ({ v: CIT.get(String(d.addr).toLowerCase()), amt: parseFloat(d.amount) || 0 })).filter((x) => x.v && !x.v.sold && x.v.lot && x.v.lot.owner === x.v && x.v.lot.gold).slice(0, PARADE.length);
  const cine = !ME || userT > 10; LS.cine = cine ? 16.5 : 0;
  toast(`Engine round #${r.n}: ${r.claimedETH || '0.02'} ETH of fees at work`);
  feed(`Engine round #${r.n}: 30% burn, 35% to the guild, 35% to the street fund.`);
  if (cine) camTo({ x: 0, z: -22, y: 21, d: 88, p: -0.06, yaw: 0 });
  after(0.3, () => { for (let i = 0; i < 18; i++) launch(rr(-16, 16), rr(-75, 30), i * 0.26); });
  after(2.0, () => { floatAt(0, 30, -10, '-' + fmt(burned) + ' $LAMP burned', 3.2, 'burn'); if (ME && !cine) floatAt(ME.x, 4.2, ME.z, 'Fireworks: ' + fmt(burned) + ' $LAMP burned', 2.6, 'burn'); liveStats(); });
  after(5.0, () => {
    startParade(drops);
    if (drops.length) feed(`${drops.length} golden lanterns float down to the Golden Lantern Guild.`);
    else toast('No guild member has held 10 min yet, so the whole buyback was burned');
    if (cine && drops.length) followParade = 6.8;
  });
  after(12.4, () => {
    if (!revealPending(cine)) { floatAt(0, 9, 20, '+' + eth.toFixed(3) + ' ETH to the street fund', 2.6, 'up'); if (ME && !cine) floatAt(ME.x, 4.4, ME.z, '+' + eth.toFixed(3) + ' ETH to the street fund', 2.4, 'up'); }
  });
  after(16.5, () => { ENG.busy = false; LS.cine = 0; if (ME && cine) followMe(); nextRound(); });
}

/* ───── vendors on screen: one per live entity, never simulated here ───── */
function newFig(addr) {
  const f = { addr, p: null, key: '', labKey: '', ph: lookOf(addr).ph, emo: null, lastEmo: null, react: null, bubT: 0, hideT: 0 };
  f.lab = document.createElement('div'); f.lab.className = 'lab';
  f.lab.innerHTML = '<div class="bb"></div><div class="rw"></div>'; f.bb = f.lab.firstChild; f.rw = f.lab.lastChild; labels.appendChild(f.lab);
  return f;
}
function isVisitor(f) { return f === ME ? !holder(f.addr) : f.e ? !!f.e.v : !holder(f.addr); }
function dressFig(f) {
  const v = holder(f.addr), r = v ? v.rank : 0, top = r && r <= 10, band = top ? BAND[r - 1] : null, vis = isVisitor(f), L = lookOf(f.addr);
  const key = r + '|' + (vis ? 1 : 0) + '|' + (f.pack ? 1 : 0);
  if (f.key === key && f.p) return; f.key = key;
  const old = f.p;
  f.p = makePerson({ skin: L.skin, shirt: L.shirt, apron: vis ? L.shirt : top ? band : L.apronC, hat: r === 1 ? 'boss' : top ? 'toque' : vis ? 'cap' : L.hatK, hatC: top ? band : vis ? '#5a4a8a' : L.hatC, pack: vis || !!f.pack });
  if (r === 1) { const sash = mesh(boxG(0.1, 0.8, 0.4), M.gold, 0, 1.05, 0.02, f.p.body); sash.rotation.z = 0.7; f.p.g.scale.setScalar(1.12); }
  if (old) { f.p.g.position.copy(old.g.position); f.p.g.rotation.copy(old.g.rotation); scene.remove(old.g); }
  scene.add(f.p.g); f.labKey = '';
}
function renderFigLabel(f) {
  const v = holder(f.addr), r = v ? v.rank : 0, top = r && r <= 10, me = f === ME, on = me || !!(f.e && f.e.on), vis = isVisitor(f);
  const key = [r, on, vis, me].join('|'); if (key === f.labKey) return; f.labKey = key;
  const tag = me ? '<span class="tg me">you</span>' : vis ? '<span class="tg vi">visitor</span>' : on ? '<span class="tg on">online</span>' : '<span class="tg">offline</span>';
  f.rw.innerHTML = (top ? `<span class="rk" style="background:${BAND[r - 1]}">${r}</span>` : '') + (r === 1 ? '<span class="bs">BOSS</span>' : '') + `<span class="ad"><i class="dt${on ? ' on' : ''}"></i>${short(f.addr)}</span>` + tag;
}
function refreshLooks() { for (const f of FIGS.values()) { dressFig(f); renderFigLabel(f); } if (ME) { dressFig(ME); renderFigLabel(ME); } }
function bubble(f, text, cls = '') { if (!f) return; f.bb.textContent = text; f.bb.className = 'bb in ' + cls; f.bubT = Math.min(7, 3 + text.length * 0.06); }
function dropFig(f) { scene.remove(f.p.g); f.lab.remove(); }
const figByAddr = (a) => { if (ME && ME.addr === a) return ME; for (const f of FIGS.values()) if (f.addr === a) return f; return null; };

const EMO_DUR = { wave: 1.6, rankemote: 1.6, dance: 2.6, jump: 0.75, punch: 0.55, hug: 1.4, hi5: 0.9, bow: 1.2, hit: 0.8, spin: 1, flip: 0.9, sit: 2.5 };
const REACT = { punch: 'hit', hug: 'hug', hi5: 'hi5' };
function playEmo(f, k) { if (!f) return; f.emo = { k, t: 0, dur: EMO_DUR[k] || 1 }; f.lastEmo = { k, at: Date.now() }; }
function emotePose(f, dt) {
  const E = f.emo; if (!E) return; E.t += dt; const u = E.t / E.dur; if (u >= 1) { f.emo = null; return; }
  const P = f.p, w = Math.sin(u * Math.PI), t = E.t;
  switch (E.k) {
    case 'wave': case 'rankemote': P.armR.rotation.x = -2.7; P.armR.rotation.z = Math.sin(t * 12) * 0.45; break;
    case 'dance': { const s = Math.sin(t * 8); P.body.position.y = Math.abs(s) * 0.18; P.body.rotation.y = Math.sin(t * 4) * 0.6; P.armL.rotation.x = -2.2 + s * 0.6; P.armR.rotation.x = -2.2 - s * 0.6; P.legL.rotation.x = s * 0.4; P.legR.rotation.x = -s * 0.4; break; }
    case 'jump': P.body.position.y = w * 1.1; P.armL.rotation.x = P.armR.rotation.x = -2.6 * w; P.legL.rotation.x = P.legR.rotation.x = 0.5 * w; break;
    case 'punch': { const k = u < 0.35 ? u / 0.35 : 1 - (u - 0.35) / 0.65; P.armR.rotation.x = -1.57 * Math.min(1, k * 1.3); P.body.rotation.y = -0.35 * k; P.body.rotation.x = 0.15 * k; P.armL.rotation.x = -0.9; break; }
    case 'hug': { const k = Math.min(1, w * 2); P.armL.rotation.x = P.armR.rotation.x = -1.35 * k; P.armL.rotation.z = -0.5 * k; P.armR.rotation.z = 0.5 * k; P.body.rotation.x = 0.12 * k; break; }
    case 'hi5': P.armR.rotation.x = -2.9 * Math.min(1, w * 2); P.body.position.y = Math.max(0, Math.sin(u * Math.PI * 2)) * 0.15; break;
    case 'bow': P.body.rotation.x = 0.7 * Math.min(1, w * 1.6); break;
    case 'hit': P.body.rotation.x = -0.45 * w; P.body.rotation.z = Math.sin(t * 30) * 0.12 * (1 - u); P.armL.rotation.x = P.armR.rotation.x = -0.8 * w; P.armL.rotation.z = -0.6 * w; P.armR.rotation.z = 0.6 * w; break;
    case 'spin': P.body.rotation.y = u * Math.PI * 2; break;
    case 'flip': P.body.position.y = w * 1.2; P.body.rotation.x = -u * Math.PI * 2; break;
    case 'sit': P.body.position.y = -0.35 * Math.min(1, w * 3); P.legL.rotation.x = P.legR.rotation.x = -1.4 * Math.min(1, w * 3); break;
  }
}
/** The target of a partner move reacts: a punch lands (POW, stagger), a hug or high five is returned. */
function reactOn(f, k, from) {
  const rk = REACT[k]; if (!f || !rk) return;
  setTimeout(() => {
    playEmo(f, rk); f.react = { k: rk, at: Date.now() };
    if (rk === 'hit') { const x = f === ME ? ME.x : f.e ? f.e.rx : 0, z = f === ME ? ME.z : f.e ? f.e.rz : 0; floatAt(x, 2.6, z, 'POW!', 1.0, 'clang'); }
    if (f === ME && rk === 'hit' && from) { const dx = ME.x - from.x, dz = ME.z - from.z, d = Math.hypot(dx, dz) || 1; ME.knock = { vx: (dx / d) * 6, vz: (dz / d) * 6, t: 0.3 }; shake = Math.max(shake, 0.35); }
  }, rk === 'hit' ? 180 : 120);
}
const _lp = new THREE.Vector3();
function poseFig(f, dt, t, x, z, yaw, moving) {
  const P = f.p;
  P.g.position.set(x, groundY(x, z), z); P.g.rotation.y = yaw;
  P.body.rotation.set(0, 0, 0); P.armL.rotation.z = 0; P.armR.rotation.z = 0;
  animPerson(P, t, moving, f.ph, 'idle');
  emotePose(f, dt);
  // label + bubble
  renderFigLabel(f);
  if (f.bubT > 0) { f.bubT -= dt; if (f.bubT <= 0) f.bb.className = 'bb'; }
  const r = (holder(f.addr) || {}).rank || 0;
  _lp.set(x, P.g.position.y + (r === 1 ? 2.75 : 2.45), z); const dist = _lp.distanceTo(camera.position); _lp.project(camera);
  const vis = P.g.visible && _lp.z < 1 && _lp.x > -1.1 && _lp.x < 1.1 && _lp.y > -1.1 && _lp.y < 1.1;
  const far = dist > (r || f === ME || f.bubT > 0 ? 150 : IS_PHONE ? 60 : 85);
  const lab = f.lab;
  if (!vis || far) { if (lab.style.opacity !== '0') lab.style.opacity = '0'; }
  else { if (lab.style.opacity !== '1') lab.style.opacity = '1'; const sx = (_lp.x * 0.5 + 0.5) * innerWidth, sy = (-_lp.y * 0.5 + 0.5) * innerHeight, sc = clamp(34 / dist + 0.55, 0.62, 1.15); lab.style.transform = `translate(${sx | 0}px,${sy | 0}px) translate(-50%,-100%) scale(${sc.toFixed(2)})`; lab.style.zIndex = f === ME ? 40 : r ? 30 - r : f.bubT > 0 ? 20 : 1; }
}

/* ───── live server callbacks ───── */
function onJoin(e, arrive) {
  let f = FIGS.get(e.id); if (f) return;
  f = newFig(e.a); f.e = e; FIGS.set(e.id, f); dressFig(f); renderFigLabel(f);
  if (arrive) {
    feed(`A tuk-tuk dropped ${short(e.a)} at the entrance. Welcome to the market.`);
    toast(`${short(e.a)} bought $LAMP: a tuk-tuk brings a new vendor`);
    tukArrive(f);
  }
  liveLB();
}
function onGone(e, why) {
  const f = FIGS.get(e.id); if (!f) return; FIGS.delete(e.id);
  if (why === 'sold') { // the sell moment: a last wave with a backpack, then gone
    f.pack = true; f.key = ''; dressFig(f); playEmo(f, 'wave'); f.leaveT = 1.6; f.lx = e.rx; f.lz = e.rz; f.ly = e.ry; LEAVING.push(f);
    const v = CIT.get(e.a); if (v) liveSell(v, 'sold');
  } else dropFig(f);
  liveLB();
}
function onStatus(e) { const f = FIGS.get(e.id); if (f) { dressFig(f); renderFigLabel(f); } liveLB(); }
function onEmote(e, k, to) {
  const f = FIGS.get(e.id); playEmo(f, k);
  if (!to) return;
  if (ME && to === ME.addr) { reactOn(ME, k, { x: e.rx, z: e.rz }); if (k === 'punch') toast(`${short(e.a)} punched you`); else if (k === 'hug') toast(`${short(e.a)} hugged you`); else if (k === 'hi5') toast(`High five from ${short(e.a)}`); }
  else reactOn(figByAddr(to), k, { x: e.rx, z: e.rz });
}
function onBubble(e, text) { bubble(FIGS.get(e.id), text); }
function onChat(e, text) { const f = FIGS.get(e.id) || figByAddr(e.a); bubble(f, text); }
const SPEECH = { on: false, a: '', mine: false };
function speechBanner(line) {
  const v = holder(SPEECH.a), r = v ? v.rank : 0;
  $('#bnS').textContent = 'ANNOUNCEMENT AT THE STAGE';
  $('#bnB').textContent = line || (SPEECH.mine ? 'You have the stage. Type your lines in the chat box; the street gathers to listen.' : `${r === 1 ? 'The Market Boss' : r === 2 ? 'No.2' : 'A guild member'} ${short(SPEECH.a)} is speaking. The street gathers at the stage.`);
  $('#banner').classList.toggle('in', SPEECH.on);
}
function onSpeech(on, a, lines) {
  SPEECH.on = on; SPEECH.a = a || ''; if (!on) SPEECH.mine = false;
  speechBanner(lines && lines.length ? lines[lines.length - 1].text : '');
  if (on && !(ME && ME.addr === a)) feed(`${short(a)} is making an announcement at the stage.`);
  syncSpeechBtn();
}
function onSay(a, text) { bubble(figByAddr(a), text, 'sp'); if (SPEECH.on) speechBanner(`${short(a)}: ${text}`); }
function onNote(text) { toast(text); }
function onSlots(sl) { SLOTS = {}; for (const [a, k] of Object.entries(sl || {})) SLOTS[a.toLowerCase()] = k; LS2.gotSlots = true; if (LS2.townN) syncStalls(LS2.townN <= 1); }
function onAuth(s) {
  if (s.auth) {
    if (!ME || ME.addr !== s.addr) makeMe(s.addr, s.x, s.z);
    else if (s.first && Number.isFinite(s.x)) { ME.x = s.x; ME.z = s.z; ME.goal = null; }
    ME.id = s.id;
    if (s.first) { followMe(); toast(holder(s.addr) ? `You are online at your stall, ${short(s.addr)}` : 'You walk in as a visitor. Hold 100K $LAMP and a tuk-tuk brings you a stall.'); }
    if (s.signed && LS2.pendChat) { bubble(ME, LS2.pendChat); LS2.pendChat = ''; }
    if (s.signed && LS2.pendSpeech) { LS2.pendSpeech = false; startMySpeech(); }
  } else if (!s.lost) removeMe();
  syncWalletUI(); syncChat();
}
const getMe = () => (ME ? { x: ME.x, z: ME.z, yaw: ME.yaw } : null);

/* ───── your vendor ───── */
function makeMe(addr, x, z) {
  removeMe();
  ME = newFig(addr); Object.assign(ME, { x: Number.isFinite(x) ? x : SPAWN.x, z: Number.isFinite(z) ? z : SPAWN.z, yaw: Math.PI, goal: null, knock: null, moving: false });
  if (!walkable(ME.x, ME.z)) { ME.x = clamp(ME.x, -5.5, 5.5); ME.z = clamp(ME.z, -95, 91); }
  dressFig(ME); renderFigLabel(ME);
  document.body.classList.add('me'); $('#hintLive').textContent = 'WASD or arrows to walk · click to walk · 1-6 moves · Enter to chat';
  try { localStorage.removeItem('nm-off'); } catch (e) {}
}
function removeMe() {
  if (!ME) return; dropFig(ME); ME = null; LS.follow = false;
  document.body.classList.remove('me'); $('#chatbox').classList.remove('in'); $('#hintLive').textContent = 'drag to orbit · wheel to zoom · click a stall or a vendor';
}
function followMe() { if (!ME) return; LS.follow = true; LS.cine = 0; camTo({ x: ME.x, z: ME.z, y: 2, d: 24, p: 0.46, yaw: camState.yaw }, 1.6); }
const KEYS = new Set(), JOY = { x: 0, y: 0, on: false };
function tryMove(x, z) {
  if (walkable(x, z)) { ME.x = x; ME.z = z; return true; }
  if (walkable(x, ME.z)) { ME.x = x; return true; }
  if (walkable(ME.x, z)) { ME.z = z; return true; }
  return false;
}
function moveMe(dt) {
  let fx = 0, fz = 0;
  if (KEYS.has('w') || KEYS.has('arrowup')) fz += 1;
  if (KEYS.has('s') || KEYS.has('arrowdown')) fz -= 1;
  if (KEYS.has('a') || KEYS.has('arrowleft')) fx -= 1;
  if (KEYS.has('d') || KEYS.has('arrowright')) fx += 1;
  if (JOY.on) { fx += JOY.x; fz += -JOY.y; }
  const yw = camState.yaw; let dx = 0, dz = 0;
  if (fx || fz) {
    dx = -Math.sin(yw) * fz + Math.cos(yw) * fx; dz = -Math.cos(yw) * fz - Math.sin(yw) * fx; ME.goal = null; userT = 0;
    if (LS.cine > 0) followMe(); LS.follow = true;
  } else if (ME.goal) { dx = ME.goal.x - ME.x; dz = ME.goal.z - ME.z; if (Math.hypot(dx, dz) < 0.2) { ME.goal = null; dx = dz = 0; } }
  const d = Math.hypot(dx, dz); ME.moving = false;
  if (ME.knock) { ME.knock.t -= dt; tryMove(ME.x + ME.knock.vx * dt, ME.z + ME.knock.vz * dt); if (ME.knock.t <= 0) ME.knock = null; }
  else if (d > 0.001 && !(ME.emo && ['punch', 'hug', 'hi5', 'bow', 'hit'].includes(ME.emo.k))) {
    const sp = 5.4 * Math.min(1, JOY.on && !KEYS.size ? Math.hypot(JOY.x, JOY.y) : 1) * dt;
    const ok = tryMove(ME.x + (dx / d) * sp, ME.z + (dz / d) * sp);
    if (!ok && ME.goal) ME.goal = null;
    ME.moving = ok; let dy = Math.atan2(dx, dz) - ME.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); ME.yaw += dy * Math.min(1, dt * 12);
  }
}
function nearestTo(x, z, max = 2.8) {
  let best = null, bd = max;
  for (const f of FIGS.values()) { if (!f.e || f.e.id === live.S.id || f.hideT > 0) continue; const d = Math.hypot(f.e.rx - x, f.e.rz - z); if (d < bd) { bd = d; best = f; } }
  return best;
}
function myEmote(k) {
  if (!ME) return; const now = performance.now(); if (now < LS2.emoCd) return; LS2.emoCd = now + 650;
  const tg = nearestTo(ME.x, ME.z);
  if (tg) ME.yaw = Math.atan2(tg.e.rx - ME.x, tg.e.rz - ME.z);
  playEmo(ME, k); if (tg) reactOn(tg, k, ME);
  live.emote(k, tg ? tg.addr : undefined);
}
function liveKey(e) {
  const tgt = e.target; if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA')) return true;
  if (!ME) return false;
  const k = e.key.toLowerCase();
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { KEYS.add(k); e.preventDefault(); return true; }
  const em = { 1: 'wave', 2: 'dance', 3: 'jump', 4: 'punch', 5: 'hug', 6: 'hi5', 7: 'bow' }[k];
  if (em && !e.repeat) { myEmote(em); return true; }
  if (k === 'enter') { openChat(); e.preventDefault(); return true; }
  if (k === 'f') { followMe(); return true; }
  return true;
}
addEventListener('keyup', (e) => KEYS.delete(e.key.toLowerCase()));
addEventListener('blur', () => KEYS.clear());
// touch joystick
{
  const J = $('#joy'), knob = J.firstElementChild; let pid = null;
  const set = (e) => { const r = J.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, R = r.width / 2; let x = (e.clientX - cx) / R, y = (e.clientY - cy) / R; const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; } JOY.x = x; JOY.y = y; knob.style.transform = `translate(${x * R * 0.6}px,${y * R * 0.6}px)`; };
  J.addEventListener('pointerdown', (e) => { pid = e.pointerId; J.setPointerCapture(pid); JOY.on = true; set(e); e.preventDefault(); });
  J.addEventListener('pointermove', (e) => { if (e.pointerId === pid) set(e); });
  const end = (e) => { if (e.pointerId !== pid) return; pid = null; JOY.on = false; JOY.x = JOY.y = 0; knob.style.transform = ''; };
  J.addEventListener('pointerup', end); J.addEventListener('pointercancel', end);
}
if (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window) document.body.classList.add('touch');
// click / tap: a vendor or a stall opens its card; the street walks your vendor there
const _gp = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), _gv = new THREE.Vector3();
function pickFig(sx, sy) {
  let best = null, bd = 30;
  const test = (f, x, z) => { if (!f.p.g.visible) return; _lp.set(x, f.p.g.position.y + 1.1, z).project(camera); if (_lp.z > 1) return; const d = Math.hypot((_lp.x * 0.5 + 0.5) * innerWidth - sx, (-_lp.y * 0.5 + 0.5) * innerHeight - sy); if (d < bd) { bd = d; best = f; } };
  for (const f of FIGS.values()) if (f.e && !(ME && f.e.id === live.S.id)) test(f, f.e.rx, f.e.rz);
  if (ME) test(ME, ME.x, ME.z);
  return best;
}
function liveClick(sx, sy) {
  const f = pickFig(sx, sy); if (f && f !== ME) { liveCard(f); return; }
  ndc.set((sx / innerWidth) * 2 - 1, -(sy / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera);
  const h = ray.intersectObjects(HIT, false)[0], g = ray.ray.intersectPlane(_gp, _gv) ? _gv : null;
  const gd = g ? g.distanceTo(ray.ray.origin) : 1e9;
  if (h && h.object.userData.lot.owner && h.distance < gd && !(ME && g && walkable(g.x, g.z))) { liveCard(h.object.userData.lot.owner); return; }
  if (ME && g) { const x = clamp(g.x, BOUNDS.x0, BOUNDS.x1), z = clamp(g.z, BOUNDS.z0, BOUNDS.z1); ME.goal = walkable(x, z) ? { x, z } : { x: clamp(x, -5.8, 5.8), z: clamp(z, -95, 91) }; LS.follow = true; return; }
  if (h && h.object.userData.lot.owner) { liveCard(h.object.userData.lot.owner); return; }
  $('#card').classList.remove('in'); cardFor = null;
}

/* ───── tuk-tuk: newcomers ride in to the street entrance ───── */
function tukArrive(f) {
  if (TUK.on) return;
  f.hideT = 4.5;
  Object.assign(TUK, { on: true, live: true, lot: null, phase: 'in', x: 1.2, z: Z_IN + 32, tx: SPAWN.x + 1.6, tz: SPAWN.z - 0.5, yaw: Math.PI, wait: 0, dropped: false, dir: null, sp: 0,
    onDrop: () => { f.hideT = 0; floatAt(SPAWN.x, 3.4, SPAWN.z, 'New vendor · ' + short(f.addr), 2.4, 'up'); } });
  TUK.g.visible = true;
  if (!ME && userT > 10) { camTo({ x: 0, z: SPAWN.z + 4, y: 2, d: 30, p: 0.36, yaw: 0 }); followTuk = 3; }
}

/* ───── HUD ───── */
function liveStats() {
  const st = LS2.st; if (!st) return;
  const tot = st.totals || {}, sup = parseFloat(st.supply) || 1e9, burned = parseFloat(tot.tokensBurned) || 0;
  $('#sOpen').textContent = [...CIT.values()].filter((v) => !v.sold).length;
  $('#sShut').textContent = (st.counts && st.counts.out) || 0;
  $('#sBurn').textContent = ((burned / sup) * 100).toFixed(2) + '%';
  $('#sShare').textContent = fmt(parseFloat(tot.tokensShared) || 0);
  $('#uCount').textContent = upLevel + ' / 5';
  [...$('#uBar').children].forEach((e, i) => e.classList.toggle('on', i < upLevel));
  const nx = UPG[upLevel];
  $('#uNext').innerHTML = nx ? `Next: <b>${nx.name}</b> <span>at ${nx.eth} ETH in the street fund · now ${LS2.keeper.toFixed(3)} ETH</span>` : `<b>All five upgrades built.</b> <span>Street fund ${LS2.keeper.toFixed(3)} ETH.</span>`;
}
function liveLB() {
  const top = [...CIT.values()].filter((v) => !v.sold && v.rank && v.rank <= 10).sort((a, b) => a.rank - b.rank), now = nowSec();
  $('#lbList').innerHTML = top.length ? top.map((v) => { const on = (ME && ME.addr === v.addr) || (live && live.isOnline(v.addr)), fresh = now - v.firstIn < 600;
    return `<li data-a="${v.addr}"><span class="b" style="background:${BAND[v.rank - 1]}">${v.rank}</span><span class="n"><i class="dt${on ? ' on' : ''}" title="${on ? 'online' : 'offline'}"></i>${short(v.addr)}<small>${v.rank === 1 ? 'Market Boss' : 'Lv ' + v.level}${fresh ? ' · new' : ''}</small></span><span class="v">${fmt(v.bal)}<small>+${fmt(v.received)} shared</small></span></li>`; }).join('')
    : '<li class="emp"><span></span><span class="n">No vendors yet</span><span></span></li>';
}
function liveLBClick(a) { const v = CIT.get(a); if (!v) return; liveCard(v); if (v.lot) { LS.follow = false; camTo({ x: v.lot.x * 0.5, z: v.lot.z, y: 2, d: v.rank === 1 ? 40 : 22, p: 0.42, yaw: v.lot.side ? -v.lot.side * 0.7 : 0 }); } }
const heldFor = (s) => (s < 3600 ? Math.max(1, Math.floor(s / 60)) + ' min' : s < 172800 ? Math.floor(s / 3600) + 'h ' + String(Math.floor((s % 3600) / 60)).padStart(2, '0') + 'm' : Math.floor(s / 86400) + ' days');
function liveCard(x) {
  cardFor = x; const a = x.addr, v = holder(a), f = figByAddr(a), me = ME && ME.addr === a;
  const on = me || (live && live.isOnline(a)), vis = !v, held = v ? Math.max(0, nowSec() - v.firstIn) : 0;
  $('#cardH').innerHTML = (v && v.rank ? `<span class="b" style="display:inline-grid;place-items:center;width:20px;height:20px;border-radius:6px;font-size:11px;color:#1a1230;background:${BAND[v.rank - 1]}">${v.rank}</span>` : '') + short(a) + (me ? ' · you' : '');
  const sold = CIT.get(a) && CIT.get(a).sold;
  const rows = [['Address', `<a class="mono" style="color:inherit" href="${CHAIN.explorer}/address/${a}" target="_blank" rel="noreferrer">${a.slice(0, 10)}…${a.slice(-8)}</a>`]];
  if (sold) rows.push(['Stall', 'Closed for good (sold)']);
  else if (v) {
    rows.push(['Balance', fmt(v.bal) + ' $LAMP'], ['Stall', `Lv ${v.level} · ${LEVELS[v.level - 1]}${v.rank === 1 ? ' · the Market Boss stall' : ''}${v.lot ? '' : ' · waiting for a free spot'}`]);
    rows.push(['Time held', heldFor(held) + (v.level < 8 ? ` · next level in ${Math.max(1, Math.ceil((600 - (held % 600)) / 60))} min` : '')]);
    if (v.received) rows.push(['From the guild', '+' + fmt(v.received) + ' $LAMP']);
  } else rows.push(['Stall', 'None: a visitor under 100K $LAMP']);
  rows.push(['Status', me ? '<span style="color:#3ee07a">online · that is you</span>' : vis ? '<span style="color:#cfc4ff">visitor · walking the street</span>' : on ? '<span style="color:#3ee07a">online · walking live</span>' : f ? 'offline · the street walks this vendor' : 'offline']);
  $('#cardB').innerHTML = rows.map(([k, b]) => `<div class="row"><span>${k}</span><b>${b}</b></div>`).join('') +
    `<div class="tagz">${v && v.rank === 1 ? '<i>Market Boss</i>' : ''}${v && v.rank ? '<i>Golden Lantern Guild</i>' : ''}${v && held >= 600 ? '<i>held 10 min+</i>' : ''}</div>`;
  $('#card').classList.add('in');
}
function syncWalletUI() {
  if (!LIVE) return;
  const S = live ? live.S : {}, a = ME ? ME.addr : '', v = a ? holder(a) : null;
  $('#wDot').className = 'dt' + (ME && S.auth ? ' on' : '');
  if (!ME) {
    $('#wSt').textContent = S.want ? 'Connecting…' : 'Wallet not connected';
    $('#wMsg').innerHTML = 'Connect to walk the market. Holders of 100K $LAMP get a stall of their own; anyone else walks in as a visitor. No signature needed to walk.';
    $('#wActs').innerHTML = '<button class="btn gold" id="bConnect">Connect wallet</button>'; $('#bConnect').onclick = doConnect;
  } else {
    $('#wSt').innerHTML = `${short(a)}${v && v.rank ? ` · No.${v.rank}` : ''}`;
    $('#wMsg').innerHTML = (v ? `Your stall: <b>Lv ${v.level} · ${LEVELS[v.level - 1]}</b>. Balance <b>${fmt(v.bal)} $LAMP</b>.` : '<b>Visitor.</b> Hold 100K $LAMP and a tuk-tuk brings you a stall.') +
      ` ${S.auth ? 'You are online: the whole street sees you.' : 'Reconnecting…'} Chat asks for one free signature the first time; it moves no funds.`;
    $('#wActs').innerHTML = '<button class="btn" id="bFind2">Find me</button><button class="btn" id="bDisc">Disconnect</button>';
    $('#bFind2').onclick = followMe; $('#bDisc').onclick = () => { try { localStorage.setItem('nm-off', '1'); } catch (e) {} live.logout(); };
  }
  syncSpeechBtn();
}
async function doConnect() {
  try { const a = await connectWallet(); if (!a) return; live.claim(a); syncWalletUI(); toast('Connecting your wallet to the street…'); }
  catch (e) { toast(e && e.code === 4001 ? 'Connection cancelled' : (e && e.message) || 'The wallet did not connect'); }
}
function syncSpeechBtn() {
  const v = ME ? holder(ME.addr) : null, can = !!(v && v.rank && v.rank <= 2);
  $('#bSpeech').hidden = !can && !SPEECH.mine; $('#bSpeechT').textContent = SPEECH.mine ? 'End announcement' : 'Announce';
  $('#bSpeech').classList.toggle('on', SPEECH.mine);
}
function startMySpeech() {
  SPEECH.on = SPEECH.mine = true; SPEECH.a = ME.addr; ME.goal = { x: PODIUM.x + 0.4, z: PODIUM.z }; followMe();
  speechBanner(''); openChat(); syncSpeechBtn(); feed('You took the stage. The street gathers to listen.');
}
$('#bSpeech').onclick = () => {
  if (!ME) return;
  if (SPEECH.mine) { live.speech(false); SPEECH.on = SPEECH.mine = false; speechBanner(''); syncSpeechBtn(); syncChat(); return; }
  if (SPEECH.on) { toast('An announcement is already on'); return; }
  const v = holder(ME.addr); if (!v || !v.rank || v.rank > 2) { toast('Only No.1 (the Market Boss) or No.2 make announcements'); return; }
  if (live.speech(true)) startMySpeech(); else { LS2.pendSpeech = true; toast('Sign once (free, moves no funds) to speak in your name'); }
};
function syncChat() {
  const S = live ? live.S : {}, v = ME ? holder(ME.addr) : null;
  $('#chatNote').textContent = SPEECH.mine ? 'Your lines show over your head and on the banner for everyone.' : !v ? 'Chat is for holders of 100K $LAMP. Visitors can walk, wave and play.' : S.signed ? 'Chat is public: everyone on the street sees it.' : 'Chat asks for one free signature the first time. It moves no funds.';
  $('#chatIn').placeholder = SPEECH.mine ? 'Your announcement line' : 'Say something to the market';
}
function openChat() { if (!ME) return; $('#chatbox').classList.add('in'); syncChat(); setTimeout(() => $('#chatIn').focus(), 30); }
function sendChat() {
  const i = $('#chatIn'), text = i.value.trim().slice(0, SPEECH.mine ? 120 : 80); if (!text || !ME) return;
  if (SPEECH.mine) { live.say(text); bubble(ME, text, 'sp'); speechBanner(`${short(ME.addr)}: ${text}`); i.value = ''; return; }
  if (!holder(ME.addr)) { toast('Chat is for holders of 100K $LAMP'); return; }
  if (live.chat(text)) bubble(ME, text); else if (!live.S.signed) LS2.pendChat = text;
  i.value = ''; syncChat();
}
$('#chatGo').onclick = sendChat;
$('#chatIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sendChat(); } else if (e.key === 'Escape') { $('#chatbox').classList.remove('in'); e.target.blur(); } e.stopPropagation(); });
$('#bChat').onclick = () => ($('#chatbox').classList.contains('in') ? $('#chatbox').classList.remove('in') : openChat());
$('#bFind').onclick = followMe;
for (const b of document.querySelectorAll('[data-emo]')) b.onclick = () => myEmote(b.dataset.emo);
$('#bConnect').onclick = doConnect; $('#bConnect2').onclick = doConnect;
$('#lCa').onclick = () => { const ca = LS2.st && LS2.st.tokenAddress; if (!ca) return; navigator.clipboard && navigator.clipboard.writeText(ca).then(() => toast('Contract address copied'), () => toast(ca)); };
$('#lX').href = X_URL; $('#emXl').href = X_URL;
$('#emX').onclick = () => { LS2.closedEmpty = true; $('#empty').classList.remove('in'); };

/* ───── per frame ───── */
function liveFrame(dt, t) {
  if (ME) moveMe(dt);
  for (const e of live.ents.values()) if (!FIGS.has(e.id)) onJoin(e, false);
  live.tick(dt);
  for (const f of FIGS.values()) {
    const e = f.e;
    if (ME && e.id === live.S.id) { if (f.p.g.visible) f.p.g.visible = false; f.lab.style.opacity = '0'; continue; }
    if (f.hideT > 0) { f.hideT -= dt; f.p.g.visible = false; f.lab.style.opacity = '0'; continue; }
    f.p.g.visible = true;
    poseFig(f, dt, t, e.rx, e.rz, e.ry, e.moving);
  }
  for (let i = LEAVING.length - 1; i >= 0; i--) { const f = LEAVING[i]; f.leaveT -= dt; if (f.leaveT <= 0) { dropFig(f); LEAVING.splice(i, 1); continue; } poseFig(f, dt, t, f.lx, f.lz, f.ly, false); }
  if (ME) { ME.p.g.visible = true; poseFig(ME, dt, t, ME.x, ME.z, ME.yaw, ME.moving); }
  // stalls: steam from the woks, the plot of a seller empties 20 s after the shutter
  for (const v of CIT.values()) {
    if (v.sold) { v.emptyT -= dt; if (v.emptyT <= 0) { if (v.lot && v.lot.owner === v) emptyLot(v.lot); CIT.delete(v.addr); syncStalls(false); } continue; }
    const lot = v.lot; if (lot && lot.owner === v && lot.cook.length && rnd() < dt * (v.level >= 2 ? 7 : 3)) { const c = pick(lot.cook); puff(c.x, c.y, c.z, lot.s); }
  }
  LS2.lvlT -= dt; if (LS2.lvlT <= 0) { LS2.lvlT = 2; levelTick(false); }
}
function liveCam(dt) {
  if (LS.cine > 0) { LS.cine -= dt; return; }
  if (!ME || !LS.follow) return;
  const y = groundY(ME.x, ME.z) + 1.6;
  if (camFly) { camGoal.tx = ME.x; camGoal.tz = ME.z; camGoal.ty = y; }
  else { const a = 1 - Math.exp(-dt * 5); camState.tx += (ME.x - camState.tx) * a; camState.tz += (ME.z - camState.tz) * a; camState.ty += (y - camState.ty) * a; }
}

/* ───── start ───── */
$('#mv').innerHTML = '<span>Hold 100K $LAMP and you get a stall. It grows every 10 minutes you hold, from a push cart to a Grand Restaurant. Every 0.02 ETH of fees: 30% buys $LAMP back and burns it (fireworks), 35% buys $LAMP for the Golden Lantern Guild (the top 10 who held 10 min+), 35% goes to the street fund that builds the street. Sell once and your shutter comes down for good. No.1 is the Market Boss and can make announcements at the stage. Every number here comes from the chain.</span>';
$('#mv').innerHTML += $('#mv').innerHTML;
const live = LIVE ? createLive({ onJoin, onGone, onStatus, onEmote, onBubble, onChat, onSpeech, onSay, onAuth, onNote, onSlots, getMe }) : null;
if (LIVE) {
  createTown({ onTown: applyTown, onError: () => { if (!LS2.townN) { $('#emT').textContent = 'Coming soon'; $('#emS').textContent = 'The market is getting ready. Check back in a moment.'; $('#empty').classList.add('in'); } } });
  feed('Welcome to the Night Market. Hold 100K $LAMP and you get a stall on this street.');
  let off = false; try { off = localStorage.getItem('nm-off') === '1'; } catch (e) {}
  if (!off) knownWallet().then((a) => { if (a) { live.claim(a); syncWalletUI(); } });
  syncWalletUI(); liveLB();
}
// for tests and content capture
window.__nm = {
  figs: () => [...FIGS.values()].map((f) => ({ id: f.e.id, a: f.addr, x: f.e.rx, z: f.e.rz, on: f.e.on, v: f.e.v, vis: f.p.g.visible, lab: f.rw.textContent, bub: f.bubT > 0 ? f.bb.textContent : '', emo: f.lastEmo, react: f.react })),
  me: () => ME && { a: ME.addr, id: ME.id, x: ME.x, z: ME.z, emo: ME.lastEmo, react: ME.react, knock: !!ME.knock, lab: ME.rw.textContent, bub: ME.bubT > 0 ? ME.bb.textContent : '' },
  walk: (dx, dz) => { if (ME) ME.goal = { x: ME.x + dx, z: ME.z + dz }; }, emote: myEmote, cit: () => [...CIT.values()].map((v) => ({ a: v.addr, rank: v.rank, level: v.level, lot: v.lot ? LOTS.indexOf(v.lot) : -1, sold: v.sold })),
  shut: () => SHUTS.filter((s) => !s.done).length, tuk: () => TUK.on, round: () => LS2.round, busy: () => ENG.busy, up: () => upLevel, live, PLOTS, LOTS,
};
