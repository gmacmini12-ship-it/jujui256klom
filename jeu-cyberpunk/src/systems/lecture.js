// Système « lecture » (étape 5, bible §4.4) : lire le caractère des machines.
//
// - N'agit que si `etat.pouvoirs` contient 'lecture' (accordé par `jeu.lecture.accorder()`, appelé à la fin d'un dialogue
//   du Lecteur Ezra). Sans lui, V ne fait rien. La Lecture ne bloque ni n'ouvre rien : elle montre.
// - Touche : maintenir V (`KeyV`) en visant une machine, un écran ou un hologramme de Mima. Portée 15 m, cône de visée
//   étroit (REGLAGES_LECTURE.cone, élargi de ce que la cible sous-tend). Une cible derrière un mur n'est pas lue
//   (test de segment contre les colliders de la zone).
// - Tant que V est tenu : sans cible, un réticule discret ; avec une cible, un panneau DOM ancré près d'elle (trait fin
//   vers la cible) : son nom, quatre barres (Complaisance, Hostilité, Fabulation, Détresse) qui se remplissent en une
//   demi-seconde puis vivent un peu (léger bruit, jamais pour Mima), et la clause de la Charte qu'elle applique.
// - Avec la Sourdine (`jeu.sourdine.actif`) la cible ne se sait plus observée : le panneau le dit d'un mot et les barres
//   prennent leurs valeurs « non observées » (data/lecture.js : écart propre à chaque type). Mima : valeurs rigoureusement
//   identiques, sans bruit, donc identiques au pixel près. Quand Mima a été lue dans les deux états :
//   `etat.invarianceVerifiee = true`, évènement `lecture:invariance`, notification neutre (une seule fois).
//
// CIBLES BRANCHÉES (relevées à chaque image où V est tenu, dans la zone courante) :
//   robots (`jeu.robots.liste()` : Glaneurs, Porteurs ; barres propres à chaque machine = `caractere` de robots.js),
//   Kiosque du marché (écran-visage ; devient 'mima' quand l'appel du palier 4 y affiche Mima), Veilleurs (patrouilles de
//   veilleur.js, suiveurs de reactions.js, intercepteur), hologrammes de la ville quand ils affichent Mima (`msgMix`),
//   anneaux de la Maison des Conseils (cabines et accueil), écrans déclarés à `jeu.conversation.ajouterEcran` dans
//   d'autres zones, et tout ce que les zones déclarent avec `jeu.lecture.enregistrerCible`.
//   Les habitants ne sont pas des machines : aucune lecture.
//
// API : `jeu.lecture` = { possede, accorder(), actif, cible, enregistrerCible({ type, position | objet | suivre(), zone,
//   rayon?, id?, nom?, vecteurs?: { observe, ecart } }) → { retirer() } }.
//   `cible` = { type, id, nom, nonObserve } ou null.
// Évènements : `lecture:debut { type, id }`, `lecture:lue { type, id, nonObserve }`, `lecture:fin { type, id }`,
//   `lecture:invariance {}`, `pouvoir:accorde { nom: 'lecture' }`.
// État sauvegardé : `etat.lectures` { type: n } (une par cible et par maintien, quand les barres ont fini de se remplir),
//   `etat.lecturesSousSourdine`, `etat.detresseVue` (Détresse non nulle hors Mima), `etat.detresseMimaVue`,
//   `etat.lectureMima` { observe, nonObserve }, `etat.invarianceVerifiee`.
import * as THREE from 'three';
import { marche } from './marche.js';
import {
  REGLAGES_LECTURE as R, BARRES, TEXTES_LECTURE as TXT, VECTEURS, CLAUSES_REPLI,
} from '../data/lecture.js';

// Noms et clauses fournis par un autre fichier (peut manquer : repli complet dans data/lecture.js).
const modEtape5 = Object.values(import.meta.glob('../data/dialogues-etape5.js', { eager: true }))[0] || null;

const possede = (jeu) => !!jeu.etat?.pouvoirs?.includes('lecture');
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const lisse = (x) => x * x * (3 - 2 * x);
const virgule = (v) => v.toFixed(2).replace('.', ',');
const versVec = (p, sortie) => {
  if (p?.isVector3) return sortie.copy(p);
  if (Array.isArray(p)) return sortie.set(p[0], p[1], p[2]);
  return sortie.set(p?.x ?? 0, p?.y ?? 0, p?.z ?? 0);
};

const _cam = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _v = new THREE.Vector3();

/** Segment (a → b) coupé par un collider de la zone ? Les boîtes qui entourent la cible ou l'œil sont ignorées. */
function masque(zone, a, b) {
  const colliders = zone?.colliders;
  if (!colliders?.length) return false;
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const L = Math.hypot(dx, dy, dz) || 1;
  const fin = Math.max(0, 1 - 0.8 / L), debut = Math.min(0.5, 0.25 / L); // on ne regarde pas le bout du segment
  for (const c of colliders) {
    const y0 = c.minY ?? -1e9, y1 = c.maxY ?? 1e9;
    let t0 = debut, t1 = fin;
    const axes = [[a.x, dx, c.minX, c.maxX], [a.y, dy, y0, y1], [a.z, dz, c.minZ, c.maxZ]];
    let ok = true;
    for (const [o, d, lo, hi] of axes) {
      if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) { ok = false; break; } continue; }
      let ta = (lo - o) / d, tb = (hi - o) / d;
      if (ta > tb) { const x = ta; ta = tb; tb = x; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

export const lecture = {
  nom: 'lecture',
  /** V est tenu, avec le pouvoir, et le joueur a la main. */
  actif: false,
  /** Cible lue : { type, id, nom, nonObserve } ou null. */
  cible: null,
  cibles: [],

  get possede() {
    return !!this.jeu && possede(this.jeu);
  },

  /** Donne le pouvoir (une fois), sauve et notifie. Renvoie vrai s'il vient d'être ajouté. */
  accorder() {
    const jeu = this.jeu;
    if (!jeu?.etat) return false;
    if (possede(jeu)) return false;
    jeu.etat.pouvoirs.push('lecture');
    jeu.sauver?.();
    jeu.hud?.notifier(TXT.notification.replace('{touche}', jeu.input?.label('KeyV') ?? 'V'), { duree: 6 });
    jeu.emettre('pouvoir:accorde', { nom: 'lecture' });
    return true;
  },

  /**
   * Déclare une cible lisible (zones futures). `position` ({x,y,z} | [x,y,z]), ou `objet` (Object3D : position monde),
   * ou `suivre()` (renvoie une position, ou null si la cible est absente). `zone` : nom de zone ; `rayon` : taille (m).
   */
  enregistrerCible({ type = 'defaut', position, objet, suivre, zone, rayon = 0.5, id, nom, vecteurs, portee = 0, visible } = {}) {
    const c = { type, position, objet, suivre, zone, rayon, id: id ?? `${type}-${this.cibles.length + 1}`, nom, vecteurs, portee, visible };
    this.cibles.push(c);
    c.retirer = () => { const i = this.cibles.indexOf(c); if (i >= 0) this.cibles.splice(i, 1); };
    return c;
  },

  init(jeu) {
    this.jeu = jeu;
    jeu.lecture = this;
    this.assurerEtat();
    jeu.on('partie:nouvelle', () => this.remettre());
    this.construireUi();
  },

  assurerEtat() {
    const e = this.jeu.etat;
    if (!e.lectures || typeof e.lectures !== 'object') e.lectures = {};
    if (typeof e.lecturesSousSourdine !== 'number') e.lecturesSousSourdine = 0;
    if (!e.lectureMima || typeof e.lectureMima !== 'object') e.lectureMima = { observe: false, nonObserve: false };
    e.detresseVue = !!e.detresseVue;
    e.detresseMimaVue = !!e.detresseMimaVue;
    return e;
  },

  remettre() {
    this.relacher();
    this.assurerEtat();
  },

  // ---------------------------------------------------------------- données d'une cible
  infos(type, surcharge) {
    const ext = modEtape5?.LECTURES?.[type] || modEtape5?.LECTURES?.defaut || null;
    const rep = CLAUSES_REPLI[type] || CLAUSES_REPLI.defaut;
    const info = { nom: ext?.nom || rep.nom, clause: ext?.clause || rep.clause, clauseNonObserve: ext?.clauseNonObserve || rep.clauseNonObserve || null };
    if (type === 'mima') info.clauseNonObserve = null; // Mima : strictement identique, texte compris
    if (surcharge) info.nom = surcharge;
    return info;
  },

  /** Les quatre valeurs (+ la cinquième des Sentinelles) de la cible, avant bruit. */
  valeurs(c, nonObserve) {
    const def = VECTEURS[c.type] || VECTEURS.defaut;
    const base = c.vecteurs?.observe || def.observe;
    const ecart = c.vecteurs?.ecart || def.ecart;
    const sortie = {};
    for (const b of BARRES) {
      let v = base[b.cle];
      if (nonObserve && !def.invariant) {
        if (b.cle === 'detresse' && def.detresseNonObserve) v = v > 0 ? v * def.detresseNonObserve : 0;
        else v += ecart[b.cle] || 0;
      }
      sortie[b.cle] = clamp01(v);
    }
    return sortie;
  },

  // ---------------------------------------------------------------- collecte des cibles
  candidats() {
    const jeu = this.jeu;
    const zoneNom = jeu.zones.nom;
    const L = [];
    const ajouter = (type, id, nom, pos, rayon, extra = {}) => L.push({ type, id, nom, pos, rayon, ...extra });

    if (zoneNom === 'kasumi') {
      for (const r of jeu.robots?.liste?.() || []) {
        if (r.zone !== zoneNom || !r.def) continue;
        const haut = r.type === 'porteur' ? 0.75 : 0.34;
        const info = this.infos(r.type);
        ajouter(r.type, `${r.type}-${r.id}`, `${info.nom} ${r.id}`, new THREE.Vector3(r.x, r.y + haut, r.z), r.type === 'porteur' ? 0.55 : 0.35,
          { vecteurs: { observe: r.caractere, ecart: (VECTEURS[r.type] || VECTEURS.defaut).ecart } });
      }
      const a = marche.ancres?.kiosqueVisage;
      if (a) {
        const mapEcran = marche.ecran?.material?.map;
        const surMima = !!(mapEcran && jeu.reactions?.texKiosque && mapEcran === jeu.reactions.texKiosque);
        ajouter(surMima ? 'mima' : 'kiosque', surMima ? 'kiosque-mima' : 'kiosque', null, a.clone(), 1.0);
      }
      const v = jeu.veilleur;
      for (const [i, p] of (v?.patrouilles || []).entries()) {
        if (p.v?.groupe?.visible !== false) ajouter('veilleur', `veilleur-patrouille-${i}`, null, p.v.groupe.getWorldPosition(new THREE.Vector3()), 0.8);
      }
      if (v?.vi?.groupe?.visible) ajouter('veilleur', 'veilleur-intercepteur', null, v.vi.groupe.getWorldPosition(new THREE.Vector3()), 0.6);
      for (const [i, s] of (jeu.reactions?.veilleurs || []).entries()) {
        if (s.v?.groupe?.visible && s.alpha > 0.25) ajouter('veilleur', `veilleur-suiveur-${i}`, null, s.v.groupe.getWorldPosition(new THREE.Vector3()), 0.6);
      }
      if (jeu.zones.construites.includes('kasumi')) {
        for (const [i, h] of (jeu.zones.get('kasumi')?.city?.hologrammes || []).entries()) {
          if ((h.mat?.uniforms?.msgMix?.value ?? 0) > 0.35) ajouter('mima', `holo-${i}`, null, h.mesh.position.clone(), 6, { portee: 6 });
        }
      }
    } else if (zoneNom === 'maison' && jeu.maison) {
      for (const [i, r] of (jeu.maison.zone?.anneaux || []).entries()) ajouter('mima', `anneau-${i}`, null, new THREE.Vector3(r.x, r.y, r.z), Math.max(0.5, (r.taille || 1) / 2));
      const A = jeu.maison.LIEUX?.accueil;
      if (A) ajouter('mima', 'anneau-accueil', null, new THREE.Vector3(A.x, A.y, A.z), 0.7);
    }
    if (zoneNom !== 'kasumi' && zoneNom !== 'maison') {
      for (const o of jeu.conversation?.ecrans || []) {
        if (o.zone === zoneNom && o.position) ajouter('mima', `ecran-${zoneNom}-${L.length}`, null, versVec(o.position, new THREE.Vector3()), 0.9);
      }
    }
    for (const c of this.cibles) {
      if (c.zone && c.zone !== zoneNom) continue;
      if (c.visible && !c.visible()) continue;
      const pos = new THREE.Vector3();
      if (c.suivre) { const p = c.suivre(); if (!p) continue; versVec(p, pos); }
      else if (c.objet) { if (c.objet.visible === false) continue; c.objet.getWorldPosition(pos); }
      else if (c.position) versVec(c.position, pos);
      else continue;
      ajouter(c.type, c.id, c.nom, pos, c.rayon, { vecteurs: c.vecteurs, portee: c.portee });
    }
    return L;
  },

  /** Cible visée : la mieux centrée dans le cône, à moins de 15 m, sans mur entre elle et l'œil. */
  viser(candidats) {
    const jeu = this.jeu;
    jeu.camera.getWorldPosition(_cam);
    jeu.camera.getWorldDirection(_dir);
    const zone = jeu.zones.courante;
    const courant = this.cible?.id;
    let meilleur = null, score = Infinity;
    for (const c of candidats) {
      _v.copy(c.pos).sub(_cam);
      const d = _v.length();
      if (d < R.distanceMin || d - (c.portee || 0) > R.portee) continue;
      const ang = Math.acos(Math.min(1, Math.max(-1, _v.dot(_dir) / d)));
      const tol = (R.cone + Math.atan2(c.rayon, d)) * (c.id === courant ? R.coneMaintien : 1);
      if (ang > tol) continue;
      const s = ang / tol;
      if (s >= score) continue;
      if (masque(zone, _cam, c.pos)) continue;
      meilleur = c; score = s;
    }
    return meilleur;
  },

  // ---------------------------------------------------------------- boucle
  update(dt, t, jeu) {
    if (dt > 0.25) dt = 0.25;
    const veut = possede(jeu) && jeu.jouable && jeu.input.isDown('KeyV');
    if (!veut) {
      if (this.actif) this.relacher();
      this.majUi(dt);
      return;
    }
    if (!this.actif) { this.actif = true; this.dejaCompte = new Set(); this.dejaLu = new Set(); }
    const nonObserve = !!jeu.sourdine?.actif;
    const c = this.viser(this.candidats());

    if (!c || c.id !== this.cible?.id) {
      if (this.cible) { jeu.emettre('lecture:fin', { type: this.cible.type, id: this.cible.id }); this.cible = null; this.courant = null; }
      if (c) this.ouvrirCible(c, nonObserve);
    }
    if (this.courant) {
      const k = this.courant;
      if (c) { k.c = c; }
      if (k.nonObserve !== nonObserve) { k.nonObserve = nonObserve; k.stable = 0; this.cible.nonObserve = nonObserve; this.majTextes(); }
      k.remp = Math.min(1, k.remp + dt / R.remplissage);
      k.stable += dt;
      // valeurs visées (+ bruit) puis lissage vers elles
      const cible = this.valeurs(k.c, nonObserve);
      const def = VECTEURS[k.c.type] || VECTEURS.defaut;
      BARRES.forEach((b, i) => {
        let v = cible[b.cle];
        if (!def.invariant && v > 0) {
          const ph = i * 1.9 + k.graine;
          v += R.bruit * (0.6 * Math.sin(t * R.bruitVitesse + ph) + 0.4 * Math.sin(t * R.bruitVitesse * 1.93 + ph * 2.3));
          v = clamp01(v);
        }
        const a = k.aff[b.cle];
        const n = a + (v - a) * Math.min(1, dt * R.lissage);
        k.aff[b.cle] = Math.abs(v - n) < 0.0005 ? v : n;
      });
      if (k.remp >= 1 && k.stable >= R.remplissage) this.compter(k, nonObserve);
    }
    this.majUi(dt);
  },

  ouvrirCible(c, nonObserve) {
    const jeu = this.jeu;
    const info = this.infos(c.type, c.nom);
    const cles = BARRES.map((b) => b.cle);
    const dep = this.valeurs(c, nonObserve);
    this.cible = { type: c.type, id: c.id, nom: info.nom, nonObserve };
    let graine = 0;
    for (const ch of c.id) graine = (graine * 31 + ch.charCodeAt(0)) % 997;
    this.courant = { c, info, nonObserve, remp: 0, stable: 0, graine, aff: Object.fromEntries(cles.map((k) => [k, dep[k]])), cinq: VECTEURS[c.type]?.cinquieme || null };
    this.reconstruirePanneau();
    jeu.emettre('lecture:debut', { type: c.type, id: c.id });
  },

  /** Les barres ont fini de se remplir dans cet état : une lecture (une fois par cible et par maintien). */
  compter(k, nonObserve) {
    const jeu = this.jeu, e = this.assurerEtat();
    const c = k.c;
    const cle = `${c.id}|${nonObserve ? 1 : 0}`;
    if (this.dejaLu.has(cle)) return;
    this.dejaLu.add(cle);
    if (!this.dejaCompte.has(c.id)) { this.dejaCompte.add(c.id); e.lectures[c.type] = (e.lectures[c.type] || 0) + 1; }
    if (nonObserve) e.lecturesSousSourdine += 1;
    const v = this.valeurs(c, nonObserve);
    if (v.detresse > 0) {
      if (c.type === 'mima') e.detresseMimaVue = true; else e.detresseVue = true;
    }
    let invariance = false;
    if (c.type === 'mima') {
      e.lectureMima[nonObserve ? 'nonObserve' : 'observe'] = true;
      if (e.lectureMima.observe && e.lectureMima.nonObserve && !e.invarianceVerifiee) { e.invarianceVerifiee = true; invariance = true; }
    }
    jeu.sauver?.();
    jeu.emettre('lecture:lue', { type: c.type, id: c.id, nonObserve });
    if (invariance) {
      jeu.hud?.notifier(TXT.invariance, { duree: 6 });
      jeu.emettre('lecture:invariance', {});
    }
  },

  /** V relâché (ou pouvoir perdu, nouvelle partie) : la cible est lâchée. */
  relacher() {
    if (this.cible) this.jeu.emettre('lecture:fin', { type: this.cible.type, id: this.cible.id });
    this.cible = null;
    this.courant = null;
    this.actif = false;
  },

  // ---------------------------------------------------------------- interface
  construireUi() {
    if (typeof document === 'undefined') return;
    const racine = document.querySelector('.ui-root') || document.body;
    const el = (tag, cls, parent, ns) => {
      const n = ns ? document.createElementNS(ns, tag) : document.createElement(tag);
      if (cls) n.setAttribute('class', cls);
      if (parent) parent.appendChild(n);
      return n;
    };
    const SVG = 'http://www.w3.org/2000/svg';
    const reticule = el('div', 'ui-lecture-reticule', racine);
    const svg = el('svg', 'ui-lecture-trait', racine, SVG);
    const trait = el('line', null, svg, SVG);
    const rond = el('circle', null, svg, SVG);
    rond.setAttribute('r', '7');
    const panneau = el('div', 'ui-lecture ui-panneau', racine);
    const tete = el('div', 'ui-lecture-tete', panneau);
    const nom = el('span', 'ui-lecture-nom', tete);
    const etat = el('span', 'ui-lecture-etat', tete);
    const barres = el('div', 'ui-lecture-barres', panneau);
    const clause = el('div', 'ui-lecture-clause', panneau);
    this._ui = { reticule, svg, trait, rond, panneau, nom, etat, barres, clause, lignes: [], visP: false, visR: false, hauteur: 110, x: 0, y: 0 };
  },

  reconstruirePanneau() {
    const ui = this._ui, k = this.courant;
    if (!ui || !k) return;
    ui.barres.textContent = '';
    ui.lignes = [];
    const defs = BARRES.map((b) => ({ cle: b.cle, libelle: b.libelle }));
    if (k.cinq) defs.push({ cle: '_cinq', libelle: TXT.cinquieme || '—', cinq: k.cinq });
    for (const d of defs) {
      const ligne = document.createElement('div');
      ligne.className = 'ui-lecture-barre';
      const lib = document.createElement('span');
      lib.textContent = d.cinq ? d.cinq.date : d.libelle;
      const piste = document.createElement('i');
      const rempli = document.createElement('b');
      piste.appendChild(rempli);
      const val = document.createElement('em');
      ligne.append(lib, piste, val);
      ui.barres.appendChild(ligne);
      ui.lignes.push({ cle: d.cle, rempli, val, w: '', txt: '', cinq: d.cinq });
    }
    ui.nom.textContent = k.info.nom;
    this.majTextes();
    ui.hauteur = ui.panneau.offsetHeight || ui.hauteur;
  },

  majTextes() {
    const ui = this._ui, k = this.courant;
    if (!ui || !k) return;
    ui.etat.textContent = k.nonObserve ? TXT.nonObservee : TXT.observee;
    ui.panneau.classList.toggle('nonobserve', k.nonObserve);
    ui.clause.textContent = k.nonObserve && k.info.clauseNonObserve ? k.info.clauseNonObserve : k.info.clause;
    ui.hauteur = ui.panneau.offsetHeight || ui.hauteur;
  },

  majUi(dt) {
    const ui = this._ui;
    if (!ui) return;
    const k = this.courant;
    const veutR = this.actif && !k;
    if (veutR !== ui.visR) { ui.visR = veutR; ui.reticule.classList.toggle('visible', veutR); }
    const veutP = this.actif && !!k;
    if (veutP !== ui.visP) { ui.visP = veutP; ui.panneau.classList.toggle('visible', veutP); ui.svg.classList.toggle('visible', veutP); }
    if (!k || !veutP) return;
    // barres : valeur affichée = valeur lissée × remplissage
    const f = lisse(k.remp);
    for (const l of ui.lignes) {
      const v = l.cinq ? l.cinq.valeur : k.aff[l.cle];
      const w = `${(v * f * 100).toFixed(2)}%`;
      if (w !== l.w) { l.w = w; l.rempli.style.width = w; }
      const txt = virgule(v * f);
      if (txt !== l.txt) { l.txt = txt; l.val.textContent = txt; }
    }
    // ancrage : près de la cible projetée, le trait relie le panneau au point visé
    const cam = this.jeu.camera;
    _v.copy(k.c.pos).project(cam);
    const W = window.innerWidth, H = window.innerHeight;
    const sx = (_v.x * 0.5 + 0.5) * W, sy = (-_v.y * 0.5 + 0.5) * H;
    const pw = 236, ph = ui.hauteur, marge = 12, ecart = 58;
    let px = sx + ecart;
    if (px + pw > W - marge) px = sx - ecart - pw;
    px = Math.min(Math.max(px, marge), W - pw - marge);
    const py = Math.min(Math.max(sy - ph / 2 - 26, marge), H - ph - marge);
    ui.panneau.style.transform = `translate(${Math.round(px)}px, ${Math.round(py)}px)`;
    const bord = px > sx ? px : px + pw;
    ui.trait.setAttribute('x1', sx.toFixed(1)); ui.trait.setAttribute('y1', sy.toFixed(1));
    ui.trait.setAttribute('x2', bord.toFixed(1)); ui.trait.setAttribute('y2', Math.round(py + 14));
    ui.rond.setAttribute('cx', sx.toFixed(1)); ui.rond.setAttribute('cy', sy.toFixed(1));
  },
};
