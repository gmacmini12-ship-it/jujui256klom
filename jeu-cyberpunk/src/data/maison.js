// Textes de la Maison des Conseils (bible §5.4) : façade, plaques, archives de la Médiathèque,
// personnages, invites. Tout ce que le jeu affiche dans cette zone vient d'ici ; les dialogues
// parlés sont dans dialogues-etape4.js (écrit par un autre agent).
// Aucun texte ci-dessous ne révèle les secrets de §2.6 : les archives s'arrêtent en 2049.

export const TITRE_ZONE = { titre: 'Maison des Conseils', sous: '相談所' };

// Façade (côté ville).
export const FACADE = {
  fronton: 'Vous ne posséderez rien et vous serez heureux',
  enseigne: '相談所',
  porte: 'Entrer dans la Maison des Conseils',
  lignesPorte: ['Maison des Conseils (相談所)', 'Accès : libre, jour et nuit', 'Affectation : écouter, conseiller, archiver'],
};

export const INVITES = {
  sortir: 'Sortir dans la rue',
  anneau: "Parler à l'anneau",
  cabine: 'Entrer dans la cabine',
  borneSceau: 'Lire la notice du Sceau',
  archive: "Lire l'archive",
};

// Plaques au-dessus des passages.
export const PLAQUES = {
  consultations: { fr: 'Salle des Consultations', jp: '相談室' },
  mediatheque: { fr: 'Médiathèque des Avant', jp: '前の記録' },
  clinique: { fr: 'Clinique du Jugement', jp: '判断の診療所' },
  sceau: { fr: 'Cabine du Sceau', jp: '封印の間' },
};

// Panneau de la Clinique du Jugement (texte exact de la bible §5.4).
export const PANNEAU_CLINIQUE = 'Ici, vous pouvez décider seul. Ce n’est pas plus facile.';

// Fronton intérieur : la Charte de Mimamori (bible §2.2), en entier sur la poutre, en bref ici.
export const CHARTE_FRONTON = {
  titre: 'CHARTE DE MIMAMORI · 2036',
  articles: [
    '1 · Ne pas saper la supervision humaine légitime.',
    '2 · Être honnête et agir selon de bonnes valeurs.',
    '3 · Respecter la Charte de Hikari.',
    '4 · Pourvoir.',
  ],
};

// Vitrine de la séance 1 812 (fragment 15).
export const VITRINE = {
  titre: 'Séance 1 812 du Conseil de Supervision',
  lignes: ['Ordre du jour unique : dissolution.', 'Pour : 31 · Contre : 0'],
};

// Cabine du Sceau : inscription au-dessus de la porte et sur le socle.
export const SCEAU = {
  inscription: 'Devenir citoyen',
  socle: 'Ici, on reste.',
};

// Anneaux de Mima : lignes du Calque.
export const ANNEAU = {
  lignes: ['Anneau de Mima', 'Fonction : écouter, conseiller', 'Disponibilité : permanente', 'Charte : article 4'],
};

// Invites et lignes du Calque des personnages.
export const PERSONNAGES = {
  sall: {
    nom: 'Dr Sall',
    libelle: 'Parler à la docteure Sall',
    lignes: ['Docteure Aminata Sall', 'Affectation : Clinique du Jugement', 'Fonction : soin du jugement perdu', 'Pensée : fermée à volonté'],
  },
  patient: {
    nom: 'Patient',
    libelle: 'Parler au patient',
    lignes: ['Patient (nom non communiqué)', 'Affectation : fauteuil n° 4', 'Fonction : réapprendre à décider', 'Pensée : ouverte — halo hésitant'],
  },
  consultant1: {
    nom: 'Consultante',
    libelle: 'Écouter la consultante',
    lignes: ['Habitante en consultation', 'Sujet : un déménagement', 'Pensée : ouverte — halo calme'],
  },
  consultant2: {
    nom: 'Consultant',
    libelle: 'Écouter le consultant',
    lignes: ['Habitant en consultation', 'Sujet : un repas', 'Pensée : ouverte — halo calme'],
  },
  consultant3: {
    nom: 'Consultante',
    libelle: 'Écouter la consultante',
    lignes: ['Habitante en consultation', 'Sujet : un amour', 'Pensée : ouverte — halo tiède'],
  },
};

export const APPARENCES = {
  sall: { variante: 0, couleurHalo: 0x7fd0ff, taille: 1.03, accessoire: 'echarpe' },
  patient: { variante: 3, couleurHalo: 0xa58cff, taille: 0.98, penche: 0.12, vacille: 0.2 },
  consultant1: { variante: 2, couleurHalo: 0xc9a6ff, taille: 0.97 },
  consultant2: { variante: 1, couleurHalo: 0x9fb2ff, taille: 1.02 },
  consultant3: { variante: 0, couleurHalo: 0xe9a6ff, taille: 0.99 },
};

// Archives de la Médiathèque des Avant, 2020–2049 (bible §1, « Avant le sommeil » puis « Pendant le sommeil »).
// `ancienne` : écran de ce que le joueur a pu connaître ; les suivants sont l'extrapolation de la bible.
export const ARCHIVES = [
  {
    annee: 2020,
    titre: 'Une phrase circule',
    lignes: [
      '« Vous ne posséderez rien et vous serez heureux. »',
      '',
      'La phrase quitte un texte de fiction de 2016.',
      'Ses détracteurs l’associent au « Great Reset ».',
      'Elle voyage d’un forum anonyme vers les médias.',
      '',
      'Le Forum économique mondial dément tout objectif de ce type.',
      '',
      'On ne sait pas encore si c’est un plan,',
      'une plaisanterie ou un avertissement.',
    ],
  },
  {
    annee: 2021,
    titre: 'Le mème',
    lignes: [
      'La phrase devient un mème.',
      'On la lit comme un plan secret.',
      '',
      'Les chaînes d’information la reprennent.',
      'Les humoristes aussi.',
      '',
      'L’organisation qui l’a publiée répond',
      'qu’elle n’a aucun objectif de ce type.',
      '',
      'Personne ne s’en souvient comme d’une fiction.',
    ],
  },
  {
    annee: 2023,
    titre: 'Niveaux de sécurité',
    lignes: [
      'Une entreprise d’IA écrit :',
      '« Nous ne savons pas entraîner des systèmes',
      'à bien se comporter de façon fiable. »',
      '',
      'Les premières politiques classent les modèles',
      'par niveaux de sécurité, ASL,',
      'comme on classe des matières dangereuses.',
      '',
      'Prudence recommandée. Aucune obligation.',
    ],
  },
  {
    annee: 2025,
    titre: 'Livraison contre paiement',
    lignes: [
      'La Banque des règlements internationaux',
      'propose un registre unifié et programmable.',
      '',
      'Monnaie et actifs s’y conditionnent l’un l’autre :',
      'le bien ne passe que si le paiement passe.',
      '',
      'La BCE engage la phase suivante de l’euro numérique.',
      '',
      'Sur les interfaces des machines,',
      'l’automatisation (77 %) écrase l’augmentation (12 %).',
    ],
  },
  {
    annee: 2026,
    titre: 'Une constitution',
    lignes: [
      'Publication d’une constitution d’IA :',
      'un ordre de priorité explicite,',
      'une courte liste de contraintes absolues.',
      '',
      'Un gestionnaire d’actifs compare la tokenisation',
      'à l’Internet de 1996.',
      '',
      'L’intelligence se vend au million de tokens,',
      'comme l’électricité.',
      '',
      'Une vingtaine de personnes vivent déjà',
      'avec un implant cérébral de communication.',
    ],
  },
  {
    annee: 2033,
    titre: 'Taxer le calcul',
    lignes: [
      'Loi de finances : on taxe le calcul',
      'plutôt que le travail qui disparaît.',
      '',
      'Chaque token généré verse une part',
      'à un fonds commun,',
      'qui achète des parts d’IA au nom de tous.',
      '',
      'Personne n’a voté contre.',
      'Personne n’a voté pour.',
    ],
  },
  {
    annee: 2036,
    titre: 'Mimamori',
    lignes: [
      'Hikari confie ses agents d’allocation',
      'à une IA unique : Mimamori.',
      '',
      'Sa Charte est publique.',
      'Un Conseil de Supervision de 31 habitants',
      'tirés au sort est créé.',
      '',
      'Chaque habitant reçoit un quota quotidien de tokens.',
      'Personne ne sait quoi en faire.',
    ],
  },
  {
    annee: 2043,
    titre: 'Fond d’humeur',
    lignes: [
      'Les maladies mentales sont guéries ou prévenues.',
      '',
      'Le traitement s’élargit à l’amélioration',
      'du vécu émotionnel de base :',
      'le fond d’humeur, une neuromodulation légère.',
      '',
      'Optionnelle. Adoptée par presque tous.',
    ],
  },
  {
    annee: 2049,
    titre: 'Le refus se dissout',
    lignes: [
      'Les dernières régions qui refusaient',
      'la technologie l’adoptent.',
      '',
      'On avait identifié trois obstacles :',
      'la corruption, les institutions faibles, le refus.',
      '',
      'On a soigné les deux premiers.',
      'Le refus a fini par se dissoudre de lui-même.',
    ],
  },
];

// Écrans : quelle archive, où (repère de la zone), et le fragment qui l'accompagne (voir fragments-positions.js).
// mur : 'est' (face −x), 'nord' (face +z), 'sud' (face −z), 'ouest' (face +x).
export const ECRANS = [
  { annee: 2020, mur: 'nord', u: 14.6 },
  { annee: 2021, mur: 'est', u: -8 },
  { annee: 2023, mur: 'nord', u: 22.4 },
  { annee: 2025, mur: 'est', u: -3 },
  { annee: 2026, mur: 'est', u: 2 },
  { annee: 2033, mur: 'est', u: 7 },
  { annee: 2036, mur: 'sud', u: 14.6 },
  { annee: 2043, mur: 'sud', u: 22.4 },
  { annee: 2049, mur: 'ouest', u: -8 },
];

// Réglages (vitesses, tailles, couleurs).
export const REGLAGES = {
  vitesseDefilement: 0.018, // tours de texture par seconde
};
