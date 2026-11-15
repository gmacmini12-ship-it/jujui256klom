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
};
