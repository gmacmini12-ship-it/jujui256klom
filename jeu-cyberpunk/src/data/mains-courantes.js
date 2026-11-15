// Textes de la Salle des Mains Courantes (bible §5.5) : le Registre écrit en continu,
// et, sur un pan de mur, les écritures de la ligne du joueur. Ton de registre :
// factuel, daté, sans jugement, sans prix ni monnaie (bible §2.3).
// Rien ici ne doit révéler les secrets de §2.6 : seuls des numéros de fragments, jamais leurs titres.
//
// Gabarits : `{nom}` est remplacé par la valeur du même nom (voir systems/mainsCourantes.js).

export const TITRE_ZONE = { titre: 'Salle des Mains Courantes', sous: '台帳の間' };

export const INVITES_SALLE = {
  entrer: 'Entrer dans la Salle des Mains Courantes',
  sortir: 'Sortir sur la place',
  page: 'Tourner la page',
};

// Enseignes de l'entrée, au pied de la tour.
export const ENSEIGNES_SALLE = {
  porte: '台帳の間', // « la salle du registre »
  linteau: '手摺', // « main courante »
};

// ---------------------------------------------------------------------------
// Le flux : lignes du Registre qui défilent sur les murs. Qui a pris quoi, quelle porte
// s'est ouverte pour qui. `ton` : 'norm' (bleu/lilas), 'vif' (blanc bleuté), 'ecart' (magenta).
// Poids : plus il est grand, plus la ligne revient.
// ---------------------------------------------------------------------------
export const FLUX_GABARITS = [
  { poids: 6, ton: 'norm', texte: '{h} — R-{r} — porte {porte} — ouverte, selon la ligne' },
  { poids: 5, ton: 'norm', texte: '{h} — R-{r} — porte {porte} — ouverte pour R-{r2}' },
  { poids: 4, ton: 'norm', texte: '{h} — R-{r} — bol {n} — donné à R-{r2}' },
  { poids: 3, ton: 'norm', texte: '{h} — R-{r} — lit {n} — prêté à R-{r2}' },
  { poids: 3, ton: 'norm', texte: '{h} — R-{r} — manteau {n} — refabriqué, en usage' },
  { poids: 3, ton: 'norm', texte: '{h} — R-{r} — toit {porte} — jardin — en usage' },
  { poids: 3, ton: 'norm', texte: '{h} — R-{r} — chanson donnée — écoutée par {n} lignes' },
  { poids: 3, ton: 'norm', texte: '{h} — R-{r} — garde de nuit — ancien R-{r2}' },
  { poids: 3, ton: 'norm', texte: '{h} — R-{r} — repas cuisiné à la main — partagé' },
  { poids: 3, ton: 'norm', texte: '{h} — R-{r} — cellule {porte} — réaffectée' },
  { poids: 2, ton: 'norm', texte: '{h} — R-{r} — porte {porte} — close, la règle ne nomme pas R-{r}' },
  { poids: 2, ton: 'norm', texte: '{h} — R-{r} — heure de karaoké — en usage' },
  { poids: 2, ton: 'norm', texte: '{h} — Porteur {n} — livraison — cellule {porte} — remise' },
  { poids: 2, ton: 'vif', texte: '{h} — R-{r} — droit d\'usage — révoqué, réaffecté à R-{r2}' },
  { poids: 1, ton: 'ecart', texte: '{h} — R-{r} — porte {porte} — sans ligne' },
];

export const FLUX_PORTES = ['3A', '3B', '7C', '9F', '12D', '2A', '5E', '14B', '8H', '1K'];

// ---------------------------------------------------------------------------
// Le pan de la ligne R-4.
// ---------------------------------------------------------------------------
export const PAN = {
  titre: 'LIGNE R-4',
  sousTitre: 'écritures en cours — {h}',
  pied: 'page {page} / {pages}',
  vide: 'aucune écriture',
  heureInconnue: '-- h --',
};

// Heure de la salle : le temps de jeu écoulé, compté à partir de 23 h 00.
export const HEURE = { depart: 23 * 3600, gabarit: '{hh} h {mm}' };

// Gabarits des écritures du joueur. Variables communes : {h} l'heure, {n} un nombre.
export const ECRITURES = {
  zone: '{h} — R-4 — zone « {zone} » — en usage',
  pouvoir: '{h} — R-4 — capacité inscrite : {pouvoir}',
  fragment: '{h} — R-4 — fragment n° {id} — lu',
  rencontre: '{h} — R-4 — parole échangée : {nom} — ×{n}',
  cigarettes: '{h} — R-4 — objet sans ligne consumé — ×{n}',
  paquet: '{h} — R-4 — objet sans ligne : {n} restantes dans le paquet',
  chutes: '{h} — R-4 — chute — ×{n}',
  robotRenverse: '{h} — R-4 — Glaneur renversé — ×{n}',
  robotRedresse: '{h} — R-4 — Glaneur redressé — ×{n}',
  // Journal des transgressions : { id, quoi, ou, t }
  transgression: '{h} — R-4 — {ou} — {quoi}',
  // Repli quand le journal est absent ou incomplet : seulement le compte de l'état.
  ecartCompte: '{h} — R-4 — écart {id} — ×{n} — sans ligne',
  transgressionSansLieu: '{h} — R-4 — {quoi}',
};

// Noms affichés des zones (liste blanche : une zone absente d'ici n'est pas écrite).
export const NOMS_ZONES = {
  clinique: 'Clinique du Réveil',
  kasumi: 'Kasumi',
  marche: 'Marché des Mains',
  toits: 'toits de Kasumi',
  conseils: 'Maison des Conseils',
  'mains-courantes': 'Salle des Mains Courantes',
  kura: 'Kura',
  scelle: 'Quartier Scellé',
  dehors: 'Lisière',
  cathedrales: 'Cathédrales',
};

export const NOMS_POUVOIRS = {
  calque: 'Calque',
  bond: 'Bond',
  sourdine: 'Sourdine',
  lecture: 'Lecture',
  echo: 'Écho',
  harnais: 'Harnais',
};

export const NOMS_RENCONTRES = {
  oba: 'Oba',
  kaede: 'Kaede',
  itsuki: 'Itsuki',
  kiosque: 'le Kiosque',
};
