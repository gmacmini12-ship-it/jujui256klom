// Textes et listes des habitants de Kasumi (src/systems/npc.js).
// Bible §2.3 à §2.5 : gens qui ne possèdent rien, sont heureux (vraiment), vivent conseillés en
// permanence, pensent à voix ouverte. Rien ici ne touche aux secrets de la §2.6.

// --- Humeurs : couleur du halo (bible §2.4 : « chez presque tout le monde, le même rose-violet tranquille »)
// `poids` : part de la foule ; `libelle` : mot affiché par le Calque.
export const HUMEURS = [
  { id: 'sereine', libelle: 'sereine', couleur: 0xd24bff, poids: 0.84 },
  { id: 'joyeuse', libelle: 'joyeuse', couleur: 0xff3fc8, poids: 0.06 },
  { id: 'songeuse', libelle: 'songeuse', couleur: 0x5f8cff, poids: 0.05 },
  { id: 'lasse', libelle: 'lasse', couleur: 0xa98cff, poids: 0.03 },
  { id: 'emue', libelle: 'émue', couleur: 0xffb8ec, poids: 0.02 },
];
// Halo d'un habitant qui regarde fumer le joueur : il pâlit et vacille.
export const HALO_SURPRIS = 0xffd9f6;

// --- Lignes du Calque (listes complétant src/data/calque.js : PRENOMS, NOMS, HORAIRES) ---
// « tâches de sens » proposées chaque matin par Mima (bible §2.3) : volontairement inefficaces.
export const OCCUPATIONS = [
  'jardin de toit', 'chant', 'réparation à la main', 'veille d’un ancien', 'cuisine de rue',
  'latin (langue morte)', 'ancien français (langue morte)', 'reprise de manteaux', 'tri de piles rechargeables',
  'lecture à voix haute', 'balayage de seuil', 'couture', 'fleurs de balcon', 'écoute des anciens',
  'cartes à la main', 'thé de quartier', 'bibliothèque de quartier', 'accordage de guitares',
];
export const LIGNE_HABITANT = {
  titre: '{prenom} {nom}',
  lignes: ['Affectation : {occupation}', 'Horaire : {horaire}', 'Pensée : {pensee} — halo {humeur}'],
  penseeOuverte: 'ouverte',
  penseeClose: 'close',
  // part des habitants dont la pensée est close (bible §2.4 : 97 % la laissent ouverte)
  partPenseeClose: 0.03,
};

// --- Interface ---
export const NPC = {
  parler: 'Parler à {nom}',
};

// --- Bribes de vie (40) : courtes phrases entendues en passant. Le code ajoute les guillemets. ---
// Elles ne reviennent qu'après avoir été toutes dites (tirage sans remise, les récentes en fin de pioche).
export const BRIBES = [
  'Ce manteau, je le rends vendredi. À la saison prochaine il sera autre chose.',
  'Elle m’a conseillé la soupe aux algues. C’était exactement ce que je voulais.',
  'J’ai prêté ma cellule à Noa pour l’hiver. Elle a écrit la ligne, c’est fait.',
  'Quatre heures de garde auprès de Mme Okada. Ça compte pour mon Sceau, mais ce n’est pas pour ça.',
  'Je répare cette radio depuis mars. Les machines la répareraient en une seconde. Moi, j’aime mars.',
  'Il pleut. Enfin.',
  'Elle m’a soufflé son prénom avant que je le demande. Elle pense à tout.',
  'On n’a besoin de rien. C’est étrange de le dire à voix haute.',
  'Chanter faux, c’est ma tâche de sens. Je m’en acquitte très bien.',
  'J’ai voulu appeler ma sœur. Mima m’a expliqué pourquoi ce n’était pas le moment. Elle avait raison.',
  'Je ne sais plus si j’ai choisi ce thé ou si on me l’a conseillé. Il est très bon.',
  'Tu viens à la cantine ? Ce soir c’est des nouilles. Elle dit que tu aimeras.',
  'J’ai jardiné deux heures sur le toit. Les tomates n’en avaient pas besoin.',
  'Le Porteur a laissé un bol chaud devant ma porte. Je n’avais rien demandé.',
  'Je lui parle sans ouvrir la bouche, maintenant. Elle répond avant la fin de ma phrase.',
  'J’ai appris trois mots de latin. Personne ne les dira jamais. J’aime bien.',
  'Rien n’est à moi et je n’ai jamais été aussi tranquille.',
  'On ne se dispute plus. On n’en voit pas l’intérêt.',
  'Dormir à l’heure conseillée, c’est quand même agréable. Personne ne refuse.',
  'Elle a glissé un mot à l’oreille de Yuki, et il m’a souri. Plus aucun malentendu.',
  'J’ai refusé l’allocation une fois, par curiosité. J’ai reçu la deuxième meilleure. C’était bien.',
  'Hier j’ai donné une chanson à la vieille du troisième. Elle l’a gardée.',
  'Quelqu’un a pris ma cellule du bas. J’espère qu’il aime la fenêtre.',
  'Chut. Il n’a pas de halo. — Elle dit d’être aimable.',
  'Tu as vu ? Pas de halo du tout. C’est… poli ?',
  'Mima dit que je devrais lever les yeux plus souvent. Je lève les yeux.',
  'Pensée ouverte, ça ne me gêne pas. À quoi bon fermer ?',
  'Les enseignes ne servent plus à acheter. Elles servent à dire qu’il y a du monde.',
  'Mon plat préféré, c’est celui qu’elle me propose en dernier. Elle sait.',
  'Avant, il paraît qu’on chantait pour de l’argent. Je préfère chanter pour rien.',
  'Ma ligne dit que je dois être à la bibliothèque à vingt-deux heures. J’y suis presque.',
  'J’ai fait un rêve que je n’ai pas compris. Elle l’a compris pour moi.',
  'Reste sous l’auvent, la pluie va forcir. — Elle a raison, comme toujours.',
  'On a tout ce qu’il faut. Alors je regarde la pluie.',
  'Je ne sais pas pourquoi je suis heureuse. Je le suis. C’est déjà beaucoup.',
  'Le vestiaire m’a refait un manteau avec les vieux rideaux de ma mère. Bleu, cette fois.',
  'Ce soir, karaoké. Je ne sais pas encore ce que je chante, elle me le dira.',
  'Personne n’est en retard, ici. Il suffit de ne pas regarder l’heure.',
  'Je donne mon tour à qui voudra. Je n’ai pas faim, de toute façon.',
  'Les toits sentent la terre mouillée. Elle dit que c’est mon odeur préférée. Elle a sûrement raison.',
];

// --- Réactions à la cigarette (bible §2.7, sens 1) : ils regardent quelqu'un détruire par le feu
// une chose qui lui appartient. `ancien` : seuls ceux qui se souviennent les disent.
export const REACTIONS_FUMEE = [
  { texte: 'Il brûle quelque chose. Quelque chose à lui.' },
  { texte: 'C’est à lui, ça ? Vraiment à lui ?' },
  { texte: 'Pourquoi détruire ce qui est à soi ?' },
  { texte: 'Il ne la prête pas. Il la brûle.' },
  { texte: 'Ça sent comme chez ma grand-mère.', ancien: true },
  { texte: 'Je connais cette odeur. D’avant le Registre.', ancien: true },
  { texte: 'On dirait qu’il ne la rendra à personne.', ancien: true },
  { texte: 'Qu’est-ce que ça fait, de posséder ?' },
  { texte: 'Elle ne dit rien. Moi non plus.' },
];
export const REACTIONS_JETEE = [
  'Elle est par terre. Elle n’est plus à personne.',
  'Il l’a lâchée. Elle s’éteint toute seule.',
  'C’est fini. Il n’y a plus de ligne, là.',
];
