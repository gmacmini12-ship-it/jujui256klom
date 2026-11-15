// Textes et réglages des personnages nommés de l'étape 2 (src/systems/personnages.js) :
// Oba, Kaede, le Kiosque à la veste bleue, Itsuki. Les dialogues sont dans dialogues-etape2.js.
// Rien ici ne touche aux secrets : ce sont les lignes que le Calque lit sur eux, leurs invites,
// leur apparence (bible §9) et le décor du karaoké.

// Invite « E — … » et lignes du Calque (la première ligne est le titre).
export const PERSONNAGES = {
  oba: {
    libelle: 'Parler à Oba',
    lignes: ['Oba Setsuko', 'Âge : 98 ans', 'Affectation : tabouret du salon de thé', 'Pensée : ouverte — halo vacillant'],
  },
  kaede: {
    libelle: 'Parler à Kaede',
    lignes: ['Kaede Morin', 'Affectation : réparation à la main (atelier 修理)', 'Horaire : toute la nuit', 'Pensée : ouverte — halo violet'],
  },
  kiosque: {
    libelle: 'Parler au Kiosque',
    lignes: ['Kiosque à la veste bleue', 'Fonction : boutique (tout est gratuit)', 'Stock : inconnu', 'Charte : service'],
  },
  itsuki: {
    libelle: 'Parler à Itsuki',
    lignes: ['Itsuki Mori', 'Affectation : chant (karaoké カラオケ)', 'Origine : réveillé en 2069', 'Pensée : ouverte — halo rose-violet'],
  },
};

// Apparence des silhouettes (src/systems/npc.js : variante 0 long manteau, 1 veste, 2 poncho, 3 assis).
// `penche` : inclinaison en avant (rad) ; `vacille` : amplitude du vacillement du halo.
export const APPARENCES = {
  oba: { variante: 3, couleurHalo: 0xe9a6ff, taille: 0.97, accessoire: 'canne', vacille: 0.3 },
  kaede: { variante: 1, couleurHalo: 0x8a7cff, taille: 0.98, accessoire: 'loupe', penche: 0.2 },
  itsuki: { variante: 1, couleurHalo: 0xd24bff, taille: 1.04, accessoire: 'micro' },
};

// Mima, quand le paquet change de mains (bible §7.3, T15, « donner »).
export const MIMA_DON_PAQUET = 'Vous venez de faire quelque chose que personne n’a fait ici depuis vingt-neuf ans. Je ne sais pas comment l’écrire dans le Registre. Je vais laisser la ligne vide.';

// La pose du Bond (bible §4.2) : fondu au noir, un temps, retour devant le fauteuil.
export const POSE_BOND = { fondu: 0.9, temps: 1900 };

// Décor du karaoké (Kasumi, façade est du bâtiment dont le toit porte le fragment 27).
export const KARAOKE = {
  enseigne: 'カラオケ',
  sousEnseigne: 'chant',
  paroles: ['♪ tout le monde chante faux ♪', '♪ personne ne s’en plaint ♪', '♪ la la la la ♪'],
};
