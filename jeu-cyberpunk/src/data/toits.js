// Textes des toits de Kasumi (système src/systems/toits.js).
// Tout texte affiché vit ici ; le code importe la constante.

export const TEXTES_TOITS = {
  // invites « E — … » des rebords où l'on peut s'asseoir
  asseoir: "S'asseoir",
  relever: 'Se relever',
};

// Enseignes du toit du karaoké (カラオケ, bible §5.2 : « un karaoké où chante Itsuki »).
// Vue de la rue : une grande enseigne verticale en drapeau, une enseigne horizontale sur
// l'étage technique, un petit néon de salle. `couleur` : palette violet / magenta / bleu.
export const ENSEIGNES_TOITS = {
  karaokeVertical: { texte: '歌カラオケ', couleur: '#ff2bd6' },
  karaokeHorizontal: { latin: 'KARAOKE', kana: 'カラオケ', couleur: '#ff2bd6' },
  karaokeSalle: { texte: '歌', couleur: '#4aa8ff' },
};
