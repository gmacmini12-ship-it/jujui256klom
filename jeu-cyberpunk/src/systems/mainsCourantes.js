import * as THREE from 'three';
import { signTexture } from '../textures.js';
import { TITRES_ZONES } from '../data/interface.js';
import {
  TITRE_ZONE, INVITES_SALLE, ENSEIGNES_SALLE, PAN, HEURE, ECRITURES,
  NOMS_ZONES, NOMS_POUVOIRS, NOMS_RENCONTRES,
} from '../data/mains-courantes.js';
import { FRAGMENTS } from '../data/fragments.js';

// Système « mainsCourantes » : l'entrée de la Salle des Mains Courantes au pied de Hashira
// (côté ville) et le registre des écritures du joueur (bible §5.5, §7.4).
//
// L'intérieur est la zone `mains-courantes` (zones/mainsCourantes.js).
//
// ENTRÉE : une porte au sud du fût (x = 0, z = +14), sous un porche à enseigne. Le socle de
// Hashira et ses trois colliders sont percés d'un couloir de 4,6 m (voir `percerSocle`) ; point
// d'arrivée en ville : `jeu.zones.get('kasumi').points.tour` = (0, 0, 20,5), face à la place.
//
// REGISTRE DU JOUEUR : `etat.mainsCourantes = { temps, dates, rob, vu }` (sauvegardé avec l'état).
//   temps  : secondes de jeu écoulées (pas en pause d'accueil) ; l'heure affichée part de 23 h 00.
//   dates  : clé → temps de la première observation (« fragment:12 », « pouvoir:bond », « zone:marche »,
//            « cig », « chutes », « rencontre:oba », « robot:renverse », « robot:redresse »).
//   rob    : { renverse, redresse } (le jeu ne compte pas les robots dans `etat`).
//   vu     : instantané de l'état déjà daté (pour repérer les ajouts).
// L'état réel est lu à chaque appel de `lignes()`; les dates viennent d'un sondage à chaque image.
//
// API : `jeu.mainsCourantes.lignes()` → [{ texte, ton: 'norm'|'ecart'|'dim', cle, t }], `.heure(secondes)`,
//   `.temps`, `.journal()` (le journal des transgressions s'il existe, sinon []), `.sale` (vrai si une
//   écriture a changé : le panneau se redessine).
// Évènements émis : `mains-courantes:ecriture { cle, t }` (une nouvelle écriture du joueur),
//   `mains-courantes:maj` (le registre du joueur a changé).
// Écoute : `robot:renverse`, `robot:redresse` (par le joueur), `transgression`, `partie:nouvelle`.

const R_FUT = 14; // rayon du fût de Hashira (hashira.js)
const R_SOCLE = 16.4; // rayon haut du socle (RAYON + 2.4)
const DEMI_COULOIR = 2.3; // m
const PILIER = { x0: 2.4, x1: 3.5 };
const Z_PORTE = R_FUT; // face sud du fût
const PORTE_L = 4.2, PORTE_H = 6.4;

const pad = (n) => String(n).padStart(2, '0');
const remplir = (gabarit, vars) => gabarit.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));

export const mainsCourantes = {
  nom: 'mainsCourantes',
  jeu: null,
  sale: true,
  _enAttente: false,

  preparer() {},

  init(jeu) {
    this.jeu = jeu;
    jeu.mainsCourantes = this;
    TITRES_ZONES['mains-courantes'] = TITRE_ZONE;

    jeu.on('robot:renverse', (ev) => {
      if (ev.par && ev.par !== 'joueur') return;
      const m = this.registre();
      m.rob.renverse++;
      m.dates['robot:renverse'] = m.temps;
      this.noter('robot:renverse');
    });
    jeu.on('robot:redresse', (ev) => {
      if (ev.par !== 'joueur') return;
      const m = this.registre();
      m.rob.redresse++;
      m.dates['robot:redresse'] = m.temps;
      this.noter('robot:redresse');
    });
    // le journal est écrit par un autre système : on se redessine au prochain passage
    jeu.on('transgression', () => this.marquer());
    jeu.on('partie:nouvelle', () => this.marquer());

    const k = jeu.zones.get('kasumi');
    this.construireEntree(k);
  },

  update(dt) {
    const jeu = this.jeu;
    if (!jeu?.etat) return;
    const m = this.registre();
    if (jeu.enPartie) m.temps += Math.min(dt, 0.25);
    this.sonder(m);
    // le journal des transgressions peut grossir sans évènement : on compare sa longueur
    const n = this.journal().length;
    if (n !== this._nJournal) {
      this._nJournal = n;
      this.marquer();
    }
  },

  // ------------------------------------------------------------------
  // Registre du joueur
  // ------------------------------------------------------------------
  /** L'enregistrement de l'état, créé au besoin (premier appel ou nouvelle partie). */
  registre() {
    const e = this.jeu.etat;
    if (e.mainsCourantes && e.mainsCourantes.vu) return e.mainsCourantes;
    // Partie neuve : tout ce qui existe est daté 0. Sauvegarde ancienne : rien n'est daté.
    const neuve = e.fragments.length === 0 && e.pouvoirs.length === 0 && (e.cigarettes?.fumees || 0) === 0 && !e.chutes;
    const m = {
      temps: 0,
      dates: {},
      rob: { renverse: 0, redresse: 0 },
      vu: neuve
        ? { fragments: [], pouvoirs: [], zones: [], fumees: 0, chutes: 0, rencontres: {} }
        : {
            fragments: [...e.fragments], pouvoirs: [...e.pouvoirs], zones: [...e.zonesVisitees],
            fumees: e.cigarettes?.fumees || 0, chutes: e.chutes || 0, rencontres: { ...e.rencontres },
          },
    };
    e.mainsCourantes = m;
    this.marquer();
    return m;
  },

  /** Compare l'état à l'instantané : toute différence reçoit la date courante. */
  sonder(m) {
    const e = this.jeu.etat;
    const v = m.vu;
    const nouveau = (cle) => {
      m.dates[cle] = m.temps;
      this.noter(cle);
    };
    for (const id of e.fragments) {
      if (!v.fragments.includes(id)) { v.fragments.push(id); nouveau(`fragment:${id}`); }
    }
    for (const p of e.pouvoirs) {
      if (!v.pouvoirs.includes(p)) { v.pouvoirs.push(p); nouveau(`pouvoir:${p}`); }
    }
    for (const z of e.zonesVisitees) {
      if (!v.zones.includes(z)) { v.zones.push(z); nouveau(`zone:${z}`); }
    }
    const fumees = e.cigarettes?.fumees || 0;
    if (fumees !== v.fumees) { v.fumees = fumees; nouveau('cig'); }
    if ((e.chutes || 0) !== v.chutes) { v.chutes = e.chutes || 0; nouveau('chutes'); }
    for (const [k, n] of Object.entries(e.rencontres || {})) {
      if (n !== v.rencontres[k]) { v.rencontres[k] = n; nouveau(`rencontre:${k}`); }
    }
  },

  noter(cle) {
    this.sale = true;
    this.jeu.emettre('mains-courantes:ecriture', { cle, t: this.temps });
    this.jeu.emettre('mains-courantes:maj', {});
  },

  marquer() {
    this.sale = true;
  },

  get temps() {
    return this.jeu?.etat?.mainsCourantes?.temps || 0;
  },

  /** « 23 h 14 » pour un temps de jeu en secondes ; `null`/non numérique → « -- h -- ». */
  heure(s) {
    if (typeof s !== 'number' || !Number.isFinite(s)) return PAN.heureInconnue;
    const total = Math.floor(HEURE.depart + s);
    const hh = Math.floor(total / 3600) % 24;
    const mm = Math.floor(total / 60) % 60;
    return remplir(HEURE.gabarit, { hh: pad(hh), mm: pad(mm) });
  },

  /** Le journal des transgressions `{ id, quoi, ou, t }` s'il existe quelque part, sinon []. */
  journal() {
    const jeu = this.jeu;
    const e = jeu.etat;
    for (const c of [jeu.transgressions?.journal, e.journalTransgressions, e.transgressionsJournal, e.journal, e.transgressions?.journal]) {
      if (Array.isArray(c)) return c;
    }
    return [];
  },

  /**
   * Toutes les écritures de la ligne R-4, d'après l'état réel : d'abord les écarts (magenta),
   * puis le reste, le plus récent en premier (ce qui n'a pas de date, à la fin).
   */
  lignes() {
    const jeu = this.jeu;
    const e = jeu.etat;
    const m = this.registre();
    const h = (t) => this.heure(t);
    const norm = [];
    const ajouter = (cle, texte, ton = 'norm') => norm.push({ cle, texte, ton, t: m.dates[cle] });

    for (const z of e.zonesVisitees) {
      if (!NOMS_ZONES[z]) continue;
      ajouter(`zone:${z}`, remplir(ECRITURES.zone, { h: h(m.dates[`zone:${z}`]), zone: NOMS_ZONES[z] }));
    }
    for (const p of e.pouvoirs) {
      ajouter(`pouvoir:${p}`, remplir(ECRITURES.pouvoir, { h: h(m.dates[`pouvoir:${p}`]), pouvoir: NOMS_POUVOIRS[p] || p }));
    }
    const ids = new Set(FRAGMENTS.map((f) => f.id));
    for (const id of e.fragments) {
      if (!ids.has(id)) continue;
      ajouter(`fragment:${id}`, remplir(ECRITURES.fragment, { h: h(m.dates[`fragment:${id}`]), id }));
    }
    for (const [k, n] of Object.entries(e.rencontres || {})) {
      if (!n) continue;
      ajouter(`rencontre:${k}`, remplir(ECRITURES.rencontre, { h: h(m.dates[`rencontre:${k}`]), nom: NOMS_RENCONTRES[k] || k, n }));
    }
    const fumees = e.cigarettes?.fumees || 0;
    if (fumees > 0) {
      ajouter('cig', remplir(ECRITURES.cigarettes, { h: h(m.dates.cig), n: fumees }));
      ajouter('paquet', remplir(ECRITURES.paquet, { h: h(m.dates.cig), n: e.cigarettes?.paquet ?? 0 }));
      norm[norm.length - 1].t = m.dates.cig;
    }
    if (e.chutes > 0) ajouter('chutes', remplir(ECRITURES.chutes, { h: h(m.dates.chutes), n: e.chutes }));
    if (m.rob.renverse > 0) ajouter('robot:renverse', remplir(ECRITURES.robotRenverse, { h: h(m.dates['robot:renverse']), n: m.rob.renverse }));
    if (m.rob.redresse > 0) ajouter('robot:redresse', remplir(ECRITURES.robotRedresse, { h: h(m.dates['robot:redresse']), n: m.rob.redresse }));

    // Plus récent d'abord ; sans date à la fin ; l'ordre d'insertion départage.
    norm.sort((a, b) => (b.t ?? -1) - (a.t ?? -1));

    // Les écarts : le journal, puis, pour ce que l'état compte en plus, une ligne de repli par identifiant.
    const ecarts = [];
    const dansJournal = {};
    for (const j of this.journal()) {
      if (!j || typeof j !== 'object') continue;
      dansJournal[j.id] = (dansJournal[j.id] || 0) + 1;
      const vars = { h: h(j.t), quoi: j.quoi ?? '', ou: j.ou ?? '' };
      ecarts.push({
        cle: `ecart:${j.id}:${ecarts.length}`, ton: 'ecart', t: j.t,
        texte: remplir(j.ou ? ECRITURES.transgression : ECRITURES.transgressionSansLieu, vars),
      });
    }
    for (const [id, n] of Object.entries(e.transgressions || {})) {
      if (!/^T\d+$/.test(id)) continue;
      const reste = (Number(n) || 0) - (dansJournal[id] || 0);
      if (reste > 0) {
        ecarts.push({ cle: `ecart:${id}`, ton: 'ecart', t: null, texte: remplir(ECRITURES.ecartCompte, { h: h(null), id, n: reste }) });
      }
    }
    return [...ecarts, ...norm];
  },

  // ------------------------------------------------------------------
  // L'entrée, au pied de la tour
  // ------------------------------------------------------------------
  construireEntree(k) {
    const jeu = this.jeu;
    const g = new THREE.Group();
    g.name = 'entree-mains-courantes';
    const sombre = new THREE.MeshStandardMaterial({ color: 0x0b0718, roughness: 0.4, metalness: 0.6 });
    const bleu = new THREE.MeshBasicMaterial({ color: 0x6f8cff, toneMapped: false });
    const rose = new THREE.MeshBasicMaterial({ color: 0xff2bd6, toneMapped: false });
    const noir = new THREE.MeshBasicMaterial({ color: 0x05020f });
    const zFace = Z_PORTE + 0.12;

    this.percerSocle(k);

    // Baie : fond sombre, cadre bleu, liseré magenta au sol et au linteau.
    const baie = new THREE.Mesh(new THREE.PlaneGeometry(PORTE_L, PORTE_H), noir);
    baie.position.set(0, PORTE_H / 2, zFace);
    g.add(baie);
    const barre = (w, h, x, y, mat, z = zFace + 0.04) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.1), mat);
      b.position.set(x, y, z);
      g.add(b);
    };
    barre(0.14, PORTE_H + 0.14, -PORTE_L / 2, PORTE_H / 2, bleu);
    barre(0.14, PORTE_H + 0.14, PORTE_L / 2, PORTE_H / 2, bleu);
    barre(PORTE_L + 0.28, 0.14, 0, PORTE_H, bleu);
    barre(PORTE_L - 0.4, 0.06, 0, 0.5, rose);
    // lueur de seuil : large plaque au sol, lilas pâle, qui dit « ouvert à tous »
    const seuil = new THREE.Mesh(
      new THREE.PlaneGeometry(PORTE_L * 0.9, 2.4),
      new THREE.MeshBasicMaterial({ color: 0x8a5cff, transparent: true, opacity: 0.35, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    seuil.rotation.x = -Math.PI / 2;
    seuil.position.set(0, 0.34, zFace + 1.4);
    g.add(seuil);

    // Porche : deux piliers, un linteau avec enseigne.
    for (const s of [-1, 1]) {
      const px = s * (PILIER.x0 + PILIER.x1) / 2;
      const p = new THREE.Mesh(new THREE.BoxGeometry(PILIER.x1 - PILIER.x0, PORTE_H + 1.2, 3.8), sombre);
      p.position.set(px, (PORTE_H + 1.2) / 2, Z_PORTE + 1.7);
      g.add(p);
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.08, PORTE_H + 0.8, 0.08), s < 0 ? bleu : rose);
      l.position.set(s * (PILIER.x0 - 0.02), (PORTE_H + 0.8) / 2, Z_PORTE + 3.62);
      g.add(l);
    }
    const linteau = new THREE.Mesh(new THREE.BoxGeometry(PILIER.x1 * 2, 1.4, 3.8), sombre);
    linteau.position.set(0, PORTE_H + 0.7 + 0.2, Z_PORTE + 1.7);
    g.add(linteau);
    barre(PILIER.x1 * 2, 0.08, 0, PORTE_H + 0.2, bleu, Z_PORTE + 3.62);
    const plaque = (texte, couleur, w, h, y, vertical = false) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ map: signTexture(texte, couleur, vertical), transparent: true, toneMapped: false })
      );
      m.position.set(0, y, Z_PORTE + 3.62 + 0.03);
      g.add(m);
    };
    plaque(ENSEIGNES_SALLE.porte, '#6f8cff', 4.4, 1.1, PORTE_H + 0.9);
    // bandeau vertical sur chaque pilier, face à la rue : la rue le repère de loin
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(0.75, 4.6),
        new THREE.MeshBasicMaterial({ map: signTexture(ENSEIGNES_SALLE.linteau, s < 0 ? '#ff5ad0' : '#8a5cff', true), transparent: true, toneMapped: false })
      );
      m.position.set(s * (PILIER.x0 + PILIER.x1) / 2, 4.2, Z_PORTE + 3.62 + 0.03);
      g.add(m);
    }
    // piste lumineuse sur la place : deux filets qui mènent à la porte (le pâté est surélevé de 0,3 m)
    const filet = new THREE.MeshBasicMaterial({ color: 0x6f8cff, toneMapped: false });
    for (const s of [-1, 1]) {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 6.4), filet);
      f.rotation.x = -Math.PI / 2;
      f.position.set(s * 1.7, 0.34, Z_PORTE + 3.9 + 3.2);
      g.add(f);
    }
    k.scene.add(g);
    this.entreeGroupe = g;

    // retour en ville : devant la porte, le dos à la tour
    k.points ||= {};
    k.points.tour = { position: [0, 0, 20.5], yaw: Math.PI };

    jeu.zones.porte({
      zone: 'kasumi',
      position: [0, 1.5, Z_PORTE + 0.4],
      rayon: 4.6,
      libelle: INVITES_SALLE.entrer,
      vers: 'mains-courantes',
      point: 'entree',
    });
  },

  /**
   * Ouvre un couloir de 4,6 m dans le socle de Hashira, ses anneaux lumineux et ses colliders,
   * face au sud, sans modifier hashira.js : on retrouve les objets dans le groupe `hashira`.
   */
  percerSocle(k) {
    const groupe = k.scene.getObjectByName('hashira');
    // demi-angle du couloir vu du centre, à la hauteur du socle
    const demi = Math.asin(DEMI_COULOIR / (R_SOCLE + 1)) + 0.02;
    if (groupe) {
      for (const o of groupe.children) {
        const gm = o.geometry;
        const p = gm?.parameters;
        if (!p) continue;
        if (gm.type === 'CylinderGeometry' && Math.abs(p.radiusTop - R_SOCLE) < 0.01 && p.height === 1) {
          // x = r sin θ, z = r cos θ : le sud (+z) est θ = 0
          o.geometry = new THREE.CylinderGeometry(p.radiusTop, p.radiusBottom, p.height, 64, 1, false, demi, Math.PI * 2 - demi * 2);
          gm.dispose();
        } else if (gm.type === 'TorusGeometry' && (Math.abs(p.radius - (R_SOCLE + 1)) < 0.01 || Math.abs(p.radius - (R_FUT + 0.3)) < 0.01)) {
          const demiT = Math.asin(DEMI_COULOIR / p.radius) + 0.02;
          const ng = new THREE.TorusGeometry(p.radius, p.tube, p.radialSegments, p.tubularSegments, Math.PI * 2 - demiT * 2);
          // le tore, couché (rotation.x = π/2), place l'angle local φ en (cos φ, sin φ) → (x, z) ; +z = π/2
          ng.rotateZ(Math.PI / 2 + demiT);
          o.geometry = ng;
          gm.dispose();
        }
      }
    }
    // Colliders : les trois boîtes de hashira.js sont remplacées par un disque en escalier (rayon 16,4)
    // percé du même couloir. On les retrouve à leurs valeurs.
    const R = R_SOCLE;
    const o = R * 0.7;
    const egal = (a, b) => Math.abs(a - b) < 1e-6;
    const aRetirer = k.colliders.filter((c) => c.minY === undefined && (
      (egal(c.minX, -R) && egal(c.maxX, R) && egal(c.maxZ, o * 0.55)) ||
      (egal(c.minZ, -R) && egal(c.maxZ, R) && egal(c.maxX, o * 0.55)) ||
      (egal(c.minX, -o) && egal(c.maxX, o) && egal(c.maxZ, o))
    ));
    for (const c of aRetirer) k.colliders.splice(k.colliders.indexOf(c), 1);
    const pas = 0.7;
    const nouveaux = [];
    const demiLargeur = (u) => Math.sqrt(Math.max(0, R * R - u * u));
    // tranches en z (largeur prise au bord le plus éloigné : la boîte reste dans le disque)
    for (let z0 = -R; z0 < R; z0 += pas) {
      const z1 = Math.min(z0 + pas, R);
      const w = demiLargeur(Math.max(Math.abs(z0), Math.abs(z1)));
      if (w < 0.05) continue;
      if (z0 >= Z_PORTE - 0.01) {
        nouveaux.push({ minX: -w, maxX: -DEMI_COULOIR, minZ: z0, maxZ: z1 }, { minX: DEMI_COULOIR, maxX: w, minZ: z0, maxZ: z1 });
      } else nouveaux.push({ minX: -w, maxX: w, minZ: z0, maxZ: z1 });
    }
    // tranches en x (pour les bords nord et sud du disque)
    for (let x0 = -R; x0 < R; x0 += pas) {
      const x1 = Math.min(x0 + pas, R);
      const h = demiLargeur(Math.max(Math.abs(x0), Math.abs(x1)));
      if (h < 0.05) continue;
      const couloir = x1 > -DEMI_COULOIR && x0 < DEMI_COULOIR;
      nouveaux.push({ minX: x0, maxX: x1, minZ: -h, maxZ: couloir ? Math.min(h, Z_PORTE) : h });
    }
    // piliers du porche
    for (const s of [-1, 1]) {
      const a = s * PILIER.x0, b = s * PILIER.x1;
      nouveaux.push({ minX: Math.min(a, b), maxX: Math.max(a, b), minZ: Z_PORTE, maxZ: Z_PORTE + 3.6 });
    }
    k.colliders.push(...nouveaux);
  },
};
