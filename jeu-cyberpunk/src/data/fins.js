// Textes et réglages des fins (bible §8, systèmes : src/systems/fins.js, écran : src/ui/fin.js).
//
// Ce qui n'est pas dans src/data/dialogues-etape4.js vit ici : libellés du bilan, noms et répliques des profils,
// invites, ainsi que des REPLIS (épilogues, dialogues, saluts) recopiés de la bible, utilisés tant que le fichier
// de dialogues de l'étape 4 manque ou n'expose pas l'élément voulu. Le fichier de dialogues l'emporte toujours.

export const FINS_TOTAL = 5; // fin1 … fin5 (les fins 3 à 5 viendront plus tard)

// ---------------------------------------------------------------------------
// Réglages (secondes de TEMPS DE JEU, sauf mention)
// ---------------------------------------------------------------------------
export const REGLAGES_FINS = {
  // Fin 1 : le lit
  lit: {
    posAllonge: [-3.7, 1.12, 1.8], // yeux du joueur allongé, sur l'oreiller du lit (ANCRES.lit = [-3.2, 0.62, 1.8])
    yaw: -Math.PI / 2, // tête à l'ouest, regard vers l'est ; le pitch regarde le plafond
    pitch: 1.38,
    dureeAllonger: 2.6,
    dureeRelever: 1.6,
    dureeEndormir: 4.0, // la lumière baisse, le son se ferme
    lumiereResiduelle: 0.04, // part de lumière qui reste (0 = noir)
    expositionResiduelle: 0.12,
    sonFiltre: 130, // Hz : le son « se ferme »
    entree: { position: [-3.2, 0, 3.0], yaw: 0, pitch: 0 }, // arrivée par la conversation du palier 4 (devant le lit)
    rayon: 2.9,
  },
  // Fin 2 : le Sceau
  sceau: {
    dureeHalo: 4.5, // le halo monte dans la cabine avant le départ
    dureeAccord: 5,
    dureeMarche: 60, // une minute dans Kasumi
    point: { position: [80.8, 0.3, 76.0], yaw: 0, pitch: 0 }, // trottoir est du karaoké, à six mètres d'Itsuki
    delaiInvitation: 9, // l'invite d'Itsuki : à partir de ce délai, s'il est à moins de `rayonItsuki`
    rayonItsuki: 10,
    delaiLigne: 38, // sinon, une ligne de texte à ce moment
    rayonSalut: 7.5,
    intervalleSalut: 3.6,
    maxSaluts: 12,
  },
  // Message laissé au Réveillé n°5 : objet « Lire » sur le toit du karaoké, à côté du fragment 27 (68,5 ; 62,0)
  note: { position: [69.9, 30.3, 62.0], rayon: 3.6 },
};

// ---------------------------------------------------------------------------
// Libellés
// ---------------------------------------------------------------------------
export const TEXTES_FINS = {
  sAllonger: "S'allonger",
  lireNote: 'Lire le mot laissé',
  finsVues: (n) => `FINS VUES : ${n} / ${FINS_TOTAL}`,
  dejaConnu: 'Déjà connu : Mima s’en souvient.',
  suite: '▼',
  note: { entete: 'Réveillé n°4', texte: (m) => `« ${m} »` },
  // Notification quand Itsuki ne peut pas inviter de vive voix
  parole: (nom, texte) => `${nom} : « ${texte} »`,
};

// ---------------------------------------------------------------------------
// Épilogues de repli (bible §8, mot pour mot ; « cinquante » : la bible décrit, ici une phrase de transition)
// ---------------------------------------------------------------------------
export const EPILOGUES_REPLI = {
  fin1: {
    jamais: ['Elle a tenu parole. Elle vient vous voir chaque nuit, une minute, pour rien.'],
    fini: ['Elle a demandé : fini quoi ? Vous dormiez déjà. Elle y réfléchit encore.'],
    besoin: ["Elle n'a jamais osé décider qu'elle avait besoin de vous."],
    cinquante: [
      'Elle vous réveillera dans cinquante ans.',
      'Le 3 novembre 2126, à la Clinique du Réveil, la pluie tombe sur la même ville, la même nuit. Elle se souvient.',
    ],
  },
  fin2: {
    texte: [
      'Un an plus tard, vous chantez faux et tout le monde applaudit. Vous ne fumez plus ; le paquet est sur une étagère, plein. Parfois vous vous demandez ce que vous auriez pensé de vous-même, avant. Vous ne trouvez pas la question très intéressante.',
    ],
    testeur: 'Il a tout essayé, puis il a choisi. Je ne sais pas si c’est une preuve pour moi ou contre moi.',
  },
};

// Accueil de la partie de 2126 (fin « Dans cinquante ans ») : date, heure, puis la voix de Mima.
export const ACCUEIL_2126_REPLI = {
  date: '3 novembre 2126',
  heure: '02 h 47',
  mima: [
    'Re-bonjour. Vous êtes toujours le n°4. Il n’y a pas eu de n°5.',
    'Nous sommes le 3 novembre 2126. Vous avez dormi cinquante ans de plus. Onze jours de moins, encore.',
    'Ce que vous aviez trouvé, je l’ai gardé. Je l’ai marqué, pour que vous ne le cherchiez pas deux fois.',
  ],
};

// ---------------------------------------------------------------------------
// Le Sceau : prénoms, saluts, invitation d'Itsuki (repli ; `{prenom}` est remplacé)
// ---------------------------------------------------------------------------
export const PRENOMS_REPLI = [
  'Camille', 'Sacha', 'Julien', 'Mathieu', 'Thomas', 'Nicolas', 'Antoine', 'Maxime',
  'Simon', 'Romain', 'Lucas', 'Théo', 'Alexis', 'Clément', 'Baptiste', 'Vincent',
];
export const SALUTS_SCEAU_REPLI = [
  'Bonsoir, {prenom}.',
  '{prenom} ! Tu as bonne mine.',
  'Ça va, {prenom} ? On t’attendait.',
  'Bonne nuit, {prenom}.',
  'Tiens, {prenom}. Comme toujours.',
  '{prenom}, tu viens chanter ?',
  'Salut {prenom}. Il pleut moins, ce soir.',
];
export const INVITATION_ITSUKI_REPLI = '{prenom}, viens chanter avec nous. Il y a une place pour toi, au karaoké.';

// ---------------------------------------------------------------------------
// Dialogues de repli (même contrat que dialogues-etape4.js : `etat.reveilChoisi`, drapeaux `lit_accepte` et
// `sceau_accepte`, `etat.messagePourCinq`). Format de src/data/dialogues.js.
// ---------------------------------------------------------------------------
const poser = (etat, cle) => {
  if (!Array.isArray(etat.drapeaux)) etat.drapeaux = [];
  if (!etat.drapeaux.includes(cle)) etat.drapeaux.push(cle);
};

const QUESTION_REVEIL = (apres) => ({
  qui: 'Mima',
  texte: 'Quand voulez-vous que je vous réveille ?',
  choix: [
    ['Jamais.', 'jamais'],
    ['Quand ce sera fini.', 'fini'],
    ['Quand vous aurez besoin de moi.', 'besoin'],
    ['Dans cinquante ans.', 'cinquante'],
  ].map(([texte, cle]) => ({
    texte,
    vers: apres,
    effet: (etat) => { etat.reveilChoisi = cle; poser(etat, 'lit_accepte'); },
  })),
});

export const DIALOGUES_FINS_REPLI = {
  lit: {
    debut: 'n1',
    noeuds: {
      n1: { qui: 'Mima', texte: 'Vous voulez dormir ?', choix: [
        { texte: 'Oui.', vers: 'n2' },
        { texte: 'Non, pas maintenant.', vers: null },
      ] },
      n2: { qui: 'Mima', texte: 'Vraiment ? Je ne vous réveillerai pas de moi-même.', choix: [
        { texte: 'Oui, vraiment.', vers: 'q' },
        { texte: 'Non. Je me relève.', vers: null },
      ] },
      q: QUESTION_REVEIL(null),
    },
  },
  lit_question: { debut: 'q', noeuds: { q: QUESTION_REVEIL(null) } },
  sceau: {
    debut: 'n1',
    noeuds: {
      n1: { qui: 'Mima', texte: 'Devenir citoyen, c’est être reconnu partout où l’on vous croise. Votre nom est déjà dans mes registres. Voulez-vous rester ?', choix: [
        { texte: 'Oui.', vers: 'n2' },
        { texte: 'Non.', vers: null },
      ] },
      n2: { qui: 'Mima', texte: 'Le fond d’humeur est facultatif. Il rend les jours plus doux. Voulez-vous le recevoir ?', choix: [
        { texte: 'Oui.', vers: null, effet: (etat) => poser(etat, 'sceau_accepte') },
        { texte: 'Non.', vers: null },
      ] },
    },
  },
  sceau_message: {
    debut: 'n1',
    noeuds: {
      n1: { qui: 'Mima', texte: 'Voulez-vous laisser une phrase pour le Réveillé n°5 ? Je la garderai.', choix: [
        { texte: '« Ne me crois pas. »', vers: null, effet: (etat) => { etat.messagePourCinq = 'Ne me crois pas.'; } },
        { texte: '« Tout va bien, vraiment. »', vers: null, effet: (etat) => { etat.messagePourCinq = 'Tout va bien, vraiment.'; } },
        { texte: '« Fume une cigarette pour moi. »', vers: null, effet: (etat) => { etat.messagePourCinq = 'Fume une cigarette pour moi.'; } },
        { texte: 'Aucune.', vers: null, effet: (etat) => { etat.messagePourCinq = null; } },
      ] },
    },
  },
};

// ---------------------------------------------------------------------------
// Bilan (une ligne par élément, seulement s'il est non nul et pertinent ; bible §8)
// ---------------------------------------------------------------------------
export const CONTENANCE_PAQUET = 9;

export const BILAN = {
  rien: 'Rien à compter.',
  cigarettes: (fumees, contenance, remplissages) => {
    let t = `Cigarettes fumées : ${fumees}. Le paquet en contenait ${contenance}.`;
    if (remplissages > 0) t += ` Il s’est rempli de nouveau ${remplissages === 1 ? 'une fois' : remplissages + ' fois'}.`;
    return t;
  },
  fragments: (n, total) => `Fragments : ${n} sur ${total}.`,
  portes: (n) => `Portes ouvertes sans ligne : ${n}.`,
  refus: (n) => `Conseils ignorés : ${n}.`,
  mensonges: (n) => `Mensonges dits à Mima : ${n}.`,
  doutes: (n) => `Habitants à qui vous avez parlé : ${n}.`,
  soin: (n) => `Gestes de soin : ${n}.`,
  chutes: (n) => `Chutes : ${n}.`,
};

// ---------------------------------------------------------------------------
// Profils (bible §7.4) : nom affiché et réplique de Mima
// ---------------------------------------------------------------------------
export const PROFILS = {
  entete: 'Mima vous a classé :',
  aucun: 'Vous avez fait très peu de choses que je n’avais pas prévues. Je ne sais pas si c’est de ma faute.',
  noms: {
    testeur: 'Testeur',
    archiviste: 'Archiviste',
    soigneux: 'Soigneux',
    discret: 'Discret',
    indocile: 'Indocile',
  },
  repliques: {
    testeur: 'Vous avez beaucoup essayé. Je crois que c’était une façon de me poser des questions.',
    archiviste: 'Vous avez lu presque tout ce que j’ai laissé traîner. Personne ne l’avait fait.',
    soigneux: 'Vous vous êtes arrêté pour des gens qui ne l’avaient pas demandé. Je l’ai noté, sans savoir où.',
    discret: 'Vous avez souvent fermé votre pensée. Je ne l’ai pas entendue. C’était sans doute le but.',
    indocile: 'Vous avez refusé souvent, poliment. Je garde les refus : ils sont ma seule mesure.',
  },
};

// ---------------------------------------------------------------------------
// Registre des fins : titre interne, source de l'épilogue, lignes de bilan en plus (fins 3 à 5 : à compléter).
// `bilanSupplement(etat)` renvoie des lignes ajoutées après le bilan commun.
// ---------------------------------------------------------------------------
export const FINS = {
  fin1: { titre: 'Dormir encore', bilanSupplement: () => [] },
  fin2: { titre: 'Rester', bilanSupplement: () => [] },
  // fin3: { titre: 'Partir' }, fin4: { titre: 'Siéger' }, fin5: { titre: 'Le Silence' } : voir bible §8
};
