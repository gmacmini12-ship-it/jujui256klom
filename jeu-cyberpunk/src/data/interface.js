// Textes de l'interface : écran d'accueil, pause, invites des objets, titres de zone.
// Tout texte affiché vit dans src/data/ (règle du plan).

export const ACCUEIL = {
  surtitre: 'HIKARI // 2076',
  titre: 'RÉMANENCE',
  commencer: 'COMMENCER',
  reprendre: 'REPRENDRE',
  continuer: 'CONTINUER',
  nouvellePartie: 'NOUVELLE PARTIE',
  confirmerNouvelle: 'EFFACER LA PARTIE EN COURS ? CLIQUER À NOUVEAU',
  pause: 'PAUSE',
  sourisPerdue: 'CLIQUER POUR REPRENDRE',
};

// Liste des commandes de l'écran d'accueil.
// `codes` : touches physiques (event.code) dont on affiche le libellé selon la
// disposition du clavier (input.label) ; `touche` : libellé fixe à la place.
export const COMMANDES = [
  { codes: ['KeyW', 'KeyA', 'KeyS', 'KeyD'], suffixe: ' / flèches', texte: 'se déplacer' },
  { touche: 'Souris', texte: 'regarder' },
  { touche: 'Maj', texte: 'courir' },
  { touche: 'Espace', texte: 'sauter' },
  { codes: ['KeyE'], texte: 'interagir' },
  { codes: ['KeyF'], texte: 'fumer' },
  { codes: ['KeyJ'], texte: "frise de l'absence" },
  { codes: ['KeyP'], texte: 'finesse des pixels' },
  { touche: 'M', texte: 'couper / remettre le son' },
  { touche: 'Échap', texte: 'pause' },
];

// Libellés des invites « E — … ».
export const INVITES = {
  sortirClinique: 'Sortir dans la rue',
  entrerClinique: 'Entrer dans la clinique',
  parlerMima: "Parler à l'anneau",
};

// Titres affichés à l'entrée d'une zone (hud.titre). `sous` est facultatif.
export const TITRES_ZONES = {
  clinique: { titre: 'Clinique du Réveil', sous: '治療所' },
  kasumi: { titre: 'Kasumi', sous: '霞' },
};

// Enseignes posées par les zones elles-mêmes (façade de la clinique dans la ville…).
export const ENSEIGNES = {
  clinique: '治療所',
};
