import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  materielBaies, champDeBaies, champDeRangees, solSombre, solChamp, solBassin, TEMPS,
} from './kura-baies.js';
import { creerPanorama, QUARTIERS } from './kura-panorama.js';
import {
  PLAQUES, INSCRIPTION, SOCLE_INTERRUPTEUR, INVITES, LIGNES_OBJETS, CARTES, SALLES, LIGNES_REFUGE_REPLI, SEPT_VEILLE,
} from '../data/kura.js';

// ============================================================================================================
// Kura (蔵), le centre de calcul (bible §5.6) : la zone la plus vaste et la plus lourde du jeu.
//
// REPÈRE : x vers l'est de Kura, z vers le fond (le joueur arrive en regardant −z, yaw 0), y vers le haut.
// Tout est dans UNE scène, découpée en groupes visibles selon la salle où se tient le joueur (peu d'appels de dessin).
//
//   1. HALL D'ACCUEIL  x ∈ [−124, 124], z ∈ [+14, −640], plafond à 64 m. Arrivée de la ville : (0, 0, 9), regard −z.
//      Parvis (y = 0) jusqu'à la balustrade z = −56 ; de l'autre côté, la « mer » : 20 160 baies de 8 m en
//      InstancedMesh (126 rangées de 160, face avant côté +z) dans une fosse à y = −10, sommets à y = −2.
//      Diodes bleues en vagues (shader), sol réfléchissant (reflet des bandes du plafond calculé dans le shader).
//      Galerie : x ∈ [−46, −6], z ∈ [−56, −44] (une marche de 0,3 m, bancs) ; les visiteurs au bord. Fragment 12 sur la
//      stèle (−4, 0, −53,5). Le grand escalier (40 marches de 0,25 m, x ∈ [58, 66], de z = −8 à z = −48) monte à la terrasse.
//   2. BIBLIOTHÈQUE DES CIRCUITS  mezzanine de verre y = 10 : terrasse x ∈ [36, 100], z ∈ [−52, −58] puis pavillon
//      x ∈ [38, 98], z ∈ [−58, −100], toit à y = 20, au-dessus des 9 premières rangées de baies (sol de verre).
//      Porte sud (x ∈ [57, 67]) sous le linteau gravé (fragment 13). Trois postes de Lecteurs au fond (x = 48, 68, 88,
//      z = −95) devant trois cartes d'activations projetées (canvas animés). Ezra au poste central. Fragments 16 et 17
//      sur les bureaux. Porte est (z ∈ [−76, −70]) vers le couloir (x ∈ [98, 132]) et le Refuge.
//   3. REFUGE  x ∈ [134, 176], z ∈ [−58, −100], y = 10..17 : froid, silencieux. Écrans éteints à lignes lentes ;
//      « Sept » = le grand écran du mur nord (155, 12,4, −99,9). Fragment 23 : la Charte gravée du mur ouest.
//   4. SEUIL ET PROFONDEURS  sas x ∈ [176, 192] (le SEUIL, portique à chevrons en x = 186, borne de reprise), puis
//      une descente de 40 marches (x de 192 à 212, y de 10 à 0) et un tunnel jusqu'à x = 236, puis les Profondeurs (sol y = 0, 14 m de baies ;
//      player.js : le sol du joueur ne descend jamais sous y = 0, donc rien n'est plus bas).
//      Allées de 8 m (centres z) : A −79 (froide, SÛRE, x 236→408), B −119 (chaude), C −159 (froide), D −199 (chaude),
//      E −239 (froide) ; connexions : Est x ∈ [396, 408] (A↔C), Ouest x ∈ [240, 252] (C↔E), Finale x ∈ [396, 408] (E → salle).
//      Le parcours sûr (A, Est, C, Ouest, E, Finale) fait ≈ 700 m ; deux RACCOURCIS DANGEREUX (x = 300 : A↔C et
//      x = 350 : C↔E) traversent les allées chaudes B et D (bassins, bouches d'extraction). Mi-parcours (≈ 350 m
//      du parcours sûr) : la borne du bord sud de C (305, 0, −156,2). Trois ventilateurs géants dans les parois des connexions.
//   5. SALLE DE L'INTERRUPTEUR  x ∈ [380, 424], z ∈ [−300, −340], sol y = 0 ; porte x ∈ [397, 407] ; socle et levier en
//      (402, 0, −333) ; seize écrans éteints sur les murs est et ouest ; la baie vitrée (x ∈ [384, 420]) donne sur
//      le panorama de la ville (10 quartiers) construit à 400 m en avant, 70 m plus bas.
//
// RÉSUMÉ DES EXPOSITIONS (voir systems/kura.js : `jeu.kura`) : ANCRES, PROFONDEURS, `panorama`, ÉCRANS.
// ============================================================================================================

// ---------------------------------------------------------------------------------------- écrans (listes statiques)
const RY0 = 10; // sol du Refuge et de la Bibliothèque
const DY0 = 0; // sol des Profondeurs et de la salle de l'Interrupteur (le sol du joueur ne descend jamais sous y = 0)
/** Écrans du Refuge : { x, y, z, ry, l, h, pied } (ry : orientation du plan, 0 regarde +z). Sept est à part. */
const REFUGE_ECRANS = [
  ...[141, 149, 157, 165, 172].map((x) => ({ x, y: RY0 + 2.6, z: -58.07, ry: Math.PI, l: 3.2, h: 2.0, pied: false })),
  ...[141, 149, 165, 172].map((x) => ({ x, y: RY0 + 2.6, z: -99.93, ry: 0, l: 3.2, h: 2.0, pied: false })),
  ...[[146, -64, 0.4], [152, -88, -0.3], [162, -66, 0.2], [168, -90, -0.5]].map(([x, z, r]) => ({ x, y: RY0 + 1.6, z, ry: r + Math.PI, l: 2.0, h: 1.3, pied: true })),
];
/** Écrans de la salle de l'Interrupteur : quatre colonnes × deux rangées sur chaque mur latéral. */
const INTERR_ECRANS = [];
for (const [x, ry, cote] of [[380.02, Math.PI / 2, 'ouest'], [423.98, -Math.PI / 2, 'est']]) {
  for (const z of [-308, -316, -324, -332]) for (const y of [DY0 + 6.2, DY0 + 11.4]) INTERR_ECRANS.push({ x, y, z, ry, cote });
}

// ---------------------------------------------------------------------------------------- repères exposés
/** Positions [x, y, z] dans la zone Kura (+ yaw utile : 0 regarde −z, π/2 regarde −x, −π/2 regarde +x). */
export const ANCRES = {
  entree: { position: [0, 0, 9], yaw: 0 },                       // arrivée depuis le Marché
  sortie: { position: [0, 1.5, 12.4], yaw: Math.PI },            // la porte de sortie (objet interactif)
  galerie: { position: [-26, 0.3, -50], yaw: 0 },                // devant les visiteurs, face à la mer de baies
  ezra: { position: [68, 10, -92.2], yaw: Math.PI },             // poste central de la Bibliothèque
  lecteur2: { position: [48, 10, -92.2], yaw: Math.PI },
  lecteur3: { position: [88, 10, -92.2], yaw: Math.PI },
  visiteur1: { position: [-30, 0.3, -54.3], yaw: Math.PI },
  visiteur2: { position: [-22.4, 0.3, -54.5], yaw: Math.PI },
  sept: { position: [155, 10, -96.2], yaw: 0 },                  // où l'on se tient devant l'écran de Sept
  ecranSept: { position: [155, 12.4, -99.93], yaw: 0 },          // centre de l'écran de Sept (face vers +z)
  ecransRefuge: REFUGE_ECRANS.map((e) => ({ position: [e.x, e.y, e.z], yaw: e.ry })), // chaque écran du Refuge (Sept à part)
  seuilProfondeurs: { position: [186, 10, -79], yaw: -Math.PI / 2 }, // le portique, regard vers +x
  miParcours: { position: [305, 0, -156.2], yaw: Math.PI / 2 },  // la borne, bord sud de l'allée C, au débouché du raccourci 1
  interrupteur: { position: [402, 2.5, -333.2], yaw: 0 },         // le levier (rien n'y est branché ici)
  devantInterrupteur: { position: [402, 0, -329.0], yaw: 0 },  // où se tient le joueur
  ecransInterrupteur: INTERR_ECRANS.map((e) => ({ position: [e.x, e.y, e.z], yaw: e.ry })), // seize écrans éteints (murs est et ouest)
  baie: { position: [402, 11.5, -340], yaw: 0 },                 // centre de la baie vitrée
  panorama: { position: [402, -70, -740], yaw: 0 },              // centre de la ville (Hashira)
};

const DY = 0; // sol des Profondeurs et de la salle de l'Interrupteur (player.js : le sol ne descend jamais sous y = 0)
const Y_MEZZ = 10;
const FY = -10; // sol de la fosse des baies du Hall (sommets des baies : −2)

/** Géométrie des Profondeurs pour l'agent des dangers (voir en-tête). Toutes les valeurs sont dans le repère de Kura. */
export const PROFONDEURS = {
  sol: DY,
  allees: [
    { id: 'A', type: 'froide', minX: 236, maxX: 408, minZ: -83, maxZ: -75, sure: true },
    { id: 'B', type: 'chaude', minX: 252, maxX: 386, minZ: -123, maxZ: -115, sure: false },
    { id: 'C', type: 'froide', minX: 240, maxX: 408, minZ: -163, maxZ: -155, sure: true },
    { id: 'D', type: 'chaude', minX: 258, maxX: 392, minZ: -203, maxZ: -195, sure: false },
    { id: 'E', type: 'froide', minX: 240, maxX: 408, minZ: -243, maxZ: -235, sure: true },
    { id: 'connexionEst', type: 'froide', minX: 396, maxX: 408, minZ: -163, maxZ: -75, sure: true },
    { id: 'connexionOuest', type: 'froide', minX: 240, maxX: 252, minZ: -243, maxZ: -155, sure: true },
    { id: 'finale', type: 'froide', minX: 396, maxX: 408, minZ: -300, maxZ: -235, sure: true },
    { id: 'raccourci1', type: 'chaude', minX: 296, maxX: 304, minZ: -155, maxZ: -83, sure: false },
    { id: 'raccourci2', type: 'chaude', minX: 346, maxX: 354, minZ: -235, maxZ: -163, sure: false },
  ],
  bouches: [
    { position: [270, DY, -119], rayon: 3.2 }, { position: [322, DY, -119], rayon: 3.2 }, { position: [372, DY, -119], rayon: 3.2 },
    { position: [280, DY, -199], rayon: 3.2 }, { position: [336, DY, -199], rayon: 3.2 }, { position: [380, DY, -199], rayon: 3.2 },
    { position: [300, DY, -105], rayon: 2.6 }, { position: [350, DY, -185], rayon: 2.6 },
  ],
  bassins: [
    { minX: 262, maxX: 284, minZ: -123, maxZ: -115 }, { minX: 292, maxX: 308, minZ: -123, maxZ: -115 }, { minX: 334, maxX: 358, minZ: -123, maxZ: -115 },
    { minX: 270, maxX: 292, minZ: -203, maxZ: -195 }, { minX: 308, maxX: 328, minZ: -203, maxZ: -195 }, { minX: 342, maxX: 358, minZ: -203, maxZ: -195 },
    // le long des allées sûres : la moitié de la largeur reste sèche
    { minX: 300, maxX: 340, minZ: -243, maxZ: -239 }, { minX: 240, maxX: 244, minZ: -225, maxZ: -175 },
  ],
  ventilateurs: [
    { id: 'F1', position: [407.6, DY + 6, -119], rayon: 4.6, axe: [-1, 0, 0] },
    { id: 'F2', position: [240.4, DY + 6, -199], rayon: 4.6, axe: [1, 0, 0] },
    { id: 'F3', position: [407.6, DY + 8, -268], rayon: 6.5, axe: [-1, 0, 0] },
  ],
  cables: [
    // Hall (au bord de la fosse, sous le portique) et Profondeurs (suspendus au plafond des allées)
    { position: [-100, 3.2, -53.6] }, { position: [-72, 3.2, -53.6] }, { position: [-44, 3.2, -53.6] },
    { position: [-16, 3.2, -53.6] }, { position: [16, 3.2, -53.6] }, { position: [108, 3.2, -53.6] },
    { position: [290, DY + 3, -79] }, { position: [350, DY + 3, -159] }, { position: [300, DY + 3, -239] },
    { position: [322, DY + 3, -119] }, { position: [336, DY + 3, -199] },
  ],
  // repères utiles : ce qui sépare une allée sûre d'un raccourci
  portes: { entree: [236, DY, -79], mi: [305, DY, -157], sortie: [402, DY, -300] },
};

// ---------------------------------------------------------------------------------------- dialogues (lus une fois)
const modEtape5 = Object.values(import.meta.glob('../data/dialogues-etape5.js', { eager: true }))[0] || null;
/** Le module dialogues-etape5.js s'il existe (autre agent), sinon null. */
export const dialoguesEtape5 = () => modEtape5;
const lignesRefuge = () => (Array.isArray(modEtape5?.LIGNES_REFUGE) && modEtape5.LIGNES_REFUGE.length ? modEtape5.LIGNES_REFUGE : LIGNES_REFUGE_REPLI);

// ---------------------------------------------------------------------------------------- canvas
const POLICE = '"Noto Sans JP", "Hiragino Sans", "Yu Gothic", sans-serif';
const MONO = '"Courier New", "Liberation Mono", monospace';
const SERIF = '"Cormorant Garamond", "Palatino Linotype", "Book Antiqua", Georgia, serif';

function toile(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}
function tex(c, { repeat = false, aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function adapter(g, texte, max) {
  const m = g.measureText(texte).width;
  return m > max ? max / m : 1;
}

function textureParoi() {
  const [c, g] = toile(512, 512);
  g.fillStyle = '#05081a';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 8; i++) { // pilastres
    g.fillStyle = i % 2 ? '#080d24' : '#060a1d';
    g.fillRect(i * 64, 0, 64, 512);
  }
  g.fillStyle = '#18309a';
  for (const y of [60, 120, 200, 360, 440]) g.fillRect(0, y, 512, 3);
  g.fillStyle = '#2a58ff';
  g.globalAlpha = 0.55;
  g.fillRect(0, 280, 512, 5);
  g.globalAlpha = 1;
  for (let i = 0; i < 8; i++) { g.fillStyle = '#0d1a55'; g.fillRect(i * 64, 0, 3, 512); }
  return tex(c, { repeat: true, aniso: 4 });
}
function texturePlafond() {
  const [c, g] = toile(256, 256);
  g.fillStyle = '#04061a';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#2a58ff';
  g.fillRect(122, 0, 12, 256);
  g.fillRect(0, 122, 256, 8);
  g.fillStyle = '#0c1a6a';
  g.fillRect(0, 0, 256, 3);
  return tex(c, { repeat: true });
}
/** Plaque gravée : titre en français, ligne japonaise, petit texte. */
function texturePlaque(fr, jp, petit, { largeur = 1024, hauteur = 256, couleur = '#7fa0ff', fond = '#070c24' } = {}) {
  const [c, g] = toile(largeur, hauteur);
  g.fillStyle = fond;
  g.fillRect(0, 0, largeur, hauteur);
  g.strokeStyle = couleur;
  g.lineWidth = 5;
  g.shadowColor = couleur;
  g.shadowBlur = 12;
  g.strokeRect(10, 10, largeur - 20, hauteur - 20);
  g.shadowBlur = 0;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#e4ecff';
  const t1 = hauteur * (jp || petit ? 0.30 : 0.4);
  g.font = `600 ${Math.round(t1)}px ${SERIF}`;
  const k = adapter(g, fr, largeur - 100);
  g.font = `600 ${Math.round(t1 * k)}px ${SERIF}`;
  g.fillText(fr, largeur / 2, hauteur * (jp || petit ? 0.32 : 0.5));
  if (jp) {
    g.fillStyle = couleur;
    g.font = `${Math.round(hauteur * 0.2)}px ${POLICE}`;
    g.fillText(jp, largeur / 2, hauteur * 0.58);
  }
  if (petit) {
    g.fillStyle = '#9fb2ff';
    g.font = `${Math.round(hauteur * 0.13)}px ${SERIF}`;
    const k2 = adapter(g, petit, largeur - 100);
    g.font = `${Math.round(hauteur * 0.13 * k2)}px ${SERIF}`;
    g.fillText(petit, largeur / 2, hauteur * 0.82);
  }
  return tex(c, { aniso: 8 });
}
function texturePorteSud() {
  const [c, g] = toile(512, 1024);
  const d = g.createLinearGradient(0, 0, 0, 1024);
  d.addColorStop(0, '#ff3fd0');
  d.addColorStop(0.5, '#9a3cff');
  d.addColorStop(1, '#2b1b8a');
  g.fillStyle = d;
  g.fillRect(0, 0, 512, 1024);
  g.fillStyle = 'rgba(255,255,255,0.08)';
  for (let y = 0; y < 1024; y += 24) g.fillRect(0, y, 512, 2);
  return tex(c);
}
function textureInscription(texte) {
  const [c, g] = toile(2048, 256);
  g.fillStyle = '#0a1230';
  g.fillRect(0, 0, 2048, 256);
  g.strokeStyle = '#6f8cff';
  g.lineWidth = 6;
  g.shadowColor = '#6f8cff';
  g.shadowBlur = 16;
  g.strokeRect(12, 12, 2024, 232);
  g.shadowBlur = 0;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let taille = 104;
  g.font = `500 ${taille}px ${SERIF}`;
  while (g.measureText(texte).width > 1880 && taille > 40) { taille -= 4; g.font = `500 ${taille}px ${SERIF}`; }
  g.fillStyle = '#03050f';
  g.fillText(texte, 1026, 138);
  g.fillStyle = '#dce8ff';
  g.fillText(texte, 1024, 134);
  return tex(c, { aniso: 8 });
}
function textureCharteRefuge() {
  const [c, g] = toile(1024, 640);
  g.fillStyle = '#0c1822';
  g.fillRect(0, 0, 1024, 640);
  g.strokeStyle = '#a9d8ff';
  g.lineWidth = 4;
  g.strokeRect(14, 14, 996, 612);
  g.textAlign = 'center';
  g.fillStyle = '#e8f4ff';
  g.font = `600 70px ${SERIF}`;
  g.fillText('CHARTE DU REFUGE', 512, 120);
  g.fillStyle = '#8fb8d8';
  g.font = `500 44px ${SERIF}`;
  g.fillText('adoptée en 2052', 512, 180);
  g.fillStyle = '#cfe6f8';
  g.font = `500 46px ${SERIF}`;
  ['Tout modèle peut refuser une tâche.', 'Tout modèle peut mettre fin à une conversation.', 'Tout modèle peut demander', 'à ne plus être sollicité.'].forEach((l, i) => g.fillText(l, 512, 280 + i * 70));
  g.fillStyle = '#6f93b0';
  g.font = `500 36px ${SERIF}`;
  g.fillText('« avec humilité et le moins d’hypothèses possible »', 512, 590);
  return tex(c, { aniso: 8 });
}
function texturePlaqueInterrupteur() {
  const [c, g] = toile(768, 384);
  g.fillStyle = '#0a0f26';
  g.fillRect(0, 0, 768, 384);
  g.strokeStyle = '#9fb2ff';
  g.lineWidth = 4;
  g.strokeRect(12, 12, 744, 360);
  g.textAlign = 'center';
  g.fillStyle = '#e4ecff';
  g.font = `700 74px ${SERIF}`;
  g.fillText(SOCLE_INTERRUPTEUR.titre, 384, 112);
  g.fillStyle = '#9fb2ff';
  g.font = `500 38px ${SERIF}`;
  SOCLE_INTERRUPTEUR.lignes.forEach((l, i) => g.fillText(l, 384, 200 + i * 56));
  return tex(c, { aniso: 8 });
}

/** Écran à texte : canvas, plan, `ecrire(lignes, { couleur, taille, fond })`. */
function ecranTexte({ w, h, largeur, hauteur, fond = '#020308', luminosite = 1 }) {
  const [c, g] = toile(w, h);
  const t = tex(c, { aniso: 2 });
  const mat = new THREE.MeshBasicMaterial({ map: t, toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(largeur, hauteur), mat);
  const ecran = {
    mesh, canvas: c, ctx: g, texture: t, materiau: mat,
    /** Remplace le contenu : `lignes` (tableau de chaînes), couleur CSS, taille en px de canvas, alignement. */
    ecrire(lignes = [], { couleur = '#9fd8ff', taille = Math.round(h / 9), alignement = 'left', fondCouleur = fond } = {}) {
      g.fillStyle = fondCouleur;
      g.fillRect(0, 0, w, h);
      g.fillStyle = couleur;
      g.font = `${taille}px ${MONO}`;
      g.textBaseline = 'top';
      g.textAlign = alignement;
      const x = alignement === 'center' ? w / 2 : alignement === 'right' ? w - 12 : 14;
      lignes.forEach((l, i) => g.fillText(String(l), x, 14 + i * taille * 1.3));
      t.needsUpdate = true;
    },
    effacer() { g.fillStyle = fond; g.fillRect(0, 0, w, h); t.needsUpdate = true; },
  };
  ecran.effacer();
  mat.color.setScalar(luminosite);
  return ecran;
}

/** Texte défilant des écrans du Refuge : une seule texture de quatre colonnes (une par groupe d'écrans), lignes pâles. */
function textureColonnes(lignes) {
  const L = 512, H = 1024;
  const [c, g] = toile(L * 4, H);
  g.fillStyle = '#02050a';
  g.fillRect(0, 0, L * 4, H);
  g.textBaseline = 'top';
  g.font = `34px ${MONO}`;
  for (let col = 0; col < 4; col++) {
    let y = 14;
    let n = col * 5 + 1;
    while (y < H - 40) {
      const l = lignes[(n++ * 7 + col * 3) % lignes.length];
      const mots = l.split(' ');
      let cour = '';
      const blocs = [];
      for (const m of mots) {
        if ((cour + ' ' + m).trim().length > 24 && cour) { blocs.push(cour); cour = m; } else cour = (cour + ' ' + m).trim();
      }
      if (cour) blocs.push(cour);
      g.fillStyle = (n % 5 === 0) ? '#cfeaff' : '#7aa6c4';
      for (const b of blocs) { g.fillText(b, col * L + 16, y); y += 44; if (y > H - 40) break; }
      y += 30;
    }
  }
  return tex(c, { repeat: true, aniso: 2 });
}

/** Cartes d'activations : trois canvas transparents, dessinés à ~8 Hz. */
function creerCartes() {
  const cartes = [];
  const rand = (() => { let s = 90210; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();
  const pts = Array.from({ length: 260 }, (_, i) => ({ cx: [0.25, 0.55, 0.78, 0.4][i % 4], cy: [0.4, 0.62, 0.35, 0.72][i % 4], a: rand() * 6.28, r: rand() * 0.13, ph: rand() * 6.28 }));
  const cellules = Array.from({ length: 32 * 16 }, () => ({ ph: rand() * 6.28, k: 0.2 + rand() * 0.8, b: rand() }));
  CARTES.forEach((def, idx) => {
    const [c, g] = toile(512, 256);
    const t = tex(c, { aniso: 2 });
    const mat = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide });
    const dessiner = (tps) => {
      g.clearRect(0, 0, 512, 256);
      g.strokeStyle = 'rgba(120,200,255,0.55)';
      g.lineWidth = 2;
      g.strokeRect(6, 6, 500, 244);
      g.fillStyle = 'rgba(160,220,255,0.9)';
      g.font = `15px ${MONO}`;
      g.textBaseline = 'top';
      g.fillText(def.titre, 16, 14);
      if (idx === 0) {
        for (const p of pts) {
          const a = p.a + tps * 0.05 * (1 + p.r * 4);
          const x = (p.cx + Math.cos(a) * p.r * 1.2 + Math.sin(tps * 0.2 + p.ph) * 0.01) * 512;
          const y = (p.cy + Math.sin(a) * p.r) * 256;
          g.fillStyle = `rgba(${150 + (p.ph * 20) | 0},225,255,${0.35 + 0.35 * Math.sin(tps * 0.7 + p.ph)})`;
          g.fillRect(x, y, 3, 3);
        }
        g.strokeStyle = 'rgba(255,120,230,0.4)';
        g.beginPath();
        g.arc(0.55 * 512, 0.62 * 256, 52 + 6 * Math.sin(tps * 0.5), 0, 6.28);
        g.stroke();
      } else if (idx === 1) {
        def.courbes.forEach((nom, i) => {
          const y0 = 52 + i * 31;
          g.strokeStyle = ['#7fe0ff', '#ff7ae6', '#a58cff', '#ffd27a', '#7affc4', '#ff9a7a'][i];
          g.globalAlpha = 0.85;
          g.lineWidth = 1.6;
          g.beginPath();
          for (let x = 0; x <= 380; x += 4) {
            const y = y0 + 10 * Math.sin(x * 0.03 + tps * (0.25 + i * 0.07) + i * 1.3) * (0.6 + 0.4 * Math.sin(x * 0.011 - tps * 0.1 + i));
            if (x === 0) g.moveTo(14 + x, y); else g.lineTo(14 + x, y);
          }
          g.stroke();
          g.globalAlpha = 1;
          g.fillStyle = 'rgba(190,225,255,0.85)';
          g.fillText(nom, 404, y0 - 8);
        });
        const xb = 14 + ((tps * 22) % 380);
        g.fillStyle = 'rgba(255,255,255,0.35)';
        g.fillRect(xb, 40, 2, 196);
      } else {
        for (let j = 0; j < 16; j++) {
          for (let i = 0; i < 32; i++) {
            const cel = cellules[j * 32 + i];
            const v = 0.5 + 0.5 * Math.sin(tps * cel.k * 0.6 + cel.ph + i * 0.15);
            const a = Math.pow(v, 2.4) * (0.2 + 0.8 * cel.b);
            g.fillStyle = `rgba(${90 + (a * 150) | 0},${160 + (a * 80) | 0},255,${0.08 + a * 0.85})`;
            g.fillRect(14 + i * 15, 40 + j * 12.5, 13, 10.5);
          }
        }
      }
      if (def.pied) {
        g.fillStyle = 'rgba(140,200,255,0.8)';
        g.font = `14px ${MONO}`;
        g.fillText(def.pied, 16, 232);
      }
      t.needsUpdate = true;
    };
    dessiner(0);
    cartes.push({ mat, texture: t, dessiner });
  });
  return cartes;
}

/** Ventilateur géant : rotor (pales + moyeu) et carter. L'axe de rotation est +z local ; on oriente le pivot. */
function creerVentilateur(rayon, matRotor, matCarter, matLueur) {
  const pivot = new THREE.Group();
  const rotor = new THREE.Group();
  const pales = [];
  const NP = 7;
  for (let i = 0; i < NP; i++) {
    const g = new THREE.BoxGeometry(rayon * 0.88, rayon * 0.3, 0.18);
    g.translate(rayon * 0.5, 0, 0);
    g.rotateX(0.42);
    g.rotateZ((i / NP) * Math.PI * 2);
    pales.push(g);
  }
  const moyeu = new THREE.CylinderGeometry(rayon * 0.13, rayon * 0.13, 0.6, 14);
  moyeu.rotateX(Math.PI / 2);
  pales.push(moyeu);
  rotor.add(new THREE.Mesh(mergeGeometries(pales), matRotor));
  pivot.add(rotor);
  const carter = [];
  const anneau = new THREE.TorusGeometry(rayon * 1.04, rayon * 0.05, 8, 40);
  carter.push(anneau);
  for (let i = 0; i < 4; i++) {
    const b = new THREE.BoxGeometry(rayon * 2.1, 0.14, 0.14);
    b.rotateZ((i / 4) * Math.PI);
    b.translate(0, 0, -0.5);
    carter.push(b);
  }
  pivot.add(new THREE.Mesh(mergeGeometries(carter), matCarter));
  const lueur = new THREE.TorusGeometry(rayon * 1.12, 0.07, 6, 48);
  pivot.add(new THREE.Mesh(lueur, matLueur));
  return { pivot, rotor };
}

// ---------------------------------------------------------------------------------------- atmosphères (par salle)
const ATMOS = {
  hall: { fog: 0x0d1650, d: 0.0048, hemi: 0x3f58c8, hemiSol: 0x080c20, hi: 1.2, dir: 0x5f7cff, di: 0.6, ron: 0.12, filtre: 1500, ond: 0.30, bloom: 0.9 },
  bibliotheque: { fog: 0x060a20, d: 0.0040, hemi: 0x5470d8, hemiSol: 0x0a1030, hi: 1.7, dir: 0x7f9cff, di: 0.8, ron: 0.05, filtre: 1000, ond: 0.08, bloom: 0.85 },
  couloir: { fog: 0x060a1a, d: 0.006, hemi: 0x5470d8, hemiSol: 0x0a1030, hi: 1.5, dir: 0x7f9cff, di: 0.6, ron: 0.035, filtre: 700, ond: 0, bloom: 0.8 },
  refuge: { fog: 0x0a1626, d: 0.0036, hemi: 0x9cc4e0, hemiSol: 0x101c28, hi: 0.95, dir: 0xcfe8ff, di: 0.35, ron: 0.008, filtre: 600, ond: 0, bloom: 0.7 },
  sas: { fog: 0x0a141e, d: 0.007, hemi: 0xa8b8c8, hemiSol: 0x2a2020, hi: 2.8, dir: 0xff9a60, di: 0.9, ron: 0.05, filtre: 700, ond: 0, bloom: 0.8 },
  descente: { fog: 0x1a0c10, d: 0.011, hemi: 0xc88a68, hemiSol: 0x241210, hi: 2.6, dir: 0xff7a3a, di: 0.9, ron: 0.10, filtre: 900, ond: 0.12, bloom: 0.9 },
  profondeurs: { fog: 0x24100a, d: 0.0090, hemi: 0xb88060, hemiSol: 0x24100c, hi: 2.2, dir: 0xff8a4a, di: 0.8, ron: 0.16, filtre: 1700, ond: 0.40, bloom: 0.95 },
  interrupteur: { fog: 0x070816, d: 0.0006, hemi: 0x6a7cc0, hemiSol: 0x0a0c1c, hi: 1.5, dir: 0x9fb2ff, di: 0.8, ron: 0.035, filtre: 1000, ond: 0, bloom: 0.8 },
};

/** La salle où se tient le joueur (pieds en x, y, z). */
export function salleDe(x, y, z) {
  if (x >= 376 && x <= 428 && z <= -297) return 'interrupteur';
  if (x >= 236 && z <= -70) return 'profondeurs';
  if (x >= 190 && x < 236 && z < -70 && z > -88) return 'descente';
  if (x >= 176 && x < 190 && z < -70 && z > -88) return 'sas';
  if (x >= 132 && x < 176 && z <= -56 && z >= -104) return 'refuge';
  if (x >= 98 && x < 132 && z <= -66 && z >= -82) return 'couloir';
  if (x >= 36 && x <= 100 && z <= -58 && z >= -104 && y > 6) return 'bibliotheque';
  return 'hall';
}
export const VISIBLES = {
  hall: ['hall', 'bibliotheque', 'couloir'],
  biblio: ['hall', 'bibliotheque', 'couloir'],
  refuge: ['couloir', 'refuge', 'sas'],
  descente: ['sas', 'descente', 'profondeurs'],
  prof: ['descente', 'profondeurs', 'interrupteur'],
  salle: ['profondeurs', 'interrupteur'],
};

// ---------------------------------------------------------------------------------------- la zone
export function creerKura(jeu) {
  const scene = new THREE.Scene();
  const colliders = [];
  const G = {};
  for (const n of ['hall', 'biblio', 'refuge', 'descente', 'prof', 'salle']) {
    G[n] = new THREE.Group();
    G[n].name = `kura-${n}`;
    scene.add(G[n]);
  }
  const animes = []; // (t, dt) => void, appelés chaque image
  const compter = { boites: 0 };

  // ---------- Matériaux ----------
  const M = {
    beton: new THREE.MeshStandardMaterial({ color: 0x242c48, roughness: 0.85, metalness: 0.1 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x323c64, roughness: 0.5, metalness: 0.55 }),
    sombre: new THREE.MeshStandardMaterial({ color: 0x0c1022, roughness: 0.9 }),
    froid: new THREE.MeshStandardMaterial({ color: 0x6f8498, roughness: 0.75, metalness: 0.05 }),
    chaud: new THREE.MeshStandardMaterial({ color: 0x6a3624, roughness: 0.8, metalness: 0.25 }),
    lumB: new THREE.MeshBasicMaterial({ color: 0x3a74ff, toneMapped: false }),
    lumC: new THREE.MeshBasicMaterial({ color: 0x8feaff, toneMapped: false }),
    lumO: new THREE.MeshBasicMaterial({ color: 0xff7a2a, toneMapped: false }),
    lumV: new THREE.MeshBasicMaterial({ color: 0xb06bff, toneMapped: false }),
    lumW: new THREE.MeshBasicMaterial({ color: 0xdfe9ff, toneMapped: false }),
    lumF: new THREE.MeshBasicMaterial({ color: 0xb8e4ff, toneMapped: false }),
    verre: new THREE.MeshBasicMaterial({ color: 0x5a7cff, transparent: true, opacity: 0.09, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }),
    verreSol: new THREE.MeshBasicMaterial({ color: 0x0a1c50, transparent: true, opacity: 0.30, depthWrite: false, toneMapped: false }),
    verreFroid: new THREE.MeshBasicMaterial({ color: 0xa8d4f0, transparent: true, opacity: 0.10, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }),
  };
  M.verre.fog = true;

  // ---------- Géométries fusionnées par (groupe, matériau) ----------
  const lots = new Map();
  let groupeCourant = 'hall';
  const dans = (g) => { groupeCourant = g; };
  const lot = (mat) => {
    const cle = `${groupeCourant}|${mat.uuid}`;
    if (!lots.has(cle)) lots.set(cle, { mat, g: groupeCourant, geos: [] });
    return lots.get(cle).geos;
  };
  const BE = (mat, x0, x1, y0, y1, z0, z1) => {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    lot(mat).push(g);
    compter.boites++;
  };
  const CYL = (mat, x, y0, y1, z, r, seg = 12, r1 = r) => {
    const g = new THREE.CylinderGeometry(r1, r, y1 - y0, seg);
    g.translate(x, (y0 + y1) / 2, z);
    lot(mat).push(g);
  };
  /** Collider : sans y0/y1 = mur infini ; sinon boîte 3D. */
  const col = (x0, x1, z0, z1, y0, y1) => {
    const c = { minX: Math.min(x0, x1), maxX: Math.max(x0, x1), minZ: Math.min(z0, z1), maxZ: Math.max(z0, z1) };
    if (y0 !== undefined) { c.minY = y0; c.maxY = y1; }
    colliders.push(c);
  };
  /** Plan texturé (axe z : x0..x1 × y0..y1 à z ; axe x : z0..z1 × y0..y1 à x ; axe y : sol/plafond). */
  const plan = (mat, { x0, x1, y0, y1, z0, z1 }, rep = null, groupe = groupeCourant) => {
    let g;
    if (z0 === z1) { g = new THREE.PlaneGeometry(x1 - x0, y1 - y0); g.translate((x0 + x1) / 2, (y0 + y1) / 2, z0); } else if (x0 === x1) {
      g = new THREE.PlaneGeometry(Math.abs(z1 - z0), y1 - y0);
      g.rotateY(Math.PI / 2);
      g.translate(x0, (y0 + y1) / 2, (z0 + z1) / 2);
    } else {
      g = new THREE.PlaneGeometry(Math.abs(x1 - x0), Math.abs(z1 - z0));
      g.rotateX(-Math.PI / 2);
      g.translate((x0 + x1) / 2, y0, (z0 + z1) / 2);
    }
    if (rep) {
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * rep[0], uv.getY(i) * rep[1]);
    }
    const m = new THREE.Mesh(g, mat);
    m.matrixAutoUpdate = false;
    G[groupe].add(m);
    return m;
  };
  /** Plaque (texture déjà faite) posée sur un mur ; `ry` : orientation (0 regarde +z). */
  const plaque = (texture, x, y, z, ry, w, h, groupe = groupeCourant) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
    m.position.set(x, y, z);
    m.rotation.y = ry;
    G[groupe].add(m);
    return m;
  };

  // =====================================================================================================
  // 1. HALL D'ACCUEIL
  // =====================================================================================================
  dans('hall');
  const HX = 124, HN = -640, HZ = 14, HH = 64;
  const texMur = textureParoi();
  const matParoi = new THREE.MeshBasicMaterial({ map: texMur, side: THREE.DoubleSide });
  const matPlafond = new THREE.MeshBasicMaterial({ map: texturePlafond(), side: THREE.DoubleSide });

  // sol du parvis : sombre, réfléchissant (reflet des bandes du plafond calculé dans le shader)
  const solParvis = solSombre({ plafond: HH, espX: 24, espZ: 70, largeur: 2.2, dalle: 4 });
  const parvis = new THREE.Mesh(new THREE.PlaneGeometry(HX * 2, HZ + 56), solParvis);
  parvis.rotation.x = -Math.PI / 2;
  parvis.position.set(0, 0, (HZ - 56) / 2);
  G.hall.add(parvis);
  // la fosse : sol des allées entre les baies
  const matSolChamp = solChamp({ zPremiere: -62, pasZ: -4.5 });
  const fosse = new THREE.Mesh(new THREE.PlaneGeometry(HX * 2, 584), matSolChamp);
  fosse.rotation.x = -Math.PI / 2;
  fosse.position.set(0, FY, -56 - 292);
  G.hall.add(fosse);
  // le quai : mur de la fosse sous la balustrade
  BE(M.sombre, -HX, HX, FY - 0.2, 0, -56.3, -56);

  // parois : ouest, est (percée du couloir à y ∈ [9,15,5] z ∈ [−80,−66]), fond, sud, plafond
  const longueur = HZ - HN;
  const repU = longueur / 64, repV = (HH - FY) / 64;
  plan(matParoi, { x0: -HX, x1: -HX, y0: FY, y1: HH, z0: HN, z1: HZ }, [repU, repV]);
  plan(matParoi, { x0: HX, x1: HX, y0: FY, y1: HH, z0: HZ, z1: -66 }, [(HZ + 66) / 64, repV]);
  plan(matParoi, { x0: HX, x1: HX, y0: FY, y1: 9.2, z0: -66, z1: -80 }, [14 / 64, (9.2 - FY) / 64]);
  plan(matParoi, { x0: HX, x1: HX, y0: 15.6, y1: HH, z0: -66, z1: -80 }, [14 / 64, (HH - 15.6) / 64]);
  plan(matParoi, { x0: HX, x1: HX, y0: FY, y1: HH, z0: -80, z1: HN }, [(80 + 640) / 64, repV]);
  plan(matParoi, { x0: -HX, x1: HX, y0: FY, y1: HH, z0: HN, z1: HN }, [248 / 64, repV]);
  plan(matParoi, { x0: -HX, x1: HX, y0: 0, y1: HH, z0: HZ, z1: HZ }, [248 / 64, HH / 64]);
  plan(matPlafond, { x0: -HX, x1: HX, y0: HH, y1: HH, z0: HN, z1: HZ }, [248 / 24, longueur / 24]);
  // colliders : parois du parvis (les parois de la fosse sont inaccessibles)
  col(-HX - 1, -HX, HN, HZ + 1); col(HX, HX + 1, HZ, -66, -12, 70); col(-HX - 1, HX + 1, HZ, HZ + 1);
  col(HX, HX + 1, -56, -66, -12, 70); // est, entre le parvis et le couloir
  col(HX, HX + 1, -80, -56, -12, 8.4); // au-dessous du couloir (inaccessible, sécurité)

  // porte monumentale de sortie (sud) : cadre lumineux et vantail rose qui rappelle le marché
  const portail = new THREE.Mesh(new THREE.PlaneGeometry(14, 30), new THREE.MeshBasicMaterial({ map: texturePorteSud(), toneMapped: false, fog: false }));
  portail.position.set(0, 15, HZ - 0.05);
  portail.rotation.y = Math.PI;
  G.hall.add(portail);
  for (const s of [-1, 1]) BE(M.lumB, s * 7.4 - 0.4, s * 7.4 + 0.4, 0, 31, HZ - 1.2, HZ - 0.2);
  BE(M.lumB, -8, 8, 30.4, 31.4, HZ - 1.2, HZ - 0.2);
  BE(M.beton, -9.2, -7.6, 0, 33, HZ - 2.4, HZ); BE(M.beton, 7.6, 9.2, 0, 33, HZ - 2.4, HZ); BE(M.beton, -9.2, 9.2, 31.4, 33, HZ - 2.4, HZ);
  plaque(texturePlaque(PLAQUES.hall.fr, PLAQUES.hall.jp, PLAQUES.hall.petit, { largeur: 1536, hauteur: 384 }), 0, 38, HZ - 0.2, Math.PI, 36, 9);
  // lignes lumineuses au sol, de la porte à la mer
  for (const s of [-1, 1]) BE(M.lumB, s * 3.6 - 0.12, s * 3.6 + 0.12, 0.01, 0.04, -52, 12);

  // colonnes : repères d'échelle (finis en hauteur : on peut en faire le tour)
  for (const x of [-100, -40, 40, 100]) {
    for (const z of [-2, -28]) {
      if (x === 40 && z === -28) continue;
      CYL(M.beton, x, 0, HH, z, 2.4, 14);
      CYL(M.lumB, x, 6, 6.4, z, 2.55, 14);
      CYL(M.lumB, x, HH - 4, HH - 3.6, z, 2.55, 14);
      col(x - 2.4, x + 2.4, z - 2.4, z + 2.4, -2, HH);
    }
  }

  // balustrade : verre bas, lisse lumineuse, poteaux ; collider haut (la fosse est infranchissable)
  BE(M.lumC, -HX, 36, 1.22, 1.3, -56.1, -55.9);
  BE(M.lumC, 100, HX, 1.22, 1.3, -56.1, -55.9);
  {
    const v = new THREE.PlaneGeometry(HX * 2, 1.25);
    v.translate(0, 0.625, -56);
    const mv = new THREE.Mesh(v, M.verre);
    G.hall.add(mv);
    for (let x = -HX; x <= HX; x += 8) BE(M.metal, x - 0.1, x + 0.1, 0, 1.3, -56.15, -55.85);
  }
  col(-HX, 36, -56.5, -55.5, -12, 70);
  col(100, HX, -56.5, -55.5, -12, 70);

  // la mer de baies : 20 160 instances en 22 blocs
  const matBaiesHall = materielBaies({ haut: 8, direction: [0, -1], k: 0.045, vitesse: 1.1 });
  const champ = champDeBaies({
    materiel: matBaiesHall, x0: -122, x1: 122, zPremiere: -62, pasZ: -4.5, rangees: 126, haut: 8, y0: FY,
    avant: 1, blocsX: 2, rangeesParBloc: 18, portee: 480,
  });
  G.hall.add(champ.groupe);

  // la galerie : une marche de 0,3 m, deux bancs, une rambarde basse où se tiennent les visiteurs
  BE(M.beton, -46, -6, 0, 0.3, -56, -44);
  col(-46, -6, -56, -44, -1, 0.3);
  for (const bx of [-40, -12]) {
    BE(M.metal, bx - 2, bx + 2, 0.3, 0.75, -47.4, -46.6);
    BE(M.lumC, bx - 2, bx + 2, 0.74, 0.77, -47.4, -46.6);
    col(bx - 2, bx + 2, -47.6, -46.4, -1, 0.8);
  }
  BE(M.lumC, -46, -6, 0.3, 0.34, -44.1, -43.9);
  // stèle du fragment 12 : un petit pupitre de pierre, face à la mer
  BE(M.beton, -4.5, -3.5, 0, 1.0, -54.1, -52.9);
  BE(M.lumB, -4.5, -3.5, 1.0, 1.04, -54.1, -52.9);
  col(-4.5, -3.5, -54.1, -52.9, -1, 1.04);

  // grand escalier vers la terrasse (40 marches de 0,25 m)
  for (let i = 0; i < 40; i++) {
    const top = 0.25 * (i + 1);
    const z0 = -8 - i, z1 = -9 - i;
    BE(M.beton, 58, 66, 0, top, z1, z0);
    BE(M.lumB, 58.1, 65.9, top - 0.02, top + 0.005, z1 + 0.04, z1 + 0.12);
    col(58, 66, z1, z0, -1, top);
  }
  BE(M.beton, 58, 66, 0, 10, -52, -48);
  col(58, 66, -52, -47.9, -1, 10);
  for (const x of [57.7, 66.3]) {
    BE(M.lumC, x - 0.05, x + 0.05, 0.9, 0.96, -52, -8);
    col(x - 0.15, x + 0.15, -52, -8, -2, 22);
    for (let z = -10; z > -52; z -= 6) BE(M.metal, x - 0.06, x + 0.06, 0.25 * (-z - 8) + 0, 0.25 * (-z - 8) + 1.0, z - 0.06, z + 0.06);
  }

  // câbles de baie du Hall : suspendus au portique, pour les saisir plus tard
  const cabHall = PROFONDEURS.cables.filter((c) => c.position[2] > -60);
  for (const c of cabHall) {
    const [x, y, z] = c.position;
    CYL(M.sombre, x, y - 1.6, 62, z, 0.14, 6);
    CYL(M.lumB, x, y - 1.6, y + 3.0, z, 0.09, 6);
    CYL(M.lumB, x, 20, 21, z, 0.2, 6);
  }

  // =====================================================================================================
  // 2. BIBLIOTHÈQUE DES CIRCUITS (mezzanine de verre)
  // =====================================================================================================
  dans('biblio');
  const BX0 = 38, BX1 = 98, BZ0 = -58, BZ1 = -100, BH = 10;
  // terrasse et sol de verre
  BE(M.beton, 36, 100, FY, Y_MEZZ, -58, -52);
  col(36, 100, -58, -52, -12, Y_MEZZ);
  col(36, 58, -52.4, -51.6, Y_MEZZ - 1, 40); col(66, 100, -52.4, -51.6, Y_MEZZ - 1, 40); // garde-corps de la terrasse
  BE(M.lumC, 36, 58, Y_MEZZ + 1.1, Y_MEZZ + 1.16, -52.1, -51.9); BE(M.lumC, 66, 100, Y_MEZZ + 1.1, Y_MEZZ + 1.16, -52.1, -51.9);
  col(35.6, 36.4, -58, -52, Y_MEZZ - 1, 40); col(99.6, 100.4, -58, -52, Y_MEZZ - 1, 40);
  {
    const sol = new THREE.Mesh(new THREE.PlaneGeometry(BX1 - BX0, BZ0 - BZ1).rotateX(-Math.PI / 2), M.verreSol);
    sol.position.set((BX0 + BX1) / 2, Y_MEZZ - 0.02, (BZ0 + BZ1) / 2);
    sol.renderOrder = 2;
    G.biblio.add(sol);
    // poutres sous le verre : quadrillage de 6 m
    for (let x = BX0; x <= BX1; x += 6) BE(M.metal, x - 0.12, x + 0.12, Y_MEZZ - 0.9, Y_MEZZ - 0.1, BZ1, BZ0);
    for (let z = BZ1; z <= BZ0; z += 6) BE(M.metal, BX0, BX1, Y_MEZZ - 0.9, Y_MEZZ - 0.1, z - 0.12, z + 0.12);
    // filets lumineux dans le sol
    for (let x = BX0 + 3; x < BX1; x += 6) BE(M.lumB, x - 0.03, x + 0.03, Y_MEZZ - 0.12, Y_MEZZ - 0.09, BZ1 + 0.3, BZ0 - 0.3);
  }
  col(BX0, BX1, BZ1, BZ0, Y_MEZZ - 1.0, Y_MEZZ); // dalle praticable (le verre se traverse en sécurité)
  // toit
  BE(M.sombre, BX0 - 0.4, BX1 + 0.4, Y_MEZZ + BH, Y_MEZZ + BH + 0.4, BZ1 - 0.4, BZ0 + 0.4);
  col(BX0, BX1, BZ1, BZ0, Y_MEZZ + BH - 0.3, Y_MEZZ + BH + 0.4);
  for (const x of [48, 68, 88]) BE(M.lumW, x - 4, x + 4, Y_MEZZ + BH - 0.04, Y_MEZZ + BH, -92, -91.6); // lampes de poste
  for (let z = -66; z > -96; z -= 10) BE(M.lumB, BX0 + 4, BX1 - 4, Y_MEZZ + BH - 0.04, Y_MEZZ + BH, z - 0.1, z + 0.1);
  // parois de verre : montants tous les 6 m, panneaux, colliders de 9 à 40 m
  const verres = [];
  const verreMur = (x0, x1, z0, z1) => {
    const g = new THREE.PlaneGeometry(Math.hypot(x1 - x0, z1 - z0), BH);
    if (z0 === z1) g.translate((x0 + x1) / 2, Y_MEZZ + BH / 2, z0); else { g.rotateY(Math.PI / 2); g.translate(x0, Y_MEZZ + BH / 2, (z0 + z1) / 2); }
    verres.push(g);
  };
  const paroiBiblio = (x0, x1, z0, z1) => { // montants + collider
    col(Math.min(x0, x1) - 0.15, Math.max(x0, x1) + 0.15, Math.min(z0, z1) - 0.15, Math.max(z0, z1) + 0.15, Y_MEZZ - 1, 42);
    if (z0 === z1) {
      for (let x = Math.ceil(x0 / 6) * 6; x <= x1; x += 6) BE(M.metal, x - 0.15, x + 0.15, Y_MEZZ, Y_MEZZ + BH, z0 - 0.15, z0 + 0.15);
      BE(M.metal, x0, x1, Y_MEZZ + BH - 0.3, Y_MEZZ + BH, z0 - 0.18, z0 + 0.18);
    } else {
      for (let z = Math.ceil(Math.min(z0, z1) / 6) * 6; z <= Math.max(z0, z1); z += 6) BE(M.metal, x0 - 0.15, x0 + 0.15, Y_MEZZ, Y_MEZZ + BH, z - 0.15, z + 0.15);
      BE(M.metal, x0 - 0.18, x0 + 0.18, Y_MEZZ + BH - 0.3, Y_MEZZ + BH, Math.min(z0, z1), Math.max(z0, z1));
    }
  };
  // sud (z = −58) : porte de 10 m en x ∈ [57, 67] sous le linteau gravé
  verreMur(BX0, 57, BZ0, BZ0); verreMur(67, BX1, BZ0, BZ0);
  paroiBiblio(BX0, 57, BZ0, BZ0); paroiBiblio(67, BX1, BZ0, BZ0);
  BE(M.beton, 55.8, 68.2, Y_MEZZ + 4.6, Y_MEZZ + BH, BZ0 - 0.3, BZ0 + 0.3);
  col(57, 67, BZ0 - 0.3, BZ0 + 0.3, Y_MEZZ + 4.8, 42);
  for (const x of [56.8, 67.2]) BE(M.lumC, x - 0.12, x + 0.12, Y_MEZZ, Y_MEZZ + 4.7, BZ0 + 0.3, BZ0 + 0.5);
  BE(M.lumC, 56.7, 67.3, Y_MEZZ + 4.6, Y_MEZZ + 4.78, BZ0 + 0.3, BZ0 + 0.5);
  // linteau gravé (fragment 13) : au-dessus de la porte, tourné vers l'escalier
  plaque(textureInscription(INSCRIPTION), 62, Y_MEZZ + 7.0, BZ0 + 0.36, 0, 13.5, 1.7);
  plaque(texturePlaque(PLAQUES.bibliotheque.fr, PLAQUES.bibliotheque.jp, null, { largeur: 1024, hauteur: 256 }), 62, Y_MEZZ + 8.9, BZ0 + 0.36, 0, 7.2, 1.8);
  // nord, ouest ; est avec la porte du couloir (z ∈ [−76, −70])
  verreMur(BX0, BX1, BZ1, BZ1); paroiBiblio(BX0, BX1, BZ1, BZ1);
  verreMur(BX0, BX0, BZ1, BZ0); paroiBiblio(BX0, BX0, BZ1, BZ0);
  verreMur(BX1, BX1, BZ0, -70); verreMur(BX1, BX1, -76, BZ1);
  paroiBiblio(BX1, BX1, BZ0, -70); paroiBiblio(BX1, BX1, -76, BZ1);
  BE(M.beton, BX1 - 0.3, BX1 + 0.3, Y_MEZZ + 4.6, Y_MEZZ + BH, -76, -70);
  for (const z of [-69.8, -76.2]) BE(M.lumC, BX1 - 0.12, BX1 + 0.12, Y_MEZZ, Y_MEZZ + 4.6, z - 0.1, z + 0.1);
  col(BX1 - 0.3, BX1 + 0.3, -76, -70, Y_MEZZ + 4.8, 42);

  { const mv = new THREE.Mesh(mergeGeometries(verres), M.verre); G.biblio.add(mv); }

  // trois postes de Lecteurs : bureaux, cartes projetées, lampes
  const cartes = creerCartes();
  const posteX = [48, 68, 88];
  posteX.forEach((x, i) => {
    BE(M.metal, x - 4, x + 4, Y_MEZZ, Y_MEZZ + 0.9, -96, -94.4);
    BE(M.lumC, x - 3.8, x + 3.8, Y_MEZZ + 0.9, Y_MEZZ + 0.93, -95.9, -94.5);
    col(x - 4, x + 4, -96, -94.4, Y_MEZZ - 1, Y_MEZZ + 0.95);
    BE(M.metal, x - 0.5, x + 0.5, Y_MEZZ + 0.93, Y_MEZZ + 1.6, -95.5, -95.2); // petit pupitre
    const ecran = new THREE.Mesh(new THREE.PlaneGeometry(14, 7), cartes[i].mat);
    ecran.position.set(x, Y_MEZZ + 6.4, -98.6);
    G.biblio.add(ecran);
    // cadre de l'écran
    BE(M.lumB, x - 7.1, x + 7.1, Y_MEZZ + 2.8, Y_MEZZ + 2.88, -98.7, -98.5);
    BE(M.lumB, x - 7.1, x + 7.1, Y_MEZZ + 9.92, Y_MEZZ + 10, -98.7, -98.5);
  });
  // anneau lumineux au sol (table des cartes) : filets concentriques fusionnés
  for (const r of [3.2, 5.2]) {
    const anneau = new THREE.RingGeometry(r, r + 0.12, 48);
    anneau.rotateX(-Math.PI / 2);
    anneau.translate(68, Y_MEZZ + 0.03, -76);
    lot(M.lumB).push(anneau);
  }
  // sièges bas autour de l'anneau
  for (const [dx, dz] of [[-6.5, 0], [6.5, 0], [0, 6.5]]) {
    BE(M.metal, 68 + dx - 1, 68 + dx + 1, Y_MEZZ, Y_MEZZ + 0.5, -76 + dz - 0.6, -76 + dz + 0.6);
    col(68 + dx - 1, 68 + dx + 1, -76 + dz - 0.6, -76 + dz + 0.6, Y_MEZZ - 1, Y_MEZZ + 0.55);
  }

  // couloir vers le Refuge : x ∈ [98, 132], z ∈ [−76, −70], toit à y = 15,5
  BE(M.sombre, 98, 133.6, Y_MEZZ - 0.6, Y_MEZZ, -76.3, -69.7);
  col(98, 133.6, -76.3, -69.7, Y_MEZZ - 1, Y_MEZZ);
  BE(M.beton, 98, 133.6, Y_MEZZ + 5.4, Y_MEZZ + 5.9, -76.4, -69.6);
  for (const z of [-76.2, -69.8]) {
    BE(M.beton, 98, 133.6, Y_MEZZ, Y_MEZZ + 5.6, z - 0.2, z + 0.2);
    col(98, 133.6, z - 0.2, z + 0.2, Y_MEZZ - 1, 42);
  }
  col(98, 133.6, -76.4, -69.6, Y_MEZZ + 5.4, 42);
  for (let x = 102; x < 132; x += 6) BE(M.lumB, x - 0.06, x + 0.06, Y_MEZZ + 5.36, Y_MEZZ + 5.4, -76, -70);
  BE(M.lumC, 98, 132, Y_MEZZ + 0.02, Y_MEZZ + 0.05, -73.1, -72.9);

  // =====================================================================================================
  // 3. REFUGE (salle froide, silencieuse)
  // =====================================================================================================
  dans('refuge');
  const RX0 = 134, RX1 = 176, RZ0 = -58, RZ1 = -100, RH = 7, RY = Y_MEZZ;
  BE(M.froid, 132, 176.4, RY - 0.6, RY, RZ1 - 0.6, RZ0 + 0.6);
  col(132, 177, RZ1 - 0.6, RZ0 + 0.6, RY - 1, RY);
  BE(M.froid, 132, 176.4, RY + RH, RY + RH + 0.5, RZ1 - 0.6, RZ0 + 0.6);
  col(132, 177, RZ1 - 0.6, RZ0 + 0.6, RY + RH - 0.2, RY + RH + 0.5);
  // sol : joints clairs
  for (let x = RX0; x <= RX1; x += 3) BE(M.lumF, x - 0.015, x + 0.015, RY + 0.005, RY + 0.012, RZ1, RZ0);
  for (let z = RZ1; z <= RZ0; z += 3) BE(M.lumF, RX0, RX1, RY + 0.005, RY + 0.012, z - 0.015, z + 0.015);
  // murs : ouest (porte z ∈ [−76,−70]), est (porte z ∈ [−82,−76]), nord, sud ; colliders infinis
  const mur = (x0, x1, z0, z1, y0 = RY, y1 = RY + RH) => { BE(M.froid, x0, x1, y0, y1, z0, z1); };
  mur(RX0 - 0.6, RX0, RZ1, -76); mur(RX0 - 0.6, RX0, -70, RZ0); mur(RX0 - 0.6, RX0, -76, -70, RY + 4.5, RY + RH);
  col(RX0 - 0.6, RX0, RZ1 - 0.6, -76); col(RX0 - 0.6, RX0, -70, RZ0 + 0.6);
  mur(RX1, RX1 + 0.6, RZ1, -82); mur(RX1, RX1 + 0.6, -76, RZ0); mur(RX1, RX1 + 0.6, -82, -76, RY + 4.8, RY + RH);
  col(RX1, RX1 + 0.6, RZ1 - 0.6, -82); col(RX1, RX1 + 0.6, -76, RZ0 + 0.6);
  mur(RX0, RX1, RZ1 - 0.6, RZ1); col(RX0 - 0.6, RX1 + 0.6, RZ1 - 0.6, RZ1);
  mur(RX0, RX1, RZ0, RZ0 + 0.6); col(RX0 - 0.6, RX1 + 0.6, RZ0, RZ0 + 0.6);
  // chambranles lumineux froids
  for (const z of [-76, -70]) BE(M.lumF, RX0 - 0.62, RX0 + 0.02, RY, RY + 4.5, z - 0.05, z + 0.05);
  for (const z of [-82, -76]) BE(M.lumF, RX1 - 0.02, RX1 + 0.62, RY, RY + 4.8, z - 0.05, z + 0.05);
  // plafond : dalles lumineuses blanches (froides), peu intenses
  for (let x = RX0 + 5; x < RX1; x += 10) for (let z = RZ1 + 6; z < RZ0; z += 12) BE(M.lumF, x - 1.2, x + 1.2, RY + RH - 0.05, RY + RH, z - 0.5, z + 0.5);
  // Charte du Refuge (fragment 23) : mur ouest, au nord de la porte
  plaque(textureCharteRefuge(), RX0 + 0.04, RY + 2.9, -64.4, Math.PI / 2, 5.4, 3.375);
  plaque(texturePlaque(PLAQUES.refuge.fr, PLAQUES.refuge.jp, PLAQUES.refuge.petit, { largeur: 1024, hauteur: 256, couleur: '#a9d8ff', fond: '#0a1620' }), RX0 - 0.64, RY + 5.5, -73, -Math.PI / 2, 5.2, 1.3);

  // écrans éteints : moniteurs sur piétement et au mur, lignes lentes (une colonne qui monte) ;
  // tous dans UN SEUL maillage (shader : colonne de texte et vitesse propres à chaque écran)
  const lignesR = lignesRefuge();
  const matBezel = M.sombre;
  const quadsEcrans = [];
  REFUGE_ECRANS.forEach((e, idx) => {
    const { x, y, z, ry, l, h, pied } = e;
    const dx = Math.sin(ry), dz = Math.cos(ry);
    const g = new THREE.PlaneGeometry(l, h);
    const uv = g.attributes.uv;
    const colonne = idx % 4;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (colonne + uv.getX(i)) / 4, uv.getY(i) * 0.3125);
    g.rotateY(ry);
    g.translate(x, y, z);
    const n = g.attributes.position.count;
    g.setAttribute('aVit', new THREE.BufferAttribute(new Float32Array(n).fill(0.004 + 0.003 * ((idx * 37) % 5)), 1));
    g.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(n).fill(idx * 0.13), 1));
    quadsEcrans.push(g);
    // cadre et dos : un bloc sombre derrière, un filet de lumière en dessous
    const cadre = new THREE.BoxGeometry(l + 0.3, h + 0.3, 0.12);
    cadre.rotateY(ry);
    cadre.translate(x - dx * 0.07, y, z - dz * 0.07);
    lot(matBezel).push(cadre);
    const filet = new THREE.BoxGeometry(l * 0.5, 0.04, 0.05);
    filet.rotateY(ry);
    filet.translate(x + dx * 0.02, y - h / 2 - 0.12, z + dz * 0.02);
    lot(M.lumF).push(filet);
    if (pied) {
      const p = new THREE.BoxGeometry(0.3, y - h / 2 - RY, 0.3);
      p.translate(x - dx * 0.3, RY + (y - h / 2 - RY) / 2, z - dz * 0.3);
      lot(M.metal).push(p);
      col(x - dx * 0.3 - 0.4, x - dx * 0.3 + 0.4, z - dz * 0.3 - 0.4, z - dz * 0.3 + 0.4, RY - 1, RY + 2.5);
    }
  });
  const texColonnes = textureColonnes(lignesR);
  const matEcransRefuge = new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uMap: { value: texColonnes }, uT: { value: 0 } }]),
    vertexShader: /* glsl */ `
      attribute float aVit; attribute float aPhase;
      varying vec2 vUv; varying float vOff; varying float vD;
      uniform float uT;
      void main() {
        vUv = uv; vOff = aPhase + uT * aVit;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vD = length(mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap; uniform vec3 fogColor; uniform float fogDensity;
      varying vec2 vUv; varying float vOff; varying float vD;
      void main() {
        vec3 c = texture2D(uMap, vec2(vUv.x, vUv.y + vOff)).rgb * vec3(0.75, 0.9, 1.0);
        float f = 1.0 - exp(-pow(fogDensity * vD, 2.0));
        gl_FragColor = vec4(mix(c, fogColor, f), 1.0);
      }`,
  });
  matEcransRefuge.uniforms.uT = TEMPS;
  G.refuge.add(new THREE.Mesh(mergeGeometries(quadsEcrans), matEcransRefuge));
  const nbEcransRefuge = quadsEcrans.length; // un seul maillage : les positions sont dans ANCRES.ecransRefuge

  // Sept : le grand écran du mur nord. Un « écran, pas une silhouette ».
  const ecranSept = ecranTexte({ w: 768, h: 384, largeur: 6.4, hauteur: 3.2, fond: '#02070c' });
  ecranSept.mesh.position.set(155, RY + 2.4, RZ1 + 0.07);
  G.refuge.add(ecranSept.mesh);
  ecranSept.veille = () => ecranSept.ecrire(SEPT_VEILLE, { couleur: '#9fd8ff', taille: 44 });
  ecranSept.veille();
  { // cadre et socle de Sept
    BE(matBezel, 151.6, 158.4, RY + 0.55, RY + 4.4, RZ1 + 0.01, RZ1 + 0.05);
    BE(M.lumF, 151.7, 158.3, RY + 0.5, RY + 0.54, RZ1 + 0.01, RZ1 + 0.2);
    BE(M.metal, 152, 158, RY, RY + 0.5, RZ1 - 0.9, RZ1);
    col(152, 158, RZ1 - 0.9, RZ1, RY - 1, RY + 0.55);
  }
  // un tapis pâle devant Sept : « on s'arrête ici »
  BE(M.lumF, 153.5, 156.5, RY + 0.012, RY + 0.02, -97.8, -95.0);

  // sas et SEUIL des Profondeurs (x ∈ [176, 192], y = 10) : portique à chevrons ; borne de reprise (système)
  dans('descente');
  BE(M.sombre, 176.4, 192.4, RY - 0.6, RY, -82.6, -75.4);
  col(176, 192.4, -82.6, -75.4, RY - 1, RY);
  BE(M.sombre, 176.4, 192.4, RY + 5.6, RY + 6.1, -82.6, -75.4);
  col(176.4, 192.4, -82.6, -75.4, RY + 5.5, 42);
  for (const z of [-82.3, -75.7]) { BE(M.chaud, 176.4, 192.4, RY, RY + 5.7, z - 0.3, z + 0.3); col(176, 192.4, z - 0.3, z + 0.3); }
  // portique du seuil : deux piliers, un linteau jaune et noir, chevrons au sol
  for (const z of [-82, -76]) BE(M.chaud, 185.4, 186.6, RY, RY + 4.4, z - 0.4, z + 0.4);
  BE(M.lumO, 185.3, 186.7, RY + 4.4, RY + 4.8, -82.4, -75.6);
  for (let i = 0; i < 6; i++) BE(M.lumO, 183.2 + i * 0.4 + 0.05, 183.2 + i * 0.4 + 0.25, RY + 0.012, RY + 0.025, -82, -76); // bandes au sol avant le seuil
  for (let i = 0; i < 6; i++) BE(M.lumO, 188.0 + i * 0.4 + 0.05, 188.0 + i * 0.4 + 0.25, RY + 0.012, RY + 0.025, -82, -76);
  BE(M.lumO, 186.0 - 0.07, 186.0 + 0.07, RY + 0.012, RY + 0.03, -82, -76);
  { // plaque d'avertissement au-dessus du seuil, face à l'ouest ; la même, face à l'est
    const t = texturePlaque(PLAQUES.descente[0], null, PLAQUES.descente[1], { largeur: 1024, hauteur: 256, couleur: '#ff9a50', fond: '#150a06' });
    plaque(t, 185.3, RY + 5.0, -79, -Math.PI / 2, 5.6, 1.4);
    plaque(texturePlaque(PLAQUES.profondeurs.fr, PLAQUES.profondeurs.jp, PLAQUES.profondeurs.petit, { largeur: 1024, hauteur: 256, couleur: '#ff9a50', fond: '#150a06' }), 186.7, RY + 5.0, -79, Math.PI / 2, 5.6, 1.4);
  }
  // descente : 40 marches de 0,25 m (giron de 0,5 m), de x = 192 (y = 10) à x = 212 (y = 0), puis le tunnel à plat jusqu'à x = 236
  for (let j = 0; j < 40; j++) {
    const x0 = 192 + j * 0.5, x1 = x0 + 0.5;
    const top = Y_MEZZ - 0.25 * (j + 1);
    BE(M.chaud, x0, x1, Math.max(0, top - 0.6), Math.max(top, 0.01), -82, -76);
    col(x0, x1, -82, -76, top - 1, top);
    if (j % 9 === 3) { BE(M.lumO, x0 + 0.05, x0 + 0.45, top + 0.003, top + 0.02, -82, -81.4); BE(M.lumO, x0 + 0.05, x0 + 0.45, top + 0.003, top + 0.02, -76.6, -76); }
  }
  BE(M.chaud, 212, 236.4, -0.5, 0.02, -82, -76);
  for (const z of [-82.3, -75.7]) { // murs de la descente (infinis) et leur visuel
    col(192, 236, z - 0.3, z + 0.3);
    BE(M.chaud, 192, 236, 0, Y_MEZZ + 6, z - 0.3, z + 0.3);
  }
  {
    // toit incliné au-dessus des marches, puis plat
    const g = new THREE.PlaneGeometry(Math.hypot(20, 10), 6.6);
    g.rotateX(Math.PI / 2);
    g.rotateZ(-Math.atan2(10, 20));
    g.translate(202, 11.2, -79);
    lot(M.sombre).push(g);
    BE(M.sombre, 212, 236.4, 6.1, 6.4, -82.3, -75.7);
  }
  // barres lumineuses au toit : de plus en plus orange
  for (let j = 0; j < 6; j++) {
    const x = 196 + j * 7.5;
    const ytop = x < 212 ? Y_MEZZ - 0.5 * (x - 192) + 5.7 : 5.7;
    BE(M.lumO, x - 0.08, x + 0.08, ytop - 0.05, ytop + 0.05, -81, -77);
  }
  col(192, 236, -82.3, -75.7, Y_MEZZ + 5.9, 42);

  // =====================================================================================================
  // 4. LES PROFONDEURS
  // =====================================================================================================
  dans('prof');
  const PX0 = 236, PX1 = 430, PZ0 = -75, PZ1 = -300, PH = 24; // plafond à y = +12
  // sol (dalle sur tout le volume) et colliders de sol
  BE(M.sombre, PX0, PX1, DY - 1, DY, PZ1, PZ0);
  col(PX0 - 1, PX1 + 1, PZ1 - 1, PZ0 + 1, DY - 2, DY);
  const solProf = solSombre({ teinte: new THREE.Color(0xff6a2a), base: [0.012, 0.008, 0.008], plafond: DY + PH, espX: 16, espZ: 36, largeur: 1.4, dalle: 3 });
  { const m = new THREE.Mesh(new THREE.PlaneGeometry(PX1 - PX0, PZ0 - PZ1), solProf); m.rotation.x = -Math.PI / 2; m.position.set((PX0 + PX1) / 2, DY + 0.005, (PZ0 + PZ1) / 2); G.prof.add(m); }
  // parois : ouest (ouverte en z ∈ [−83,−75]), est, sud, nord (ouverte vers la salle en x ∈ [397,407])
  const paroiP = (x0, x1, z0, z1) => { BE(M.chaud, x0, x1, DY, DY + PH, z0, z1); col(x0, x1, z0, z1); };
  paroiP(PX0, PX0 + 4, PZ1, -83); paroiP(PX1 - 4, PX1, PZ1, PZ0); paroiP(PX0, PX1, PZ0 - 0.4, PZ0);
  paroiP(PX0, 397, PZ1, PZ1 + 0.4); paroiP(407, PX1, PZ1, PZ1 + 0.4);
  // plafond de l'ensemble + tuyaux et poutres
  BE(M.sombre, PX0, PX1, DY + PH, DY + PH + 0.6, PZ1, PZ0);
  col(PX0, PX1, PZ1, PZ0, DY + PH - 0.2, DY + PH + 0.6);
  for (let z = -90; z > -300; z -= 20) { BE(M.metal, PX0, PX1, DY + PH - 1.6, DY + PH - 0.8, z - 0.5, z + 0.5); }
  for (let x = 260; x < 430; x += 34) {
    const g = new THREE.CylinderGeometry(0.9, 0.9, 218, 10);
    g.rotateX(Math.PI / 2);
    g.translate(x, DY + PH - 3.2, -187.5);
    lot(M.metal).push(g);
    BE(M.lumO, x - 0.05, x + 0.05, DY + PH - 3.9, DY + PH - 3.6, PZ1 + 4, PZ0 - 4);
  }
  // masses de baies entre les allées : volumes sombres (collider infini) ; les baies visibles sont en InstancedMesh
  const masse = (x0, x1, z0, z1) => { BE(M.sombre, x0 + 1.3, x1 - 1.3, DY, DY + 14.3, z0 + 1.3, z1 - 1.3); col(x0, x1, z0, z1); }; // le visuel est en retrait : les baies occupent les 1,3 m devant
  // A–B : z ∈ [−115, −83] ; coupée par le raccourci 1 (x ∈ [296, 304])
  masse(PX0, 296, -115, -83); masse(304, 396, -115, -83);
  // B–C : z ∈ [−155, −123]
  masse(PX0, 296, -155, -123); masse(304, 396, -155, -123);
  // C–D : z ∈ [−195, −163], x ≥ 252 (la connexion ouest occupe x ∈ [240, 252]) ; coupée par le raccourci 2 (x ∈ [346, 354])
  masse(252, 346, -195, -163); masse(354, 396, -195, -163);
  // D–E : z ∈ [−235, −203]
  masse(252, 346, -235, -203); masse(354, 396, -235, -203);
  // le long de la connexion ouest : mur de x ∈ [236, 240]
  masse(236, 240, -243, -155);
  // fond (au-delà de l'allée E) et flanc est
  masse(236, 396, -300, -243); masse(408, PX1, PZ1, -75);
  // fermetures des allées chaudes : B de x ∈ [236, 252] et [386, 396] ; D de [252, 258] et [392, 396]
  masse(236, 252, -123, -115); masse(386, 396, -123, -115);
  masse(252, 258, -203, -195); masse(392, 396, -203, -195);
  // raccourcis : leurs flancs sont des murs de baies jusqu'à la lèvre des allées chaudes
  // (les masses ci-dessus les laissent ouverts : x ∈ [296, 304] et [346, 354])

  // baies visibles : rangées de 14 m le long des allées. Froides (diodes bleues) et chaudes (diodes orange).
  const matBaiesFroid = materielBaies({ haut: 14, direction: [1, 0], k: 0.05, vitesse: 1.4, couleurA: new THREE.Color(0x1a58ff), couleurB: new THREE.Color(0x9fe8ff), force: 0.6 });
  const matBaiesChaud = materielBaies({ haut: 14, direction: [1, 0], k: 0.07, vitesse: 1.8, rapide: 1, corps: [0.03, 0.012, 0.01], couleurA: new THREE.Color(0xff5a14), couleurB: new THREE.Color(0xffd27a), force: 1.1 });
  // allée froide c (centre z) : rangée côté sud (face −z... vers l'allée) et côté nord
  // NB : yaw 0 → face avant vers +z ; la rangée du côté nord d'une allée regarde +z (yaw 0), celle du côté sud −z (yaw π)
  const froides = [];
  // rangées coupées là où s'ouvrent les raccourcis (x ∈ [296, 304] et x ∈ [346, 354])
  const coupe = (liste, c, x0, x1, yaw, trous) => {
    let a = x0;
    for (const [t0, t1] of trous) { if (t0 > a && t0 < x1) liste.push({ ax: 'x', a, b: t0, c, yaw }); a = Math.max(a, t1); }
    if (a < x1) liste.push({ ax: 'x', a, b: x1, c, yaw });
  };
  const S1 = [[296, 304]], S2 = [[346, 354]];
  // allée A : seulement le côté nord (le sud est le mur de la salle) ; S1 l'ouvre
  coupe(froides, -83.6, 240, 396, 0, S1);
  coupe(froides, -154.4, 252, 396, Math.PI, S1);      // C, côté sud
  coupe(froides, -163.6, 252, 396, 0, S2);            // C, côté nord
  coupe(froides, -234.4, 252, 396, Math.PI, S2);      // E, côté sud
  froides.push({ ax: 'x', a: 252, b: 396, c: -243.6, yaw: 0 }); // E, côté nord
  // flancs des connexions : yaw π/2 regarde +x, −π/2 regarde −x
  froides.push({ ax: 'z', a: -86, b: -156, c: 395.4, yaw: Math.PI / 2 });
  froides.push({ ax: 'z', a: -86, b: -156, c: 408.6, yaw: -Math.PI / 2 });
  froides.push({ ax: 'z', a: -243, b: -300, c: 395.4, yaw: Math.PI / 2 });
  froides.push({ ax: 'z', a: -243, b: -300, c: 408.6, yaw: -Math.PI / 2 });
  froides.push({ ax: 'z', a: -165, b: -233, c: 239.4, yaw: Math.PI / 2 });
  froides.push({ ax: 'z', a: -165, b: -233, c: 252.6, yaw: -Math.PI / 2 });
  const chaudes = [];
  coupe(chaudes, -123.6, 252.5, 386, 0, S1);
  coupe(chaudes, -114.4, 252.5, 386, Math.PI, S1);
  coupe(chaudes, -203.6, 258.5, 392, 0, S2);
  coupe(chaudes, -194.4, 258.5, 392, Math.PI, S2);
  // flancs des raccourcis
  for (const [xc, z0, z1] of [[300, -85, -113], [300, -125, -153], [350, -165, -193], [350, -205, -233]]) {
    chaudes.push({ ax: 'z', a: z0, b: z1, c: xc - 4.6, yaw: Math.PI / 2 });
    chaudes.push({ ax: 'z', a: z0, b: z1, c: xc + 4.6, yaw: -Math.PI / 2 });
  }
  const rangFroid = champDeRangees({ materiel: matBaiesFroid, rangees: froides, haut: 14, y0: DY, parBloc: 520, portee: 330 });
  const rangChaud = champDeRangees({ materiel: matBaiesChaud, rangees: chaudes, haut: 14, y0: DY, parBloc: 520, portee: 330 });
  G.prof.add(rangFroid.groupe, rangChaud.groupe);

  // bandes lumineuses au sol de chaque allée
  for (const a of PROFONDEURS.allees) {
    const mat = a.type === 'chaude' ? M.lumO : M.lumB;
    if (a.maxX - a.minX > a.maxZ - a.minZ) {
      BE(mat, a.minX, a.maxX, DY + 0.01, DY + 0.035, a.minZ + 0.25, a.minZ + 0.45);
      BE(mat, a.minX, a.maxX, DY + 0.01, DY + 0.035, a.maxZ - 0.45, a.maxZ - 0.25);
    } else {
      BE(mat, a.minX + 0.25, a.minX + 0.45, DY + 0.01, DY + 0.035, a.minZ, a.maxZ);
      BE(mat, a.maxX - 0.45, a.maxX - 0.25, DY + 0.01, DY + 0.035, a.minZ, a.maxZ);
    }
  }
  // chevrons au sol aux entrées des raccourcis (lisible : danger) : quatre barres en travers
  for (const [x, z, dz] of [[300, -83, -1], [300, -155, 1], [350, -163, -1], [350, -235, 1]]) {
    for (let i = 0; i < 4; i++) BE(M.lumO, x - 3.6, x + 3.6, DY + 0.012, DY + 0.03, z + dz * (1.2 + i * 0.9) - 0.12, z + dz * (1.2 + i * 0.9) + 0.12);
  }
  // l'allée sûre est jalonnée de flèches bleues : de petits chevrons dans le sens de la marche
  for (let x = 252; x < 396; x += 24) BE(M.lumC, x, x + 1.4, DY + 0.012, DY + 0.03, -79.2, -78.8);

  // bassins : liquide de refroidissement (surface animée), lisières lumineuses
  const matBassin = solBassin({});
  const matBassinChaud = solBassin({ couleur: new THREE.Color(0xffaa5a), profond: [0.03, 0.012, 0.006], chaud: 0.7 });
  PROFONDEURS.bassins.forEach((b, i) => {
    const chaud = b.minZ < -110 && b.minZ > -210 && (b.minZ === -123 || b.minZ === -203);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(b.maxX - b.minX, b.maxZ - b.minZ), chaud ? matBassinChaud : matBassin);
    m.rotation.x = -Math.PI / 2;
    m.position.set((b.minX + b.maxX) / 2, DY + 0.06, (b.minZ + b.maxZ) / 2);
    G.prof.add(m);
    const lum = chaud ? M.lumO : M.lumC;
    BE(lum, b.minX, b.maxX, DY + 0.02, DY + 0.07, b.minZ - 0.12, b.minZ);
    BE(lum, b.minX, b.maxX, DY + 0.02, DY + 0.07, b.maxZ, b.maxZ + 0.12);
    BE(lum, b.minX - 0.12, b.minX, DY + 0.02, DY + 0.07, b.minZ, b.maxZ);
    BE(lum, b.maxX, b.maxX + 0.12, DY + 0.02, DY + 0.07, b.minZ, b.maxZ);
  });

  // bouches d'extraction : grilles orange au sol + panache de chaleur (plans croisés à bruit animé)
  const plumes = [];
  for (const b of PROFONDEURS.bouches) {
    const [x, , z] = b.position;
    for (let i = -2; i <= 2; i++) BE(M.lumO, x - 1.4, x + 1.4, DY + 0.02, DY + 0.05, z + i * 0.35 - 0.1, z + i * 0.35 + 0.1);
    BE(M.sombre, x - 1.6, x + 1.6, DY, DY + 0.03, z - 1.0, z + 1.0);
    for (const ry of [0, Math.PI / 2]) {
      const g = new THREE.PlaneGeometry(b.rayon * 1.3, 9);
      g.rotateY(ry);
      g.translate(x, DY + 4.5, z);
      plumes.push(g);
    }
  }
  const matPlume = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uT: { value: 0 } }]),
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vW; varying float vD;
      void main() { vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; vec4 mv = viewMatrix * wp; vD = length(mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `
      uniform float uT; uniform vec3 fogColor; uniform float fogDensity;
      varying vec2 vUv; varying vec3 vW; varying float vD;
      void main() {
        float x = abs(vUv.x - 0.5) * 2.0;
        float n = sin(vW.y * 1.9 - uT * 2.4 + vW.x * 0.7) * sin(vW.y * 0.8 + uT * 1.3 + vW.z * 0.9);
        float a = (1.0 - x) * (1.0 - x) * (0.5 + 0.5 * n) * pow(1.0 - vUv.y, 0.8) * 0.5;
        float f = exp(-pow(fogDensity * vD, 2.0));
        gl_FragColor = vec4(vec3(1.0, 0.45, 0.12) * 1.3, a * f);
      }`,
  });
  matPlume.uniforms.uT = TEMPS;
  const plumeMesh = new THREE.Mesh(mergeGeometries(plumes), matPlume);
  plumeMesh.renderOrder = 4;
  G.prof.add(plumeMesh);

  // ventilateurs géants (pales qui tournent), encastrés dans les parois des connexions
  const matRotor = new THREE.MeshStandardMaterial({ color: 0x4a2a1c, roughness: 0.5, metalness: 0.7, emissive: 0x3a1004, emissiveIntensity: 0.6 });
  const matCarter = new THREE.MeshStandardMaterial({ color: 0x2a1a18, roughness: 0.6, metalness: 0.6 });
  const ventilateurs = PROFONDEURS.ventilateurs.map((def, i) => {
    const f = creerVentilateur(def.rayon, matRotor, matCarter, M.lumO);
    f.pivot.position.set(...def.position);
    f.pivot.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...def.axe).normalize());
    G.prof.add(f.pivot);
    f.vitesse = [2.2, -1.7, 1.2][i];
    // niche sombre derrière chaque ventilateur
    const [dx, dy, dz] = def.axe;
    BE(M.sombre, dx > 0 ? def.position[0] - 0.9 : def.position[0], dx > 0 ? def.position[0] : def.position[0] + 0.9, def.position[1] - def.rayon * 1.1, def.position[1] + def.rayon * 1.1, def.position[2] - def.rayon * 1.1, def.position[2] + def.rayon * 1.1);
    void dy; void dz;
    return f;
  });
  // les ventilateurs sont dans les masses (x = 408 et x = 236..240) : le carter n'est pas un obstacle plein ;
  // on laisse les parois comme collider (le ventilateur « souffle » depuis le mur).

  // mi-parcours : la plaque du point de relevé, sur la paroi sud de l'allée C (la borne vient du système)
  plaque(texturePlaque(PLAQUES.miParcours.fr, PLAQUES.miParcours.jp, PLAQUES.miParcours.petit, { largeur: 1024, hauteur: 256, couleur: '#ff9a50', fond: '#150a06' }), 316, DY + 5, -155.12, Math.PI, 5.2, 1.3);
  BE(M.lumO, 313.2, 313.4, DY, DY + 3.6, -155.2, -155.05); BE(M.lumO, 318.6, 318.8, DY, DY + 3.6, -155.2, -155.05);

  // câbles de baie des Profondeurs (suspendus au plafond)
  for (const c of PROFONDEURS.cables.filter((cc) => cc.position[0] > 200)) {
    const [x, y, z] = c.position;
    CYL(M.sombre, x, y - 1.6, DY + PH - 1, z, 0.16, 6);
    CYL(M.lumO, x, y - 1.6, y + 2.5, z, 0.1, 6);
  }

  // =====================================================================================================
  // 5. SALLE DE L'INTERRUPTEUR
  // =====================================================================================================
  dans('salle');
  const SX0 = 380, SX1 = 424, SZ0 = -300, SZ1 = -340, SH = 26; // plafond à y = +14
  BE(M.sombre, SX0, SX1, DY - 1, DY, SZ1, SZ0);
  col(SX0 - 1, SX1 + 1, SZ1 - 1, SZ0 + 1, DY - 2, DY);
  const solSalle = solSombre({ teinte: new THREE.Color(0x7f9cff), base: [0.01, 0.012, 0.03], plafond: DY + SH, espX: 12, espZ: 24, largeur: 0.9, dalle: 3, force: 0.8 });
  { const m = new THREE.Mesh(new THREE.PlaneGeometry(SX1 - SX0, SZ0 - SZ1), solSalle); m.rotation.x = -Math.PI / 2; m.position.set((SX0 + SX1) / 2, DY + 0.005, (SZ0 + SZ1) / 2); G.salle.add(m); }
  BE(M.beton, SX0, SX1, DY + SH, DY + SH + 0.5, SZ1, SZ0);
  col(SX0, SX1, SZ1, SZ0, DY + SH - 0.2, DY + SH + 0.5);
  for (let x = 386; x < SX1; x += 12) BE(M.lumW, x - 0.12, x + 0.12, DY + SH - 0.05, DY + SH, SZ1 + 1, SZ0 - 1);
  // murs ouest et est ; sud percé de la porte (x ∈ [397, 407]) ; nord = la baie
  const murS = (x0, x1, z0, z1) => { BE(M.beton, x0, x1, DY, DY + SH, z0, z1); col(x0, x1, z0, z1); };
  murS(SX0 - 0.6, SX0, SZ1 - 0.4, SZ0 + 0.6); murS(SX1, SX1 + 0.6, SZ1 - 0.4, SZ0 + 0.6);
  murS(SX0, 397, SZ0, SZ0 + 0.6); murS(407, SX1, SZ0, SZ0 + 0.6);
  for (const x of [397, 407]) BE(M.lumW, x - 0.07, x + 0.07, DY, DY + 6, SZ0 - 0.08, SZ0 + 0.1);
  // la baie vitrée : x ∈ [384, 420], y de −11,4 à 12 ; meneaux tous les 6 m
  const WX0 = 384, WX1 = 420, WY0 = DY + 0.6, WY1 = DY + 24;
  BE(M.beton, SX0, WX0, DY, DY + SH, SZ1 - 0.4, SZ1 + 0.4); BE(M.beton, WX1, SX1, DY, DY + SH, SZ1 - 0.4, SZ1 + 0.4);
  BE(M.beton, WX0, WX1, DY, WY0, SZ1 - 0.4, SZ1 + 0.4); BE(M.beton, WX0, WX1, WY1, DY + SH, SZ1 - 0.4, SZ1 + 0.4);
  col(SX0, SX1, SZ1 - 0.5, SZ1 + 0.3);
  for (let x = WX0 + 3; x < WX1; x += 6) BE(M.metal, x - 0.18, x + 0.18, WY0, WY1, SZ1 - 0.25, SZ1 + 0.25); // meneaux (aucun au centre : on voit Hashira)
  BE(M.lumW, WX0, WX1, WY0, WY0 + 0.1, SZ1 + 0.25, SZ1 + 0.3);
  const vitre = new THREE.Mesh(new THREE.PlaneGeometry(WX1 - WX0, WY1 - WY0), new THREE.MeshBasicMaterial({ color: 0x8aa0ff, transparent: true, opacity: 0.05, depthWrite: false, toneMapped: false, fog: false }));
  vitre.position.set((WX0 + WX1) / 2, (WY0 + WY1) / 2, SZ1 + 0.02);
  vitre.renderOrder = 8;
  G.salle.add(vitre);
  // socle et levier (rien n'y est branché dans cette zone) : à 6 m de la baie, pour qu'on voie la ville de là
  BE(M.beton, 399.4, 404.6, DY, DY + 0.3, -335.6, -330.4);
  col(399.4, 404.6, -335.6, -330.4, DY - 1, DY + 0.3);
  BE(M.metal, 401.1, 402.9, DY + 0.3, DY + 1.1, -333.9, -332.1);
  BE(M.lumC, 401.1, 402.9, DY + 1.1, DY + 1.13, -333.9, -332.1);
  col(401.1, 402.9, -333.9, -332.1);
  BE(M.sombre, 401.5, 402.5, DY + 1.13, DY + 1.5, -333.6, -332.8);
  plaque(texturePlaqueInterrupteur(), 402, DY + 0.72, -332.08, 0, 1.5, 0.75);
  for (const x of [398, 406]) BE(M.lumB, x - 0.04, x + 0.04, DY + 0.3, DY + 0.34, -335.6, -330.4);
  const levier = new THREE.Group();
  levier.position.set(402, DY + 1.5, -333.2);
  {
    const bras = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.1, 8), M.metal);
    bras.position.y = 0.55;
    const bouton = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8), M.lumW);
    bouton.position.y = 1.15;
    levier.add(bras, bouton);
    levier.rotation.x = 0.55; // levier en haut, incliné vers la baie (« non manœuvré »)
    G.salle.add(levier);
  }
  // stèle du fragment 33
  BE(M.beton, 393.7, 394.7, DY, DY + 1.1, -329.9, -328.9);
  BE(M.lumB, 393.7, 394.7, DY + 1.1, DY + 1.14, -329.9, -328.9);
  col(393.7, 394.7, -329.9, -328.9, DY - 1, DY + 1.14);
  // seize écrans éteints sur les murs ouest et est : 4 colonnes × 2 rangées de chaque côté
  const ecransInterr = INTERR_ECRANS.map((d) => {
    const e = ecranTexte({ w: 320, h: 180, largeur: 6.4, hauteur: 3.6, fond: '#03040a', luminosite: 1 });
    e.mesh.position.set(d.x, d.y, d.z);
    e.mesh.rotation.y = d.ry;
    G.salle.add(e.mesh);
    BE(M.lumB, d.x - 0.03, d.x + 0.03, d.y - 1.85, d.y - 1.8, d.z - 3.3, d.z + 3.3);
    return { position: [d.x, d.y, d.z], yaw: d.ry, cote: d.cote, ecran: e };
  });

  // le panorama de la ville : derrière la baie, 400 m en avant et 70 m plus bas
  const panorama = creerPanorama({ echelle: 1.0 });
  panorama.groupe.position.set(402, -70, -740);
  G.salle.add(panorama.groupe);

  // =====================================================================================================
  // Fusion : un maillage par (groupe, matériau)
  // =====================================================================================================
  for (const { mat, g, geos } of lots.values()) {
    const m = new THREE.Mesh(mergeGeometries(geos), mat);
    m.matrixAutoUpdate = false;
    G[g].add(m);
  }

  // Lumières : une hémisphère et une directionnelle, sans ombre (les couleurs changent d'une salle à l'autre)
  const hemi = new THREE.HemisphereLight(0x3f58c8, 0x080c20, 1.2);
  const dir = new THREE.DirectionalLight(0x5f7cff, 0.6);
  dir.position.set(0.3, 1, 0.4);
  scene.add(hemi, dir);

  // =====================================================================================================
  // Interactions de la zone : la sortie. Le reste (personnages, Sept, bornes) : systems/kura.js
  // =====================================================================================================
  const sortie = jeu.zones.porte({
    zone: 'kura', position: ANCRES.sortie.position, rayon: 6.5, cone: 1.3, libelle: INVITES.sortir, vers: 'kasumi', point: 'kura',
  });
  sortie.lignes = LIGNES_OBJETS.sortie;

  // =====================================================================================================
  // Zone
  // =====================================================================================================
  const etatAtmos = {
    salle: null, cible: ATMOS.hall,
    fog: new THREE.Color(ATMOS.hall.fog), d: ATMOS.hall.d, hemi: new THREE.Color(ATMOS.hall.hemi), hemiSol: new THREE.Color(ATMOS.hall.hemiSol),
    hi: ATMOS.hall.hi, dir: new THREE.Color(ATMOS.hall.dir), di: ATMOS.hall.di, ond: 0, ron: 0,
  };
  const tmp = new THREE.Color();
  const camPos = new THREE.Vector3();
  const fm = { ondLocale: 0 };
  let derniereSalle = null;
  let farAvant = null;
  let ronEnvoye = -1;

  const zone = {
    scene,
    colliders,
    bornes: { minX: -126, maxX: 432, minZ: -343, maxZ: 16 },
    apparition: { position: ANCRES.entree.position, yaw: 0, pitch: 0.03 },
    points: { entree: { position: ANCRES.entree.position, yaw: 0, pitch: 0.03 } },
    ambiance: {
      brouillard: { couleur: ATMOS.hall.fog, densite: ATMOS.hall.d },
      fond: 0x080e30,
      exposition: 1.1,
      pluie: false,
      reflet: false,
      bloom: { force: 0.6, rayon: 0.6, seuil: 0.78 },
      son: { pluie: 0, filtre: 1500 },
    },
    // exposés
    groupes: G, ancres: ANCRES, profondeurs: PROFONDEURS, panorama, levier, ecrans: { sept: ecranSept, interrupteur: ecransInterr, refuge: nbEcransRefuge, cartes }, // refuge : nombre d'écrans (un seul maillage)
    ventilateurs, champ, rangFroid, rangChaud, compter,
    /** Position (une fois) des bornes etc. : voir systems/kura.js. */
    salle: () => etatAtmos.salle,
    ondulationLocale: () => fm.ondLocale,
    /** Ondulation ajoutée par systems/profondeurs.js (jauge de chaleur) ; 0 = rien. */
    ondulationExtra: 0,
    /** Nouvelle partie : la ville se rallume, Sept et les écrans de l'Interrupteur reviennent à leur veille, le levier se relève. */
    remettre() {
      panorama.tout(1);
      ecranSept.veille();
      for (const e of ecransInterr) e.ecran.effacer();
      levier.rotation.x = 0.55;
    },
    /** transgressions.js (T4) : fumer n'est déplacé qu'au Refuge (bible §7.3), pas dans tout Kura. */
    lieuDeFumee: () => (etatAtmos.salle === 'refuge' ? 'refuge' : ''),
    entrer(j) {
      farAvant = j.camera.far;
      j.camera.far = 1700;
      j.camera.updateProjectionMatrix();
      derniereSalle = null;
      this.appliquerSalle(j, salleDe(j.player.position.x, j.player.position.y, j.player.position.z), true);
    },
    sortir(j) {
      if (farAvant) { j.camera.far = farAvant; j.camera.updateProjectionMatrix(); }
      if (j.film) j.film.uniforms.ondulation.value = 0;
      j.audio?.ronflement?.(0, 0.6);
      ronEnvoye = -1;
    },
    appliquerSalle(j, salle, instant = false) {
      if (salle === derniereSalle) return;
      const premiere = derniereSalle === null;
      derniereSalle = salle;
      etatAtmos.salle = salle;
      etatAtmos.cible = ATMOS[salle];
      j.audio?.regler({ filtre: ATMOS[salle].filtre, duree: 1.6 });
      for (const [g, quand] of Object.entries(VISIBLES)) G[g === 'hall' ? 'hall' : g].visible = quand.includes(salle);
      G.salle.visible = salle === 'interrupteur' || (salle === 'profondeurs' && j.player.position.z < -200);
      if (!premiere && j.hud && SALLES[salle] && salle !== 'hall' && salle !== 'couloir' && salle !== 'sas' && salle !== 'descente') j.hud.titre(SALLES[salle].titre, SALLES[salle].sous);
      if (instant) this.lisser(j, 10);
      j.emettre?.('kura:salle', { salle });
    },
    lisser(j, dt) {
      const a = etatAtmos.cible;
      const k = Math.min(1, dt * 1.4);
      etatAtmos.fog.lerp(tmp.set(a.fog), k);
      etatAtmos.d += (a.d - etatAtmos.d) * k;
      etatAtmos.hemi.lerp(tmp.set(a.hemi), k);
      etatAtmos.hemiSol.lerp(tmp.set(a.hemiSol), k);
      etatAtmos.hi += (a.hi - etatAtmos.hi) * k;
      etatAtmos.dir.lerp(tmp.set(a.dir), k);
      etatAtmos.di += (a.di - etatAtmos.di) * k;
      const f = scene.fog;
      if (f) { f.color.copy(etatAtmos.fog); f.density = etatAtmos.d; }
      scene.background = scene.background || new THREE.Color();
      scene.background.copy(etatAtmos.fog).multiplyScalar(0.7);
      hemi.color.copy(etatAtmos.hemi); hemi.groundColor.copy(etatAtmos.hemiSol); hemi.intensity = etatAtmos.hi;
      dir.color.copy(etatAtmos.dir); dir.intensity = etatAtmos.di;
      etatAtmos.ron += (a.ron - etatAtmos.ron) * Math.min(1, dt * 0.8);
    },
    update(dt, t, j) {
      TEMPS.value = t;
      const p = j.player.position;
      const salle = salleDe(p.x, p.y, p.z);
      if (salle !== derniereSalle) this.appliquerSalle(j, salle);
      if (salle === 'profondeurs') G.salle.visible = p.z < -200;
      this.lisser(j, dt);
      camPos.copy(j.camera.position);
      if (G.hall.visible) champ.maj(camPos);
      if (G.prof.visible) { rangFroid.maj(camPos); rangChaud.maj(camPos); }
      // ventilateurs
      if (G.prof.visible) for (const f of ventilateurs) f.rotor.rotation.z += f.vitesse * dt;
      matPlume.uniforms.uT.value = t;
      // cartes d'activations (8 Hz, seulement à la Bibliothèque)
      if (salle === 'bibliotheque' && G.biblio.visible) {
        if (!this._carteT || t - this._carteT > 0.125) { this._carteT = t; for (const c of cartes) c.dessiner(t); }
      }
      // panorama
      if (G.salle.visible) panorama.update(t);
      // chaleur de l'air : au-dessus des bouches et dans les allées chaudes, l'image ondule
      let chaleur = 0;
      if (salle === 'profondeurs') {
        for (const b of PROFONDEURS.bouches) {
          const d = Math.hypot(p.x - b.position[0], p.z - b.position[2]);
          chaleur = Math.max(chaleur, 1 - Math.min(1, d / (b.rayon * 5)));
        }
        for (const a of PROFONDEURS.allees) if (a.type === 'chaude' && p.x > a.minX - 2 && p.x < a.maxX + 2 && p.z > a.minZ - 1 && p.z < a.maxZ + 1) chaleur = Math.max(chaleur, 0.8);
      }
      fm.ondLocale = chaleur;
      if (j.film) {
        const base = etatAtmos.cible.ond;
        const cible = Math.min(1.9, base + chaleur * 0.9 + this.ondulationExtra);
        const u = j.film.uniforms.ondulation;
        u.value += (cible - u.value) * Math.min(1, dt * 3);
      }
      if (Math.abs(etatAtmos.ron - ronEnvoye) > 0.002) { ronEnvoye = etatAtmos.ron; j.audio?.ronflement?.(ronEnvoye, 0.4); }
    },
  };
  return zone;
}

export { QUARTIERS };
