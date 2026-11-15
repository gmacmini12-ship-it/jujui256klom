// Emplacement des fragments dans le monde (voir src/data/fragments.js pour les textes).
//
// Ajouter un fragment = ajouter une ligne ici ; rien d'autre à écrire :
//   { id, zone, position: [x, y, z], support?, invite? }
//   - id        numéro du fragment (src/data/fragments.js) ; sa `condition` éventuelle
//               (un pouvoir) le garde invisible et non prenable tant que le joueur ne l'a pas.
//   - zone      nom de la zone ; une zone qui n'existe pas (encore) est simplement ignorée.
//   - position  centre de l'éclat, dans le repère de la zone (le joueur a les yeux à 1,75 m).
//   - support   facultatif, un décor simple posé sous/derrière l'éclat :
//               { type: 'papier' | 'autocollant' | 'affiche', position: [x, y, z], yaw? }
//               (yaw 0 : la face regarde vers +z ; π/2 vers +x ; π vers −z ; −π/2 vers −x).
//   - invite    libellé de l'invite « E — … » (sinon TEXTES_FRAGMENTS.invite).
//   - rayon     facultatif : portée en mètres (2,4 par défaut).
//   - taille    facultatif : échelle de l'éclat et de son halo (1 par défaut ; plus grand pour
//               un fragment qu'on doit repérer de loin).
//
// Clinique : repère de la pièce, voir ANCRES dans src/zones/clinique.js.
// Kasumi : repère de la ville ; la porte de la clinique donne en (41, 44), le carrefour est en (30, 30).

export const TEXTES_FRAGMENTS = {
  invite: "Ramasser l'éclat",
  notification: (f, touche) => `Fragment retrouvé : ${f.titre}  ·  Frise (${touche})`,
};

export const POSITIONS_FRAGMENTS = [
  // 1 : le casier de la clinique, devant la veste (mur est).
  { id: 1, zone: 'clinique', position: [5.95, 1.65, -2.2], invite: 'Fouiller le casier' },

  // 2 : la borne de la clinique, au-dessus de son écran.
  { id: 2, zone: 'clinique', position: [4.6, 1.9, -3.45], invite: 'Lire la borne' },

  // 3 : un vieil autocollant sur le lampadaire d'angle, juste au nord de la porte de la clinique.
  {
    id: 3, zone: 'kasumi', position: [39.0, 1.75, 39.0],
    support: { type: 'autocollant', position: [39.31, 1.5, 39.31], yaw: -Math.PI * 0.75 },
    invite: "Regarder l'autocollant",
  },

  // 4 : une affiche décollée sur la façade de la clinique, côté rue.
  {
    id: 4, zone: 'kasumi', position: [39.95, 1.75, 53.5],
    support: { type: 'affiche', position: [40.88, 1.75, 53.5], yaw: -Math.PI / 2 },
    invite: "Regarder l'affiche",
  },

  // 25 : sous l'oreiller du lit vide.
  {
    id: 25, zone: 'clinique', position: [-4.1, 1.08, -2.4],
    support: { type: 'papier', position: [-4.1, 0.8, -2.4], yaw: 0.5 },
    invite: "Soulever l'oreiller",
  },

  // 27 : toit du karaoké (カラオケ), lot sud-est du pâté de la clinique : (60-79) × (60-79), toit à 30,05 m.
  // On n'y monte qu'au Bond : depuis le toit A (18,9 m) puis son étage technique (25,7 m), saut vers le nord du
  // toit du karaoké. Le papier est posé sur une caisse (src/systems/toits.js, PAPIER_K) ; l'éclat flotte au-dessus.
  {
    id: 27, zone: 'kasumi', position: [68.5, 32.85, 62.0], taille: 3, rayon: 3,
    support: { type: 'papier', position: [68.5, 30.78, 62.0], yaw: 0.4 },
    invite: 'Lire le papier',
  },

  // ---- Marché des Mains (positions de `marche.pointsFragments`, src/systems/marche.js) ----
  // Les étals sont posés sur le trottoir (0,3 m) : les hauteurs ci-dessous sont absolues.

  // 8 : l'étiquette « 1,20 » collée sous le comptoir de l'étal sans personne (raviolis, côté sud, partie ouest).
  // L'éclat est devant la nappe, plus bas que l'objet « Regarder l'étal » du marché : on le vise en baissant les yeux.
  {
    id: 8, zone: 'kasumi', position: [64.45, 0.62, 37.85], rayon: 3.1,
    support: { type: 'autocollant', position: [64.45, 0.6, 38.33], yaw: Math.PI },
    invite: 'Regarder sous le comptoir',
  },

  // 11 : le rapport punaisé au-dessus de l'établi de Kaede (atelier 修理, côté nord, partie est).
  { id: 11, zone: 'kasumi', position: [120.5, 1.75, 20.75], rayon: 2.6, invite: 'Lire le rapport punaisé' },

  // 19 : sur la tablette du Kiosque à la veste bleue (côté nord, partie ouest, face à la clinique), à droite de l'écran.
  { id: 19, zone: 'kasumi', position: [49.35, 1.4, 22.0], rayon: 2.6, invite: 'Regarder la tablette' },

  // ---- Maison des Conseils (zone 'maison', repère de zones/maison.js ; LIEUX et la bible §5.4, §6) ----
  // Médiathèque des Avant (aile est) : un fragment sur le socle lumineux devant chacun des quatre écrans du mur est (x = 27,8).
  { id: 5, zone: 'maison', position: [27.0, 0.95, -8], rayon: 2.9, invite: "Lire l'archive de 2021" },
  { id: 6, zone: 'maison', position: [27.0, 0.95, -3], rayon: 2.9, invite: "Lire l'archive de 2025" },
  { id: 7, zone: 'maison', position: [27.0, 0.95, 2], rayon: 2.9, invite: "Lire l'archive de 2026" },
  { id: 9, zone: 'maison', position: [27.0, 0.95, 7], rayon: 2.9, invite: "Lire l'archive de 2033" },
  // 14 : sous le fronton intérieur de la nef, la Charte gravée sur la poutre (z = 5).
  { id: 14, zone: 'maison', position: [-2.6, 2.4, 4.3], rayon: 3.2, invite: 'Lire la Charte' },
  // 15 : la vitrine de la séance 1 812, contre le mur ouest de la nef.
  { id: 15, zone: 'maison', position: [-7.3, 1.45, -8], rayon: 2.9, invite: 'Regarder la vitrine' },
  // Clinique du Jugement (étage, y = 4,2) : l'affiche du mur est, la table basse, le bureau de la docteure.
  {
    id: 20, zone: 'maison', position: [13.1, 6.25, -24], rayon: 3.0,
    support: { type: 'affiche', position: [13.78, 6.25, -24], yaw: -Math.PI / 2 },
    invite: "Regarder l'affiche",
  },
  {
    id: 21, zone: 'maison', position: [-11.7, 5.3, -21.2], rayon: 3.3,
    support: { type: 'papier', position: [-11.7, 4.99, -21.2], yaw: 0.3 },
    invite: 'Lire la note',
  },
  {
    id: 22, zone: 'maison', position: [0, 5.05, -23.8], rayon: 3.3,
    support: { type: 'papier', position: [-0.2, 4.67, -23.8], yaw: -0.4 },
    invite: 'Lire la fiche',
  },

  // ---- Kura (zone 'kura', repère de zones/kura.js ; bible §6) ----
  // 12 : sur la stèle du parvis du Hall, face à la mer de baies (stèle en (−4, 0, −53,5)).
  { id: 12, zone: 'kura', position: [-4, 1.5, -53.5], rayon: 3.2, taille: 1.4, invite: 'Lire la stèle du Hall' },
  // 13 : sous le linteau gravé de la Bibliothèque des Circuits (porte sud du pavillon, z = −58, mezzanine y = 10).
  { id: 13, zone: 'kura', position: [62, 13.4, -57.2], rayon: 3.6, taille: 1.3, invite: "Lire l'inscription" },
  // 16 et 17 : sur les bureaux des postes des deux autres Lecteurs (x = 48 et x = 88, z = −95).
  {
    id: 16, zone: 'kura', position: [51.5, 11.5, -95.2], rayon: 3.0,
    support: { type: 'papier', position: [51.5, 10.93, -95.2], yaw: 0.3 },
    invite: 'Lire la note du Lecteur',
  },
  {
    id: 17, zone: 'kura', position: [84.5, 11.5, -95.2], rayon: 3.0,
    support: { type: 'papier', position: [84.5, 10.93, -95.2], yaw: -0.4 },
    invite: 'Lire le compte rendu',
  },
  // 23 : la Charte du Refuge, gravée au mur ouest de la salle (mezzanine y = 10).
  { id: 23, zone: 'kura', position: [136.4, 12.6, -64.4], rayon: 3.4, taille: 1.2, invite: 'Lire la Charte du Refuge' },
  // 33 : sur la stèle près de l'entrée de la salle de l'Interrupteur (sol y = 0), pas sur l'Interrupteur lui-même.
  { id: 33, zone: 'kura', position: [394.2, 1.6, -329.4], rayon: 3.2, taille: 1.3, invite: "Lire la stèle de l'Interrupteur" },

  // 10 : « Le dividende » n'est PAS à ramasser : c'est un souvenir qu'Oba raconte. Il entre dans la frise à
  // la fin de son dialogue (systems/personnages.js, drapeau 'oba_dividende'). Il n'a donc pas de ligne
  // ci-dessus (fragments.js en ferait un éclat prenable) : voir POSITIONS_PAR_DIALOGUE plus bas.
];

// Fragments obtenus en parlant (pas de ramassage) : id → { zone, position, source }.
export const POSITIONS_PAR_DIALOGUE = {
  10: { zone: 'kasumi', position: [97.6, 1.55, 37.3], source: 'oba' },
};
