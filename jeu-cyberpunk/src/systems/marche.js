import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { jeu } from '../game.js';
import { rng } from '../textures.js';
import { TITRE_MARCHE, ENSEIGNES_MARCHE, OBJETS_MARCHE } from '../data/marche.js';

// Système « marche » : le Marché des Mains (夜の市場), bible §5.3, tâche 2.3.
//
// Lieu : la rue est-ouest z = 30 de Kasumi, de x = 45 à x = 139 (la rue qui part du
// carrefour (30, 30), au pied de la place de Hashira, vers le bord est où mène Kura). Elle
// longe la façade nord de la clinique (porte en (41, 44)) : à 20 m de la porte, 90 m de
// long. Aucun pâté réservé : les immeubles de la rue font le fond des étals. Au centre, la
// rue croise la rue x = 90 : c'est la place du marché (mât, tente, Oba).
//
// Le décor est fusionné par matériau (quelques appels de dessin au total) :
//   solide  : boîtes/cylindres/sphères à couleur de sommet (éclairés)
//   lueur   : mêmes primitives, émissives (néons, braises, fils de lumière)
//   enseignes : un atlas canvas, tous les panneaux dans un seul maillage
//   bâche   : plans translucides ; lampions : InstancedMesh ; vapeur : pool de particules.
//
// Repère des étals : (u, y, v) = (le long de la rue, hauteur au-dessus du trottoir, distance
// depuis le mur de fond vers l'allée). Côté nord (mur z = 19) l'allée est vers +z ; côté sud
// (mur z = 41) vers −z.

const ZONE = 'kasumi';
const MUR_N = 19;
const MUR_S = 41;
const AXE = 30; // z de l'axe de la rue
const SOL = 0.025; // chaussée
const TROTTOIR = 0.305; // dessus des trottoirs (0,3 m)
const X_OUEST = 45.4;
const X_EST = 139.4;
const X_PLACE = 90;
const LARGEUR_ETAL = 4.1;
const A0 = 46.0; // premier étal de la partie ouest
const B0 = 101.2; // premier étal de la partie est
const PLACE_W = 78.8;
const PLACE_E = 101.2;
const LIMITES = { minX: 44, maxX: 140.5, minZ: 18, maxZ: 42 };

const COUL = {
  bois: 0x4a2f7c,
  boisClair: 0x6a48a8,
  metal: 0x2e2a62,
  noir: 0x0b0718,
  magenta: 0xff2bd6,
  rose: 0xff5ad0,
  violet: 0xc44bff,
  violet2: 0x8a5cff,
  bleu: 0x4a7dff,
  blanc: 0xffd0f6,
  bleuPale: 0xbfd2ff,
};
const LAMPIONS = [0xff2bd6, 0xff2bd6, 0xff5ad0, 0xff5ad0, 0xc44bff, 0x8a5cff, 0x4a7dff, 0xffb8f0];
const TISSUS = [0x7a2a9a, 0xa02a7a, 0x3a3aa0, 0x5a2a80, 0x8a3a6a, 0x2a4a9a, 0x6a3ab0];

// ---------------------------------------------------------------------------
// Primitives fusionnées
// ---------------------------------------------------------------------------
const TPL = {
  boite: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 10),
  cyl6: new THREE.CylinderGeometry(1, 1, 1, 6),
  cone: new THREE.CylinderGeometry(0, 1, 1, 10),
  sph: new THREE.SphereGeometry(1, 10, 7),
  tore: new THREE.TorusGeometry(1, 0.1, 6, 18),
};
const M4 = new THREE.Matrix4();
const QU = new THREE.Quaternion();
const EU = new THREE.Euler();
const V3 = new THREE.Vector3();
const V3S = new THREE.Vector3();
const COL = new THREE.Color();

function creerLot() {
  return { geos: [] };
}

function poser(lot, tpl, couleur, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) {
  EU.set(rx, ry, rz, 'YXZ');
  QU.setFromEuler(EU);
  M4.compose(V3.set(x, y, z), QU, V3S.set(sx, sy, sz));
  const g = tpl.clone();
  g.applyMatrix4(M4);
  const n = g.attributes.position.count;
  const c = COL.set(couleur);
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[i * 3] = c.r;
    a[i * 3 + 1] = c.g;
    a[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  g.deleteAttribute('uv');
  lot.geos.push(g);
}

function maillage(lot, materiau) {
  if (!lot.geos.length) return null;
  const m = new THREE.Mesh(mergeGeometries(lot.geos, false), materiau);
  m.matrixAutoUpdate = false;
  return m;
}

// Mise à l'échelle d'une couleur (pour tamiser les néons).
const lum = (hex, k) => COL.set(hex).multiplyScalar(k).getHex();

// ---------------------------------------------------------------------------
// Atlas d'enseignes (un seul canvas, un seul maillage)
// ---------------------------------------------------------------------------
const POLICE = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans CJK JP", "Arial Black", Arial, sans-serif';

function dessinerEnseigne(g, w, h, texte, couleur, vertical = false) {
  g.fillStyle = 'rgba(8, 3, 26, 0.94)';
  g.fillRect(0, 0, w, h);
  g.shadowColor = couleur;
  g.shadowBlur = Math.min(w, h) * 0.1;
  g.strokeStyle = couleur;
  g.lineWidth = Math.min(w, h) * 0.04;
  const m = Math.min(w, h) * 0.07;
  g.strokeRect(m, m, w - 2 * m, h - 2 * m);
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const chars = [...texte];
  if (vertical) {
    const pas = (h - 2 * m) / chars.length;
    const taille = Math.min(w * 0.62, pas * 0.9);
    g.font = `900 ${taille}px ${POLICE}`;
    chars.forEach((ch, i) => {
      g.fillText(ch, w / 2, m + pas * (i + 0.5));
      g.fillText(ch, w / 2, m + pas * (i + 0.5));
    });
  } else {
    let taille = h * 0.6;
    g.font = `900 ${taille}px ${POLICE}`;
    const largeur = g.measureText(texte).width;
    if (largeur > w - 4 * m) {
      taille *= (w - 4 * m) / largeur;
      g.font = `900 ${taille}px ${POLICE}`;
    }
    g.fillText(texte, w / 2, h / 2 + taille * 0.04);
    g.fillText(texte, w / 2, h / 2 + taille * 0.04);
  }
  g.shadowBlur = 0;
}

function dessinerVeste(g, w, h) {
  g.fillStyle = '#1b1036';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#3d6bff';
  // manches et corps
  g.beginPath();
  g.moveTo(w * 0.34, h * 0.08);
  g.lineTo(w * 0.66, h * 0.08);
  g.lineTo(w * 0.9, h * 0.22);
  g.lineTo(w * 0.94, h * 0.95);
  g.lineTo(w * 0.8, h * 0.95);
  g.lineTo(w * 0.76, h * 0.42);
  g.lineTo(w * 0.74, h * 0.98);
  g.lineTo(w * 0.26, h * 0.98);
  g.lineTo(w * 0.24, h * 0.42);
  g.lineTo(w * 0.2, h * 0.95);
  g.lineTo(w * 0.06, h * 0.95);
  g.lineTo(w * 0.1, h * 0.22);
  g.closePath();
  g.fill();
  // revers et col
  g.fillStyle = '#6f93ff';
  g.beginPath();
  g.moveTo(w * 0.34, h * 0.08);
  g.lineTo(w * 0.5, h * 0.5);
  g.lineTo(w * 0.66, h * 0.08);
  g.lineTo(w * 0.58, h * 0.08);
  g.lineTo(w * 0.5, h * 0.28);
  g.lineTo(w * 0.42, h * 0.08);
  g.closePath();
  g.fill();
  g.fillStyle = '#1b1036';
  g.fillRect(w * 0.495, h * 0.5, w * 0.01, h * 0.48);
  // boutons, poches
  g.fillStyle = '#c9d6ff';
  for (let i = 0; i < 3; i++) {
    g.beginPath();
    g.arc(w * 0.46, h * (0.58 + i * 0.13), h * 0.028, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = '#27409a';
  g.lineWidth = 3;
  g.strokeRect(w * 0.28, h * 0.66, w * 0.14, h * 0.12);
  g.strokeRect(w * 0.58, h * 0.66, w * 0.14, h * 0.12);
  // peinture écaillée
  const r = rng(11);
  g.fillStyle = '#1b1036';
  for (let i = 0; i < 70; i++) g.fillRect(r() * w, r() * h, 2 + r() * 7, 1 + r() * 4);
}

function dessinerPapier(g, w, h) {
  g.fillStyle = '#d9cdf5';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#8a7cc0';
  const r = rng(5);
  for (let y = 38; y < h - 14; y += 12) g.fillRect(14, y, (w - 28) * (0.5 + r() * 0.5), 3);
  g.fillStyle = '#403060';
  g.fillRect(14, 14, w * 0.6, 8);
  g.strokeStyle = '#ff2bd6';
  g.lineWidth = 3;
  g.beginPath();
  g.ellipse(w * 0.48, 112, 46, 10, -0.05, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#ff2bd6';
  for (const [x, y] of [[8, 8], [w - 8, 8]]) {
    g.beginPath();
    g.arc(x, y, 5, 0, Math.PI * 2);
    g.fill();
  }
}

function dessinerSceau(g, w, h) {
  g.fillStyle = 'rgba(8, 3, 26, 0.95)';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#c44bff';
  g.shadowColor = '#c44bff';
  g.shadowBlur = 14;
  g.lineWidth = 6;
  g.strokeRect(10, 10, w - 20, h - 20);
  const r = rng(99);
  const cols = 16;
  const rows = 7;
  const couleurs = ['#ff2bd6', '#c44bff', '#8a5cff', '#4a7dff', '#ffd0f6'];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = 40 + i * ((w - 80) / (cols - 1));
      const y = 44 + j * ((h - 88) / (rows - 1));
      // les lampes du haut sont plus vives, celles du bas presque éteintes
      const clair = Math.max(0.05, 1 - j / (rows - 0.5) + (r() - 0.5) * 0.5);
      g.globalAlpha = Math.min(1, clair);
      g.shadowBlur = 10 * clair;
      g.shadowColor = '#ff5ad0';
      g.fillStyle = couleurs[Math.floor(r() * couleurs.length)];
      g.beginPath();
      g.arc(x, y, 8 + clair * 4, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.globalAlpha = 1;
  g.shadowBlur = 0;
}

function dessinerPegboard(g, w, h) {
  g.fillStyle = '#150d2a';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#3a2a66';
  for (let y = 12; y < h; y += 16) for (let x = 12; x < w; x += 16) g.fillRect(x, y, 3, 3);
  g.strokeStyle = '#a58cff';
  g.lineWidth = 5;
  g.lineCap = 'round';
  const trait = (x1, y1, x2, y2) => { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); };
  trait(40, 30, 40, 150); g.strokeRect(28, 20, 24, 26);
  trait(100, 30, 130, 170); trait(130, 170, 118, 176);
  trait(180, 40, 240, 40); trait(180, 40, 180, 110); trait(240, 40, 240, 110);
  trait(300, 25, 300, 190); trait(290, 190, 310, 190);
  g.beginPath(); g.arc(380, 70, 28, 0, Math.PI * 2); g.stroke();
  trait(380, 98, 380, 180);
  trait(440, 30, 470, 30); trait(455, 30, 455, 200);
  g.fillStyle = '#ff5ad0';
  for (const [x, y] of [[40, 24], [130, 172], [300, 28], [455, 205], [380, 44]]) { g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill(); }
}

function construireAtlas() {
  const E = ENSEIGNES_MARCHE;
  const sign = (cle, w, h, couleur, vertical = false) => ({ cle, w, h, dessin: (g) => dessinerEnseigne(g, w, h, E[cle].texte, couleur, vertical) });
  const cellules = [
    sign('mat', 256, 1024, '#ff5ad0', true),
    sign('arche', 1024, 256, '#ff2bd6'),
    sign('the', 768, 192, '#ff5ad0'),
    sign('atelier', 768, 192, '#4a7dff'),
    { cle: 'veste', w: 384, h: 192, dessin: (g) => dessinerVeste(g, 384, 192) },
    { cle: 'papier', w: 192, h: 256, dessin: (g) => dessinerPapier(g, 192, 256) },
    { cle: 'tableauSceau', w: 640, h: 320, dessin: (g) => dessinerSceau(g, 640, 320) },
    { cle: 'pegboard', w: 512, h: 256, dessin: (g) => dessinerPegboard(g, 512, 256) },
    sign('main', 256, 256, '#c44bff'),
    sign('sceau', 512, 128, '#c44bff'),
    sign('promo', 512, 128, '#ff5ad0'),
    sign('zero', 256, 96, '#ff2bd6'),
    sign('nouilles', 512, 128, '#ff2bd6'),
    sign('fleurs', 512, 128, '#ff5ad0'),
    sign('reprise', 512, 128, '#c44bff'),
    sign('chants', 512, 128, '#4a7dff'),
    sign('veilles', 512, 128, '#8a5cff'),
    sign('pret', 512, 128, '#4a7dff'),
    sign('graines', 512, 128, '#c44bff'),
    sign('raviolis', 512, 128, '#ff5ad0'),
    sign('trappe', 512, 128, '#4a7dff'),
    sign('lanternes', 512, 128, '#ff5ad0'),
    sign('soupe', 512, 128, '#ff2bd6'),
    sign('grill', 512, 128, '#ff2bd6'),
    sign('pieces', 512, 128, '#4a7dff'),
  ];
  // rangement en étagères
  const LARG = 2048;
  cellules.sort((a, b) => b.h - a.h);
  let x = 0;
  let y = 0;
  let hLigne = 0;
  const PAD = 4;
  for (const c of cellules) {
    if (x + c.w + PAD > LARG) {
      x = 0;
      y += hLigne + PAD;
      hLigne = 0;
    }
    c.x = x;
    c.y = y;
    x += c.w + PAD;
    hLigne = Math.max(hLigne, c.h);
  }
  const HAUT = 2048;
  const cv = document.createElement('canvas');
  cv.width = LARG;
  cv.height = HAUT;
  const g = cv.getContext('2d');
  const rects = {};
  for (const c of cellules) {
    g.save();
    g.translate(c.x, c.y);
    g.beginPath();
    g.rect(0, 0, c.w, c.h);
    g.clip();
    c.dessin(g);
    g.restore();
    rects[c.cle] = { u0: (c.x + 1) / LARG, u1: (c.x + c.w - 1) / LARG, v0: 1 - (c.y + c.h - 1) / HAUT, v1: 1 - (c.y + 1) / HAUT };
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { tex, rects };
}

// ---------------------------------------------------------------------------
// Sol : planches mouillées
// ---------------------------------------------------------------------------
function textureSol() {
  const N = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d');
  const r = rng(321);
  g.fillStyle = '#150c28';
  g.fillRect(0, 0, N, N);
  const lignes = 8;
  const h = N / lignes;
  for (let j = 0; j < lignes; j++) {
    let x = -r() * 120;
    while (x < N) {
      const l = 110 + r() * 150;
      const t = r();
      g.fillStyle = `rgb(${46 + t * 30}, ${26 + t * 16}, ${84 + t * 40})`;
      g.fillRect(x, j * h, l, h);
      g.fillStyle = 'rgba(6, 2, 16, 0.85)';
      g.fillRect(x, j * h, 2, h);
      x += l;
    }
    g.fillStyle = 'rgba(6, 2, 16, 0.9)';
    g.fillRect(0, j * h, N, 2);
    // reflet mouillé le long de certaines planches
    if (r() < 0.45) {
      const gr = g.createLinearGradient(0, j * h, 0, (j + 1) * h);
      gr.addColorStop(0, 'rgba(255,60,200,0)');
      gr.addColorStop(0.5, `rgba(255,90,210,${0.1 + r() * 0.13})`);
      gr.addColorStop(1, 'rgba(255,60,200,0)');
      g.fillStyle = gr;
      g.fillRect(0, j * h, N, h);
    }
  }
  // clous
  g.fillStyle = 'rgba(160,120,255,0.35)';
  for (let i = 0; i < 90; i++) g.fillRect(r() * N, Math.floor(r() * lignes) * h + h * 0.5, 2, 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function textureLampion() {
  const cv = document.createElement('canvas');
  cv.width = 8;
  cv.height = 64;
  const g = cv.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 64);
  gr.addColorStop(0, '#5a5a5a');
  gr.addColorStop(0.12, '#ffffff');
  gr.addColorStop(0.5, '#ffffff');
  gr.addColorStop(0.88, '#ffffff');
  gr.addColorStop(1, '#5a5a5a');
  g.fillStyle = gr;
  g.fillRect(0, 0, 8, 64);
  g.fillStyle = 'rgba(0,0,0,0.38)';
  for (let y = 10; y < 60; y += 8) g.fillRect(0, y, 8, 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function textureHalo() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  gr.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function textureVapeur() {
  const N = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d');
  const r = rng(77);
  g.fillStyle = 'rgba(0,0,0,0)';
  for (let i = 0; i < 9; i++) {
    const x = N / 2 + (r() - 0.5) * N * 0.4;
    const y = N / 2 + (r() - 0.5) * N * 0.4;
    const gr = g.createRadialGradient(x, y, 0, x, y, N * (0.2 + r() * 0.14));
    gr.addColorStop(0, 'rgba(255,255,255,0.55)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, N, N);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

// Visage du Kiosque : deux yeux pixelisés, bouche de commerçant, clignement.
function creerVisage() {
  const cv = document.createElement('canvas');
  cv.width = 96;
  cv.height = 64;
  const g = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  let etatPrec = '';
  function dessiner(clin, regard, sourire) {
    const cle = `${clin}|${regard}|${sourire}`;
    if (cle === etatPrec) return;
    etatPrec = cle;
    g.fillStyle = '#24104a';
    g.fillRect(0, 0, 96, 64);
    g.fillStyle = '#2e1660';
    for (let y = 0; y < 64; y += 4) g.fillRect(0, y, 96, 1);
    g.fillStyle = '#ffd0f6';
    const ey = clin ? 26 : 20;
    const eh = clin ? 3 : 16;
    g.fillRect(20 + regard, ey, 14, eh);
    g.fillRect(62 + regard, ey, 14, eh);
    if (!clin) {
      g.fillStyle = '#ff2bd6';
      g.fillRect(24 + regard, 24, 6, 8);
      g.fillRect(66 + regard, 24, 6, 8);
    }
    g.fillStyle = '#ff5ad0';
    const bouche = sourire ? [[30, 48], [34, 52], [38, 54], [48, 54], [58, 54], [62, 52], [66, 48]] : [[30, 50], [40, 52], [56, 52], [66, 50]];
    for (const [x, y] of bouche) g.fillRect(x, y, 6, 4);
    tex.needsUpdate = true;
  }
  dessiner(false, 0, true);
  return { tex, dessiner };
}

// ---------------------------------------------------------------------------
// Système
// ---------------------------------------------------------------------------
export const marche = {
  nom: 'marche',

  // --- Exposé pour les autres systèmes (voir init) ---
  zone: ZONE,
  limites: LIMITES,
  centre: new THREE.Vector3(X_PLACE, 0, AXE),
  entrees: [],
  ancres: {},
  approches: {},
  pointsFragments: [],
  allees: [],
  groupe: null,

  preparer() {
    // Rien à réserver : le marché occupe la rue z = 30 ; les immeubles qui la bordent
    // servent de fond aux étals.
  },

  init(jeu) {
    const k = jeu.zones.get(ZONE);
    const scene = k.scene;
    const rand = rng(4242);
    const groupe = new THREE.Group();
    groupe.name = 'marche';
    this.groupe = groupe;
    scene.add(groupe);

    const solide = creerLot();
    const lueur = creerLot();
    const colliders = [];
    const lampions = []; // { x, y, z, c, s, ph }
    const emetteurs = []; // vapeur : { x, y, z, taux }
    const planches = []; // { cle, w, h, x, y, z, rx, ry, rz }
    const interactions = [];

    const { tex: atlasTex, rects } = construireAtlas();

    // ---------- Outils de pose, en repère monde ----------
    const boiteM = (w, h, d, x, y, z, col, o = {}) =>
      poser(o.lueur ? lueur : solide, TPL.boite, col, x, y, z, w, h, d, o.rx, o.ry, o.rz);
    const cylM = (r, h, x, y, z, col, o = {}) =>
      poser(o.lueur ? lueur : solide, o.six ? TPL.cyl6 : TPL.cyl, col, x, y, z, r, h, o.rz === undefined ? r : r, o.rx, o.ry, o.rz);
    const sphM = (r, x, y, z, col, o = {}) =>
      poser(o.lueur ? lueur : solide, TPL.sph, col, x, y, z, r, r * (o.sy ?? 1), r);
    const planM = (cle, w, h, x, y, z, rx = 0, ry = 0) => planches.push({ cle, w, h, x, y, z, rx, ry });
    const lampion = (x, y, z, c = null, s = 1) =>
      lampions.push({ x, y, z, c: c ?? LAMPIONS[Math.floor(rand() * LAMPIONS.length)], s, ph: rand() * 6.28 });
    const vapeur = (x, y, z, taux = 1) => emetteurs.push({ x, y, z, taux });
    const collider = (x0, x1, z0, z1) =>
      colliders.push({ minX: Math.min(x0, x1), maxX: Math.max(x0, x1), minZ: Math.min(z0, z1), maxZ: Math.max(z0, z1) });

    // ---------- Un étal : repère local (u, y, v) ----------
    const repere = (cote, cx, murForce = null) => {
      const s = cote === 'N' ? 1 : -1;
      const mur = murForce ?? (cote === 'N' ? MUR_N : MUR_S);
      const flip = cote === 'N' ? 0 : Math.PI;
      const X = (u) => cx + s * u;
      const Z = (v) => mur + s * v;
      const Y = (y) => TROTTOIR + y;
      return {
        s, cx, mur,
        X, Z, Y,
        b: (w, h, d, u, y, v, col, o = {}) => boiteM(w, h, d, X(u), Y(y), Z(v), col, { ...o, ry: flip + (o.ry ?? 0) }),
        c: (r, h, u, y, v, col, o = {}) => cylM(r, h, X(u), Y(y), Z(v), col, o),
        sp: (r, u, y, v, col, o = {}) => sphM(r, X(u), Y(y), Z(v), col, o),
        plan: (cle, w, h, u, y, v, rx = 0, ry = 0) => planM(cle, w, h, X(u), Y(y), Z(v), rx, flip + ry),
        lamp: (u, y, v, c, sc) => lampion(X(u), Y(y), Z(v), c, sc),
        vap: (u, y, v, t) => vapeur(X(u), Y(y), Z(v), t),
        col: (u0, u1, v0, v1) => collider(X(u0), X(u1), Z(v0), Z(v1)),
        pt: (u, y, v) => new THREE.Vector3(X(u), Y(y), Z(v)),
      };
    };

    // Ossature commune : comptoir, poteaux, auvent, rideau, enseigne, lampions.
    function ossature(R, w, accent, cle, o = {}) {
      const prof = o.prof ?? 2.6;
      const demi = w / 2;
      // plateforme (là où l'étal est sur la chaussée : place)
      if (o.plateforme) R.b(w, 0.31, prof + 0.4, 0, -0.155, (prof + 0.4) / 2, COUL.metal);
      // mur de fond (cloison) pour les étals de la place
      if (o.cloison) {
        R.b(w, o.hCloison ?? 3.6, 0.3, 0, (o.hCloison ?? 3.6) / 2, 0.15, 0x1c1238);
        R.b(w, 0.05, 0.05, 0, o.hCloison ?? 3.6, 0.2, lum(accent, 0.7), { lueur: true });
      }
      if (!o.sansComptoir) {
        R.b(w - 0.2, 0.9, 0.9, 0, 0.45, prof - 0.45, COUL.bois);
        R.b(w - 0.05, 0.07, 1.04, 0, 0.935, prof - 0.45, COUL.boisClair);
        R.b(w - 0.1, 0.035, 0.035, 0, 0.88, prof + 0.04, lum(accent, 0.75), { lueur: true });
      }
      for (const sg of [-1, 1]) {
        R.b(0.09, 3.1, 0.09, sg * (demi - 0.1), 1.55, prof - 0.1, COUL.metal);
        R.b(0.09, 3.5, 0.09, sg * (demi - 0.1), 1.75, 0.15, COUL.metal);
      }
      // auvent incliné (le devant est plus bas)
      const dz = prof + 0.35;
      const pente = Math.atan2(0.5, dz);
      const tissu = TISSUS[Math.floor(rand() * TISSUS.length)];
      R.b(w + 0.3, 0.05, Math.hypot(dz, 0.5), 0, 3.25, dz / 2 - 0.05, tissu, { rx: pente });
      R.b(w + 0.3, 0.05, 0.05, 0, 2.99, prof + 0.3, lum(accent, 0.85), { lueur: true });
      // rideau de noren
      const n = Math.max(3, Math.round(w / 0.62));
      for (let i = 0; i < n; i++) {
        const u = -demi + (w / n) * (i + 0.5);
        R.b(w / n - 0.06, 0.55, 0.02, u, 2.68, prof + 0.28, TISSUS[(i + Math.floor(rand() * 3)) % TISSUS.length]);
      }
      // enseigne au-dessus de l'auvent, inclinée vers le passant
      if (cle) R.plan(cle, Math.min(2.4, w - 0.4), Math.min(2.4, w - 0.4) / 4, 0, 3.82, prof - 0.2, 0.22);
      R.lamp(-demi + 0.25, 2.65, prof + 0.4, null, 0.8);
      R.lamp(demi - 0.25, 2.65, prof + 0.4, null, 0.8);
      // ligne de la Loi : un fil de lumière sur le sol devant l'étal (éteint pour l'étal sans ligne)
      if (!o.sansLigne) {
        R.b(w - 0.5, 0.012, 0.07, 0, -0.29, prof + 0.5, lum(accent, 0.55), { lueur: true });
      } else {
        R.b(w - 0.5, 0.012, 0.07, 0, -0.29, prof + 0.5, 0x1a1030, { lueur: true });
      }
      R.col(-demi, demi, 0, prof + 0.1);
    }

    // ---------- Les marchandises, par type d'étal ----------
    const bolsGlow = (R, u, v, y = 0.98) => {
      R.c(0.14, 0.1, u, y, v, 0x3a2a70);
      R.c(0.12, 0.02, u, y + 0.055, v, lum(0xffa0e8, 0.8), { lueur: true });
    };

    const TYPES = {
      nouilles(R, w, o) {
        ossature(R, w, COUL.magenta, 'nouilles', o);
        R.c(0.4, 0.5, -w / 2 + 0.7, 1.2, 1.7, COUL.metal);
        R.c(0.34, 0.03, -w / 2 + 0.7, 1.46, 1.7, lum(0xff3a9a, 0.8), { lueur: true });
        R.vap(-w / 2 + 0.7, 1.55, 1.7, 1.4);
        for (let i = 0; i < 5; i++) bolsGlow(R, -0.3 + i * 0.38, 2.4);
        R.vap(0.1, 1.15, 2.4, 0.8);
        R.b(0.5, 0.35, 0.4, w / 2 - 0.6, 1.17, 1.6, COUL.boisClair);
      },
      soupe(R, w, o) {
        ossature(R, w, COUL.magenta, 'soupe', o);
        R.c(0.55, 0.6, 0, 1.25, 1.6, COUL.metal);
        R.c(0.48, 0.04, 0, 1.56, 1.6, lum(0xff2bd6, 0.7), { lueur: true });
        R.vap(0, 1.7, 1.6, 2);
        R.vap(-0.9, 1.1, 2.3, 0.8);
        for (let i = 0; i < 4; i++) {
          R.c(0.03, 0.55, 0.9 + i * 0.12, 1.28, 2.2, COUL.metal, { rz: 0.4 });
        }
        for (let i = 0; i < 4; i++) bolsGlow(R, -1.5 + i * 0.4, 2.4);
      },
      grill(R, w, o) {
        ossature(R, w, COUL.magenta, 'grill', o);
        R.b(1.6, 0.5, 0.7, 0, 1.2, 1.9, COUL.metal);
        R.b(1.4, 0.04, 0.5, 0, 1.46, 1.9, lum(0xff2b8a, 1.0), { lueur: true });
        for (let i = 0; i < 7; i++) R.c(0.015, 1.1, -0.58 + i * 0.19, 1.55, 1.9, COUL.bleuPale, { rx: Math.PI / 2 });
        R.vap(0, 1.6, 1.9, 2);
        R.vap(0.4, 1.6, 1.9, 1);
        R.b(0.6, 0.35, 0.5, -w / 2 + 0.6, 1.1, 1.8, COUL.boisClair);
      },
      raviolis(R, w, o) {
        ossature(R, w, COUL.rose, 'raviolis', o);
        for (let i = 0; i < 3; i++) {
          R.c(0.34, 0.14, -0.7 + i * 0.7, 1.05 + i * 0.0, 2.1, 0xb8a0e8);
          R.c(0.36, 0.05, -0.7 + i * 0.7, 1.15, 2.1, 0x6a4ab0);
          R.c(0.3, 0.14, -0.7 + i * 0.7, 1.28, 2.1, 0xb8a0e8);
          R.vap(-0.7 + i * 0.7, 1.45, 2.1, 1.1);
        }
        for (let i = 0; i < 3; i++) R.b(0.35, 0.04, 0.35, 1.2 + i * 0.01, 0.98 + i * 0.04, 2.2, 0xe0d0ff);
      },
      fleurs(R, w, o) {
        ossature(R, w, COUL.rose, 'fleurs', o);
        const n = Math.max(3, Math.floor((w - 0.6) / 0.62));
        for (let i = 0; i < n; i++) {
          const u = -((n - 1) * 0.62) / 2 + i * 0.62;
          R.c(0.18, 0.34, u, 1.15, 2.2, 0x20183e);
          for (let j = 0; j < 4; j++) {
            const c = [0xff5ad0, 0xc44bff, 0xffd0f6, 0x8a5cff, 0x4a7dff][Math.floor(rand() * 5)];
            R.sp(0.1 + rand() * 0.04, u + (rand() - 0.5) * 0.28, 1.5 + rand() * 0.28, 2.2 + (rand() - 0.5) * 0.2, c, { lueur: rand() < 0.4 });
          }
          R.c(0.012, 0.4, u, 1.4, 2.2, 0x2a1a50);
          // fil lumineux noué : l'étiquette de la ligne
          R.sp(0.03, u + 0.14, 1.34, 2.38, lum(COUL.rose, 0.9), { lueur: true });
        }
        R.b(w - 0.6, 0.04, 0.5, 0, 2.45, 0.7, COUL.boisClair);
        for (let i = 0; i < 6; i++) R.c(0.07, 0.2, -1.4 + i * 0.55, 2.58, 0.7, 0x20183e);
      },
      reprise(R, w, o) {
        ossature(R, w, COUL.violet, 'reprise', o);
        R.b(w - 0.4, 0.04, 0.04, 0, 2.35, 1.4, COUL.metal);
        const n = Math.max(3, Math.floor((w - 0.6) / 0.62));
        for (let i = 0; i < n; i++) {
          const u = -((n - 1) * 0.62) / 2 + i * 0.62;
          const t = TISSUS[(i * 3 + 1) % TISSUS.length];
          R.b(0.5, 1.05 + rand() * 0.25, 0.07, u, 1.72, 1.4, t, { rz: (rand() - 0.5) * 0.08 });
          R.b(0.14, 0.7, 0.07, u + 0.3, 1.9, 1.4, t);
          R.b(0.14, 0.7, 0.07, u - 0.3, 1.9, 1.4, t);
          R.b(0.2, 0.03, 0.02, u + 0.05, 1.88, 1.45, lum(COUL.violet, 0.8), { lueur: true });
        }
        // machine à coudre et bobines
        R.b(0.55, 0.3, 0.3, 0.9, 1.1, 2.4, COUL.metal);
        R.b(0.14, 0.3, 0.14, 0.78, 1.38, 2.4, COUL.metal);
        for (let i = 0; i < 5; i++) R.c(0.05, 0.1, -0.9 + i * 0.16, 1.0, 2.5, TISSUS[i % TISSUS.length]);
      },
      graines(R, w, o) {
        ossature(R, w, COUL.violet, 'graines', o);
        for (let i = 0; i < 6; i++) {
          const u = -1.3 + (i % 3) * 0.6;
          const v = 2.0 + Math.floor(i / 3) * 0.32;
          R.c(0.14, 0.2, u, 1.05, v, 0x4a2a60);
          R.sp(0.12, u, 1.27, v, lum(i % 2 ? 0x7a5cff : 0x4a7dff, 0.8), { sy: 1.4, lueur: true });
        }
        R.b(w - 0.8, 0.04, 0.4, 0, 1.9, 0.6, COUL.boisClair);
        for (let i = 0; i < 9; i++) R.b(0.18, 0.26, 0.04, -1.5 + i * 0.37, 2.06, 0.62, TISSUS[i % TISSUS.length]);
        R.b(0.05, 0.6, 0.05, w / 2 - 0.5, 1.3, 1.8, COUL.boisClair, { rz: 0.2 });
        R.b(0.18, 0.02, 0.22, w / 2 - 0.4, 1.0, 1.8, COUL.metal, { rz: 0.2 });
      },
      pret(R, w, o) {
        ossature(R, w, COUL.bleu, 'pret', o);
        R.b(w - 0.4, 0.04, 0.04, 0, 2.5, 1.2, COUL.metal);
        const n = Math.max(3, Math.floor((w - 0.5) / 0.7));
        for (let i = 0; i < n; i++) {
          const u = -((n - 1) * 0.7) / 2 + i * 0.7;
          R.c(0.012, 0.5, u, 2.22, 1.2, COUL.metal);
          poser(solide, TPL.cone, TISSUS[(i + 2) % TISSUS.length], R.X(u), R.Y(1.58), R.Z(1.2), 0.3, 0.55, 0.3);
          R.b(0.012, 0.012, 0.02, u, 2.05, 1.2, COUL.bleuPale, { lueur: true });
        }
        R.c(0.14, 0.34, w / 2 - 0.5, 1.15, 2.2, COUL.metal);
        R.c(0.1, 0.06, w / 2 - 0.5, 1.37, 2.2, lum(COUL.blanc, 0.9), { lueur: true });
        R.b(0.5, 0.42, 0.06, -w / 2 + 0.6, 1.2, 2.1, COUL.boisClair, { rz: 0.12 });
        R.b(0.5, 0.04, 0.3, -w / 2 + 0.6, 1.0, 2.1, COUL.boisClair);
      },
      lanternes(R, w, o) {
        ossature(R, w, COUL.rose, 'lanternes', o);
        for (let i = 0; i < 6; i++) {
          const u = -1.4 + i * 0.56;
          R.sp(0.2, u, 1.25 + (i % 2) * 0.05, 2.2, lum(LAMPIONS[(i * 2 + 1) % LAMPIONS.length], 0.45), { sy: 1.3, lueur: true });
        }
        for (let i = 0; i < 4; i++) {
          R.lamp(-1.1 + i * 0.75, 2.3, 1.2, LAMPIONS[(i + 3) % LAMPIONS.length], 0.9);
        }
      },
      chants(R, w, o) {
        ossature(R, w, COUL.bleu, 'chants', { ...o, sansComptoir: true });
        R.c(0.02, 1.6, 0, 1.0, 1.9, COUL.metal);
        R.c(0.2, 0.03, 0, 0.2, 1.9, COUL.metal);
        R.sp(0.07, 0, 1.85, 1.9, lum(COUL.bleuPale, 1.0), { lueur: true });
        R.c(0.9, 0.012, 0, -0.29, 1.9, lum(0x2a4aa8, 0.9), { lueur: true });
        R.b(1.8, 0.4, 0.45, 0, 0.2, 0.9, COUL.boisClair);
        R.b(0.5, 0.7, 0.4, w / 2 - 0.5, 0.35, 1.0, COUL.metal);
        R.c(0.17, 0.02, w / 2 - 0.5, 0.65, 1.22, lum(0xff5ad0, 0.8), { lueur: true });
        R.c(0.09, 0.02, w / 2 - 0.5, 0.35, 1.22, lum(0xff5ad0, 0.8), { lueur: true });
        for (let i = 0; i < 6; i++) R.b(0.2, 0.28, 0.01, -1.2 + i * 0.4, 2.2, 0.4, 0xd9cdf5, { rz: (rand() - 0.5) * 0.2 });
        R.col(-0.3, 0.3, 0, 2.6);
      },
      veilles(R, w, o) {
        ossature(R, w, COUL.violet2, 'veilles', o);
        R.b(2.7, 1.6, 0.08, 0, 1.9, 0.5, COUL.bois);
        for (let j = 0; j < 3; j++) {
          for (let i = 0; i < 8; i++) {
            const allume = rand() < 0.55;
            const u = -1.2 + i * 0.34;
            R.b(0.012, 0.18, 0.012, u, 2.4 - j * 0.45, 0.58, COUL.metal);
            R.sp(0.065, u, 2.26 - j * 0.45, 0.6, allume ? lum(COUL.rose, 0.95) : 0x2a1a50, { lueur: allume });
          }
        }
        R.b(0.4, 0.04, 0.3, 0.6, 0.98, 2.4, 0xd9cdf5);
        R.c(0.02, 0.2, -0.5, 1.1, 2.4, COUL.bleuPale, { rz: 0.5 });
      },
      pieces(R, w, o) {
        ossature(R, w, COUL.bleu, 'pieces', o);
        for (let j = 0; j < 3; j++) {
          for (let i = 0; i < 7; i++) {
            R.b(0.44, 0.34, 0.2, -1.4 + i * 0.47, 1.45 + j * 0.4, 0.4, COUL.metal);
            R.b(0.08, 0.02, 0.02, -1.4 + i * 0.47, 1.45 + j * 0.4, 0.52, lum(COUL.bleu, 0.8), { lueur: true });
          }
        }
        for (let i = 0; i < 6; i++) {
          R.c(0.1 + rand() * 0.06, 0.04, -1.3 + i * 0.5, 1.0, 2.3, COUL.bleuPale, { six: true });
        }
        R.b(0.4, 0.2, 0.3, 1.2, 1.05, 2.0, COUL.metal);
      },
      sceau(R, w, o) {
        ossature(R, w, COUL.violet, 'sceau', o);
        R.b(0.8, 0.05, 0.55, -0.9, 0.99, 2.2, 0xd9cdf5, { ry: 0.1 });
        R.b(0.5, 0.03, 0.4, 0.7, 0.98, 2.2, 0x35286a);
        for (let i = 0; i < 5; i++) R.sp(0.04, 0.2 + i * 0.18, 1.05, 2.5, lum([COUL.rose, COUL.violet, COUL.bleu][i % 3], 0.9), { lueur: true });
      },
      trappe(R, w, o) {
        // pas de comptoir : une trappe dans le mur de fond, des caisses
        ossature(R, w, COUL.bleu, 'trappe', { ...o, sansComptoir: true });
        R.b(1.6, 1.2, 0.15, 0, 0.9, 0.2, 0x140c26);
        R.b(1.4, 0.95, 0.08, 0, 0.9, 0.3, COUL.metal);
        R.b(1.5, 0.04, 0.05, 0, 1.4, 0.34, lum(COUL.bleu, 0.9), { lueur: true });
        R.b(1.5, 0.04, 0.05, 0, 0.4, 0.34, lum(COUL.bleu, 0.9), { lueur: true });
        R.b(0.04, 1.0, 0.05, -0.75, 0.9, 0.34, lum(COUL.bleu, 0.9), { lueur: true });
        R.b(0.04, 1.0, 0.05, 0.75, 0.9, 0.34, lum(COUL.bleu, 0.9), { lueur: true });
        R.b(1.2, 0.08, 0.7, 0, 0.32, 0.8, COUL.metal);
        for (let i = 0; i < 4; i++) {
          const u = -1.3 + (i % 2) * 2.6 + (i > 1 ? 0.0 : 0);
          R.b(0.7, 0.5 + (i % 2) * 0.2, 0.55, i < 2 ? -1.2 + i * 0.1 : 1.2, 0.35 + (i % 2) * 0.1, 1.0 + (i > 1 ? 0.2 : 0), COUL.boisClair);
        }
        R.b(0.5, 0.03, 0.02, -1.2, 0.5, 1.29, lum(COUL.blanc, 0.8), { lueur: true });
        R.b(0.5, 0.03, 0.02, 1.2, 0.5, 1.49, lum(COUL.blanc, 0.8), { lueur: true });
        R.col(-w / 2, w / 2, 0, 2.0);
      },
    };

    // ---------- Étal générique + interaction ----------
    const etal = (cote, cx, type, w = LARGEUR_ETAL - 0.35, opts = {}) => {
      const R = repere(cote, cx, opts.mur ?? null);
      TYPES[type](R, w, opts);
      if (opts.interaction) {
        const p = R.pt(0, 0.9, 2.4);
        interactions.push({ cle: opts.interaction, position: p });
      }
      return R;
    };

    // ---------- Plan de la rue ----------
    const xA = (i) => A0 + LARGEUR_ETAL * (i + 0.5);
    const xB = (i) => B0 + LARGEUR_ETAL * (i + 0.5);

    // Partie ouest, côté nord (face à la clinique : le Kiosque accueille).
    const NA = ['kiosque', 'nouilles', 'fleurs', 'reprise', 'graines', 'grill', 'trappe', 'soupe'];
    const SA = ['lanternes', 'pret', 'nouilles', 'chants', 'raviolis', 'pieces', 'veilles', 'fleurs'];
    const INT_A = { nouilles: 'nouilles', fleurs: 'fleurs', reprise: 'reprise', graines: 'graines', trappe: 'trappe' };
    NA.forEach((t, i) => {
      if (t === 'kiosque') return;
      etal('N', xA(i), t, undefined, { interaction: INT_A[t] });
    });
    SA.forEach((t, i) => {
      const o = {};
      if (t === 'pret') o.interaction = 'pret';
      if (t === 'chants') o.interaction = 'chants';
      if (t === 'veilles') o.interaction = 'veilles';
      if (t === 'raviolis') { o.interaction = 'raviolis'; o.sansLigne = true; }
      etal('S', xA(i), t, undefined, o);
    });
    // Partie est
    const NB = ['fleurs', 'nouilles', 'grill', 'pieces', 'atelier', null, 'lanternes', 'reprise', 'soupe'];
    const SB = ['nouilles', 'fleurs', 'raviolis', 'graines', 'pret', 'chants', 'veilles', 'trappe', 'lanternes'];
    NB.forEach((t, i) => {
      if (!t || t === 'atelier') return;
      etal('N', xB(i), t);
    });
    SB.forEach((t, i) => etal('S', xB(i), t));

    // Place : cloisons et étals plus larges
    const placeW = PLACE_W + 3.6;
    const placeE = PLACE_E - 3.6;
    etal('N', placeW, 'soupe', 7.0, { plateforme: true, cloison: true });
    etal('N', placeE, 'fleurs', 7.0, { plateforme: true, cloison: true });
    const RSceau = etal('S', placeW, 'sceau', 7.0, { plateforme: true, cloison: true, interaction: 'sceau' });
    planM('tableauSceau', 5.2, 2.6, RSceau.X(0), RSceau.Y(1.95), RSceau.Z(0.34), 0, Math.PI);

    // ---------- Le Kiosque à la veste bleue ----------
    const visage = creerVisage();
    let kiosque;
    {
      const R = repere('N', xA(0));
      kiosque = R;
      R.b(2.3, 2.4, 1.8, 0, 1.2, 1.3, 0x22113e);
      R.b(2.5, 0.12, 2.3, 0, 2.46, 1.35, 0x1a0e34);
      R.b(2.5, 0.04, 0.04, 0, 2.38, 2.5, lum(COUL.rose, 0.9), { lueur: true });
      // cadre de l'écran
      R.b(1.7, 0.08, 0.06, 0, 2.28, 2.22, lum(COUL.violet, 0.8), { lueur: true });
      R.b(1.7, 0.08, 0.06, 0, 1.2, 2.22, lum(COUL.violet, 0.8), { lueur: true });
      R.b(0.08, 1.16, 0.06, -0.81, 1.74, 2.22, lum(COUL.violet, 0.8), { lueur: true });
      R.b(0.08, 1.16, 0.06, 0.81, 1.74, 2.22, lum(COUL.violet, 0.8), { lueur: true });
      // tablette de service et vitrine d'objets fantômes
      R.b(2.5, 0.08, 0.6, 0, 0.93, 2.45, COUL.boisClair);
      R.b(2.46, 0.035, 0.035, 0, 0.88, 2.76, lum(COUL.rose, 0.8), { lueur: true });
      for (let i = 0; i < 3; i++) {
        const u = -0.7 + i * 0.7;
        const t = lum(COUL.bleuPale, 0.55);
        R.b(0.34, 0.015, 0.015, u, 1.0, 2.4, t, { lueur: true });
        R.b(0.34, 0.015, 0.015, u, 1.32, 2.4, t, { lueur: true });
        R.b(0.015, 0.34, 0.015, u - 0.17, 1.17, 2.4, t, { lueur: true });
        R.b(0.015, 0.34, 0.015, u + 0.17, 1.17, 2.4, t, { lueur: true });
      }
      // haut-parleurs, antenne, enseigne
      R.c(0.14, 0.04, -0.95, 2.0, 2.24, lum(COUL.rose, 0.8), { lueur: true, rx: Math.PI / 2 });
      R.c(0.14, 0.04, 0.95, 2.0, 2.24, lum(COUL.rose, 0.8), { lueur: true, rx: Math.PI / 2 });
      R.c(0.015, 0.9, 0.9, 2.95, 1.0, COUL.metal);
      R.sp(0.07, 0.9, 3.42, 1.0, lum(COUL.magenta, 1.0), { lueur: true });
      R.c(0.02, 1.0, -1.1, 3.0, 2.3, COUL.metal);
      R.plan('promo', 1.9, 0.475, -0.4, 3.35, 2.3, 0.15);
      R.plan('zero', 0.55, 0.2, 1.25, 1.0, 2.62, 0, 0);
      // veste bleue peinte sur la façade du bas
      R.plan('veste', 1.7, 0.85, 0, 0.5, 2.215);
      // noren
      for (let i = 0; i < 7; i++) R.b(0.3, 0.5, 0.02, -0.9 + i * 0.3, 2.62, 2.58, TISSUS[(i + 1) % TISSUS.length]);
      R.lamp(-1.3, 2.6, 2.7, COUL.rose, 1.0);
      R.lamp(1.3, 2.6, 2.7, COUL.rose, 1.0);
      R.b(2.1, 0.012, 0.07, 0, -0.29, 3.2, lum(COUL.rose, 0.6), { lueur: true });
      R.col(-1.3, 1.3, 0, 2.8);
    }

    // ---------- L'atelier de Kaede (deux emplacements : 8,2 m) ----------
    const cxAt = (xB(4) + xB(5)) / 2;
    let atelier;
    {
      const R = repere('N', cxAt);
      atelier = R;
      const w = 8.0;
      R.b(w, 3.6, 0.3, 0, 1.8, 0.15, 0x140c26);
      R.b(w, 0.05, 0.05, 0, 3.6, 0.2, lum(COUL.bleu, 0.8), { lueur: true });
      R.plan('pegboard', 3.4, 1.7, -1.5, 2.1, 0.32);
      R.plan('papier', 0.5, 0.67, -0.3, 2.3, 0.33);
      // établi
      R.b(4.8, 0.12, 0.95, -1.4, 0.98, 1.4, COUL.boisClair);
      R.b(4.6, 0.9, 0.8, -1.4, 0.45, 1.4, COUL.bois);
      R.b(4.6, 0.035, 0.035, -1.4, 0.92, 1.84, lum(COUL.bleu, 0.8), { lueur: true });
      // pièces sur l'établi
      for (let i = 0; i < 16; i++) {
        const u = -3.5 + i * 0.4 + (rand() - 0.5) * 0.2;
        const v = 1.15 + rand() * 0.55;
        if (rand() < 0.5) R.b(0.1 + rand() * 0.25, 0.06 + rand() * 0.12, 0.1 + rand() * 0.2, u, 1.1, v, [COUL.metal, 0x3a3270, 0x52409a][i % 3], { ry: rand() });
        else R.c(0.05 + rand() * 0.1, 0.05, u, 1.07, v, [0x3a3270, COUL.bleuPale][i % 2], { six: rand() < 0.5 });
      }
      for (let i = 0; i < 5; i++) R.sp(0.015, -3.3 + i * 0.7 + rand() * 0.3, 1.06, 1.3 + rand() * 0.4, lum([COUL.bleu, COUL.rose, COUL.violet][i % 3], 0.95), { lueur: true });
      // un Glaneur à demi démonté
      R.b(0.45, 0.4, 0.45, -3.0, 1.26, 1.45, 0x35286a);
      R.b(0.08, 0.04, 0.02, -3.0, 1.34, 1.69, lum(COUL.rose, 0.9), { lueur: true });
      for (let i = 0; i < 3; i++) R.c(0.07, 0.04, -3.18 + i * 0.18, 1.0, 1.12 - i * 0.0, 0x1c1838);
      // lampe-loupe
      R.c(0.12, 0.04, -0.45, 1.06, 1.25, COUL.metal);
      R.b(0.03, 0.8, 0.03, -0.45, 1.5, 1.25, COUL.metal, { rz: -0.3 });
      R.b(0.03, 0.7, 0.03, -0.62, 1.95, 1.3, COUL.metal, { rz: 0.9 });
      poser(lueur, TPL.tore, lum(COUL.blanc, 1.1), R.X(-0.95), R.Y(2.15), R.Z(1.45), 0.22, 0.22, 0.22, Math.PI / 2 - 0.4);
      R.sp(0.06, -0.95, 2.1, 1.45, lum(COUL.blanc, 1.2), { lueur: true });
      // étagères
      for (let j = 0; j < 3; j++) {
        R.b(2.2, 0.05, 0.4, 2.8, 0.9 + j * 0.7, 0.5, COUL.boisClair);
        for (let i = 0; i < 4; i++) R.b(0.25 + rand() * 0.2, 0.25 + rand() * 0.2, 0.28, 2.0 + i * 0.5, 1.05 + j * 0.7, 0.5, [0x35286a, COUL.metal, 0x52409a][(i + j) % 3]);
      }
      R.sp(0.04, 2.2, 1.78, 0.75, lum(COUL.bleu, 0.9), { lueur: true });
      // le fauteuil de pose
      R.b(0.8, 0.14, 0.8, 3.3, 0.5, 1.4, COUL.bois);
      R.c(0.09, 0.45, 3.3, 0.22, 1.4, COUL.metal);
      R.b(0.8, 1.0, 0.12, 3.3, 1.0, 1.0, COUL.bois, { rx: -0.18 });
      R.b(0.4, 0.28, 0.14, 3.3, 1.6, 0.98, COUL.boisClair, { rx: -0.18 });
      R.b(0.1, 0.1, 0.6, 2.85, 0.75, 1.4, COUL.boisClair);
      R.b(0.1, 0.1, 0.6, 3.75, 0.75, 1.4, COUL.boisClair);
      R.b(0.03, 0.9, 0.03, 3.9, 1.7, 1.2, COUL.metal, { rz: 0.0 });
      R.b(0.45, 0.03, 0.03, 3.7, 2.15, 1.2, COUL.metal);
      R.sp(0.04, 3.5, 2.1, 1.2, lum(COUL.bleu, 1.0), { lueur: true });
      // auvent, rideau, enseigne, lampions
      R.b(w + 0.3, 0.05, 3.25, 0, 3.25, 1.5, 0x2b2058, { rx: 0.14 });
      R.b(w + 0.3, 0.05, 0.05, 0, 3.0, 3.2, lum(COUL.bleu, 0.9), { lueur: true });
      for (let i = 0; i < 12; i++) R.b(0.6, 0.5, 0.02, -w / 2 + 0.35 + i * 0.67, 2.7, 3.15, TISSUS[(i * 5) % TISSUS.length]);
      R.plan('atelier', 3.0, 0.75, 0, 3.95, 2.8, 0.22);
      for (let i = 0; i < 5; i++) R.lamp(-3.4 + i * 1.7, 2.7, 3.3, i % 2 ? COUL.bleu : COUL.rose, 0.9);
      R.b(7.0, 0.012, 0.07, 0, -0.29, 3.5, lum(COUL.bleu, 0.6), { lueur: true });
      R.col(-4.0, 1.15, 0, 2.0);
      R.col(2.7, 4.0, 0, 2.0);
      R.col(1.15, 2.7, 0, 0.7);
    }

    // ---------- Le salon de thé d'Oba (喫茶店) ----------
    const placeEst = PLACE_E - 3.6;
    let the;
    {
      const R = repere('S', placeEst);
      the = R;
      const w = 7.0;
      ossature(R, w, COUL.rose, null, { plateforme: true, cloison: true, prof: 2.4 });
      R.plan('the', 4.2, 1.05, 0, 4.0, 2.2, 0.2);
      // comptoir en U, bouilloire, tasses, braise
      R.c(0.22, 0.34, -1.2, 1.1, 1.9, COUL.metal);
      R.c(0.18, 0.03, -1.2, 1.28, 1.9, lum(0xff3a9a, 0.8), { lueur: true });
      R.b(0.3, 0.05, 0.05, -0.95, 1.2, 1.9, COUL.metal, { rz: 0.5 });
      R.vap(-1.2, 1.35, 1.9, 1.3);
      R.b(0.5, 0.26, 0.4, 0.4, 1.12, 1.9, COUL.metal);
      R.b(0.42, 0.03, 0.32, 0.4, 1.27, 1.9, lum(0xff2b8a, 0.9), { lueur: true });
      for (let i = 0; i < 4; i++) R.c(0.06, 0.07, 1.0 + i * 0.22, 1.0, 2.2, 0xd9cdf5);
      R.vap(1.2, 1.1, 2.2, 0.5);
      // étagère de théières
      for (let i = 0; i < 5; i++) R.sp(0.15, -2.4 + i * 0.5, 2.0, 0.5, [0x35286a, COUL.metal, 0x52409a][i % 3]);
      R.b(2.6, 0.04, 0.3, -1.2, 1.82, 0.5, COUL.boisClair);
      // lanternes de papier rondes
      R.lamp(-3.0, 2.8, 2.7, COUL.rose, 1.3);
      R.lamp(3.0, 2.8, 2.7, COUL.rose, 1.3);
      // les deux tabourets : celui d'Oba (u = 0) et un voisin vide
      R.c(0.24, 0.5, 0, 0.25, 3.7, COUL.boisClair);
      R.c(0.27, 0.06, 0, 0.53, 3.7, 0x6a3ab0);
      R.b(0.04, 0.5, 0.04, 0, 0.25, 3.7, COUL.metal);
      R.c(0.24, 0.5, -1.3, 0.25, 3.5, COUL.boisClair);
      R.c(0.27, 0.06, -1.3, 0.53, 3.5, 0x4a2a80);
      // plantes en pots sans fumée : une rangée pour rien
      for (let i = 0; i < 3; i++) {
        R.c(0.12, 0.2, 2.2 + i * 0.35, 0.1, 3.2, 0x4a2a60);
        R.sp(0.13, 2.2 + i * 0.35, 0.34, 3.2, lum(0x7a5cff, 0.8), { lueur: true, sy: 1.3 });
      }
      R.col(-0.3, 0.3, 3.4, 4.0);
    }
    // les colliders de la partie « ossature » de la place couvrent déjà les cloisons

    // ---------- Îlots centraux : étals adossés deux à deux le long de l'axe ----------
    // Chaque îlot : deux étals face au nord (mur z = 30), deux face au sud, collés dos à dos.
    // Entre deux îlots, un passage de 3 m pour passer d'une allée à l'autre.
    const ilots = [
      [47.2, ['nouilles', 'fleurs'], ['soupe', 'reprise']],
      [58.4, ['lanternes', 'graines'], ['grill', 'pret']],
      [69.6, ['raviolis', 'pieces'], ['chants', 'fleurs']],
      [102.4, ['reprise', 'nouilles'], ['fleurs', 'lanternes']],
      [113.6, ['pret', 'grill'], ['graines', 'soupe']],
      [124.8, ['pieces', 'raviolis'], ['nouilles', 'chants']],
    ];
    const wI = LARGEUR_ETAL - 0.35;
    for (const [x0, vNord, vSud] of ilots) {
      vNord.forEach((t, i) => etal('S', x0 + LARGEUR_ETAL * (i + 0.5), t, wI, { mur: AXE, cloison: true, hCloison: 3.2 }));
      vSud.forEach((t, i) => etal('N', x0 + LARGEUR_ETAL * (i + 0.5), t, wI, { mur: AXE }));
    }
    // Tables communes sur la place
    for (const [x, z] of [[83.2, 30], [96.8, 30], [90, 22.8]]) {
      const tournee = z === 30 ? 0 : Math.PI / 2;
      boiteM(3.2, 0.1, 0.95, x, 0.82, z, COUL.boisClair, { ry: tournee });
      for (const dx of [-1.4, 1.4]) boiteM(0.1, 0.8, 0.8, x + (tournee ? 0 : dx), 0.4, z + (tournee ? dx : 0), COUL.bois);
      for (const dz of [-0.85, 0.85]) {
        const bx = x + (tournee ? dz : 0);
        const bz = z + (tournee ? 0 : dz);
        boiteM(3.0, 0.07, 0.38, bx, 0.5, bz, COUL.bois, { ry: tournee });
        for (const dx of [-1.3, 1.3]) boiteM(0.08, 0.5, 0.3, bx + (tournee ? 0 : dx), 0.25, bz + (tournee ? dx : 0), COUL.bois);
      }
      for (let i = 0; i < 5; i++) {
        const o = -1.1 + i * 0.55;
        const off = i % 2 ? 0.2 : -0.2;
        const bx = x + (tournee ? off : o);
        const bz = z + (tournee ? o : off);
        poser(solide, TPL.cyl, 0x3a2a70, bx, 0.9, bz, 0.13, 0.1, 0.13);
        poser(lueur, TPL.cyl, lum(0xffa0e8, 0.7), bx, 0.955, bz, 0.11, 0.02, 0.11);
      }
      sphM(0.16, x, 1.15, z, lum(COUL.rose, 0.9), { lueur: true, sy: 1.3 });
      lampion(x, 3.3, z, COUL.rose, 1.0);
      vapeur(x - 0.5, 1.05, z - 0.2, 0.7);
      collider(x - (tournee ? 1.1 : 1.7), x + (tournee ? 1.1 : 1.7), z - (tournee ? 1.7 : 1.1), z + (tournee ? 1.7 : 1.1));
    }

    // ---------- Arches d'entrée et passages latéraux ----------
    const arche = (x, sensVersLeMarche) => {
      for (const z of [MUR_N + 0.7, MUR_S - 0.7]) {
        boiteM(0.55, 7.6, 0.55, x, 3.8, z, 0x160d2c);
        boiteM(0.1, 7.4, 0.1, x - sensVersLeMarche * 0.3, 3.8, z, lum(COUL.magenta, 0.8), { lueur: true });
        boiteM(0.9, 0.3, 0.9, x, 0.15, z, COUL.metal);
        collider(x - 0.4, x + 0.4, z - 0.4, z + 0.4);
      }
      boiteM(0.6, 0.7, 21.2, x, 7.55, AXE, 0x160d2c);
      boiteM(0.1, 0.1, 21.2, x - sensVersLeMarche * 0.35, 7.9, AXE, lum(COUL.rose, 0.9), { lueur: true });
      boiteM(0.1, 0.1, 21.2, x - sensVersLeMarche * 0.35, 7.2, AXE, lum(COUL.violet, 0.9), { lueur: true });
      planM('arche', 12, 3, x - 0.35, 9.5, AXE, 0, -Math.PI / 2);
      planM('arche', 12, 3, x + 0.35, 9.5, AXE, 0, Math.PI / 2);
      // retourne : côté extérieur lisible depuis la rue, côté intérieur depuis le marché
      for (const z of [AXE - 6, AXE, AXE + 6]) lampion(x, 6.4, z, COUL.magenta, 1.9);
    };
    arche(X_OUEST, 1);
    arche(X_EST, -1);

    const passage = (z, versLaPlace) => {
      for (const x of [X_PLACE - 4.4, X_PLACE + 4.4]) {
        boiteM(0.5, 6.4, 0.5, x, 3.2, z, 0x160d2c);
        boiteM(0.08, 6.2, 0.08, x, 3.2, z - versLaPlace * 0.3, lum(COUL.violet, 0.8), { lueur: true });
        collider(x - 0.3, x + 0.3, z - 0.3, z + 0.3);
      }
      boiteM(9.3, 0.55, 0.5, X_PLACE, 6.3, z, 0x160d2c);
      boiteM(9.3, 0.08, 0.08, X_PLACE, 6.0, z - versLaPlace * 0.3, lum(COUL.rose, 0.9), { lueur: true });
      planM('main', 2.0, 2.0, X_PLACE, 4.7, z - 0.3, 0, Math.PI);
      planM('main', 2.0, 2.0, X_PLACE, 4.7, z + 0.3, 0, 0);
      lampion(X_PLACE - 2.4, 5.0, z, COUL.rose, 1.4);
      lampion(X_PLACE + 2.4, 5.0, z, COUL.rose, 1.4);
    };
    passage(MUR_N + 0.3, 1);
    passage(MUR_S - 0.3, -1);
    // Les plans « main » se lisent des deux côtés (un par face).
    // (le plan z - 0.3 regarde −z, le plan z + 0.3 regarde +z)

    // ---------- Le mât de la place ----------
    {
      cylM(0.3, 38, X_PLACE, 19, AXE, COUL.metal);
      cylM(1.5, 0.4, X_PLACE, 0.2, AXE, 0x1a1234);
      poser(lueur, TPL.tore, lum(COUL.magenta, 0.9), X_PLACE, 0.5, AXE, 1.5, 1.5, 1.5, Math.PI / 2);
      for (const [y, r, n] of [[9.4, 2.4, 10], [17.2, 1.7, 8], [25.5, 1.2, 6]]) {
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          lampion(X_PLACE + Math.cos(a) * r, y, AXE + Math.sin(a) * r, i % 2 ? COUL.rose : COUL.magenta, 1.6);
        }
        poser(lueur, TPL.tore, lum(COUL.violet, 0.8), X_PLACE, y + 0.9, AXE, r + 0.2, r + 0.2, r + 0.2, Math.PI / 2);
      }
      sphM(1.2, X_PLACE, 38.6, AXE, lum(COUL.rose, 1.1), { lueur: true });
      for (const [dx, dz, ry] of [[0.55, 0, Math.PI / 2], [-0.55, 0, -Math.PI / 2], [0, 0.55, 0], [0, -0.55, Math.PI]]) {
        planM('mat', 4.5, 18, X_PLACE + dx, 27, AXE + dz, 0, ry);
      }
      collider(X_PLACE - 1.6, X_PLACE + 1.6, AXE - 1.6, AXE + 1.6);
    }

    // ---------- Lampions : rangées dans les allées ----------
    for (const [z, y] of [[24.4, 4.6], [35.6, 4.6], [30.0, 4.3]]) {
      for (const [x0, x1] of [[X_OUEST + 1, PLACE_W - 1], [PLACE_E + 1, X_EST - 1]]) {
        const n = Math.floor((x1 - x0) / 2.1);
        for (let i = 0; i <= n; i++) {
          const x = x0 + ((x1 - x0) * i) / n + (rand() - 0.5) * 0.4;
          lampion(x, y + (rand() - 0.5) * 0.3 - Math.sin((i / n) * Math.PI) * 0.0, z + (rand() - 0.5) * 0.4);
        }
        // fil de suspension
        boiteM(x1 - x0, 0.03, 0.03, (x0 + x1) / 2, y + 0.35, z, COUL.noir);
      }
    }
    for (const x of [86.5, 93.5]) for (const z of [24, 36]) lampion(x, 4.8, z, null, 1.3);
    // fil entre les mâts : bandeau de fanions autour de la place
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      lampion(X_PLACE + Math.cos(a) * 8.5, 5.2 + Math.sin(a * 3) * 0.3, AXE + Math.sin(a) * 8.5, null, 1.2);
    }

    // ---------- Bâche translucide ----------
    {
      const pos = [];
      const col = [];
      const palette = [0xff2bd6, 0xc44bff, 0xff5ad0, 0x8a5cff, 0x4a7dff, 0xff2bd6, 0xc44bff];
      const quad = (a, b, c, d, couleur) => {
        const cc = COL.set(couleur);
        for (const p of [a, b, c, a, c, d]) {
          pos.push(p[0], p[1], p[2]);
          col.push(cc.r, cc.g, cc.b);
        }
      };
      const tri = (a, b, c, couleur) => {
        const cc = COL.set(couleur);
        for (const p of [a, b, c]) {
          pos.push(p[0], p[1], p[2]);
          col.push(cc.r, cc.g, cc.b);
        }
      };
      const travee = (x0, x1, n) => {
        const l = (x1 - x0) / n;
        for (let i = 0; i < n; i++) {
          const a = x0 + i * l;
          const b = a + l;
          const hE = 5.5 + rand() * 0.5;
          const hF = 7.5 + rand() * 0.5;
          const cn = palette[Math.floor(rand() * palette.length)];
          const cs = palette[Math.floor(rand() * palette.length)];
          quad([a, hE, 19.2], [b, hE, 19.2], [b, hF, AXE], [a, hF, AXE], cn);
          quad([a, hF, AXE], [b, hF, AXE], [b, hE, 40.8], [a, hE, 40.8], cs);
          // poutres et chevrons
        }
        boiteM(x1 - x0, 0.07, 0.07, (x0 + x1) / 2, 7.7, AXE, 0x24184a);
      };
      travee(X_OUEST + 0.5, PLACE_W, 6);
      travee(PLACE_E, X_EST - 0.5, 7);
      // tente pyramidale au-dessus de la place
      const A = [X_PLACE, 12.5, AXE];
      const c1 = [PLACE_W, 5.6, 19.2];
      const c2 = [PLACE_E, 5.6, 19.2];
      const c3 = [PLACE_E, 5.6, 40.8];
      const c4 = [PLACE_W, 5.6, 40.8];
      tri(c1, c2, A, 0xff2bd6);
      tri(c2, c3, A, 0xc44bff);
      tri(c3, c4, A, 0xff5ad0);
      tri(c4, c1, A, 0x8a5cff);
      for (const c of [c1, c2, c3, c4]) {
        const dx = A[0] - c[0];
        const dy = A[1] - c[1];
        const dz = A[2] - c[2];
        const L = Math.hypot(dx, dy, dz);
        EU.set(0, 0, 0);
        const m = new THREE.Matrix4().lookAt(new THREE.Vector3(0, 0, 0), new THREE.Vector3(dx, dy, dz), new THREE.Vector3(0, 1, 0));
        const q = new THREE.Quaternion().setFromRotationMatrix(m);
        const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
        poser(solide, TPL.boite, 0x24184a, c[0] + dx / 2, c[1] + dy / 2, c[2] + dz / 2, 0.07, 0.07, L, e.x, e.y, e.z);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      this.bache = new THREE.Mesh(
        g,
        new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.34, side: THREE.DoubleSide, depthWrite: false, toneMapped: false })
      );
      this.bache.renderOrder = 3;
      this.bache.frustumCulled = false;
    }

    // ---------- Sol ----------
    {
      const tex = textureSol();
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.38, metalness: 0.25, color: 0xffffff, emissive: 0x1c0c3a });
      const geos = [];
      const dalle = (x0, x1, z0, z1, y) => {
        const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
        g.rotateX(-Math.PI / 2);
        g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
        const uv = g.attributes.uv;
        const pos = g.attributes.position;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 4, pos.getZ(i) / 4);
        geos.push(g);
      };
      dalle(X_OUEST, X_EST, 22, 38, SOL);
      for (const [z0, z1] of [[MUR_N, 22], [38, MUR_S]]) {
        dalle(X_OUEST, 82, z0, z1, TROTTOIR);
        dalle(98, X_EST, z0, z1, TROTTOIR);
        dalle(82, 98, z0, z1, SOL + 0.002);
      }
      // aux passages : un tablier de planches vers la rue transversale
      dalle(86, 94, 12, MUR_N, SOL + 0.002);
      dalle(86, 94, MUR_S, 48, SOL + 0.002);
      const sol = new THREE.Mesh(mergeGeometries(geos), mat);
      sol.matrixAutoUpdate = false;
      this.sol = sol;
    }

    // ---------- Assemblage ----------
    const matSolide = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.15, emissive: 0x2a1458, emissiveIntensity: 0.9 });
    const matLueur = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    const mSolide = maillage(solide, matSolide);
    const mLueur = maillage(lueur, matLueur);
    groupe.add(this.sol, mSolide, mLueur, this.bache);

    // Panneaux (atlas) : un seul maillage
    {
      const geos = [];
      for (const p of planches) {
        const r = rects[p.cle];
        if (!r) continue;
        const g = new THREE.PlaneGeometry(p.w, p.h);
        const uv = g.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, r.u0 + uv.getX(i) * (r.u1 - r.u0), r.v0 + uv.getY(i) * (r.v1 - r.v0));
        EU.set(p.rx, p.ry, 0, 'YXZ');
        QU.setFromEuler(EU);
        M4.compose(V3.set(p.x, p.y, p.z), QU, V3S.set(1, 1, 1));
        g.applyMatrix4(M4);
        geos.push(g);
      }
      const m = new THREE.Mesh(
        mergeGeometries(geos),
        new THREE.MeshBasicMaterial({ map: atlasTex, transparent: true, toneMapped: false, fog: false, alphaTest: 0.02, color: 0xe6dcff })
      );
      m.matrixAutoUpdate = false;
      groupe.add(m);
      this.panneaux = m;
    }

    // Visage du Kiosque
    {
      const R = kiosque;
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(1.55, 1.04),
        new THREE.MeshBasicMaterial({ map: visage.tex, toneMapped: false })
      );
      m.position.set(R.X(0), R.Y(1.74), R.Z(2.235));
      m.rotation.y = 0;
      groupe.add(m);
      this.visage = visage;
      this.ecran = m;
    }

    // Lampions instanciés
    {
      const geo = new THREE.SphereGeometry(0.3, 10, 8);
      const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ toneMapped: false, map: textureLampion() }), lampions.length);
      lampions.forEach((l, i) => mesh.setColorAt(i, COL.set(l.c).multiplyScalar(0.8)));
      mesh.instanceColor.needsUpdate = true;
      mesh.frustumCulled = false;
      groupe.add(mesh);
      this.lampions = lampions;
      this.mesLampions = mesh;
      this.majLampions(0);
    }

    // Flaques de lumière sous les rangées de lampions (additives, instanciées)
    {
      const pools = [];
      for (const z of [24.4, 35.6]) {
        for (let x = X_OUEST + 3; x < X_EST; x += 5.6) {
          if (x > PLACE_W + 2 && x < PLACE_E - 2) continue;
          pools.push([x, z, 4.6 + rand() * 1.2, LAMPIONS[Math.floor(rand() * 5)]]);
        }
      }
      pools.push([X_PLACE, AXE, 13, COUL.magenta]);
      for (const x of [X_OUEST + 1, X_EST - 1]) pools.push([x, AXE, 9, COUL.rose]);
      pools.push([X_PLACE, 16, 6, COUL.violet2], [X_PLACE, 44, 6, COUL.violet2]);
      const mesh = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({
          map: textureHalo(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.4,
        }),
        pools.length
      );
      const dummy = new THREE.Object3D();
      pools.forEach(([x, z, r, c], i) => {
        dummy.position.set(x, 0.05, z);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(r * 2, r * 2, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, COL.set(c).multiplyScalar(0.55));
      });
      mesh.instanceColor.needsUpdate = true;
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      groupe.add(mesh);
    }

    // Lueurs de loin (sprites sans brouillard) : la place, les deux arches
    {
      const tex = textureHalo();
      this.halos = [];
      for (const [x, y, z, s, c, o] of [
        [X_PLACE, 10, AXE, 64, COUL.magenta, 0.5],
        [X_PLACE, 28, AXE, 60, COUL.rose, 0.6],
        [X_OUEST, 8, AXE, 26, COUL.magenta, 0.45],
        [X_EST, 8, AXE, 26, COUL.magenta, 0.45],
      ]) {
        const sp = new THREE.Sprite(
          new THREE.SpriteMaterial({ map: tex, color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false })
        );
        sp.position.set(x, y, z);
        sp.scale.set(s, s, 1);
        sp.userData.base = o;
        groupe.add(sp);
        this.halos.push(sp);
      }
    }

    // Une seule lumière dynamique : la place (les rangées sont éclairées par leurs émissifs).
    {
      const l = new THREE.PointLight(0xff3ad0, 40, 36, 1.8);
      l.position.set(X_PLACE, 5.5, AXE);
      groupe.add(l);
    }

    // ---------- Vapeur : pool de billboards instanciés ----------
    this.initVapeur(groupe, emetteurs, scene);

    // ---------- Colliders ----------
    k.colliders.push(...colliders);
    this.colliders = colliders;

    // ---------- Interactions : « E — Regarder … » ----------
    for (const it of interactions) {
      if (!it.cle || !OBJETS_MARCHE[it.cle]) continue;
      const def = OBJETS_MARCHE[it.cle];
      const noeuds = {};
      def.textes.forEach((texte, i) => {
        noeuds[`n${i + 1}`] = { qui: '', texte, suite: i + 1 < def.textes.length ? `n${i + 2}` : null };
      });
      const dialogue = { debut: 'n1', noeuds };
      jeu.interact.ajouter({
        zone: ZONE,
        position: it.position,
        rayon: 3.1,
        libelle: def.libelle,
        action: () => jeu.ouvrirDialogue(dialogue),
      });
    }

    // ---------- Points exposés ----------
    const v = (x, y, z, yaw = 0) => Object.assign(new THREE.Vector3(x, y, z), { yaw });
    this.entrees = [
      { nom: 'ouest', position: v(X_OUEST - 1.5, 0, AXE), yaw: -Math.PI / 2, versLeMarche: new THREE.Vector3(1, 0, 0) },
      { nom: 'est', position: v(X_EST + 1.5, 0, AXE), yaw: Math.PI / 2, versLeMarche: new THREE.Vector3(-1, 0, 0) },
      { nom: 'nord', position: v(X_PLACE, 0, MUR_N - 2.5), yaw: Math.PI, versLeMarche: new THREE.Vector3(0, 0, 1) },
      { nom: 'sud', position: v(X_PLACE, 0, MUR_S + 2.5), yaw: 0, versLeMarche: new THREE.Vector3(0, 0, -1) },
    ];
    const oba = v(the.X(0), 0, the.Z(3.7), Math.PI); // yaw π : regarde vers +z ? voir plus bas
    oba.yaw = 0; // la silhouette regarde vers le nord (−z) : la place, le passant
    this.ancres = {
      kiosque: v(kiosque.X(0), 0, kiosque.Z(2.6), Math.PI), // face vers +z (l'allée)
      kiosqueVisage: v(kiosque.X(0), 1.75, kiosque.Z(2.25), Math.PI),
      atelier: v(atelier.X(-0.6), 0, atelier.Z(2.7), 0), // Kaede, penchée sur l'établi (regarde −z)
      fauteuil: v(atelier.X(3.3), 0, atelier.Z(1.4), Math.PI), // fauteuil de pose (Bond), regarde +z
      tabouret: oba,
    };
    oba.assise = true;
    this.approches = {
      kiosque: v(kiosque.X(0), 0, kiosque.Z(3.9), 0), // où se tient le joueur face au Kiosque (regarde −z)
      atelier: v(atelier.X(-0.6), 0, atelier.Z(4.2), 0),
      fauteuil: v(atelier.X(3.3), 0, atelier.Z(3.7), 0),
      tabouret: v(the.X(0), 0, the.Z(5.9), Math.PI), // regarde +z vers Oba
    };
    this.pointsFragments = [
      // 8 : étiquette « 1,20 » collée sous le comptoir de l'étal sans personne (raviolis, partie ouest)
      { id: 8, position: v(xA(4), 0.62, MUR_S - 3.0), acces: v(xA(4), 0, MUR_S - 5.0), note: 'sous le comptoir de l’étal sans personne' },
      // 10 : Oba, souvenir parlé : au-dessus de son tabouret
      { id: 10, position: v(the.X(0), 1.55, the.Z(3.7)), acces: v(the.X(0), 0, the.Z(5.9)), note: 'à hauteur d’épaule d’Oba' },
      // 11 : rapport punaisé au-dessus de l'établi de Kaede
      { id: 11, position: v(atelier.X(-1.2), 1.75, atelier.Z(1.75)), acces: v(atelier.X(-1.2), 0, atelier.Z(3.6)), note: 'au-dessus de l’établi, sous le rapport punaisé' },
      // 19 : sur la tablette du Kiosque, devant la veste bleue
      { id: 19, position: v(kiosque.X(0.3), 1.4, kiosque.Z(3.0)), acces: v(kiosque.X(0.3), 0, kiosque.Z(4.4)), note: 'sur la tablette du Kiosque' },
    ];
    this.centre.set(X_PLACE, 0, AXE);
    this.allees = [
      [new THREE.Vector3(X_OUEST - 4, 0, 25.5), new THREE.Vector3(X_EST + 4, 0, 25.5)],
      [new THREE.Vector3(X_OUEST - 4, 0, 34.5), new THREE.Vector3(X_EST + 4, 0, 34.5)],
      [new THREE.Vector3(X_PLACE, 0, 12), new THREE.Vector3(X_PLACE, 0, 48)],
    ];
    this.limites = LIMITES;
  },

  // ---------- Lampions : balancement ----------
  majLampions(t) {
    const mesh = this.mesLampions;
    if (!mesh) return;
    const d = this._dummy || (this._dummy = new THREE.Object3D());
    this.lampions.forEach((l, i) => {
      d.position.set(l.x, l.y, l.z);
      d.rotation.set(Math.sin(t * 0.8 + l.ph) * 0.05, 0, Math.sin(t * 0.7 + l.ph * 1.3) * 0.07);
      d.scale.set(l.s * 0.62, l.s * 0.8, l.s * 0.62);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  },

  // ---------- Vapeur ----------
  initVapeur(groupe, emetteurs) {
    const POOL = 170;
    const aPos = new THREE.InstancedBufferAttribute(new Float32Array(POOL * 3), 3);
    const aData = new THREE.InstancedBufferAttribute(new Float32Array(POOL * 4), 4); // âge, taille, graine, alpha
    aPos.setUsage(THREE.DynamicDrawUsage);
    aData.setUsage(THREE.DynamicDrawUsage);
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.setAttribute('uv', quad.getAttribute('uv'));
    geo.setAttribute('aPos', aPos);
    geo.setAttribute('aData', aData);
    geo.instanceCount = POOL;
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        map: { value: textureVapeur() },
        uFog: { value: new THREE.Color(0x1a0c44) },
        uDens: { value: 0.0075 },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aPos; attribute vec4 aData;
        varying vec2 vUv; varying vec4 vD; varying float vDist;
        void main() {
          vec4 mv = viewMatrix * vec4(aPos, 1.0);
          float ang = aData.z * 6.2831 + aData.x * (aData.z - 0.5) * 1.2;
          float c = cos(ang), s = sin(ang);
          vec2 p = vec2(c * position.x - s * position.y, s * position.x + c * position.y);
          mv.xy += p * aData.y;
          vUv = uv; vD = aData; vDist = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map; uniform vec3 uFog; uniform float uDens;
        varying vec2 vUv; varying vec4 vD; varying float vDist;
        void main() {
          float t = texture2D(map, vUv).a;
          float a = t * vD.w * smoothstep(0.1, 0.8, vDist);
          if (a < 0.01) discard;
          vec3 rose = vec3(0.95, 0.55, 0.92);
          vec3 pale = vec3(0.85, 0.78, 1.0);
          vec3 col = mix(rose, pale, smoothstep(0.1, 0.9, vD.x)) * 0.8;
          float ff = 1.0 - exp(-vDist * vDist * uDens * uDens);
          col = mix(col, uFog, ff * 0.7);
          gl_FragColor = vec4(col, a * (1.0 - ff * 0.5));
        }`,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 6;
    groupe.add(mesh);
    this.vap = {
      mesh, aPos, aData, POOL, emetteurs,
      age: new Float32Array(POOL).fill(99),
      vie: new Float32Array(POOL).fill(1),
      x: new Float32Array(POOL), y: new Float32Array(POOL), z: new Float32Array(POOL),
      vx: new Float32Array(POOL), vy: new Float32Array(POOL), vz: new Float32Array(POOL),
      taille: new Float32Array(POOL), graine: new Float32Array(POOL), alpha: new Float32Array(POOL),
      curseur: 0,
      reste: new Float32Array(emetteurs.length),
    };
  },

  majVapeur(dt) {
    const V = this.vap;
    if (!V) return;
    const pa = V.aPos.array;
    const da = V.aData.array;
    // émission
    V.emetteurs.forEach((e, i) => {
      V.reste[i] += dt * e.taux * 3.0;
      while (V.reste[i] >= 1) {
        V.reste[i] -= 1;
        const j = V.curseur;
        V.curseur = (V.curseur + 1) % V.POOL;
        V.age[j] = 0;
        V.vie[j] = 2.4 + Math.random() * 1.6;
        V.x[j] = e.x + (Math.random() - 0.5) * 0.25;
        V.y[j] = e.y;
        V.z[j] = e.z + (Math.random() - 0.5) * 0.25;
        V.vx[j] = (Math.random() - 0.5) * 0.12;
        V.vy[j] = 0.55 + Math.random() * 0.35;
        V.vz[j] = (Math.random() - 0.5) * 0.12;
        V.taille[j] = 0.3 + Math.random() * 0.2;
        V.graine[j] = Math.random();
        V.alpha[j] = 0.2 + Math.random() * 0.12;
      }
    });
    for (let i = 0; i < V.POOL; i++) {
      V.age[i] += dt;
      const u = V.age[i] / V.vie[i];
      if (u >= 1) {
        da[i * 4 + 3] = 0;
        da[i * 4 + 1] = 0;
        continue;
      }
      V.x[i] += V.vx[i] * dt;
      V.y[i] += V.vy[i] * dt;
      V.z[i] += V.vz[i] * dt;
      V.vx[i] += Math.sin(V.age[i] * 1.7 + V.graine[i] * 9) * 0.05 * dt;
      V.vy[i] *= 1 - 0.1 * dt;
      pa[i * 3] = V.x[i];
      pa[i * 3 + 1] = V.y[i];
      pa[i * 3 + 2] = V.z[i];
      da[i * 4] = u;
      da[i * 4 + 1] = V.taille[i] * (1 + u * 2.6);
      da[i * 4 + 2] = V.graine[i];
      da[i * 4 + 3] = V.alpha[i] * Math.min(1, u * 8) * (1 - u) * (1 - u * 0.4);
    }
    V.aPos.needsUpdate = true;
    V.aData.needsUpdate = true;
  },

  _proche: false,
  _tVisage: 0,

  update(dt, t, jeu) {
    if (!this.groupe) return;
    const dansKasumi = jeu.zones?.nom === ZONE;
    if (!dansKasumi) return;
    const cam = jeu.camera.position;
    const dx = cam.x - X_PLACE;
    const dz = cam.z - AXE;
    const d = Math.hypot(dx, dz);
    this._proche = d < 110;

    // Titre à la première entrée dans le marché
    if (jeu.enPartie && !jeu.etat.zonesVisitees.includes('marche')) {
      const L = LIMITES;
      if (cam.x > L.minX + 1 && cam.x < L.maxX - 1 && cam.z > L.minZ && cam.z < L.maxZ) {
        jeu.etat.zonesVisitees.push('marche');
        jeu.hud.titre(TITRE_MARCHE.titre, TITRE_MARCHE.sous);
        jeu.emettre('marche:entree');
        jeu.sauver?.();
      }
    }

    // Les halos de loin s'effacent quand on est dedans
    if (this.halos) {
      const k = Math.min(1, Math.max(0.15, (d - 20) / 60));
      for (const h of this.halos) h.material.opacity = h.userData.base * k;
    }
    if (!this._proche) return;
    this.majLampions(t);
    this.majVapeur(Math.min(dt, 0.1));
    // visage du Kiosque : clignement, regard qui suit
    this._tVisage += dt;
    const cycle = this._tVisage % 4.2;
    const clin = cycle > 3.95;
    const regard = Math.round(Math.sin(this._tVisage * 0.7) * 3);
    const sourire = Math.sin(this._tVisage * 0.4) > -0.6;
    this.visage.dessiner(clin, regard, sourire);
  },
};
