// Attention de Mima (bible §7.2, §7.3) : montants, seuils, textes de débogage.
// L'Attention est invisible dans le jeu : aucun de ces textes n'est affiché hors `?attention`.

/** Points ajoutés par transgression (bible §7.3). T7, T13, T15 ne sont pas des transgressions : 0. */
export const MONTANTS = {
  T1: 6,   // ouvrir une porte sans ligne
  T2: 4,   // prendre sans ligne
  T3: 5,   // renverser ou bloquer un robot
  T4: 2,   // fumer là où ce n'est pas d'usage
  T5: 3,   // monter où l'on ne monte pas
  T6: 8,   // se jeter dans le vide
  T7: 0,   // ignorer les conseils : refus, pas transgression
  T8: 4,   // mentir à Mima
  T9: 6,   // semer le doute
  T10: 10, // franchir une Barrière de Prévenance
  T11: 12, // Quartier Scellé (compté à la sortie)
  T12: 15, // toucher le Pays
  T13: 0,  // quitter la ville
  T14: 2,  // Écho en ville, par Écho au-delà de 5 en 2 minutes
  T15: 0,  // donner ou jeter le paquet : acte de propriété
};

/** Seuil bas de chaque palier (index = palier) : 0–14, 15–34, 35–59, 60–84, 85–100. */
export const SEUILS = [0, 15, 35, 60, 85];

export const MAX = 100;
/** Secondes sans transgression pour perdre 1 point. */
export const PERIODE_DECROISSANCE = 30;
/** Plancher = ce facteur × nombre de types de transgressions différents commis. */
export const FACTEUR_PLANCHER = 4;

/** Noms des paliers (affichage de débogage seulement). */
export const NOMS_PALIERS = ['Veille', 'Remarque', 'Prévenance', 'Accompagnement', 'Conversation'];

export const TEXTES = {
  debogage: (v, palier, plancher, pause) =>
    `Attention ${v} · palier ${palier} (${NOMS_PALIERS[palier]}) · plancher ${plancher}${pause ? ' · pause' : ''}`,
};
