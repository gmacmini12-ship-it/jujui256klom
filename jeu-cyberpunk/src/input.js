// Gestion centralisée du clavier.
// Les touches sont identifiées par `event.code` (position physique) :
// 'KeyW' désigne la touche Z sur un clavier AZERTY.
//
// Ce module peut être importé sous Node : il ne touche à `window` et
// `navigator` que dans `init()`.

// Libellés par défaut, pour une disposition AZERTY.
const LIBELLES_AZERTY = {
  KeyW: 'Z',
  KeyA: 'Q',
  KeyQ: 'A',
  KeyZ: 'W',
  KeyM: ',',
  Semicolon: 'M',
  Space: 'Espace',
  ShiftLeft: 'Maj',
  Escape: 'Échap',
};

// Codes dont les évènements gardent leur effet même quand l'entrée est bloquée.
const toujours = new Set(['Escape']);

// Ensembles d'état, remplis par les écouteurs et vidés par endFrame().
const enfoncees = new Set();
const pressees = new Set();     // enfoncées pendant l'image courante
const relachees = new Set();    // relâchées pendant l'image courante
const debutAppui = new Map();   // code -> instant d'enfoncement (ms)
const dernierAppui = new Map(); // code -> durée du dernier appui terminé (s)

let disposition = null;         // Map code -> touche, si l'API est disponible
let ecouteursInstalles = false;
const ecouteurs = {};

// Source de temps injectable (utile pour les tests).
const maintenant = () => (globalThis.performance?.now?.() ?? Date.now());

export const input = {
  /** Quand vrai (dialogue ouvert), les requêtes renvoient false / 0 sauf pour `toujours`. */
  bloque: false,

  /** Codes qui restent actifs même si `bloque` est vrai. */
  toujours,

  /** Source de temps en millisecondes (remplaçable pour les tests). */
  _now: maintenant,

  /** La touche est enfoncée. */
  isDown(code) {
    if (input._masque(code)) return false;
    return enfoncees.has(code);
  },

  /** Vrai uniquement pendant l'image où la touche vient d'être enfoncée. */
  pressed(code) {
    if (input._masque(code)) return false;
    return pressees.has(code);
  },

  /** Vrai uniquement pendant l'image où la touche vient d'être relâchée. */
  released(code) {
    if (input._masque(code)) return false;
    return relachees.has(code);
  },

  /** Durée d'appui courante en secondes (0 si relâchée ou bloquée). */
  heldFor(code) {
    if (input._masque(code)) return 0;
    const debut = debutAppui.get(code);
    if (debut === undefined) return 0;
    return (input._now() - debut) / 1000;
  },

  /** Durée en secondes du dernier appui terminé (0 si aucun). */
  lastHold(code) {
    return dernierAppui.get(code) ?? 0;
  },

  /** À appeler à la fin de chaque image : vide `pressed` et `released`. */
  endFrame() {
    pressees.clear();
    relachees.clear();
  },

  /** Libellé à afficher au joueur selon la disposition du clavier. */
  label(code) {
    const touche = disposition?.get(code);
    if (typeof touche === 'string' && touche.trim() !== '') {
      return touche.toUpperCase();
    }
    if (code in LIBELLES_AZERTY) return LIBELLES_AZERTY[code];
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    return code;
  },

  /**
   * Installe les écouteurs clavier/focus sur `window` (une seule fois) et
   * récupère la disposition réelle si l'API est disponible. Sans erreur si
   * l'API est absente ou échoue.
   */
  async init() {
    if (!ecouteursInstalles && typeof window !== 'undefined' && window.addEventListener) {
      ecouteursInstalles = true;
      window.addEventListener('keydown', ecouteurs.keydown);
      window.addEventListener('keyup', ecouteurs.keyup);
      window.addEventListener('blur', ecouteurs.blur);
    }

    try {
      const nav = globalThis.navigator;
      if (typeof nav?.keyboard?.getLayoutMap === 'function') {
        disposition = await nav.keyboard.getLayoutMap();
      }
    } catch {
      // Disposition indisponible : on garde les libellés par défaut.
    }
  },

  /** Enregistre un enfoncement (utilisé par l'écouteur keydown et les tests). */
  _down(code) {
    if (enfoncees.has(code)) return;
    enfoncees.add(code);
    pressees.add(code);
    debutAppui.set(code, input._now());
  },

  /** Enregistre un relâchement (utilisé par l'écouteur keyup et les tests). */
  _up(code) {
    if (!enfoncees.has(code)) return;
    enfoncees.delete(code);
    relachees.add(code);
    const debut = debutAppui.get(code);
    if (debut !== undefined) {
      dernierAppui.set(code, (input._now() - debut) / 1000);
    }
    debutAppui.delete(code);
  },

  /** Relâche toutes les touches enfoncées (perte de focus). */
  _relacheTout() {
    for (const code of [...enfoncees]) input._up(code);
  },

  /** Vrai si la requête doit être masquée à cause du blocage. */
  _masque(code) {
    return input.bloque && !toujours.has(code);
  },
};

// Écouteurs : `input` est référencé directement, donc pas de problème de `this`.
ecouteurs.keydown = (e) => {
  if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
  if (e.repeat) return;
  input._down(e.code);
};

ecouteurs.keyup = (e) => {
  input._up(e.code);
};

ecouteurs.blur = () => {
  input._relacheTout();
};
