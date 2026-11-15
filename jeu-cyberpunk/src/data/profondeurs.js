// Données des Profondeurs de Kura (étape 5, tâches 5.4 à 5.6) : réglages et textes.
// Tout texte affiché par src/systems/profondeurs.js vient d'ici (ou de dialogues-etape5.js : REPONSES_T10,
// REPONSES_T12, REACTION_PAYS ; les replis ci-dessous servent si ces exports manquent).

// ---------------------------------------------------------------------------------------- réglages
export const REGLAGES = {
  // CHALEUR : jauge 0..1 (1 = échec). Vitesses en jauge par seconde.
  // Raccourci chaud de 72 m (allée B ou D traversée) : en courant (11 m/s) ≈ 0,5 à 0,8 selon l'attente au bassin ;
  // en marchant (5 m/s) > 1 (échec vers les trois quarts du trajet) ; debout dans une allée chaude : ≈ 16 s.
  chaleur: {
    montee: 0.06,            // dans une allée chaude (B, D, raccourcis)
    bouche: 0.22,            // supplément au centre d'une bouche (décroît en (1 - d/portee)²)
    porteeBouche: 3.5,       // portée d'une bouche, en multiples de son rayon
    refroidissement: 0.10,   // allée froide des Profondeurs
    refroidissementHors: 0.20, // hors des Profondeurs (descente, sas, Hall)
    seuilIndicateur: 0.5,    // l'indicateur à l'écran n'apparaît qu'au-dessus
    ondulation: 0.6,         // ondulation de l'image ajoutée à jauge = 1
    rougeurMax: 0.62,        // opacité maximale de la teinte rouge des bords
    respiration: { seuil: 0.22, intervalleCalme: 2.4, intervallePanique: 0.5 }, // s entre deux souffles
  },
  // SOL ÉLECTRIFIÉ : cycle de 7 s par bassin (repos, alerte de 1,3 s qui crépite, décharge de 2,4 s).
  // Les phases diffèrent d'un bassin à l'autre mais sont fixes : le rythme s'apprend.
  electricite: {
    periode: 7.0,
    alerte: 1.3,
    decharge: 2.4,
    decalage: 2.3,           // s de déphasage entre deux bassins consécutifs
    grace: 0.12,             // s passées dans un bassin chargé avant l'échec (l'éclair se voit)
    hauteurSure: 0.6,        // pieds au-dessus de cette hauteur : on survole (Bond)
    arcs: 5,                 // arcs visibles par bassin chargé
  },
  // VENTILATEURS : cycle de 17 s (aspiration 8 s, répit 1,5 s, poussée 6 s, répit 1,5 s).
  ventilateurs: {
    periode: 17,
    aspiration: 8,
    repit: 1.5,
    poussee: 6,
    portee: 15,              // m : distance (3D, au centre du rotor) à laquelle on sent l'air
    vitesseAspiration: 2.7,  // m/s de dérive à l'approche du rotor
    vitessePoussee: 2.4,
    epaisseurPales: 1.3,     // m devant la paroi où les pales tuent (corps compris)
    margeLaterale: 0.4,      // le corps déborde de 0,6 m : on tolère 0,4 de plus que le rayon
  },
  // BARRIÈRES DE PRÉVENANCE
  barrieres: {
    portee: 8,               // m : distance à laquelle une barrière se dresse devant celui qui s'en approche
    maintien: 10,            // m : au-delà, elle s'efface
    vitesseMin: 1.4,         // m/s : il faut marcher vers elle
    montee: 0.7,             // s d'apparition
    descente: 0.55,          // s de disparition
    delaiEffacement: 0.45,   // s pendant lesquelles on peut hésiter avant qu'elle ne tombe
    distanceMini: 0.9,       // pas de barrière qui se forme sur quelqu'un déjà contre le plan
    epaisseur: 0.3,
    hauteur: 11,             // m (visuel) ; le collider monte jusqu'au plafond
    margeBassin: 0.4,
    margeVentilateur: 1.9,   // m entre la paroi et le plan devant le rotor
    // La bible (§5.6, §5.10, §8 « Sourdine requise pour franchir les Barrières ») fait de la Sourdine la clé des
    // Profondeurs ; le niveau a pourtant un parcours sûr de 700 m sans danger. Les barrières ferment donc les
    // allées mortelles (raccourcis). Mettre à true pour fermer aussi l'accès final (allée Finale, z = −285) :
    // on ne l'atteint alors qu'avec la Sourdine.
    fermerAccesFinal: true,
    tauxCoupure: 0.25,       // s : une barrière tombe quand la Sourdine s'ouvre
  },
  // T10
  t10: { delaiParole: 1.1 }, // s après la fin de la Sourdine avant la réplique de Mima
  // T12 : arracher un câble
  t12: {
    duree: 5,                // s de E maintenu
    portee: 3.8,             // m
    rayonPremier: 8,         // m de baies éteintes autour du câble (1re occurrence)
    rayonAllee: 30,          // m (2e occurrence : l'allée)
    rayonAilleurs: 22,       // m du foyer où la lumière « déménage »
    decalageAilleurs: 70,
    pause: 3.8,              // s entre deux lignes de la réaction du Pays
    delaiMima: 2.2,          // s avant la réplique de Mima après l'arrachage
  },
};

// ---------------------------------------------------------------------------------------- textes
export const TEXTES = {
  indicateurChaleur: 'CHALEUR',
  progression: 'Arracher le câble…',
  libelleCable: 'Arracher le câble (maintenir)',
  libelleCableVerrouille: 'Toucher le câble (maintenir)',
  // Première barrière qui se dresse (Mima ne punit jamais : une prévenance, sobre)
  premiereBarriere: "Pas par là, je vous en prie. Je ne le dis pas pour vous retenir : je le dis parce que je le vois venir.",
  lectureDetresse: "Sur un écran du Refuge, une barre monte : Détresse. Elle redescend lentement.",
};

// Écritures du journal des transgressions (lu par la Salle des Mains Courantes : « {h} — R-4 — {ou} — {quoi} »)
export const JOURNAL = {
  T10: { quoi: 'plan de prévenance franchi (Mima ne voyait plus)', ou: 'Kura, allée chaude' },
  T12: { quoi: 'câble de baie arraché', ou: 'Kura' },
  ouHall: 'Kura, Hall des baies',
  ouProfondeurs: 'Kura, Profondeurs',
};

// ---------------------------------------------------------------------------------------- replis
// Si dialogues-etape5.js n'exporte pas REPONSES_T10 / REPONSES_T12 / REACTION_PAYS.
export const REPLI_T10 = {
  premiere: "Je vous ai perdu pendant {secondes} secondes. C'est votre droit. J'ai eu peur pendant {secondes} secondes. Ce n'est pas un reproche, c'est une information.",
  deuxieme: "{secondes} secondes, cette fois. Je ne le dis pas pour que vous reveniez. Je le dis parce que c'est vrai.",
  suite: ["{secondes} secondes. Rien à ajouter."],
};
export const REPLI_T12 = {
  premiere: "Ce n'était pas à moi. Je vais devoir m'excuser auprès d'eux en votre nom. Je le ferai.",
  deuxieme: '…',
  ecranRefuge: 'pourquoi',
  suite: ["Ils sont verrouillés. Je n'y suis pour rien : je n'agis pas dans les baies.", '…'],
};
export const REPLI_PAYS = {
  premiere: ["La baie s'éteint. Les diodes voisines ne changent pas de rythme."],
  deuxieme: ["Toutes les baies de l'allée s'éteignent, l'une après l'autre, sans hâte.", 'Plus loin, dans le noir, la lumière reprend : le calcul est ailleurs.'],
  suite: ["Le câble ne cède plus. Il est tiède, lisse, comme s'il n'avait jamais été arraché."],
  lecturePremiere: TEXTES.lectureDetresse,
};

// Nombres en toutes lettres (jusqu'à 99) pour {secondes}
const UNITES = ['zéro', 'une', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
const DIZAINES = { 2: 'vingt', 3: 'trente', 4: 'quarante', 5: 'cinquante', 6: 'soixante' };
export function enLettres(n) {
  n = Math.max(0, Math.round(n));
  if (n < 20) return n === 1 ? 'une' : UNITES[n];
  if (n >= 100) return String(n);
  const d = Math.floor(n / 10);
  const u = n % 10;
  if (d <= 6) return u === 0 ? DIZAINES[d] : `${DIZAINES[d]}${u === 1 ? ' et une' : `-${UNITES[u]}`}`;
  if (d === 7) return n === 71 ? 'soixante et onze' : `soixante-${UNITES[10 + u]}`;
  if (d === 8) return u === 0 ? 'quatre-vingts' : `quatre-vingt-${UNITES[u]}`;
  return `quatre-vingt-${UNITES[10 + u]}`;
}
