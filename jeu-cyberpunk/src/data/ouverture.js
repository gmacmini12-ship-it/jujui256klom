// Séquence d'ouverture d'une nouvelle partie (plan, tâche 1.2 ; bible §5.1).
// Écran noir, bips lents, la date sur le noir, fondu sur la Clinique, puis la voix de Mima.
// Les durées sont en secondes. La date et le premier conseil viennent de la bible ;
// les autres phrases sont écrites dans la voix de Mima (bible §9).

export const OUVERTURE = {
  noirInitial: 1.6, // noir complet et silence avant le premier bip
  bips: [0, 1.7, 3.4], // instants des bips, comptés après le noir initial
  // Lignes écrites sur le noir, l'une après l'autre.
  lignes: [
    { texte: '3 novembre 2076', debut: 4.4, classe: 'date' },
    { texte: '02 h 47', debut: 5.6, classe: 'heure' },
  ],
  finTexte: 9.0, // les lignes s'effacent
  debutFondu: 10.0, // l'image apparaît
  dureeFondu: 3.5,
  // Le regard part du plafond et descend, comme quand on se redresse.
  regardInitial: { pitch: 1.15 },
  dureeRegard: 3.5,
  // Phrases de Mima, dans la bande du bas, après le début du fondu.
  mima: [
    { texte: 'Bonsoir. Ne vous levez pas tout de suite, si vous le pouvez.', debut: 11.5, duree: 5.5 },
    { texte: 'Nous sommes le 3 novembre 2076. Vous avez dormi cinquante ans. Onze jours de moins, pour être exacte.', duree: 7 },
    { texte: "Je m'appelle Mimamori. Tout le monde dit Mima.", duree: 5 },
    { texte: "Vous devriez vous reposer encore. Vous n'êtes pas obligé.", duree: 6 },
  ],
  // Le joueur reprend la main à cet instant (les phrases de Mima continuent).
  finControle: 13.5,
};
