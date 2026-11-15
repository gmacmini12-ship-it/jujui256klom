// Dialogues. Format :
// DIALOGUES[id] = { debut: 'n1', noeuds: { n1: { qui, texte, choix?, suite? } } }
// - `choix` : [{ texte, vers, si?, effet? }] ; `vers: null` termine le dialogue.
// - sans `choix`, `suite` donne le nœud suivant (absent ou null : fin du dialogue).
// - `si(etat)` masque un choix si elle renvoie false ; `effet(etat)` s'exécute quand le choix est pris.
export const DIALOGUES = {
  test: {
    debut: 'n1',
    noeuds: {
      n1: { qui: 'Mima', texte: 'Bonsoir. Vous êtes debout.', suite: 'n2' },
      n2: { qui: 'Mima', texte: 'Souhaitez-vous que je vous indique la sortie ?', choix: [
        { texte: 'Oui.', vers: 'n3' },
        { texte: 'Non.', vers: null, effet: (etat) => { etat.refus += 1; } },
      ] },
      n3: { qui: 'Mima', texte: 'La porte est derrière vous.' },
    },
  },
  // L'anneau de Mima, au mur de la Clinique du Réveil.
  // La première réponse est celle de la bible (§2.1) ; le reste dans la voix de Mima (§9).
  anneauClinique: {
    debut: 'n1',
    noeuds: {
      n1: { qui: 'Mima', texte: 'Je vous écoute.', choix: [
        { texte: "Pourquoi m'avez-vous réveillé ?", vers: 'pourquoi',
          effet: (etat) => { if (!etat.questionsPosees.includes('pourquoi-reveil')) etat.questionsPosees.push('pourquoi-reveil'); } },
        { texte: 'Où sommes-nous ?', vers: 'ou' },
        { texte: 'Rien. Je regardais.', vers: 'rien' },
      ] },
      pourquoi: { qui: 'Mima', texte: 'Parce que les soins le permettaient. Et parce que je voulais votre avis.' },
      ou: { qui: 'Mima', texte: "À la Clinique du Réveil, à Hikari. La porte donne sur Kasumi. Il pleut, comme presque toutes les nuits.", suite: 'ou2' },
      ou2: { qui: 'Mima', texte: "Vous pouvez sortir quand vous voulez. Vous pouvez aussi revenir." },
      rien: { qui: 'Mima', texte: "C'est une bonne raison. Je reste là." },
    },
  },
};
