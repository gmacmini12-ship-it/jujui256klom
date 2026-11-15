// Textes du Veilleur et des Rémanences (bible §3.2, §5.6, §7.3 : T6).
// Répliques de Mima recopiées mot pour mot de docs/bible.md, §7.3 (T6).
// Tout texte affiché par src/systems/veilleur.js vient d'ici.
export const VEILLEUR = {
  // Paroles de Mima, après la chute : 1re et 2e (rattrapage), 3e et suivantes (échec, une seule fois).
  mima: {
    rattrape: [
      `Vous êtes tombé. Ce n'est rien.`,
      `Si vous le faites exprès, dites-le-moi. Je cesserai de vous rattraper.`,
    ],
    echec: `Vous avez montré que vous saviez ce que vous faisiez.`,
  },
  // Bornes de Rémanence : vieilles bornes de rappel des années 2040.
  borne: {
    notification: 'RÉMANENCE — point de reprise enregistré',
    plaque: '残像', // « image rémanente »
  },
};
