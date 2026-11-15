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

  // 27 : sur un toit à l'est de la clinique, visible depuis la rue du carrefour ; atteignable
  // plus tard (Bond). Toit du lot [60-79] × [41-60], hauteur 18,9 m dans son angle nord-ouest ; l'éclat flotte à 3,6 m au-dessus, pour dépasser le rebord vu d'en bas.
  { id: 27, zone: 'kasumi', position: [63, 22.5, 42.2], taille: 3.5 },
];
