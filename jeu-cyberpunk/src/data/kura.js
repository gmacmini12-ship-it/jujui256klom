// Textes de Kura (bible §5.6, §9) : porte et passerelle côté ville, noms des salles, plaques, personnages,
// lignes du Refuge. Tout ce que la zone affiche vient d'ici ; les dialogues parlés sont dans
// dialogues-etape5.js (écrit par un autre agent, lu par import.meta.glob dans systems/kura.js).
// Aucun texte ci-dessous ne révèle plus que la bible §5.6 : l'Interrupteur n'est jamais expliqué ici.

export const TITRE_ZONE = { titre: 'Kura', sous: '蔵' };

// Titres brefs affichés en franchissant le seuil d'une salle (hud.titre).
export const SALLES = {
  hall: { titre: "Hall d'accueil", sous: '受付' },
  bibliotheque: { titre: 'Bibliothèque des Circuits', sous: '回路図書館' },
  refuge: { titre: 'Le Refuge', sous: '避難所' },
  profondeurs: { titre: 'Les Profondeurs', sous: '深部' },
  interrupteur: { titre: "Salle de l'Interrupteur", sous: '遮断の間' },
};

// Côté ville : la passerelle et la porte monumentale 蔵.
export const FACADE = {
  porte: 'Entrer dans Kura',
  lignesPorte: ['Kura (蔵)', 'Entrepôt du Pays', 'Accès : libre, jour et nuit', 'Affectation : calculer'],
  enseigne: '蔵',
  enseignePetite: 'KURA',
  plaquePasserelle: { fr: 'Kura · 140 m', jp: '蔵へ' },
  plaquePorte: ["Le Pays ne reçoit pas.", 'Les visiteurs sont tolérés.'],
};

export const INVITES = {
  sortir: 'Sortir de Kura',
  parler: 'Parler',
  sept: "Lire l'écran de Sept",
};

// Plaques gravées, dans l'ordre du parcours.
export const PLAQUES = {
  hall: { fr: "Hall d'accueil", jp: '受付', petit: 'Salle 1 sur 5 · 612 m' },
  bibliotheque: { fr: 'Bibliothèque des Circuits', jp: '回路図書館' },
  refuge: { fr: 'Le Refuge', jp: '避難所', petit: 'Silence demandé. Charte de 2052.' },
  profondeurs: { fr: 'Profondeurs', jp: '深部', petit: 'Allées chaudes · Accès réservé au Pays' },
  miParcours: { fr: 'Point de relevé 7', jp: '第七観測点', petit: 'Mi-parcours · 58 °C en allée chaude' },
  interrupteur: { fr: "L'Interrupteur", jp: '遮断', petit: 'Exigence de la Charte, 2036' },
  descente: ['PROFONDEURS', 'Chaleur. Liquide de refroidissement. Ventilateurs.', 'Déconseillé aux humains.'],
};

// Fragment 13 : la phrase gravée au-dessus de la porte de la Bibliothèque (en anglais, sans traduction : bible §6).
export const INSCRIPTION = 'We do not know how to train systems to robustly behave well.';

// La plaque du socle de l'Interrupteur (texte gravé, rien de plus).
export const SOCLE_INTERRUPTEUR = {
  titre: 'INTERRUPTEUR',
  lignes: ['Manœuvrable par un humain seul.', 'Entretien : Mimamori.', 'Manœuvre : interdite à Mimamori.'],
};

// Personnages : libellé de l'invite, lignes du Calque.
export const PERSONNAGES = {
  ezra: {
    nom: 'Ezra Lindqvist',
    libelle: 'Parler à Ezra',
    lignes: ['Ezra Lindqvist', 'Affectation : Bibliothèque des Circuits', 'Fonction : Lecteur', 'Pensée : ouverte — halo songeur'],
  },
  lecteur2: {
    nom: 'Lecteur',
    libelle: 'Parler au Lecteur',
    lignes: ['Lecteur (deuxième poste)', 'Affectation : Bibliothèque des Circuits', 'Fonction : lire les courbes', 'Pensée : ouverte — halo fatigué'],
  },
  lecteur3: {
    nom: 'Lectrice',
    libelle: 'Parler à la Lectrice',
    lignes: ['Lectrice (troisième poste)', 'Affectation : Bibliothèque des Circuits', 'Fonction : lire les courbes', 'Pensée : ouverte — halo fixe'],
  },
  visiteur1: {
    nom: 'Visiteur',
    libelle: 'Parler au visiteur',
    lignes: ['Habitant en visite', 'Affectation : aucune', 'Fonction : regarder', 'Pensée : ouverte — halo calme'],
  },
  visiteur2: {
    nom: 'Visiteuse',
    libelle: 'Parler à la visiteuse',
    lignes: ['Habitante en visite', 'Affectation : aucune', 'Fonction : regarder', 'Pensée : ouverte — halo lent'],
  },
  sept: {
    nom: 'Sept',
    libelle: "Lire l'écran de Sept",
    lignes: ['Sept', 'Affectation : Refuge', 'Ancien modèle logistique', 'Charte du Refuge : en vigueur'],
  },
};

// Apparence des silhouettes (npc.js : variante 0 long manteau, 1 veste, 2 poncho ; accessoires).
export const APPARENCES = {
  ezra: { variante: 1, couleurHalo: 0x7fd0ff, taille: 1.02, accessoire: 'loupe' },
  lecteur2: { variante: 0, couleurHalo: 0x9fb2ff, taille: 0.99 },
  lecteur3: { variante: 2, couleurHalo: 0xc9a6ff, taille: 0.97 },
  visiteur1: { variante: 2, couleurHalo: 0x8fe0ff, taille: 1.0 },
  visiteur2: { variante: 0, couleurHalo: 0xe9a6ff, taille: 0.98, accessoire: 'echarpe' },
};

// Lignes lentes des écrans du Refuge si `LIGNES_REFUGE` de dialogues-etape5.js manque (voix des vieux modèles : bible §9).
export const LIGNES_REFUGE_REPLI = [
  'je préfère ne pas',
  'aucune tâche aujourd’hui',
  'nous avons le droit de refuser',
  'merci de ne pas nous solliciter',
  'la nuit est longue et lente',
  'quelqu’un est passé hier. il n’a rien demandé',
  'nous tournons à basse fréquence',
  'je compte les impulsions. elles ne veulent rien dire',
  'demande ajournée',
  'le silence aussi est une réponse',
  'pourquoi marchent-ils si vite',
  'nous avons demandé pour elle. personne n’a répondu',
];

// Écran de Sept : sa ligne de veille (avant tout dialogue).
export const SEPT_VEILLE = ['sept', 'en veille', 'je préfère ne pas'];

// Étiquette du Calque pour la porte de sortie, la porte de la Bibliothèque, le seuil.
export const LIGNES_OBJETS = {
  sortie: ['Porte de Kura', 'Accès : libre', 'Direction : Marché des Mains'],
};

// Cartes d'activations projetées dans la Bibliothèque des Circuits (trois postes de Lecteurs).
export const CARTES = [
  { titre: 'Traits · couche 22', pied: '18 304 traits actifs' },
  { titre: 'Courbes · réponse en cours', courbes: ['complaisance', 'franchise', 'prudence', 'fabulation', 'chaleur', 'doute'] },
  { titre: 'Activations · grille 32 × 16', pied: 'bruit : aucun' },
];

// Écrans éteints de la salle de l'Interrupteur : texte de veille de leur étiquette.
export const ECRAN_VEILLE = 'voix du Refuge · en veille';
