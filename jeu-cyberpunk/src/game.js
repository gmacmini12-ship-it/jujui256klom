// Contexte de jeu partagé.
//
// `jeu` est un objet unique, rempli par main.js au démarrage. Les modules
// (zones, systèmes) l'importent et lisent ce dont ils ont besoin :
//
//   import { jeu } from '../game.js';
//   jeu.hud.mima('…');  jeu.zones.courante.scene;  jeu.etat.fragments;
//
// Ce fichier ne construit rien (pas de Three.js, pas de DOM) : on peut
// l'importer depuis n'importe où sans risque d'import circulaire.
// Voir docs/architecture.md.

export const jeu = {
  // --- Rempli par main.js (null tant que le démarrage n'est pas fait) ---
  renderer: null, // THREE.WebGLRenderer
  composer: null, // EffectComposer (rendu basse résolution + bloom + film)
  bloom: null, // UnrealBloomPass (réglé par l'ambiance de zone)
  film: null, // ShaderPass de la passe finale
  camera: null, // THREE.PerspectiveCamera (toujours ajoutée à la scène courante)
  player: null, // voir player.js : position, update, teleporter, regarder, setColliders…
  hud: null, // ui/hud.js : mima(texte), notifier(texte), invite(texte), titre(), fondu()
  dialogue: null, // ui/dialogue.js : ouvrir(DIALOGUES.x) -> Promise
  frise: null, // ui/frise.js : ouvrir(), fermer(), basculer()
  interact: null, // interact.js : ajouter({ position, rayon, libelle, action, zone, visible? })
  zones: null, // zones/manager.js : courante, nom, get(nom), aller(nom, opts), porte(...)
  etat: null, // state.js : l'objet `etat` (jamais remplacé, seulement muté)
  sauver: null, // state.js : sauver()
  input: null, // input.js : isDown, pressed, released, heldFor, label
  smoking: null, // smoking.js : trigger(), etat ('idle' | 'lighting' | 'hold' | 'puff' | 'discard')
  audio: null, // effects.js : start, toggle, bip, regler
  rain: null, // pluie (déplacée par le gestionnaire de zones)

  /** Scène affichée en ce moment (raccourci de jeu.zones.courante.scene). */
  get scene() {
    return this.zones?.courante?.scene ?? null;
  },

  /** Temps de jeu écoulé (s), avancé par la boucle. */
  t: 0,

  /**
   * Réglages lus AVANT la construction des zones. Un système peut les modifier
   * dans son `preparer(jeu)` (par exemple réserver le pâté central de la ville).
   */
  config: {
    ville: {
      blocsReserves: [], // [[i, j], …] pâtés laissés vides (trottoir seul), 0 ≤ i, j < 9
    },
  },

  // ---------------------------------------------------------------------
  // Systèmes : objets { nom, preparer?, init?, update?, surZone?, apresRendu? }
  // ---------------------------------------------------------------------
  systemes: [],

  // ---------------------------------------------------------------------
  // Suspensions : tant qu'il y en a une, le joueur ne bouge plus, n'interagit
  // plus, et la souris est libérée (dialogue, frise) ou non (ouverture, fondu).
  // ---------------------------------------------------------------------
  suspensions: new Set(),

  /** Vrai si le joueur a la main : partie lancée, souris prise (ou mode sans souris), rien d'ouvert. */
  get jouable() {
    return this.enPartie && this.suspensions.size === 0 && (this.sansSouris || !!this.player?.controls.isLocked);
  },

  /** La partie a été lancée depuis l'écran d'accueil. */
  enPartie: false,

  /** Mode sans verrouillage de souris (tests, `?sanssouris`). */
  sansSouris: false,
};

// -------------------------------------------------------------------------
// Évènements : jeu.on(nom, fn) / jeu.off(nom, fn) / jeu.emettre(nom, donnees)
// `emettre` renvoie `donnees`, ce qui permet aux écouteurs de répondre
// (par exemple mettre `annule = true` sur 'cigarette:avant').
// -------------------------------------------------------------------------
const ecouteurs = new Map();

jeu.on = function on(nom, fn) {
  if (!ecouteurs.has(nom)) ecouteurs.set(nom, new Set());
  ecouteurs.get(nom).add(fn);
  return () => jeu.off(nom, fn);
};

jeu.off = function off(nom, fn) {
  ecouteurs.get(nom)?.delete(fn);
};

jeu.emettre = function emettre(nom, donnees = {}) {
  for (const fn of [...(ecouteurs.get(nom) || [])]) {
    try {
      fn(donnees, jeu);
    } catch (e) {
      console.error(`[jeu] écouteur de « ${nom} » :`, e);
    }
  }
  return donnees;
};

// -------------------------------------------------------------------------
// Systèmes
// -------------------------------------------------------------------------
let demarre = false;

/** Ajoute un système. S'il est ajouté après le démarrage, son init() est appelé tout de suite. */
jeu.enregistrer = function enregistrer(systeme) {
  jeu.systemes.push(systeme);
  if (demarre) appeler(systeme, 'init');
  return systeme;
};

function appeler(s, methode, ...args) {
  if (typeof s[methode] !== 'function') return;
  try {
    s[methode](...args, jeu);
  } catch (e) {
    console.error(`[jeu] système « ${s.nom || '?'} », ${methode} :`, e);
  }
}

/** Appelé par main.js avant la construction des zones. */
jeu._preparerSystemes = () => jeu.systemes.forEach((s) => appeler(s, 'preparer'));
/** Appelé par main.js quand tout est construit. */
jeu._initSystemes = () => {
  demarre = true;
  jeu.systemes.forEach((s) => appeler(s, 'init'));
};
jeu._updateSystemes = (dt, t) => jeu.systemes.forEach((s) => appeler(s, 'update', dt, t));
jeu._surZone = (nom, zone) => jeu.systemes.forEach((s) => appeler(s, 'surZone', nom, zone));
jeu._apresRendu = () => jeu.systemes.forEach((s) => appeler(s, 'apresRendu'));

// -------------------------------------------------------------------------
// Suspensions
// -------------------------------------------------------------------------

/**
 * Fige le joueur pour la raison `raison` ('dialogue', 'frise', 'ouverture', 'porte'…).
 * `{ libererSouris: true }` rend aussi le curseur.
 */
jeu.suspendre = function suspendre(raison, { libererSouris = false } = {}) {
  jeu.suspensions.add(raison);
  if (jeu.input) jeu.input.bloque = true;
  jeu.interact?.masquer();
  if (libererSouris && jeu.player?.controls.isLocked) {
    jeu._liberationVoulue = true;
    jeu.player.controls.unlock();
  }
};

/** Lève une suspension ; quand il n'en reste plus, la souris est reprise. */
jeu.reprendre = function reprendre(raison) {
  jeu.suspensions.delete(raison);
  if (jeu.suspensions.size > 0) return;
  if (jeu.input) jeu.input.bloque = false;
  if (jeu.enPartie && !jeu.sansSouris && jeu.player && !jeu.player.controls.isLocked) {
    jeu._reprendreSouris?.();
  }
};

// -------------------------------------------------------------------------
// Bande de Mima masquée pour une ou plusieurs raisons ('dialogue', 'frise',
// 'cigarette'…) : elle ne réapparaît que quand plus aucune raison ne la masque.
// -------------------------------------------------------------------------
const masquesMima = new Set();
jeu.masquerMima = function masquerMima(raison, oui = true) {
  if (oui) masquesMima.add(raison);
  else masquesMima.delete(raison);
  jeu.hud?.masquerMima(masquesMima.size > 0);
};
