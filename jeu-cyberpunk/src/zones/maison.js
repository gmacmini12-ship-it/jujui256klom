import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { sceauTexture, respirer } from './decor.js';
import {
  INVITES, PLAQUES, PANNEAU_CLINIQUE, CHARTE_FRONTON, VITRINE, SCEAU, ANNEAU, ARCHIVES, ECRANS, REGLAGES,
} from '../data/maison.js';

// Maison des Conseils (bible §5.4) : un temple administratif, bois sombre et lumière bleue.
//
// Repère : l'entrée est au sud (z = +18, x = 0), le joueur regarde vers −z (yaw 0).
//
//   Nef            x ∈ [−9, 9],  z ∈ [−12, 18], toit à 8,6 m ; colonnes à x = ±6,5 ; le fronton de la Charte
//                  (poutre, z = 5) la barre à 6 m ; l'accueil (anneau de Mima) à l'ouest, z = 12,5.
//   Escalier       x ∈ [−2, 2], z de −6,1 à −12 : 21 marches de 0,2 m (boîtes 3D, praticables), il monte à l'étage.
//   Transept       x ∈ [−14, 14], z ∈ [−34, −12] : au rez-de-chaussée la crypte (plafond à 3,9 m, la dalle de
//                  l'étage) où se tient la Cabine du Sceau ; à l'étage (y = 4,2) la Clinique du Jugement.
//   Aile ouest     x ∈ [−28, −9], z ∈ [−12, 14] : Salle des Consultations, douze cabines (deux rangées de six),
//                  porte dans la nef à z ∈ [1, 7].
//   Aile est       x ∈ [9, 28],   z ∈ [−12, 14] : Médiathèque des Avant, neuf écrans d'archives à texte défilant.
//
// Tout le décor fixe est fusionné par matériau (une dizaine d'appels de dessin). Les colliders du rez-de-chaussée
// vont de 0 à 4 m ; ceux de l'étage de 4 m (ou 4,2 m) vers le haut : voir docs/architecture.md (hauteur, player.js).

export const Y_ETAGE = 4.2;
export const LIEUX = {
  entree: { x: 0, z: 15.4 },
  accueil: { x: -8.7, y: 1.85, z: 12.5 },
  consultants: [
    { id: 'consultant1', x: -26.2, z: -5, yaw: -Math.PI / 2 },
    { id: 'consultant2', x: -26.2, z: 4, yaw: -Math.PI / 2 },
    { id: 'consultant3', x: -18.2, z: -2, yaw: Math.PI / 2 },
  ],
  sall: { x: -9.2, y: Y_ETAGE, z: -21.2, yaw: Math.PI / 2 },
  patient: { x: 7.5, y: Y_ETAGE - 0.06, z: -26.6, yaw: 0 },
  borneSceau: { x: -3.2, y: 1.3, z: -17.6 },
  pedestalSceau: { x: 0, y: 1.2, z: -25 },
};

const POLICE = '"Noto Sans JP", "Hiragino Sans", "Yu Gothic", sans-serif';
const SERIF = '"Cormorant Garamond", "Palatino Linotype", "Book Antiqua", Georgia, serif';
const FOND = 0x070b1c;

function toile(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}
function texture(c, { repeat = false, aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function adapter(g, texte, maxLargeur) {
  const m = g.measureText(texte).width;
  return m > maxLargeur ? maxLargeur / m : 1;
}
/** Découpe un texte en lignes qui tiennent dans `largeur` (police déjà réglée sur `g`). */
function couper(g, texte, largeur) {
  const mots = String(texte).split(' ');
  const lignes = [];
  let cour = '';
  for (const m of mots) {
    const essai = cour ? `${cour} ${m}` : m;
    if (g.measureText(essai).width > largeur && cour) { lignes.push(cour); cour = m; } else cour = essai;
  }
  if (cour) lignes.push(cour);
  return lignes;
}

// ---------------------------------------------------------------------------- textures
function textureParquet() {
  const [c, g] = toile(512, 512);
  g.fillStyle = '#1b1315';
  g.fillRect(0, 0, 512, 512);
  const lames = 8;
  for (let i = 0; i < lames; i++) {
    const y = (i * 512) / lames;
    const t = 0.78 + ((i * 37) % 11) / 50;
    g.fillStyle = `rgb(${Math.round(46 * t)},${Math.round(32 * t)},${Math.round(30 * t)})`;
    g.fillRect(0, y + 1, 512, 512 / lames - 2);
    // joints courts, décalés d'une lame à l'autre
    g.fillStyle = 'rgba(8,6,14,0.75)';
    g.fillRect(((i * 173) % 512), y, 3, 512 / lames);
    g.fillStyle = 'rgba(160,190,255,0.035)';
    g.fillRect(0, y + 3, 512, 2);
  }
  g.fillStyle = 'rgba(5,4,10,0.9)';
  for (let i = 0; i < lames; i++) g.fillRect(0, (i * 512) / lames, 512, 2);
  return texture(c, { repeat: true, aniso: 8 });
}
function texturePlaque(fr, jp, { largeur = 1024, hauteur = 256 } = {}) {
  const [c, g] = toile(largeur, hauteur);
  g.fillStyle = '#0a1128';
  g.fillRect(0, 0, largeur, hauteur);
  g.strokeStyle = '#6f8cff';
  g.lineWidth = 5;
  g.shadowColor = '#6f8cff';
  g.shadowBlur = 12;
  g.strokeRect(10, 10, largeur - 20, hauteur - 20);
  g.shadowBlur = 0;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#dce8ff';
  g.font = `600 ${Math.round(hauteur * 0.34)}px ${SERIF}`;
  const k = adapter(g, fr, largeur - 90);
  g.font = `600 ${Math.round(hauteur * 0.34 * k)}px ${SERIF}`;
  g.fillText(fr, largeur / 2, hauteur * 0.4);
  g.fillStyle = '#8fa8ff';
  g.font = `${Math.round(hauteur * 0.2)}px ${POLICE}`;
  g.fillText(jp, largeur / 2, hauteur * 0.76);
  return texture(c);
}

function texturePanneau(texte) {
  const [c, g] = toile(2048, 384);
  g.fillStyle = '#0b132e';
  g.fillRect(0, 0, 2048, 384);
  g.strokeStyle = '#9fb2ff';
  g.lineWidth = 6;
  g.shadowColor = '#6f8cff';
  g.shadowBlur = 18;
  g.strokeRect(16, 16, 2016, 352);
  g.shadowBlur = 0;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#e4ecff';
  g.font = `600 118px ${SERIF}`;
  const lignes = couper(g, texte, 1850);
  lignes.forEach((l, i) => g.fillText(l, 1024, 192 + (i - (lignes.length - 1) / 2) * 130));
  return texture(c, { aniso: 8 });
}

function textureCharte() {
  const [c, g] = toile(2048, 400);
  g.fillStyle = '#0b1026';
  g.fillRect(0, 0, 2048, 400);
  g.strokeStyle = '#6f8cff';
  g.lineWidth = 5;
  g.strokeRect(14, 14, 2020, 372);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#b6c8ff';
  g.font = `600 64px ${SERIF}`;
  g.fillText(CHARTE_FRONTON.titre, 1024, 66);
  g.textAlign = 'left';
  g.font = `500 54px ${SERIF}`;
  g.fillStyle = '#e4ecff';
  CHARTE_FRONTON.articles.forEach((a, i) => {
    const col = i % 2, lig = Math.floor(i / 2);
    g.fillText(a, 70 + col * 1000, 180 + lig * 110);
  });
  return texture(c, { aniso: 8 });
}

function textureVitrine() {
  const [c, g] = toile(512, 256);
  g.fillStyle = '#0b132e';
  g.fillRect(0, 0, 512, 256);
  g.strokeStyle = '#9fb2ff';
  g.lineWidth = 3;
  g.strokeRect(6, 6, 500, 244);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#e4ecff';
  g.font = `600 30px ${SERIF}`;
  const t = couper(g, VITRINE.titre, 460);
  t.forEach((l, i) => g.fillText(l, 256, 52 + i * 36));
  g.fillStyle = '#9fb2ff';
  g.font = `24px ${SERIF}`;
  VITRINE.lignes.forEach((l, i) => g.fillText(l, 256, 150 + i * 38));
  return texture(c);
}

/** Écran d'archive : une bande de texte qui défile (décalage d'UV, aucune redessinée). */
function textureArchive(arch) {
  const L = 768, H = 1024;
  const [c, g] = toile(L, H);
  g.fillStyle = '#060d26';
  g.fillRect(0, 0, L, H);
  g.textBaseline = 'alphabetic';
  g.textAlign = 'left';
  g.fillStyle = '#dce8ff';
  g.font = `700 92px ${SERIF}`;
  g.fillText(String(arch.annee), 40, 110);
  g.fillStyle = '#9fb2ff';
  g.font = `600 36px ${SERIF}`;
  const tit = couper(g, arch.titre, L - 80);
  tit.forEach((l, i) => g.fillText(l, 44, 160 + i * 40));
  let y = 160 + tit.length * 40 + 20;
  g.strokeStyle = '#3a56c8';
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(40, y - 6); g.lineTo(L - 40, y - 6); g.stroke();
  g.font = `28px ${SERIF}`;
  g.fillStyle = '#b6c8ff';
  y += 34;
  for (const l of arch.lignes) {
    if (!l) { y += 22; continue; }
    const k = adapter(g, l, L - 80);
    if (k < 1) g.font = `${Math.round(28 * k)}px ${SERIF}`;
    g.fillText(l, 44, y);
    g.font = `28px ${SERIF}`;
    y += 38;
  }
  // fin de bande : un trait, puis du noir jusqu'au retour de l'en-tête
  g.fillStyle = '#2a3f8c';
  g.fillRect(40, Math.min(y + 24, H - 40), L - 80, 2);
  const t = texture(c, { repeat: true, aniso: 4 });
  return t;
}

// ---------------------------------------------------------------------------- fabrique
export function creerMaison(jeu) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(FOND);
  const colliders = [];
  const animes = [];

  // ---------- Matériaux ----------
  const parquet = textureParquet();
  const M = {
    mur: new THREE.MeshStandardMaterial({ color: 0x2c1f1d, roughness: 0.88, metalness: 0.0 }),
    bois: new THREE.MeshStandardMaterial({ color: 0x4a3326, roughness: 0.75, metalness: 0.05 }),
    boisClair: new THREE.MeshStandardMaterial({ color: 0x6a4a36, roughness: 0.7, metalness: 0.05 }),
    pierre: new THREE.MeshStandardMaterial({ color: 0x1a2038, roughness: 0.6, metalness: 0.2 }),
    plafond: new THREE.MeshStandardMaterial({ color: 0x0f1428, roughness: 0.95 }),
    cuir: new THREE.MeshStandardMaterial({ color: 0x1e2c4c, roughness: 0.55, metalness: 0.1 }),
    verre: new THREE.MeshBasicMaterial({ color: 0x4a6aff, transparent: true, opacity: 0.12, depthWrite: false, toneMapped: false }),
    lumiere: new THREE.MeshBasicMaterial({ color: 0x6f8cff, toneMapped: false }),
    lumierePale: new THREE.MeshBasicMaterial({ color: 0xcfdcff, toneMapped: false }),
  };

  // ---------- Géométries fusionnées par matériau ----------
  const lots = new Map();
  const lot = (mat) => { if (!lots.has(mat)) lots.set(mat, []); return lots.get(mat); };
  const BE = (mat, x0, x1, y0, y1, z0, z1) => {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    lot(mat).push(g);
  };
  const CYL = (mat, x, y0, y1, z, r, seg = 14) => {
    const g = new THREE.CylinderGeometry(r, r, y1 - y0, seg);
    g.translate(x, (y0 + y1) / 2, z);
    lot(mat).push(g);
  };
  /** Collider (rez-de-chaussée par défaut : de 0 à 4 m). */
  const col = (x0, x1, z0, z1, y0 = 0, y1 = 4.0) => colliders.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, minY: y0, maxY: y1 });
  /** Mur : visuel et collider. */
  const mur = (x0, x1, z0, z1, y0, y1, { visuel = true, c0 = y0 === 0 ? 0 : y0, c1 = y0 === 0 ? 4.0 : y1, mat = M.mur } = {}) => {
    if (visuel) BE(mat, x0, x1, y0, y1, z0, z1);
    col(x0, x1, z0, z1, c0, c1);
  };
  const HN = 8.6; // hauteur de la nef
  const HA = 4.6; // hauteur des ailes

  // ---------- Sols ----------
  const sol = (x0, x1, z0, z1, y, rep) => {
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (x1 - x0) / rep, uv.getY(i) * (z1 - z0) / rep);
    g.rotateX(-Math.PI / 2);
    g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
    return g;
  };
  const matSol = new THREE.MeshStandardMaterial({ color: 0xffffff, map: parquet, roughness: 0.42, metalness: 0.12 });
  const geosSol = [
    sol(-28.2, 28.2, -34.2, 18.2, 0, 4),                // tout le rez-de-chaussée
    sol(-14, 14, -34, -12, Y_ETAGE + 0.005, 4),         // la dalle de l'étage
  ];
  scene.add(new THREE.Mesh(mergeGeometries(geosSol), matSol));

  // ---------- Toits et dalle ----------
  BE(M.plafond, -9.2, 9.2, HN, HN + 0.3, -12.2, 18.2);
  BE(M.plafond, -14.2, 14.2, HN, HN + 0.3, -34.2, -11.8);
  BE(M.plafond, -28.2, -8.8, HA, HA + 0.3, -12.2, 14.2);
  BE(M.plafond, 8.8, 28.2, HA, HA + 0.3, -12.2, 14.2);
  BE(M.pierre, -14, 14, Y_ETAGE - 0.3, Y_ETAGE, -34, -12);            // la dalle
  col(-14, 14, -34, -12, Y_ETAGE - 0.3, Y_ETAGE);                      // praticable (étage), plafond pour le rez

  // ---------- Murs extérieurs de la nef ----------
  // façade sud : porte de 3,6 m
  mur(-9.2, -1.8, 17.8, 18.2, 0, HN, { c1: 4.0 });
  mur(1.8, 9.2, 17.8, 18.2, 0, HN, { c1: 4.0 });
  BE(M.mur, -1.8, 1.8, 3.6, HN, 17.8, 18.2); // linteau
  // flancs de la nef (x = ±9), percés d'une porte de 6 m à z ∈ [1, 7] vers les ailes
  for (const s of [-1, 1]) {
    const a = s < 0 ? -9.2 : 8.8, b = s < 0 ? -8.8 : 9.2;
    mur(a, b, 7, 17.8, 0, HN, { c1: 4.0 });
    mur(a, b, -12.2, 1, 0, HN, { c1: 4.0 });
    BE(M.mur, a, b, 3.6, HN, 1, 7); // linteau de la porte
    // chambranles lumineux
    BE(M.lumiere, s < 0 ? -8.78 : 8.7, s < 0 ? -8.7 : 8.78, 0, 3.6, 0.93, 1.0);
    BE(M.lumiere, s < 0 ? -8.78 : 8.7, s < 0 ? -8.7 : 8.78, 0, 3.6, 7.0, 7.07);
    BE(M.lumiere, s < 0 ? -8.78 : 8.7, s < 0 ? -8.7 : 8.78, 3.56, 3.62, 0.93, 7.07);
  }
  // ailes
  mur(-28.2, -8.8, 13.8, 14.2, 0, HA, { c1: 4.0 });   // sud ouest
  mur(8.8, 28.2, 13.8, 14.2, 0, HA, { c1: 4.0 });     // sud est
  mur(-28.2, -27.8, -12.2, 14.2, 0, HA, { c1: 4.0 }); // fond ouest
  mur(27.8, 28.2, -12.2, 14.2, 0, HA, { c1: 4.0 });   // fond est
  mur(-28.2, -8.8, -12.2, -11.8, 0, HA, { c1: 4.0 }); // nord ouest
  mur(8.8, 28.2, -12.2, -11.8, 0, HA, { c1: 4.0 });   // nord est
  // transept (rez-de-chaussée sous la dalle, étage au-dessus)
  for (const s of [-1, 1]) {
    const a = s < 0 ? -14.2 : 13.8, b = s < 0 ? -13.8 : 14.2;
    mur(a, b, -34.2, -12, 0, HN, { c1: 4.0 });
    col(a, b, -34.2, -12, 4.0, HN);
  }
  mur(-14.2, 14.2, -34.2, -33.8, 0, HN, { c1: 4.0 });
  col(-14.2, 14.2, -34.2, -33.8, 4.0, HN);

  // ---------- Éclairage de structure : bandeaux bleus ----------
  for (const s of [-1, 1]) BE(M.lumiere, s * 8.7 - 0.05, s * 8.7 + 0.05, 7.55, 7.65, -11.8, 17.8);
  BE(M.lumierePale, -0.05, 0.05, HN - 0.06, HN, -11.8, 17.8);
  for (const s of [-1, 1]) BE(M.lumiere, s * 13.7 - 0.05, s * 13.7 + 0.05, 7.55, 7.65, -33.8, -12);
  BE(M.lumiere, -28, -9, HA - 0.06, HA, -0.05, 0.05);
  BE(M.lumiere, 9, 28, HA - 0.06, HA, -0.05, 0.05);
  // filets au sol : de la porte à l'escalier
  for (const s of [-1, 1]) BE(M.lumiere, s * 2.6 - 0.04, s * 2.6 + 0.04, 0.012, 0.03, -6, 16.5);

  // ---------- Nef : colonnes ----------
  for (const z of [13, 9, 2.2, -3, -9]) {
    for (const s of [-1, 1]) {
      CYL(M.boisClair, s * 6.5, 0, HN, z, 0.45, 16);
      CYL(M.pierre, s * 6.5, 0, 0.4, z, 0.62, 16);
      CYL(M.lumiere, s * 6.5, 7.4, 7.5, z, 0.47, 16);
      col(s * 6.5 - 0.5, s * 6.5 + 0.5, z - 0.5, z + 0.5);
    }
  }
  // crypte sous la dalle
  for (const x of [-10.5, 10.5]) for (const z of [-16, -24, -31.5]) {
    CYL(M.boisClair, x, 0, Y_ETAGE - 0.3, z, 0.42, 14);
    CYL(M.lumiere, x, 3.2, 3.28, z, 0.44, 14);
    col(x - 0.5, x + 0.5, z - 0.5, z + 0.5);
  }
  for (const x of [-6.8, 6.8]) {
    CYL(M.boisClair, x, 0, Y_ETAGE - 0.3, -14.4, 0.42, 14);
    col(x - 0.5, x + 0.5, -14.9, -13.9);
  }

  // ---------- Fronton de la Charte : une poutre barre la nef à 6 m ----------
  BE(M.bois, -9, 9, 5.7, 8.3, 4.6, 5.4);
  BE(M.lumiere, -9, 9, 5.64, 5.7, 4.55, 5.45);
  const charte = new THREE.Mesh(new THREE.PlaneGeometry(14.5, 2.4), new THREE.MeshBasicMaterial({ map: textureCharte(), toneMapped: false }));
  charte.position.set(0, 7.0, 5.42);
  scene.add(charte);

  // ---------- Escalier monumental : 21 marches de 0,2 m, de z = −6,1 à −12 ----------
  const MARCHES = 21, HM = 0.2, GIRON = 0.28, Z_PIED = -6.1, LARG = 2.0;
  for (let k = 0; k < MARCHES; k++) {
    const z1 = Z_PIED - GIRON * k, z0 = z1 - GIRON;
    const haut = HM * (k + 1);
    BE(M.boisClair, -LARG, LARG, 0, haut, z0, z1);
    BE(M.lumiere, -LARG + 0.05, LARG - 0.05, haut - 0.015, haut, z1 - 0.03, z1);
    col(-LARG, LARG, z0, z1, 0, haut);
    // rampes : planche pleine (collision) et main courante
    for (const s of [-1, 1]) {
      col(s < 0 ? -LARG - 0.2 : LARG, s < 0 ? -LARG : LARG + 0.2, z0, z1, 0, haut + 1.2);
    }
  }
  for (const s of [-1, 1]) {
    const x0 = s < 0 ? -LARG - 0.2 : LARG, x1 = s < 0 ? -LARG : LARG + 0.2;
    // joue pleine sur toute la volée (le bois, contre le vide)
    const lx = (x0 + x1) / 2;
    const g = new THREE.BoxGeometry(0.2, 1.2, Math.hypot(GIRON * MARCHES, HM * MARCHES));
    const ang = Math.atan2(HM * MARCHES, GIRON * MARCHES);
    g.rotateX(ang);
    g.translate(lx, HM * MARCHES / 2 + 0.6, (Z_PIED + (Z_PIED - GIRON * MARCHES)) / 2);
    lot(M.bois).push(g);
    // main courante lumineuse
    const m = new THREE.BoxGeometry(0.06, 0.06, Math.hypot(GIRON * MARCHES, HM * MARCHES));
    m.rotateX(ang);
    m.translate(lx, HM * MARCHES / 2 + 1.25, (Z_PIED + (Z_PIED - GIRON * MARCHES)) / 2);
    lot(M.lumiere).push(m);
  }

  // balustrade du bord de dalle (z = −12), ouverte devant l'escalier
  for (const [a, b] of [[-14, -LARG - 0.2], [LARG + 0.2, 14]]) {
    BE(M.bois, a, b, Y_ETAGE, Y_ETAGE + 1.1, -12.1, -11.9);
    BE(M.lumiere, a, b, Y_ETAGE + 1.1, Y_ETAGE + 1.16, -12.12, -11.88);
    col(a, b, -12.15, -11.85, Y_ETAGE - 0.2, Y_ETAGE + 1.3);
  }

  // ---------- Clinique du Jugement (étage) ----------
  // mur sud, percé d'une porte de 5,2 m
  mur(-14, -2.6, -14.2, -13.8, Y_ETAGE, HN, { c0: Y_ETAGE - 0.2, c1: HN });
  mur(2.6, 14, -14.2, -13.8, Y_ETAGE, HN, { c0: Y_ETAGE - 0.2, c1: HN });
  BE(M.mur, -2.6, 2.6, Y_ETAGE + 3.3, HN, -14.2, -13.8);
  for (const s of [-1, 1]) BE(M.lumiere, s * 2.6 - 0.05, s * 2.6 + 0.05, Y_ETAGE, Y_ETAGE + 3.3, -14.25, -13.75);
  // fauteuils : quatre, face à la porte ; le dernier porte le patient
  const fauteuils = [-7.5, -2.5, 2.5, 7.5];
  const zf = -27;
  for (const x of fauteuils) {
    BE(M.cuir, x - 0.5, x + 0.5, Y_ETAGE + 0.05, Y_ETAGE + 0.5, zf - 0.45, zf + 0.5);       // assise
    BE(M.cuir, x - 0.5, x + 0.5, Y_ETAGE + 0.5, Y_ETAGE + 1.25, zf - 0.55, zf - 0.38);      // dossier
    BE(M.cuir, x - 0.62, x - 0.5, Y_ETAGE + 0.05, Y_ETAGE + 0.72, zf - 0.5, zf + 0.5);      // accoudoirs
    BE(M.cuir, x + 0.5, x + 0.62, Y_ETAGE + 0.05, Y_ETAGE + 0.72, zf - 0.5, zf + 0.5);
    BE(M.bois, x - 0.45, x + 0.45, Y_ETAGE, Y_ETAGE + 0.07, zf - 0.4, zf + 0.45);           // piètement
    col(x - 0.62, x + 0.62, zf - 0.55, zf + 0.5, Y_ETAGE, Y_ETAGE + 0.85);
  }
  // table basse et bureau de la docteure
  BE(M.boisClair, -0.9, 0.9, Y_ETAGE + 0.4, Y_ETAGE + 0.46, -24.3, -23.3);
  BE(M.bois, -0.8, -0.7, Y_ETAGE, Y_ETAGE + 0.4, -24.2, -24.1);
  BE(M.bois, 0.7, 0.8, Y_ETAGE, Y_ETAGE + 0.4, -23.5, -23.4);
  col(-0.9, 0.9, -24.3, -23.3, Y_ETAGE, Y_ETAGE + 0.5);
  BE(M.boisClair, -12.8, -10.6, Y_ETAGE + 0.72, Y_ETAGE + 0.78, -23.2, -19.2);
  BE(M.bois, -12.8, -10.6, Y_ETAGE, Y_ETAGE + 0.72, -23.2, -23.1);
  BE(M.bois, -12.8, -10.6, Y_ETAGE, Y_ETAGE + 0.72, -19.3, -19.2);
  col(-12.8, -10.6, -23.2, -19.2, Y_ETAGE, Y_ETAGE + 0.8);
  // panneau et vitrage
  const panneau = new THREE.Mesh(new THREE.PlaneGeometry(10.5, 1.95), new THREE.MeshBasicMaterial({ map: texturePanneau(PANNEAU_CLINIQUE), toneMapped: false }));
  panneau.position.set(0, Y_ETAGE + 2.85, -33.77);
  scene.add(panneau);
  BE(M.lumiere, -5.4, 5.4, Y_ETAGE + 1.82, Y_ETAGE + 1.86, -33.8, -33.72);
  // affiche du fond d'humeur (mur est) : cadre lumineux
  BE(M.lumiere, 13.74, 13.8, Y_ETAGE + 0.7, Y_ETAGE + 2.9, -26.3, -26.2);
  BE(M.lumiere, 13.74, 13.8, Y_ETAGE + 0.7, Y_ETAGE + 2.9, -21.8, -21.7);

  // ---------- Cabine du Sceau (rez-de-chaussée, sous la dalle) ----------
  const SX = 4.5, SZ0 = -31, SZ1 = -19;
  mur(-SX - 0.2, -1.3, SZ1 - 0.2, SZ1 + 0.2, 0, 3.7);
  mur(1.3, SX + 0.2, SZ1 - 0.2, SZ1 + 0.2, 0, 3.7);
  BE(M.mur, -1.3, 1.3, 3.0, 3.7, SZ1 - 0.2, SZ1 + 0.2);
  mur(-SX - 0.2, -SX + 0.2, SZ0, SZ1, 0, 3.7);
  mur(SX - 0.2, SX + 0.2, SZ0, SZ1, 0, 3.7);
  mur(-SX - 0.2, SX + 0.2, SZ0 - 0.2, SZ0 + 0.2, 0, 3.7);
  BE(M.pierre, -SX - 0.3, SX + 0.3, 3.7, 3.9, SZ0 - 0.3, SZ1 + 0.3);
  for (const s of [-1, 1]) BE(M.lumiere, s * 1.3 - 0.05, s * 1.3 + 0.05, 0, 3.0, SZ1 - 0.25, SZ1 + 0.25);
  BE(M.lumiere, -1.3, 1.3, 2.96, 3.02, SZ1 - 0.25, SZ1 + 0.25);
  // socle : un cylindre bas et une table du Sceau
  CYL(M.pierre, 0, 0, 1.1, -25, 0.55, 20);
  CYL(M.lumierePale, 0, 1.1, 1.13, -25, 0.5, 20);
  col(-0.6, 0.6, -25.6, -24.4, 0, 1.2);
  // quatre piliers lumineux dans les angles
  for (const x of [-3.7, 3.7]) for (const z of [-30, -20.4]) {
    BE(M.lumiere, x - 0.05, x + 0.05, 0.1, 3.5, z - 0.05, z + 0.05);
  }
  // lutrin de la notice du Sceau, devant la cabine
  const B = LIEUX.borneSceau;
  BE(M.boisClair, B.x - 0.35, B.x + 0.35, 0, 1.1, B.z - 0.3, B.z + 0.3);
  BE(M.lumiere, B.x - 0.3, B.x + 0.3, 1.1, 1.14, B.z - 0.25, B.z + 0.25);
  col(B.x - 0.4, B.x + 0.4, B.z - 0.35, B.z + 0.35, 0, 1.2);

  // ---------- Vitrine de la séance (nef ouest, fragment 15) ----------
  BE(M.boisClair, -8.8, -7.6, 0, 0.9, -9.1, -6.9);
  BE(M.verre, -8.75, -7.65, 0.9, 1.9, -9.05, -6.95);
  BE(M.lumiere, -8.8, -7.6, 1.9, 1.94, -9.1, -6.9);
  col(-8.8, -7.6, -9.1, -6.9, 0, 1.9);
  const vit = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.75), new THREE.MeshBasicMaterial({ map: textureVitrine(), toneMapped: false }));
  vit.position.set(-8.76, 2.5, -8);
  vit.rotation.y = Math.PI / 2;
  scene.add(vit);

  // ---------- Salle des Consultations : deux rangées de six cabines ----------
  const rings = []; // positions des anneaux { x, y, z, yaw, taille, libre }
  const zc = [-8, -5, -2, 1, 4, 7];
  const occupees = { W: [1, 4], E: [2] };
  const cabine = (dos, sens, z, rangee, i) => {
    // sens : +1 ouverte vers l'est (rangée ouest), −1 vers l'ouest. `dos` : x de la cloison du fond
    const a = sens > 0 ? dos : dos - 2.6, b = sens > 0 ? dos + 2.6 : dos;
    BE(M.bois, Math.min(dos - 0.06, dos + 0.06), Math.max(dos - 0.06, dos + 0.06), 0, 2.8, z - 1.5, z + 1.5); // fond
    col(dos - 0.07, dos + 0.07, z - 1.5, z + 1.5);
    for (const dz of [-1.5, 1.5]) {
      BE(M.bois, a, b, 0, 2.8, z + dz - 0.06, z + dz + 0.06);
      col(a, b, z + dz - 0.07, z + dz + 0.07);
    }
    BE(M.bois, a, b, 2.75, 2.85, z - 1.5, z + 1.5);                          // toit
    BE(M.lumiere, Math.min(a, b) + 0.05, Math.max(a, b) - 0.05, 2.7, 2.74, z - 0.2, z + 0.2); // lampe
    // petit plan de travail sous l'anneau
    const xa = sens > 0 ? dos + 0.06 : dos - 0.56, xb = sens > 0 ? dos + 0.56 : dos - 0.06;
    BE(M.boisClair, xa, xb, 0.9, 0.96, z - 1.1, z + 1.1);
    col(xa, xb, z - 1.1, z + 1.1, 0, 0.96);
    const libre = !(occupees[rangee] || []).includes(i);
    rings.push({ x: dos + sens * 0.09, y: 1.85, z, yaw: sens > 0 ? Math.PI / 2 : -Math.PI / 2, taille: 0.8, libre });
  };
  zc.forEach((z, i) => cabine(-27.7, 1, z, 'W', i));
  zc.forEach((z, i) => cabine(-16.9, -1, z, 'E', i));
  // quelques bancs d'attente contre la nef (côté ouest, entre la rangée est et la porte)
  BE(M.boisClair, -12.3, -11.7, 0.35, 0.42, -7.5, -3.5);
  BE(M.bois, -12.2, -12.1, 0, 0.35, -7.4, -7.3);
  BE(M.bois, -12.2, -12.1, 0, 0.35, -3.7, -3.6);
  col(-12.3, -11.7, -7.5, -3.5, 0, 0.5);

  // ---------- Médiathèque des Avant ----------
  // deux tables de lecture au centre, des écrans aux murs
  for (const z of [-2, 4]) {
    BE(M.boisClair, 14, 22, 0.76, 0.82, z - 0.55, z + 0.55);
    for (const x of [14.3, 21.7]) BE(M.bois, x - 0.06, x + 0.06, 0, 0.76, z - 0.45, z + 0.45);
    col(14, 22, z - 0.55, z + 0.55, 0, 0.9);
    BE(M.lumiere, 14.2, 21.8, 0.82, 0.85, z - 0.04, z + 0.04);
    for (const dz of [-1.0, 1.0]) {
      BE(M.cuir, 14.8, 21.2, 0.38, 0.45, z + dz - 0.2, z + dz + 0.2);
      col(14.8, 21.2, z + dz - 0.22, z + dz + 0.22, 0, 0.5);
    }
  }
  const murs = {
    est: { px: 27.78, pz: null, ry: -Math.PI / 2 },
    ouest: { px: 9.22, pz: null, ry: Math.PI / 2 },
    nord: { px: null, pz: -11.78, ry: 0 },
    sud: { px: null, pz: 13.78, ry: Math.PI },
  };
  const ecrans = [];
  for (const def of ECRANS) {
    const arch = ARCHIVES.find((a) => a.annee === def.annee);
    const m = murs[def.mur];
    const tex = textureArchive(arch);
    const rep = 528 / 1024;
    tex.repeat.set(1, rep);
    tex.offset.set(0, 1 - rep);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.2), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    const x = m.px ?? def.u, z = m.pz ?? def.u;
    mesh.position.set(x, 2.15, z);
    mesh.rotation.y = m.ry;
    scene.add(mesh);
    ecrans.push({ tex, rep, phase: ecrans.length * 0.37 });
    // cadre : quatre filets lumineux (fusionnés avec le reste)
    const nordSud = m.pz != null; // l'écran s'étend en x
    const ox = m.px != null ? (m.px > 18 ? -0.015 : 0.015) : 0;
    const oz = m.pz != null ? (m.pz < 0 ? 0.015 : -0.015) : 0;
    const hw = 1.63, e = 0.03;
    const cx = x + ox, cz = z + oz;
    if (nordSud) {
      BE(M.lumiere, cx - hw, cx + hw, 3.25, 3.31, cz - e, cz + e);
      BE(M.lumiere, cx - hw, cx + hw, 0.99, 1.05, cz - e, cz + e);
      for (const sg of [-1, 1]) BE(M.lumiere, cx + sg * hw - 0.03, cx + sg * hw + 0.03, 0.99, 3.31, cz - e, cz + e);
    } else {
      BE(M.lumiere, cx - e, cx + e, 3.25, 3.31, cz - hw, cz + hw);
      BE(M.lumiere, cx - e, cx + e, 0.99, 1.05, cz - hw, cz + hw);
      for (const sg of [-1, 1]) BE(M.lumiere, cx - e, cx + e, 0.99, 3.31, cz + sg * hw - 0.03, cz + sg * hw + 0.03);
    }
  }

  // ---------- Fusion : un maillage par matériau ----------
  for (const [mat, geos] of lots) scene.add(new THREE.Mesh(mergeGeometries(geos), mat));

  // ---------- Anneaux de Mima : un seul maillage ----------
  const matAnneau = new THREE.MeshBasicMaterial({
    map: sceauTexture('#5ef2ff'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide,
  });
  const geosAnneaux = [];
  const plan = (taille, x, y, z, ry) => {
    const g = new THREE.PlaneGeometry(taille, taille);
    g.rotateY(ry);
    g.translate(x, y, z);
    geosAnneaux.push(g);
  };
  rings.forEach((r) => plan(r.taille, r.x, r.y, r.z, r.yaw));
  const A = LIEUX.accueil;
  plan(1.3, A.x, A.y, A.z, Math.PI / 2);
  // le Sceau : un grand anneau au sol et un petit sur le socle
  const gSol = new THREE.PlaneGeometry(6, 6);
  gSol.rotateX(-Math.PI / 2);
  gSol.translate(0, 0.03, -25);
  geosAnneaux.push(gSol);
  const gSocle = new THREE.PlaneGeometry(0.9, 0.9);
  gSocle.rotateX(-Math.PI / 2);
  gSocle.translate(0, 1.15, -25);
  geosAnneaux.push(gSocle);
  const meshAnneaux = new THREE.Mesh(mergeGeometries(geosAnneaux), matAnneau);
  meshAnneaux.renderOrder = 3;
  scene.add(meshAnneaux);
  animes.push((t) => respirer(matAnneau, t));

  // ---------- Plaques au-dessus des passages ----------
  const plaque = (p, x, y, z, ry, l = 3.4, h = 0.85) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(l, h), new THREE.MeshBasicMaterial({ map: texturePlaque(p.fr, p.jp), toneMapped: false }));
    m.position.set(x, y, z);
    m.rotation.y = ry;
    scene.add(m);
  };
  plaque(PLAQUES.consultations, -8.77, 4.9, 4, Math.PI / 2);
  plaque(PLAQUES.mediatheque, 8.77, 4.9, 4, -Math.PI / 2);
  plaque(PLAQUES.clinique, 0, Y_ETAGE + 3.85, -13.78, 0, 4.4, 1.1);
  plaque(PLAQUES.sceau, 0, 3.35, SZ1 + 0.22, 0, 2.5, 0.62);

  // ---------- Lumières (peu : le décor est surtout émissif) ----------
  scene.add(new THREE.HemisphereLight(0x7a96ff, 0x1a1210, 0.85));
  const lampe = (couleur, i, d, x, y, z) => {
    const l = new THREE.PointLight(couleur, i, d, 1.6);
    l.position.set(x, y, z);
    scene.add(l);
    return l;
  };
  lampe(0x7f9cff, 45, 26, 0, 6.0, 9);
  lampe(0x7f9cff, 40, 26, 0, 6.0, -6);
  lampe(0x6f8cff, 26, 20, -17, 3.4, 1);
  lampe(0x6f8cff, 26, 20, 18, 3.4, 1);
  lampe(0x5a78ff, 22, 14, 0, 3.0, -24);
  lampe(0x8aa8ff, 34, 22, 0, Y_ETAGE + 3.2, -24);

  // ---------- Interactions ----------
  jeu.zones.porte({
    zone: 'maison',
    position: [0, 1.5, 17.7],
    rayon: 3.4,
    cone: 1.2,
    libelle: INVITES.sortir,
    vers: 'kasumi',
    point: 'maison',
  });

  const anneauxObjets = [];
  const anneauLibre = (r) => {
    const o = jeu.interact.ajouter({
      zone: 'maison',
      position: [r.x, r.y, r.z],
      rayon: 3.1,
      libelle: INVITES.anneau,
      lignes: ANNEAU.lignes,
      sansLigne: false,
      decalageEtiquette: 0.5,
      visible: () => typeof jeu.questions?.ouvrir === 'function' && !jeu.conversation?.disponible,
      action: () => jeu.questions.ouvrir(),
    });
    anneauxObjets.push(o);
    return o;
  };
  rings.filter((r) => r.libre).forEach(anneauLibre);
  anneauLibre({ x: A.x + 0.1, y: A.y - 0.1, z: A.z });

  // Appel du palier 4 : chaque anneau (cabines et accueil) est un écran de Mima.
  if (typeof jeu.conversation?.ajouterEcran === 'function') {
    for (const r of [...rings, { x: A.x + 0.1, y: A.y, z: A.z }]) {
      jeu.conversation.ajouterEcran({ zone: 'maison', position: [r.x, r.y, r.z], rayon: 3.4 });
    }
  }

  // Cabine du Sceau : « Entrer dans la cabine » (jeu.fins.sceau), à la porte et sur le socle.
  const objetCabine = (position, rayon) => jeu.interact.ajouter({
    zone: 'maison',
    position,
    rayon,
    cone: 1.0,
    libelle: INVITES.cabine,
    lignes: [PLAQUES.sceau.fr, SCEAU.inscription, 'Statut : définitif'],
    decalageEtiquette: 0.6,
    visible: () => typeof jeu.fins?.sceau === 'function',
    action: () => jeu.fins.sceau(),
  });
  objetCabine([0, 1.5, SZ1 + 0.1], 4.6);
  objetCabine([LIEUX.pedestalSceau.x, LIEUX.pedestalSceau.y, LIEUX.pedestalSceau.z], 4.2);

  // ---------- Zone ----------
  return {
    scene,
    colliders,
    bornes: { minX: -27.3, maxX: 27.3, minZ: -33.3, maxZ: 17.3 },
    apparition: { position: [0, 0, 15.4], yaw: 0, pitch: 0.05 },
    points: {
      entree: { position: [0, 0, 15.4], yaw: 0, pitch: 0.05 },
    },
    anneaux: rings,
    ecrans,
    ambiance: {
      brouillard: { couleur: 0x080c24, densite: 0.011 },
      fond: FOND,
      exposition: 1.05,
      pluie: false,
      reflet: false,
      bloom: { force: 0.8, rayon: 0.6, seuil: 0.4 },
      son: { pluie: 0, filtre: 800 }, // un bourdonnement étouffé, sans pluie
    },
    update(dt, t) {
      for (const f of animes) f(t);
      for (const e of ecrans) {
        let o = (1 - e.rep) - ((t * REGLAGES.vitesseDefilement + e.phase) % 1);
        o -= Math.floor(o);
        e.tex.offset.y = o;
      }
    },
  };
}
