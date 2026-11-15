// Textes du Marché des Mains (夜の市場) : titre de zone, enseignes, libellés et narrations.
// Narration : dialogue sans nom (qui: ''), un paragraphe par entrée de `textes`.
// Fidèle à la bible §2.3 : rien ne se vend ; on donne, on reçoit ce qui nous est destiné.

export const TITRE_MARCHE = { titre: 'Le Marché des Mains', sous: '夜の市場' };

// Enseignes (texte tracé sur les panneaux néon). `fr` : traduction, non affichée.
export const ENSEIGNES_MARCHE = {
  arche: { texte: '夜の市場', fr: 'marché de nuit' },
  mat: { texte: '夜の市場', fr: 'marché de nuit' },
  nouilles: { texte: '麺', fr: 'nouilles' },
  fleurs: { texte: '花', fr: 'fleurs' },
  reprise: { texte: '繕い', fr: 'reprisage' },
  chants: { texte: '歌', fr: 'chansons' },
  veilles: { texte: '夜番', fr: 'veilles de nuit' },
  pret: { texte: '傘', fr: 'parapluies' },
  graines: { texte: '種', fr: 'graines' },
  raviolis: { texte: '餃子', fr: 'raviolis' },
  trappe: { texte: '荷', fr: 'colis' },
  sceau: { texte: '印', fr: 'sceau' },
  lanternes: { texte: '灯', fr: 'lanternes' },
  soupe: { texte: '汁', fr: 'soupe' },
  grill: { texte: '焼', fr: 'grillades' },
  pieces: { texte: '部品', fr: 'pièces' },
  the: { texte: '喫茶店', fr: 'salon de thé' },
  atelier: { texte: '修理', fr: 'réparation' },
  main: { texte: '手', fr: 'main' },
  promo: { texte: 'PROMOTION !', fr: '' },
  zero: { texte: '0,00', fr: '' },
};

// Objets à examiner. `libelle` suit « E — ».
export const OBJETS_MARCHE = {
  nouilles: {
    libelle: 'Regarder les bols',
    textes: [
      "Une rangée de bols de nouilles fumants, posés sur le comptoir. Devant chacun, un fil de lumière est tendu sur le bois. Personne ne sert. Le bol dont le fil s'allume est celui de quelqu'un qui passe, et ce quelqu'un le prend sans rien dire.",
      "Celle qui les a cuisinés est repartie chanter trois étals plus loin. On ne la remercie pas : elle le saurait, et le Sceau aussi.",
    ],
  },
  fleurs: {
    libelle: 'Regarder les bouquets',
    textes: [
      "Des bouquets liés à la main, serrés dans des seaux d'eau de pluie. Un brin de fil lumineux est noué à chaque tige. Quand la bonne personne passe, le fil s'allume ; elle emporte le bouquet, et celui qui l'a lié ne lève même pas les yeux.",
    ],
  },
  reprise: {
    libelle: 'Regarder les vêtements',
    textes: [
      "Des manteaux reprisés, accrochés à une tringle. Les coutures sont inégales, volontairement : une machine ferait mieux, tout le monde le sait. Chaque saison, les anciens vêtements sont défaits et refabriqués. Ici, on les reprend à la main avant qu'ils ne repartent.",
      "Une étiquette de lumière pend à chaque manche. Aucune ne porte de prix. Elles portent un nom.",
    ],
  },
  chants: {
    libelle: 'Regarder le micro',
    textes: [
      "Un micro sur pied, un banc, un petit haut-parleur encore tiède. Pas de scène : on s'arrête, on chante une chanson, et quelqu'un l'écoute jusqu'au bout. C'est tout ce qu'on demande, et c'est ce qui pèse le plus.",
      "Le Sceau retient ce qu'on a donné. Il ne retient pas les chansons elles-mêmes. Elles restent dans l'air du marché, quelques minutes, puis dans la tête de ceux qui les ont entendues.",
    ],
  },
  veilles: {
    libelle: 'Regarder le tableau des veilles',
    textes: [
      "Un tableau de bois où pendent des lampes à cordon, une par nuit. Les lampes allumées sont déjà prises : quelqu'un veillera un ancien jusqu'au matin. Les noms sont écrits à la craie, puis lavés par la pluie.",
      "Les lignes, elles, ne se lavent pas. Chaque nuit donnée s'ajoute au Sceau de celui qui veille, et à personne d'autre.",
    ],
  },
  pret: {
    libelle: 'Regarder les parapluies',
    textes: [
      "Des parapluies pendus par la poignée, un tabouret pliant, une lampe-tempête. Rien n'appartient à personne ici : tout est « en usage ». On le demande à Mima, qui écrit la ligne, et on le rend quand on a fini. Presque tout revient.",
    ],
  },
  graines: {
    libelle: 'Regarder les pots',
    textes: [
      "Des pots de terre, des sachets de graines, une pelle d'enfant. Chaque matin, Mima propose une ou deux tâches de sens. Ce soir, c'est jardiner sur les toits. Des machines le feraient mieux et plus vite, et tout le monde le sait aussi.",
      "Personne n'en parle. Les pots, eux, ont été arrosés à la main.",
    ],
  },
  sceau: {
    libelle: 'Regarder le tableau du Sceau',
    textes: [
      "Un mur de petites lampes, une par habitant, plus ou moins vives. Ce n'est pas un classement : c'est le registre de ce qu'on a donné. Du temps, de l'attention, des repas cuisinés à la main, des gardes de nuit.",
      "Le statut ne s'achète pas, il se donne, et il ne se transmet à personne. Les lampes du bas sont presque éteintes. Ceux-là ne manquent de rien pour autant : le Sceau n'ouvre que les accès intimes, qui peut entrer chez vous, quel rôle on tient au marché.",
    ],
  },
  raviolis: {
    libelle: "Regarder l'étal sans personne",
    textes: [
      "Un comptoir de raviolis encore fumants, et personne derrière. La ligne de cet étal nomme quelqu'un d'autre. Aucune porte ne se ferme, aucune main ne vous arrête.",
      "Rien n'empêche de prendre sans ligne. Le Registre le voit simplement aussitôt, et le marché aussi, qui ne dit rien. Sous le comptoir, à la craie : « Ce qui est pris sans ligne est vu. »",
    ],
  },
  trappe: {
    libelle: 'Regarder la trappe',
    textes: [
      "Une trappe dans le mur, à hauteur de hanche, où les Porteurs déposent des caisses : repas, tissus, pièces. Elles arrivent déjà étiquetées de lignes, en lumière douce.",
      "Elles arrivent un peu avant qu'on en ait besoin. C'est ce qu'on remarque le moins, et ce que tout le monde attend.",
    ],
  },
};
