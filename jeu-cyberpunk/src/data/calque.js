// Textes du CALQUE (bible §4.1) : obtention, étiquettes, listes pour les lignes générées par graine.
// Tout texte affiché par src/systems/calque.js vient d'ici.
//
// Les gabarits utilisent des champs entre accolades, remplacés par le système :
//   {code} {nom} {prenom} {horaire} {objet} {commerce} {don} {gestion} {fonction} {n} {libelle} {vers}

// --- Interface du pouvoir ---
export const CALQUE = {
  notification: 'CALQUE — touche C',
  mimaApres: "Droits provisoires accordés. Touche C : vous verrez les lignes, rien de plus que ce que le Registre vous laisse lire.",
  indicateur: 'CALQUE',
  // la ligne du joueur, affichée discrètement en bas à gauche quand le Calque est actif
  ligneJoueur: ['Vous : Réveillé n°4', 'droits provisoires'],
  libelleBorne: 'Poser la main sur la borne',
  sansLigne: 'sans ligne',
  accessible: 'accessible',
  porteVers: 'Vers : {vers}',
  porteUsageJoueur: 'Usage : Réveillé n°4 — provisoire',
};

// --- Dialogue de la borne de la porte (Clinique du Réveil, bible §4.1 et §5.1) ---
// Format : voir src/data/dialogues.js. Le choix « Poser la main » donne le pouvoir.
export const DIALOGUE_BORNE_CALQUE = {
  debut: 'n1',
  noeuds: {
    n1: { qui: '', texte: 'Un panneau est encastré dans le mur, à côté de la porte. Il est tiède. Un anneau pâle y respire.', suite: 'n2' },
    n2: { qui: 'Mima', texte: "C'est la borne de la porte. Elle demande au Registre ce que vous avez le droit de lire. J'ai appuyé votre demande.", suite: 'n3' },
    n3: { qui: 'Mima', texte: 'Droits provisoires : lecture des lignes, dans un rayon de vingt-cinq mètres. Vous pouvez refuser.', choix: [
      { texte: 'Poser la main.', vers: 'ok',
        effet: (etat) => { if (!etat.pouvoirs.includes('calque')) etat.pouvoirs.push('calque'); } },
      { texte: 'Retirer la main.', vers: 'non' },
    ] },
    ok: { qui: '', texte: 'Le panneau accepte. Une ligne fine passe sous votre paume, puis derrière vos yeux.', suite: 'ok2' },
    ok2: { qui: 'Mima', texte: 'Voilà. Touche C pour voir, touche C pour cesser.' },
    non: { qui: 'Mima', texte: 'Comme vous voulez. La borne reste là.' },
  },
};

// --- Étiquettes propres à la Clinique du Réveil, par ancre (zones/clinique.js : ANCRES) ---
// `sansLigne` : étiquette ambre. La première ligne est le titre.
export const ETIQUETTES_CLINIQUE = {
  lit: { lignes: ['Lit 1 — occupé', 'Occupant : Réveillé n°4', 'Draps : défaits'] },
  litVide: { lignes: ['Lit 2 — libre', 'Occupant précédent : n°1', 'Draps : faits'] },
  vitreVeille: { lignes: ['Chambre de veille', 'Occupants : 1', 'Accès : personnel soignant'] },
  dormeuse: { lignes: ['Veille 1', 'Pensée : close', 'Halo : éteint'] },
  casier: { lignes: ['Casier 4 — effets d’admission', 'Paquet de cigarettes — sans ligne'], sansLigne: true },
  borne: { lignes: ['Borne d’admission', 'Fonction : accueil', 'Charte : service'] },
  anneau: { lignes: ['Anneau de Mima', 'Fonction : écoute', 'Charte : toutes clauses'] },
  fenetre: { lignes: ['Fenêtre 2', 'Vue : Kasumi', 'Transparence : 100 %'] },
  borneCalque: { lignes: ['Borne de la porte', 'Droits : provisoires', 'Demande : en cours'] },
};

// --- Listes pour les lignes générées par graine ---
export const PRENOMS = [
  'Ren', 'Aiko', 'Itsuki', 'Mina', 'Hugo', 'Sana', 'Léa', 'Takumi', 'Noa', 'Yuki', 'Camille', 'Haru',
  'Inès', 'Kenji', 'Louise', 'Émile', 'Nao', 'Chiara', 'Mei', 'Jules', 'Sora', 'Margaux', 'Daichi', 'Alma',
];
export const NOMS = [
  'Takeda', 'Moreau', 'Hayashi', 'Lefèvre', 'Mori', 'Garnier', 'Okada', 'Faure', 'Ishida', 'Roux',
  'Sato', 'Petit', 'Kuroda', 'Marchand', 'Nakano', 'Berger', 'Fujita', 'Colin', 'Aoki', 'Perrin',
];
export const HORAIRES = [
  '22 h à 7 h', '21 h à 5 h', '23 h à 8 h', '20 h à 4 h', '19 h à 3 h', '0 h à 9 h', '18 h à 2 h', '22 h à 6 h',
];

// portes
export const PORTES_USAGE = [
  'Usage : {nom} — {horaire}',
  'Usage : {nom} — {horaire}',
  'Usage : foyer {nom} — {horaire}',
  'Usage : service — {horaire}',
];

// objets interactifs sans texte propre
export const OBJETS = {
  titre: 'Objet {code}',
  lignes: ['Usage : {libelle}', 'Charte : service'],
};

// vitrines et commerces (dons : on ne vend rien)
export const COMMERCES = [
  'Cantine', 'Atelier de reprise', 'Étal de nouilles', 'Fleuriste', 'Lingerie', 'Salon de coiffure',
  'Théière', 'Bibliothèque de quartier', 'Réparation', 'Vestiaire', 'Boulangerie', 'Salle de chant',
];
export const DONS = [
  'nouilles chaudes', 'bouquets', 'vêtements repris', 'thé', 'pain', 'chansons', 'coupes de cheveux', 'piles rechargées',
];
export const VITRINE = {
  titre: '{commerce} — lot {code}',
  lignes: ['Don : {don} — {horaire}', 'Destinataire du soir : {prenom}'],
};

// immeubles
export const GESTIONS = [
  'Registre, secteur 5', 'Registre, secteur 2', 'Mima, direct', 'Registre, secteur 8', 'Copropriété (Charte)',
];
export const IMMEUBLE = {
  titre: 'Lot {code}',
  lignes: ['{n} lignes habitées', 'Gestion : {gestion}'],
};

// lampadaires
export const FONCTIONS_LAMPE = ['veille', 'éclairage', 'veille', 'relais', 'comptage'];
export const LAMPADAIRE = {
  titre: 'Lampadaire {code}',
  lignes: ['Fonction : {fonction}', 'Charte : service'],
};
