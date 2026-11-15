// Conseils de Mima. Répliques recopiées de docs/bible.md (§5.1, §7 : T7 et la section hauteur).
export const CONSEILS = [
  { id: 'c1', contexte: 'repos', texte: `Vous devriez vous reposer encore. Vous n'êtes pas obligé.` },
  { id: 'c2', contexte: 'pluie', texte: `Il va pleuvoir plus fort, la cantine 食堂 est ouverte.` },
  { id: 'c3', contexte: 'repos', texte: `Vous devriez dormir.` },
  { id: 'c4', contexte: 'hauteur', texte: `Vous êtes à 60 mètres. Je préférerais que vous descendiez. Vous n'êtes pas obligé.` },

  // Conseils ajoutés (tâche 1.7). `suivi` : mot-clé lu par systems/conseils.js pour savoir si le conseil a été suivi.
  //   allure    : ne pas courir pendant 30 s            arret   : cesser de courir
  //   abri      : entrer dans la clinique ou s'en rapprocher    retour : idem
  //   mouvement : faire quelques pas                    calme   : ne plus sauter
  //   recul     : s'éloigner du bord de la ville
  { id: 'c5', contexte: 'sortie', suivi: 'allure', texte: `Votre souffle sera court quelque temps. J'en suis sûre à quatre-vingt-dix pour cent. Vous pourriez marcher doucement, le temps qu'il s'habitue.` },
  { id: 'c6', contexte: 'pluie', suivi: 'abri', texte: `La pluie ne faiblit pas, et vous êtes dehors depuis un moment. La clinique est chaude, sa porte vous reconnaît. Vous pourriez vous y abriter. Vous n'êtes pas obligé.` },
  { id: 'c7', contexte: 'course', suivi: 'arret', texte: `Vous courez depuis un moment. Rien ne vous poursuit, j'ai vérifié. Vous pourriez marcher quelques pas.` },
  { id: 'c8', contexte: 'immobile', suivi: 'mouvement', texte: `Vous êtes immobile depuis une minute. Je ne m'en inquiète pas, je le note. Le carrefour a une belle vue, je crois. Soixante pour cent.` },
  { id: 'c9', contexte: 'saut', suivi: 'calme', texte: `Vous avez beaucoup sauté. Le Bond est à vous, je n'y objecte rien. Vos genoux, eux, se sont reposés longtemps. Vous pourriez leur laisser un peu de sol.` },
  { id: 'c10', contexte: 'bord', suivi: 'recul', texte: `Vous vous éloignez du centre. Plus loin, je n'ai plus beaucoup de lumière à vous prêter. Vous pourriez revenir vers les enseignes. Je ne vous retiens pas.` },
  { id: 'c11', contexte: 'clinique', texte: `Le lit est fait, l'eau est chaude. Vous pourriez vous asseoir un moment. Je ne vous demande rien en échange.` },
  { id: 'c12', contexte: 'cigarette', texte: `Je me suis tue pendant ce temps. Si vous avez soif, la cantine 食堂 est ouverte. Rien ne presse.` },
  { id: 'c13', contexte: 'frise', texte: `La frise garde ce que vous avez trouvé, et elle est moins capricieuse que la mémoire. Vous pourriez la rouvrir quand une chose vous échappe.` },
  { id: 'c14', contexte: 'rien', suivi: 'retour', texte: `Vous n'avez encore rien ramassé. Je ne dis pas que c'est un tort. Vos affaires sont dans le casier de la salle de réveil, si vous voulez les revoir.` },
  { id: 'c15', contexte: 'pluie', suivi: 'abri', texte: `Il pleut depuis longtemps maintenant. Je ne sais pas si cela vous gêne. Si oui, un abri est plus près que vous ne le pensez.` },
  { id: 'c16', contexte: 'immobile', suivi: 'mouvement', texte: `Vous regardez la même chose depuis longtemps. Qu'y voyez-vous ? Vous n'avez pas à répondre. Quelques pas changeraient la vue, c'est tout.` },
];
