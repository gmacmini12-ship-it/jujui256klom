// Les fins (bible §8). Écran de fin commun, fin 1 « Dormir encore » (le lit), fin 2 « Rester » (le Sceau).
// Les fins 3 à 5 viendront plus tard : elles appelleront `jeu.fins.terminer('fin3', { variante?, paragraphes? })`
// et ajouteront leur entrée dans `FINS` (src/data/fins.js : lignes de bilan en plus).
//
// API (`jeu.fins`) :
//   terminer(id, { variante, paragraphes })  écran de fin : fondu, épilogue, bilan, profil, puis écran titre
//                                            (fin 1 « cinquante » : relance d'une partie en 2126). Promesse.
//   sAllonger({ entree })                    le lit (fin 1) ; `entree: 'lit_question'` ouvre directement la question
//   sceau()                                  appelée à la cabine du Sceau (zone `maison`) ; promesse
//   enCours, occupe, dernier, memoire, reglages, bilan(), profilsNommes()
// Évènements : `fin:debut { id, variante }`, `fin:terminee { id, variante }`, `sceau:refus`, `lit:releve`.
//
// État : `etat.finsVues` (['fin1', …]), `etat.reveilChoisi`, `etat.prenomSceau`, `etat.cycle` (0 ; 1 en 2126),
//   `etat.fragmentsConnus` (fragments d'un cycle précédent, marqués dans la frise), `etat.messagePourLeN5`.
// Mémoire qui survit aux parties : localStorage `remanence.memoire` = { finsVues, variantes, messagePourCinq,
//   fragmentsConnus, cycle, relance }. Recopiée dans `etat` à chaque nouvelle partie.
//
// Mise en scène en TEMPS DE JEU (update(dt)) ; l'écran de fin (src/ui/fin.js) et les fondus de zone sont en temps réel.
import * as THREE from 'three';
import { profils } from '../state.js';
import { createFin } from '../ui/fin.js';
import { OUVERTURE } from '../data/ouverture.js';
import { FRAGMENTS } from '../data/fragments.js';
import {
  REGLAGES_FINS as R, TEXTES_FINS, EPILOGUES_REPLI, ACCUEIL_2126_REPLI, PRENOMS_REPLI, SALUTS_SCEAU_REPLI,
  INVITATION_ITSUKI_REPLI, DIALOGUES_FINS_REPLI, BILAN, CONTENANCE_PAQUET, PROFILS, FINS, FINS_TOTAL,
} from '../data/fins.js';

// Textes écrits par l'agent dialogues (peut manquer) : repli dans data/fins.js.
const _d4 = import.meta.glob('../data/dialogues-etape4.js', { eager: true });
const D4 = Object.values(_d4)[0] || null;

const CLE_MEMOIRE = 'remanence.memoire';
const lisse = (x) => (x < 0 ? 0 : x > 1 ? 1 : x * x * (3 - 2 * x));
const lerp = (a, b, k) => a + (b - a) * k;
const aTableau = (x) => (Array.isArray(x) ? x : x == null ? [] : [x]);

// ---------------------------------------------------------------- mémoire entre les parties
const memoireVide = () => ({ finsVues: [], variantes: {}, messagePourCinq: null, fragmentsConnus: [], cycle: 0, relance: false });
function lireMemoire() {
  try {
    const brut = typeof localStorage !== 'undefined' ? localStorage.getItem(CLE_MEMOIRE) : null;
    if (brut) {
      const m = JSON.parse(brut);
      if (m && typeof m === 'object') return { ...memoireVide(), ...m };
    }
  } catch (e) { /* stockage indisponible */ }
  return memoireVide();
}
function ecrireMemoire(m) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(CLE_MEMOIRE, JSON.stringify(m));
  } catch (e) { /* silence */ }
}

// ---------------------------------------------------------------- textes (dialogues de l'étape 4 ou replis)
function dialogueEtape4(nom, etat) {
  const table = D4?.DIALOGUES_ETAPE4;
  if (table) {
    if (typeof D4.choisirDialogueEtape4 === 'function') {
      let id = null;
      try { id = D4.choisirDialogueEtape4(nom, etat); } catch (e) { console.error('[fins] choisirDialogueEtape4 :', e); }
      if (id && table[id]) return table[id];
    }
    if (table[nom]) return table[nom]; // entrée directe
  }
  return DIALOGUES_FINS_REPLI[nom];
}

function paragraphes(x) {
  const liste = typeof x === 'string' ? x.split(/\n\s*\n/) : aTableau(x);
  return liste.map((p) => String(p).trim()).filter(Boolean);
}

function epilogue(id, variante) {
  const src = D4?.EPILOGUES?.[id];
  const repli = EPILOGUES_REPLI[id];
  if (id === 'fin1') return paragraphes(src?.[variante] ?? repli?.[variante]);
  return paragraphes(src?.texte ?? repli?.texte);
}

function phraseTesteur() {
  return paragraphes(D4?.EPILOGUES?.fin2?.testeur ?? EPILOGUES_REPLI.fin2.testeur).join(' ');
}

/** Accueil de la partie suivante (cycle ≥ 1) : { date, heure, mima: [texte…] }. */
function accueilCycle(cycle) {
  const src = D4?.ACCUEIL_2126;
  let a = { ...ACCUEIL_2126_REPLI };
  if (typeof src === 'string') a.mima = [src, ...a.mima.slice(1)]; // la réplique d'accueil écrite, puis la date et le souvenir
  else if (Array.isArray(src)) a.mima = src.map(String);
  else if (src && typeof src === 'object') {
    if (src.date) a.date = String(src.date);
    if (src.heure) a.heure = String(src.heure);
    const m = src.mima ?? src.repliques ?? src.lignes ?? src.texte;
    if (m) a.mima = aTableau(m).map((x) => (typeof x === 'string' ? x : x?.texte)).filter(Boolean);
  }
  if (cycle > 1) { // 2176, 2226… (seule 2126 est écrite)
    const annee = String(2076 + 50 * cycle);
    const f = (s) => s.replace('2126', annee);
    a = { date: f(a.date), heure: a.heure, mima: a.mima.map(f) };
  }
  return a;
}

let ouvertureOrigine = null;
/** Remplace la date et les phrases de l'ouverture pour un cycle ≥ 1 (le texte d'origine est remis au cycle 0). */
function appliquerOuverture(cycle) {
  if (!ouvertureOrigine) ouvertureOrigine = { lignes: OUVERTURE.lignes, mima: OUVERTURE.mima };
  if (cycle <= 0) {
    OUVERTURE.lignes = ouvertureOrigine.lignes;
    OUVERTURE.mima = ouvertureOrigine.mima;
    return;
  }
  const a = accueilCycle(cycle);
  OUVERTURE.lignes = ouvertureOrigine.lignes.map((l) => {
    if (l.classe === 'date') return { ...l, texte: a.date };
    if (l.classe === 'heure') return { ...l, texte: a.heure };
    return l;
  });
  OUVERTURE.mima = a.mima.map((texte, i) => ({
    texte,
    duree: Math.max(4.5, Math.min(8, texte.length * 0.08)),
    ...(i === 0 ? { debut: ouvertureOrigine.mima[0]?.debut } : {}),
  }));
}

// ---------------------------------------------------------------- bilan et profil
function lignesBilan(etat, id) {
  const L = [];
  const c = etat.cigarettes || {};
  if (c.fumees > 0) L.push(BILAN.cigarettes(c.fumees, CONTENANCE_PAQUET, c.reapprovisionnements | 0));
  const nf = (etat.fragments || []).length;
  if (nf > 0) L.push(BILAN.fragments(nf, FRAGMENTS.length));
  const portes = etat.transgressions?.T1 | 0;
  if (portes > 0) L.push(BILAN.portes(portes));
  if (etat.refus > 0) L.push(BILAN.refus(etat.refus));
  const mensonges = (etat.mensonges || []).length;
  if (mensonges > 0) L.push(BILAN.mensonges(mensonges));
  const doutes = (etat.doutesSemes || []).length;
  if (doutes > 0) L.push(BILAN.doutes(doutes));
  if (etat.soin > 0) L.push(BILAN.soin(etat.soin));
  if (etat.chutes > 0) L.push(BILAN.chutes(etat.chutes));
  L.push(...aTableau(FINS[id]?.bilanSupplement?.(etat)));
  return L.length ? L : [BILAN.rien];
}

// ---------------------------------------------------------------- le système
export const fins = {
  nom: 'fins',
  reglages: R,
  enCours: false, // l'écran de fin est ouvert (ou va s'ouvrir)
  occupe: false, // une mise en scène est en cours (lit, Sceau)
  dernier: null, // { id, variante, paragraphes, bilan, profils } de la dernière fin lancée
  memoire: memoireVide(),

  anims: [],
  jeton: 0, // augmenté à chaque nouvelle partie : les séquences en cours s'arrêtent
  fx: { halo: 0 }, // cible du halo du Sceau
  lumieres: new Map(),
  exposition: null,
  stand: null,
  entreeLit: null,
  marche: null,
  bulles: [],

  // -------------------------------------------------------------- initialisation
  init(jeu) {
    this.jeu = jeu;
    jeu.fins = this;
    this.ui = createFin();
    this.memoire = lireMemoire();
    this.synchroniser();
    jeu.accueil && (jeu.accueil.nbFins = jeu.etat.finsVues.length);

    this.construireNote();
    this.construireBulles();

    // Le lit : disponible dès qu'on est sorti une fois (la ville a été visitée)
    jeu.interact.ajouter({
      zone: 'clinique',
      position: [-3.2, 1.0, 1.8],
      rayon: R.lit.rayon,
      libelle: TEXTES_FINS.sAllonger,
      visible: () => this.litDisponible,
      action: () => this.sAllonger(),
    });
    jeu.interact.ajouter({
      zone: 'kasumi',
      position: R.note.position,
      rayon: R.note.rayon,
      libelle: TEXTES_FINS.lireNote,
      visible: () => !!this.memoire.messagePourCinq,
      action: () => this.lireNote(),
    });

    jeu.on('conversation:fin', (ev) => { if (ev.dormir && !this.enCours) this.entreeLit = 'lit_question'; });
    jeu.on('partie:nouvelle', () => this.surNouvellePartie());
    jeu.on('partie:debut', () => this.surReprise());
  },

  get litDisponible() {
    const jeu = this.jeu;
    return !!jeu && !this.occupe && !this.enCours && jeu.etat.zonesVisitees.includes('kasumi');
  },

  /** Recopie la mémoire dans `etat` (fins vues, message pour le n°5) et réciproquement. */
  synchroniser() {
    const { etat } = this.jeu;
    const vues = [...new Set([...(etat.finsVues || []), ...this.memoire.finsVues])];
    etat.finsVues = vues;
    this.memoire.finsVues = [...vues];
    if (this.memoire.messagePourCinq) etat.messagePourLeN5 = this.memoire.messagePourCinq;
    else if (typeof etat.messagePourLeN5 === 'string' && etat.messagePourLeN5) this.memoire.messagePourCinq = etat.messagePourLeN5;
    ecrireMemoire(this.memoire);
  },

  // -------------------------------------------------------------- boucle
  update(dt) {
    const jeu = this.jeu;
    // halo du Sceau : monte et descend lentement, sans effet à 0
    const u = jeu.film?.uniforms?.halo;
    if (u) {
      const cible = this.fx.halo;
      if (u.value !== cible) {
        const pas = dt / Math.max(0.5, R.sceau.dureeHalo);
        u.value = u.value < cible ? Math.min(cible, u.value + pas) : Math.max(cible, u.value - pas);
      }
    }
    this.animerNote(dt);
    this.majBulles();

    const gele = jeu.accueil?.visible && !jeu.sansSouris;
    if (!gele) {
      for (const a of [...this.anims]) {
        a.t += dt;
        const k = Math.min(1, a.t / a.d);
        a.fn(k);
        if (k >= 1) {
          this.anims.splice(this.anims.indexOf(a), 1);
          a.res();
        }
      }
      this.majMarche(dt);
    }

    // entrée différée vers le lit (conversation du palier 4)
    if (this.entreeLit && !this.occupe && !this.enCours && !jeu.dialogue?.estOuvert) {
      const e = this.entreeLit;
      this.entreeLit = null;
      this.versLit(e);
    }
  },

  apresRendu() {
    this.placerBulles();
  },

  anime(duree, fn) {
    return new Promise((res) => this.anims.push({ d: Math.max(1e-3, duree), t: 0, fn, res }));
  },
  attendre(s) {
    return this.anime(s, () => {});
  },

  drapeau(cle) {
    const d = this.jeu.etat.drapeaux;
    return Array.isArray(d) && d.includes(cle);
  },

  // -------------------------------------------------------------- lumière, son, caméra (fin 1)
  assombrir(k) {
    const jeu = this.jeu;
    const scene = jeu.zones.courante?.scene;
    if (!scene) return;
    scene.traverse((o) => {
      if (!o.isLight) return;
      if (!this.lumieres.has(o)) this.lumieres.set(o, o.intensity);
      o.intensity = this.lumieres.get(o) * lerp(1, R.lit.lumiereResiduelle, k);
    });
    if (this.exposition === null) this.exposition = jeu.renderer.toneMappingExposure;
    jeu.renderer.toneMappingExposure = this.exposition * lerp(1, R.lit.expositionResiduelle, k);
  },

  rallumer() {
    const jeu = this.jeu;
    for (const [o, i] of this.lumieres) o.intensity = i;
    this.lumieres.clear();
    if (this.exposition !== null) {
      jeu.renderer.toneMappingExposure = this.exposition;
      this.exposition = null;
    }
  },

  fermerSon(duree = 3) {
    this.jeu.audio?.regler({ pluie: 0, filtre: R.lit.sonFiltre, duree });
  },

  rouvrirSon(duree = 1.5) {
    const son = this.jeu.zones.courante?.ambiance?.son;
    if (son) this.jeu.audio?.regler({ pluie: son.pluie, filtre: son.filtre, duree });
  },

  /** Le joueur s'allonge (caméra vers le plafond). */
  async allonger() {
    const jeu = this.jeu;
    const cam = jeu.camera;
    jeu.player.controls.enabled = false;
    const p = jeu.player.position;
    const o = jeu.player.orientation();
    this.stand = { x: p.x, y: p.y, z: p.z, yaw: o.yaw, pitch: o.pitch };
    const dep = cam.position.clone();
    const [lx, ly, lz] = R.lit.posAllonge;
    const dy = Math.atan2(Math.sin(R.lit.yaw - o.yaw), Math.cos(R.lit.yaw - o.yaw)); // plus court chemin
    await this.anime(R.lit.dureeAllonger, (k) => {
      const e = lisse(k);
      cam.position.set(lerp(dep.x, lx, e), lerp(dep.y, ly, e) + Math.sin(Math.PI * e) * 0.1, lerp(dep.z, lz, e));
      jeu.player.regarder(o.yaw + dy * e, lerp(o.pitch, R.lit.pitch, e));
    });
  },

  /** Se relever, sans avoir fini. */
  async relever() {
    const jeu = this.jeu;
    const cam = jeu.camera;
    const s = this.stand;
    const dep = cam.position.clone();
    const o = jeu.player.orientation();
    const eyeY = s.y + 1.7;
    const dy = Math.atan2(Math.sin(s.yaw - o.yaw), Math.cos(s.yaw - o.yaw));
    await this.anime(R.lit.dureeRelever, (k) => {
      const e = lisse(k);
      cam.position.set(lerp(dep.x, s.x, e), lerp(dep.y, eyeY, e), lerp(dep.z, s.z, e));
      jeu.player.regarder(o.yaw + dy * e, lerp(o.pitch, s.pitch, e));
    });
    this.reposer();
  },

  /** Remet le joueur debout là où il s'est allongé (caméra et contrôles rendus). */
  reposer() {
    const jeu = this.jeu;
    const s = this.stand;
    if (s) jeu.player.teleporter(s.x, s.y, s.z, s.yaw, s.pitch);
    jeu.player.controls.enabled = true;
  },

  /** E sur le lit. `entree` : 'lit' (deux confirmations puis la question) ou 'lit_question' (la question seule). */
  async sAllonger({ entree = 'lit' } = {}) {
    const jeu = this.jeu;
    if (this.occupe || this.enCours || jeu.zones.nom !== 'clinique') return false;
    const J = this.jeton;
    this.occupe = true;
    jeu.suspendre('fin');
    try {
      await this.allonger();
      if (J !== this.jeton) return false;
      jeu.etat.reveilChoisi = null;
      await jeu.ouvrirDialogue(dialogueEtape4(entree, jeu.etat));
      if (J !== this.jeton) return false;
      const choix = jeu.etat.reveilChoisi;
      if (!['jamais', 'fini', 'besoin', 'cinquante'].includes(choix)) {
        await this.relever();
        if (J !== this.jeton) return false;
        jeu.reprendre('fin');
        jeu.emettre('lit:releve');
        return false;
      }
      this.fermerSon(R.lit.dureeEndormir);
      await this.anime(R.lit.dureeEndormir, (k) => this.assombrir(lisse(k)));
      if (J !== this.jeton) return false;
      await this.terminer('fin1', { variante: choix });
      return true;
    } finally {
      if (J === this.jeton) this.occupe = false;
    }
  },

  /** Conversation du palier 4 : on conduit le joueur au lit (fondu), puis la question s'ouvre. */
  async versLit(entree) {
    const jeu = this.jeu;
    if (this.occupe || this.enCours) return;
    const J = this.jeton;
    this.occupe = true; // verrouille pendant le trajet
    jeu.suspendre('fin');
    try {
      if (jeu.zones.nom !== 'clinique') await jeu.zones.aller('clinique', { point: R.lit.entree, titre: false });
      else jeu.player.teleporter(R.lit.entree.position[0], 0, R.lit.entree.position[2], R.lit.entree.yaw, R.lit.entree.pitch);
      if (J !== this.jeton) return;
    } finally {
      if (J === this.jeton) this.occupe = false;
    }
    await this.sAllonger({ entree }); // la suspension 'fin' reste posée sans interruption
  },

  // -------------------------------------------------------------- fin 2 : le Sceau
  prenom() {
    const { etat } = this.jeu;
    if (!etat.prenomSceau) {
      const liste = aTableau(D4?.PRENOMS).filter((x) => typeof x === 'string');
      const source = liste.length ? liste : PRENOMS_REPLI;
      etat.prenomSceau = source[Math.floor(Math.random() * source.length)];
      this.jeu.sauver();
    }
    return etat.prenomSceau;
  },

  saluts() {
    const l = aTableau(D4?.SALUTS_SCEAU).filter((x) => typeof x === 'string');
    return l.length ? l : SALUTS_SCEAU_REPLI;
  },

  invitation() {
    const l = aTableau(D4?.INVITATION_ITSUKI).filter((x) => typeof x === 'string');
    const t = l.length ? l[Math.floor(Math.random() * l.length)] : INVITATION_ITSUKI_REPLI;
    return t.replaceAll('{prenom}', this.prenom());
  },

  /** Appelée à l'entrée dans la cabine du Sceau. */
  async sceau() {
    const jeu = this.jeu;
    if (this.occupe || this.enCours) return false;
    const J = this.jeton;
    this.occupe = true;
    try {
      const avant = this.drapeau('sceau_accepte');
      await jeu.ouvrirDialogue(dialogueEtape4('sceau', jeu.etat));
      if (J !== this.jeton) return false;
      // accepté dans ce dialogue ; ou accepté avant mais la fin n'a jamais été menée à son terme (rechargement)
      const accepte = this.drapeau('sceau_accepte') && (!avant || !jeu.etat.finsVues.includes('fin2'));
      if (!accepte) {
        jeu.emettre('sceau:refus');
        return false;
      }
      await this.sequenceSceau(J);
      return true;
    } finally {
      if (J === this.jeton) this.occupe = false;
    }
  },

  async sequenceSceau(J) {
    const jeu = this.jeu;
    const C = R.sceau;
    jeu.suspendre('fin');
    jeu.player.controls.enabled = false;
    // le halo monte dans la cabine, la nappe se résout en accord majeur
    this.fx.halo = 1;
    jeu.audio?.accord('majeur', C.dureeAccord);
    await this.attendre(C.dureeHalo);
    if (J !== this.jeton) return;
    await jeu.zones.aller('kasumi', { point: C.point, titre: false });
    if (J !== this.jeton) return;
    this.prenom();
    // une minute de marche dans Kasumi
    jeu.player.controls.enabled = true;
    this.marche = { t: 0, saluts: new WeakSet(), nbSaluts: 0, dernierSalut: -99, invite: false, ligne: false };
    jeu.reprendre('fin');
    await new Promise((res) => { this.marche.fini = res; });
    if (J !== this.jeton) return;
    this.marche = null;
    // le message pour le Réveillé n°5
    jeu.suspendre('fin', { libererSouris: true });
    jeu.player.controls.enabled = false;
    jeu.etat.messagePourCinq = null;
    await jeu.ouvrirDialogue(dialogueEtape4('sceau_message', jeu.etat));
    if (J !== this.jeton) return;
    const m = jeu.etat.messagePourCinq;
    if (typeof m === 'string' && m.trim()) {
      this.memoire.messagePourCinq = m.trim();
      jeu.etat.messagePourLeN5 = m.trim();
      ecrireMemoire(this.memoire);
    }
    await this.terminer('fin2', { variante: 'rester' });
  },

  /** Saluts et invitation pendant la marche (temps compté seulement quand le joueur a la main). */
  majMarche(dt) {
    const m = this.marche;
    if (!m) return;
    const jeu = this.jeu;
    if (jeu.suspensions.size > 0 || jeu.zones.nom !== 'kasumi') return;
    const C = R.sceau;
    m.t += dt;
    const joueur = jeu.player.position;

    const itsuki = jeu.personnages?.positions?.itsuki;
    if (itsuki && !m.invite && m.t >= C.delaiInvitation) {
      const d = Math.hypot(itsuki.x - joueur.x, itsuki.z - joueur.z);
      if (d <= C.rayonItsuki) {
        m.invite = true;
        this.afficherBulle({ texte: this.invitation(), cible: () => ({ x: itsuki.x, y: itsuki.y + 2.3, z: itsuki.z }), duree: 8, classe: 'itsuki' });
      }
    }
    if (!m.invite && !m.ligne && m.t >= C.delaiLigne) {
      m.ligne = true;
      jeu.hud.notifier(TEXTES_FINS.parole('Itsuki', this.invitation()), { duree: 7 });
    }

    // un habitant proche, devant soi, salue par le prénom
    if (m.nbSaluts < C.maxSaluts && m.t - m.dernierSalut >= C.intervalleSalut && jeu.npc?.habitants) {
      const dir = jeu.camera.getWorldDirection(new THREE.Vector3());
      let meilleur = null;
      for (const n of jeu.npc.habitants) {
        if (m.saluts.has(n) || !(n.vis > 0.8)) continue;
        const vx = n.x - joueur.x;
        const vz = n.z - joueur.z;
        const d = Math.hypot(vx, vz);
        if (d < 1.4 || d > C.rayonSalut) continue;
        if ((vx * dir.x + vz * dir.z) / d < 0.25) continue;
        if (!meilleur || d < meilleur.d) meilleur = { n, d };
      }
      if (meilleur) {
        const liste = this.saluts();
        const texte = liste[Math.floor(Math.random() * liste.length)].replaceAll('{prenom}', this.prenom());
        const n = meilleur.n;
        if (this.afficherBulle({ texte, cible: () => ({ x: n.x, y: n.y + 2.55 * (n.taille || 1), z: n.z }), duree: 4.2 })) {
          m.saluts.add(n);
          m.nbSaluts++;
          m.dernierSalut = m.t;
        }
      }
    }

    if (m.t >= C.dureeMarche) {
      const fini = m.fini;
      m.fini = null;
      fini?.();
    }
  },

  // -------------------------------------------------------------- bulles (saluts) en HTML
  construireBulles() {
    this.racineBulles = document.createElement('div');
    document.body.appendChild(this.racineBulles);
    this.poolBulles = [];
    for (let i = 0; i < 4; i++) {
      const el = document.createElement('div');
      el.className = 'fin-bulle';
      this.racineBulles.appendChild(el);
      this.poolBulles.push(el);
    }
  },

  afficherBulle({ texte, cible, duree = 4, classe = '' }) {
    const el = this.poolBulles.find((e) => !this.bulles.some((b) => b.el === e));
    if (!el) return false;
    el.textContent = `« ${texte} »`;
    el.className = `fin-bulle ${classe}`;
    el.style.display = 'block';
    this.bulles.push({ el, cible, t0: this.jeu.t, duree, a: 0 });
    return true;
  },

  /** Opacité et durée de vie des bulles (à chaque pas du jeu, rendu ou non). */
  majBulles() {
    const jeu = this.jeu;
    for (let i = this.bulles.length - 1; i >= 0; i--) {
      const b = this.bulles[i];
      const veut = jeu.t - b.t0 < b.duree && jeu.zones.nom === 'kasumi' && !this.enCours;
      b.a += ((veut ? 1 : 0) - b.a) * 0.2;
      if (!veut && b.a < 0.03) {
        b.el.style.display = 'none';
        this.bulles.splice(i, 1);
      }
    }
  },

  /** Place les bulles au-dessus de leur porteur (après le rendu : la caméra est à jour). */
  placerBulles() {
    if (!this.bulles.length) return;
    const cam = this.jeu.camera;
    const w = innerWidth;
    const h = innerHeight;
    const v = this._v || (this._v = new THREE.Vector3());
    for (const b of this.bulles) {
      const c = b.cible();
      v.set(c.x, c.y, c.z).project(cam);
      const dehors = v.z > 1 || v.z < -1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1;
      b.el.style.opacity = dehors ? '0' : (b.a * 0.95).toFixed(2);
      if (!dehors) {
        const x = Math.round((v.x * 0.5 + 0.5) * w);
        const y = Math.round((-v.y * 0.5 + 0.5) * h);
        b.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
      }
    }
  },

  // -------------------------------------------------------------- le message pour le n°5 (toit du karaoké)
  construireNote() {
    const jeu = this.jeu;
    const zone = jeu.zones.get('kasumi');
    const g = new THREE.Group();
    g.position.set(R.note.position[0], R.note.position[1] - 0.25, R.note.position[2]);
    const papier = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.012, 0.28),
      new THREE.MeshBasicMaterial({ color: 0xffeaff, toneMapped: false })
    );
    papier.rotation.y = -0.5;
    g.add(papier);
    const eclat = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.16, 0),
      new THREE.MeshBasicMaterial({ color: 0xff7ae6, transparent: true, opacity: 0.85, toneMapped: false })
    );
    eclat.position.y = 0.5;
    g.add(eclat);
    g.visible = false;
    zone.scene.add(g);
    this.noteGroupe = g;
    this.noteEclat = eclat;
  },

  animerNote() {
    const g = this.noteGroupe;
    if (!g) return;
    const visible = !!this.memoire.messagePourCinq;
    if (g.visible !== visible) g.visible = visible;
    if (visible) {
      const t = this.jeu.t;
      this.noteEclat.rotation.y = t * 1.1;
      this.noteEclat.position.y = 0.5 + Math.sin(t * 1.6) * 0.06;
    }
  },

  lireNote() {
    const m = this.memoire.messagePourCinq;
    if (!m) return;
    this.jeu.ouvrirDialogue({
      debut: 'n1',
      noeuds: { n1: { qui: '', texte: `${TEXTES_FINS.note.entete}\n\n${TEXTES_FINS.note.texte(m)}` } },
    });
  },

  // -------------------------------------------------------------- l'écran de fin
  /** Profils (clés) et leurs noms affichés. */
  profilsNommes() {
    return profils().map((p) => PROFILS.noms[p] || p);
  },

  /** Lignes du bilan calculées depuis `etat`. */
  bilan(id = 'fin1') {
    return lignesBilan(this.jeu.etat, id);
  },

  construirePages(id, variante, paras) {
    const etat = this.jeu.etat;
    const epi = (paras || epilogue(id, variante)).map((texte) => [{ texte }]);
    const pr = profils();
    if (id === 'fin2' && pr.includes('testeur')) epi.push([{ texte: phraseTesteur(), classe: 'mima' }]);
    const bilan = lignesBilan(etat, id);
    const profil = [{ texte: PROFILS.entete, classe: 'titre' }];
    if (pr.length) {
      profil.push({ texte: pr.map((p) => PROFILS.noms[p]).join(' · '), classe: 'nom' });
      for (const p of pr) profil.push({ texte: PROFILS.repliques[p], classe: 'mima' });
    } else {
      profil.push({ texte: PROFILS.aucun, classe: 'mima' });
    }
    this.dernier = { id, variante, paragraphes: epi.map((u) => u[0].texte), bilan, profils: pr };
    return [
      { nom: 'epilogue', unites: epi },
      { nom: 'bilan', unites: [bilan.map((texte) => ({ texte }))] },
      { nom: 'profil', unites: [profil.map((l) => ({ ...l }))] },
    ];
  },

  /** Écran de fin : fondu, épilogue, bilan, profil, puis l'écran titre (ou la relance de 2126). */
  async terminer(id, { variante = null, paragraphes: paras = null } = {}) {
    const jeu = this.jeu;
    if (this.enCours) return false;
    const J = this.jeton;
    this.enCours = true;
    jeu.emettre('fin:debut', { id, variante });
    if (jeu.dialogue?.estOuvert) jeu.dialogue.fermer();

    // enregistré tout de suite : un rechargement en plein épilogue garde la fin
    const { etat } = jeu;
    if (!etat.finsVues.includes(id)) etat.finsVues.push(id);
    if (!this.memoire.finsVues.includes(id)) this.memoire.finsVues.push(id);
    if (variante) {
      const v = (this.memoire.variantes[id] ||= []);
      if (!v.includes(variante)) v.push(variante);
    }
    ecrireMemoire(this.memoire);
    jeu.sauver();

    jeu.suspendre('fin', { libererSouris: true });
    jeu.masquerMima('fin', true);
    const pages = this.construirePages(id, variante, paras);
    await this.ui.assombrir(2.2);
    if (J !== this.jeton) return false;
    await this.ui.jouer(pages);
    if (J !== this.jeton) return false;

    if (id === 'fin1' && variante === 'cinquante') await this.relancer();
    else this.retourTitre();
    jeu.emettre('fin:terminee', { id, variante });
    return true;
  },

  /** Écran titre après la fin ; « Reprendre » rend la partie là où elle était (debout, lumière et son rendus). */
  retourTitre() {
    const jeu = this.jeu;
    this.rallumer();
    this.rouvrirSon(1);
    this.fx.halo = 0;
    jeu.audio?.accord('defaut', 3);
    if (this.stand) {
      this.reposer();
      this.stand = null;
    } else {
      jeu.player.controls.enabled = true;
    }
    this.occupe = false;
    jeu.enPartie = false;
    if (jeu.accueil) {
      jeu.accueil.aUnePartie = true;
      jeu.accueil.nbFins = jeu.etat.finsVues.length;
      jeu.accueil.montrer('titre');
    }
    // la couche noire reste sous l'écran titre jusqu'à la reprise
  },

  /** « Dans cinquante ans » : nouvelle partie à la Clinique, en 2126, Mima se souvient. */
  async relancer() {
    const jeu = this.jeu;
    const m = this.memoire;
    m.fragmentsConnus = [...new Set([...(m.fragmentsConnus || []), ...jeu.etat.fragments])].sort((a, b) => a - b);
    m.cycle = (m.cycle || 0) + 1;
    m.relance = true;
    ecrireMemoire(m);
    this.stand = null;
    this.rallumer();
    this.rouvrirSon(0.5);
    this.fx.halo = 0;
    jeu.nouvellePartie();
  },

  // -------------------------------------------------------------- nouvelle partie, reprise
  surNouvellePartie() {
    const jeu = this.jeu;
    const { etat } = jeu;
    this.jeton++;
    this.anims.length = 0;
    this.occupe = false;
    this.enCours = false;
    this.marche = null;
    this.entreeLit = null;
    this.stand = null;
    this.rallumer();
    this.fx.halo = 0;
    if (jeu.film?.uniforms?.halo) jeu.film.uniforms.halo.value = 0;
    jeu.audio?.accord('defaut', 0.1);
    jeu.player.controls.enabled = true;

    // mémoire entre les parties
    const m = this.memoire;
    etat.finsVues = [...new Set([...(etat.finsVues || []), ...m.finsVues])];
    etat.messagePourLeN5 = m.messagePourCinq;
    if (m.relance) {
      etat.cycle = m.cycle;
      etat.fragments = [...m.fragmentsConnus];
      etat.fragmentsConnus = [...m.fragmentsConnus];
      m.relance = false;
    } else {
      etat.cycle = 0;
      m.cycle = 0;
      m.fragmentsConnus = [];
    }
    m.finsVues = [...etat.finsVues];
    ecrireMemoire(m);
    appliquerOuverture(etat.cycle);
    jeu.sauver();

    jeu.reprendre('fin');
    jeu.masquerMima('fin', false);
    if (this.ui.visible) this.ui.cacher(1.4);
    if (jeu.accueil) jeu.accueil.nbFins = etat.finsVues.length;
  },

  surReprise() {
    const jeu = this.jeu;
    // « Reprendre » depuis l'écran titre qui suit une fin
    if (this.ui?.visible && !this.ui.enCours) {
      this.enCours = false;
      jeu.reprendre('fin');
      jeu.masquerMima('fin', false);
      this.ui.cacher(1.4);
    }
  },
};
