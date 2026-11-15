// Textes des questions à Mima (bible §2.1 : « le joueur ne peut poser que les questions qu'il sait formuler »).
// Tout texte affiché par src/systems/questions.js vient d'ici ou de QUESTIONS_MIMA (data/dialogues-etape4.js).

export const TEXTES = {
  qui: 'Mima',
  accueil: 'Je vous écoute.',
  accueilVide: "Vous n'avez rien de plus à me demander, pour l'instant. Je reste là.",
  rien: '(Ne rien demander.)',
  autres: '(Autres questions.)',
  dejaPosee: '✓ ', // préfixe d'une question déjà posée (elles passent en fin de liste)
  // L'anneau ne répond pas pendant la Sourdine (narration, sans nom).
  sourdine: "L'anneau tourne, sans un mot. Il ne sait pas que vous êtes là.",
};

/** Au plus neuf choix à l'écran (les chiffres 1 à 9 choisissent). */
export const MAX_CHOIX = 9;

/**
 * Repli si data/dialogues-etape4.js n'exporte pas encore QUESTIONS_MIMA.
 * Format : { id, question, reponse: [phrases], si(etat) }.
 */
export const QUESTIONS_REPLI = [
  {
    id: 'pourquoi-reveil',
    question: "Pourquoi m'avez-vous réveillé ?",
    reponse: ['Parce que les soins le permettaient.', 'Et parce que je voulais votre avis.'],
    si: () => true,
  },
  {
    id: 'qui-etes-vous',
    question: 'Qui êtes-vous ?',
    reponse: ["On m'appelle Mima. Je répartis, je conseille, je répare.", "Je suis la seule voix de la ville qui vous parle. C'est tout ce que je sais affirmer sans me tromper."],
    si: () => true,
  },
  {
    id: 'ou-sommes-nous',
    question: 'Où sommes-nous ?',
    reponse: ['À Hikari. Vous êtes à la Clinique du Réveil, dans le quartier de Kasumi.', "Nous sommes en 2076. Je vous le dis maintenant parce que vous ne me l'avez pas demandé plus tôt."],
    si: () => true,
  },
];
