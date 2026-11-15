import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { jeu } from '../game.js';
import { BLOCKS, PITCH } from '../city.js';
import { calque } from './calque.js';
import { marche } from './marche.js';
import * as D from '../data/npc.js';
import * as C from '../data/calque.js';

// Système « npc » : les habitants de Kasumi (bible §2.4, §2.5, §3.2 « silhouettes »).
//
// Foule : 200 silhouettes sombres sans visage (trois gabarits : long manteau, veste, poncho à
// capuche), chacune surmontée de son halo. Un InstancedMesh par gabarit + un pour les halos
// (4 appels de dessin, quel que soit le nombre d'habitants affichés). Les pieds et les bras
// balancent dans le vertex shader (attribut aRig), le reste du balancement est dans la matrice.
//
// Trajets : un graphe de 324 coins de trottoir (4 par pâté). Arêtes = côtés des pâtés (trottoir)
// et traversées de rue entre pâtés voisins. Chaque habitant marche d'un coin à l'autre, du côté
// droit de la voie (les croisements se font sans se traverser), et choisit au hasard la suite.
// Les habitants lointains sont ramenés près du joueur (réaffectation hors de sa vue) : la
// densité autour de lui reste constante où qu'il aille.
//
// Marché des Mains : les habitants y marchent dans les allées de `marche.allees` (deux allées est-ouest
// et leurs passages), plus nombreux quand le joueur est près du marché (part de 60 % des habitants
// placés), certains s'arrêtent face aux étals ; les côtés de pâté que les étals couvrent sont interdits
// (arêtes `bloque`) et les étals (colliders hauts de marche.colliders) repoussent les habitants poussés.
//
// API pour les autres systèmes :
//   import { npc } from './npc.js'   (ou jeu.npc)
//   const p = npc.ajouterPersonnage({ id, nom, position: [x, y, z], zone: 'kasumi',
//     apparence?: { couleurHalo, taille, accessoire?, variante?, penche?, vacille? }, lignes?, libelle,
//     dialogue: (p) => Promise | objet dialogue, apres?: (p, dialogue) => Promise | void,
//     regardeLeJoueur?: true, yaw?, rayon?, hauteurEtiquette? });
//   p.retirer();  p.position (Vector3, modifiable) ;  p.visible (lecture/écriture)
//   accessoire : 'chapeau' | 'sac' | 'canne' | 'echarpe' | 'capuche' | 'micro' | 'loupe' (ou une liste)
//   variante : 0 long manteau, 1 veste, 2 poncho à capuche, 3 assis sur un tabouret (le dessus du tabouret à 0,56 m)
//   yaw : orientation du corps (0 = regarde +z) ; position[1] : le sol sous les pieds.
//   Interaction : `dialogue` est évalué à l'appui sur E (avant que la rencontre soit comptée) ; à la FIN du
//   dialogue, etat.rencontres[id] est incrémenté, puis `apres(p, dialogue)` est attendu. `lignes` : texte du
//   Calque (porté par l'objet interactif, une seule étiquette) ; `hauteurEtiquette` : m au-dessus des pieds.

// ---------------------------------------------------------------- réglages
const NB = 200; // habitants dans la ville
const RAYON_AFFICHAGE = 115; // m
const RAYON_REAFFECTATION = 125; // au-delà : l'habitant est replacé près du joueur
const VOIE = 20.5; // distance du centre d'un pâté à l'axe du trottoir
const BORD = 19.15; // en deçà : la façade (lot de 38 m)
const HAUT_TROTTOIR = 0.3;
const FOULEE = 1.55; // m par cycle de marche
const PAS = 4; // taille des cellules de la grille de voisinage
const TAILLE_HALO = 1.9;
const ANCIEN = 0.12; // part des « anciens », qui se souviennent
const RAYON_FUMEE = 17;

// ---------------------------------------------------------------- utilitaires
const aleatoire = (seed) => {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const rnd = aleatoire(20776); // tirage de la simulation : reproductible
const graine = (...p) => {
  let h = 2166136261;
  for (const c of p.join('|')) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
};
const choisir = (r, l) => l[Math.floor(r() * l.length)];
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lisse = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const TAU = Math.PI * 2;
const angle = (d) => { d %= TAU; return d > Math.PI ? d - TAU : d < -Math.PI ? d + TAU : d; };
const remplir = (g, ch) => g.replace(/\{(\w+)\}/g, (_, k) => ch[k] ?? '');
const centreBloc = (i) => (i - (BLOCKS - 1) / 2) * PITCH;
const indiceBloc = (v) => clamp(Math.round(v / PITCH + (BLOCKS - 1) / 2), 0, BLOCKS - 1);

// ---------------------------------------------------------------- graphe des trottoirs
// coin c d'un pâté : 0 (-,-)  1 (+,-)  2 (+,+)  3 (-,+) ; id = (i * BLOCKS + j) * 4 + c
const SX = [-1, 1, 1, -1];
const SZ = [-1, -1, 1, 1];
const NOEUDS = BLOCKS * BLOCKS * 4; // les nœuds de trottoir ; ceux du Marché des Mains viennent après (id >= NOEUDS)
const nx = new Array(NOEUDS).fill(0);
const nz = new Array(NOEUDS).fill(0);
const VOISINS = [];
// Le Marché des Mains (systems/marche.js) occupe la rue z = 30 de x = 45 à 139 : ses étals couvrent les
// trottoirs. Les habitants y suivent `marche.allees` (deux allées est-ouest et leurs passages), jamais les
// trottoirs que les étals occupent : ces arêtes-là sont marquées `bloque` dans le graphe des trottoirs.
const ZONE_MARCHE = { minX: 43, maxX: 141.5, minZ: 18.5, maxZ: 41.5 };
const NOEUDS_MARCHE = []; // ids des nœuds des allées
const idNoeud = (i, j, c) => (i * BLOCKS + j) * 4 + c;
(function construireGraphe() {
  for (let i = 0; i < BLOCKS; i++)
    for (let j = 0; j < BLOCKS; j++)
      for (let c = 0; c < 4; c++) {
        const id = idNoeud(i, j, c);
        nx[id] = centreBloc(i) + SX[c] * VOIE;
        nz[id] = centreBloc(j) + SZ[c] * VOIE;
      }
  for (let i = 0; i < BLOCKS; i++)
    for (let j = 0; j < BLOCKS; j++)
      for (let c = 0; c < 4; c++) {
        const id = idNoeud(i, j, c);
        const v = [];
        v.push({ id: idNoeud(i, j, (c + 1) % 4), ring: true });
        v.push({ id: idNoeud(i, j, (c + 3) % 4), ring: true });
        // traversée de la rue en x (voisin à l'est ou à l'ouest), puis en z
        const di = SX[c], dj = SZ[c];
        if (i + di >= 0 && i + di < BLOCKS) v.push({ id: idNoeud(i + di, j, miroirX(c)), ring: false });
        if (j + dj >= 0 && j + dj < BLOCKS) v.push({ id: idNoeud(i, j + dj, miroirZ(c)), ring: false });
        VOISINS[id] = v;
      }
  // longueurs et directions
  for (let id = 0; id < NOEUDS; id++)
    for (const o of VOISINS[id]) {
      const dx = nx[o.id] - nx[id], dz = nz[o.id] - nz[id];
      o.len = Math.hypot(dx, dz);
      o.dx = dx / o.len;
      o.dz = dz / o.len;
      // une arête de trottoir qui traverse le marché : les étals y sont, on n'y marche pas
      const x0 = Math.min(nx[id], nx[o.id]), x1 = Math.max(nx[id], nx[o.id]);
      const z0 = Math.min(nz[id], nz[o.id]), z1 = Math.max(nz[id], nz[o.id]);
      o.bloque = x1 > ZONE_MARCHE.minX && x0 < ZONE_MARCHE.maxX && z1 > ZONE_MARCHE.minZ && z0 < ZONE_MARCHE.maxZ;
    }
})();

// Graphe des allées du marché : segments (axe x ou z) de `marche.allees`, coupés à leurs croisements.
function construireAllees() {
  if (NOEUDS_MARCHE.length) return;
  const segs = (marche.allees || []).map(([a, b]) => ({ x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z) }));
  const noeud = (x, z) => {
    for (const id of NOEUDS_MARCHE) if (Math.abs(nx[id] - x) < 0.05 && Math.abs(nz[id] - z) < 0.05) return id;
    const id = nx.length;
    nx.push(x);
    nz.push(z);
    VOISINS[id] = [];
    NOEUDS_MARCHE.push(id);
    return id;
  };
  const lier = (a, b, ring) => {
    if (a === b || VOISINS[a].some((o) => o.id === b)) return;
    const dx = nx[b] - nx[a], dz = nz[b] - nz[a], len = Math.hypot(dx, dz);
    VOISINS[a].push({ id: b, ring, len, dx: dx / len, dz: dz / len, bloque: false, allee: true });
    VOISINS[b].push({ id: a, ring, len, dx: -dx / len, dz: -dz / len, bloque: false, allee: true });
  };
  segs.forEach((s, i) => {
    const horiz = s.z1 - s.z0 < 1e-6;
    const coupes = new Set([horiz ? s.x0 : s.z0, horiz ? s.x1 : s.z1]);
    segs.forEach((o, j) => {
      if (i === j) return;
      if (horiz) { if (o.x0 === o.x1 && o.x0 >= s.x0 && o.x0 <= s.x1 && s.z0 >= o.z0 && s.z0 <= o.z1) coupes.add(o.x0); }
      else if (o.z0 === o.z1 && o.z0 >= s.z0 && o.z0 <= s.z1 && s.x0 >= o.x0 && s.x0 <= o.x1) coupes.add(o.z0);
    });
    const t = [...coupes].sort((a, b) => a - b);
    for (let k = 1; k < t.length; k++) {
      const a = noeud(horiz ? t[k - 1] : s.x0, horiz ? s.z0 : t[k - 1]);
      const b = noeud(horiz ? t[k] : s.x0, horiz ? s.z0 : t[k]);
      lier(a, b, horiz); // les allées est-ouest sont des « côtés » (poids fort), les passages des traversées
    }
  });
}
function miroirX(c) { return [1, 0, 3, 2][c]; }
function miroirZ(c) { return [3, 2, 1, 0][c]; }

// ---------------------------------------------------------------- géométrie des silhouettes
const _cyl = (a, b, h, s = 10) => new THREE.CylinderGeometry(a, b, h, s, 1);
const _sph = (r, w = 10, h = 7) => new THREE.SphereGeometry(r, w, h);

function partie(geo, { x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0, rig = [0, 0] } = {}) {
  const g = geo.clone();
  g.deleteAttribute('uv');
  g.scale(sx, sy, sz);
  if (rx) g.rotateX(rx);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  g.computeVertexNormals();
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { a[i * 2] = rig[0]; a[i * 2 + 1] = rig[1]; }
  g.setAttribute('aRig', new THREE.BufferAttribute(a, 2));
  return g;
}

// accessoires des personnages nommés
function accessoire(nom) {
  const p = [];
  if (Array.isArray(nom)) return nom.flatMap((n) => accessoire(n));
  if (nom === 'micro') {
    // micro tenu devant le visage, bras plié (Itsuki)
    p.push(partie(_cyl(0.014, 0.014, 0.2, 6), { x: 0.13, y: 1.4, z: 0.2, rx: -0.5 }));
    p.push(partie(_sph(0.032, 8, 6), { x: 0.13, y: 1.5, z: 0.255 }));
  } else if (nom === 'loupe') {
    // lampe-loupe sur un serre-tête (Kaede) : le verre est relevé sur le front
    p.push(partie(_cyl(0.118, 0.118, 0.03, 12), { y: 1.74 }));
    p.push(partie(_cyl(0.062, 0.062, 0.035, 12), { x: 0.06, y: 1.75, z: 0.1, rx: Math.PI / 2 - 0.5 }));
  } else if (nom === 'chapeau') {
    p.push(partie(_cyl(0.3, 0.3, 0.025, 14), { y: 1.74 }));
    p.push(partie(_cyl(0.13, 0.15, 0.16, 12), { y: 1.82 }));
  } else if (nom === 'sac') {
    p.push(partie(new THREE.BoxGeometry(0.3, 0.38, 0.16), { y: 1.12, z: -0.2 }));
  } else if (nom === 'canne') {
    p.push(partie(_cyl(0.016, 0.016, 1.05, 6), { x: 0.34, y: 0.52, z: 0.12, rx: -0.1 }));
    p.push(partie(new THREE.BoxGeometry(0.07, 0.03, 0.13), { x: 0.34, y: 1.06, z: 0.09 }));
  } else if (nom === 'echarpe') {
    p.push(partie(_cyl(0.135, 0.15, 0.1, 12), { y: 1.5 }));
    p.push(partie(new THREE.BoxGeometry(0.1, 0.42, 0.04), { x: 0.07, y: 1.28, z: 0.17 }));
  } else if (nom === 'capuche') {
    p.push(partie(new THREE.ConeGeometry(0.17, 0.34, 8), { y: 1.84 }));
  }
  return p;
}

// variante 3 : assis, voûté, dans un manteau trop grand (Oba). Les pieds touchent le sol, le haut de
// l'assise est à 0,56 m : la silhouette est posée sur un tabouret dont le dessus est à cette hauteur.
function corpsAssis(acc = null) {
  const p = [];
  for (const s of [-1, 1]) {
    p.push(partie(_cyl(0.075, 0.07, 0.46, 8), { x: s * 0.1, y: 0.62, z: 0.2, rx: Math.PI / 2 })); // cuisses
    p.push(partie(_cyl(0.06, 0.045, 0.52, 8), { x: s * 0.1, y: 0.28, z: 0.43 })); // jambes
    p.push(partie(new THREE.BoxGeometry(0.1, 0.05, 0.24), { x: s * 0.1, y: 0.03, z: 0.5 })); // pieds
    p.push(partie(_cyl(0.045, 0.04, 0.5, 7), { x: s * 0.23, y: 1.02, z: 0.16, rx: 0.5, rz: -s * 0.12 })); // bras
  }
  p.push(partie(_cyl(0.2, 0.36, 0.86), { y: 0.95, z: 0.03, sz: 0.74, rx: 0.2 })); // manteau, buste voûté
  p.push(partie(_cyl(0.3, 0.34, 0.2, 12), { y: 0.55, z: 0.17, sz: 1.0 })); // pans sur les genoux
  p.push(partie(_sph(0.2, 10, 8), { y: 1.36, z: 0.1, sx: 1.2, sy: 0.7, sz: 0.8 })); // épaules rondes
  p.push(partie(_cyl(0.11, 0.15, 0.1, 10), { y: 1.42, z: 0.15, sz: 0.85 })); // col relevé
  p.push(partie(_sph(0.107, 10, 8), { y: 1.5, z: 0.21, sx: 0.95, sy: 1.12 })); // tête penchée en avant
  if (acc) p.push(...accessoire(acc));
  return mergeGeometries(p);
}

// variante 0 : long manteau ; 1 : veste, jambes et bras ; 2 : poncho à capuche ; 3 : assis (voir plus haut)
function corps(variante, acc = null) {
  if (variante === 3) return corpsAssis(acc);
  const p = [];
  const tete = (y) => {
    p.push(partie(_sph(0.112, 10, 8), { y, sx: 0.95, sy: 1.12 }));
  };
  if (variante === 0) {
    p.push(partie(_cyl(0.17, 0.3, 1.12), { y: 0.92, sz: 0.7, rig: [0.1, 1.45] }));
    p.push(partie(_sph(0.18, 10, 8), { y: 1.41, sx: 1.12, sy: 0.7, sz: 0.78 }));
    p.push(partie(_cyl(0.045, 0.045, 0.14, 6), { y: 1.53 }));
    p.push(partie(_cyl(0.11, 0.17, 0.12, 10), { y: 1.5, sz: 0.8 }));
    for (const s of [-1, 1]) p.push(partie(_cyl(0.05, 0.045, 0.4, 7), { x: s * 0.075, y: 0.19, rig: [s * 1, 0.4] }));
    tete(1.65);
  } else if (variante === 1) {
    for (const s of [-1, 1]) p.push(partie(_cyl(0.075, 0.055, 0.86, 8), { x: s * 0.095, y: 0.43, rig: [s * 1, 0.86] }));
    p.push(partie(_cyl(0.18, 0.2, 0.66), { y: 1.15, sz: 0.72 }));
    p.push(partie(_sph(0.2, 10, 8), { y: 1.42, sx: 1.2, sy: 0.62, sz: 0.76 }));
    for (const s of [-1, 1]) p.push(partie(_cyl(0.04, 0.032, 0.58, 7), { x: s * 0.245, y: 1.12, rz: s * 0.05, rig: [-s * 0.85, 1.4] }));
    p.push(partie(_cyl(0.045, 0.045, 0.14, 6), { y: 1.53 }));
    p.push(partie(_cyl(0.095, 0.13, 0.08, 10), { y: 1.51, sz: 0.85 }));
    tete(1.65);
  } else {
    p.push(partie(_cyl(0.1, 0.4, 1.3), { y: 0.86, sz: 0.85, rig: [0.07, 1.55] }));
    for (const s of [-1, 1]) p.push(partie(_cyl(0.05, 0.045, 0.3, 7), { x: s * 0.08, y: 0.15, rig: [s * 1, 0.3] }));
    p.push(partie(_sph(0.155, 10, 8), { y: 1.64, sx: 1.0, sy: 1.2, sz: 1.15 }));
    p.push(partie(new THREE.ConeGeometry(0.135, 0.34, 8), { y: 1.86, z: -0.02 }));
  }
  if (acc) p.push(...accessoire(acc));
  return mergeGeometries(p);
}
const HAUT_HALO = [1.66, 1.66, 1.78, 1.5]; // hauteur du centre du halo (m, avant échelle)

// ---------------------------------------------------------------- matériaux
function materiauCorps() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.65, metalness: 0.05 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aHalo; attribute vec4 aAnim; attribute vec2 aRig;
        varying vec4 vHalo; varying float vY;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vY = position.y; vHalo = aHalo;
        if (abs(aRig.x) > 0.001) {
          float a = sin(aAnim.x) * aAnim.y * aRig.x;
          float c = cos(a), s = sin(a), dy = transformed.y - aRig.y;
          transformed.y = aRig.y + dy * c - transformed.z * s;
          transformed.z = transformed.z * c + dy * s;
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec4 vHalo; varying float vY;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb = mix(vec3(0.012, 0.008, 0.03), vec3(0.055, 0.035, 0.11), vHalo.w);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float nv = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
          float rim = pow(1.0 - nv, 2.4);
          float haut = smoothstep(1.0, 1.78, vY);
          totalEmissiveRadiance += vHalo.rgb * (rim * (0.2 + 0.8 * haut) + haut * 0.07);
        }`);
  };
  return m;
}

const haloUniforms = { uTime: { value: 0 }, uFog: { value: 0.0075 } };
function materiauHalo() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    uniforms: haloUniforms,
    vertexShader: /* glsl */ `
      uniform float uFog;
      varying vec2 vUv; varying vec3 vCol; varying float vFog; varying float vPh;
      void main() {
        mat4 m = modelMatrix * instanceMatrix;
        vec3 c = m[3].xyz;
        float s = length(m[0].xyz);
        float dd0 = length((viewMatrix * vec4(c, 1.0)).xyz);
        s *= 1.0 + 0.9 * smoothstep(12.0, 90.0, dd0); // les halos lointains restent lisibles
        vec4 mv = viewMatrix * vec4(c, 1.0);
        float d = -mv.z;
        mv.z -= 0.3; // le halo reste derrière la tête
        mv.xy += position.xy * s;
        gl_Position = projectionMatrix * mv;
        vUv = uv;
        vCol = instanceColor;
        vFog = 0.3 + 0.7 * exp(-pow(uFog * d, 2.0));
        vPh = c.x * 0.37 + c.z * 0.53;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv; varying vec3 vCol; varying float vFog; varying float vPh;
      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        vec2 q = p - vec2(0.0, -0.06);
        float aura = exp(-dot(q * vec2(0.85, 1.0), q * vec2(0.85, 1.0)) * 6.5);
        float coeur = exp(-dot(q, q) * 26.0);
        vec2 r = p - vec2(0.0, 0.36);
        float anneau = smoothstep(0.085, 0.0, abs(length(vec2(r.x, r.y * 2.4)) - 0.21));
        float pouls = 0.92 + 0.08 * sin(uTime * 1.4 + vPh);
        vec3 col = vCol * (aura * 0.42 + coeur * 0.26 + anneau * 1.25) * pouls * vFog;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

let RES = null; // ressources partagées (créées au premier besoin)
function ressources() {
  if (RES) return RES;
  const plan = new THREE.PlaneGeometry(1, 1);
  RES = { matCorps: materiauCorps(), matHalo: materiauHalo(), plan, geos: [0, 1, 2].map((v) => corps(v)) };
  return RES;
}

// InstancedMesh de corps : géométrie + attributs d'instance (aHalo rgb + teinte, aAnim phase/amplitude)
function maillageCorps(geo, capacite) {
  const g = geo.clone();
  const aHalo = new THREE.InstancedBufferAttribute(new Float32Array(capacite * 4), 4, false, 1);
  const aAnim = new THREE.InstancedBufferAttribute(new Float32Array(capacite * 4), 4, false, 1);
  aHalo.setUsage(THREE.DynamicDrawUsage);
  aAnim.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aHalo', aHalo);
  g.setAttribute('aAnim', aAnim);
  const m = new THREE.InstancedMesh(g, ressources().matCorps, capacite);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.frustumCulled = false;
  m.count = 0;
  m.userData = { aHalo, aAnim };
  return m;
}
function maillageHalo(capacite) {
  const m = new THREE.InstancedMesh(ressources().plan, ressources().matHalo, capacite);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.setColorAt(0, new THREE.Color(0));
  m.instanceColor.setUsage(THREE.DynamicDrawUsage);
  m.frustumCulled = false;
  m.renderOrder = 5;
  m.count = 0;
  return m;
}

// ---------------------------------------------------------------- habitants
const MARCHE = 0, PAUSE = 1, GROUPE = 2, REGARD = 3, APPROCHE = 4;
const habitants = [];
const grille = new Map();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _c2 = new THREE.Color();

function tirerHumeur(r) {
  let x = r();
  for (const h of D.HUMEURS) { x -= h.poids; if (x <= 0) return h; }
  return D.HUMEURS[0];
}

function creerHabitant(id) {
  const r = aleatoire(graine('npc', id));
  const humeur = tirerHumeur(r);
  const col = new THREE.Color(humeur.couleur);
  const hsl = {};
  col.getHSL(hsl);
  col.setHSL(hsl.h + (r() - 0.5) * 0.03, clamp(hsl.s * (0.9 + r() * 0.1), 0, 1), clamp(hsl.l * (0.9 + r() * 0.2), 0, 0.9));
  const type = r();
  const rapide = type > 0.88, flaneur = type < 0.3;
  const n = {
    id, r,
    x: 0, z: 0, y: 0, h: 0, ry: 0, speed: 0, phase: r() * TAU,
    vmax: rapide ? 1.55 + r() * 0.35 : flaneur ? 0.65 + r() * 0.3 : 1.05 + r() * 0.3,
    variante: Math.floor(r() * 3), taille: 0.93 + r() * 0.15, ton: r(),
    halo: col, humeur, intensite: 0.85 + r() * 0.35,
    de: 0, vers: 0, voie: 0.3 + r() * 0.6,
    etat: MARCHE, tEtat: 0, prochainePause: 6 + r() * 40, faceYaw: 0, partenaire: null,
    vis: 0, look: 0, px: 0, pz: 0, d: 1e9,
    bavard: r() < 0.32, derniereBribe: -999,
    ancien: r() < ANCIEN, curiosite: 0.55 + r() * 0.6, approche: false, delai: r() * 1.8,
    haloBoost: 1, dip: 0, lignes: null, etiquette: null, tireLOS: 0, vuJoueur: false,
  };
  n.approche = n.ancien ? r() < 0.75 : r() < 0.08;
  return n;
}
// Pas d'« Itsuki Mori » tiré au hasard : ce nom appartient à un personnage nommé.
const PRENOMS = C.PRENOMS.filter((x) => x !== 'Itsuki');
const NOMS = C.NOMS.filter((x) => x !== 'Mori');
function lignesDe(n) {
  if (n.lignes) return n.lignes;
  const r = aleatoire(graine('ligne', n.id));
  const champs = {
    prenom: choisir(r, PRENOMS), nom: choisir(r, NOMS),
    occupation: choisir(r, D.OCCUPATIONS), horaire: choisir(r, C.HORAIRES),
    humeur: n.humeur.libelle,
    pensee: r() < D.LIGNE_HABITANT.partPenseeClose ? D.LIGNE_HABITANT.penseeClose : D.LIGNE_HABITANT.penseeOuverte,
  };
  n.lignes = [remplir(D.LIGNE_HABITANT.titre, champs), ...D.LIGNE_HABITANT.lignes.map((l) => remplir(l, champs))];
  return n.lignes;
}

// ---- Placement
const joueur = { x: 30, z: 30, fx: 0, fz: -1 };
const hauteurSol = (x, z) => {
  const bx = centreBloc(indiceBloc(x)), bz = centreBloc(indiceBloc(z));
  return Math.abs(x - bx) <= 22 && Math.abs(z - bz) <= 22 ? HAUT_TROTTOIR : 0;
};
const degage = (ax, az, bx, bz) => {
  const d = Math.hypot(bx - ax, bz - az);
  const pas = Math.max(1, Math.ceil(d / 1.2));
  for (let k = 1; k < pas; k++) {
    const x = ax + ((bx - ax) * k) / pas, z = az + ((bz - az) * k) / pas;
    if (Math.abs(x - centreBloc(indiceBloc(x))) < 19.4 && Math.abs(z - centreBloc(indiceBloc(z))) < 19.4) return false;
  }
  return true;
};

// Les étals (colliders du marché au-dessus de 0,5 m) : un habitant poussé par la foule n'y entre pas.
let ETALS = [];
function chasserDesEtals(n) {
  const Z = ZONE_MARCHE;
  if (n.x < Z.minX || n.x > Z.maxX || n.z < Z.minZ || n.z > Z.maxZ) return;
  const m = 0.3;
  for (const c of ETALS) {
    if (n.x > c.minX - m && n.x < c.maxX + m && n.z > c.minZ - m && n.z < c.maxZ + m) {
      const g = n.x - (c.minX - m), d = c.maxX + m - n.x, h = n.z - (c.minZ - m), b = c.maxZ + m - n.z;
      const mn = Math.min(g, d, h, b);
      if (mn === g) n.x = c.minX - m;
      else if (mn === d) n.x = c.maxX + m;
      else if (mn === h) n.z = c.minZ - m;
      else n.z = c.maxZ + m;
    }
  }
}

function viseArete(n, a, b, t) {
  n.de = a;
  n.vers = b;
  const dx = nx[b] - nx[a], dz = nz[b] - nz[a], L = Math.hypot(dx, dz);
  const ux = dx / L, uz = dz / L;
  n.x = nx[a] + dx * t - uz * n.voie;
  n.z = nz[a] + dz * t + ux * n.voie;
  n.h = Math.atan2(ux, uz);
  n.ry = n.h;
  n.y = hauteurSol(n.x, n.z);
}

// Part des habitants placés dans les allées du marché : forte quand le joueur y est, nulle loin de là.
function probMarche() {
  if (!NOEUDS_MARCHE.length) return 0;
  const dx = Math.max(0, ZONE_MARCHE.minX - joueur.x, joueur.x - ZONE_MARCHE.maxX);
  const dz = Math.max(0, ZONE_MARCHE.minZ - joueur.z, joueur.z - ZONE_MARCHE.maxZ);
  return 0.6 * clamp(1 - Math.hypot(dx, dz) / 90, 0, 1);
}

function placerMarche(n, { minD, horsVue }) {
  for (let essai = 0; essai < 40; essai++) {
    const a = choisir(rnd, NOEUDS_MARCHE);
    const o = VOISINS[a][Math.floor(rnd() * VOISINS[a].length)];
    viseArete(n, a, o.id, 0.1 + rnd() * 0.8);
    const dx = n.x - joueur.x, dz = n.z - joueur.z, d = Math.hypot(dx, dz);
    if (d < minD) continue;
    if (horsVue && d < 85 && (dx * joueur.fx + dz * joueur.fz) / d > 0.15) continue;
    if (rnd() > Math.exp(-(d - minD) / 60) && essai < 36) continue;
    break;
  }
  n.speed = 0;
  n.etat = MARCHE;
  n.prochainePause = 6 + rnd() * 30;
  n.partenaire = null;
  n.pauseZ = undefined;
  n.dip = 0;
  n.look = 0;
}

function placer(n, opts) {
  if (rnd() < probMarche()) {
    placerMarche(n, opts);
    n.vis = opts.depuisLeDebut ? 1 : 0;
    return;
  }
  const { minD, horsVue, rayonBlocs = 1.4, depuisLeDebut = false } = opts;
  const pbi = indiceBloc(joueur.x), pbj = indiceBloc(joueur.z);
  for (let essai = 0; essai < 40; essai++) {
    const R = rayonBlocs + (essai > 26 ? 1 : 0);
    const i = clamp(pbi + Math.round((rnd() * 2 - 1) * (R + 0.5)), 0, BLOCKS - 1);
    const j = clamp(pbj + Math.round((rnd() * 2 - 1) * (R + 0.5)), 0, BLOCKS - 1);
    const c = Math.floor(rnd() * 4);
    const a = idNoeud(i, j, c);
    const voisins = VOISINS[a];
    const o = rnd() < 0.82 ? voisins[rnd() < 0.5 ? 0 : 1] : voisins[2 + Math.floor(rnd() * (voisins.length - 2))] || voisins[0];
    if (o.bloque) continue; // un côté de pâté couvert par les étals du marché
    const t = 0.1 + rnd() * 0.8;
    viseArete(n, a, o.id, t);
    const dx = n.x - joueur.x, dz = n.z - joueur.z, d = Math.hypot(dx, dz);
    if (d < minD) continue;
    if (horsVue && d < 85 && (dx * joueur.fx + dz * joueur.fz) / d > 0.15) continue;
    if (rnd() > Math.exp(-(d - minD) / 42) && essai < 36) continue; // plus dense près du joueur
    break;
  }
  n.speed = 0;
  n.etat = MARCHE;
  n.vis = depuisLeDebut ? 1 : 0;
  n.prochainePause = 5 + rnd() * 35;
  n.pauseZ = undefined;
  n.partenaire = null;
  n.dip = 0;
  n.look = 0;
}

function formerGroupe(a, b) {
  // deux habitants face à face, sur un côté de pâté, qui se parlent un moment
  placer(a, { minD: 14, horsVue: false, depuisLeDebut: false });
  const i = indiceBloc(a.x), j = indiceBloc(a.z);
  const dx = nx[a.vers] - nx[a.de], dz = nz[a.vers] - nz[a.de], L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L;
  if (L > 30) {
    b.x = a.x + ux * 0.62;
    b.z = a.z + uz * 0.62;
    b.y = a.y;
    for (const [p, q] of [[a, b], [b, a]]) {
      p.etat = GROUPE;
      p.tEtat = 30 + rnd() * 60;
      p.partenaire = q;
      p.speed = 0;
      p.vis = 0;
      p.look = 0;
      p.ry = p.h = Math.atan2(q.x - p.x, q.z - p.z);
      p.faceYaw = p.h;
    }
    b.de = a.de; b.vers = a.vers; b.dip = 0;
    return true;
  }
  return false;
}

function reprendre(n) {
  // retour sur les trottoirs (ou dans les allées du marché) : vise le nœud le plus proche
  const bi = indiceBloc(n.x), bj = indiceBloc(n.z);
  let meilleur = -1, md = 1e9;
  if (n.de >= NOEUDS) {
    for (const id of NOEUDS_MARCHE) {
      const d = (nx[id] - n.x) ** 2 + (nz[id] - n.z) ** 2;
      if (d < md) { md = d; meilleur = id; }
    }
    n.de = n.vers = meilleur;
    n.etat = MARCHE;
    n.partenaire = null;
    n.pauseZ = undefined;
    n.prochainePause = 10 + rnd() * 25;
    return;
  }
  for (let i = Math.max(0, bi - 1); i <= Math.min(BLOCKS - 1, bi + 1); i++)
    for (let j = Math.max(0, bj - 1); j <= Math.min(BLOCKS - 1, bj + 1); j++)
      for (let c = 0; c < 4; c++) {
        const id = idNoeud(i, j, c);
        const d = (nx[id] - n.x) ** 2 + (nz[id] - n.z) ** 2;
        if (d < md) { md = d; meilleur = id; }
      }
  n.de = meilleur;
  n.vers = meilleur;
  n.etat = MARCHE;
  n.partenaire = null;
  n.prochainePause = 8 + rnd() * 30;
}

function choisirSuite(n) {
  const cur = n.vers, prev = n.de;
  const opts = VOISINS[cur];
  const pdx = nx[cur] - nx[prev], pdz = nz[cur] - nz[prev], pl = Math.hypot(pdx, pdz) || 1;
  let somme = 0;
  const w = opts.map((o) => {
    let p = o.id === prev ? 0.03 : o.bloque ? 0 : o.ring ? 3 : 1.15;
    if (pl > 0.01 && (o.dx * pdx + o.dz * pdz) / pl > 0.9) p *= 1.6;
    somme += p;
    return p;
  });
  let x = rnd() * somme;
  for (let k = 0; k < opts.length; k++) {
    x -= w[k];
    if (x <= 0) return opts[k].id;
  }
  return opts[0].id;
}

// ---------------------------------------------------------------- joueur, cigarette, bribes
const fumee = { actif: false, fin: -99, jetee: -99, depuis: 0, dit: -99 };

const bribes = { pioche: [], recentes: [], derniere: -99, fumee: [], affichees: [] };
function melanger(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function prochaineBribe() {
  if (!bribes.pioche.length) {
    const toutes = melanger(D.BRIBES.map((_, i) => i));
    // celles dites récemment passent en fin de pioche
    const frais = toutes.filter((i) => !bribes.recentes.includes(i));
    const vieux = toutes.filter((i) => bribes.recentes.includes(i));
    bribes.pioche = [...frais, ...vieux].reverse();
  }
  const i = bribes.pioche.pop();
  bribes.recentes.push(i);
  if (bribes.recentes.length > 18) bribes.recentes.shift();
  return D.BRIBES[i];
}
function bribeFumee(ancien) {
  if (!bribes.fumee.length) bribes.fumee = melanger(D.REACTIONS_FUMEE.map((_, i) => i));
  for (let k = bribes.fumee.length - 1; k >= 0; k--) {
    const r = D.REACTIONS_FUMEE[bribes.fumee[k]];
    if (!r.ancien || ancien) return D.REACTIONS_FUMEE[bribes.fumee.splice(k, 1)[0]].texte;
  }
  return null;
}

// ---------------------------------------------------------------- DOM des bribes
const CSS = `
.npc-bribe { position: fixed; left: 0; top: 0; z-index: 40; pointer-events: none; max-width: 270px; text-align: center;
  font-family: var(--ui-police, ui-monospace, Menlo, Consolas, monospace); font-size: 14px; line-height: 1.35; font-style: italic;
  color: #fff0ff; padding: 4px 10px 5px; background: rgba(12, 5, 28, 0.74); border-bottom: 2px solid rgba(255, 90, 208, 0.6);
  text-shadow: 0 1px 2px #000, 0 0 8px rgba(196, 75, 255, 0.6); opacity: 0; display: none; will-change: transform, opacity; -webkit-font-smoothing: none; }
`;
let racineDom = null;
const poolDom = [];
function creerDom() {
  if (racineDom) return;
  const st = document.createElement('style');
  st.textContent = CSS;
  document.head.appendChild(st);
  racineDom = document.createElement('div');
  document.body.appendChild(racineDom);
  for (let i = 0; i < 2; i++) {
    const el = document.createElement('div');
    el.className = 'npc-bribe';
    racineDom.appendChild(el);
    poolDom.push(el);
  }
}
function afficherBribe(n, texte) {
  const el = poolDom.find((e) => !bribes.affichees.some((b) => b.el === e));
  if (!el) return false;
  el.textContent = `« ${texte} »`;
  el.style.display = 'block';
  bribes.affichees.push({ el, n, t0: jeu.t, duree: 3.4 + texte.length * 0.045, a: 0 });
  n.derniereBribe = jeu.t;
  bribes.derniere = jeu.t;
  return true;
}

// ---------------------------------------------------------------- rendu de la foule
let racine = null;
let meshCorps = [];
let meshHalo = null;
let pret = false;
let aTraiter = []; // personnages ajoutés avant que tout soit prêt
const compteurs = { visibles: 0, simules: NB };

function ecrireInstance(mesh, k, x, y, z, yaw, pitch, roll, sc) {
  _e.set(pitch, yaw, roll, 'YXZ');
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.set(sc, sc, sc);
  _m.compose(_p, _q, _s);
  mesh.setMatrixAt(k, _m);
}

// ---------------------------------------------------------------- simulation
let accGrille = 0;
function simuler(dt, t) {
  const px = joueur.x, pz = joueur.z;
  const etatCig = jeu.smoking?.etat ?? 'idle';
  const fume = etatCig !== 'idle';
  if (fume && !fumee.actif) fumee.depuis = t;
  if (fume) fumee.fin = t;
  // ils continuent de regarder un moment après la dernière bouffée ou la cigarette jetée
  fumee.actif = fume || t - fumee.fin < 2.2;
  const regardent = fumee.actif;

  // grille de voisinage
  grille.clear();
  for (const n of habitants) {
    if (n.vis <= 0.01 && n.d > 90) continue;
    const k = Math.floor(n.x / PAS) * 4096 + Math.floor(n.z / PAS);
    let c = grille.get(k);
    if (!c) grille.set(k, (c = []));
    c.push(n);
  }

  let reaffectes = 0;
  for (const n of habitants) {
    const dxp = px - n.x, dzp = pz - n.z;
    const d = Math.hypot(dxp, dzp);
    n.d = d;

    // --- réaffectation des habitants lointains
    if (d > RAYON_REAFFECTATION && reaffectes < 10) {
      reaffectes++;
      if (n.etat !== GROUPE && rnd() < 0.12) {
        const m = habitants[Math.floor(rnd() * NB)];
        if (m !== n && m.d > RAYON_REAFFECTATION && m.etat === MARCHE && formerGroupe(n, m)) continue;
      }
      placer(n, { minD: 55, horsVue: true });
      continue;
    }
    n.vis += ((d < RAYON_AFFICHAGE ? 1 : 0) - n.vis) * Math.min(1, dt * 1.6);
    if (d > RAYON_AFFICHAGE + 20) { n.vis = 0; }

    // --- réaction à la cigarette
    if (regardent && d < RAYON_FUMEE * n.curiosite && n.vis > 0.5 && (n.etat === MARCHE || n.etat === PAUSE || n.etat === GROUPE)) {
      n.tireLOS -= dt;
      if (n.tireLOS <= 0) {
        n.tireLOS = 0.4;
        if (degage(n.x, n.z, px, pz)) {
          n.etat = n.approche && d > 3.2 ? APPROCHE : REGARD;
          n.partenaire = null;
        }
      }
    }
    if ((n.etat === REGARD || n.etat === APPROCHE) && !fume && t - fumee.fin > 2.2 + n.delai) {
      reprendre(n);
    }

    // --- cible de déplacement et vitesse souhaitée
    let cx = 0, cz = 0, vcible = 0, regarde = 0, tourner = true;
    switch (n.etat) {
      case MARCHE: {
        const o = n.vers;
        const dx = nx[o] - nx[n.de], dz = nz[o] - nz[n.de], L = Math.hypot(dx, dz) || 1;
        const ux = dx / L, uz = dz / L;
        const arete = n.de !== n.vers;
        cx = nx[o] + (arete ? -uz * n.voie : 0);
        cz = nz[o] + (arete ? ux * n.voie : 0);
        vcible = n.de >= NOEUDS ? n.vmax * 0.8 : n.vmax; // on flâne entre les étals
        n.prochainePause -= dt;
        const ar = arete && n.prochainePause <= 0 ? VOISINS[n.de].find((v) => v.id === n.vers) : null;
        if (ar?.ring) {
          // arrêt devant une vitrine : à l'écart des coins
          const t1 = Math.hypot(n.x - nx[n.de], n.z - nz[n.de]), t2 = Math.hypot(n.x - nx[n.vers], n.z - nz[n.vers]);
          if (t1 > (ar.allee ? 3 : 6) && t2 > (ar.allee ? 3 : 6)) {
            n.etat = PAUSE;
            n.tEtat = 3 + rnd() * 12;
            if (ar.allee) {
              // devant un étal : à gauche ou à droite de l'allée, on s'en approche (jusqu'à un mètre du comptoir)
              const lane = nz[n.de], vers = rnd() < 0.5 ? -1 : 1;
              const front = Math.abs(lane - 25.5) < 1 ? (vers < 0 ? 21.7 : 27.3) : (vers < 0 ? 32.7 : 38.3);
              n.pauseZ = lane + vers * Math.min(1.7, Math.abs(front - lane) - 1);
              n.faceYaw = vers < 0 ? Math.PI : 0;
            } else {
              const bx = centreBloc(indiceBloc(n.x)), bz = centreBloc(indiceBloc(n.z));
              n.faceYaw = Math.abs(n.x - bx) > Math.abs(n.z - bz) ? (n.x > bx ? -Math.PI / 2 : Math.PI / 2) : n.z > bz ? Math.PI : 0;
            }
            break;
          }
          n.prochainePause = 4;
        }
        break;
      }
      case PAUSE:
        n.tEtat -= dt;
        vcible = 0;
        if (n.tEtat <= 0) { n.etat = MARCHE; n.pauseZ = undefined; n.prochainePause = n.de >= NOEUDS ? 20 + rnd() * 45 : 12 + rnd() * 40; }
        break;
      case GROUPE:
        n.tEtat -= dt;
        vcible = 0;
        if (n.partenaire) n.faceYaw = Math.atan2(n.partenaire.x - n.x, n.partenaire.z - n.z);
        if (n.tEtat <= 0) { n.etat = MARCHE; n.partenaire = null; n.prochainePause = 15 + rnd() * 40; }
        break;
      case REGARD:
        vcible = 0;
        regarde = 1;
        break;
      case APPROCHE: {
        const arret = n.ancien ? 2.5 : 4.2;
        if (d > arret) { cx = px; cz = pz; vcible = 0.85; }
        else { n.etat = REGARD; }
        regarde = 1;
        break;
      }
    }

    // --- le joueur : s'écarter, s'arrêter, tourner la tête
    let pushX = 0, pushZ = 0;
    const hx = Math.sin(n.h), hz = Math.cos(n.h);
    if (d < 6) {
      const fwd = (dxp * hx + dzp * hz) / (d || 1);
      const lat = dxp * -hz + dzp * hx; // > 0 : le joueur est à droite
      if (n.etat === MARCHE && fwd > 0.5 && d < 3.8) {
        vcible *= lisse((d - 1.1) / 2.4);
        if (d < 2.4) { // se décale du côté libre
          const s = lat >= 0 ? -1 : 1;
          pushX += -hz * s * 0.9;
          pushZ += hx * s * 0.9;
        }
      }
      if (d < 1.5) { pushX -= (dxp / d) * (1.5 - d) * 1.6; pushZ -= (dzp / d) * (1.5 - d) * 1.6; }
      if (n.etat === MARCHE) regarde = Math.max(regarde, 0.34 * lisse((7 - d) / 4));
      else if (n.etat === PAUSE || n.etat === GROUPE) regarde = Math.max(regarde, 0.85 * lisse((6.5 - d) / 3));
    }
    if (n.etat === MARCHE && vcible < 0.12 && d < 3) regarde = Math.max(regarde, 1); // arrêté devant lui : il le regarde

    // --- les voisins : se croiser sans se traverser
    if (n.vis > 0.05) {
      const gx = Math.floor(n.x / PAS), gz = Math.floor(n.z / PAS);
      for (let a = -1; a <= 1; a++)
        for (let b = -1; b <= 1; b++) {
          const cell = grille.get((gx + a) * 4096 + (gz + b));
          if (!cell) continue;
          for (const o of cell) {
            if (o === n) continue;
            const dx = o.x - n.x, dz = o.z - n.z, dd = dx * dx + dz * dz;
            if (dd > 2.6) continue;
            const dist = Math.sqrt(dd) || 0.01;
            if (dist < 0.85) {
              pushX -= (dx / dist) * (0.85 - dist) * 1.8;
              pushZ -= (dz / dist) * (0.85 - dist) * 1.8;
            }
            if (n.etat === MARCHE) {
              const fwd = dx * hx + dz * hz;
              const lat = dx * -hz + dz * hx;
              if (fwd > 0 && fwd < 1.7 && Math.abs(lat) < 0.55) {
                vcible = Math.min(vcible, Math.max(0, o.speed + (fwd - 0.65) * 1.2));
                const s = lat > 0 ? -1 : 1;
                pushX += -hz * s * 0.7;
                pushZ += hx * s * 0.7;
              }
            }
          }
        }
    }

    // --- les personnages nommés (Itsuki sur son trottoir, Oba…) : on les contourne
    if (n.vis > 0.05) {
      for (const q of personnages.values()) {
        if (!q.corps || q.zone !== 'kasumi' || q.retire) continue;
        const dx = n.x - q.position.x, dz = n.z - q.position.z, dd = dx * dx + dz * dz;
        if (dd > 1.3) continue;
        const dist = Math.sqrt(dd) || 0.01;
        pushX += (dx / dist) * (1.15 - dist) * 2.4;
        pushZ += (dz / dist) * (1.15 - dist) * 2.4;
      }
    }

    // --- mouvement
    const a = vcible < n.speed ? 7 : 2.4;
    n.speed += (vcible - n.speed) * Math.min(1, dt * a);
    if (n.speed < 0.02 && vcible === 0) n.speed = 0;
    if (n.etat === MARCHE || n.etat === APPROCHE) {
      const tx = cx - n.x, tz = cz - n.z;
      const dc = Math.hypot(tx, tz);
      const voulu = Math.atan2(tx, tz);
      const dh = angle(voulu - n.h);
      const om = 4.2 * dt;
      n.h += clamp(dh, -om, om);
      if (n.etat === MARCHE && dc < 0.9) {
        const suivant = choisirSuite(n);
        n.de = n.vers;
        n.vers = suivant;
      }
    }
    const vx = Math.sin(n.h) * n.speed + pushX, vz = Math.cos(n.h) * n.speed + pushZ;
    n.x += vx * dt;
    n.z += vz * dt;
    if (n.etat === PAUSE && n.pauseZ !== undefined) n.z += clamp(n.pauseZ - n.z, -0.8 * dt, 0.8 * dt); // s'approche de l'étal
    if (n.de >= NOEUDS || n.etat === PAUSE) chasserDesEtals(n);
    // ne jamais entrer dans un immeuble
    {
      const bi = indiceBloc(n.x), bj = indiceBloc(n.z);
      const bx = centreBloc(bi), bz = centreBloc(bj);
      const ox = n.x - bx, oz = n.z - bz;
      if (Math.abs(ox) < BORD && Math.abs(oz) < BORD) {
        if (BORD - Math.abs(ox) < BORD - Math.abs(oz)) n.x = bx + Math.sign(ox || 1) * BORD;
        else n.z = bz + Math.sign(oz || 1) * BORD;
      }
    }
    const yc = hauteurSol(n.x, n.z);
    n.y += (yc - n.y) * Math.min(1, dt * 14);
    const dep = Math.hypot(vx, vz) * dt;
    n.phase += (dep / FOULEE) * TAU;
    n.mouv = Math.min(1, Math.hypot(vx, vz) / 1.25);

    // --- orientation du corps
    let cible;
    if (n.etat === MARCHE || n.etat === APPROCHE) cible = n.h;
    else cible = n.faceYaw;
    const versJoueur = Math.atan2(dxp, dzp);
    if (n.etat === REGARD || n.etat === APPROCHE) cible = versJoueur;
    else if (regarde > 0) cible = cible + angle(versJoueur - cible) * regarde;
    if (n.etat === REGARD || n.etat === APPROCHE) n.faceYaw = versJoueur;
    n.ry += angle(cible - n.ry) * Math.min(1, dt * (n.etat === MARCHE ? 6 : 5));

    // --- halo : pâlit et vacille quand le joueur fume (ils regardent détruire une chose qui est à soi)
    let vise = 1;
    if (n.etat === REGARD || n.etat === APPROCHE) vise = 1 + 0.25 * Math.sin(t * 9 + n.id) * Math.sin(t * 2.3 + n.id * 2);
    n.haloBoost += (vise - n.haloBoost) * Math.min(1, dt * 6);
    n.dip *= Math.exp(-dt * 0.9);
  }
}

function dessiner(t, camera) {
  const cx = camera.position.x, cz = camera.position.z;
  const fx = joueur.fx, fz = joueur.fz;
  const compte = [0, 0, 0];
  let k = 0;
  const [m0, m1, m2] = meshCorps;
  const ms = [m0, m1, m2];
  for (const n of habitants) {
    if (n.vis < 0.02) continue;
    const dx = n.x - cx, dz = n.z - cz, d = Math.hypot(dx, dz);
    if (d > 7 && (dx * fx + dz * fz) / d < 0.25) continue; // derrière la caméra
    const sc = n.taille * lisse(n.vis);
    const mouv = n.mouv || 0;
    const bob = Math.abs(Math.sin(n.phase)) * 0.034 * mouv + Math.sin(t * 1.3 + n.id) * 0.004;
    const roulis = Math.sin(n.phase) * 0.04 * mouv;
    const tangage = 0.05 * mouv;
    const m = ms[n.variante];
    const i = compte[n.variante]++;
    ecrireInstance(m, i, n.x, n.y + bob, n.z, n.ry, tangage, roulis, sc);
    const ud = m.userData;
    // halo mélangé vers le pâle quand il regarde fumer
    _c.copy(n.halo);
    if (n.etat === REGARD || n.etat === APPROCHE) _c.lerp(_c2.setHex(D.HALO_SURPRIS), 0.55);
    const f = n.intensite * n.haloBoost * (1 - 0.6 * Math.min(1, n.dip));
    ud.aHalo.array[i * 4] = _c.r * f * 0.8;
    ud.aHalo.array[i * 4 + 1] = _c.g * f * 0.8;
    ud.aHalo.array[i * 4 + 2] = _c.b * f * 0.8;
    ud.aHalo.array[i * 4 + 3] = n.ton;
    ud.aAnim.array[i * 4] = n.phase;
    ud.aAnim.array[i * 4 + 1] = 0.62 * mouv;
    // halo (sprite additif)
    const hy = n.y + bob + HAUT_HALO[n.variante] * sc;
    _e.set(0, 0, 0);
    _p.set(n.x, hy, n.z);
    _s.setScalar(TAILLE_HALO * lisse(n.vis) * (0.92 + 0.08 * n.taille));
    _m.compose(_p, _q.identity(), _s);
    meshHalo.setMatrixAt(k, _m);
    _c.multiplyScalar(f);
    meshHalo.setColorAt(k, _c);
    k++;
  }
  for (let v = 0; v < 3; v++) {
    ms[v].count = compte[v];
    ms[v].instanceMatrix.needsUpdate = true;
    ms[v].userData.aHalo.needsUpdate = true;
    ms[v].userData.aAnim.needsUpdate = true;
  }
  meshHalo.count = k;
  meshHalo.instanceMatrix.needsUpdate = true;
  meshHalo.instanceColor.needsUpdate = true;
  compteurs.visibles = k;
}

// ---------------------------------------------------------------- Calque : un petit pool d'étiquettes
const POOL_ETIQUETTES = 12;
const pool = [];
let accCalque = 0;
function majCalque(dt) {
  if (!pool.length) return;
  const actif = calque.actif;
  if (!actif) {
    for (const e of pool) {
      if (e.garee) continue;
      if (e.hab) e.hab.etiquette = null;
      e.hab = null;
      e.garee = true;
      e.position.set(0, -900, 0);
    }
    return;
  }
  accCalque += dt;
  if (accCalque >= 0.3) {
    accCalque = 0;
    const proches = habitants.filter((n) => n.vis > 0.5 && n.d < 24).sort((a, b) => a.d - b.d).slice(0, POOL_ETIQUETTES);
    for (const e of pool) if (e.hab && !proches.includes(e.hab)) { e.hab.etiquette = null; e.hab = null; e.position.set(0, -900, 0); }
    for (const n of proches) {
      if (n.etiquette) continue;
      const libre = pool.find((e) => !e.hab);
      if (!libre) break;
      libre.hab = n;
      libre.garee = false;
      n.etiquette = libre;
      libre.lignes = lignesDe(n);
      libre.maj();
    }
  }
  for (const e of pool) if (e.hab) e.position.set(e.hab.x, e.hab.y + 2.2 * e.hab.taille, e.hab.z);
}

// ---------------------------------------------------------------- bribes affichées
let accBribe = 0;
function majBribes(dt, t) {
  creerDom();
  const calme = jeu.enPartie && !jeu.suspensions.has('ouverture') && !jeu.suspensions.has('dialogue') && !jeu.suspensions.has('frise') && jeu.zones.nom === 'kasumi';
  accBribe += dt;
  if (calme && accBribe >= 0.25) {
    accBribe = 0;
    const libre = poolDom.length - bribes.affichees.length;
    if (libre > 0 && t - bribes.derniere > 7) {
      // en fumant : celui qui regarde de près dit ce qu'il pense
      if (fumee.actif && t - fumee.dit > 6 && t - fumee.depuis > 1.2) {
        let m = null;
        for (const n of habitants) if ((n.etat === REGARD || n.etat === APPROCHE) && n.d < 9 && n.vis > 0.8 && n.derniereBribe < t - 40 && (!m || n.d < m.d)) m = n;
        const txt = m && bribeFumee(m.ancien);
        if (txt && afficherBribe(m, txt)) fumee.dit = t;
      } else if (!fumee.actif) {
        let m = null;
        for (const n of habitants) {
          if (!n.bavard || n.vis < 0.9 || n.d < 1.7 || n.d > 4.8) continue;
          if (n.etat === REGARD || n.etat === APPROCHE) continue;
          if (t - n.derniereBribe < 150) continue;
          const vx = n.x - joueur.x, vz = n.z - joueur.z;
          if ((vx * joueur.fx + vz * joueur.fz) / n.d < 0.4) continue;
          if (!m || n.d < m.d) m = n;
        }
        if (m) afficherBribe(m, prochaineBribe());
      }
    }
    if (!fumee.actif && fumee.fin > fumee.dit && t - fumee.jetee < 6 && t - fumee.dit > 3 && t > fumee.jetee + 1) {
      // une dernière réflexion quand la cigarette est jetée
      const m = habitants.filter((n) => (n.etat === REGARD || n.etat === MARCHE) && n.d < 8 && n.vis > 0.8).sort((a, b) => a.d - b.d)[0];
      if (m && libre > 0 && afficherBribe(m, choisir(rnd, D.REACTIONS_JETEE))) fumee.dit = t;
    }
  }
}
function placerBribes(camera) {
  if (!bribes.affichees.length) return;
  const w = innerWidth, h = innerHeight;
  const t = jeu.t;
  const calme = jeu.enPartie && !jeu.suspensions.has('ouverture') && !jeu.suspensions.has('dialogue') && !jeu.suspensions.has('frise') && jeu.zones.nom === 'kasumi';
  for (let i = bribes.affichees.length - 1; i >= 0; i--) {
    const b = bribes.affichees[i];
    const age = t - b.t0;
    const veut = calme && age < b.duree && b.n.vis > 0.3 && b.n.d < 9;
    b.a += ((veut ? 1 : 0) - b.a) * 0.25;
    _p.set(b.n.x, b.n.y + 2.55 * b.n.taille, b.n.z).project(camera);
    const dehors = _p.z > 1 || _p.z < -1 || Math.abs(_p.x) > 1.1 || Math.abs(_p.y) > 1.1;
    b.el.style.opacity = dehors ? '0' : (b.a * 0.95).toFixed(2);
    if (!dehors) {
      const x = Math.round((_p.x * 0.5 + 0.5) * w), y = Math.round((-_p.y * 0.5 + 0.5) * h);
      b.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    }
    if (!veut && b.a < 0.03) {
      b.el.style.display = 'none';
      bribes.affichees.splice(i, 1);
    }
  }
}

// ---------------------------------------------------------------- personnages nommés
const personnages = new Map();
function ajouterPersonnage(def) {
  const { id, nom } = def;
  const zone = def.zone || 'kasumi';
  const ap = def.apparence || {};
  const pos = Array.isArray(def.position) ? new THREE.Vector3(...def.position) : new THREE.Vector3(def.position.x, def.position.y, def.position.z);
  const p = {
    id, nom, zone, position: pos, regardeLeJoueur: !!def.regardeLeJoueur,
    yaw: def.yaw ?? 0, ry: def.yaw ?? 0, taille: ap.taille ?? 1,
    penche: ap.penche ?? 0, vacille: ap.vacille ?? 0,
    halo: new THREE.Color(ap.couleurHalo ?? D.HUMEURS[0].couleur),
    corps: null, halo3d: null, objet: null, vu: true, parle: false, retire: false,
    get visible() { return this._visible !== false; },
    set visible(v) {
      this._visible = !!v;
      if (this.corps) this.corps.visible = this.halo3d.visible = this._visible;
    },
    retirer() {
      if (this.retire) return;
      this.retire = true;
      if (this.objet) jeu.interact.retirer(this.objet);
      this.corps?.removeFromParent();
      this.halo3d?.removeFromParent();
      this.corps?.geometry.dispose();
      personnages.delete(id);
    },
  };
  p._visible = true;
  p.def = def;
  p.apparence = ap;
  personnages.set(id, p);
  if (pret) monterPersonnage(p);
  else aTraiter.push(p);
  return p;
}

// Le dialogue d'un personnage nommé : `def.dialogue` (objet dialogue, fonction ou promesse) est évalué
// AVANT que la rencontre ne soit comptée ; `etat.rencontres[id]` est incrémenté à la FIN du dialogue
// (c'est ce que lit la sélection des dialogues), puis `def.apres(p, dialogue)` est appelé.
async function parler(p) {
  const def = p.def;
  p.parle = true;
  try {
    let r = typeof def.dialogue === 'function' ? def.dialogue(p) : def.dialogue;
    if (r && typeof r.then === 'function') r = await r;
    if (r && typeof r === 'object' && r.noeuds) {
      await jeu.ouvrirDialogue(r);
      jeu.etat.rencontres[p.id] = (jeu.etat.rencontres[p.id] || 0) + 1;
      jeu.sauver?.();
      if (def.apres) await def.apres(p, r);
    }
  } finally {
    p.parle = false;
  }
}

function monterPersonnage(p) {
  if (p.retire || p.corps) return;
  const def = p.def, ap = p.apparence;
  const scene = jeu.zones.get(p.zone).scene;
  const variante = ap.variante ?? Math.floor(aleatoire(graine('nom', p.id))() * 3);
  p.variante = variante;
  p.corps = maillageCorps(corps(variante, ap.accessoire || null), 1);
  p.corps.count = 1;
  p.halo3d = maillageHalo(1);
  p.halo3d.count = 1;
  p.halo3d.renderOrder = 6;
  scene.add(p.corps, p.halo3d);
  p.corps.visible = p.halo3d.visible = p.visible;
  const lib = def.libelle ?? remplir(D.NPC.parler, { nom: p.nom });
  // L'objet interactif porte lui-même la ligne du Calque (`lignes`) : une seule étiquette par personnage.
  const haut = (def.hauteurEtiquette ?? 2.2) * p.taille;
  p.objet = jeu.interact.ajouter({
    zone: p.zone,
    position: [p.position.x, p.position.y + 1.2, p.position.z],
    rayon: def.rayon ?? 2.8,
    libelle: lib,
    lignes: def.lignes,
    sansLigne: !!def.sansLigne,
    decalageEtiquette: haut - 1.2 + 0.0,
    visible: () => p.visible && !p.retire && jeu.zones.nom === p.zone,
    action: () => parler(p),
  });
}

const _fl = new THREE.Vector3();
function majPersonnages(dt, t) {
  for (const p of personnages.values()) {
    if (!p.corps || p.zone !== jeu.zones.nom) continue;
    const pos = p.position;
    const dx = joueur.x - pos.x, dz = joueur.z - pos.z, d = Math.hypot(dx, dz);
    if ((p.regardeLeJoueur && d < 9) || p.parle) {
      p.ry += angle(Math.atan2(dx, dz) - p.ry) * Math.min(1, dt * 4);
    } else {
      p.ry += angle(p.yaw - p.ry) * Math.min(1, dt * 2);
    }
    const sc = p.taille;
    const resp = Math.sin(t * 1.1 + p.id.length) * 0.006;
    ecrireInstance(p.corps, 0, pos.x, pos.y + resp, pos.z, p.ry, p.penche + Math.sin(t * 0.9 + p.id.length) * 0.012, Math.sin(t * 0.7) * 0.006, sc);
    // halo qui vacille : une flamme près d'une fenêtre
    const vac = p.vacille ? 1 + p.vacille * (Math.sin(t * 6.1 + p.id.length) * 0.5 + Math.sin(t * 2.3) * 0.5) * (0.6 + 0.4 * Math.sin(t * 0.8)) : 1;
    const ud = p.corps.userData;
    ud.aHalo.array[0] = p.halo.r * 0.8 * vac;
    ud.aHalo.array[1] = p.halo.g * 0.8 * vac;
    ud.aHalo.array[2] = p.halo.b * 0.8 * vac;
    ud.aHalo.array[3] = 0.5;
    ud.aAnim.array[0] = 0;
    ud.aAnim.array[1] = 0;
    p.corps.instanceMatrix.needsUpdate = true;
    ud.aHalo.needsUpdate = true;
    ud.aAnim.needsUpdate = true;
    _p.set(pos.x, pos.y + HAUT_HALO[p.variante] * sc + resp, pos.z);
    _s.setScalar(TAILLE_HALO * 1.05 * sc);
    _m.compose(_p, _q.identity(), _s);
    p.halo3d.setMatrixAt(0, _m);
    p.halo3d.setColorAt(0, _c.copy(p.halo).multiplyScalar(1.05 * vac));
    p.halo3d.instanceMatrix.needsUpdate = true;
    p.halo3d.instanceColor.needsUpdate = true;
    if (p.objet) p.objet.position.set(pos.x, pos.y + 1.2, pos.z);
  }
}

// ---------------------------------------------------------------- système
function replacerTous() {
  for (const n of habitants) { n.etiquette = null; n.derniereBribe = -999; }
  for (const e of pool) { e.hab = null; e.garee = true; e.position.set(0, -900, 0); }
  let i = 0;
  while (i < NB) {
    const n = habitants[i];
    if (i % 14 === 13 && i + 1 < NB && formerGroupe(n, habitants[i + 1])) {
      n.vis = habitants[i + 1].vis = 1;
      i += 2;
      continue;
    }
    placer(n, { minD: 7, horsVue: false, rayonBlocs: 1.3, depuisLeDebut: true });
    n.speed = n.vmax * 0.8;
    i++;
  }
}

export const npc = {
  nom: 'npc',

  /** Ajoute un personnage nommé (voir l'en-tête de ce fichier). */
  ajouterPersonnage,
  /** Les habitants de la foule (lecture : x, z, y, humeur, etat…). */
  get habitants() { return habitants; },
  get personnages() { return personnages; },
  /** Habitants dessinés à l'image courante. */
  get visibles() { return compteurs.visibles; },
  /** Le groupe 3D de la foule (pour mesurer le coût : racine.visible = false). */
  get racine() { return racine; },
  get fumee() { return fumee; },
  BRIBES: D.BRIBES,

  init() {
    jeu.npc = npc;
    construireAllees();
    ETALS = (marche.colliders || []).filter((c) => c.minY === undefined && c.maxY > 0.5);
    creerDom();
    const rr = aleatoire(20771);
    void rr;
    for (let i = 0; i < NB; i++) habitants.push(creerHabitant(i));
    for (let i = 0; i < POOL_ETIQUETTES; i++) {
      const e = calque.etiqueter({ position: [0, -900, 0], lignes: ['…'], zone: 'kasumi', rayon: 25 });
      e.garee = true;
      pool.push(e);
    }
    const zone = jeu.zones.get('kasumi');
    racine = new THREE.Group();
    racine.name = 'habitants';
    meshCorps = [0, 1, 2].map((v) => maillageCorps(ressources().geos[v], NB));
    meshHalo = maillageHalo(NB);
    racine.add(...meshCorps, meshHalo);
    zone.scene.add(racine);
    if (zone.scene.fog) haloUniforms.uFog.value = zone.scene.fog.density;

    jeu.on('cigarette:allumage', () => { fumee.depuis = jeu.t; });
    jeu.on('cigarette:jetee', () => {
      fumee.jetee = jeu.t;
      for (const n of habitants) if (n.etat === REGARD || n.etat === APPROCHE) n.dip = 1;
    });
    jeu.on('partie:nouvelle', () => { if (jeu.zones.nom === 'kasumi') replacerTous(); });

    pret = true;
    for (const p of aTraiter) monterPersonnage(p);
    aTraiter = [];
  },

  surZone(nom) {
    if (nom !== 'kasumi') return;
    const p = jeu.player.position;
    joueur.x = p.x;
    joueur.z = p.z;
    replacerTous();
  },

  update(dt, t) {
    if (!pret || !jeu.zones.nom) return;
    dt = Math.min(dt, 0.1);
    const cam = jeu.camera;
    const p = jeu.player.position;
    joueur.x = p.x;
    joueur.z = p.z;
    cam.getWorldDirection(_fl);
    const fl = Math.hypot(_fl.x, _fl.z) || 1;
    joueur.fx = _fl.x / fl;
    joueur.fz = _fl.z / fl;
    haloUniforms.uTime.value = t;
    majPersonnages(dt, t); // les personnages nommés vivent dans n'importe quelle zone
    if (jeu.zones.nom !== 'kasumi') return;
    simuler(dt, t);
    dessiner(t, cam);
    majCalque(dt);
    majBribes(dt, t);
  },

  apresRendu() {
    if (jeu.zones?.nom !== 'kasumi') return;
    placerBribes(jeu.camera);
  },
};
