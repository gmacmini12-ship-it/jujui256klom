// État mémorisé du jeu (voir docs/bible.md, §7.4).
// Un seul objet `etat`, muté en place : d'autres modules gardent sa référence,
// il ne faut donc jamais le remplacer, seulement changer ses propriétés.
// Sauvegarde dans le localStorage sous la clé « remanence.etat ».

const CLE_SAUVEGARDE = 'remanence.etat';
const TRAJET_MAX = 4000;
const NOMS_PROFILS = ['testeur', 'archiviste', 'soigneux', 'discret', 'indocile'];

// Accès au stockage, protégé (navigation privée, données bloquées, Node).
function stockageDisponible() {
  return typeof localStorage !== 'undefined' && localStorage !== null;
}

function lireStockage(cle) {
  try {
    if (!stockageDisponible()) return null;
    return localStorage.getItem(cle);
  } catch (e) {
    return null;
  }
}

function ecrireStockage(cle, valeur) {
  try {
    if (!stockageDisponible()) return false;
    localStorage.setItem(cle, valeur);
    return true;
  } catch (e) {
    return false;
  }
}

// Construit l'état de départ, neuf à chaque appel.
export function etatInitial() {
  const transgressions = {};
  for (let i = 1; i <= 15; i++) transgressions['T' + i] = 0;
  return {
    pouvoirs: [],
    fragments: [],
    attention: 0,                 // 0..100
    attentionMax: 0,
    transgressions,
    refus: 0,                     // conseils ignorés
    mensonges: [],                // identifiants des mensonges dits
    doutesSemes: [],              // habitants à qui l'on a parlé
    soin: 0,                      // aider un Glaneur renversé, parler aux anciens, écouter le Refuge…
    sourdineUsages: 0,
    sourdineTemps: 0,             // secondes cumulées de Sourdine
    echoUsages: 0,
    cigarettes: { fumees: 0, paquet: 9, reapprovisionnements: 0, decouvert: false, donne: null, arret: false },
    chutes: 0,
    rattrapageCoupe: false,
    invarianceVerifiee: false,    // Lecture + Sourdine sur un écran de Mima
    questionsPosees: [],
    zonesVisitees: [],
    zone: 'clinique',
    position: null,               // { x, y, z, yaw } dans la zone `zone`, mis à jour par la boucle
    ouvertureVue: false,          // la séquence d'ouverture a été jouée (sinon : nouvelle partie)
    trajet: [],                   // [x, z, t, évènement] toutes les 0,5 s, plafonné
    rencontres: {},
    drapeaux: [],                 // posés par les dialogues (dialogues à usage unique)
    bondPropose: false,
    doutesHeure: {},              // identifiant → horodatage du doute semé
    conseilsDits: [],
    finsVues: [],
    messagePourLeN5: null         // laissé dans la fin « Rester », réapparaît aux parties suivantes
  };
}

// L'objet d'état unique, initialisé à l'état de départ.
export const etat = etatInitial();

function estObjetSimple(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Fusion en profondeur : les objets sont fusionnés, les tableaux et valeurs remplacés.
function fusionner(base, source) {
  const resultat = { ...base };
  for (const cle of Object.keys(source)) {
    const valeur = source[cle];
    if (estObjetSimple(valeur) && estObjetSimple(base[cle])) {
      resultat[cle] = fusionner(base[cle], valeur);
    } else {
      resultat[cle] = valeur;
    }
  }
  return resultat;
}

// Remplace le contenu de `etat` en place (même objet, mêmes références).
function remplacerContenu(nouveau) {
  for (const cle of Object.keys(etat)) delete etat[cle];
  Object.assign(etat, nouveau);
}

// Charge la sauvegarde par-dessus l'état initial. Renvoie true si une sauvegarde existait.
export function charger() {
  const brut = lireStockage(CLE_SAUVEGARDE);
  if (brut === null) return false;
  let sauvegarde;
  try {
    sauvegarde = JSON.parse(brut);
  } catch (e) {
    return false;
  }
  if (!estObjetSimple(sauvegarde)) return false;
  remplacerContenu(fusionner(etatInitial(), sauvegarde));
  return true;
}

// Sauve `etat` en JSON, en ne gardant que les 4000 entrées les plus récentes de `trajet`.
export function sauver() {
  if (etat.trajet.length > TRAJET_MAX) {
    etat.trajet.splice(0, etat.trajet.length - TRAJET_MAX);
  }
  try {
    ecrireStockage(CLE_SAUVEGARDE, JSON.stringify(etat));
  } catch (e) {
    // Sérialisation impossible : on ignore, le jeu continue sans sauvegarde.
  }
}

// Remet l'état au départ, en conservant les fins vues et le message pour le N°5, puis sauve.
export function reinitialiser() {
  const finsVues = etat.finsVues;
  const messagePourLeN5 = etat.messagePourLeN5;
  const nouveau = etatInitial();
  nouveau.finsVues = finsVues;
  nouveau.messagePourLeN5 = messagePourLeN5;
  remplacerContenu(nouveau);
  sauver();
}

let sauvegardeAutoInstallee = false;

// Sauvegarde périodique (5 s) et à la fermeture de la page. Ne s'installe qu'une fois.
export function demarrerSauvegardeAuto() {
  if (sauvegardeAutoInstallee) return;
  sauvegardeAutoInstallee = true;
  setInterval(sauver, 5000);
  if (typeof window !== 'undefined' && window && typeof window.addEventListener === 'function') {
    window.addEventListener('beforeunload', sauver);
  }
}

// Profils atteints selon les règles de la bible (§7.4). Peut en renvoyer plusieurs.
export function profils() {
  const transgressionsTotales = Object.values(etat.transgressions)
    .reduce((somme, n) => somme + (Number(n) || 0), 0);
  const trouves = [];
  if (transgressionsTotales >= 12 || etat.attentionMax >= 85) trouves.push('testeur');
  if (etat.fragments.length >= 24) trouves.push('archiviste');
  if (etat.soin >= 6 && !etat.transgressions.T12) trouves.push('soigneux');
  if (etat.sourdineUsages >= 15 && etat.attentionMax < 35) trouves.push('discret');
  if (etat.refus >= 15) trouves.push('indocile');
  return NOMS_PROFILS.filter((nom) => trouves.includes(nom));
}

export function aPouvoir(nom) {
  return etat.pouvoirs.includes(nom);
}

// Ajoute un fragment. Renvoie false s'il était déjà trouvé, sinon l'ajoute, sauve et renvoie true.
export function ajouterFragment(id) {
  if (etat.fragments.includes(id)) return false;
  etat.fragments.push(id);
  sauver();
  return true;
}
