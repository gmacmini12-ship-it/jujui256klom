import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TROTTOIR } from '../city.js';

// Escaliers de secours de Kasumi (tâche 2.4) : accès aux toits pour qui n'a pas le Bond.
//
// Un escalier est accolé à la façade d'un immeuble, sur le trottoir : deux voies de
// 1,35 m (intérieure contre le mur, extérieure côté rue), volées de 10 marches qui
// alternent de sens, paliers aux deux bouts, garde-corps côté rue. Chaque marche,
// chaque palier et chaque élément de garde-corps est une boîte 3D (voir player.js) :
// on les monte en marchant, marche après marche (hauteur ≤ 0,34 m).
//
// Repère local d'une façade : u le long du mur (depuis son coin), v vers la rue, y en hauteur.

const VOIE = 1.35; // largeur d'une voie
const PALIER = 1.4; // longueur d'un palier
const GIRON = 0.28; // profondeur d'une marche
const K = 10; // marches par volée (la dernière est le palier)
const HAUTEUR_MAX = 0.34; // hauteur de marche maximale
const EPAIS = 0.3; // épaisseur des boîtes de collision des marches et paliers
const RAMPE = 1.05; // hauteur du garde-corps

// Escaliers posés dans la ville : immeuble désigné par un point de son toit.
// `face` : côté de l'immeuble ('nord' = z min, 'sud' = z max, 'ouest' = x min, 'est' = x max) ;
// `u0` : départ le long de la façade (m depuis le coin ouest ou nord).
export const ESCALIERS = [
  // A — pâté de la clinique, immeuble nord-est (toit à 18,9 m), sur le trottoir est
  //     (le trottoir nord est occupé par le Marché des Mains) : premier toit et départ
  //     d'un parcours au Bond (étage technique, puis toit sud-est).
  { nom: 'clinique-nord-est', point: [69.5, 50.5], face: 'est', u0: 8 },
  // B — de l'autre côté de la rue, à l'ouest de la porte : immeuble de 26,6 m.
  { nom: 'carrefour-ouest', point: [-9.5, 50.5], face: 'nord', u0: 2.5 },
  // C — au sud : deux toits voisins (28,9 m et 27,9 m) reliés par trois marches,
  //     puis un escalier de toit jusqu'à l'étage technique (38,8 m).
  { nom: 'toits-sud', point: [9.5, 120], face: 'nord', u0: 12, chaine: true },
];

// Repère d'une façade : coin, tangente t, normale n (vers la rue).
function repere(b, face) {
  const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2;
  switch (face) {
    case 'nord': return { cx: x0, cz: z0, tx: 1, tz: 0, nx: 0, nz: -1, long: b.w };
    case 'sud': return { cx: x0, cz: z1, tx: 1, tz: 0, nx: 0, nz: 1, long: b.w };
    case 'ouest': return { cx: x0, cz: z0, tx: 0, tz: 1, nx: -1, nz: 0, long: b.d };
    default: return { cx: x1, cz: z0, tx: 0, tz: 1, nx: 1, nz: 0, long: b.d };
  }
}

function monde(R, u, v) {
  return [R.cx + R.tx * u + R.nx * v, R.cz + R.tz * u + R.nz * v];
}

export function construireEscaliers(scene, immeubles, colliders, { enseignes } = {}) {
  const geos = { metal: [], grille: [], neon: [], neonBleu: [] };
  const resultat = [];

  // Boîte locale (u, v, y) → maillage + collider éventuel.
  function boite(R, u0, u1, v0, v1, y0, y1, mat, collision = true) {
    const [ax, az] = monde(R, u0, v0);
    const [bx, bz] = monde(R, u1, v1);
    const minX = Math.min(ax, bx), maxX = Math.max(ax, bx), minZ = Math.min(az, bz), maxZ = Math.max(az, bz);
    if (mat) {
      const g = new THREE.BoxGeometry(maxX - minX, y1 - y0, maxZ - minZ);
      g.translate((minX + maxX) / 2, (y0 + y1) / 2, (minZ + maxZ) / 2);
      geos[mat].push(g);
    }
    if (collision) colliders.push({ minX, maxX, minZ, maxZ, minY: y0, maxY: y1 });
  }
  // Barre fine entre deux points locaux (rampes, limons) : visuelle seulement.
  const qa = new THREE.Quaternion();
  const axeX = new THREE.Vector3(1, 0, 0);
  function barre(R, [u0, v0, y0], [u1, v1, y1], ep, mat) {
    const [ax, az] = monde(R, u0, v0);
    const [bx, bz] = monde(R, u1, v1);
    const a = new THREE.Vector3(ax, y0, az), b = new THREE.Vector3(bx, y1, bz);
    const d = b.clone().sub(a);
    const len = d.length();
    const g = new THREE.BoxGeometry(len, ep, ep);
    qa.setFromUnitVectors(axeX, d.normalize());
    g.applyQuaternion(qa);
    g.translate((ax + bx) / 2, (y0 + y1) / 2, (az + bz) / 2);
    geos[mat].push(g);
  }

  // Garde-corps : collider + montant + main courante, entre u0 et u1 (local), à la hauteur du sol y.
  function garde(R, u0, u1, v0, v1, y) {
    boite(R, u0, u1, v0, v1, y, y + RAMPE, null);
  }

  const trouver = ([x, z]) =>
    immeubles.find((b) => Math.abs(x - b.x) < b.w / 2 && Math.abs(z - b.z) < b.d / 2);

  for (const def of ESCALIERS) {
    const b = trouver(def.point);
    if (!b) continue;
    const R = repere(b, def.face);
    const H = b.h;
    const F = Math.ceil((H - TROTTOIR) / (K * HAUTEUR_MAX)); // volées
    const r = (H - TROTTOIR) / (F * K); // hauteur de marche
    const run = (K - 1) * GIRON;
    const L = PALIER * 2 + run; // longueur totale le long du mur
    const u0 = def.u0;
    const vIn = [0.02, 0.02 + VOIE];
    const vOut = [0.02 + VOIE, 0.02 + 2 * VOIE];
    const vRail = vOut[1];
    const U = (u) => u0 + u; // décalage le long de la façade

    for (let f = 0; f < F; f++) {
      const base = TROTTOIR + f * K * r;
      const versE = f % 2 === 0;
      const [va, vb] = versE ? vOut : vIn;
      for (let j = 1; j < K; j++) {
        const top = base + j * r;
        const ua = versE ? PALIER + (j - 1) * GIRON : PALIER + run - j * GIRON;
        // marche : boîte de collision + caillebotis
        boite(R, U(ua), U(ua + GIRON), va, vb, top - EPAIS, top, null);
        boite(R, U(ua) + 0.01, U(ua + GIRON) - 0.01, va + 0.03, vb - 0.03, top - 0.05, top, 'grille', false);
        if (versE) garde(R, U(ua), U(ua + GIRON), vRail, vRail + 0.06, top);
      }
      // limons (côtés de la volée)
      const debut = versE ? PALIER : PALIER + run;
      const fin = versE ? PALIER + run : PALIER;
      for (const v of [va + 0.03, vb - 0.03]) {
        barre(R, [U(debut), v, base - 0.12], [U(fin), v, base + K * r - 0.12], 0.07, 'metal');
      }
      // main courante côté rue, sur les volées extérieures
      if (versE) {
        barre(R, [U(debut), vRail + 0.03, base + RAMPE], [U(fin), vRail + 0.03, base + K * r + RAMPE], 0.05, 'metal');
        barre(R, [U(debut), vRail + 0.03, base + RAMPE - 0.06], [U(fin), vRail + 0.03, base + K * r + RAMPE - 0.06], 0.018, 'neon');
        for (const uu of [debut + 0.9, debut + run / 2 + 0.4]) {
          const t = (uu - debut) / run;
          barre(R, [U(uu), vRail + 0.03, base + t * K * r], [U(uu), vRail + 0.03, base + t * K * r + RAMPE], 0.04, 'metal');
        }
      }
      // palier d'arrivée
      const top = base + K * r;
      const [pa, pb] = versE ? [PALIER + run, L] : [0, PALIER];
      boite(R, U(pa), U(pb), vIn[0], vOut[1], top - EPAIS, top, null);
      boite(R, U(pa), U(pb), vIn[0], vOut[1], top - 0.12, top, 'grille', false);
      garde(R, U(pa), U(pb), vRail, vRail + 0.06, top); // côté rue
      const [ea, eb] = versE ? [L, L + 0.06] : [-0.06, 0];
      garde(R, U(ea), U(eb), vIn[0], vRail + 0.06, top); // bout du palier
      // garde-corps visuel du palier : montants, lisses, liseré
      const coin = versE ? L + 0.03 : -0.03;
      barre(R, [U(pa), vRail + 0.03, top + RAMPE], [U(pb), vRail + 0.03, top + RAMPE], 0.05, 'metal');
      barre(R, [U(coin), vIn[0], top + RAMPE], [U(coin), vRail + 0.03, top + RAMPE], 0.05, 'metal');
      barre(R, [U(pa), vRail + 0.03, top + 0.5], [U(pb), vRail + 0.03, top + 0.5], 0.03, 'metal');
      barre(R, [U(coin), vIn[0], top + 0.5], [U(coin), vRail + 0.03, top + 0.5], 0.03, 'metal');
      for (const [uu, vv] of [[coin, vRail + 0.03], [coin, vIn[0] + 0.05], [versE ? pa : pb, vRail + 0.03]]) {
        barre(R, [U(uu), vv, top - 0.12], [U(uu), vv, top + RAMPE], 0.05, 'metal');
      }
      // liseré néon sous le nez du palier, côté rue
      const dernier = f === F - 1;
      barre(R, [U(pa), vRail - 0.02, top - 0.14], [U(pb), vRail - 0.02, top - 0.14], 0.03, dernier ? 'neonBleu' : 'neon');
      // console sous le palier (accroche au mur)
      barre(R, [U((pa + pb) / 2), 0.02, top - 0.9], [U((pa + pb) / 2), vRail, top - 0.13], 0.06, 'metal');
    }
    // repère au pied : une barre lumineuse verticale à l'entrée
    barre(R, [U(PALIER - 0.15), vRail + 0.03, TROTTOIR], [U(PALIER - 0.15), vRail + 0.03, TROTTOIR + 2.2], 0.05, 'neonBleu');
    garde(R, U(PALIER - 0.2), U(PALIER - 0.14), vRail - 0.02, vRail + 0.06, TROTTOIR);

    // Enseignes qui traverseraient l'escalier : retirées.
    const [ex0, ez0] = monde(R, U(-1.5), -0.5);
    const [ex1, ez1] = monde(R, U(L + 1.5), 2 * VOIE + 1.5);
    if (enseignes) {
      for (const m of [...enseignes.children]) {
        const p = m.position;
        if (p.x > Math.min(ex0, ex1) && p.x < Math.max(ex0, ex1) && p.z > Math.min(ez0, ez1) && p.z < Math.max(ez0, ez1) && p.y < H + 3) {
          enseignes.remove(m);
        }
      }
    }

    const yawMontee = Math.atan2(-R.tx, -R.tz); // regard le long de la première volée
    const [px, pz] = monde(R, U(PALIER - 0.9), (vOut[0] + vOut[1]) / 2);
    const finE = (F - 1) % 2 === 0;
    const [sx, sz] = monde(R, U(finE ? PALIER + run + PALIER / 2 : PALIER / 2), VOIE);
    const esc = {
      nom: def.nom,
      pied: [+px.toFixed(2), TROTTOIR, +pz.toFixed(2)], // sur le trottoir, devant la première marche
      yawMontee: +yawMontee.toFixed(4),
      sommet: [+sx.toFixed(2), +H.toFixed(2), +sz.toFixed(2)], // centre du dernier palier, au niveau du toit
      hauteurMarche: +r.toFixed(4),
      marches: F * K,
      immeuble: b,
      toits: [{ x: b.x, z: b.z, w: b.w, d: b.d, h: b.h }],
    };

    if (def.chaine) chaine(esc, b);
    resultat.push(esc);
  }

  // C : marches entre deux toits voisins, puis escalier de toit vers l'étage technique.
  function chaine(esc, haut) {
    const bas = immeubles.find((o) => o !== haut && o.bloc[0] === haut.bloc[0] && o.bloc[1] === haut.bloc[1] && Math.abs(o.h - haut.h) < 1.4);
    if (!bas) return;
    esc.toits.push({ x: bas.x, z: bas.z, w: bas.w, d: bas.d, h: bas.h });
    // limite commune (les deux lots se touchent en x)
    const xLim = bas.x < haut.x ? bas.x + bas.w / 2 : bas.x - bas.w / 2;
    const s = bas.x < haut.x ? -1 : 1; // vers le lot bas
    const dh = haut.h - bas.h;
    const n = Math.ceil(dh / HAUTEUR_MAX) - 1; // marches intermédiaires
    const z0 = bas.z - 3, z1 = bas.z + 0.5;
    const R = { cx: xLim, cz: 0, tx: s, tz: 0, nx: 0, nz: 1, long: 0 };
    for (let i = 0; i < n; i++) {
      const top = haut.h - (dh * (i + 1)) / (n + 1);
      const ua = i * 0.34, ub = (i + 1) * 0.34;
      boite(R, ua, ub, z0, z1, bas.h, top, 'metal');
      boite(R, ua + 0.02, ub, z0 + 0.02, z1 - 0.02, top, top + 0.015, 'grille', false);
      barre(R, [ub - 0.02, z0 + 0.05, top + 0.005], [ub - 0.02, z1 - 0.05, top + 0.005], 0.025, 'neon');
    }
    // escalier de toit jusqu'à l'étage technique du lot bas (ou du lot haut)
    const e = bas.etage || haut.etage;
    const socle = bas.etage ? bas.h : haut.h;
    if (!e) return;
    const dE = e.h1 - socle;
    const S = Math.ceil(dE / HAUTEUR_MAX);
    const rE = dE / S;
    // le long de la face de l'étage tournée vers la limite commune
    const faceX = s > 0 ? e.x - e.w / 2 : e.x + e.w / 2; // côté du lot haut
    const RE = { cx: faceX, cz: e.z + e.d / 2 - 1, tx: 0, tz: -1, nx: -s, nz: 0, long: e.d };
    const largeur = 1.4;
    for (let j = 1; j <= S; j++) {
      const top = socle + j * rE;
      const ua = (j - 1) * GIRON, ub = j * GIRON;
      boite(RE, ua, ub, 0.02, largeur, Math.max(socle, top - EPAIS), top, null);
      boite(RE, ua + 0.01, ub - 0.01, 0.05, largeur - 0.03, top - 0.05, top, 'grille', false);
      boite(RE, ua, ub, largeur, largeur + 0.06, top, top + RAMPE, null); // garde-corps
    }
    const fin = S * GIRON;
    boite(RE, fin, fin + 0.06, 0.02, largeur + 0.06, e.h1, e.h1 + RAMPE, null); // bout, en haut
    for (const v of [0.05, largeur - 0.03]) barre(RE, [0, v, socle - 0.05], [fin, v, e.h1 - 0.1], 0.07, 'metal');
    barre(RE, [0, largeur + 0.03, socle + RAMPE], [fin, largeur + 0.03, e.h1 + RAMPE], 0.05, 'metal');
    barre(RE, [0, largeur + 0.03, socle + RAMPE - 0.06], [fin, largeur + 0.03, e.h1 + RAMPE - 0.06], 0.018, 'neon');
    for (let k = 0; k <= 4; k++) {
      const uu = (fin * k) / 4;
      const y = socle + (dE * k) / 4;
      barre(RE, [uu, largeur + 0.03, Math.max(socle, y - 0.1)], [uu, largeur + 0.03, y + RAMPE], 0.04, 'metal');
    }
    esc.toits.push({ x: e.x, z: e.z, w: e.w, d: e.d, h: e.h1, etage: true });
    const [qx, qz] = monde(RE, -0.9, largeur / 2);
    esc.escalierToit = { pied: [+qx.toFixed(2), +socle.toFixed(2), +qz.toFixed(2)], yawMontee: Math.atan2(-RE.tx, -RE.tz), sommet: e.h1 };
    const [mx, mz] = monde(R, n * 0.34 + 0.8, (z0 + z1) / 2);
    esc.marchesToits = { bas: [+mx.toFixed(2), +bas.h.toFixed(2), +mz.toFixed(2)], yawMontee: Math.atan2(s, 0) };
  }

  // Matériaux : métal sombre, caillebotis un peu plus clair, liserés néon.
  const mats = {
    metal: new THREE.MeshStandardMaterial({ color: 0x17121f, roughness: 0.42, metalness: 0.85 }),
    grille: new THREE.MeshStandardMaterial({ color: 0x2a2238, roughness: 0.6, metalness: 0.7 }),
    neon: new THREE.MeshBasicMaterial({ color: 0xc23aa8, toneMapped: false }),
    neonBleu: new THREE.MeshBasicMaterial({ color: 0x4a7dff, toneMapped: false }),
  };
  const groupe = new THREE.Group();
  groupe.name = 'escaliers';
  for (const [k, liste] of Object.entries(geos)) {
    if (!liste.length) continue;
    groupe.add(new THREE.Mesh(mergeGeometries(liste), mats[k]));
  }
  scene.add(groupe);
  return resultat;
}
