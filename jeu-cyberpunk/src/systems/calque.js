import * as THREE from 'three';
import { jeu } from '../game.js';
import { BLOCKS, PITCH } from '../city.js';
import { TITRES_ZONES } from '../data/interface.js';
import { boite, materiauSceau, respirer } from '../zones/decor.js';
import * as D from '../data/calque.js';

// Système « calque » (bible §4.1) : touche C, étiquettes de texte sur ce qui a une ligne.
//
// Choix de rendu : les étiquettes sont des éléments DOM projetés (camera.project à chaque image,
// seulement pour les ≤ 16 étiquettes proches), pas des sprites de la scène. Le rendu final passe
// en basse résolution pixelisée puis bloom/film : un sprite serait flou et mangé par la passe
// finale. Le DOM reste net, pixel de l'écran, quelle que soit la finesse (touche P). On perd
// l'occlusion par la géométrie : le nombre d'étiquettes est plafonné par catégorie et par distance.
//
// API pour les autres systèmes (habitants, robots, fragments…) :
//   import { calque } from './calque.js'   (ou jeu.calque)
//   const e = calque.etiqueter({ position, lignes: ['Glaneur 0081', 'fonction : tri'], sansLigne?, zone?, brille?, souligne?, rayon? });
//   e.retirer();  e.position (Vector3, modifiable en place) ;  e.lignes = [...]; e.maj();
//   calque.actif, calque.possede(), calque.basculer(), calque.compte (étiquettes visibles)
//
// Objets interactifs (jeu.interact.ajouter) : le Calque en fait une étiquette « objet ». Champs facultatifs
// de l'objet qui la règlent : `lignes: [titre, …]` (texte propre, sinon « Objet XX — Usage : … » généré),
// `sansLigne` (étiquette ambre), `decalageEtiquette` (m au-dessus de `position`), `sansEtiquette: true`
// (le Calque ignore l'objet : il a déjà une étiquette à lui, évite les doublons).

const RAYON = 25; // m
const RAYON_PLEIN = 14; // pleine opacité en deçà, dégradé jusqu'à RAYON
const MAX_DOM = 16;
const PERIODE_TRI = 0.15; // s
const DECALAGE_Y = 0.45; // m au-dessus du point de l'objet
const QUOTAS = { externe: 10, porte: 4, objet: 6, ancre: 8, facade: 5, lampe: 4 };

// ---------- Utilitaires ----------
function graine(...parts) {
  let h = 2166136261;
  for (const c of parts.join('|')) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
function aleatoire(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const choisir = (r, liste) => liste[Math.floor(r() * liste.length)];
const remplir = (gabarit, champs) => gabarit.replace(/\{(\w+)\}/g, (_, k) => champs[k] ?? '');
const codeDe = (r) => `${1 + Math.floor(r() * 9)}${'ABCDEFGH'[Math.floor(r() * 8)]}-${1000 + Math.floor(r() * 9000)}`;
const versVec = (p) => (p instanceof THREE.Vector3 ? p : Array.isArray(p) ? new THREE.Vector3(p[0], p[1], p[2]) : new THREE.Vector3(p.x, p.y, p.z));

// ---------- État du module ----------
const externes = new Set(); // étiquettes déclarées par d'autres systèmes
const parZone = new Map(); // nom de zone → { ancres, lampes, facades, nbColliders }
const entreesObjets = new WeakMap(); // objet interactif → étiquette
const cand = []; // candidats retenus à chaque tri (réutilisé)
const actifs = []; // étiquettes ayant un élément DOM
const libres = []; // éléments DOM libres
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const compteurs = {};

let racine = null, voile = null, couche = null, indic = null, ligneJoueurEl = null;
let active = false;
let vis = 0; // 0..1, visibilité globale (lissée)
let accTri = 0, dt = 0.016, stamp = 0;
let borne = null; // { mat, obj }

const possede = () => jeu.etat?.pouvoirs?.includes('calque') === true;

// Le Calque n'existe pas avant la borne : on retire le pouvoir donné par l'état de départ de
// l'ancien prototype (state.js) tant que la borne n'a pas été touchée dans cette partie.
function neutraliser() {
  const e = jeu.etat;
  if (!e || e.calqueObtenu) return;
  const i = e.pouvoirs.indexOf('calque');
  if (i >= 0) e.pouvoirs.splice(i, 1);
}

// ---------- DOM ----------
const CSS = `
.cq-voile { position: fixed; inset: 0; z-index: 47; pointer-events: none; opacity: 0; transition: opacity 0.6s ease;
  background:
    radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 45%, rgba(8,50,72,0.5) 100%),
    repeating-linear-gradient(0deg, rgba(110,240,255,0) 0 3px, rgba(110,240,255,0.045) 3px 4px),
    repeating-linear-gradient(90deg, rgba(110,240,255,0) 0 63px, rgba(110,240,255,0.05) 63px 64px),
    rgba(40,170,200,0.09); }
.cq-voile.on { opacity: 1; }
.cq-voile::after { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 18%;
  background: linear-gradient(180deg, rgba(110,240,255,0), rgba(110,240,255,0.07), rgba(110,240,255,0));
  animation: cq-balayage 7s linear infinite; }
@keyframes cq-balayage { from { transform: translateY(-120%); } to { transform: translateY(620%); } }
.cq-couche { position: fixed; inset: 0; z-index: 48; pointer-events: none; overflow: hidden; display: none;
  font-family: var(--ui-police, ui-monospace, Menlo, Consolas, monospace); -webkit-font-smoothing: none; }
.cq-et { position: absolute; left: 0; top: 0; display: none; opacity: 0; white-space: pre; will-change: transform, opacity;
  padding: 3px 7px 4px; font-size: 12px; line-height: 1.35; color: #d8f6ff; background: rgba(6,22,34,0.82);
  border-left: 2px solid #5ef2ff; box-shadow: 2px 2px 0 rgba(2,8,16,0.7); }
.cq-et::after { content: ""; position: absolute; left: 50%; top: 100%; width: 1px; height: 9px; background: rgba(94,242,255,0.7); }
.cq-titre { font-weight: bold; color: #ffffff; letter-spacing: 0.02em; }
.cq-corps { color: #9fdcec; }
.cq-et.sans { background: rgba(34,20,4,0.86); border-left-color: #ffb13b; color: #ffd9a0; }
.cq-et.sans::after { background: rgba(255,177,59,0.75); }
.cq-et.sans .cq-titre { color: #ffe2b0; }
.cq-et.sans .cq-corps { color: #ffb95a; }
.cq-et.souligne .cq-titre { text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 3px; text-decoration-color: #5ef2ff; }
.cq-et.brille { box-shadow: 0 0 10px rgba(255,236,150,0.65), 2px 2px 0 rgba(2,8,16,0.7); border-left-color: #fff2a8; }
.cq-indic { position: fixed; left: 16px; bottom: 14px; z-index: 48; pointer-events: none; opacity: 0; transition: opacity 0.6s ease;
  font-family: var(--ui-police, ui-monospace, Menlo, Consolas, monospace); font-size: 11px; line-height: 1.4; color: #7fd6e8;
  text-shadow: 0 0 6px rgba(94,242,255,0.4); letter-spacing: 0.06em; }
.cq-indic.on { opacity: 0.75; }
.cq-indic b { color: #c6f4ff; font-weight: normal; letter-spacing: 0.18em; }
`;

function creerDom() {
  const st = document.createElement('style');
  st.textContent = CSS;
  document.head.appendChild(st);
  voile = document.createElement('div');
  voile.className = 'cq-voile';
  couche = document.createElement('div');
  couche.className = 'cq-couche';
  indic = document.createElement('div');
  indic.className = 'cq-indic';
  const [l1, l2] = D.CALQUE.ligneJoueur;
  indic.innerHTML = `<b></b><br><span></span><br><span></span>`;
  indic.children[0].textContent = D.CALQUE.indicateur;
  indic.children[2].textContent = l1;
  indic.children[4].textContent = l2;
  ligneJoueurEl = indic;
  document.body.append(voile, couche, indic);
  for (let i = 0; i < MAX_DOM; i++) {
    const el = document.createElement('div');
    el.className = 'cq-et';
    el.appendChild(document.createElement('div')).className = 'cq-titre';
    el.appendChild(document.createElement('div')).className = 'cq-corps';
    couche.appendChild(el);
    libres.push(el);
  }
}

function lierTexte(e, el) {
  const l = e.lignes || [];
  el.children[0].textContent = l[0] ?? '';
  el.children[1].textContent = l.slice(1).join('\n');
  el.children[1].style.display = l.length > 1 ? '' : 'none';
  el.classList.toggle('sans', !!e.sansLigne);
  el.classList.toggle('souligne', !!e.souligne);
  el.classList.toggle('brille', !!e.brille);
  el._lignes = e.lignes;
  el._ver = e.ver;
}

// ---------- Étiquettes ----------
function nouvelleEntree(def) {
  return Object.assign(
    { kind: 'externe', position: new THREE.Vector3(), lignes: null, sansLigne: false, souligne: false, brille: false,
      zone: null, rayon: RAYON, generer: null, el: null, a: 0, cible: 0, d: 0, ver: 0, decalage: DECALAGE_Y,
      retirer() { externes.delete(this); this.cible = 0; this.retiree = true; },
      maj() { this.ver++; } },
    def
  );
}

function etiqueter({ position, lignes, sansLigne = false, zone = null, souligne = false, brille = false, rayon = RAYON } = {}) {
  const e = nouvelleEntree({
    kind: 'externe', zone, sansLigne, souligne, brille, rayon,
    lignes: Array.isArray(lignes) ? lignes : [String(lignes ?? '')],
  });
  e.position = versVec(position);
  externes.add(e);
  return e;
}

// lignes générées par graine, selon le genre ; mises en cache dans l'étiquette
function genererLignes(e) {
  const r = aleatoire(graine(e.zone ?? '', e.kind, Math.round(e.cle?.[0] ?? e.position.x * 2), Math.round(e.cle?.[1] ?? e.position.z * 2), Math.round(e.position.y)));
  const code = codeDe(r);
  const nom = `${choisir(r, D.PRENOMS)} ${choisir(r, D.NOMS)}`;
  const champs = { code, nom, prenom: choisir(r, D.PRENOMS), horaire: choisir(r, D.HORAIRES) };
  if (e.kind === 'porte') {
    const vers = TITRES_ZONES[e.objet?.porte?.vers]?.titre;
    const usage = e.souligne ? D.CALQUE.porteUsageJoueur : remplir(choisir(r, D.PORTES_USAGE), champs);
    return [`Porte ${code}`, ...(vers ? [remplir(D.CALQUE.porteVers, { vers })] : []), usage];
  }
  if (e.kind === 'objet') {
    let libelle = e.objet?.libelle;
    try { if (typeof libelle === 'function') libelle = libelle(e.objet, jeu); } catch { libelle = ''; }
    return [remplir(D.OBJETS.titre, champs), ...D.OBJETS.lignes.map((l) => remplir(l, { ...champs, libelle: libelle || '—' }))];
  }
  if (e.kind === 'lampe') {
    return [remplir(D.LAMPADAIRE.titre, champs), ...D.LAMPADAIRE.lignes.map((l) => remplir(l, { ...champs, fonction: choisir(r, D.FONCTIONS_LAMPE) }))];
  }
  if (e.kind === 'facade') {
    if (r() < 0.55) {
      const c = { ...champs, commerce: choisir(r, D.COMMERCES), don: choisir(r, D.DONS) };
      return [remplir(D.VITRINE.titre, c), ...D.VITRINE.lignes.map((l) => remplir(l, c))];
    }
    const c = { ...champs, n: 12 + Math.floor(r() * 90), gestion: choisir(r, D.GESTIONS) };
    return [remplir(D.IMMEUBLE.titre, c), ...D.IMMEUBLE.lignes.map((l) => remplir(l, c))];
  }
  return [code];
}

// ---------- Candidats propres à une zone (construits une fois) ----------
function candidatsDe(nom, zone) {
  let c = parZone.get(nom);
  if (!c) {
    c = { ancres: [], lampes: [], facades: [], nbColliders: -1 };
    parZone.set(nom, c);
    if (zone.ancres) {
      for (const [cle, pos] of Object.entries(zone.ancres)) {
        const def = D.ETIQUETTES_CLINIQUE[cle];
        if (!def || cle === 'anneau' || cle === 'borne') continue; // ceux-là ont un objet interactif
        const e = nouvelleEntree({ kind: 'ancre', zone: nom, cle, lignes: def.lignes, sansLigne: !!def.sansLigne });
        e.position.copy(pos);
        c.ancres.push(e);
      }
    }
    if (zone.city) {
      const centre = (i) => (i - (BLOCKS - 1) / 2) * PITCH;
      for (let i = 0; i < BLOCKS; i++)
        for (let j = 0; j < BLOCKS; j++)
          for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
            const e = nouvelleEntree({ kind: 'lampe', zone: nom, decalage: 0.7 });
            e.position.set(centre(i) + sx * 20.6, 6.4, centre(j) + sz * 20.6);
            c.lampes.push(e);
          }
    }
  }
  if (zone.city && c.nbColliders !== zone.colliders.length) {
    c.nbColliders = zone.colliders.length;
    c.facades.length = 0;
    for (const r of zone.colliders) {
      if (r.maxX - r.minX < 6 || r.maxZ - r.minZ < 6) continue;
      const e = nouvelleEntree({ kind: 'facade', zone: nom, rect: r, decalage: 0.3 });
      e.cle = [(r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2];
      c.facades.push(e);
    }
  }
  return c;
}

// point de la façade le plus proche de (px, pz), à hauteur d'étiquette ; renvoie la distance 3D
function pointFacade(e, px, py, pz) {
  const r = e.rect;
  const x = Math.min(r.maxX, Math.max(r.minX, px));
  const z = Math.min(r.maxZ, Math.max(r.minZ, pz));
  e.position.set(x, 2.6, z);
  const dx = x - px, dz = z - pz, dy = 2.6 - py;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function distanceA(e, px, py, pz) {
  const dx = e.position.x - px, dy = e.position.y - py, dz = e.position.z - pz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// ---------- Tri : quelles étiquettes méritent un élément DOM ----------
function trier() {
  const nom = jeu.zones?.nom;
  const zone = jeu.zones?.courante;
  if (!nom || !zone) return;
  stamp++;
  jeu.camera.getWorldPosition(tmp);
  const px = tmp.x, py = tmp.y, pz = tmp.z;
  cand.length = 0;
  const cs = candidatsDe(nom, zone);

  const ajouter = (e, d) => {
    e.d = d;
    cand.push(e);
  };

  for (const e of externes) {
    if (e.zone && e.zone !== nom) continue;
    const d = distanceA(e, px, py, pz);
    if (d <= e.rayon) ajouter(e, d);
  }
  // objets interactifs de la zone (portes comprises)
  for (const o of jeu.interact.liste(nom)) {
    // `sansEtiquette` : l'objet a déjà son étiquette (ou n'en veut pas) : le Calque l'ignore.
    if (o.sansEtiquette) continue;
    let e = entreesObjets.get(o);
    if (!e) {
      e = nouvelleEntree({ kind: o.porte ? 'porte' : 'objet', zone: nom, objet: o });
      e.position = o.position;
      entreesObjets.set(o, e);
    }
    const visible = typeof o.visible === 'function' ? o.visible(o, jeu) !== false : o.visible !== false;
    if (!visible) continue;
    if (zone.ancres) {
      for (const [cle, def] of Object.entries(D.ETIQUETTES_CLINIQUE)) {
        const a = zone.ancres[cle];
        if (a && a.distanceToSquared(o.position) < 1.7) {
          e.lignes = def.lignes;
          e.sansLigne = !!def.sansLigne;
          for (const s of cs.ancres) if (s.cle === cle) s.couvert = stamp;
        }
      }
    }
    if (o === borne?.obj) {
      e.lignes = D.ETIQUETTES_CLINIQUE.borneCalque.lignes;
      e.decalage = 0.4;
    }
    // `lignes` : l'objet fournit son propre texte (personnages, Kiosque…), au lieu d'« Objet XX — Usage : … »
    if (Array.isArray(o.lignes)) {
      e.lignes = o.lignes;
      e.sansLigne = !!o.sansLigne;
    }
    if (typeof o.decalageEtiquette === 'number') e.decalage = o.decalageEtiquette;
    e.souligne = !!o.porte;
    const d = distanceA(e, px, py, pz);
    if (d <= RAYON) ajouter(e, d);
  }
  for (const e of cs.ancres) {
    if (e.couvert === stamp) continue;
    const d = distanceA(e, px, py, pz);
    if (d <= RAYON) ajouter(e, d);
  }
  for (const e of cs.lampes) {
    const dx = e.position.x - px, dz = e.position.z - pz;
    if (dx > RAYON || dx < -RAYON || dz > RAYON || dz < -RAYON) continue;
    const d = distanceA(e, px, py, pz);
    if (d <= RAYON) ajouter(e, d);
  }
  for (const e of cs.facades) {
    const r = e.rect;
    if (px > r.minX && px < r.maxX && pz > r.minZ && pz < r.maxZ) continue;
    const d = pointFacade(e, px, py, pz);
    if (d <= RAYON) ajouter(e, d);
  }

  cand.sort(parDistance);
  for (const k in QUOTAS) compteurs[k] = 0;
  let pris = 0;
  for (const e of actifs) e.retenue = false;
  for (let i = 0; i < cand.length && pris < MAX_DOM; i++) {
    const e = cand[i];
    if (compteurs[e.kind] >= QUOTAS[e.kind]) continue;
    // deux façades voisines (ou colliders superposés) : une seule étiquette
    if (e.kind === 'facade' && facadeProche(e, i)) continue;
    compteurs[e.kind]++;
    pris++;
    e.retenue = true;
    e.cible = 1;
    if (!e.el) {
      const el = libres.pop();
      if (!el) { e.retenue = false; e.cible = 0; continue; }
      e.el = el;
      if (!e.lignes && !e.generer) e.lignes = genererLignes(e);
      lierTexte(e, el);
      el.style.display = 'block';
      actifs.push(e);
    }
  }
  for (const e of actifs) if (!e.retenue) e.cible = 0;
}
const parDistance = (a, b) => a.d - b.d;
function facadeProche(e, jusqua) {
  for (let i = 0; i < jusqua; i++) {
    const o = cand[i];
    if (o.kind !== 'facade' || !o.retenue) continue;
    const dx = o.position.x - e.position.x, dz = o.position.z - e.position.z;
    if (dx * dx + dz * dz < 144) return true;
  }
  return false;
}

// ---------- Système ----------
export const calque = {
  nom: 'calque',

  possede,
  get actif() { return active; },
  /** Nombre d'étiquettes actuellement visibles à l'écran. */
  get compte() { let n = 0; for (const e of actifs) if (e.a > 0.05) n++; return n; },
  etiqueter,

  /** Active ou coupe le Calque (sans effet tant que le pouvoir manque). */
  basculer(etat = !active) {
    if (etat && !possede()) return false;
    active = !!etat;
    voile?.classList.toggle('on', active);
    indic?.classList.toggle('on', active);
    if (active) { accTri = PERIODE_TRI; couche.style.display = 'block'; }
    return active;
  },

  init() {
    creerDom();
    jeu.calque = calque;
    neutraliser();
    jeu.on('partie:debut', neutraliser);
    jeu.on('partie:nouvelle', () => { neutraliser(); calque.basculer(false); });
    jeu.on('zone:sortie', () => { accTri = PERIODE_TRI; });
    jeu.on('zone:entree', () => { accTri = PERIODE_TRI; });

    // la borne de la porte (Clinique) : où l'on obtient le Calque
    borne = {
      mat: null,
      obj: jeu.interact.ajouter({
        zone: 'clinique',
        position: [6.9, 1.3, 1.3],
        rayon: 1.9,
        cone: 0.7,
        libelle: D.CALQUE.libelleBorne,
        visible: () => !possede(),
        action: async () => {
          await jeu.ouvrirDialogue(D.DIALOGUE_BORNE_CALQUE);
          if (possede()) {
            jeu.etat.calqueObtenu = true;
            jeu.sauver();
            jeu.hud.notifier(D.CALQUE.notification);
            jeu.hud.mima(D.CALQUE.mimaApres, { duree: 8 });
          }
        },
      }),
    };
  },

  surZone(nom, zone) {
    if (nom === 'clinique' && !borne.mat) {
      // panneau mural à côté de la porte : métal sombre et sceau de Mima
      const metal = new THREE.MeshStandardMaterial({ color: 0x2a2440, roughness: 0.4, metalness: 0.7 });
      boite(zone.scene, 0.08, 0.55, 0.42, metal, 6.96, 1.3, 1.3);
      const mat = materiauSceau('#5ef2ff');
      const plaque = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), mat);
      plaque.position.set(6.914, 1.32, 1.3);
      plaque.rotation.y = -Math.PI / 2;
      zone.scene.add(plaque);
      borne.mat = mat;
    }
  },

  update(d, t) {
    dt = d;
    if (borne?.mat) respirer(borne.mat, t, possede() ? 0.5 : 1.8);

    if (jeu.jouable && jeu.input.pressed('KeyC') && possede() && !jeu.silence?.muette) calque.basculer(); // fin 5 : plus de lignes
    if (active && jeu.silence?.muette) calque.basculer(false);
    if (active && !possede()) calque.basculer(false); // nouvelle partie, état rechargé

    const montre = active && jeu.enPartie && !jeu.suspensions.has('dialogue') && !jeu.suspensions.has('frise') && !jeu.suspensions.has('ouverture');
    vis += ((montre ? 1 : 0) - vis) * Math.min(1, dt * 5);

    if (active) {
      accTri += dt;
      if (accTri >= PERIODE_TRI) {
        accTri = 0;
        trier();
      }
    } else if (actifs.length) {
      for (const e of actifs) e.cible = 0;
    }

    // apparition douce, disparition, libération des éléments
    const k = Math.min(1, dt * 6);
    for (let i = actifs.length - 1; i >= 0; i--) {
      const e = actifs[i];
      let cible = e.cible * vis;
      if (e.cible) {
        const r = e.rayon || RAYON;
        const f = e.d <= RAYON_PLEIN ? 1 : Math.max(0, (r - e.d) / (r - RAYON_PLEIN));
        cible *= f * f * (3 - 2 * f);
      }
      e.a += (cible - e.a) * k;
      if (e.el && (e.el._lignes !== e.lignes || e.el._ver !== e.ver)) lierTexte(e, e.el);
      if (e.cible === 0 && e.a < 0.02) {
        e.a = 0;
        e.el.style.display = 'none';
        e.el.style.opacity = '0';
        libres.push(e.el);
        e.el = null;
        actifs[i] = actifs[actifs.length - 1];
        actifs.pop();
      }
    }
    if (!active && !actifs.length && couche && vis < 0.02) couche.style.display = 'none';
  },

  // projection après le rendu : la matrice de la caméra est celle de l'image affichée
  apresRendu() {
    if (!actifs.length) return;
    const cam = jeu.camera;
    const w = innerWidth, h = innerHeight;
    cam.getWorldPosition(tmp2);
    for (const e of actifs) {
      const el = e.el;
      if (e.kind === 'facade') e.d = pointFacade(e, tmp2.x, tmp2.y, tmp2.z);
      tmp.copy(e.position);
      tmp.y += e.decalage;
      tmp.project(cam);
      if (tmp.z > 1 || tmp.z < -1 || Math.abs(tmp.x) > 1.15 || Math.abs(tmp.y) > 1.15) {
        el.style.opacity = '0';
        continue;
      }
      const x = Math.round((tmp.x * 0.5 + 0.5) * w);
      const y = Math.round((-tmp.y * 0.5 + 0.5) * h);
      const s = 1 - 0.18 * Math.min(1, e.d / RAYON);
      el.style.transform = `translate(${x}px, ${y - 10}px) translate(-50%, -100%) scale(${s.toFixed(2)})`;
      el.style.opacity = e.a.toFixed(2);
      el.style.zIndex = String(1000 - Math.round(e.d * 20));
    }
  },
};
