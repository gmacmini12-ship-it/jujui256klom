// Textes des machines de la ville (bible §3.2) : invites d'interaction et lignes du Calque.
// Tout texte affiché par src/systems/robots.js vient d'ici.
//
// Les gabarits utilisent des champs entre accolades, remplacés par le système :
//   {id} {fonction} {tache} {charge} {destination}

// --- Invites (touche E) ---
export const INVITES_ROBOTS = {
  pousser: 'Pousser le Glaneur',
  redresser: 'Redresser le Glaneur',
};

// --- Calque : lignes d'un Glaneur ---
export const CALQUE_GLANEUR = {
  titre: 'Glaneur {id}',
  fonctions: ['tri', 'nettoyage', 'ramassage', 'collecte'],
  fonction: 'fonction : {fonction}',
  tache: 'tâche : {tache}',
  charte: 'Charte : service',
  // tâche affichée selon ce que fait la machine
  taches: {
    ronde: 'ronde du trottoir',
    ramasse: 'ramassage en cours',
    arret: 'attente : passage',
    bloque: 'attente : voie occupée',
    scan: 'relevé du sol',
    bascule: 'perte d’aplomb',
    renverse: 'capteur d’inclinaison : alerte',
    releve: 'remise d’aplomb',
    merci: 'accusé de réception',
  },
};

// --- Calque : lignes d'un Porteur ---
export const CALQUE_PORTEUR = {
  titre: 'Porteur {id}',
  tache: 'tâche : {tache}',
  charge: 'charge : {charge}',
  destination: 'destination : {destination}',
  charte: 'Charte : service',
  charges: [
    'repas, deux portions',
    'thé, quatre bouteilles',
    'vêtements, lot de trois',
    'pièces détachées',
    'livres, retour de prêt',
    'plantes en pot',
    'médicaments, ordonnance 22',
    'draps propres',
    'outils de jardin',
    'rouleaux de câble',
  ],
  destinations: [
    'cantine 食堂',
    'logement 5-B',
    'atelier 修理',
    'médiathèque',
    'logement 12-A',
    'serre du toit',
    'laverie',
    'logement 3-D',
  ],
  taches: {
    trajet: 'en route',
    livre: 'dépose en cours',
    arret: 'attente : passage',
    bloque: 'attente : voie occupée',
    ecarte: 'écart de courtoisie',
  },
};
