// Textes propres au système de conversation du palier 4 (src/systems/conversation.js).
// La question, les réponses, les rappels et les répliques après refus viennent de dialogues-attention.js.

export const CONVERSATION = {
  // Invite « E — … » devant un écran qui appelle, ou en attente de réponse partout dans la ville.
  libelle: 'Répondre',
  // Locuteur du petit dialogue à deux choix.
  qui: 'Mima',
};

export const REGLAGES_CONVERSATION = {
  // Portée (m) de l'invite sur un hologramme (même rayon que l'affichage de l'appel : data/reactions.js) et le Kiosque.
  rayonHologramme: 155,
  rayonKiosque: 90,
  // Distance (m) devant la caméra de l'invite « partout » (juste sous la portée de la plupart des objets).
  distanceInviteLibre: 1.6,
  // Attention après la conversation (bible §7.2).
  attentionApres: 60,
};
