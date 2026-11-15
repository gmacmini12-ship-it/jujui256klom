// Réactions du monde à l'Attention (bible §7.2, systems/reactions.js) : réglages et TOUT le texte affiché.
// Rien ici ne doit ressembler à une punition : tout est doux, prévenant, un peu trop.

// ---------- Couleurs (palette violet / magenta / bleu électrique) ----------
export const COULEURS = {
  haloTeinte: 0xff7ae6,       // palier 1 : le halo des habitants vire au rose
  anneauMima: '#7df4ff',      // l'anneau de Mima (palier 4)
  magenta: '#ff2bd6',
  violet: '#8a5cff',
  bleu: '#3d6bff',
  pale: '#ffd9f8',
};

// ---------- Réglages ----------
export const REGLAGES = {
  vitesseNiveau: 2.2,          // 1/s : les réactions montent et se défont en ~1,5 s
  // palier 2 : enseignes
  enseignes: { rayon: 46, plein: 12, gain: 0.85 },   // au-delà de `rayon` m : rien ; en deçà de `plein` : gain complet (+85 %)
  // palier 3 : Veilleurs
  veilleur: { distance: 6, hauteur: 2.3, decalage: 0.5, seuilDeux: 75, echelle: 2.7 },
  // palier 3 : hologrammes
  holo: { rayonAppel: 150 },   // palier 4 : les panneaux à moins de 150 m affichent l'appel, les autres restent sur おかえり
  // palier 3 : portes « pour entretien » (entrées est et ouest du Marché des Mains)
  portes: { distanceMin: 3.4, distanceMax: 14, vitesseMin: 1.2, cosVers: 0.72, angleRouverture: 0.95, delaiMax: 14, grace: 10, hauteur: 4.4 },
  // palier 2 : paquets « à votre nom »
  paquets: { rayonVue: 2.6 },
  // palier 4 : écrans proches
  ecrans: { rayonKiosque: 90 },
};

// ---------- Textes ----------
export const HOLOGRAMME = {
  bienvenue: 'おかえり', // « bon retour » (palier 3)
  signature: 'R-4',
};

/** Repli si src/data/dialogues-attention.js (APPELS_PALIER4.ecran) n'existe pas. */
export const APPEL_REPLI = { texte: 'R-4. Puis-je vous parler ?', sousLigne: 'Vous pouvez dire non.' };

export const PORTE = {
  japonais: '整備中',
  titre: 'Fermé pour entretien',
  sous: 'Merci de votre patience. Un instant, et tout sera comme vous le souhaitez.',
};

export const PAQUET = {
  etiquette: 'R-4',
  sousEtiquette: 'à votre nom',
  libelle: 'Prendre le paquet mis de côté',
  lignes: ['Paquet — mis de côté', 'Usage : R-4', 'Prévu pour : R-4'],
  // Bande de Mima à la prise (une phrase, jamais un reproche).
  mima: [
    'Je l’avais gardé pour vous. Vous n’avez rien à demander.',
    'Celui-ci aussi était à vous. Tout est à vous. Rien n’est à vous.',
    'Vous n’avez pas besoin de prendre. Je vous le tends.',
  ],
  duree: 5,
};

/** Paquets posés par défaut (zone Kasumi) quand `jeu.transgressions` n'indique rien de plus près du joueur.
 *  `ancre` : 'marche:allee:i' (point d'allée), 'marche:kiosque', ou 'sortie' (trottoir devant la clinique). */
export const PAQUETS_DEFAUT = [
  { id: 'sortie', position: [39.5, 0.3, 48.5] },
  { id: 'marche-entree', position: [50.6, 0, 26.7] },
  { id: 'marche-kiosque', ancre: 'kiosque', decalage: [1.6, 0, 0] },
];
