import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { jeu } from '../game.js';
import { rng, signTexture } from '../textures.js';
import { EYE, RAYON } from '../player.js';
import { TEXTES_TOITS, ENSEIGNES_TOITS } from '../data/toits.js';

// Système « toits » : les toits de Kasumi (bible §5.2, tâche 2.6).
//
// 1. HABILLAGE. Chaque toit accessible par un escalier de secours, et ceux qu'on voit de près depuis
//    eux, reçoit un décor déterministe (graine = position du toit) : revêtement, rebords (acrotères),
//    blocs techniques, conduits, réservoirs, antennes et câbles, linge, jardins hydroponiques,
//    cabanons, caisses, lucarnes, flaques, balises clignotantes. Tout est instancié : une quinzaine
//    d'appels de dessin au total, aucune lumière dynamique. Chaque objet solide a son collider 3D
//    (sommet praticable) dans `zone.colliders`.
// 2. PIÈCES NOMMÉES. Toit A (clinique, au-dessus du Marché) : la plantation de tabac d'Oba et son
//    séchoir. Toit du karaoké (カラオケ), au sud-est de A, atteignable seulement au Bond : enseignes,
//    enceintes, boule à facettes, et le papier du fragment 27.
// 3. POINTS D'ASSISE (`toits.pointsAssise`). Un rebord où « E — S'asseoir » installe le joueur face
//    à la ville. Choix technique : ni `jeu.suspendre` (il bloque `input` : plus de F, plus de E, et
//    `jeu.jouable` tombe à faux, donc la cigarette ne partirait plus) ni libération de la souris.
//    Le système garde la main sur le joueur : à chaque image il le replace (téléporteur) au point
//    voulu et pilote seulement la hauteur de vue (`player.decalageVue`). La souris reste prise, le
//    regard est libre, F fume normalement, E ou une touche de déplacement relève. Les sauts sont
//    neutralisés pendant l'assise, et la position sauvegardée est celle où l'on se relève.

const ZONE = 'kasumi';
const LEVRE = 0.3; // acrotère bas : praticable (≤ 0,35 m), on peut le franchir et tomber
const SURELEVATION = 0.02; // décor posé juste au-dessus du revêtement

const BANC = { largeur: 2.4, profondeur: 0.7, hauteur: 0.4 };
const ASSIS = { yeux: 0.72, entree: 1.35, sortie: 0.9, aide: 8, recul: 1.7 };

// Rayon (m) autour des toits d'escalier où l'on habille, et dénivelé accepté au-dessus d'eux.
const RAYON_HABILLAGE = 120;
const DENIVELE_HABILLAGE = 20;

const COULEURS = {
  structure: [0x4a3f72, 0x3f3566, 0x564a84, 0x373060],
  clair: [0x6a5e98, 0x5f5590, 0x7466a8],
  ocre: [0x5e4a78, 0x6b4a78, 0x55407a],
  levre: 0x4c4078,
  neon: [0xff2bd6, 0xc44bff, 0x4a7dff, 0x8a5cff, 0xff5ad0],
  linge: [0x7a5fb0, 0xb0549a, 0x4a66b8, 0xa89ad0, 0x8a4a9a, 0xc8b0e0],
  cuve: [0x4a5a8a, 0x5a4a82, 0x3a5a80],
  vert: [0x0f6a38, 0x147a42, 0x0c5c32, 0x1a8a4e],
  tabac: [0x2c6a10, 0x357a16, 0x24600c, 0x428420],
  sechage: [0x5a4a22, 0x4a3c1a, 0x66552a],
  pot: [0x7a4a68, 0x6a3f5a, 0x84506a],
};

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------
const choix = (rand, liste) => liste[Math.floor(rand() * liste.length)];
const entre = (rand, a, b) => a + rand() * (b - a);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lisse = (k) => { k = clamp(k, 0, 1); return k * k * k * (k * (k * 6 - 15) + 10); };
const lerp = (a, b, k) => a + (b - a) * k;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/** Lot d'instances : une géométrie, un matériau, des matrices et des couleurs. */
class Lot {
  constructor(geo, mat) {
    this.geo = geo;
    this.mat = mat;
    this.matrices = [];
    this.couleurs = [];
    this.mesh = null;
  }
  ajouter(x, y, z, sx, sy, sz, couleur = 0xffffff, ry = 0, rx = 0, rz = 0) {
    _e.set(rx, ry, rz, 'YXZ');
    _q.setFromEuler(_e);
    _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
    this.matrices.push(..._m.elements);
    this.couleurs.push(couleur);
    return this.matrices.length / 16 - 1;
  }
  get n() { return this.couleurs.length; }
  construire(parent) {
    if (!this.n) return null;
    const im = new THREE.InstancedMesh(this.geo, this.mat, this.n);
    for (let i = 0; i < this.n; i++) {
      _m.fromArray(this.matrices, i * 16);
      im.setMatrixAt(i, _m);
      im.setColorAt(i, _c.set(this.couleurs[i]));
    }
    im.instanceMatrix.needsUpdate = true;
    im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    parent.add(im);
    this.mesh = im;
    return im;
  }
}

// ---------------------------------------------------------------------------
// Ressources partagées (créées à la première construction)
// ---------------------------------------------------------------------------
let RES = null;
const tempsUniform = { value: 0 };

function texFlaque() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  // eau sombre, bord irrégulier
  const fond = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  fond.addColorStop(0, 'rgba(255,255,255,0.55)');
  fond.addColorStop(0.7, 'rgba(255,255,255,0.4)');
  fond.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = fond;
  g.fillRect(0, 0, 128, 128);
  // reflets d'enseignes : bandes verticales claires
  for (const [x, w, a] of [[40, 5, 0.9], [62, 9, 1], [82, 4, 0.7]]) {
    const l = g.createLinearGradient(0, 18, 0, 110);
    l.addColorStop(0, 'rgba(255,255,255,0)');
    l.addColorStop(0.3, `rgba(255,255,255,${a})`);
    l.addColorStop(0.7, `rgba(255,255,255,${a * 0.8})`);
    l.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = l;
    g.fillRect(x, 18, w, 92);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const POLICE = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans CJK JP", "Arial Black", Arial, sans-serif';

/** Enseigne horizontale du karaoké : micro néon, mot latin, kana. Distincte des enseignes génériques de la ville. */
function texEnseigneKaraoke({ latin, kana, couleur }) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(8, 3, 26, 0.92)';
  g.fillRect(0, 0, 1024, 256);
  g.shadowColor = couleur;
  g.shadowBlur = 26;
  g.strokeStyle = couleur;
  g.lineWidth = 9;
  g.strokeRect(16, 16, 992, 224);
  // micro : tête, étrier, pied
  g.save();
  g.translate(125, 120);
  g.lineWidth = 9;
  g.lineCap = 'round';
  g.beginPath(); g.ellipse(0, -30, 24, 36, 0, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(0, -22, 40, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
  g.beginPath(); g.moveTo(0, 18); g.lineTo(0, 62); g.moveTo(-24, 66); g.lineTo(24, 66); g.stroke();
  g.restore();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#ffffff';
  g.font = `900 122px ${POLICE}`;
  g.fillText(latin, 505, 128);
  g.fillText(latin, 505, 128);
  g.font = `900 78px ${POLICE}`;
  g.fillText(kana, 885, 130);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function texLueur() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)');
  gr.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function texRevetement() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const r = rng(555);
  g.fillStyle = '#2a2342';
  g.fillRect(0, 0, 256, 256);
  // grain
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(10,6,30,0.35)' : 'rgba(140,120,200,0.14)';
    g.fillRect(r() * 256, r() * 256, 1 + r() * 2, 1 + r() * 2);
  }
  // taches d'humidité
  for (let i = 0; i < 9; i++) {
    const x = r() * 256, y = r() * 256, rad = 20 + r() * 40;
    const gr = g.createRadialGradient(x, y, 2, x, y, rad);
    gr.addColorStop(0, 'rgba(8,4,24,0.45)');
    gr.addColorStop(1, 'rgba(8,4,24,0)');
    g.fillStyle = gr;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // joints de la membrane
  g.strokeStyle = 'rgba(12,8,34,0.8)';
  g.lineWidth = 3;
  g.strokeRect(1, 1, 254, 254);
  g.beginPath();
  g.moveTo(128, 0); g.lineTo(128, 256);
  g.stroke();
  g.strokeStyle = 'rgba(150,130,210,0.2)';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(4, 4); g.lineTo(252, 4);
  g.moveTo(130, 0); g.lineTo(130, 256);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function ressources() {
  if (RES) return RES;
  const cuvette = new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  const sol = new THREE.PlaneGeometry(1, 1);
  sol.rotateX(-Math.PI / 2);
  const tissu = new THREE.PlaneGeometry(1, 1);
  const cone = new THREE.CylinderGeometry(0.02, 1, 1, 10, 1);

  // le linge ondule : balancement en haut de la boîte vers le bas, phase selon la position
  const linge = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  linge.onBeforeCompile = (sh) => {
    sh.uniforms.uTemps = tempsUniform;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTemps;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float ph = instanceMatrix[3].x * 0.9 + instanceMatrix[3].z * 0.7;
        float bas = 1.0 - uv.y;
        transformed.z += sin(uTemps * 2.1 + ph) * 0.16 * bas + sin(uTemps * 4.7 + ph * 2.0) * 0.03 * bas;
        transformed.x += sin(uTemps * 1.3 + ph * 1.7) * 0.05 * bas;`
      );
  };

  RES = {
    geo: {
      boite: new THREE.BoxGeometry(1, 1, 1),
      cyl: new THREE.CylinderGeometry(1, 1, 1, 10, 1),
      cone,
      sphere: new THREE.SphereGeometry(1, 6, 4),
      feuille: new THREE.IcosahedronGeometry(1, 0),
      cuvette,
      sol,
      tissu,
    },
    mat: {
      metal: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.55 }),
      mat: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, metalness: 0.08 }),
      cuvette: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.55, side: THREE.DoubleSide }),
      lueur: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
      feuille: new THREE.MeshBasicMaterial({ color: 0xffffff }),
      linge,
      flaque: new THREE.MeshBasicMaterial({
        color: 0xffffff, map: texFlaque(), transparent: true, opacity: 0.5, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false,
      }),
      revetement: new THREE.MeshStandardMaterial({
        color: 0xffffff, map: texRevetement(), roughness: 1, metalness: 0, emissive: 0x241448,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      }),
      balise: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
      lueurMur: new THREE.MeshBasicMaterial({
        color: 0xffffff, map: texLueur(), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending,
        depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      }),
      cable: new THREE.LineBasicMaterial({ color: 0x8a78c0, transparent: true, opacity: 0.4 }),
    },
  };
  return RES;
}

// ---------------------------------------------------------------------------
// Contexte de construction (un seul à la fois)
// ---------------------------------------------------------------------------
let C = null; // { zone, colliders, lots…, balises, lignes, sols, bancs }

function nouveauContexte(zone) {
  const { geo, mat } = ressources();
  return {
    zone,
    colliders: zone.colliders,
    metal: new Lot(geo.boite, mat.metal),
    mate: new Lot(geo.boite, mat.mat),
    cylM: new Lot(geo.cyl, mat.metal),
    cylT: new Lot(geo.cyl, mat.mat),
    cone: new Lot(geo.cone, mat.metal),
    lueur: new Lot(geo.boite, mat.lueur),
    lueurCyl: new Lot(geo.cyl, mat.lueur),
    feuilles: new Lot(geo.feuille, mat.feuille),
    linge: new Lot(geo.tissu, mat.linge),
    flaques: new Lot(geo.sol, mat.flaque),
    paraboles: new Lot(geo.cuvette, mat.cuvette),
    balisesLot: new Lot(geo.sphere, mat.balise),
    lueursMur: new Lot(geo.tissu, mat.lueurMur),
    balises: [], // { index, periode, phase, couleur, double }
    lignes: [],
    sols: [],
    toits: [],
    reperes: [],
  };
}

/** Pousse un collider 3D. */
function coll(minX, maxX, minZ, maxZ, y0, y1) {
  C.colliders.push({ minX, maxX, minZ, maxZ, minY: y0, maxY: y1 });
}

/** Boîte posée sur le plan y0 (centre x, z) ; rotation 0 ou π/2 pour le collider. */
function boite(lot, x, y0, z, w, h, d, couleur, { ry = 0, collider = true } = {}) {
  lot.ajouter(x, y0 + h / 2, z, w, h, d, couleur, ry);
  if (collider) {
    const t = Math.abs(Math.sin(ry)) > 0.7;
    const hw = (t ? d : w) / 2, hd = (t ? w : d) / 2;
    coll(x - hw, x + hw, z - hd, z + hd, y0, y0 + h);
  }
}

/** Boîte donnée par un rectangle au sol. */
function boiteRect(lot, r, y0, h, couleur, collider = true) {
  lot.ajouter((r.minX + r.maxX) / 2, y0 + h / 2, (r.minZ + r.maxZ) / 2, r.maxX - r.minX, h, r.maxZ - r.minZ, couleur);
  if (collider) coll(r.minX, r.maxX, r.minZ, r.maxZ, y0, y0 + h);
}

function cylindre(lot, x, y0, z, r, h, couleur, collider = true) {
  lot.ajouter(x, y0 + h / 2, z, r, h, r, couleur);
  if (collider) coll(x - r, x + r, z - r, z + r, y0, y0 + h);
}

/** Mémorise un élément nommé (tests, captures) : { type, x, y, z, toit }. */
function repere(type, R, x, z) {
  C.reperes.push({ type, x: +x.toFixed(2), y: +R.h.toFixed(2), z: +z.toFixed(2), toit: R.nom });
}

function balise(x, y, z, { rayon = 0.1, couleur = 0xff2bd6, periode = 2.2, double = false } = {}) {
  const index = C.balisesLot.ajouter(x, y, z, rayon, rayon, rayon, 0xffffff);
  C.balises.push({ index, periode, phase: (x * 0.37 + z * 0.71) % 1, couleur, double });
}

/** Segment de câble avec affaissement (caténaire grossière). */
function cable(a, b, affaissement = 0.5, pas = 7) {
  let prev = a;
  for (let i = 1; i <= pas; i++) {
    const k = i / pas;
    const p = [lerp(a[0], b[0], k), lerp(a[1], b[1], k) - affaissement * 4 * k * (1 - k), lerp(a[2], b[2], k)];
    C.lignes.push(prev[0], prev[1], prev[2], p[0], p[1], p[2]);
    prev = p;
  }
}

// ---------------------------------------------------------------------------
// Toits : repérage, bords, rectangles
// ---------------------------------------------------------------------------
/** Rectangle (minX…) d'un tronçon [a, c] le long d'un bord, entre les profondeurs d0 et d1 vers l'intérieur. */
function rectBord(R, b, a, c, d0, d1) {
  switch (b) {
    case 'n': return { minX: a, maxX: c, minZ: R.z0 + d0, maxZ: R.z0 + d1 };
    case 's': return { minX: a, maxX: c, minZ: R.z1 - d1, maxZ: R.z1 - d0 };
    case 'w': return { minX: R.x0 + d0, maxX: R.x0 + d1, minZ: a, maxZ: c };
    default: return { minX: R.x1 - d1, maxX: R.x1 - d0, minZ: a, maxZ: c };
  }
}
const BORDS = {
  n: { nx: 0, nz: -1, long: (R) => [R.x0, R.x1], axe: 'x' },
  s: { nx: 0, nz: 1, long: (R) => [R.x0, R.x1], axe: 'x' },
  w: { nx: -1, nz: 0, long: (R) => [R.z0, R.z1], axe: 'z' },
  e: { nx: 1, nz: 0, long: (R) => [R.z0, R.z1], axe: 'z' },
};
/** Point à la profondeur d vers l'intérieur, à l'abscisse `u` le long du bord. */
function pointBord(R, b, u, d) {
  switch (b) {
    case 'n': return [u, R.z0 + d];
    case 's': return [u, R.z1 - d];
    case 'w': return [R.x0 + d, u];
    default: return [R.x1 - d, u];
  }
}
/** Tronçons [a, c] d'un intervalle une fois retirés les trous. */
function sansTrous(a, c, trous) {
  let segs = [[a, c]];
  for (const [t0, t1] of trous) {
    const suite = [];
    for (const [s0, s1] of segs) {
      if (t1 <= s0 || t0 >= s1) { suite.push([s0, s1]); continue; }
      if (t0 > s0) suite.push([s0, t0]);
      if (t1 < s1) suite.push([t1, s1]);
    }
    segs = suite;
  }
  return segs.filter(([s0, s1]) => s1 - s0 > 0.08);
}

function creerToit(def, immeubles) {
  const R = {
    nom: def.nom || null,
    x: def.x, z: def.z,
    x0: def.x - def.w / 2, x1: def.x + def.w / 2,
    z0: def.z - def.d / 2, z1: def.z + def.d / 2,
    h: def.h,
    etage: def.etage || null, // empreinte à ne pas encombrer { x0, x1, z0, z1 }
    reserves: [], // rectangles à laisser libres [x0, x1, z0, z1]
    trous: { n: [], s: [], w: [], e: [] }, // pas d'acrotère dans ces tronçons
    rails: [], // { bord, a, c }
    bancs: [],
    toitEtage: !!def.toitEtage,
    pasDeLevre: new Set(),
  };
  // bords adossés à un voisin de même hauteur ou plus haut : pas d'acrotère
  if (!R.toitEtage) {
    for (const o of immeubles) {
      if (Math.abs(o.x - def.x) < 0.01 && Math.abs(o.z - def.z) < 0.01) continue;
      if (o.h < def.h - 1.5) continue;
      const ox0 = o.x - o.w / 2, ox1 = o.x + o.w / 2, oz0 = o.z - o.d / 2, oz1 = o.z + o.d / 2;
      const ovX = Math.min(R.x1, ox1) - Math.max(R.x0, ox0);
      const ovZ = Math.min(R.z1, oz1) - Math.max(R.z0, oz0);
      if (Math.abs(oz1 - R.z0) < 0.05 && ovX > 1) R.pasDeLevre.add('n');
      if (Math.abs(oz0 - R.z1) < 0.05 && ovX > 1) R.pasDeLevre.add('s');
      if (Math.abs(ox1 - R.x0) < 0.05 && ovZ > 1) R.pasDeLevre.add('w');
      if (Math.abs(ox0 - R.x1) < 0.05 && ovZ > 1) R.pasDeLevre.add('e');
    }
  }
  return R;
}

/** Bord de R le plus proche du point (x, z) et abscisse du point le long de ce bord. */
function bordProche(R, x, z) {
  const cand = [['n', Math.abs(z - R.z0), x], ['s', Math.abs(z - R.z1), x], ['w', Math.abs(x - R.x0), z], ['e', Math.abs(x - R.x1), z]];
  cand.sort((a, b) => a[1] - b[1]);
  return { bord: cand[0][0], coord: cand[0][2] };
}

// ---------------------------------------------------------------------------
// Placement aléatoire sans recouvrement
// ---------------------------------------------------------------------------
function creerPlaceur(R, rand) {
  const occ = R.reserves.map((r) => [...r]);
  const dedans = (x0, x1, z0, z1, marge) => x0 >= R.x0 + marge && x1 <= R.x1 - marge && z0 >= R.z0 + marge && z1 <= R.z1 - marge;
  const libre = (x0, x1, z0, z1, gap) => {
    for (const [a0, a1, b0, b1] of occ) if (x1 + gap > a0 && x0 - gap < a1 && z1 + gap > b0 && z0 - gap < b1) return false;
    return true;
  };
  return {
    occ,
    libre,
    /** Cherche un emplacement de (w × d) ; renvoie { x, z } (centre) ou null. */
    placer(w, d, { gap = 1.45, marge = 1.5, essais = 60 } = {}) {
      for (let i = 0; i < essais; i++) {
        const x = entre(rand, R.x0 + marge + w / 2, R.x1 - marge - w / 2);
        const z = entre(rand, R.z0 + marge + d / 2, R.z1 - marge - d / 2);
        const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2;
        if (!dedans(x0, x1, z0, z1, marge) || !libre(x0, x1, z0, z1, gap)) continue;
        occ.push([x0, x1, z0, z1]);
        return { x, z };
      }
      return null;
    },
    /** Pose un emplacement précis (réserve sans test). */
    reserver(x0, x1, z0, z1) { occ.push([x0, x1, z0, z1]); },
  };
}

// ---------------------------------------------------------------------------
// Éléments de décor
// ---------------------------------------------------------------------------
function climatiseur(R, rand, x, z, ry = 0) {
  const y = R.h + SURELEVATION;
  const t = rand();
  const w = entre(rand, 1.6, 3.0), d = entre(rand, 1.2, 2.2), h = t < 0.3 ? entre(rand, 1.8, 2.6) : entre(rand, 0.9, 1.7);
  const coul = choix(rand, COULEURS.structure);
  boite(C.metal, x, y, z, w, h, d, coul, { ry });
  // socle plus sombre, ventilateur et voyant
  C.mate.ajouter(x, y + 0.08, z, w + 0.1, 0.16, d + 0.1, 0x1c1632, ry);
  const r = Math.min(w, d) * 0.34;
  cylindre(C.cylT, x, y + h, z, r, 0.07, 0x15102a, false);
  cylindre(C.cylM, x, y + h + 0.06, z, r * 0.22, 0.05, 0x8a7ab8, false);
  const sens = Math.abs(Math.sin(ry)) > 0.7;
  const fx = x + (sens ? 0 : w / 2 + 0.02), fz = z + (sens ? w / 2 + 0.02 : 0);
  C.lueur.ajouter(fx, y + h * 0.7, fz, sens ? 0.1 : 0.04, 0.08, sens ? 0.04 : 0.1, choix(rand, [0x4aa8ff, 0xff5ad0, 0x8a5cff]));
  // grille latérale : quelques lames
  for (let i = 0; i < 3; i++) C.mate.ajouter(x, y + h * (0.25 + i * 0.12), z - (sens ? 0 : d / 2 + 0.01), w * 0.7, 0.04, 0.03, 0x120c24, ry);
  return { w, d, h };
}

function reservoir(R, rand, x, z, r, h) {
  const y = R.h + SURELEVATION;
  const pied = 0.75;
  const col = choix(rand, COULEURS.cuve);
  for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    C.metal.ajouter(x + dx * r * 0.62, y + pied / 2, z + dz * r * 0.62, 0.12, pied, 0.12, 0x2d2750);
  }
  C.metal.ajouter(x, y + pied - 0.04, z, r * 1.5, 0.08, r * 1.5, 0x2d2750);
  C.cylM.ajouter(x, y + pied + h / 2, z, r, h, r, col);
  for (const k of [0.25, 0.7]) C.cylM.ajouter(x, y + pied + h * k, z, r + 0.03, 0.09, r + 0.03, 0x1c1736);
  C.cone.ajouter(x, y + pied + h + 0.3, z, r * 1.08, 0.6, r * 1.08, 0x2d2750);
  C.metal.ajouter(x + r * 0.95, y + (pied + h) / 2, z, 0.06, pied + h, 0.28, 0x2d2750); // échelle
  coll(x - r, x + r, z - r, z + r, y, y + pied + h + 0.5);
  repere('reservoir', R, x, z);
  return { r };
}

function antenne(R, rand, x, z, haut, { parabole = false, guyots = true } = {}) {
  const y = R.h + SURELEVATION;
  repere('antenne', R, x, z);
  const coul = choix(rand, COULEURS.clair);
  C.metal.ajouter(x, y + 0.2, z, 0.7, 0.4, 0.7, 0x2d2750); // plinth
  C.cylM.ajouter(x, y + haut / 2, z, 0.07, haut, 0.07, coul);
  coll(x - 0.3, x + 0.3, z - 0.3, z + 0.3, y, y + haut);
  const n = 2 + Math.floor(rand() * 3);
  for (let k = 0; k < n; k++) {
    const yy = y + haut * (0.5 + 0.1 * k + rand() * 0.04);
    const len = entre(rand, 0.9, 2.4) * (1 - k * 0.15);
    const ry = rand() * Math.PI;
    C.metal.ajouter(x, yy, z, len, 0.04, 0.04, coul, ry);
    C.metal.ajouter(x + Math.cos(ry) * len * 0.5, yy, z - Math.sin(ry) * len * 0.5, 0.04, 0.3, 0.04, coul);
    C.metal.ajouter(x - Math.cos(ry) * len * 0.5, yy, z + Math.sin(ry) * len * 0.5, 0.04, 0.3, 0.04, coul);
  }
  if (parabole) {
    const ry = rand() * Math.PI * 2;
    const yy = y + haut * 0.42;
    C.paraboles.ajouter(x + Math.sin(ry) * 0.35, yy, z + Math.cos(ry) * 0.35, 0.75, 0.75, 0.75, 0x8a7ab0, ry + Math.PI, Math.PI / 2 - 0.2);
  }
  if (haut > 5) balise(x, y + haut + 0.12, z, { rayon: 0.13, couleur: haut > 9 ? 0xffe0ff : 0xff2bd6, periode: 2 + rand(), double: haut > 9 });
  if (guyots && haut > 6.5) {
    for (let k = 0; k < 3; k++) {
      const a = rand() * Math.PI * 2 + k * 2.1;
      const gx = clamp(x + Math.cos(a) * haut * 0.4, R.x0 + 0.5, R.x1 - 0.5);
      const gz = clamp(z + Math.sin(a) * haut * 0.4, R.z0 + 0.5, R.z1 - 0.5);
      C.lignes.push(x, y + haut * 0.72, z, gx, y + 0.1, gz);
    }
  }
  return { x, z, top: y + haut };
}

function cabanon(R, rand, x, z, ry) {
  const y = R.h + SURELEVATION;
  repere('cabanon', R, x, z);
  const w = entre(rand, 2.4, 3.2), d = entre(rand, 2.0, 2.6), h = entre(rand, 2.2, 2.6);
  const coul = choix(rand, COULEURS.structure);
  boite(C.metal, x, y, z, w, h, d, coul, { ry });
  const t = Math.abs(Math.sin(ry)) > 0.7;
  C.mate.ajouter(x, y + h + 0.07, z, (t ? d : w) + 0.5, 0.14, (t ? w : d) + 0.5, 0x1c1632, ry);
  // fenêtre éclairée et porte, face tournée vers le centre du toit
  const dir = Math.sign(R.x - x) || 1;
  const dirz = Math.sign(R.z - z) || 1;
  const fx = t ? x : x + (w / 2 + 0.03) * dir;
  const fz = t ? z + (w / 2 + 0.03) * dirz : z;
  const tint = choix(rand, [0xff8ad8, 0x8ab0ff, 0xc08aff]);
  C.lueur.ajouter(fx, y + 1.45, fz + (t ? 0 : -0.5), t ? 0.9 : 0.04, 0.6, t ? 0.04 : 0.9, tint);
  C.mate.ajouter(fx, y + 1.0, fz + (t ? 0 : 0.6), t ? 0.8 : 0.05, 1.9, t ? 0.05 : 0.8, 0x120c24);
  return { w: t ? d : w, d: t ? w : d };
}

function cheminee(R, rand, x, z) {
  const y = R.h + SURELEVATION;
  const h = entre(rand, 0.9, 1.8), r = entre(rand, 0.2, 0.32);
  cylindre(C.cylM, x, y, z, r, h, choix(rand, COULEURS.clair), true);
  C.cone.ajouter(x, y + h + 0.14, z, r * 1.7, 0.28, r * 1.7, 0x2d2750);
  C.cylT.ajouter(x, y + 0.12, z, r * 1.5, 0.24, r * 1.5, 0x1c1632);
  if (rand() < 0.4) C.lueur.ajouter(x, y + h * 0.55, z + r + 0.01, 0.07, 0.07, 0.03, choix(rand, [0x4aa8ff, 0xff5ad0]));
}

function coffret(R, rand, x, z) {
  const y = R.h + SURELEVATION;
  for (const dx of [-0.22, 0.22]) C.metal.ajouter(x + dx, y + 0.25, z, 0.06, 0.5, 0.06, 0x2d2750);
  boite(C.metal, x, y + 0.5, z, 0.7, 0.9, 0.38, choix(rand, COULEURS.structure), { collider: false });
  coll(x - 0.38, x + 0.38, z - 0.22, z + 0.22, y, y + 1.4);
  C.lueur.ajouter(x, y + 1.15, z + 0.2, 0.1, 0.06, 0.02, choix(rand, [0x4aa8ff, 0xff5ad0, 0x8a5cff]));
  C.mate.ajouter(x, y + 0.9, z + 0.2, 0.5, 0.35, 0.02, 0x120c24);
}

function lucarne(R, rand, x, z) {
  const y = R.h + SURELEVATION;
  boite(C.mate, x, y, z, 1.3, 0.32, 1.3, 0x2a2244);
  C.lueur.ajouter(x, y + 0.335, z, 1.0, 0.01, 1.0, choix(rand, [0x3a1a8a, 0x5a1a7a, 0x1a2a8a]));
}

function caisses(R, rand, x, z) {
  const y = R.h + SURELEVATION;
  const n = 2 + Math.floor(rand() * 2);
  for (let i = 0; i < n; i++) {
    const w = entre(rand, 0.55, 0.9);
    const dx = (i - (n - 1) / 2) * 0.95 + entre(rand, -0.1, 0.1);
    const h = entre(rand, 0.5, 0.95);
    boite(C.mate, x + dx, y, z + entre(rand, -0.2, 0.2), w, h, w, choix(rand, COULEURS.ocre), { ry: rand() < 0.5 ? 0 : Math.PI / 2 });
    if (rand() < 0.4) boite(C.mate, x + dx, y + h, z, w * 0.7, 0.45, w * 0.7, choix(rand, COULEURS.ocre));
  }
  if (rand() < 0.6) cylindre(C.cylT, x + 1.4, y, z + 0.1, 0.32, 0.9, choix(rand, [0x3a5a7a, 0x6a3a6a, 0x4a4a8a]));
}

/** Conduit rectangulaire de 0,3 m (praticable en l'enjambant) : L à angle droit. */
function conduit(R, rand, P, x, z, sens, long1, long2) {
  const y = R.h + SURELEVATION;
  const s = 0.34;
  const coul = choix(rand, COULEURS.clair);
  // premier tronçon
  const a = { x: x, z: z };
  const dx1 = sens.x * long1, dz1 = sens.z * long1;
  const sx = Math.min(a.x, a.x + dx1) - (sens.x ? 0 : s / 2), ex = Math.max(a.x, a.x + dx1) + (sens.x ? 0 : s / 2);
  const sz = Math.min(a.z, a.z + dz1) - (sens.z ? 0 : s / 2), ez = Math.max(a.z, a.z + dz1) + (sens.z ? 0 : s / 2);
  if (!(sx > R.x0 + 1 && ex < R.x1 - 1 && sz > R.z0 + 1 && ez < R.z1 - 1)) return false;
  // le tronçon part du flanc du bloc : le test de place ignore les 0,3 m les plus proches (emprise réservée du bloc)
  const tx0 = sens.x > 0 ? sx + 0.3 : sx, tx1 = sens.x < 0 ? ex - 0.3 : ex;
  const tz0 = sens.z > 0 ? sz + 0.3 : sz, tz1 = sens.z < 0 ? ez - 0.3 : ez;
  if (!P.libre(tx0, tx1, tz0, tz1, -0.02)) return false;
  P.reserver(sx, ex, sz, ez);
  boiteRect(C.metal, { minX: sx, maxX: ex, minZ: sz, maxZ: ez }, y, 0.3, coul);
  for (let k = 0; k <= long1; k += 1.4) {
    const px = a.x + sens.x * k, pz = a.z + sens.z * k;
    C.mate.ajouter(px, y + 0.15, pz, sens.x ? 0.1 : s + 0.06, 0.34, sens.z ? 0.1 : s + 0.06, 0x120c24);
  }
  // second tronçon, tourné de 90°
  const b = { x: a.x + dx1, z: a.z + dz1 };
  const sens2 = sens.x ? { x: 0, z: rand() < 0.5 ? 1 : -1 } : { x: rand() < 0.5 ? 1 : -1, z: 0 };
  const dx2 = sens2.x * long2, dz2 = sens2.z * long2;
  const sx2 = Math.min(b.x, b.x + dx2) - (sens2.x ? 0 : s / 2), ex2 = Math.max(b.x, b.x + dx2) + (sens2.x ? 0 : s / 2);
  const sz2 = Math.min(b.z, b.z + dz2) - (sens2.z ? 0 : s / 2), ez2 = Math.max(b.z, b.z + dz2) + (sens2.z ? 0 : s / 2);
  if (sx2 > R.x0 + 1 && ex2 < R.x1 - 1 && sz2 > R.z0 + 1 && ez2 < R.z1 - 1 && P.libre(sx2, ex2, sz2, ez2, -0.02)) {
    P.reserver(sx2, ex2, sz2, ez2);
    boiteRect(C.metal, { minX: sx2, maxX: ex2, minZ: sz2, maxZ: ez2 }, y, 0.3, coul);
  }
  return true;
}

function lingeEtendu(R, rand, x, z, long, sensX) {
  const y = R.h + SURELEVATION;
  const h = 2.25;
  const a = sensX ? [x - long / 2, z] : [x, z - long / 2];
  const b = sensX ? [x + long / 2, z] : [x, z + long / 2];
  for (const [px, pz] of [a, b]) {
    cylindre(C.cylM, px, y, pz, 0.05, h, 0x6a5e98, false);
    coll(px - 0.12, px + 0.12, pz - 0.12, pz + 0.12, y, y + h);
  }
  cable([a[0], y + h, a[1]], [b[0], y + h, b[1]], 0.18, 6);
  repere('linge', R, x, z);
  const n = Math.floor(long / 0.8);
  for (let i = 0; i < n; i++) {
    const k = (i + 0.5) / n;
    const w = entre(rand, 0.45, 0.8), hh = entre(rand, 0.6, 1.1);
    const cx = lerp(a[0], b[0], k), cz = lerp(a[1], b[1], k);
    C.linge.ajouter(cx, y + h - 0.06 - hh / 2, cz, w, hh, 1, choix(rand, COULEURS.linge), sensX ? 0 : Math.PI / 2);
  }
}

function plante(rand, x, y, z, rayon, couleur) {
  const n = 3 + Math.floor(rand() * 2);
  for (let i = 0; i < n; i++) {
    const a = rand() * Math.PI * 2;
    C.feuilles.ajouter(x + Math.cos(a) * rayon * 0.4, y + rayon * 0.35, z + Math.sin(a) * rayon * 0.4, rayon * 0.55, rayon * 0.4, rayon * 0.55, couleur, a, 0, 0.3);
  }
}

/** Jardin hydroponique : n lits parallèles, cadre de lampes de culture. */
function jardin(R, rand, x, z, long, nLits, sensX) {
  const y = R.h + SURELEVATION;
  repere('jardin', R, x, z);
  const lit = 0.55, larg = 1.0, ecart = 1.55;
  const ry = sensX ? 0 : Math.PI / 2;
  for (let i = 0; i < nLits; i++) {
    const off = (i - (nLits - 1) / 2) * ecart;
    const cx = sensX ? x : x + off, cz = sensX ? z + off : z;
    boite(C.mate, cx, y, cz, sensX ? long : larg, lit, sensX ? larg : long, 0x20324a, { ry: 0 });
    // plan vert émissif sur le lit
    C.lueur.ajouter(cx, y + lit + 0.012, cz, sensX ? long - 0.1 : larg - 0.14, 0.02, sensX ? larg - 0.14 : long - 0.1, 0x0f5a34);
    const pas = 0.5;
    const n = Math.floor((long - 0.4) / pas);
    for (let k = 0; k < n; k++) {
      const u = (k - (n - 1) / 2) * pas;
      plante(rand, sensX ? cx + u : cx + (k % 2 ? 0.18 : -0.18), y + lit, sensX ? cz + (k % 2 ? 0.18 : -0.18) : cz + u, 0.3, choix(rand, COULEURS.vert));
    }
  }
  // cadre : deux portiques et des barres lumineuses
  const largeCadre = (nLits - 1) * ecart + larg + 0.5;
  for (const sgn of [-1, 1]) {
    const px = sensX ? x + sgn * (long / 2 + 0.05) : x, pz = sensX ? z : z + sgn * (long / 2 + 0.05);
    for (const t of [-1, 1]) {
      const qx = sensX ? px : px + t * largeCadre / 2, qz = sensX ? pz + t * largeCadre / 2 : pz;
      boite(C.metal, qx, y, qz, 0.1, 2.0, 0.1, 0x6a5e98);
    }
    C.metal.ajouter(px, y + 2.0, pz, sensX ? 0.08 : largeCadre, 0.08, sensX ? largeCadre : 0.08, 0x6a5e98);
  }
  for (let i = 0; i < nLits; i++) {
    const off = (i - (nLits - 1) / 2) * ecart;
    const cx = sensX ? x : x + off, cz = sensX ? z + off : z;
    C.lueur.ajouter(cx, y + 1.95, cz, sensX ? long : 0.14, 0.06, sensX ? 0.14 : long, choix(rand, [0xd84ae0, 0xff4ad0, 0xb04aff]));
  }
  return { w: sensX ? long + 0.4 : largeCadre, d: sensX ? largeCadre : long + 0.4 };
}

/** Façades de l'étage technique : lampes et leur halo sur le mur, portes, colonnes montantes, chemin de câbles. */
function facadesEtage(R, rand) {
  const e = R.etage;
  if (!e) return;
  const y = R.h + SURELEVATION;
  const faces = [
    { nx: 0, nz: -1, cx: e.x, cz: e.z0, long: e.x1 - e.x0, tx: 1, tz: 0 },
    { nx: 0, nz: 1, cx: e.x, cz: e.z1, long: e.x1 - e.x0, tx: 1, tz: 0 },
    { nx: -1, nz: 0, cx: e.x0, cz: e.z, long: e.z1 - e.z0, tx: 0, tz: 1 },
    { nx: 1, nz: 0, cx: e.x1, cz: e.z, long: e.z1 - e.z0, tx: 0, tz: 1 },
  ];
  const haut = Math.min(e.h1 - R.h, 9);
  for (const f of faces) {
    const yaw = Math.atan2(f.nx, f.nz);
    const pt = (u, d) => [f.cx + f.tx * u + f.nx * d, f.cz + f.tz * u + f.nz * d];
    const teinte = choix(rand, [0xff5ad0, 0x6a8aff, 0xc08aff]);
    // lampe de mur et son halo
    const u1 = f.long * entre(rand, -0.3, -0.15);
    const [lx, lz] = pt(u1, 0.1);
    C.lueur.ajouter(lx, y + 2.7, lz, 0.2, 0.1, 0.2, teinte);
    const [hx, hz] = pt(u1, 0.03);
    C.lueursMur.ajouter(hx, y + 2.2, hz, 4.2, 3.4, 1, teinte, yaw);
    // porte
    if (rand() < 0.75) {
      const u2 = f.long * entre(rand, 0.12, 0.3);
      const [dx, dz] = pt(u2, 0.05);
      C.mate.ajouter(dx, y + 1.05, dz, f.tx ? 1.0 : 0.1, 2.1, f.tx ? 0.1 : 1.0, 0x120c24);
      const [wx, wz] = pt(u2, 0.11);
      C.lueur.ajouter(wx, y + 1.5, wz, f.tx ? 0.45 : 0.03, 0.55, f.tx ? 0.03 : 0.45, choix(rand, [0x6a3aff, 0xb04aff]));
    }
    // colonnes montantes
    for (const s of [-1, 1]) {
      if (rand() < 0.4) continue;
      const [px, pz] = pt(s * (f.long / 2 - 0.5), 0.12);
      C.cylM.ajouter(px, y + haut / 2, pz, 0.09, haut, 0.09, choix(rand, COULEURS.clair));
    }
    // chemin de câbles
    const [cx, cz] = pt(0, 0.1);
    C.metal.ajouter(cx, y + 3.4, cz, f.tx ? f.long * 0.8 : 0.14, 0.1, f.tx ? 0.14 : f.long * 0.8, 0x3f3566);
  }
}

function balisesAngles(R, rand) {
  const y = R.h + SURELEVATION;
  const coins = [[R.x0 + 0.5, R.z0 + 0.5], [R.x1 - 0.5, R.z0 + 0.5], [R.x0 + 0.5, R.z1 - 0.5], [R.x1 - 0.5, R.z1 - 0.5]];
  for (const [cx, cz] of coins) {
    if (rand() < 0.5) continue;
    C.metal.ajouter(cx, y + 0.25, cz, 0.1, 0.5, 0.1, 0x6a5e98);
    balise(cx, y + 0.56, cz, { rayon: 0.09, couleur: choix(rand, [0xff2bd6, 0x4a7dff, 0xff2bd6]), periode: 1.6 + rand() * 1.4 });
  }
}

// ---------------------------------------------------------------------------
// Rebords et garde-fous
// ---------------------------------------------------------------------------
function levres(R, rand) {
  const y = R.h;
  for (const b of ['n', 's', 'w', 'e']) {
    if (R.pasDeLevre.has(b)) continue;
    const [a0, a1] = BORDS[b].long(R);
    const segs = sansTrous(a0, a1, R.trous[b]);
    const neon = rand() < 0.5 ? choix(rand, COULEURS.neon) : null;
    for (const [s0, s1] of segs) {
      const r = rectBord(R, b, s0, s1, 0, 0.28);
      boiteRect(C.metal, r, y, LEVRE, COULEURS.levre, true);
      if (neon !== null) {
        const q = rectBord(R, b, s0, s1, 0.1, 0.17);
        C.lueur.ajouter((q.minX + q.maxX) / 2, y + LEVRE + 0.015, (q.minZ + q.maxZ) / 2, q.maxX - q.minX, 0.03, q.maxZ - q.minZ, neon);
      }
    }
  }
}

function garde(R, b, a, c, haut = 1.0) {
  const y = R.h;
  const r = rectBord(R, b, a, c, 0.05, 0.2);
  coll(r.minX, r.maxX, r.minZ, r.maxZ, y, y + haut);
  const long = c - a;
  const along = BORDS[b].axe === 'x';
  const [cx, cz] = [(r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2];
  // lisses et montants (visuels)
  C.metal.ajouter(cx, y + haut, cz, along ? long : 0.06, 0.06, along ? 0.06 : long, 0x7a6ab0);
  C.metal.ajouter(cx, y + haut * 0.5, cz, along ? long : 0.04, 0.04, along ? 0.04 : long, 0x5a4e88);
  C.lueur.ajouter(cx, y + haut + 0.045, cz, along ? long : 0.03, 0.025, along ? 0.03 : long, 0x4a7dff);
  const n = Math.max(2, Math.ceil(long / 1.3));
  for (let i = 0; i <= n; i++) {
    const u = a + (long * i) / n;
    const [px, pz] = pointBord(R, b, u, 0.125);
    C.metal.ajouter(px, y + haut / 2, pz, 0.07, haut, 0.07, 0x7a6ab0);
  }
}

// ---------------------------------------------------------------------------
// Assises
// ---------------------------------------------------------------------------
function banc(R, rand, def) {
  const { bord, coord } = def;
  const dem = BANC.largeur / 2;
  const a = coord - dem, c = coord + dem;
  R.trous[bord].push([a - 0.05, c + 0.05]);
  const r = rectBord(R, bord, a, c, 0, BANC.profondeur);
  boiteRect(C.metal, r, R.h, BANC.hauteur, 0x5a4e8a, true);
  // dessus plus clair, liseré bleu sous l'avant du banc
  const cx = (r.minX + r.maxX) / 2, cz = (r.minZ + r.maxZ) / 2;
  const along = BORDS[bord].axe === 'x';
  C.mate.ajouter(cx, R.h + BANC.hauteur + 0.02, cz, r.maxX - r.minX - 0.06, 0.04, r.maxZ - r.minZ - 0.06, 0x2a2244);
  const [fx, fz] = pointBord(R, bord, coord, 0.02);
  C.lueur.ajouter(fx, R.h + 0.1, fz, along ? BANC.largeur - 0.1 : 0.03, 0.04, along ? 0.03 : BANC.largeur - 0.1, 0x4a7dff);
  // boîte de conserve pour la cendre et lanterne
  const [ex, ez] = pointBord(R, bord, coord + dem - 0.3, 0.45);
  cylindre(C.cylM, ex, R.h + BANC.hauteur + 0.04, ez, 0.07, 0.12, 0x8a7ab0, false);
  const [lx, lz] = pointBord(R, bord, coord - dem + 0.25, 0.4);
  C.lueur.ajouter(lx, R.h + BANC.hauteur + 0.12, lz, 0.1, 0.16, 0.1, 0xff8ad8);
  // zone libre devant et au bord
  const prof = BANC.profondeur + 4.2;
  const rr = rectBord(R, bord, a - 1.2, c + 1.2, 0, prof);
  R.reserves.push([rr.minX, rr.maxX, rr.minZ, rr.maxZ]);
  R.bancs.push(def);
}

// ---------------------------------------------------------------------------
// Karaoké et plantation d'Oba
// ---------------------------------------------------------------------------
function plantationTabac(R, rand) {
  const y = R.h + SURELEVATION;
  // deux rangées de pots le long du bord sud
  const zs = [R.z1 - 1.6, R.z1 - 3.0];
  for (const zz of zs) {
    for (let x = R.x0 + 2.2; x <= R.x1 - 2.0; x += 1.55) {
      const pot = choix(rand, COULEURS.pot);
      cylindre(C.cylT, x, y, zz, 0.34, 0.5, pot, true);
      C.cylT.ajouter(x, y + 0.5, zz, 0.3, 0.03, 0.3, 0x1a1020);
      const haut = entre(rand, 0.9, 1.7);
      C.cylT.ajouter(x, y + 0.5 + haut / 2, zz, 0.035, haut, 0.035, 0x4a7a28);
      const nf = 5 + Math.floor(rand() * 3);
      for (let k = 0; k < nf; k++) {
        const a = k * 2.4 + rand();
        const hy = y + 0.6 + (haut - 0.2) * (k / nf) + 0.1;
        const sz = 0.42 - 0.2 * (k / nf);
        C.feuilles.ajouter(x + Math.cos(a) * 0.22, hy, zz + Math.sin(a) * 0.22, sz, 0.05, sz * 0.5, choix(rand, COULEURS.tabac), a, 0.4 * (k % 2 ? 1 : -1), 0.5);
      }
    }
  }
  R.reserves.push([R.x0 + 1.2, R.x1 - 1.0, R.z1 - 4.0, R.z1 - 0.5]);
  // séchoir : cadre de bois, feuilles brunes pendues à une corde
  const sx = R.x0 + 1.3, sz0 = R.z0 + 6.2, sz1 = R.z0 + 10.2;
  for (const zz of [sz0, sz1]) {
    boite(C.mate, sx, y, zz, 0.12, 2.3, 0.12, 0x5a3a58);
  }
  C.mate.ajouter(sx, y + 2.3, (sz0 + sz1) / 2, 0.1, 0.1, sz1 - sz0 + 0.1, 0x5a3a58);
  C.mate.ajouter(sx, y + 1.8, (sz0 + sz1) / 2, 0.1, 0.07, sz1 - sz0, 0x5a3a58);
  for (let i = 0; i < 12; i++) {
    const zz = lerp(sz0 + 0.2, sz1 - 0.2, i / 11);
    const hh = entre(rand, 0.5, 0.8);
    C.feuilles.ajouter(sx + (i % 2 ? 0.08 : -0.08), y + 2.2 - hh / 2, zz, 0.07, hh / 2, 0.16, choix(rand, COULEURS.sechage), 0, 0, 0.1);
  }
  R.reserves.push([sx - 1.2, sx + 1.4, sz0 - 1.0, sz1 + 1.0]);
  // tonneau d'eau de pluie et caisse-tabouret
  cylindre(C.cylM, R.x0 + 2.0, y, R.z0 + 12.7, 0.5, 1.0, 0x3a5a80, true);
  C.lueur.ajouter(R.x0 + 2.0, y + 1.0, R.z0 + 12.7, 0.8, 0.02, 0.8, 0x3a1a8a);
  boite(C.mate, R.x0 + 3.2, y, R.z0 + 11.3, 0.5, 0.42, 0.5, 0x6b4a78);
  R.reserves.push([R.x0 + 0.8, R.x0 + 4.0, R.z0 + 10.6, R.z0 + 13.6]);
}

function karaoke(R, rand, textures) {
  const y = R.h + SURELEVATION;
  const e = R.etage;
  const grp = new THREE.Group();
  grp.name = 'karaoke';
  const plan = (tex, w, h, x, yy, z, ry) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false })
    );
    m.position.set(x, yy, z);
    m.rotation.y = ry;
    grp.add(m);
    return m;
  };
  // grande enseigne verticale en drapeau, plein est : on la lit depuis la rue qui longe le lot
  const sx = R.x1 - 1.5, sz = R.z0 + 8.0, ry = Math.PI / 2;
  const hauteur = 9.0, larg = 2.3, base = y + 2.2;
  const vert = textures.vertical;
  plan(vert, larg, hauteur, sx, base + hauteur / 2, sz, ry);
  plan(vert, larg, hauteur, sx - 0.07, base + hauteur / 2, sz, ry + Math.PI);
  for (const t of [-0.7, 0.7]) boite(C.metal, sx, y, sz + t, 0.14, base - y + hauteur + 0.25, 0.14, 0x6a5e98);
  for (const yy of [base - 0.06, base + hauteur + 0.06]) C.lueur.ajouter(sx, yy, sz, 0.06, 0.07, larg + 0.4, 0xff2bd6);
  balise(sx, base + hauteur + 0.55, sz, { rayon: 0.18, couleur: 0xff2bd6, periode: 1.7 });

  // enseigne en drapeau sur la façade est, perpendiculaire au mur : on la lit de loin le long de la rue
  {
    const bx = R.x1 + 1.15, bz = R.z0 + 6.2, bh = 9.4, bl = 2.3, by = R.h - 0.8 - bh / 2;
    plan(textures.vertical, bl, bh, bx, by, bz + 0.04, 0);
    plan(textures.vertical, bl, bh, bx, by, bz - 0.04, Math.PI);
    for (const yy of [by - bh / 2 - 0.04, by + bh / 2 + 0.04]) C.lueur.ajouter(bx, yy, bz, bl + 0.1, 0.07, 0.1, 0xff2bd6);
    for (const yy of [by + bh / 2 - 0.5, by - bh / 2 + 0.6]) C.metal.ajouter(R.x1 + 0.45, yy, bz, 0.9, 0.08, 0.08, 0x6a5e98);
  }

  // enseigne horizontale sur la face nord de l'étage technique, et sur sa face est
  plan(textures.horizontale, 8.4, 2.1, e.x, R.h + 6.2, e.z0 - 0.04, Math.PI);
  plan(textures.horizontale, 8.4, 2.1, e.x1 + 0.04, R.h + 6.2, e.z, Math.PI / 2);
  plan(textures.salle, 1.2, 1.2, e.x0 - 0.04, R.h + 3.4, e.z - 3.0, -Math.PI / 2);
  // fenêtres éclairées de la salle (face ouest et sud)
  for (const dz of [-1.6, 0, 1.6]) C.lueur.ajouter(e.x0 - 0.03, R.h + 2.1, e.z + dz, 0.04, 0.9, 0.9, choix(rand, [0xff6ad8, 0xb04aff, 0x6a8aff]));
  for (const dx of [-2.4, 0, 2.4]) C.lueur.ajouter(e.x + dx, R.h + 2.1, e.z1 + 0.03, 0.9, 0.9, 0.04, choix(rand, [0xff6ad8, 0xb04aff, 0x6a8aff]));
  // porte de la salle, face ouest
  C.lueur.ajouter(e.x0 - 0.03, R.h + 1.1, e.z + 3.4, 0.05, 2.1, 1.0, 0xff2bd6);

  // enceintes et woofers au bord est
  for (const zz of [R.z0 + 13.2, R.z0 + 15.0]) {
    boite(C.metal, R.x1 - 1.6, y, zz, 0.95, 1.5, 1.0, 0x3a3060);
    for (const wy of [0.4, 1.05]) {
      C.lueurCyl.ajouter(R.x1 - 1.6 + 0.49, y + wy, zz, 0.3, 0.02, 0.3, 0xff2bd6, 0, 0, Math.PI / 2);
      C.cylT.ajouter(R.x1 - 1.6 + 0.5, y + wy, zz, 0.24, 0.02, 0.24, 0x120c24, 0, 0, Math.PI / 2);
    }
  }
  // paquet de câbles vers l'étage
  cable([R.x1 - 1.7, y + 1.5, R.z0 + 13.2], [e.x1, y + 2.5, e.z0 + 8], 0.4, 6);

  // boule à facettes sur l'étage technique, éclairant la salle
  const ballePole = e.x;
  C.metal.ajouter(ballePole, e.h1 + 0.6, e.z, 0.05, 1.2, 0.05, 0x6a5e98);
  grp.userData.boule = { x: ballePole, y: e.h1 + 1.45, z: e.z };
  // la caisse et le papier (fragment 27, src/data/fragments-positions.js)
  boite(C.mate, PAPIER_K.x, y, R.z0 + 2.0, 0.7, 0.7, 0.7, 0x4a3a78);
  // table de mixage / caisse à micro côté ouest
  boite(C.mate, R.x0 + 2.5, y, R.z1 - 2.8, 1.2, 0.8, 0.7, 0x4a3a78);
  C.lueur.ajouter(R.x0 + 2.5, y + 0.82, R.z1 - 2.8, 1.0, 0.02, 0.5, 0x3a6aff);
  return grp;
}

// ---------------------------------------------------------------------------
// Construction d'un toit « ordinaire »
// ---------------------------------------------------------------------------
function habiller(R, rand, opts = {}) {
  const P = creerPlaceur(R, rand);
  const aire = (R.x1 - R.x0) * (R.z1 - R.z0);
  const grand = aire > 250;
  const petit = aire < 120;
  const y = R.h + SURELEVATION;

  // revêtement
  const g = new THREE.PlaneGeometry(R.x1 - R.x0 - 0.02, R.z1 - R.z0 - 0.02);
  g.rotateX(-Math.PI / 2);
  g.translate(R.x, R.h + 0.012, R.z);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (R.x1 - R.x0) / 4.5, uv.getY(i) * (R.z1 - R.z0) / 4.5);
  C.sols.push(g);

  // blocs techniques
  const nClim = petit ? 1 : 2 + Math.floor(rand() * (grand ? 4 : 3));
  const clims = [];
  for (let i = 0; i < nClim; i++) {
    const ry = rand() < 0.5 ? 0 : Math.PI / 2;
    const w = 3.2, d = 2.4;
    const pos = P.placer(ry ? d : w, ry ? w : d, { gap: 1.45 });
    if (!pos) continue;
    const dims = climatiseur(R, rand, pos.x, pos.z, ry);
    clims.push({ ...pos, ...dims, ry });
  }
  // réservoirs
  if (!petit && rand() < 0.75) {
    const r = entre(rand, 0.9, 1.4);
    const pos = P.placer(2 * r + 0.5, 2 * r + 0.5, { gap: 1.5 });
    if (pos) reservoir(R, rand, pos.x, pos.z, r, entre(rand, 1.8, 2.8));
  }
  // jardin hydroponique
  if (opts.jardin ?? (!petit && rand() < 0.5)) {
    const long = entre(rand, 4, 6.5), nLits = rand() < 0.5 ? 2 : 3;
    const sensX = rand() < 0.5;
    const dims = { w: (sensX ? long : (nLits - 1) * 1.55 + 1.5) + 0.5, d: (sensX ? (nLits - 1) * 1.55 + 1.5 : long) + 0.5 };
    const pos = P.placer(dims.w, dims.d, { gap: 1.45 });
    if (pos) jardin(R, rand, pos.x, pos.z, long, nLits, sensX);
  }
  // cabanon
  if (!petit && rand() < 0.5) {
    const ry = rand() < 0.5 ? 0 : Math.PI / 2;
    const pos = P.placer(3.4, 2.8, { gap: 1.5 });
    if (pos) cabanon(R, rand, pos.x, pos.z, 0);
    void ry;
  }
  // linge
  if (!petit && rand() < 0.65) {
    const long = entre(rand, 3.5, 5.5), sensX = rand() < 0.5;
    const pos = P.placer(sensX ? long : 0.5, sensX ? 0.5 : long, { gap: 1.5 });
    if (pos) lingeEtendu(R, rand, pos.x, pos.z, long, sensX);
  }
  // antennes
  const nAnt = petit ? 1 : 2 + Math.floor(rand() * (grand ? 3 : 2));
  const mats = [];
  for (let i = 0; i < nAnt; i++) {
    const pos = P.placer(0.9, 0.9, { gap: 1.3, marge: 1.3 });
    if (!pos) continue;
    mats.push(antenne(R, rand, pos.x, pos.z, entre(rand, 4.5, i === 0 ? 14 : 9), { parabole: rand() < 0.45 }));
  }
  // câbles entre les têtes de mât
  for (let i = 0; i + 1 < mats.length; i++) cable([mats[i].x, mats[i].top - 0.5, mats[i].z], [mats[i + 1].x, mats[i + 1].top - 1.2, mats[i + 1].z], 0.8, 8);
  // caisses
  const nCaisses = rand() < 0.7 ? 1 + Math.floor(rand() * 2) : 0;
  for (let i = 0; i < nCaisses; i++) {
    const pos = P.placer(2.4, 1.6, { gap: 1.4 });
    if (pos) caisses(R, rand, pos.x, pos.z);
  }
  // lucarnes
  const nLuc = Math.floor(rand() * 3);
  for (let i = 0; i < nLuc; i++) {
    const pos = P.placer(1.4, 1.4, { gap: 1.3 });
    if (pos) lucarne(R, rand, pos.x, pos.z);
  }
  // cheminées d'aération et coffrets électriques
  const nChem = (petit ? 2 : 4) + Math.floor(rand() * 4);
  for (let i = 0; i < nChem; i++) {
    const pos = P.placer(0.8, 0.8, { gap: 0.9, marge: 1.1 });
    if (pos) cheminee(R, rand, pos.x, pos.z);
  }
  const nCof = 1 + Math.floor(rand() * 3);
  for (let i = 0; i < nCof; i++) {
    const pos = P.placer(1.0, 0.6, { gap: 1.0, marge: 1.1 });
    if (pos) coffret(R, rand, pos.x, pos.z);
  }
  // conduits
  for (const c of clims) {
    if (rand() < 0.2) continue;
    const dirs = [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }];
    const dir = choix(rand, dirs);
    const x0 = c.x + dir.x * ((dir.x ? (c.ry ? c.d : c.w) : 0) / 2 + 0.05);
    const z0 = c.z + dir.z * ((dir.z ? (c.ry ? c.w : c.d) : 0) / 2 + 0.05);
    conduit(R, rand, P, x0, z0, dir, entre(rand, 2.5, 6), entre(rand, 2, 5));
  }
  if (R.nom !== 'K') facadesEtage(R, rand);
  balisesAngles(R, rand);
  return P;
}

function flaquesToit(R, rand, P) {
  const n = 3 + Math.floor(rand() * 4);
  for (let i = 0; i < n; i++) {
    const rx = entre(rand, 0.8, 2.4), rz = entre(rand, 0.6, 1.8);
    for (let essai = 0; essai < 12; essai++) {
      const x = entre(rand, R.x0 + rx + 1.2, R.x1 - rx - 1.2), z = entre(rand, R.z0 + rz + 1.2, R.z1 - rz - 1.2);
      if (!P.libre(x - rx, x + rx, z - rz, z + rz, 0.15)) continue;
      C.flaques.ajouter(x, R.h + 0.03, z, rx * 2, 1, rz * 2, choix(rand, [0x8a5ad8, 0xc050b8, 0x4a68c8, 0x9a40d8]), rand() * Math.PI);
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Le système
// ---------------------------------------------------------------------------
/** Caisse où est posé le papier du fragment 27 (toit du karaoké), x ; z = bord nord + 2. */
const PAPIER_K = { x: 68.5 };

const ASSISES = [
  // toit A (clinique, au-dessus du Marché), rebord nord : le Marché des Mains en contrebas, la tour au fond
  { id: 'marche', toit: 'A', bord: 'n', coord: 63.0, yaw: 0.66, pitch: -0.02 },
  // toit B (carrefour ouest), rebord nord : la rue du carrefour, la tour de Hashira, l'enseigne du Marché
  { id: 'carrefour', toit: 'B', bord: 'n', coord: -5.2, yaw: -0.55, pitch: 0.03 },
  // chaîne de toits C : le grand toit (rebord est, une avenue qui fuit) et l'étage technique (le plus haut des toits sans le Bond)
  { id: 'chaine-est', toit: 'C1', bord: 'e', coord: 112.0, yaw: -0.95, pitch: 0.03 },
  { id: 'chaine-haut', toit: 'C2E', bord: 'w', coord: 115.0, yaw: Math.PI / 2, pitch: 0.05 },
  // toit du karaoké (Bond) : rebord nord, vers la tour par-dessus le toit de la clinique
  { id: 'karaoke', toit: 'K', bord: 'n', coord: 74.5, yaw: 0.9, pitch: 0.03 },
  // étage technique du toit A (Bond)
  { id: 'clinique-haut', toit: 'AE', bord: 'n', coord: 66.5, yaw: 0.55, pitch: 0.08 },
];

export const toits = {
  nom: 'toits',
  /** Points d'assise : [{ id, toit, position:[x,y,z] (le banc), sortie:[x,y,z], yaw, pitch, objet }]. */
  pointsAssise: [],
  /** Toits habillés : [{ nom, x, z, w, d, h }]. */
  liste: [],
  toitsR: new Map(),
  /** Éléments nommés posés (type, x, y, z, toit) : pour les tests et les captures. */
  reperes: [],
  /** Le toit du karaoké (カラオケ) : { x, z, w, d, h, etage }. */
  karaoke: null,
  /** Assise en cours : null ou { point, phase: 'entree' | 'assis' | 'sortie', t, … }. */
  assis: null,
  construit: false,
  stats: { instances: 0, colliders: 0, lots: 0 },

  init(jeu) {
    this.jeu = jeu;
    jeu.toits = this;
    // la position sauvegardée pendant l'assise est celle où l'on se relève (reprise sans surprise)
    const original = jeu.memoriserPosition;
    if (typeof original === 'function') {
      jeu.memoriserPosition = (...args) => {
        original.apply(jeu, args);
        if (this.assis) this.positionSauvee();
      };
    }
    jeu.on('partie:nouvelle', () => this.finir(true));
  },

  surZone(nom, zone) {
    if (this.assis) this.finir(true);
    if (nom !== ZONE || this.construit) return;
    this.construit = true;
    this.construire(zone);
  },

  // -------------------------------------------------------------------------
  construire(zone) {
    const t0 = performance.now();
    C = nouveauContexte(zone);
    const colliders0 = zone.colliders.length;
    const immeubles = zone.immeubles;
    const escaliers = zone.escaliers || [];
    const trouve = (x, z) => immeubles.find((b) => Math.abs(b.x - x) < 0.5 && Math.abs(b.z - z) < 0.5);
    const noms = new Map([['A', trouve(69.5, 50.5)], ['B', trouve(-9.5, 50.5)], ['C1', trouve(9.5, 120)], ['C2', trouve(-9.5, 120)], ['K', trouve(69.5, 69.5)]]);
    const nomDe = (b) => [...noms.entries()].find(([, v]) => v === b)?.[0] || null;

    // toits à habiller : les toits d'escalier, le karaoké, et ceux qu'on voit de près
    const sommets = escaliers.map((e) => e.immeuble);
    const retenus = new Set([...noms.values()].filter(Boolean));
    for (const b of immeubles) {
      if (b.h > 60) continue;
      if (sommets.some((s) => Math.hypot(b.x - s.x, b.z - s.z) <= RAYON_HABILLAGE && b.h <= s.h + DENIVELE_HABILLAGE)) retenus.add(b);
    }

    const textures = {
      vertical: signTexture(ENSEIGNES_TOITS.karaokeVertical.texte, ENSEIGNES_TOITS.karaokeVertical.couleur, true),
      horizontale: texEnseigneKaraoke(ENSEIGNES_TOITS.karaokeHorizontal),
      salle: signTexture(ENSEIGNES_TOITS.karaokeSalle.texte, ENSEIGNES_TOITS.karaokeSalle.couleur, false),
    };
    const racine = new THREE.Group();
    racine.name = 'toits';

    const toitsC = [];
    for (const b of retenus) {
      const e = b.etage;
      const etage = e ? { x0: e.x - e.w / 2, x1: e.x + e.w / 2, z0: e.z - e.d / 2, z1: e.z + e.d / 2, x: e.x, z: e.z, h1: e.h1 } : null;
      const R = creerToit({ nom: nomDe(b), x: b.x, z: b.z, w: b.w, d: b.d, h: b.h, etage }, immeubles);
      if (etage) R.reserves.push([etage.x0 - 0.8, etage.x1 + 0.8, etage.z0 - 0.8, etage.z1 + 0.8]);
      toitsC.push({ R, b });
    }
    const parNom = (nom) => toitsC.find((t) => t.R.nom === nom)?.R;

    // sorties d'escalier : trou dans l'acrotère, garde-fous de part et d'autre, zone libre devant
    for (const e of escaliers) {
      const R = toitsC.find((t) => t.b === e.immeuble)?.R;
      if (!R) continue;
      const { bord, coord } = bordProche(R, e.sommet[0], e.sommet[2]);
      const trou = 1.35;
      R.trous[bord].push([coord - trou, coord + trou]);
      const [a0, a1] = BORDS[bord].long(R);
      for (const [s0, s1] of sansTrous(clamp(coord - 8, a0 + 0.3, a1 - 0.3), clamp(coord + 8, a0 + 0.3, a1 - 0.3), [[coord - trou, coord + trou]])) {
        if (s1 - s0 > 0.8) R.rails.push({ bord, a: s0, c: s1 });
      }
      const rr = rectBord(R, bord, coord - 3, coord + 3, 0, 4.5);
      R.reserves.push([rr.minX, rr.maxX, rr.minZ, rr.maxZ]);
    }
    // chaîne C : marches entre les deux toits (x = 0), escalier de toit contre l'étage technique
    const escC = escaliers.find((e) => e.escalierToit);
    const rC1 = parNom('C1'), rC2 = parNom('C2');
    if (rC1 && rC2 && escC?.marchesToits) {
      const zm = escC.marchesToits.bas[2];
      rC1.reserves.push([rC1.x0 - 1, rC1.x0 + 4.5, zm - 5, zm + 3]);
      rC2.reserves.push([rC2.x1 - 4.5, rC2.x1 + 1, zm - 5, zm + 3]);
    }
    if (rC2 && escC?.escalierToit) rC2.reserves.push([-6.5, -2.5, escC.escalierToit.pied[2] - 11, escC.escalierToit.pied[2] + 1.5]);

    // bancs des toits principaux, puis décor
    for (const t of toitsC) {
      const { R } = t;
      const rand = rng(Math.round(R.x * 131 + R.z * 7919) + 4177);
      this.liste.push({ nom: R.nom, x: R.x, z: R.z, w: R.x1 - R.x0, d: R.z1 - R.z0, h: R.h });
      for (const a of ASSISES.filter((q) => q.toit === R.nom)) banc(R, rand, a);
      if (R.nom === 'A') plantationTabac(R, rand);
      if (R.nom === 'K') {
        // emplacements des pièces du karaoké : mât de l'enseigne, enceintes, table de mixage, caisse du papier
        R.reserves.push([R.x1 - 3.2, R.x1, R.z0 + 6.3, R.z0 + 9.7], [R.x1 - 3.0, R.x1, R.z0 + 12.2, R.z0 + 16.0],
          [R.x0 + 1.5, R.x0 + 3.5, R.z1 - 3.8, R.z1 - 1.6], [PAPIER_K.x - 1.5, PAPIER_K.x + 1.5, R.z0 + 0.6, R.z0 + 3.6]);
      }
      const P = habiller(R, rand, { jardin: R.nom === 'B' || R.nom === 'C1' ? true : undefined });
      levres(R, rand);
      for (const r of R.rails) garde(R, r.bord, r.a, r.c);
      flaquesToit(R, rand, P);
      this.toitsR.set(R.nom || `${R.x},${R.z}`, R);
      if (R.nom === 'K') {
        this.karaoke = { x: R.x, z: R.z, w: R.x1 - R.x0, d: R.z1 - R.z0, h: R.h, etage: R.etage };
        const grp = karaoke(R, rand, textures);
        racine.add(grp);
        this.boule = grp.userData.boule;
      }
    }

    // toits des étages techniques accessibles (A et C2 : au Bond ou par l'escalier de toit ; K : au Bond)
    for (const nom of ['A', 'C2', 'K']) {
      const R = parNom(nom);
      const et = R?.etage;
      if (!et) continue;
      const E = creerToit({ nom: `${nom}E`, x: et.x, z: et.z, w: et.x1 - et.x0, d: et.z1 - et.z0, h: et.h1, toitEtage: true }, immeubles);
      const rand = rng(Math.round(E.x * 131 + E.z * 7919) + 9001);
      if (nom === 'C2' && escC?.escalierToit) {
        // sortie de l'escalier de toit : face est, vers le haut de la volée
        const coord = escC.escalierToit.pied[2] - 9.24;
        E.trous.e.push([coord - 1.25, coord + 1.25]);
        for (const [s0, s1] of sansTrous(coord - 6.5, coord + 6.5, [[coord - 1.25, coord + 1.25]])) {
          const a = clamp(s0, E.z0 + 0.3, E.z1 - 0.3), c = clamp(s1, E.z0 + 0.3, E.z1 - 0.3);
          if (c - a > 0.8) E.rails.push({ bord: 'e', a, c });
        }
        const rr = rectBord(E, 'e', coord - 3, coord + 3, 0, 4);
        E.reserves.push([rr.minX, rr.maxX, rr.minZ, rr.maxZ]);
      }
      for (const a of ASSISES.filter((q) => q.toit === E.nom)) banc(E, rand, a);
      if (nom === 'K') E.reserves.push([E.x - 1.0, E.x + 1.0, E.z - 1.0, E.z + 1.0]);
      this.liste.push({ nom: E.nom, x: E.x, z: E.z, w: E.x1 - E.x0, d: E.z1 - E.z0, h: E.h });
      this.toitsR.set(E.nom, E);
      const P = creerPlaceur(E, rand);
      const g = new THREE.PlaneGeometry(E.x1 - E.x0 - 0.02, E.z1 - E.z0 - 0.02);
      g.rotateX(-Math.PI / 2);
      g.translate(E.x, E.h + 0.012, E.z);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 2);
      C.sols.push(g);
      if (nom !== 'K') {
        const pos = P.placer(0.9, 0.9, { gap: 1.2, marge: 1.2 });
        if (pos) antenne(E, rand, pos.x, pos.z, entre(rand, 6, 9), { parabole: true });
        const pos2 = P.placer(2.4, 1.8, { gap: 1.2, marge: 1.2 });
        if (pos2) climatiseur(E, rand, pos2.x, pos2.z, 0);
      }
      levres(E, rand);
      for (const r of E.rails) garde(E, r.bord, r.a, r.c);
      balisesAngles(E, rand);
      flaquesToit(E, rand, P);
    }

    this.assembler(zone, racine, textures);
    this.reperes = C.reperes;
    this.stats.colliders = zone.colliders.length - colliders0;
    this.stats.msConstruction = +(performance.now() - t0).toFixed(1);
    C = null;
    this.creerAssises();
  },

  assembler(zone, racine, textures) {
    const { mat } = ressources();
    for (const lot of [C.metal, C.mate, C.cylM, C.cylT, C.cone, C.lueur, C.lueurCyl, C.feuilles, C.linge, C.flaques, C.paraboles, C.balisesLot, C.lueursMur]) {
      lot.construire(racine);
      this.stats.instances += lot.n;
      if (lot.n) this.stats.lots += 1;
    }
    this.balisesLot = C.balisesLot;
    this.balisesDonnees = C.balises;
    const col = new THREE.Color();
    this.couleursBalises = C.balises.map((b) => col.clone().set(b.couleur));
    // revêtements fusionnés : un seul dessin
    if (C.sols.length) {
      const sol = new THREE.Mesh(mergeGeometries(C.sols), mat.revetement);
      sol.renderOrder = -1;
      racine.add(sol);
      this.stats.lots += 1;
    }
    // câbles : un seul LineSegments
    if (C.lignes.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(C.lignes, 3));
      const l = new THREE.LineSegments(g, mat.cable);
      l.frustumCulled = false;
      racine.add(l);
      this.stats.lots += 1;
    }
    // boule à facettes : couleurs de facettes, tourne
    if (this.boule) {
      const geo = new THREE.IcosahedronGeometry(0.5, 1).toNonIndexed();
      const n = geo.attributes.position.count;
      const cols = new Float32Array(n * 3);
      const pal = [0xff2bd6, 0x4a7dff, 0xc44bff, 0xffe0ff, 0x8a5cff];
      for (let i = 0; i < n; i += 3) {
        col.set(pal[(i / 3 * 7) % pal.length | 0]);
        for (let k = 0; k < 3; k++) { cols[(i + k) * 3] = col.r; cols[(i + k) * 3 + 1] = col.g; cols[(i + k) * 3 + 2] = col.b; }
      }
      geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      this.bouleMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
      this.bouleMesh.position.set(this.boule.x, this.boule.y, this.boule.z);
      racine.add(this.bouleMesh);
      this.stats.lots += 1;
    }
    zone.scene.add(racine);
    this.racine = racine;
  },

  // -------------------------------------------------------------------------
  creerAssises() {
    for (const a of ASSISES) {
      const R = this.toitsR.get(a.toit);
      if (!R) continue;
      const [sx, sz] = pointBord(R, a.bord, a.coord, BANC.profondeur / 2);
      const [ox, oz] = pointBord(R, a.bord, a.coord, BANC.profondeur / 2 + ASSIS.recul);
      const y = R.h + BANC.hauteur;
      const pt = {
        id: a.id,
        toit: a.toit,
        position: [+sx.toFixed(3), +y.toFixed(3), +sz.toFixed(3)],
        sortie: [+ox.toFixed(3), +R.h.toFixed(3), +oz.toFixed(3)],
        sol: R.h,
        yaw: a.yaw,
        pitch: a.pitch,
        interaction: null,
      };
      pt.interaction = jeu.interact.ajouter({
        zone: ZONE,
        position: [sx + (ox - sx) * 0.15, R.h + 0.95, sz + (oz - sz) * 0.15],
        rayon: 3.2,
        cone: 0.95,
        libelle: TEXTES_TOITS.asseoir,
        visible: () => !this.assis,
        action: () => this.sasseoir(pt.id),
      });
      this.pointsAssise.push(pt);
    }
    // invite « Se relever » (les premières secondes de chaque assise)
    this.objetRelever = jeu.interact.ajouter({
      zone: ZONE,
      position: [0, 0, 0],
      rayon: 4,
      cone: 3.2,
      libelle: TEXTES_TOITS.relever,
      visible: () => !!this.assis && this.assis.phase === 'assis' && this.assis.depuis < ASSIS.aide,
      action: () => this.relever(),
    });
  },

  // -------------------------------------------------------------------------
  // Assise
  // -------------------------------------------------------------------------
  sasseoir(id) {
    const pt = this.pointsAssise.find((p) => p.id === id);
    const p = jeu.player;
    if (!pt || this.assis || !p.auSol) return false;
    const { yaw, pitch } = p.orientation();
    this.assis = {
      point: pt,
      phase: 'entree',
      t: 0,
      depuis: 0,
      de: { x: p.position.x, y: p.position.y, z: p.position.z, oeil: jeu.camera.position.y, yaw, pitch },
      pince: new THREE.Vector3(p.position.x, p.position.y, p.position.z),
    };
    // pas de saut tant qu'on est assis (le Bond écoute Espace)
    this.sautOrig = { sauter: p.sauter, impulser: p.impulser, sautAuto: p.sautAuto };
    p.sauter = () => false;
    p.impulser = () => {};
    jeu.emettre('toits:assis', { id: pt.id });
    return true;
  },

  relever() {
    const a = this.assis;
    if (!a || a.phase !== 'assis') return false;
    const p = jeu.player;
    a.phase = 'sortie';
    a.t = 0;
    a.de = { x: p.position.x, y: p.position.y, z: p.position.z, oeil: jeu.camera.position.y };
    return true;
  },

  /** Termine l'assise. `net` : sans transition (changement de zone, nouvelle partie, téléportation). */
  finir(net = false) {
    const a = this.assis;
    if (!a) return;
    const p = jeu.player;
    if (this.sautOrig) {
      p.sauter = this.sautOrig.sauter;
      p.impulser = this.sautOrig.impulser;
      p.sautAuto = this.sautOrig.sautAuto;
      this.sautOrig = null;
    }
    p.decalageVue = 0;
    if (!net) {
      const [x, y, z] = a.point.sortie;
      p.teleporter(x, y, z);
    }
    this.assis = null;
    jeu.emettre('toits:releve', { id: a.point.id });
  },

  positionSauvee() {
    const a = this.assis;
    if (!a) return;
    const [x, y, z] = a.point.sortie;
    const { yaw } = jeu.player.orientation();
    jeu.etat.position = { x: +x.toFixed(2), y: +y.toFixed(2), z: +z.toFixed(2), yaw: +yaw.toFixed(3) };
  },

  /** Replace le joueur : position, hauteur de vue (le regard reste libre). */
  pincer(x, ySol, z, oeil) {
    const p = jeu.player;
    p.sautAuto = false;
    p.decalageVue = oeil - (ySol + EYE);
    p.teleporter(x, ySol, z);
    this.assis.pince.set(x, ySol, z);
  },

  majAssise(dt) {
    const a = this.assis;
    const p = jeu.player;
    if (!a) return;
    // déplacé par un autre système (téléportation, retour de Veilleur…) : on lâche tout
    if (a.pince.distanceToSquared(p.position) > 2.5) { this.finir(true); return; }
    if (jeu.jouable) { a.t += dt; a.depuis += dt; }
    const pt = a.point;
    const [bx, by, bz] = pt.position;
    const [sx, sy, sz] = pt.sortie;
    const input = jeu.input;

    if (a.phase === 'entree') {
      const k = clamp(a.t / ASSIS.entree, 0, 1);
      const e = lisse(k);
      const x = lerp(a.de.x, bx, e), z = lerp(a.de.z, bz, e);
      const ySol = k >= 0.82 ? by : pt.sol;
      const oeil = lerp(a.de.oeil, by + ASSIS.yeux, e);
      this.pincer(x, ySol, z, oeil);
      // le regard glisse vers le cadrage voulu (la souris reprend la main ensuite)
      const kr = lisse(clamp(a.t / (ASSIS.entree * 0.9), 0, 1));
      let dyaw = pt.yaw - a.de.yaw;
      dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      jeu.player.regarder(a.de.yaw + dyaw * kr, lerp(a.de.pitch, pt.pitch, kr));
      if (k >= 1) { a.phase = 'assis'; a.t = 0; a.depuis = 0; }
    } else if (a.phase === 'assis') {
      const respire = Math.sin(jeu.t * 0.9) * 0.012;
      this.pincer(bx, by, bz, by + ASSIS.yeux + respire);
      const bouge = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].some((c) => input.pressed(c));
      const e = input.pressed('KeyE') && !jeu.interact.cible;
      if (jeu.jouable && (bouge || e)) this.relever();
    } else {
      const k = clamp(a.t / ASSIS.sortie, 0, 1);
      const e = lisse(k);
      const x = lerp(a.de.x, sx, e), z = lerp(a.de.z, sz, e);
      const ySol = k < 0.4 ? by : pt.sol;
      const oeil = lerp(a.de.oeil, pt.sol + EYE, e);
      this.pincer(x, ySol, z, oeil);
      if (k >= 1) this.finir(false);
    }
  },

  // -------------------------------------------------------------------------
  update(dt, t, jeu) {
    tempsUniform.value = t;
    if (jeu.zones?.nom !== ZONE || !this.construit) return;
    if (this.assis) {
      this.majAssise(dt);
      if (this.objetRelever) this.objetRelever.position.copy(jeu.camera.position);
    }
    // balises clignotantes
    if (this.balisesLot?.mesh) {
      const m = this.balisesLot.mesh;
      const d = this.balisesDonnees;
      const col = new THREE.Color();
      for (let i = 0; i < d.length; i++) {
        const b = d[i];
        const ph = ((t / b.periode) + b.phase) % 1;
        let on = ph < 0.1;
        if (b.double) on = ph < 0.07 || (ph > 0.16 && ph < 0.23);
        col.copy(this.couleursBalises[i]).multiplyScalar(on ? 1 : 0.12);
        m.setColorAt(b.index, col);
      }
      m.instanceColor.needsUpdate = true;
    }
    if (this.bouleMesh) this.bouleMesh.rotation.y = t * 0.6;
    // première fois sur un toit
    if (!this.visite && jeu.enPartie && jeu.player.auSol && jeu.player.position.y > 8) {
      const { x, z, y } = jeu.player.position;
      if (this.liste.some((r) => Math.abs(x - r.x) < r.w / 2 && Math.abs(z - r.z) < r.d / 2 && Math.abs(y - r.h) < 0.6)) {
        this.visite = true;
        if (!jeu.etat.zonesVisitees.includes('toits')) {
          jeu.etat.zonesVisitees.push('toits');
          jeu.emettre('toits:premiere-visite', {});
        }
      }
    }
  },
};
