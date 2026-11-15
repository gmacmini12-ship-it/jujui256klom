import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { jeu } from '../game.js';
import { calque } from './calque.js';
import { PITCH } from '../city.js';
import { marche } from './marche.js';
import { INVITES_ROBOTS as INV, CALQUE_GLANEUR as CG, CALQUE_PORTEUR as CP } from '../data/robots.js';

// Système « robots » (bible §3.2, plan 2.2) : les machines de service qu'on croise dans Kasumi.
//
//   Glaneur : cube de 40 cm sur trois roues, une diode frontale, un bras-pince, un bac à couvercle.
//             Il ronde le long des trottoirs, ramasse des débris, s'écarte du joueur… et se renverse si on le pousse.
//   Porteur : capsule de 1,4 m, bande lumineuse, visière qui regarde, une boîte sur la tête. Il se dandine.
//
// Rendu : tout est instancié (une dizaine d'appels de dessin au total, quel que soit le nombre de machines).
// Les machines suivent leurs propres trajets à hauteur fixe : elles ne dépendent pas de la physique du joueur.
//
// API (aussi sur jeu.robots) :
//   robots.liste()                              toutes les machines (objets vivants, ne pas copier)
//   robots.ajouter(type, { position, trajet, boucle, vitesse, zone })   type 'glaneur' | 'porteur'
//   robots.retirer(robot)
//   robots.renverser(robot, par = 'joueur')     Glaneur seulement ; robots.redresser(robot, par = 'joueur')
//   robots.delaiRedressement                    secondes avant que le Glaneur se relève seul (Infinity : jamais)
// Évènements émis :
//   'robot:renverse' { robot, par, transgression: 'T3', attention: 5, compte }   (etat.transgressions.T3 +1)
//   'robot:redresse' { robot, par: 'joueur' | 'seul', soin }                      (etat.soin +1 si par joueur)
//   'robot:bloque'   { robot, duree }       (voie barrée longtemps : aucun compteur n'est touché)

const TAU = Math.PI * 2;
const DIST_AFF = 95; // m : au-delà, la machine avance mais n'est pas dessinée
const DIST_ETIQ = 28; // m : étiquette du Calque
const DIST_SON = 15; // m : voix continues
const NB_VOIX = 4;
const CAPACITE = 64;

// ---------- Utilitaires ----------
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
const lisse = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
function graine(s) {
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const remplir = (g, c) => g.replace(/\{(\w+)\}/g, (_, k) => c[k] ?? '');

// Hauteur du sol dans Kasumi : trottoir (0,3 m) à l'intérieur d'un pâté, chaussée ailleurs.
function hauteurKasumi(x, z) {
  const cx = Math.round(x / PITCH) * PITCH, cz = Math.round(z / PITCH) * PITCH;
  return Math.abs(cx) <= 4 * PITCH && Math.abs(cz) <= 4 * PITCH && Math.abs(x - cx) < 22 && Math.abs(z - cz) < 22 ? 0.3 : 0;
}

// ---------- Trajets ----------
// { pts: [{x, z, y?}], cum, long, boucle, lim: { g, d }, cote, sites, stations }
function creerTrajet(points, boucle = true) {
  const pts = points.map((p) => (Array.isArray(p) ? { x: p[0], z: p[1], y: p[2] } : { x: p.x, z: p.z, y: p.y }));
  if (boucle) pts.push({ ...pts[0] });
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  return { pts, cum, long: cum[cum.length - 1], boucle, lim: { g: 1.2, d: 1.2 }, cote: 1, sites: [], stations: [], robots: [] };
}

const E = { x: 0, z: 0, tx: 0, tz: -1, y: undefined };
// Échantillonne le trajet à l'abscisse s (m), tangente dans le sens des points croissants.
function echantillon(path, s) {
  const L = path.long;
  if (path.boucle) s = ((s % L) + L) % L;
  else s = clamp(s, 0, L);
  const cum = path.cum;
  let a = 0, b = cum.length - 1;
  while (b - a > 1) { const m = (a + b) >> 1; if (cum[m] <= s) a = m; else b = m; }
  const p0 = path.pts[a], p1 = path.pts[b];
  const seg = Math.max(1e-6, cum[b] - cum[a]);
  const k = (s - cum[a]) / seg;
  E.x = p0.x + (p1.x - p0.x) * k;
  E.z = p0.z + (p1.z - p0.z) * k;
  E.tx = (p1.x - p0.x) / seg;
  E.tz = (p1.z - p0.z) / seg;
  E.y = p0.y !== undefined && p1.y !== undefined ? lerp(p0.y, p1.y, k) : undefined;
  return E;
}

// Rectangle à coins arrondis ; sens +1 : horaire sur la carte (nord en haut), −1 : antihoraire.
function anneau(cx, cz, hx, hz, sens, rayon = 1.8) {
  const coins = [[cx - hx, cz - hz], [cx + hx, cz - hz], [cx + hx, cz + hz], [cx - hx, cz + hz]];
  if (sens < 0) coins.reverse();
  const out = [];
  for (let i = 0; i < 4; i++) {
    const V = coins[i], A = coins[(i + 3) % 4], B = coins[(i + 1) % 4];
    const la = Math.hypot(A[0] - V[0], A[1] - V[1]), lb = Math.hypot(B[0] - V[0], B[1] - V[1]);
    const p0 = [V[0] + ((A[0] - V[0]) / la) * rayon, V[1] + ((A[1] - V[1]) / la) * rayon];
    const p2 = [V[0] + ((B[0] - V[0]) / lb) * rayon, V[1] + ((B[1] - V[1]) / lb) * rayon];
    for (let k = 0; k <= 5; k++) {
      const u = k / 5, w = 1 - u;
      out.push([w * w * p0[0] + 2 * w * u * V[0] + u * u * p2[0], w * w * p0[1] + 2 * w * u * V[1] + u * u * p2[1]]);
    }
  }
  return out;
}

// ---------- Géométries ----------
function teinter(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}
const bloc = (w, h, d, x, y, z, hex) => teinter(new THREE.BoxGeometry(w, h, d).translate(x, y, z), hex);
function cylindre(rt, rb, h, x, y, z, hex, rx = 0, rz = 0, seg = 14) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  if (rx) g.rotateX(rx);
  if (rz) g.rotateZ(rz);
  return teinter(g.translate(x, y, z), hex);
}
const sphere = (r, x, y, z, hex, sx = 1, sy = 1, sz = 1) => teinter(new THREE.SphereGeometry(r, 12, 9).scale(sx, sy, sz).translate(x, y, z), hex);
const fusion = (liste) => mergeGeometries(liste.map((g) => (g.index ? g.toNonIndexed() : g)));

function geometries() {
  // ----- Glaneur : repère local, sol en y = 0, avant = −z -----
  const corps = fusion([
    bloc(0.4, 0.36, 0.4, 0, 0.31, 0, 0x9a90e8), // caisse
    bloc(0.44, 0.04, 0.44, 0, 0.15, 0, 0x2a2050), // jupe
    bloc(0.415, 0.03, 0.415, 0, 0.455, 0, 0xd4caff), // ceinture
    bloc(0.26, 0.13, 0.02, 0, 0.34, -0.205, 0x120c24), // plaque de visage
    cylindre(0.062, 0.062, 0.02, 0, 0.34, -0.212, 0x4a3c80, Math.PI / 2), // lunette de la diode
    bloc(0.012, 0.2, 0.28, 0.203, 0.31, 0.01, 0xc0b4ff), // flancs
    bloc(0.012, 0.2, 0.28, -0.203, 0.31, 0.01, 0xc0b4ff),
    bloc(0.32, 0.05, 0.05, 0, 0.17, -0.215, 0xe8e0ff), // pare-chocs
    bloc(0.16, 0.1, 0.02, 0, 0.28, 0.205, 0x4a3c80), // aération arrière
    cylindre(0.008, 0.008, 0.34, 0.15, 0.66, 0.17, 0xe8e0ff, 0, 0, 6), // antenne
  ]);
  const lum = fusion([
    bloc(0.012, 0.3, 0.012, 0.198, 0.31, -0.198, 0x6f8cff), // liserés verticaux
    bloc(0.012, 0.3, 0.012, -0.198, 0.31, -0.198, 0x6f8cff),
    bloc(0.41, 0.012, 0.41, 0, 0.125, 0, 0xc44bff), // lueur sous châssis
    sphere(0.024, 0.15, 0.835, 0.17, 0xff5ad0), // pointe d'antenne
    bloc(0.012, 0.012, 0.012, 0.207, 0.42, -0.08, 0xff2bd6), // témoins de flanc
    bloc(0.012, 0.012, 0.012, 0.207, 0.42, 0.0, 0x6f8cff),
    bloc(0.012, 0.012, 0.012, 0.207, 0.42, 0.08, 0xc44bff),
    bloc(0.012, 0.012, 0.012, -0.207, 0.42, -0.08, 0x6f8cff),
    bloc(0.012, 0.012, 0.012, -0.207, 0.42, 0.0, 0xff2bd6),
    bloc(0.012, 0.012, 0.012, -0.207, 0.42, 0.08, 0x6f8cff),
  ]);
  const couvercle = fusion([
    bloc(0.38, 0.035, 0.38, 0, 0.0175, -0.19, 0xd4caff),
    bloc(0.2, 0.006, 0.02, 0, 0.037, -0.12, 0x3a2e70),
    bloc(0.2, 0.006, 0.02, 0, 0.037, -0.19, 0x3a2e70),
    bloc(0.2, 0.006, 0.02, 0, 0.037, -0.26, 0x3a2e70),
    bloc(0.12, 0.02, 0.03, 0, 0.04, -0.36, 0xb8a8ff), // poignée
  ]);
  const bras = teinter(new THREE.CylinderGeometry(0.016, 0.016, 1, 6).rotateX(Math.PI / 2).translate(0, 0, -0.5), 0xb8a8ff);
  const pince = fusion([
    bloc(0.05, 0.02, 0.03, 0, 0, -0.01, 0x7a64c8),
    bloc(0.01, 0.014, 0.05, 0.017, 0, -0.045, 0xe0d8ff),
    bloc(0.01, 0.014, 0.05, -0.017, 0, -0.045, 0xe0d8ff),
  ]);
  const roue = fusion([
    cylindre(0.075, 0.075, 0.06, 0, 0, 0, 0x261c46, 0, Math.PI / 2, 14),
    cylindre(0.038, 0.038, 0.072, 0, 0, 0, 0xa898f0, 0, Math.PI / 2, 10),
    bloc(0.074, 0.012, 0.13, 0, 0, 0, 0xb8a8ff), // rayon : montre la rotation
    bloc(0.074, 0.13, 0.012, 0, 0, 0, 0x3a2e66),
  ]);
  const oeil = new THREE.SphereGeometry(0.04, 12, 9).scale(1, 1, 0.55);
  const debris = new THREE.IcosahedronGeometry(0.04, 0).scale(1.2, 0.7, 0.9);

  // ----- Porteur : capsule de 1,4 m ; avant = −z -----
  const cps = new THREE.CapsuleGeometry(0.27, 0.78, 8, 22).translate(0, 0.76, 0);
  const pcorps = fusion([
    teinter(cps, 0xb4a8f0),
    cylindre(0.278, 0.278, 0.05, 0, 0.45, 0, 0x4a3a90, 0, 0, 24), // ceinture basse
    cylindre(0.2, 0.22, 0.045, 0, 1.425, 0, 0x5a4aa0, 0, 0, 20), // collerette (siège de la boîte)
    bloc(0.2, 0.34, 0.035, 0, 0.84, 0.262, 0x5a4a9a), // panneau dorsal
    cylindre(0.05, 0.05, 0.05, 0.285, 1.0, 0, 0xf0e8ff, 0, Math.PI / 2, 10), // capteurs de flanc
    cylindre(0.05, 0.05, 0.05, -0.285, 1.0, 0, 0xf0e8ff, 0, Math.PI / 2, 10),
    cylindre(0.011, 0.011, 0.85, -0.16, 1.43, 0.17, 0xe8e0ff, 0, 0, 6), // mât
  ]);
  const bande = teinter(new THREE.CylinderGeometry(0.2745, 0.2745, 0.075, 28, 1, true).translate(0, 0.96, 0), 0xffffff);
  const visiere = teinter(new THREE.SphereGeometry(0.276, 22, 2, (3 * Math.PI) / 2 - 0.95, 1.9, 1.2, 0.2).translate(0, 1.15, 0), 0xffb8f0);
  const pied = fusion([
    bloc(0.15, 0.07, 0.25, 0, 0.0, 0, 0x2a2050),
    bloc(0.15, 0.012, 0.25, 0, -0.034, 0, 0x6a58b4),
  ]);
  const boite = fusion([
    bloc(0.44, 0.28, 0.38, 0, 0, 0, 0xffffff),
    bloc(0.46, 0.04, 0.1, 0, 0.0, 0, 0x777777), // sangle
    bloc(0.1, 0.03, 0.2, 0, 0.15, 0, 0xb0b0b0), // poignée
  ]);
  const temoin = fusion([
    bloc(0.46, 0.014, 0.014, 0, 0.1, -0.193, 0xffffff),
    sphere(0.022, 0.17, 0.14, -0.2, 0xffffff),
  ]);
  const helice = fusion([
    bloc(0.2, 0.01, 0.014, 0, 0, 0, 0x9a86e8),
    bloc(0.014, 0.01, 0.2, 0, 0, 0, 0x9a86e8),
    sphere(0.022, 0.1, 0, 0, 0xff5ad0),
    sphere(0.022, -0.1, 0, 0, 0x6f8cff),
    sphere(0.018, 0, 0, 0.1, 0xc44bff),
    sphere(0.018, 0, 0, -0.1, 0xc44bff),
  ]);
  return { corps, lum, couvercle, bras, pince, roue, oeil, debris, pcorps, bande, visiere, pied, boite, temoin, helice };
}

function textureBande() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 16;
  const g = c.getContext('2d');
  g.fillStyle = '#12091f';
  g.fillRect(0, 0, 256, 16);
  const cols = ['#ff2bd6', '#c44bff', '#3d6bff', '#ff5ad0'];
  for (let i = 0; i < 16; i++) {
    g.fillStyle = cols[i % 4];
    g.fillRect(i * 16 + 2, 3, i % 3 === 2 ? 4 : 10, 10);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function textureHalo() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const d = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  d.addColorStop(0, 'rgba(255,255,255,0.9)');
  d.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  d.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = d;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- Parc : les maillages instanciés d'une zone ----------
const parcs = new Map(); // nom de zone → parc

function creerParc(nom, scene) {
  const G = geometries();
  const groupe = new THREE.Group();
  groupe.name = 'robots';
  scene.add(groupe);
  const mCorps = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.5, emissive: 0x2a1a5a, emissiveIntensity: 0.55 });
  mCorps.color.setScalar(1.7); // les carrosseries claires se détachent des habitants (silhouettes sombres) et du décor violet
  const mBasic = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const mOeil = new THREE.MeshBasicMaterial({ toneMapped: false });
  const mBoite = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.3, emissive: 0x1a1030, emissiveIntensity: 0.5 });
  mBoite.color.setScalar(1.5);
  const mBande = new THREE.MeshBasicMaterial({ map: textureBande(), toneMapped: false });
  const mDebris = new THREE.MeshBasicMaterial({ toneMapped: false });
  const mPlot = new THREE.MeshBasicMaterial({ color: 0x8a5cff, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false });
  const mk = (geo, mat, cap, couleur = false) => {
    const m = new THREE.InstancedMesh(geo, mat, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    m.count = 0;
    if (couleur) { m.setColorAt(0, new THREE.Color(1, 1, 1)); m.instanceColor.setUsage(THREE.DynamicDrawUsage); }
    groupe.add(m);
    return m;
  };
  const plot = new THREE.RingGeometry(0.34, 0.5, 20).rotateX(-Math.PI / 2);
  const mHalo = new THREE.MeshBasicMaterial({ map: textureHalo(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const halo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const parc = {
    nom, groupe,
    corps: mk(G.corps, mCorps, CAPACITE), lum: mk(G.lum, mBasic, CAPACITE, true), couv: mk(G.couvercle, mCorps, CAPACITE),
    bras: mk(G.bras, mCorps, CAPACITE), pince: mk(G.pince, mCorps, CAPACITE), roues: mk(G.roue, mCorps, CAPACITE * 3),
    oeil: mk(G.oeil, mOeil, CAPACITE, true), debris: mk(G.debris, mDebris, CAPACITE * 3, true),
    pcorps: mk(G.pcorps, mCorps, CAPACITE), bande: mk(G.bande, mBande, CAPACITE), visiere: mk(G.visiere, mOeil, CAPACITE, true),
    pieds: mk(G.pied, mCorps, CAPACITE * 2), boite: mk(G.boite, mBoite, CAPACITE, true), temoin: mk(G.temoin, mBasic, CAPACITE, true),
    helice: mk(G.helice, mBasic, CAPACITE), plots: mk(plot, mPlot, CAPACITE), halo: mk(halo, mHalo, CAPACITE * 2, true),
    sites: [], plotsListe: [],
  };
  parcs.set(nom, parc);
  return parc;
}

// ---------- Son : un contexte audio propre, spatialisé (effects.js n'expose pas le sien) ----------
const son = { ctx: null, master: null, voix: [], nb: 0, echec: false };

function posPanner(p, x, y, z) {
  if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z);
}
function initSon() {
  if (son.ctx) return true;
  if (son.echec || !jeu.audio?.demarre) return false;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { son.echec = true; return false; }
    const ctx = new AC();
    const master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    son.ctx = ctx; son.master = master;
    for (let i = 0; i < NB_VOIX; i++) {
      const osc = ctx.createOscillator(), filtre = ctx.createBiquadFilter(), gain = ctx.createGain();
      const pan = ctx.createPanner();
      pan.panningModel = 'equalpower'; pan.distanceModel = 'inverse'; pan.refDistance = 1.5; pan.rolloffFactor = 1.5; pan.maxDistance = 40;
      osc.type = 'triangle'; osc.frequency.value = 120; filtre.type = 'lowpass'; filtre.frequency.value = 600; gain.gain.value = 0;
      osc.connect(filtre).connect(gain).connect(pan).connect(master);
      osc.start();
      son.voix.push({ osc, filtre, gain, pan, r: null });
    }
    ctx.resume?.().catch(() => {});
  } catch (e) {
    son.echec = true;
    return false;
  }
  return true;
}
// Notes : [[fréquence, durée, gain?], …] jouées depuis la position de la machine.
function jouer(r, notes, { type = 'sine', vol = 0.05 } = {}) {
  if (!son.ctx || son.nb >= 8 || jeu.audio?.coupe) return;
  const cam = jeu.camera.position;
  if (Math.hypot(r.x - cam.x, r.z - cam.z) > 26) return;
  const ctx = son.ctx, t0 = ctx.currentTime + 0.01;
  const osc = ctx.createOscillator(), g = ctx.createGain(), pan = ctx.createPanner();
  pan.panningModel = 'equalpower'; pan.distanceModel = 'inverse'; pan.refDistance = 1.2; pan.rolloffFactor = 1.6; pan.maxDistance = 40;
  posPanner(pan, r.x, r.y + 0.4, r.z);
  osc.type = type;
  osc.connect(g).connect(pan).connect(son.master);
  g.gain.setValueAtTime(0.0001, t0);
  let t = t0;
  for (const [f, dur, gl = 1] of notes) {
    osc.frequency.setValueAtTime(f, t);
    g.gain.linearRampToValueAtTime(vol * gl, t + 0.012);
    g.gain.setValueAtTime(vol * gl, t + dur * 0.65);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    t += dur + 0.025;
  }
  osc.start(t0);
  osc.stop(t + 0.05);
  son.nb++;
  osc.onended = () => { son.nb--; try { pan.disconnect(); } catch (e) { /* déjà détaché */ } };
}
const BIPS = {
  politesse: [[[880, 0.07], [1175, 0.09]], { type: 'triangle', vol: 0.05 }],
  impatience: [[[1480, 0.07], [1480, 0.07], [1480, 0.07]], { type: 'square', vol: 0.022 }],
  detresse: [[[920, 0.16], [560, 0.2, 0.9]], { type: 'sawtooth', vol: 0.02 }],
  merci: [[[660, 0.08], [880, 0.08], [1320, 0.14]], { type: 'triangle', vol: 0.05 }],
  ramasse: [[[330, 0.035, 1], [250, 0.05, 0.8]], { type: 'square', vol: 0.02 }],
  fini: [[[1046, 0.06], [1568, 0.1]], { type: 'sine', vol: 0.045 }],
  porteur: [[[520, 0.12], [390, 0.16]], { type: 'triangle', vol: 0.045 }],
  chute: [[[150, 0.22, 1.6], [70, 0.2, 1.2]], { type: 'sine', vol: 0.1 }],
  pas: [[[95, 0.07]], { type: 'triangle', vol: 0.035 }],
};
function bip(r, nom) { const b = BIPS[nom]; if (b) jouer(r, b[0], b[1]); }

const _fwd = new THREE.Vector3();
function majSon(cam, actives) {
  if (!initSon()) return;
  const ctx = son.ctx, L = ctx.listener;
  son.master.gain.value = jeu.audio?.coupe || !jeu.enPartie ? 0 : 0.9;
  jeu.camera.getWorldDirection(_fwd);
  if (L.positionX) {
    L.positionX.value = cam.x; L.positionY.value = cam.y; L.positionZ.value = cam.z;
    L.forwardX.value = _fwd.x; L.forwardY.value = _fwd.y; L.forwardZ.value = _fwd.z;
    L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
  } else { L.setPosition(cam.x, cam.y, cam.z); L.setOrientation(_fwd.x, _fwd.y, _fwd.z, 0, 1, 0); }
  // les NB_VOIX machines les plus proches ont une voix continue
  const proches = actives.filter((r) => r.d2 < DIST_SON * DIST_SON).sort((a, b) => a.d2 - b.d2).slice(0, NB_VOIX);
  const now = ctx.currentTime;
  son.voix.forEach((v, i) => {
    const r = proches[i];
    if (!r) { v.gain.gain.setTargetAtTime(0, now, 0.15); v.r = null; return; }
    v.r = r;
    posPanner(v.pan, r.x, r.y + 0.4, r.z);
    const bouge = clamp(Math.abs(r.v) / 1.2, 0, 1);
    const detresse = r.mode === 'renverse' || r.mode === 'bascule' ? 1 : 0;
    if (r.type === 'glaneur') {
      v.osc.type = detresse ? 'sawtooth' : 'triangle';
      v.osc.frequency.setTargetAtTime(detresse ? 340 + 140 * Math.sin(r.age * 9) : 170 + 130 * bouge, now, 0.08);
      v.filtre.frequency.setTargetAtTime(detresse ? 900 : 520, now, 0.1);
      v.gain.gain.setTargetAtTime(detresse ? 0.012 : 0.004 + 0.012 * bouge, now, 0.12);
    } else {
      v.osc.type = 'triangle';
      v.osc.frequency.setTargetAtTime(88 + 14 * bouge, now, 0.12);
      v.filtre.frequency.setTargetAtTime(320, now, 0.1);
      v.gain.gain.setTargetAtTime(0.008 + 0.014 * bouge, now, 0.15);
    }
  });
}

// ---------- Machines ----------
const toutes = [];
const eveilles = []; // machines de la zone courante, pour le son
let compteurId = 0;

const DEF = {
  glaneur: {
    dStop: 2.3, dMin: 0.8, clair: 0.85, ecart: 1.2, attente: 1.0, acc: 1.8, frein: 3.2, vLat: 0.8, vLent: 0.45,
    tImpatient: 4, tSignal: 8, tDemiTour: 11, lb: 0.35, hEtiq: 0.55, kYaw: 7,
  },
  porteur: {
    dStop: 3.0, dMin: 1.0, clair: 1.0, ecart: 1.45, attente: 0.7, acc: 1.4, frein: 2.6, vLat: 0.9, vLent: 0.7,
    tImpatient: 5, tSignal: 8, tDemiTour: 12, lb: 0.8, hEtiq: 1.95, kYaw: 4,
  },
};

function creerRobot(type, path, { s = 0, dir = 1, vitesse, zone = 'kasumi', id } = {}) {
  const D = DEF[type];
  const rnd = graine(1000 + compteurId * 77);
  const r = {
    id: id ?? String(1 + ((compteurId * 53 + 17) % 400)).padStart(4, '0'),
    type, zone, def: D, path, s, dir, l: D.lb, lT: D.lb, lb: D.lb,
    v: 0, vCroi: vitesse ?? (type === 'glaneur' ? 0.85 + rnd() * 0.45 : 1.0 + rnd() * 0.4),
    x: 0, y: 0, z: 0, yaw: 0, mode: 'marche', sous: 'libre', tMode: 0, age: rnd() * 50,
    attente: 0, obstrue: 0, contour: 0, salue: false, impatient: false, signale: false, flash: 0,
    d2: 1e9, phi: 0, pitch: 0, roulis: 0, hop: 0, vPrev: 0, yawPrev: 0,
    roue: 0, pas: rnd() * 6, lid: 0, clign: 1, regard: 0, regardT: 0, bras: new THREE.Vector3(0, 0.25, -0.13), brasOn: false, pinceQ: new THREE.Quaternion(),
    tScan: 3 + rnd() * 6, tTache: 0, tache: null, rock: 0, spin: 0,
    boiteT: 0, boiteScale: 1, boiteTeinte: Math.floor(rnd() * 5), inclin: 0, dTip: { x: 0, z: -1 },
    tPasSon: 0, tDetresse: 0, tFinSon: 0,
    caractere: {
      complaisance: +(0.55 + rnd() * 0.3).toFixed(2), hostilite: +(rnd() * 0.05).toFixed(2),
      fabulation: +(rnd() * 0.1).toFixed(2), detresse: type === 'porteur' && compteurId % 4 === 3 ? +(0.15 + rnd() * 0.2).toFixed(2) : 0, // vieux Porteurs (1 sur 4, par ordre de création : stable) ; lus par la Lecture
    },
    charge: CP.charges[Math.floor(rnd() * CP.charges.length)],
    destination: CP.destinations[Math.floor(rnd() * CP.destinations.length)],
    fonction: CG.fonctions[Math.floor(rnd() * CG.fonctions.length)],
    delaiRedressement: undefined, etiq: null, sigEtiq: '', interact: null,
  };
  compteurId++;
  placerSurTrajet(r);
  r.y = r.cibleY;
  r.yaw = Math.atan2(-E.tx * dir, -E.tz * dir);
  return r;
}

function placerSurTrajet(r) {
  const P = echantillon(r.path, r.s);
  const tx = P.tx * r.dir, tz = P.tz * r.dir;
  r.x = P.x - tz * r.l;
  r.z = P.z + tx * r.l;
  r.cibleY = P.y ?? (r.zone === 'kasumi' ? hauteurKasumi(r.x, r.z) : 0);
}

const TEINTES_BOITE = [0xb87cff, 0xff6ad8, 0x7a9cff, 0xa898f0, 0xff9ae0];
const _col = new THREE.Color();

// ---------- Sites de ramassage et stations de livraison ----------
function semerSites(path, n, rnd) {
  for (let i = 0; i < n; i++) {
    const s = (i + 0.2 + rnd() * 0.6) * (path.long / n);
    const P = echantillon(path, s);
    const lat = 0.35 + (rnd() - 0.5) * 1.0; // latéral par rapport à la ligne du trajet (normale « à droite » du sens des points)
    const x = P.x - P.tz * lat, z = P.z + P.tx * lat;
    path.sites.push({ s, x, z, y: P.y ?? (path.zone === 'kasumi' ? hauteurKasumi(x, z) : 0), actif: true, retour: 0, echelle: 1, couleur: Math.floor(rnd() * 4), rot: rnd() * TAU, parc: null, k: -1, porte: false, mx: x, my: 0, mz: z });
  }
}
function semerStations(path, n, rnd) {
  for (let i = 0; i < n; i++) {
    const s = (i + 0.5 + (rnd() - 0.5) * 0.4) * (path.long / n);
    const P = echantillon(path, s);
    path.stations.push({ s, x: P.x, z: P.z, y: P.y ?? (path.zone === 'kasumi' ? hauteurKasumi(P.x, P.z) : 0), parc: null, k: -1 });
  }
}
function attacherParc(path, parc) {
  for (const site of path.sites) if (!site.parc && parc.sites.length < CAPACITE * 3) { site.parc = parc; site.k = parc.sites.length; parc.sites.push(site); }
  for (const st of path.stations) if (!st.parc && parc.plotsListe.length < CAPACITE) { st.parc = parc; st.k = parc.plotsListe.length; parc.plotsListe.push(st); }
}

// ---------- Interaction (Glaneur) ----------
function creerInteraction(r) {
  r.interact = jeu.interact.ajouter({
    zone: r.zone,
    position: [r.x, r.y + 0.5, r.z],
    rayon: 3.0, // distance 3D depuis l'œil : la machine est à 1,3 m plus bas
    cone: 0.9,
    libelle: () => (r.mode === 'renverse' ? INV.redresser : INV.pousser),
    visible: () => r.mode === 'marche' || r.mode === 'tache' || r.mode === 'merci' || r.mode === 'renverse',
    action: () => (r.mode === 'renverse' ? robots.redresser(r, 'joueur') : robots.renverser(r, 'joueur')),
  });
}

// ---------- Calque ----------
function lignesDe(r) {
  if (r.type === 'glaneur') {
    const cle = r.mode === 'marche' ? ({ arret: 'arret', bloque: 'bloque', scan: 'scan', contourne: 'ronde', libre: 'ronde' }[r.sous] || 'ronde')
      : r.mode === 'tache' ? 'ramasse' : r.mode === 'bascule' ? 'bascule' : r.mode;
    return [remplir(CG.titre, { id: r.id }), remplir(CG.fonction, { fonction: r.fonction }), remplir(CG.tache, { tache: CG.taches[cle] || CG.taches.ronde }), CG.charte];
  }
  const cle = r.mode === 'tache' ? 'livre' : r.sous === 'arret' ? 'arret' : r.sous === 'bloque' ? 'bloque' : r.sous === 'contourne' ? 'ecarte' : 'trajet';
  return [remplir(CP.titre, { id: r.id }), remplir(CP.charge, { charge: r.charge }), remplir(CP.destination, { destination: r.destination }), remplir(CP.tache, { tache: CP.taches[cle] }), CP.charte];
}
function majEtiquette(r) {
  const proche = r.d2 < DIST_ETIQ * DIST_ETIQ && r.zone === jeu.zones.nom;
  if (proche) {
    if (!r.etiq) r.etiq = calque.etiqueter({ position: new THREE.Vector3(r.x, r.y + r.def.hEtiq, r.z), lignes: lignesDe(r), zone: r.zone, rayon: DIST_ETIQ });
    r.etiq.position.set(r.x, r.y + r.def.hEtiq + (r.mode === 'renverse' ? -0.2 : 0), r.z);
    const l = lignesDe(r), sig = l.join('|');
    if (sig !== r.sigEtiq) { r.sigEtiq = sig; r.etiq.lignes = l; r.etiq.maj(); }
  } else if (r.etiq && r.d2 > (DIST_ETIQ + 6) ** 2) {
    r.etiq.retirer();
    r.etiq = null;
    r.sigEtiq = '';
  }
}

// ---------- Comportement ----------
function choisirCote(r, lp) {
  const D = r.def, lim = r.path.lim;
  const a = lp + D.ecart, b = lp - D.ecart;
  const okA = a <= lim.d && a >= -lim.g, okB = b <= lim.d && b >= -lim.g;
  let c = 0;
  if (okA && okB) c = Math.abs(a - r.l) <= Math.abs(b - r.l) ? 1 : -1;
  else if (okA) c = 1;
  else if (okB) c = -1;
  if (c) r.lT = c > 0 ? a : b;
  return c;
}

function demiTour(r) {
  r.dir *= -1;
  r.l = -r.l; r.lT = r.lb; r.contour = 0; r.obstrue = 0; r.attente = 0; r.impatient = false; r.signale = false; r.salue = false;
  r.v = 0;
}

function majMarche(r, dt, cam) {
  const D = r.def, path = r.path;
  const P = echantillon(path, r.s);
  const tx = P.tx * r.dir, tz = P.tz * r.dir, nx = -tz, nz = tx;
  const px = P.x + nx * r.l, pz = P.z + nz * r.l;
  const rx = cam.x - px, rz = cam.z - pz;
  const f = rx * tx + rz * tz, q = rx * nx + rz * nz, dist = Math.hypot(rx, rz);
  const feet = cam.y - 1.75;
  const joueur = jeu.enPartie && !(feet > r.y + (r.type === 'porteur' ? 1.5 : 0.7));
  const lp = r.l + q;
  let vT = r.vCroi;
  let regarde = false;

  let devant = joueur && f > -0.25 && f < D.dStop && Math.abs(q) < D.clair;
  const collision = joueur && dist < D.dMin;
  if (collision) devant = true;

  if (r.sous === 'scan') {
    vT = 0;
    r.tMode -= dt;
    if (r.tMode <= 0) { r.sous = 'libre'; r.tScan = 5 + Math.random() * 6; }
  }
  if (devant) {
    r.obstrue += dt;
    if (r.contour === 0) {
      r.sous = 'arret'; vT = 0; regarde = true;
      if (!r.salue) { r.salue = true; bip(r, r.type === 'glaneur' ? 'politesse' : 'porteur'); }
      r.attente += dt;
      if (r.attente > D.attente) {
        if (choisirCote(r, lp)) { r.contour = Math.sign(r.lT - lp) || 1; r.sous = 'contourne'; } else r.sous = 'bloque';
      }
    } else {
      r.sous = 'contourne';
      vT = Math.abs(r.l - r.lT) > 0.12 ? D.vLent : r.vCroi * 0.7;
      if (collision) vT = 0;
      if (Math.abs(lp - r.lT) < D.ecart - 0.3) { r.contour = 0; r.attente = D.attente * 0.5; }
    }
  } else if (r.contour !== 0) {
    r.sous = 'contourne';
    vT = Math.min(vT, D.vLent + 0.35);
    if (f < -1.0 || dist > 7) { r.contour = 0; r.lT = r.lb; r.attente = 0; r.salue = false; }
  } else {
    r.attente = 0; r.salue = false;
    if (r.sous !== 'scan') r.sous = 'libre';
    r.obstrue = Math.max(0, r.obstrue - dt * 0.7);
    if (r.obstrue <= 0) { r.impatient = false; r.signale = false; }
  }

  // voie barrée longtemps
  if (r.obstrue > D.tImpatient && !r.impatient) { r.impatient = true; r.flash = 1.4; bip(r, r.type === 'glaneur' ? 'impatience' : 'porteur'); }
  if (r.obstrue > D.tSignal && !r.signale) { r.signale = true; jeu.emettre('robot:bloque', { robot: r, duree: r.obstrue }); }
  if (r.obstrue > D.tDemiTour) { demiTour(r); vT = 0; }

  // tâches, seulement quand rien ne gêne
  if (r.sous === 'libre' && r.contour === 0) {
    if (r.type === 'glaneur') {
      r.tScan -= dt;
      for (const st of path.sites) {
        if (!st.actif) continue;
        let ds = (st.s - r.s) * r.dir;
        if (path.boucle) ds = ((ds % path.long) + path.long) % path.long;
        if (ds < 0 || ds > 1.6) continue;
        vT = Math.min(vT, 0.2 + ds * 0.35);
        if (ds < 0.5 && r.v < 0.45) { commencerRamassage(r, st); break; }
      }
      if (r.mode === 'marche' && r.tScan <= 0) { r.sous = 'scan'; r.tMode = 0.9 + Math.random() * 0.5; r.tScan = 99; }
    } else {
      for (const st of path.stations) {
        let ds = (st.s - r.s) * r.dir;
        if (path.boucle) ds = ((ds % path.long) + path.long) % path.long;
        if (ds < 0 || ds > 2.5) continue;
        vT = Math.min(vT, 0.25 + ds * 0.4);
        if (ds < 0.2 && r.v < 0.4) { commencerLivraison(r, st); break; }
      }
    }
  }
  // file indienne : ne pas entrer dans la machine de devant
  for (const o of path.robots) {
    if (o === r || o.dir !== r.dir || o.mode === 'renverse') continue;
    let ds = (o.s - r.s) * r.dir;
    if (path.boucle) ds = ((ds % path.long) + path.long) % path.long;
    if (ds > 0 && ds < 1.1 && Math.abs(o.l - r.l) < 0.7) vT = Math.min(vT, o.v * 0.8, Math.max(0, ds - 0.5));
  }
  if (r.mode === 'marche') avancer(r, dt, vT, regarde, cam, px, pz);
}

function avancer(r, dt, vT, regarde, cam) {
  const D = r.def, path = r.path;
  r.v += clamp(vT - r.v, -D.frein * dt, D.acc * dt);
  r.l += clamp(r.lT - r.l, -D.vLat * dt, D.vLat * dt);
  r.s += r.dir * r.v * dt;
  if (!path.boucle) {
    if (r.s > path.long) { r.s = path.long; r.dir = -1; r.l = -r.l; r.lT = -r.lT; r.v *= 0.3; }
    if (r.s < 0) { r.s = 0; r.dir = 1; r.l = -r.l; r.lT = -r.lT; r.v *= 0.3; }
  }
  const ox = r.x, oz = r.z;
  placerSurTrajet(r);
  const vx = (r.x - ox) / dt, vz = (r.z - oz) / dt;
  let cible = r.yaw;
  if (regarde && r.v < 0.15) cible = Math.atan2(-(cam.x - r.x), -(cam.z - r.z));
  else if (r.sous === 'scan') cible = r.yaw + Math.sin(r.age * 7) * 0.5;
  else if (Math.hypot(vx, vz) > 0.07) cible = Math.atan2(-vx, -vz);
  r.yaw += angDiff(cible, r.yaw) * (1 - Math.exp(-dt * D.kYaw));
}

function commencerRamassage(r, site) {
  r.mode = 'tache'; r.tMode = 0; r.tache = { site, type: 'ramasse' };
  site.porte = false;
  // cible au sol exprimée dans le repère de la machine
  const dx = site.x - r.x, dz = site.z - r.z;
  const fx = -Math.sin(r.yaw), fz = -Math.cos(r.yaw), rx = -fz, rz = fx;
  r.tache.lx = clamp(dx * rx + dz * rz, -0.6, 0.6);
  r.tache.lz = -clamp(dx * fx + dz * fz, 0.32, 0.85);
  bip(r, 'ramasse');
}
function commencerLivraison(r, st) {
  r.mode = 'tache'; r.tMode = 0; r.tache = { station: st, type: 'livre', yaw0: r.yaw, echange: false };
}

const T_RAMASSE = 3.1, T_LIVRE = 3.6;
const _tip = new THREE.Vector3();

function majTache(r, dt, cam) {
  r.tMode += dt;
  const t = r.tMode, k = r.tache;
  r.v += clamp(0 - r.v, -4 * dt, 4 * dt);
  r.clign = 1;
  if (k.type === 'ramasse') {
    const site = k.site, G = _tip.set(k.lx, 0.04 + (site.y - r.y), k.lz);
    const stow = r.bras.set(0, 0.25, -0.13);
    let ext = 0, tip = null, open = 0;
    const B = new THREE.Vector3(0, 0.66, -0.02);
    if (t < 0.4) { r.pitch = lerp(r.pitch, -0.1, 0.2); }
    else if (t < 1.1) { ext = lisse((t - 0.4) / 0.7); tip = stow.clone().lerp(G, ext); tip.y += Math.sin(ext * Math.PI) * 0.1; }
    else if (t < 1.35) { tip = G.clone(); ext = 1; if (t > 1.2) site.porte = true; }
    else if (t < 2.05) { const e = lisse((t - 1.35) / 0.7); tip = G.clone().lerp(B, e); tip.y += Math.sin(e * Math.PI) * 0.14; open = lisse((t - 1.6) / 0.3); site.porte = true; }
    else if (t < 2.4) { tip = B.clone(); open = 1; site.echelle = 1 - lisse((t - 2.05) / 0.3); if (t > 2.3) { site.porte = false; } }
    else if (t < 3.1) { const e = lisse((t - 2.4) / 0.6); tip = B.clone().lerp(stow, e); open = 1 - lisse((t - 2.4) / 0.4); site.echelle = 0; }
    r.brasOn = !!tip;
    if (tip) r.bras.copy(tip);
    r.lid = lerp(r.lid, open * 1.15, 1 - Math.exp(-dt * 14));
    r.pitch = lerp(r.pitch, t < 0.4 ? -0.08 : t > 2.4 ? 0.05 * Math.sin((t - 2.4) * 10) : -0.05, 1 - Math.exp(-dt * 10));
    if (site.porte) { /* le débris suit la pince (voir poser) */ }
    if (t > T_RAMASSE) {
      site.actif = false; site.retour = jeu.t + 35 + Math.random() * 40; site.porte = false; site.echelle = 0;
      r.mode = 'marche'; r.tache = null; r.brasOn = false; r.lid = 0; r.sous = 'libre';
      bip(r, 'fini');
    }
  } else {
    // livraison : pivote vers l'intérieur, se penche, échange la boîte
    const st = k.station, cote = r.path.cote;
    const yawC = k.yaw0 + cote * 1.15 * lisse(t / 0.6) * (t < T_LIVRE - 0.7 ? 1 : 1 - lisse((t - (T_LIVRE - 0.7)) / 0.6));
    r.yaw += angDiff(yawC, r.yaw) * (1 - Math.exp(-dt * 8));
    const pench = t > 0.6 && t < T_LIVRE - 0.8 ? lisse((t - 0.6) / 0.4) : 0;
    r.pitch = lerp(r.pitch, -0.3 * pench, 1 - Math.exp(-dt * 10));
    if (t > 1.0 && t < 2.6) {
      // la boîte sort, une autre monte
      const e = (t - 1.0) / 1.6;
      r.boiteScale = e < 0.45 ? 1 - lisse(e / 0.45) : lisse((e - 0.55) / 0.45);
      if (e > 0.5 && !k.echange) { k.echange = true; r.boiteTeinte = (r.boiteTeinte + 1 + Math.floor(Math.random() * 3)) % TEINTES_BOITE.length; r.charge = CP.charges[Math.floor(Math.random() * CP.charges.length)]; r.destination = CP.destinations[Math.floor(Math.random() * CP.destinations.length)]; bip(r, 'fini'); }
    } else r.boiteScale = t >= 2.6 ? 1 : r.boiteScale;
    r.regardT = 0;
    if (t > T_LIVRE) { r.mode = 'marche'; r.tache = null; r.boiteScale = 1; r.sous = 'libre'; r.pitch = 0; }
  }
}

// ---------- Renversement du Glaneur ----------
const T_BASCULE = 0.95, T_RELEVE = 1.7;
function renverser(r, par = 'joueur') {
  if (r.type !== 'glaneur' || !(r.mode === 'marche' || r.mode === 'tache' || r.mode === 'merci')) return false;
  if (r.tache?.site) { r.tache.site.porte = false; r.tache.site.echelle = 0; r.tache.site.actif = false; r.tache.site.retour = jeu.t + 20; }
  r.tache = null; r.brasOn = false; r.lid = 0;
  const cam = jeu.camera.position;
  let dx = r.x - cam.x, dz = r.z - cam.z;
  const n = Math.hypot(dx, dz);
  if (n < 0.01) { dx = -Math.sin(r.yaw); dz = -Math.cos(r.yaw); } else { dx /= n; dz /= n; }
  r.dTip = { x: dx, z: dz };
  r.mode = 'bascule'; r.tMode = 0; r.v = 0; r.sous = 'libre'; r.pitch = 0; r.roulis = 0; r.hop = 0;
  if (jeu.etat) {
    jeu.etat.transgressions.T3 = (jeu.etat.transgressions.T3 || 0) + 1;
    jeu.sauver?.();
  }
  bip(r, 'chute');
  jeu.emettre('robot:renverse', { robot: r, par, transgression: 'T3', attention: 5, compte: jeu.etat?.transgressions.T3 });
  // entrée unique de l'Attention : le compteur T3 est déjà incrémenté ci-dessus (une seule fois)
  jeu.emettre('transgression', { id: 'T3', source: 'robot', attention: 5 });
  return true;
}
function redresser(r, par = 'joueur') {
  if (r.type !== 'glaneur' || r.mode !== 'renverse') return false;
  r.mode = 'releve'; r.tMode = 0;
  if (par === 'joueur' && jeu.etat) {
    jeu.etat.soin = (jeu.etat.soin || 0) + 1;
    jeu.sauver?.();
  }
  jeu.emettre('robot:redresse', { robot: r, par, soin: jeu.etat?.soin });
  return true;
}

// φ (0 = debout, π = sur le dos) → matrice monde de bascule autour des arêtes du cube
const _Mt = new THREE.Matrix4(), _M1 = new THREE.Matrix4(), _M2 = new THREE.Matrix4(), _T = new THREE.Matrix4(), _R = new THREE.Matrix4(), _Ti = new THREE.Matrix4();
const _ax = new THREE.Vector3(), _p1 = new THREE.Vector3(), _p2 = new THREE.Vector3();
function rotAutour(out, p, axe, ang) {
  _T.makeTranslation(p.x, p.y, p.z);
  _R.makeRotationAxis(axe, ang);
  _Ti.makeTranslation(-p.x, -p.y, -p.z);
  return out.copy(_T).multiply(_R).multiply(_Ti);
}
function matriceBascule(r, phi) {
  const d = r.dTip;
  _ax.set(d.z, 0, -d.x);
  _p1.set(r.x + d.x * 0.22, r.y + 0.03, r.z + d.z * 0.22);
  if (phi <= Math.PI / 2) return rotAutour(_Mt, _p1, _ax, phi);
  rotAutour(_M1, _p1, _ax, Math.PI / 2);
  _p2.set(r.x + d.x * 0.2, r.y + 0.53, r.z + d.z * 0.2).applyMatrix4(_M1);
  rotAutour(_M2, _p2, _ax, phi - Math.PI / 2);
  return _Mt.copy(_M2).multiply(_M1);
}

function majEtatRenverse(r, dt, cam) {
  r.tMode += dt;
  const t = r.tMode;
  if (r.mode === 'bascule') {
    const u = clamp(t / T_BASCULE, 0, 1);
    // choc, puis petit rebond
    r.phi = u < 0.72 ? Math.PI * 0.97 * Math.pow(u / 0.72, 2.2) : Math.PI - 0.1 * Math.exp(-(u - 0.72) * 12) * Math.abs(Math.cos((u - 0.72) * 38));
    if (t > T_BASCULE) { r.mode = 'renverse'; r.tMode = 0; r.phi = Math.PI; bip(r, 'chute'); }
  } else if (r.mode === 'renverse') {
    r.phi = Math.PI;
    r.rock = Math.sin(r.age * 5.5) * 0.11 + Math.sin(r.age * 13.3) * 0.03;
    r.spin = r.age;
    r.tDetresse -= dt;
    if (r.tDetresse <= 0) { r.tDetresse = 1.6; if (r.d2 < 18 * 18) bip(r, 'detresse'); }
    const delai = r.delaiRedressement ?? robots.delaiRedressement;
    if (t > delai) redresser(r, 'seul');
  } else if (r.mode === 'releve') {
    const u = t / T_RELEVE;
    r.rock = Math.sin(r.age * 9) * 0.2 * (u < 0.3 ? u / 0.3 : 0);
    r.phi = u < 0.3 ? Math.PI : Math.PI * (1 - lisse((u - 0.3) / 0.55)) * 0.995;
    if (u >= 0.85) { r.phi = 0; r.pitch = -0.07 * Math.sin(((u - 0.85) / 0.15) * Math.PI * 2); }
    if (t > T_RELEVE) { r.mode = 'merci'; r.tMode = 0; r.phi = 0; r.rock = 0; r.pitch = -0.08; bip(r, 'merci'); }
  }
}
function majMerci(r, dt, cam) {
  r.tMode += dt;
  const t = r.tMode;
  const vers = Math.atan2(-(cam.x - r.x), -(cam.z - r.z));
  r.yaw += angDiff(vers + Math.sin(t * 16) * 0.35 * Math.max(0, 1 - t / 1.2), r.yaw) * (1 - Math.exp(-dt * 9));
  r.pitch = lerp(r.pitch, Math.sin(t * 14) * 0.05, 0.25);
  if (t > 1.3) { r.mode = 'marche'; r.sous = 'libre'; r.obstrue = 0; r.contour = 0; r.lT = r.lb; r.pitch = 0; }
}

// ---------- Mise à jour d'une machine ----------
function majRobot(r, dt, cam) {
  r.age += dt;
  r.flash = Math.max(0, r.flash - dt);
  if (r.mode === 'marche') majMarche(r, dt, cam);
  else if (r.mode === 'tache') majTache(r, dt, cam);
  else if (r.mode === 'merci') majMerci(r, dt, cam);
  else majEtatRenverse(r, dt, cam);

  // sol : monte et descend les bordures de trottoir par petits sauts
  const dy = r.cibleY - r.y;
  r.y += clamp(dy, -1.6 * dt, 1.6 * dt);
  r.hop = Math.min(0.09, Math.abs(r.cibleY - r.y) * 0.5);

  // dynamique de caisse : tangage au freinage, roulis dans les virages
  if (r.mode === 'marche') {
    const a = (r.v - r.vPrev) / Math.max(dt, 1e-4);
    const yawRate = angDiff(r.yaw, r.yawPrev) / Math.max(dt, 1e-4);
    const kt = 1 - Math.exp(-dt * 10);
    r.pitch = lerp(r.pitch, clamp(a * (r.type === 'glaneur' ? 0.045 : 0.03), -0.14, 0.1) - (r.type === 'porteur' ? 0.05 * (r.v / 1.3) : 0), kt);
    r.roulis = lerp(r.roulis, clamp(yawRate * 0.04, -0.12, 0.12), kt);
    if (r.type === 'glaneur') r.pitch += Math.sin(r.age * 43) * 0.004 * r.v;
  } else r.roulis = lerp(r.roulis, 0, 1 - Math.exp(-dt * 8));
  r.vPrev = r.v; r.yawPrev = r.yaw;

  if (r.type === 'glaneur') {
    r.roue += (r.mode === 'renverse' || r.mode === 'bascule' ? 9 * (0.7 + 0.3 * Math.sin(r.age * 3)) : r.mode === 'releve' ? 12 : (r.v / 0.075)) * dt;
    if (r.mode !== 'tache') r.lid = lerp(r.lid, 0, 1 - Math.exp(-dt * 12));
    if (r.mode !== 'tache') r.brasOn = r.mode === 'renverse' || r.mode === 'bascule';
    if (r.mode === 'renverse' || r.mode === 'bascule') { r.bras.set(Math.sin(r.age * 7) * 0.22, 0.28 + Math.cos(r.age * 5) * 0.12, -0.5); }
  } else {
    r.pas += (r.v / 0.55) * dt * Math.PI;
    // regard : la visière suit le joueur de près, balaie quand la machine attend
    const dx = cam.x - r.x, dz = cam.z - r.z;
    const proche = r.d2 < 9 * 9 && jeu.enPartie;
    let rel = 0;
    if (proche) rel = clamp(angDiff(Math.atan2(-dx, -dz), r.yaw), -1.1, 1.1);
    else if (r.sous === 'arret' || r.sous === 'bloque') rel = Math.sin(r.age * 1.7) * 0.9;
    else rel = Math.sin(r.age * 0.6 + r.pas * 0.1) * 0.25;
    r.regard = lerp(r.regard, rel, 1 - Math.exp(-dt * 5));
    // pas sonores
    if (r.v > 0.3 && r.d2 < 12 * 12) { r.tPasSon -= dt * r.v; if (r.tPasSon <= 0) { r.tPasSon = 0.55; bip(r, 'pas'); } }
  }
  if (r.interact) r.interact.position.set(r.x + (r.mode === 'renverse' ? r.dTip.x * 0.55 : 0), r.y + (r.mode === 'renverse' ? 0.3 : 0.5), r.z + (r.mode === 'renverse' ? r.dTip.z * 0.55 : 0));
}

// ---------- Dessin (instances) ----------
const _P = new THREE.Vector3(), _Q = new THREE.Quaternion(), _S = new THREE.Vector3(1, 1, 1), _Eu = new THREE.Euler();
const _L = new THREE.Matrix4(), _W = new THREE.Matrix4(), _Mr = new THREE.Matrix4(), _V = new THREE.Vector3(), _FWD = new THREE.Vector3(0, 0, -1), _D = new THREE.Vector3();
const _Y = new THREE.Vector3(0, 1, 0), _Q2 = new THREE.Quaternion();

function local(px, py, pz, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _P.set(px, py, pz);
  _Q.setFromEuler(_Eu.set(rx, ry, rz, 'XYZ'));
  _S.set(sx, sy, sz);
  return _L.compose(_P, _Q, _S);
}
function place(mesh, k, M, L) { _W.multiplyMatrices(M, L); mesh.setMatrixAt(k, _W); }

function racine(r, avecBascule) {
  _P.set(r.x, r.y + r.hop, r.z);
  _Q.setFromAxisAngle(_Y, r.yaw);
  _Q2.setFromEuler(_Eu.set(r.pitch, 0, r.roulis, 'XYZ'));
  _Q.multiply(_Q2);
  _S.set(1, 1, 1);
  _Mr.compose(_P, _Q, _S);
  if (avecBascule && (r.mode === 'bascule' || r.mode === 'renverse' || r.mode === 'releve')) {
    _Mr.premultiply(matriceBascule(r, r.phi ?? 0));
    if (r.rock) {
      const d = r.dTip;
      _ax.set(d.x, 0, d.z);
      _p1.set(r.x + d.x * 0.5, r.y, r.z + d.z * 0.5);
      rotAutour(_M2, _p1, _ax, r.rock);
      _Mr.premultiply(_M2);
    }
  }
  return _Mr;
}

function couleurOeil(r) {
  const t = r.age;
  if (r.mode === 'bascule' || r.mode === 'renverse') { const b = Math.sin(t * 22) > 0; return _col.setRGB(b ? 1.6 : 0.9, b ? 1.1 : 0.1, b ? 1.5 : 0.7); }
  if (r.mode === 'releve') return _col.setRGB(0.8, 1.0, 1.5);
  if (r.mode === 'merci') return _col.setRGB(0.7, 1.1, 1.8);
  if (r.flash > 0) { const b = Math.sin(t * 30) > 0; return _col.setRGB(b ? 1.8 : 0.4, b ? 0.4 : 0.1, b ? 1.6 : 0.3); }
  if (r.sous === 'arret' || r.sous === 'bloque') return _col.setRGB(0.5, 0.75, 2.0);
  if (r.sous === 'scan') { const p = 0.6 + 0.4 * Math.sin(t * 14); return _col.setRGB(1.2 * p, 0.9 * p, 1.8 * p); }
  if (r.mode === 'tache') return _col.setRGB(1.5, 1.2, 1.7);
  return _col.setRGB(1.7, 0.25, 1.35);
}

function poseGlaneur(P, r, k) {
  const M = racine(r, true);
  P.corps.setMatrixAt(k, M);
  const cl = r.mode === 'marche' || r.mode === 'tache' ? 0.8 + 0.2 * Math.sin(r.age * 4 + k) : 1;
  P.lum.setMatrixAt(k, M);
  P.lum.setColorAt(k, _col.setRGB(cl, cl, cl));
  place(P.couv, k, M, local(0, 0.49, 0.19, r.lid));
  const w = r.roue, inv = r.mode === 'renverse' || r.mode === 'bascule';
  place(P.roues, k * 3, M, local(0, 0.075, -0.17, w));
  place(P.roues, k * 3 + 1, M, local(0.22, 0.075, 0.12, inv ? -w * 1.2 : w));
  place(P.roues, k * 3 + 2, M, local(-0.22, 0.075, 0.12, inv ? w * 0.8 : w));
  place(P.oeil, k, M, local(0, 0.34, -0.222, 0, 0, 0, 1, r.sous === 'scan' ? 0.7 + 0.3 * Math.sin(r.age * 14) : 1, 1));
  P.oeil.setColorAt(k, couleurOeil(r));
  // bras
  if (r.brasOn) {
    _V.set(0, 0.25, -0.12);
    _D.copy(r.bras).sub(_V);
    const len = _D.length();
    if (len > 0.03) {
      _D.divideScalar(len);
      _Q2.setFromUnitVectors(_FWD, _D);
      _L.compose(_V, _Q2, _S.set(1, 1, len));
      place(P.bras, k, M, _L);
      _L.compose(r.bras, _Q2, _S.set(1, 1, 1));
      place(P.pince, k, M, _L);
    } else { place(P.bras, k, M, local(0, 0, 0, 0, 0, 0, 0, 0, 0)); place(P.pince, k, M, local(0, 0, 0, 0, 0, 0, 0, 0, 0)); }
    // débris tenu par la pince
    if (r.tache?.site?.porte) { _V.copy(r.bras).applyMatrix4(M); r.tache.site.mx = _V.x; r.tache.site.my = _V.y - 0.03; r.tache.site.mz = _V.z; }
  } else { place(P.bras, k, M, local(0, 0, 0, 0, 0, 0, 0, 0, 0)); place(P.pince, k, M, local(0, 0, 0, 0, 0, 0, 0, 0, 0)); }
}

function posePorteur(P, r, k, t) {
  const M = racine(r, false);
  const bal = r.v > 0.05 ? Math.sin(r.pas) : 0;
  const amp = clamp(r.v / 1.2, 0, 1);
  // balancement du corps entier autour de la base
  _Q2.setFromEuler(_Eu.set(0, 0, bal * 0.07 * amp, 'XYZ'));
  _P.set(0, Math.abs(bal) * 0.018 * amp, 0);
  _L.compose(_P, _Q2, _S.set(1, 1, 1));
  const B = _W.copy(M).multiply(_L).clone();
  P.pcorps.setMatrixAt(k, B);
  place(P.bande, k, B, local(0, 0, 0, 0, r.age * 1.4 + r.pas * 0.2));
  P.visiere.setMatrixAt(k, _W.copy(B).multiply(local(0, 0, 0, 0, r.regard)));
  P.visiere.setColorAt(k, r.flash > 0 ? _col.setRGB(2, 0.4, 1.4) : r.sous === 'arret' || r.sous === 'bloque' ? _col.setRGB(0.6, 0.8, 2.0) : r.mode === 'tache' ? _col.setRGB(1.6, 1.4, 1.8) : _col.setRGB(1.8, 0.5, 1.5));
  place(P.pieds, k * 2, M, local(-0.11, 0.045 + Math.max(0, Math.cos(r.pas)) * 0.05 * amp, Math.sin(r.pas) * 0.14 * amp));
  place(P.pieds, k * 2 + 1, M, local(0.11, 0.045 + Math.max(0, -Math.cos(r.pas)) * 0.05 * amp, -Math.sin(r.pas) * 0.14 * amp));
  // hélice du mât : tourne plus vite quand la machine « pense »
  const pense = r.mode === 'tache' || r.sous === 'arret' || r.sous === 'bloque' ? 5 : 1.4;
  r.helAng = (r.helAng || 0) + pense * 0.016;
  place(P.helice, k, B, local(-0.16, 1.87, 0.17, 0, r.helAng));
  // boîte, avec un léger retard sur le mouvement
  r.boiteT = lerp(r.boiteT, -bal * 0.04 * amp - r.pitch * 0.8, 0.15);
  const sc = Math.max(0.001, r.boiteScale);
  const decal = r.mode === 'tache' && r.tache?.type === 'livre' && r.boiteScale < 0.99 ? -0.12 : 0;
  const LB = local(0, 1.59 + (r.boiteScale < 0.99 ? 0.03 : 0), decal, r.boiteT, 0, 0, sc, sc, sc);
  place(P.boite, k, B, LB);
  P.boite.setColorAt(k, _col.setHex(TEINTES_BOITE[r.boiteTeinte]));
  place(P.temoin, k, B, LB);
  const livre = r.mode === 'tache';
  const bl = livre ? (Math.sin(r.age * 18) > 0 ? 2.0 : 0.3) : 0.7 + 0.5 * Math.sin(r.age * 3);
  P.temoin.setColorAt(k, _col.setRGB(bl * 1.0, bl * 0.35, bl * 1.0));
}

function dessiner(parc, cam, t) {
  let ng = 0, np = 0, nh = 0;
  for (const r of toutes) {
    if (r.zone !== parc.nom || r.d2 > DIST_AFF * DIST_AFF) continue;
    if (r.type === 'glaneur') { if (ng < CAPACITE) poseGlaneur(parc, r, ng++); }
    else if (np < CAPACITE) posePorteur(parc, r, np++, t);
    if (nh < CAPACITE * 2) {
      // flaque de lumière sous la machine : elle se lit de loin et s'accroche au bloom
      const gl = r.type === 'glaneur', e = gl ? 1.5 : 2.3;
      const dec = r.mode === 'renverse' || r.mode === 'bascule' || r.mode === 'releve' ? 0.4 * Math.sin(Math.min(1, (r.phi || 0) / Math.PI) * Math.PI / 2) : 0; // la machine couchée a glissé vers l'avant
      _P.set(r.x + r.dTip.x * dec, r.y + 0.025, r.z + r.dTip.z * dec); _Q.identity(); _S.set(e, 1, e);
      parc.halo.setMatrixAt(nh, _W.compose(_P, _Q, _S));
      const calme = r.sous === 'arret' || r.sous === 'bloque';
      if (r.mode === 'renverse' || r.mode === 'bascule') _col.setRGB(0.55 + 0.3 * Math.sin(r.age * 22), 0.1, 0.4);
      else if (calme) _col.setRGB(0.12, 0.25, 0.7);
      else if (gl) _col.setRGB(0.5, 0.1, 0.4);
      else _col.setRGB(0.2, 0.14, 0.55);
      parc.halo.setColorAt(nh, _col);
      nh++;
    }
  }
  parc.halo.count = nh;
  parc.halo.instanceMatrix.needsUpdate = true;
  if (parc.halo.instanceColor) parc.halo.instanceColor.needsUpdate = true;
  parc.corps.count = parc.lum.count = parc.couv.count = parc.bras.count = parc.pince.count = parc.oeil.count = ng;
  parc.roues.count = ng * 3;
  parc.pcorps.count = parc.bande.count = parc.visiere.count = parc.boite.count = parc.temoin.count = parc.helice.count = np;
  parc.pieds.count = np * 2;
  for (const m of [parc.corps, parc.lum, parc.couv, parc.bras, parc.pince, parc.oeil, parc.roues, parc.pcorps, parc.bande, parc.visiere, parc.boite, parc.temoin, parc.helice, parc.pieds]) {
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }
  // débris
  const palette = [0xff5ad0, 0x6f8cff, 0xc44bff, 0xe0d8ff];
  parc.sites.forEach((s, i) => {
    if (!s.actif && !s.porte && s.retour && jeu.t > s.retour) { s.actif = true; s.echelle = 0; s.retour = 0; }
    if (s.actif && s.echelle < 1 && !s.porte) s.echelle = Math.min(1, s.echelle + 0.016 * 2);
    const x = s.porte ? s.mx : s.x, y = s.porte ? s.my : s.y + 0.02, z = s.porte ? s.mz : s.z;
    const e = s.actif || s.porte ? Math.max(0.001, s.echelle) : 0.0001;
    _P.set(x, y, z); _Q.setFromAxisAngle(_Y, s.rot); _S.set(e, e, e);
    parc.debris.setMatrixAt(i, _W.compose(_P, _Q, _S));
    parc.debris.setColorAt(i, _col.setHex(palette[s.couleur]));
  });
  parc.debris.count = parc.sites.length;
  parc.debris.instanceMatrix.needsUpdate = true;
  if (parc.debris.instanceColor) parc.debris.instanceColor.needsUpdate = true;
  // plots de livraison (statiques, mis à jour quand la liste change)
  if (parc.plots.count !== parc.plotsListe.length) {
    parc.plotsListe.forEach((st, i) => { _P.set(st.x, st.y + 0.04, st.z); _Q.identity(); _S.set(1, 1, 1); parc.plots.setMatrixAt(i, _W.compose(_P, _Q, _S)); });
    parc.plots.count = parc.plotsListe.length;
    parc.plots.instanceMatrix.needsUpdate = true;
  }
}

// ---------- Population de Kasumi ----------
function ajouterTrajet(type, pts, { sens = 1, lim, cote, tailleSites = 4, fraction = 0, vitesse, boucle = true, zone = 'kasumi', graineRng = 1 } = {}) {
  const path = creerTrajet(pts, boucle);
  path.zone = zone;
  if (lim) path.lim = lim;
  if (cote) path.cote = cote;
  const rnd = graine(graineRng);
  if (type === 'glaneur') semerSites(path, tailleSites, rnd);
  else semerStations(path, 2, rnd);
  const r = creerRobot(type, path, { s: fraction * path.long, vitesse, zone });
  path.robots.push(r);
  toutes.push(r);
  if (type === 'glaneur') creerInteraction(r);
  const parc = parcs.get(zone) ?? (jeu.zones.construites.includes(zone) ? creerParc(zone, jeu.zones.get(zone).scene) : null);
  if (parc) attacherParc(path, parc);
  return r;
}

// Vrai si aucun collider (étal, mobilier…) ne coupe le trajet à moins de `marge` mètres.
function trajetLibre(pts, colliders, marge) {
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.8));
    for (let k = 0; k < n; k++) {
      const x = a[0] + ((b[0] - a[0]) * k) / n, z = a[1] + ((b[1] - a[1]) * k) / n;
      for (const c of colliders) if ((c.maxY === undefined || c.maxY > 0.4) && (c.minY === undefined || c.minY < 1.2) && x > c.minX - marge && x < c.maxX + marge && z > c.minZ - marge && z < c.maxZ + marge) return false;
    }
  }
  return true;
}

let peuple = false;
function peuplerKasumi(zone) {
  if (peuple) return;
  peuple = true;
  const colliders = zone?.colliders || [];
  const R = graine(7741);
  const centre = (i) => (i - 4) * PITCH;
  const proches = [[4, 4], [5, 4], [4, 5], [5, 5]];
  const autres = [];
  for (let i = 2; i <= 6; i++) for (let j = 2; j <= 6; j++) if (!proches.some(([a, b]) => a === i && b === j)) autres.push([i, j]);
  for (let i = autres.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [autres[i], autres[j]] = [autres[j], autres[i]]; }

  let n = 1;
  // un trajet bloqué par un étal ou un meuble est abandonné : la machine n'y passerait pas à travers
  const glaneur = (bi, bj, sens, fraction) => {
    const lim = sens > 0 ? { g: 3.2, d: 1.0 } : { g: 1.0, d: 3.2 };
    const pts = anneau(centre(bi), centre(bj), 20.5, 20.5, sens);
    if (!trajetLibre(pts, colliders, 0.9)) return null;
    return ajouterTrajet('glaneur', pts, { sens, lim, fraction, graineRng: 100 + n++ });
  };
  const porteur = (cx, cz, hx, hz, sens, fraction) => {
    const lim = sens > 0 ? { g: 6, d: 5.5 } : { g: 5.5, d: 6 };
    const pts = anneau(cx, cz, hx, hz, sens, 3);
    if (!trajetLibre(pts, colliders, 1.0)) return null;
    return ajouterTrajet('porteur', pts, { sens, lim, fraction, cote: sens > 0 ? -1 : 1, graineRng: 500 + n++ });
  };
  // pâtés candidats : les quatre du carrefour de départ, puis le reste du voisinage (tirés au hasard), puis plus loin
  const loin = [];
  for (let i = 1; i <= 7; i++) for (let j = 1; j <= 7; j++) if (i < 2 || i > 6 || j < 2 || j > 6) loin.push([i, j]);
  const cands = [...proches, ...autres, ...loin];
  // 18 Glaneurs : deux (sens contraires) autour des pâtés du carrefour, un sur les autres
  let ng = 0;
  for (const [bi, bj] of cands) {
    if (ng >= 18) break;
    const sens = R() < 0.5 ? 1 : -1;
    if (glaneur(bi, bj, sens, R())) ng++;
    if (ng < 18 && proches.some(([a, b]) => a === bi && b === bj) && glaneur(bi, bj, -sens, R())) ng++;
  }
  // 12 Porteurs : sur la chaussée, autour d'un pâté ou de deux
  let np = 0;
  const essais = [
    () => porteur(centre(5), centre(5), 26, 26, 1, 0.1),
    () => porteur(centre(4), centre(4), 26, 26, -1, 0.6),
    () => porteur((centre(4) + centre(5)) / 2, centre(4), 26 + PITCH / 2, 26, 1, 0.3),
  ];
  for (const e of essais) if (e()) np++;
  for (let k = 0; np < 12 && k < cands.length; k++) {
    const [bi, bj] = cands[(k + 4) % cands.length];
    const ok = k % 3 === 0 && bi < 7
      ? porteur((centre(bi) + centre(bi + 1)) / 2, centre(bj), 26 + PITCH / 2, 26, R() < 0.5 ? 1 : -1, R())
      : porteur(centre(bi), centre(bj), 26, 26, R() < 0.5 ? 1 : -1, R());
    if (ok) np++;
  }
  // Marché des Mains : les étals couvrent les trottoirs et les colliders hauts du marché ferment tout trajet
  // de ronde qui les touche (trajetLibre) : les machines de la ville ne traversent donc jamais le marché.
  // Trois Glaneurs y font la ronde, mais par les allées (marche.allees : deux allées est-ouest entre les
  // rangées d'étals), en boucle autour des îlots.
  if (marche.allees?.length >= 2) {
    const [[a0, a1], [b0]] = marche.allees;
    const cx = (a0.x + a1.x) / 2, cz = (a0.z + b0.z) / 2, hx = Math.abs(a1.x - a0.x) / 2 - 1, hz = Math.abs(b0.z - a0.z) / 2;
    [[1, 0.05], [-1, 0.45], [1, 0.72]].forEach(([sens, f], k) => {
      const pts = anneau(cx, cz, hx, hz, sens, 1.6);
      if (trajetLibre(pts, colliders, 0.7)) ajouterTrajet('glaneur', pts, { sens, lim: { g: 1.3, d: 1.3 }, fraction: f, graineRng: 300 + k });
    });
  }
}

// ---------- Système ----------
export const robots = {
  nom: 'robots',
  delaiRedressement: 30,
  actif: true,
  /** Fin 5 (l'aube) : les machines s'arrêtent là où elles sont (elles restent dessinées). */
  fige: false,

  liste() { return toutes; },

  ajouter(type, { position, trajet, boucle = true, vitesse, zone = 'kasumi', largeur } = {}) {
    type = String(type).toLowerCase().startsWith('p') ? 'porteur' : 'glaneur';
    let pts = trajet;
    if (!pts || pts.length < 2) {
      const p = Array.isArray(position) ? (position.length >= 3 ? [position[0], position[2]] : position) : [position?.x ?? 0, position?.z ?? 0];
      pts = [[p[0] - 4, p[1]], [p[0] + 4, p[1]]];
      boucle = false;
    }
    const lim = largeur !== undefined ? { g: largeur, d: largeur } : type === 'porteur' ? { g: 3, d: 3 } : { g: 1.2, d: 1.2 };
    const r = ajouterTrajet(type, pts, { lim, boucle, vitesse, zone, fraction: 0, graineRng: 900 + compteurId });
    if (position) {
      const px = Array.isArray(position) ? position[0] : position.x, pz = Array.isArray(position) ? (position.length >= 3 ? position[2] : position[1]) : position.z;
      let best = 0, bd = 1e9;
      for (let s = 0; s <= r.path.long; s += 0.5) { echantillon(r.path, s); const d = Math.hypot(E.x - px, E.z - pz); if (d < bd) { bd = d; best = s; } }
      r.s = best; placerSurTrajet(r); r.y = r.cibleY;
    }
    return r;
  },

  retirer(r) {
    const i = toutes.indexOf(r);
    if (i >= 0) toutes.splice(i, 1);
    const j = r.path.robots.indexOf(r);
    if (j >= 0) r.path.robots.splice(j, 1);
    if (r.interact) jeu.interact.retirer(r.interact);
    r.etiq?.retirer();
  },

  renverser,
  redresser,

  /** État du son spatialisé (contexte audio propre à ce système). */
  get son() { return son.ctx ? { etat: son.ctx.state, voix: son.voix.filter((v) => v.r).length, ponctuels: son.nb } : null; },

  init() {
    jeu.robots = robots;
  },

  surZone(nom, zone) {
    if (nom === 'kasumi' && !parcs.has('kasumi')) creerParc('kasumi', zone.scene);
    const parc = parcs.get(nom);
    if (nom === 'kasumi') peuplerKasumi(zone);
    if (parc) for (const r of toutes) if (r.zone === nom) attacherParc(r.path, parc);
  },

  update(dt, t) {
    const nom = jeu.zones?.nom;
    if (!nom) return;
    dt = Math.min(dt, 0.1);
    const cam = jeu.camera.position;
    eveilles.length = 0;
    for (const r of toutes) {
      if (r.zone !== nom) { if (r.etiq) { r.etiq.retirer(); r.etiq = null; r.sigEtiq = ''; } continue; }
      const dx = r.x - cam.x, dz = r.z - cam.z;
      r.d2 = dx * dx + dz * dz;
      majRobot(r, this.fige ? 0 : dt, cam);
      majEtiquette(r);
      eveilles.push(r);
    }
    const parc = parcs.get(nom);
    for (const p of parcs.values()) p.groupe.visible = this.actif && p === parc;
    if (parc && this.actif) dessiner(parc, cam, t);
    majSon(cam, eveilles);
  },
};
