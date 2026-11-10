import * as THREE from '/node_modules/three/build/three.module.js';
export { THREE };

export const C = { night: '#0B0F1A', navy: '#1F2A44', navy2: '#2c3a5e', red: '#E63946', amber: '#F4A261', white: '#F1FAEE', grey: '#8d99b3', wood: '#b8763a', gold: '#f2c14e' };
const W = 1080, H = 1920;
export const TL = await (await fetch('/out/timeline.json')).json();
const UM = Object.fromEntries(TL.units.map(u => [u.id, u]));
/** début d'une unité de narration (s) ; k = index du sous-titre dans l'unité */
export const U = (id, k) => k === undefined ? UM[id].start : UM[id].subs[Math.min(k, UM[id].subs.length - 1)].start;
export const UE = id => UM[id].end;
export const SC = i => TL.scenes[i - 1];

// ---------- easings ----------
export const cl = x => Math.min(1, Math.max(0, x));
export const pr = (t, s, d) => cl((t - s) / d);
export const E = {
  out: x => 1 - Math.pow(1 - x, 3), in: x => x * x * x,
  io: x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2,
  back: x => { const c = 1.70158; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); },
  bounce: x => { const n = 7.5625, d = 2.75; if (x < 1 / d) return n * x * x; if (x < 2 / d) return n * (x -= 1.5 / d) * x + .75; if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + .9375; return n * (x -= 2.625 / d) * x + .984375; },
};
export const mix = (a, b, k) => a + (b - a) * k;
export const rnd = i => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

// ---------- sons (enregistrés à la construction, synthétisés ensuite en Python) ----------
export const SFX = [];
export const snd = (name, t, gain = 1) => SFX.push({ name, t: +t.toFixed(3), gain });

// ---------- three ----------
const canvas = document.getElementById('c');
export const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setSize(W, H, false); renderer.setClearColor(0x000000, 0);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
export const scene = new THREE.Scene();
export const cam = new THREE.OrthographicCamera(-5.4, 5.4, 7.6, -11.6, 0.1, 200);
const key = new THREE.DirectionalLight('#ffe2c2', 2.6); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 90 }); key.shadow.bias = -0.0008;
const hemi = new THREE.HemisphereLight('#7c90c8', '#3a1420', 1.9);
const rim = new THREE.DirectionalLight('#E63946', 1.3);
scene.add(key, key.target, hemi, rim);

/** repère « écran » : r = vers la droite, y = hauteur, d = vers le spectateur */
export const P = (r, y = 0, d = 0) => new THREE.Vector3((r + d) * .7071, y, (-r + d) * .7071);
const ELEV = 0.588; // ~33.7°
export function setCam({ r = 0, y = 3, d = 0, zoom = 1, az = 0 } = {}) {
  const tg = P(r, y, d), a = Math.PI / 4 + az;
  cam.position.set(tg.x + Math.sin(a) * Math.cos(ELEV) * 60, tg.y + Math.sin(ELEV) * 60, tg.z + Math.cos(a) * Math.cos(ELEV) * 60);
  cam.lookAt(tg); cam.zoom = zoom; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
  key.position.set(tg.x - 12, tg.y + 30, tg.z + 22); key.target.position.copy(tg); key.target.updateMatrixWorld();
  rim.position.set(tg.x + 20, tg.y + 6, tg.z - 20);
}
export function proj(v) { const p = v.clone().project(cam); return { x: (p.x + 1) / 2 * W, y: (1 - p.y) / 2 * H }; }

const mats = {};
export const mat = (color, o = {}) => { const k = color + JSON.stringify(o); return mats[k] ||= new THREE.MeshLambertMaterial({ color, flatShading: true, ...o }); };
export const umat = (color, o = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...o });
function mk(geo, color, parent) { const m = new THREE.Mesh(geo, typeof color === 'string' ? mat(color) : color); m.castShadow = m.receiveShadow = true; parent && parent.add(m); return m; }
export const box = (w, h, d, color, parent) => mk(new THREE.BoxGeometry(w, h, d), color, parent);
export const cyl = (rt, rb, h, seg, color, parent) => mk(new THREE.CylinderGeometry(rt, rb, h, seg), color, parent);
export const ico = (r, color, parent, det = 0) => mk(new THREE.IcosahedronGeometry(r, det), color, parent);
export const grp = parent => { const g = new THREE.Group(); (parent || scene).add(g); return g; };
export function pawn(color, parent, s = 1) {
  const g = grp(parent); const b = cyl(.1 * s, .34 * s, .9 * s, 6, color, g); b.position.y = .45 * s;
  const h = ico(.25 * s, color, g); h.position.y = 1.05 * s; return g;
}
export function stage(parent, r = 7.6, color = '#18213a') {
  const s = cyl(r, r + .5, .5, 12, color, parent); s.position.y = -.25; s.castShadow = false;
  for (let i = 0; i < 16; i++) { // rochers facettés en bord de plateau
    const a = i / 16 * Math.PI * 2 + rnd(i) * .3, rr = r - .5 - rnd(i + 9) * .9, k = ico(.25 + rnd(i + 3) * .45, i % 5 === 0 ? '#3a2330' : '#232f52', parent);
    k.position.set(Math.cos(a) * rr, .1, Math.sin(a) * rr); k.rotation.set(rnd(i) * 3, rnd(i + 1) * 3, 0); k.scale.y = .6 + rnd(i + 5) * .8;
  }
  const fl = []; // éclats flottants (profondeur 2.5D)
  for (let i = 0; i < 26; i++) { const m = new THREE.Mesh(new THREE.TetrahedronGeometry(.07 + rnd(i + 40) * .12), new THREE.MeshBasicMaterial({ color: i % 4 ? '#3b4a72' : '#E63946', transparent: true, opacity: .75 })); parent.add(m); fl.push(m); }
  s.onBeforeRender = () => { const t = window.__t || 0; fl.forEach((m, i) => { m.position.copy(P((rnd(i) - .5) * 13, 1 + ((rnd(i + 20) * 14 + t * (.15 + rnd(i + 60) * .25)) % 14), (rnd(i + 30) - .5) * 9 - 2)); m.rotation.set(t * .4 + i, t * .3 + i, 0); }); };
  return s;
}
/** fil tendu entre deux points (mis à jour à chaque image) */
export function strand(parent, color = C.white, rad = .022) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, 1, 5), new THREE.MeshBasicMaterial({ color })); parent.add(m);
  const up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3();
  m.set = (a, b) => { dir.subVectors(b, a); const L = dir.length(); m.visible = L > .01; if (!m.visible) return; m.position.addVectors(a, b).multiplyScalar(.5); m.scale.set(1, L, 1); m.quaternion.setFromUnitVectors(up, dir.normalize()); };
  return m;
}
/** chute avec rebond : renvoie y (ou null avant t0) */
export const drop = (t, t0, y1, from = 16, dur = .55) => t < t0 ? null : mix(from, y1, E.bounce(pr(t, t0, dur)));
export function show(o, v) { o.visible = !!v; }
/** apparition « pop » d'un objet 3D */
export function pop3(o, t, t0, dur = .35, s = 1) { const k = pr(t, t0, dur); o.visible = k > 0; o.scale.setScalar(Math.max(.001, E.back(k)) * s); }

// ---------- HTML ----------
const ov = document.getElementById('ov'), ui = document.getElementById('ui');
export function Hn(cls, html, layer = ov) { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; d.style.display = 'none'; layer.appendChild(d); return d; }
export function Tn(el, { x = 540, y = 960, s = 1, r = 0, o = 1, ax = 50, ay = 50 } = {}) {
  if (o <= .003 || s <= .003) { el.style.display = 'none'; return; }
  el.style.display = 'block'; el.style.opacity = o;
  el.style.transform = `translate(${x}px,${y}px) translate(-${ax}%,-${ay}%) rotate(${r}deg) scale(${s})`;
}
/** pop HTML : apparaît à t0, disparaît à t1 */
export function popH(el, t, t0, t1, o = {}) {
  const a = pr(t, t0, o.din || .28), b = t1 == null ? 0 : pr(t, t1, o.dout || .18);
  if (a <= 0 || b >= 1) { el.style.display = 'none'; return; }
  const kind = o.kind || 'pop';
  let s = 1, y = 0, r = o.r || 0;
  if (kind === 'pop') s = E.back(a); else if (kind === 'slam') { s = mix(2.4, 1, E.out(a)); } else if (kind === 'up') y = (1 - E.out(a)) * 90;
  Tn(el, { x: o.x ?? 540, y: (o.y ?? 960) + y - b * 40, s: s * (o.s || 1), r, o: Math.min(1, a * 2.5) * (1 - b), ax: o.ax, ay: o.ay });
}
/** étiquette collée à un point 3D */
export function tag(el, v, o = {}) { const p = proj(v); Tn(el, { x: p.x + (o.dx || 0), y: p.y + (o.dy || 0), s: o.s ?? 1, o: o.o ?? 1, r: o.r || 0 }); }

// ---------- scènes ----------
export const scenes = [];
export function defScene(i, def) { const g = grp(); g.visible = false; const s = { i, g, els: [], bg: null, ...SC(i) }; scenes[i - 1] = s; s.H = (cls, html) => { const e = Hn(cls, html); s.els.push(e); return e; }; def(s); }

const subEl = Hn('sub', '', ui), srcEl = Hn('src', '', ui);
const SRC = [];
export const source = (t0, t1, text) => SRC.push({ t0, t1, text });
const fmt = s => s.replace(/\*(.+?)\*/g, '<b>$1</b>');
const wrap = s => { const w = s.replace(/\*/g, '').split(' '); if (s.replace(/\*/g, '').length <= 17 || w.length < 2) return fmt(s); // coupe en deux lignes équilibrées
  const parts = s.split(' '); let best = 1, bd = 1e9; for (let i = 1; i < parts.length; i++) { const a = parts.slice(0, i).join(' ').replace(/\*/g, '').length, b = parts.slice(i).join(' ').replace(/\*/g, '').length; if (Math.abs(a - b) < bd) { bd = Math.abs(a - b); best = i; } }
  let a = parts.slice(0, best).join(' '), b = parts.slice(best).join(' ');
  if ((a.match(/\*/g) || []).length % 2) { a += '*'; b = '*' + b; } return fmt(a) + '<br>' + fmt(b); };
const SUBS = TL.units.flatMap(u => u.subs.map((s, k) => ({ ...s, html: wrap(s.text), last: k === u.subs.length - 1, uend: u.end })));
SUBS.forEach((s, i) => { const n = SUBS[i + 1]; s.hide = s.last ? Math.min(s.uend + .12, n ? n.start : 1e9) : (n ? n.start : s.end); });

const bgimg = document.getElementById('bgimg'), dim = document.getElementById('dim'), wipe = document.getElementById('wipe'), bar = document.getElementById('bar');
let curSrc = '';
async function setBg(b) {
  if (!b) { bgimg.style.display = 'none'; return; }
  if (b.src !== curSrc) { curSrc = b.src; bgimg.src = b.src; await bgimg.decode().catch(() => { }); }
  bgimg.style.display = 'block'; bgimg.style.opacity = b.o ?? 1; bgimg.style.transform = `scale(${b.s || 1})`; bgimg.style.filter = b.f || 'none';
}
export const clipFrame = (name, n, f) => `/out/clips/${name}/${String(Math.min(n, Math.max(1, Math.round(f) + 1))).padStart(4, '0')}.jpg`;
export const state = { dim: 0 };

window.renderAt = async (t) => {
  window.__t = t; state.dim = 0; let bgr = null;
  for (const s of scenes) {
    const on = t >= s.start && t < s.end; s.g.visible = on;
    if (on) { const r = s.update(t, t - s.start) || {}; if (r.bg) bgr = r.bg; }
    else for (const e of s.els) e.style.display = 'none';
  }
  await setBg(bgr);
  dim.style.opacity = state.dim;
  // sous-titres
  const sb = SUBS.find(s => t >= s.start && t < s.hide);
  if (sb) { if (subEl._h !== sb.html) { subEl.innerHTML = sb.html; subEl._h = sb.html; } const k = pr(t, sb.start, .1); Tn(subEl, { x: 540, y: 1400, s: mix(.82, 1, E.back(k)), o: 1 }); } else subEl.style.display = 'none';
  // sources
  const so = SRC.find(s => t >= s.t0 && t < s.t1);
  if (so) { if (srcEl._h !== so.text) { srcEl.innerHTML = '<i>SOURCE</i>' + so.text; srcEl._h = so.text; } const a = pr(t, so.t0, .25), b = pr(t, so.t1 - .2, .2); Tn(srcEl, { x: 40 - (1 - E.out(a)) * 60, y: 1608, o: a * (1 - b), ax: 0, ay: 50 }); } else srcEl.style.display = 'none';
  // transition entre scènes : volet sombre
  let wx = -120; for (const s of scenes.slice(1)) { const k = (t - (s.start - .17)) / .34; if (k > 0 && k < 1) wx = mix(-115, 115, E.io(k)); }
  wipe.style.transform = `translateX(${wx}%) skewX(-12deg)`;
  bar.style.width = (t / TL.total * 100) + '%';
  renderer.render(scene, cam);
};

export async function finish() {
  for (let i = 1; i < scenes.length; i++) snd('whoosh', scenes[i].start - .16, .8);
  window.SFX = SFX;
  await document.fonts.load('96px Anton'); await document.fonts.ready;
  window.ready = true;
}
