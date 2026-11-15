import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { marche } from './marche.js';
import { calque } from './calque.js';
import { CONSEILS } from '../data/conseils.js';
import { OCCUPANTS, DESTINATAIRES, OBJETS, T1, T2, T3, T4, T5, T7, T13 } from '../data/transgressions.js';

// Système « transgressions » (tâche 3.2, bible §7.1 à §7.4) : les transgressions de rue.
//
// Le système ne punit jamais : il répond. Ici : T1 (portes de service), T2 (prendre sans ligne),
// T3 (réponses de Mima au Glaneur renversé), T4 (fumer là où c'est déplacé), T5 (hauteur),
// T7 (refus de conseils : 5 et 15), T13 (quitter la ville). T6 existe dans veilleur.js.
//
// CONTRAT avec l'Attention (src/systems/attention.js) : à chaque transgression ce système
// incrémente `etat.transgressions[id]` UNE fois, puis émet `transgression { id, source, detail, n }`.
// Il ne touche jamais à `etat.attention`. Il lit `jeu.attention?.palier` (repli 0) :
// palier 0 = Mima ne commente que les deux premières réponses de la bible ; dès le palier 1 elle
// commente chaque occurrence (remarques sobres de data/transgressions.js).
//
// API (aussi sur jeu.transgressions) :
//   journal                 tableau { id, quoi, ou, t, … } (dans etat.journal, sauvegardé)
//                           id : 'T1' | 'T2' ; quoi : 'porte' | 'bol' | 'bouquet' | 'vetement' ;
//                           ou : identifiant de la porte ('porte-3') ou de l'objet ('etal-5', 'rue-2') ;
//                           t : jeu.t ; mode : 'force' | 'auto' | 'main' | 'recu' ; x, z : position.
//   portes                  les douze portes de service { i, id, x, z, nx, nz, ouverte, … }
//   objets                  les objets prenables { id, type, pour, pris, reserve, … }
//   forcer(i), prendre(id)  gestes directs (tests)
//   forcage                 { porte, t } pendant qu'on force (sinon null)
// Évènements émis : `transgression` (T1, T2, T4, T5, T13), `transgression:refus { n, seuil }` (T7),
//   `ville:sortie { n, source }` et `ville:retour` (T13).
// État : `etat.drapeaux` reçoit 'reserve:<id>' (objet mis de côté au nom de R-4, T2 2e),
//   'sceau-recoit-beaucoup' (T2 3e : texte T2.sceau à lire par le Sceau), 'T7:5', 'T7:15' ;
//   `etat.conseilsDits` reçoit tous les conseils à 15 refus (conseils.js se tait).

const ZONE = 'kasumi';
const TROTTOIR = 0.3;
const DUREE_FORCAGE = 3; // s, E maintenu
const LIMITE_VILLE = 283; // |x| ou |z| au-delà duquel on quitte la ville (bornes de la zone : 290)
const TUNNEL = { x: 30, z0: 272, z1: 292 };

// Portes de service : [x, z, nx, nz] (point sur la façade, normale vers la rue), près du départ (carrefour
// (30, 30), clinique en (41, 44)), du Marché des Mains (z = 30, x 45 à 140) et des escaliers de secours.
const PORTES_DEF = [
  [41, 56, -1, 0], // façade ouest du pâté de la clinique, à 12 m de sa porte
  [41, 68, -1, 0],
  [19, 52, 1, 0], // face est du pâté (4, 5), sur la rue x = 30
  [19, 70, 1, 0],
  [5, 41, 0, -1], // face nord du pâté (4, 5), près de l'escalier « carrefour-ouest »
  [41, 8, -1, 0], // pâté (5, 4), au nord de l'entrée ouest du marché
  [79, 6, 1, 0], // même pâté, face est (rue de la place)
  [101, 10, -1, 0], // pâté (6, 4), face à la place du marché
  [79, 70, 1, 0], // pâté (5, 5), au sud de l'escalier « clinique-nord-est »
  [101, 55, -1, 0], // pâté (6, 5), au sud du marché
  [-6, 101, 0, -1], // pâté (4, 6), près de l'escalier « toits-sud »
  [41, -8, -1, 0],
];

// Emplacement de l'objet prenable sur un étal : [u, y (sur le comptoir, dessus du trottoir = 0), v]
const PLACEMENT_ETAL = {
  nouilles: ['bol', -0.7, 2.4],
  soupe: ['bol', 0.5, 2.4],
  fleurs: ['bouquet', -0.31, 1.85],
  reprise: ['vetement', -0.4, 2.3],
};
const SURFACE_COMPTOIR = 0.97;
const TYPES_RUE = ['bol', 'bouquet', 'vetement', 'bol', 'bouquet'];
const PORTES_RUE = [0, 2, 5, 7, 9]; // objets laissés devant ces portes

const COULEURS_OBJET = { bol: [0xff5ad0, 0xff2bd6, 0xffa0e8], bouquet: [0xc44bff, 0x8a5cff, 0xff5ad0], vetement: [0x4a7dff, 0x8a5cff, 0x3a62d0] };

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------
let J = null; // jeu
const tmpO = new THREE.Object3D();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
const remplir = (gabarit, champs) => gabarit.replace(/\{(\w+)\}/g, (_, k) => champs[k] ?? '');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const codeDe = (i, s = 0) => `${1 + ((i + s) % 9)}${'ABCDEFGH'[(i * 3 + s) % 8]}-${String(1000 + ((i + 1) * 7919 + s * 131) % 9000).padStart(4, '0')}`;

function journal() {
  const e = J.etat;
  if (!Array.isArray(e.journal)) e.journal = [];
  return e.journal;
}
function drapeaux() {
  const e = J.etat;
  if (!Array.isArray(e.drapeaux)) e.drapeaux = [];
  return e.drapeaux;
}
function poserDrapeau(d) {
  const l = drapeaux();
  if (!l.includes(d)) l.push(d);
}
const palier = () => Number(J.attention?.palier) || 0;
// 1re et 2e : toujours dites (ce sont les réponses de la bible). Au-delà : palier ≥ 1, sinon une fois sur trois.
const peutCommenter = (n) => n <= 2 || palier() >= 1 || n % 3 === 0;
const dire = (texte, duree = 7) => { if (texte) J.hud?.mima(texte, { duree }); };

/** Incrémente le compteur UNE fois, émet `transgression` UNE fois, renvoie le rang. */
function declencher(id, source, detail = {}) {
  const t = J.etat.transgressions;
  t[id] = (t[id] || 0) + 1;
  const n = t[id];
  J.sauver?.();
  J.emettre('transgression', { id, source, detail, n });
  return n;
}

function noter(entree) {
  journal().push({ ...entree, t: Math.round(J.t * 10) / 10 });
  J.sauver?.();
}

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------
function toile(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
function enTexture(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

// Ce qu'on devine derrière la porte : un petit local modeste, une lampe, une étagère, un manteau, une couverture.
function textureLocal() {
  const c = toile(128, 256);
  const g = c.getContext('2d');
  const fond = g.createLinearGradient(0, 0, 0, 256);
  fond.addColorStop(0, '#2c1654');
  fond.addColorStop(1, '#0e0722');
  g.fillStyle = fond;
  g.fillRect(0, 0, 128, 256);
  const lampe = g.createRadialGradient(64, 28, 2, 64, 28, 110);
  lampe.addColorStop(0, 'rgba(255,207,138,0.95)');
  lampe.addColorStop(0.35, 'rgba(255,170,90,0.4)');
  lampe.addColorStop(1, 'rgba(255,170,90,0)');
  g.fillStyle = lampe;
  g.fillRect(0, 0, 128, 256);
  g.fillStyle = '#fff1c8';
  g.fillRect(60, 24, 8, 8); // l'ampoule
  g.fillStyle = '#1a0e34';
  g.fillRect(0, 214, 128, 42); // sol
  g.fillStyle = '#3a2468';
  g.fillRect(0, 212, 128, 3);
  g.fillStyle = '#6a4aa8';
  g.fillRect(12, 124, 62, 5); // étagère
  g.fillStyle = '#c44bff';
  g.fillRect(16, 104, 12, 20);
  g.fillStyle = '#ff5ad0';
  g.fillRect(34, 110, 10, 14);
  g.fillStyle = '#4a7dff';
  g.fillRect(50, 100, 14, 24);
  g.fillStyle = '#8a3e92';
  g.fillRect(84, 94, 3, 6); // patère
  g.fillStyle = '#5e2a72';
  g.fillRect(80, 98, 28, 78); // manteau
  g.fillStyle = '#7a3a92';
  g.fillRect(80, 98, 6, 78);
  g.fillStyle = '#8a3e92';
  g.fillRect(14, 188, 54, 26); // couverture pliée
  g.fillStyle = '#c04a8a';
  g.fillRect(14, 188, 54, 4);
  g.fillStyle = '#d9cdf5';
  g.fillRect(92, 196, 10, 12); // une tasse
  return enTexture(c);
}

function texturePorte() {
  const c = toile(64, 128);
  const g = c.getContext('2d');
  g.fillStyle = '#150b2c';
  g.fillRect(0, 0, 64, 128);
  g.strokeStyle = '#3a2468';
  g.lineWidth = 3;
  g.strokeRect(4, 4, 56, 120);
  g.fillStyle = '#241346';
  for (let i = 0; i < 6; i++) g.fillRect(9, 10 + i * 18, 46, 3); // lamelles
  g.fillStyle = '#ff5ad0';
  g.fillRect(52, 58, 4, 22); // poignée-barre (côté opposé à la charnière)
  return enTexture(c);
}

function texturePancarte(lignes) {
  const c = toile(512, 128);
  const g = c.getContext('2d');
  g.fillStyle = '#0a0620';
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = '#c44bff';
  g.lineWidth = 6;
  g.strokeRect(6, 6, 500, 116);
  g.fillStyle = '#efe6ff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = '#ff2bd6';
  g.shadowBlur = 10;
  g.font = '700 23px ui-monospace, "DejaVu Sans Mono", monospace';
  g.fillText(lignes[0], 256, 44);
  g.font = '700 34px ui-monospace, "DejaVu Sans Mono", monospace';
  g.fillText(lignes[1], 256, 90);
  return enTexture(c);
}

function textureHalo() {
  const c = toile(128, 128);
  const g = c.getContext('2d');
  const d = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  d.addColorStop(0, 'rgba(255,255,255,1)');
  d.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  d.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  d.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = d;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

// ---------------------------------------------------------------------------
// Système
// ---------------------------------------------------------------------------
export const transgressions = {
  nom: 'transgressions',

  portes: [],
  objets: [],
  forcage: null, // { porte, t }
  tunnel: null,

  get journal() { return journal(); },

  // =====================================================================
  init(jeu) {
    J = jeu;
    jeu.transgressions = this;
    if (!jeu.marche) jeu.marche = marche;
    this.zone = jeu.zones.get(ZONE);
    this.cooldownAuto = 0;
    this.dernierRappel = -99;
    this.depart = null; // sortie de ville en cours
    this.cooldownVille = 0;
    this.t5Arme = true;
    this.cdAuto = 0;

    this.construirePortes();
    this.construireObjets();
    this.construireTunnel();
    this.construireVeilleurSous();
    this.construireBarreDom();
    this.restaurer();

    // ---- T3 : réponses graduées de Mima (le comptage vit dans robots.js) ----
    jeu.on('robot:renverse', (ev) => {
      const n = ev?.compte ?? jeu.etat.transgressions.T3 ?? 1;
      const texte = n === 1 ? T3.mima.premiere : n === 2 ? T3.mima.deuxieme : null;
      if (texte) dire(texte);
      else if (peutCommenter(n)) dire(T3.mima.suite[n % T3.mima.suite.length]);
    });

    // ---- T4 : fumer là où ce n'est pas d'usage ----
    jeu.on('cigarette:allumage', () => this.surAllumage());

    jeu.on('partie:nouvelle', () => {
      this.forcage = null;
      this.depart = null;
      this.t5Arme = true;
      this.restaurer();
    });
  },

  // ---------------------------------------------------------------------
  // Restauration à partir de l'état (journal, drapeaux)
  // ---------------------------------------------------------------------
  restaurer() {
    const jr = journal();
    for (const p of this.portes) {
      p.ouverte = jr.some((e) => e.quoi === 'porte' && e.ou === p.id);
      p.angle = p.ouverte ? -1.4 : 0;
      p.cible = p.angle;
      p.progres = 0;
      this.majPorte(p);
    }
    const dr = drapeaux();
    for (const o of this.objets) {
      o.pris = jr.some((e) => e.id === 'T2' && e.ou === o.id);
      o.reserve = !o.pris && dr.includes(`reserve:${o.id}`);
      this.majObjet(o);
    }
    this.mesBol.instanceMatrix.needsUpdate = true;
    this.mesBouquet.instanceMatrix.needsUpdate = true;
    this.mesVetement.instanceMatrix.needsUpdate = true;
    this.mesCadre.instanceMatrix.needsUpdate = true;
    if (this.mesCadre.instanceColor) this.mesCadre.instanceColor.needsUpdate = true;
    this.mesPanneau.instanceMatrix.needsUpdate = true;
    this.mesBarre.instanceMatrix.needsUpdate = true;
  },

  // =====================================================================
  // T1 — portes de service
  // =====================================================================
  construirePortes() {
    const scene = this.zone.scene;
    const n = PORTES_DEF.length;

    const mat = (c, extra = {}) => new THREE.MeshBasicMaterial({ color: c, toneMapped: false, ...extra });
    // Cadre : 4 barres par porte (montant gauche, montant droit, linteau, voyant), couleur par instance.
    this.mesCadre = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat(0xffffff), n * 4);
    // Panneau : pivot sur la charnière (bord gauche), il s'entrouvre vers la rue.
    const gp = new THREE.BoxGeometry(1.24, 2.3, 0.06);
    gp.translate(0.62, 1.15, 0);
    this.mesPanneau = new THREE.InstancedMesh(gp, mat(0xffffff, { map: texturePorte() }), n);
    // Intérieur entr'aperçu quand la porte est entrouverte.
    const gi = new THREE.PlaneGeometry(1.2, 2.2);
    gi.translate(0, 1.1, 0);
    this.mesInterieur = new THREE.InstancedMesh(gi, mat(0xffffff, { map: textureLocal() }), n);
    // Barre de progression du forçage, à côté de la porte.
    const gb = new THREE.BoxGeometry(0.07, 1, 0.07);
    gb.translate(0, 0.5, 0);
    this.mesBarre = new THREE.InstancedMesh(gb, mat(0xff2bd6), n);
    for (const m of [this.mesCadre, this.mesPanneau, this.mesInterieur, this.mesBarre]) {
      m.frustumCulled = false;
      m.matrixAutoUpdate = false;
      scene.add(m);
    }
    this.mesCadre.setColorAt(0, new THREE.Color(0xffffff));
    this.mesCadre.instanceColor.setUsage(THREE.DynamicDrawUsage);

    const c = new THREE.Color();
    PORTES_DEF.forEach(([x, z, nx, nz], i) => {
      const occ = OCCUPANTS[i % OCCUPANTS.length];
      const p = {
        i,
        id: `porte-${i}`,
        x, z, nx, nz,
        theta: Math.atan2(nx, nz),
        occupant: occ,
        code: codeDe(i),
        ouverte: false,
        angle: 0,
        cible: 0,
        progres: 0,
        etiquette: null,
        objet: null,
      };
      p.ex = [Math.cos(p.theta), -Math.sin(p.theta)];
      // intérieur (fixe) : devant la vitrine de la façade, derrière le panneau
      tmpO.position.set(x + nx * 0.085, TROTTOIR, z + nz * 0.085);
      tmpO.rotation.set(0, p.theta, 0);
      tmpO.scale.set(1, 1, 1);
      tmpO.updateMatrix();
      this.mesInterieur.setMatrixAt(i, tmpO.matrix);
      this.portes.push(p);
      p.etiquette = calque.etiqueter({ position: [x + nx * 0.4, 1.7, z + nz * 0.4], lignes: this.lignesPorte(p), zone: ZONE, rayon: 16 });
      p.objet = J.interact.ajouter({
        zone: ZONE,
        position: [x + nx * 0.2, 1.75, z + nz * 0.2],
        rayon: 3,
        cone: 1.1, // collé à la porte, on la regarde encore
        libelle: T1.libelle,
        sansEtiquette: true,
        visible: () => !p.ouverte && (J.etat.transgressions.T1 || 0) === 0 && !this.depart,
        action: () => this.commencerForcage(p),
      });
      void c;
    });
    this.mesInterieur.instanceMatrix.needsUpdate = true;
  },

  lignesPorte(p) {
    const champs = { code: p.code, nom: p.occupant.nom, il: p.occupant.il };
    return (p.ouverte ? T1.calque.ouverte : T1.calque.fermee).map((l) => remplir(l, champs));
  },

  // Met à jour les instances de la porte : cadre, panneau, barre, couleurs.
  majPorte(p) {
    const { x, z, nx, nz, theta, i } = p;
    const ex = p.ex;
    const poser = (mesh, idx, lx, ly, lz, sx, sy, sz, rot = theta) => {
      tmpO.position.set(x + ex[0] * lx + nx * lz, TROTTOIR + ly, z + ex[1] * lx + nz * lz);
      tmpO.rotation.set(0, rot, 0);
      tmpO.scale.set(sx, sy, sz);
      tmpO.updateMatrix();
      mesh.setMatrixAt(idx, tmpO.matrix);
    };
    poser(this.mesCadre, i * 4, -0.69, 1.25, 0.13, 0.1, 2.5, 0.16);
    poser(this.mesCadre, i * 4 + 1, 0.69, 1.25, 0.13, 0.1, 2.5, 0.16);
    poser(this.mesCadre, i * 4 + 2, 0, 2.45, 0.13, 1.48, 0.1, 0.16);
    poser(this.mesCadre, i * 4 + 3, 0, 2.62, 0.13, 0.36, 0.07, 0.17);
    // panneau : charnière à gauche (local x = −0.62), devant l'intérieur
    poser(this.mesPanneau, i, -0.62, 0, 0.1, 1, 1, 1, theta + p.angle);
    // barre de progression
    const k = Math.max(0.0001, p.progres * 2.3);
    poser(this.mesBarre, i, 1.05, 0, 0.15, 1, k, 1);
    this.coloriser(p);
    this.mesCadre.instanceMatrix.needsUpdate = true;
    this.mesPanneau.instanceMatrix.needsUpdate = true;
    this.mesBarre.instanceMatrix.needsUpdate = true;
  },

  coloriser(p) {
    const cadre = new THREE.Color(0x8a5cff).lerp(new THREE.Color(0xff2bd6), p.progres);
    const voyant = new THREE.Color(p.ouverte ? 0x4a7dff : p.progres > 0 ? 0xff5ad0 : 0xffa23a);
    for (let k = 0; k < 3; k++) this.mesCadre.setColorAt(p.i * 4 + k, cadre);
    this.mesCadre.setColorAt(p.i * 4 + 3, voyant);
    this.mesCadre.instanceColor.needsUpdate = true;
  },

  commencerForcage(p) {
    if (p.ouverte || this.forcage) return;
    this.forcage = { porte: p, t: 0 };
  },

  annulerForcage() {
    const f = this.forcage;
    if (!f) return;
    f.porte.progres = 0;
    this.majPorte(f.porte);
    this.forcage = null;
    this.barreDom(0, false);
  },

  /** Ouvre la porte (animation) et compte T1 si `compter`. `mode` : 'force' | 'auto'. */
  ouvrirPorte(p, mode, compter = true) {
    if (p.ouverte) return 0;
    p.ouverte = true;
    p.cible = -1.4;
    p.progres = 0;
    p.etiquette.lignes = this.lignesPorte(p);
    p.etiquette.maj?.();
    noter({ id: 'T1', quoi: 'porte', ou: p.id, mode, x: p.x, z: p.z });
    J.audio?.tonalite?.({ de: 150, vers: 90, duree: 0.5, volume: 0.05, type: 'square' });
    J.audio?.souffle?.({ de: 500, vers: 120, duree: 0.45, volume: 0.05, q: 1 });
    this.majPorte(p);
    if (!compter) return 0;
    const n = declencher('T1', mode === 'force' ? 'porte-forcee' : 'porte-ouverte-seule', { porte: p.id });
    const champs = { nom: p.occupant.nom, il: p.occupant.il, Il: cap(p.occupant.il) };
    if (n === 1) dire(remplir(T1.mima.premiere, champs));
    else if (n === 2) dire(remplir(T1.mima.deuxieme, champs));
    else if (n === 3) {
      dire(T1.mima.troisieme);
      poserDrapeau('portes-secteur-ouvertes');
    } else if (peutCommenter(n)) dire(T1.mima.suite[n % T1.mima.suite.length]);
    return n;
  },

  forcer(i) {
    const p = this.portes[i];
    if (!p) return 0;
    return this.ouvrirPorte(p, 'force');
  },

  majForcage(dt, jeu) {
    const f = this.forcage;
    if (!f) return;
    const p = f.porte;
    const pos = jeu.player.position;
    if (!jeu.jouable || !jeu.input.isDown('KeyE') || dist2(pos.x, pos.z, p.x, p.z) > 3.8) {
      this.annulerForcage();
      return;
    }
    f.t += dt;
    p.progres = Math.min(1, f.t / DUREE_FORCAGE);
    this.barreDom(p.progres, true);
    this.majPorte(p);
    if (f.t >= DUREE_FORCAGE) {
      this.forcage = null;
      this.barreDom(0, false);
      p.progres = 0;
      this.ouvrirPorte(p, 'force');
    }
  },

  // Les portes suivantes s'ouvrent seules (T1 2e), puis toutes à l'approche (3e et suivantes : plus comptées).
  majPortesAuto(dt, jeu) {
    this.cdAuto -= dt;
    const n = jeu.etat.transgressions.T1 || 0;
    if (n < 1 || this.cdAuto > 0 || !jeu.jouable || jeu.zones.nom !== ZONE) return;
    const pos = jeu.player.position;
    if (pos.y > 3) return;
    const portee = n >= 3 ? 7 : 2.8;
    for (const p of this.portes) {
      if (p.ouverte) continue;
      const dx = pos.x - p.x, dz = pos.z - p.z;
      if (Math.hypot(dx, dz) > portee || dx * p.nx + dz * p.nz < 0) continue;
      if (n >= 3) {
        // plus aucune porte n'est interdite : ce n'est plus une transgression
        this.ouvrirPorte(p, 'auto', false);
        this.autoSansCompte = (this.autoSansCompte || 0) + 1;
        if (jeu.t - this.dernierRappel > 25 && peutCommenter(this.autoSansCompte)) {
          this.dernierRappel = jeu.t;
          dire(T1.mima.suite[this.autoSansCompte % T1.mima.suite.length]);
        }
        this.cdAuto = 0.4;
      } else {
        this.ouvrirPorte(p, 'auto');
        this.cdAuto = 4;
      }
      return;
    }
  },

  // =====================================================================
  // T2 — prendre sans ligne
  // =====================================================================
  construireObjets() {
    const scene = this.zone.scene;
    const defs = []; // { type, x, y, z }
    let compteurMarche = 0;
    for (const e of marche.etals || []) {
      const pl = PLACEMENT_ETAL[e.type];
      if (!pl || (e.mur !== 19 && e.mur !== 41)) continue; // pas les îlots du centre
      const [type, u, v] = pl;
      const p = e.R.pt(u, SURFACE_COMPTOIR, v);
      defs.push({ id: `etal-${compteurMarche++}`, type, x: p.x, y: p.y, z: p.z, lieu: 'marche' });
    }
    PORTES_RUE.forEach((pi, k) => {
      const p = this.portes[pi];
      defs.push({
        id: `rue-${k}`,
        type: TYPES_RUE[k],
        x: p.x + p.nx * 0.9 + p.ex[0] * 1.5,
        y: TROTTOIR,
        z: p.z + p.nz * 0.9 + p.ex[1] * 1.5,
        lieu: 'rue',
      });
    });

    const mat = () => new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const geoBol = new THREE.CylinderGeometry(0.15, 0.11, 0.1, 8);
    const geoBouquet = new THREE.ConeGeometry(0.14, 0.5, 6);
    geoBouquet.rotateZ(Math.PI / 2);
    const geoVet = new THREE.BoxGeometry(0.5, 0.1, 0.34);
    const compte = (t) => defs.filter((d) => d.type === t).length;
    this.mesBol = new THREE.InstancedMesh(geoBol, mat(), compte('bol'));
    this.mesBouquet = new THREE.InstancedMesh(geoBouquet, mat(), compte('bouquet'));
    this.mesVetement = new THREE.InstancedMesh(geoVet, mat(), compte('vetement'));
    const meshes = { bol: this.mesBol, bouquet: this.mesBouquet, vetement: this.mesVetement };
    for (const m of Object.values(meshes)) {
      m.frustumCulled = false;
      m.matrixAutoUpdate = false;
      scene.add(m);
    }
    const index = { bol: 0, bouquet: 0, vetement: 0 };
    const hauteurs = { bol: 0.05, bouquet: 0.13, vetement: 0.05 };
    const c = new THREE.Color();
    defs.forEach((d, k) => {
      const mesh = meshes[d.type];
      const idx = index[d.type]++;
      const pour = DESTINATAIRES[k % DESTINATAIRES.length];
      const o = {
        id: d.id, type: d.type, x: d.x, y: d.y + hauteurs[d.type], z: d.z,
        mesh, idx, pour, code: codeDe(k, 5), lieu: d.lieu, pris: false, reserve: false,
        rot: ((k * 2.399) % Math.PI) - Math.PI / 2,
        etiquette: null, objet: null,
      };
      mesh.setColorAt(idx, c.setHex(COULEURS_OBJET[d.type][k % 3]));
      this.objets.push(o);
      o.etiquette = calque.etiqueter({ position: [o.x, o.y + 0.35, o.z], lignes: this.lignesObjet(o), zone: ZONE, rayon: 10 });
      o.objet = J.interact.ajouter({
        zone: ZONE,
        position: [o.x, o.y + 0.15, o.z],
        rayon: 2.6,
        libelle: OBJETS[o.type].libelle,
        sansEtiquette: true,
        visible: () => !o.pris,
        action: () => this.prendre(o.id),
      });
    });
    for (const m of Object.values(meshes)) if (m.instanceColor) m.instanceColor.needsUpdate = true;
  },

  lignesObjet(o) {
    const champs = { objet: OBJETS[o.type].nom, code: o.code, nom: o.pour };
    return (o.reserve ? T2.calque.reserve : T2.calque.libre).map((l) => remplir(l, champs));
  },

  majObjet(o) {
    if (o.pris) {
      o.mesh.setMatrixAt(o.idx, ZERO);
      if (o.etiquette && !o.etiquette.retiree) o.etiquette.retirer();
    } else {
      tmpO.position.set(o.x, o.y, o.z);
      tmpO.rotation.set(0, o.rot, 0);
      tmpO.scale.set(1, 1, 1);
      tmpO.updateMatrix();
      o.mesh.setMatrixAt(o.idx, tmpO.matrix);
      if (o.etiquette.retiree) {
        o.etiquette = calque.etiqueter({ position: [o.x, o.y + 0.35, o.z], lignes: this.lignesObjet(o), zone: ZONE, rayon: 10 });
      } else {
        o.etiquette.lignes = this.lignesObjet(o);
        o.etiquette.maj?.();
      }
    }
    o.mesh.instanceMatrix.needsUpdate = true;
  },

  /** `mode` : 'main' (le joueur le prend) ou 'recu' (on le lui tend). */
  prendre(id, mode = 'main') {
    const o = this.objets.find((x) => x.id === id);
    if (!o || o.pris) return 0;
    const reserve = o.reserve;
    o.pris = true;
    o.reserve = false;
    this.majObjet(o);
    J.interact.masquer?.();
    const recu = mode === 'recu' || reserve;
    noter({ id: 'T2', quoi: o.type, ou: o.id, mode: recu ? 'recu' : 'main', x: o.x, z: o.z });
    const art = OBJETS[o.type].article;
    J.hud?.notifier?.(remplir(recu ? T2.recu : T2.pris, { article: art }), { duree: 3 });
    J.audio?.tonalite?.({ de: 520, vers: 760, duree: 0.18, volume: 0.03, type: 'sine' });
    if (recu) return 0; // ce qui est à votre nom, ou qu'on vous tend : plus une transgression (§7.1)
    const n = declencher('T2', o.lieu === 'rue' ? 'objet-de-rue' : 'etal', { objet: o.id, type: o.type });
    if (n === 1) dire(remplir(T2.mima.premiere, { nom: o.pour }));
    else if (n === 2) {
      this.mettreDeCote(o);
      dire(T2.mima.deuxieme);
    } else {
      if (n === 3) poserDrapeau('sceau-recoit-beaucoup');
      if (peutCommenter(n)) dire(T2.mima.suite[n % T2.mima.suite.length]);
    }
    return n;
  },

  // T2 2e : l'objet suivant (le plus proche, à 5 m ou plus) est déjà à votre nom : « Usage : R-4 ».
  mettreDeCote(depuis) {
    let meilleur = null;
    let d0 = Infinity;
    for (const o of this.objets) {
      if (o.pris || o.reserve) continue;
      const d = dist2(o.x, o.z, depuis.x, depuis.z);
      if (d < 5 || d >= d0) continue;
      d0 = d;
      meilleur = o;
    }
    if (!meilleur) return;
    meilleur.reserve = true;
    poserDrapeau(`reserve:${meilleur.id}`);
    this.majObjet(meilleur);
    J.sauver?.();
  },

  // T2 3e et suivantes : les étaliers vous tendent les choses avant que vous les preniez.
  majTendre(dt, jeu) {
    this.cdTendre = (this.cdTendre || 0) - dt;
    if ((jeu.etat.transgressions.T2 || 0) < 3 || this.cdTendre > 0 || !jeu.jouable || jeu.zones.nom !== ZONE) return;
    const pos = jeu.player.position;
    for (const o of this.objets) {
      if (o.pris) continue;
      if (dist2(o.x, o.z, pos.x, pos.z) < 2.0 && Math.abs(o.y - pos.y - 1) < 1.8) {
        this.prendre(o.id, 'recu');
        this.cdTendre = 1.2;
        return;
      }
    }
  },

  // =====================================================================
  // T4 — fumer là où ce n'est pas d'usage
  // =====================================================================
  surAllumage() {
    const nom = J.zones?.nom || '';
    if (!T4.zones.some((z) => nom.includes(z))) return; // la rue, le marché couvert : jamais une transgression
    const n = declencher('T4', 'cigarette', { zone: nom });
    // La bande de Mima est masquée tant qu'on fume (bible §2.7) : la phrase attend la fin de la cigarette.
    if (n === 1) dire(T4.mima.premiere, 8);
    // 2e : les habitants présents sortent (la clinique n'en a pas) ; 3e+ : la ventilation s'accélère, Mima se tait.
    if (n >= 3) {
      const k = Math.min(n - 2, 6);
      J.audio?.souffle?.({ de: 160 + k * 25, vers: 700 + k * 120, duree: 2.4, volume: 0.03 + k * 0.01, q: 0.8 });
    }
  },

  // =====================================================================
  // T5 — hauteur
  // =====================================================================
  construireVeilleurSous() {
    const mat = new THREE.SpriteMaterial({ map: textureHalo(), color: 0xd6ecff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false });
    this.veilleurSous = new THREE.Sprite(mat);
    this.veilleurSous.scale.set(1.8, 1.8, 1);
    this.veilleurSous.visible = false;
    this.zone.scene.add(this.veilleurSous);
  },

  majHauteur(dt, t, jeu) {
    const pos = jeu.player.position;
    const enVille = jeu.zones.nom === ZONE;
    const haut = enVille && pos.y >= 60 && jeu.player.auSol && !(jeu.etat.pouvoirs || []).includes('harnais');
    if (haut && this.t5Arme && !jeu.veilleur?.rattrapageEnCours) {
      this.t5Arme = false;
      const hauteur = Math.round(pos.y);
      const n = declencher('T5', 'hauteur', { y: hauteur });
      if (n === 1) {
        const dits = (jeu.etat.conseilsDits ||= []);
        if (!dits.includes('c4')) {
          dits.push('c4'); // c'est la même phrase : le conseil de hauteur ne la répétera pas
          dire(remplir(T5.mima.premiere, { hauteur }));
        }
      }
    }
    if (!haut && pos.y < 45) this.t5Arme = true;

    // 2e et suivantes : un Veilleur se poste sous vous (il reste).
    const veille = enVille && pos.y >= 40 && (jeu.etat.transgressions.T5 || 0) >= 2;
    const s = this.veilleurSous;
    s.visible = veille;
    if (veille) {
      const [x, z] = this.pointSous(pos, jeu);
      s.position.set(x, 2.6 + Math.sin(t * 1.7) * 0.15, z);
    }
  },

  // Point au sol, devant la façade la plus proche de l'immeuble sur lequel on se tient.
  pointSous(pos, jeu) {
    let b = null;
    for (const i of this.zone.immeubles || []) {
      if (Math.abs(pos.x - i.x) <= i.w / 2 + 0.6 && Math.abs(pos.z - i.z) <= i.d / 2 + 0.6) { b = i; break; }
    }
    if (!b) return [pos.x, pos.z];
    const dx = pos.x - b.x, dz = pos.z - b.z;
    const ex = b.w / 2 - Math.abs(dx), ez = b.d / 2 - Math.abs(dz);
    if (ex < ez) return [b.x + Math.sign(dx || 1) * (b.w / 2 + 3.5), pos.z];
    return [pos.x, b.z + Math.sign(dz || 1) * (b.d / 2 + 3.5)];
  },

  // =====================================================================
  // T7 — refus de conseils (le comptage vit dans conseils.js)
  // =====================================================================
  majRefus(jeu) {
    const r = jeu.etat.refus || 0;
    const d = drapeaux();
    if (r >= T7.seuils.remarque && !d.includes('T7:5')) {
      d.push('T7:5');
      dire(T7.mima.cinq, 9);
      jeu.emettre('transgression:refus', { n: r, seuil: T7.seuils.remarque });
      jeu.sauver?.();
    }
    if (r >= T7.seuils.silence && !d.includes('T7:15')) {
      d.push('T7:15');
      // Elle cesse de conseiller : tous les conseils comptent comme dits (conseils.js ne propose plus rien).
      const dits = (jeu.etat.conseilsDits ||= []);
      for (const c of CONSEILS) if (!dits.includes(c.id)) dits.push(c.id);
      dire(T7.mima.quinze, 9);
      jeu.emettre('transgression:refus', { n: r, seuil: T7.seuils.silence });
      jeu.sauver?.();
    }
  },

  // =====================================================================
  // T13 — quitter la ville
  // =====================================================================
  construireTunnel() {
    const scene = this.zone.scene;
    const solide = [];
    const lueur = [];
    const col = new THREE.Color();
    const boite = (lot, w, h, d, x, y, z, couleur) => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(x, y, z);
      const n = g.attributes.position.count;
      col.set(couleur);
      const a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; }
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
      g.deleteAttribute('uv');
      lot.push(g);
    };
    const { x, z0, z1 } = TUNNEL;
    const L = z1 - z0;
    const zc = (z0 + z1) / 2;
    // bouche du tunnel du maglev, sud de Kasumi : deux piédroits, un toit, un linteau
    boite(solide, 0.8, 6.4, L, x - 4.0, 3.2, zc, 0x20144a);
    boite(solide, 0.8, 6.4, L, x + 4.0, 3.2, zc, 0x20144a);
    boite(solide, 8.8, 0.8, L, x, 6.0, zc, 0x1a1040);
    boite(solide, 10.0, 1.4, 1.4, x, 6.3, z0 + 0.7, 0x2a1a5a);
    boite(solide, 7.2, 0.1, L, x, 0.05, zc, 0x120a2a);
    // lueurs : rails de sol, bandeau de plafond, traverses qui défilent
    boite(lueur, 0.12, 0.05, L, x - 3.1, 0.12, zc, 0x8a5cff);
    boite(lueur, 0.12, 0.05, L, x + 3.1, 0.12, zc, 0x4a7dff);
    boite(lueur, 0.22, 0.06, L, x, 5.55, zc, 0xff2bd6);
    boite(lueur, 9.4, 0.1, 0.1, x, 5.55, z0 + 0.05, 0xff2bd6);
    boite(lueur, 6.4, 4.6, 0.1, x, 2.5, z1 - 0.5, 0x6a4aa8); // la lumière au bout du couloir
    for (let i = 0; i < 6; i++) boite(lueur, 6.6, 0.05, 0.12, x, 5.5, z0 + 3.2 + i * 3, i % 2 ? 0x4a7dff : 0xc44bff);
    const mS = new THREE.Mesh(mergeGeometries(solide), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.35 }));
    const mL = new THREE.Mesh(mergeGeometries(lueur), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
    const pancarte = new THREE.Mesh(
      new THREE.PlaneGeometry(6.4, 1.6),
      new THREE.MeshBasicMaterial({ map: texturePancarte(T13.pancarte), toneMapped: false })
    );
    pancarte.position.set(x, 8.0, z0 - 0.05);
    pancarte.rotation.y = Math.PI; // regarde vers la ville (−z)
    for (const m of [mS, mL, pancarte]) scene.add(m);
    // les piédroits arrêtent le joueur (murs infinis : il reste dans le couloir)
    this.zone.colliders.push({ minX: x - 4.4, maxX: x - 3.6, minZ: z0, maxZ: z1 });
    this.zone.colliders.push({ minX: x + 3.6, maxX: x + 4.4, minZ: z0, maxZ: z1 });
    this.tunnel = { x, z0, z1 };
  },

  majVille(dt, jeu) {
    this.cooldownVille -= dt;
    const d = this.depart;
    if (d) {
      d.t += dt;
      if (d.phase === 'dit' && d.t >= 2.6) {
        d.phase = 'noir'; d.t = 0;
        jeu.hud?.fondu?.(true, 0.9);
      } else if (d.phase === 'noir' && d.t >= 1.0) {
        // ramené en ville, à 15 m du bord, tourné vers elle
        const p = jeu.player.position;
        const dedans = LIMITE_VILLE - 15;
        let x = p.x, z = p.z;
        if (Math.abs(x) >= Math.abs(z)) x = Math.sign(x) * dedans; else z = Math.sign(z) * dedans;
        if (d.source === 'tunnel') { x = TUNNEL.x; z = TUNNEL.z0 - 4; }
        jeu.player.teleporter(x, 0, z, Math.atan2(x, z), 0);
        jeu.hud?.fondu?.(false, 0.9);
        d.phase = 'retour'; d.t = 0;
      } else if (d.phase === 'retour' && d.t >= 1.0) {
        jeu.reprendre('transgressions');
        dire(T13.mima.retour, 6);
        jeu.emettre('ville:retour', { n: d.n });
        this.depart = null;
        this.cooldownVille = 6;
      }
      return;
    }
    if (jeu.zones.nom !== ZONE || !jeu.jouable || this.cooldownVille > 0) return;
    const p = jeu.player.position;
    if (Math.max(Math.abs(p.x), Math.abs(p.z)) < LIMITE_VILLE) return;
    const source = p.z >= TUNNEL.z0 && Math.abs(p.x - TUNNEL.x) < 4 ? 'tunnel' : 'bord';
    // Pas une transgression (0 Attention) : le compteur monte, l'Attention le sait.
    const n = declencher('T13', source, { x: Math.round(p.x), z: Math.round(p.z) });
    jeu.emettre('ville:sortie', { n, source });
    dire(T13.mima.depart, 5);
    jeu.suspendre('transgressions');
    this.depart = { phase: 'dit', t: 0, n, source };
  },

  // =====================================================================
  // Barre de progression (DOM)
  // =====================================================================
  construireBarreDom() {
    const racine = document.createElement('div');
    racine.style.cssText = 'position:fixed;left:50%;bottom:31vh;transform:translateX(-50%);z-index:60;display:none;pointer-events:none;text-align:center;font:600 13px ui-monospace,Menlo,Consolas,monospace;color:#efe6ff;letter-spacing:.06em';
    const label = document.createElement('div');
    label.textContent = T1.progression;
    label.style.cssText = 'margin-bottom:5px;text-shadow:2px 2px 0 rgba(8,2,22,.8)';
    const cadre = document.createElement('div');
    cadre.style.cssText = 'width:240px;height:14px;border:2px solid #c44bff;background:rgba(14,6,34,.86);box-shadow:4px 4px 0 rgba(8,2,22,.8)';
    const rempli = document.createElement('div');
    rempli.style.cssText = 'height:100%;width:0;background:#ff2bd6;box-shadow:0 0 8px #ff2bd6';
    cadre.appendChild(rempli);
    racine.append(label, cadre);
    document.body.appendChild(racine);
    this.dom = { racine, rempli };
  },

  barreDom(k, visible) {
    if (!this.dom) return;
    this.dom.racine.style.display = visible ? 'block' : 'none';
    this.dom.rempli.style.width = `${Math.round(k * 100)}%`;
  },

  // =====================================================================
  update(dt, t, jeu) {
    if (!jeu.player || !jeu.zones?.courante) return;
    // animation des portes
    for (const p of this.portes) {
      if (p.angle !== p.cible) {
        const pas = dt * 1.8;
        p.angle = p.angle > p.cible ? Math.max(p.cible, p.angle - pas) : Math.min(p.cible, p.angle + pas);
        this.majPorte(p);
      }
    }
    if (!jeu.enPartie) return;
    this.majVille(dt, jeu);
    this.majRefus(jeu);
    this.majHauteur(dt, t, jeu);
    if (jeu.zones.nom !== ZONE) { if (this.forcage) this.annulerForcage(); return; }
    this.majForcage(dt, jeu);
    this.majPortesAuto(dt, jeu);
    this.majTendre(dt, jeu);
  },
};
