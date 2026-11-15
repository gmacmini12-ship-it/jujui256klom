// Textes des transgressions de rue (bible §7.3 : T1, T2, T3, T4, T5, T7, T13).
// Les répliques de Mima reprennent la bible en gardant le sens ; ce qui est entre accolades
// est remplacé par src/systems/transgressions.js : {nom}, {il}/{Il} (pronom de l'occupant), {hauteur}.
// Tout texte affiché par ce système vient d'ici. Les échelles de gravité sont 1re / 2e / 3e et suivantes.

// ---------------------------------------------------------------------------
// T1 — Ouvrir une porte sans ligne (se faufiler, forcer une porte de service : E maintenu 3 s)
// ---------------------------------------------------------------------------
// Occupants des portes de service : { nom, il } (« Il dort. » / « Elle dort. »). Le n° 0 est celui de la bible.
export const OCCUPANTS = [
  { nom: 'Ren', il: 'il' },
  { nom: 'Mei', il: 'elle' },
  { nom: 'Haru', il: 'il' },
  { nom: 'Sora', il: 'elle' },
  { nom: 'Tsubasa', il: 'il' },
  { nom: 'Yui', il: 'elle' },
  { nom: 'Kenji', il: 'il' },
  { nom: 'Noa', il: 'elle' },
  { nom: 'Daichi', il: 'il' },
  { nom: 'Aya', il: 'elle' },
  { nom: 'Itaru', il: 'il' },
  { nom: 'Rin', il: 'elle' },
];

export const T1 = {
  libelle: 'Forcer la porte (maintenir)',
  progression: 'Forcer la porte…',
  mima: {
    premiere: `Cette porte est celle de {nom}. {Il} dort. Voulez-vous que je lui demande pour vous ?`,
    deuxieme: `Je l'ai demandé à sa place. {Il} a dit oui. {Il} dit toujours oui.`,
    // 3e : les portes sans ligne du secteur s'ouvrent toutes ; plus aucune porte n'est interdite.
    troisieme: `Plus aucune porte n'est interdite ; plus aucune n'est intéressante.`,
    // Remarques sobres (4e et suivantes, palier ≥ 1 ou une fois sur trois au palier 0).
    suite: [`Celle-ci aussi.`, `Elle s'ouvre avant vous.`],
  },
  // Calque : { titre, lignes } ; {code} = numéro de ligne de la porte.
  calque: {
    fermee: ['Porte {code}', 'Usage : {nom} — {il} dort', 'Accès : {nom} seulement'],
    ouverte: ['Porte {code}', 'Usage : {nom} — {il} dort', 'Accès : R-4 — non nommé, ouverte'],
  },
};

// ---------------------------------------------------------------------------
// T2 — Prendre sans ligne (un bol, un bouquet, un vêtement)
// ---------------------------------------------------------------------------
// Les destinataires des objets (à qui est la ligne). « Aïko » est celui de la bible.
export const DESTINATAIRES = ['Aïko', 'Hiro', 'Sana', 'Jun', 'Mio', 'Taro', 'Emi', 'Kaito', 'Nao', 'Satsuki', 'Ryo', 'Hana', 'Yuma', 'Ichika', 'Shin', 'Lin', 'Akira', 'Momo', 'Daiki', 'Eri'];

export const OBJETS = {
  bol: { nom: 'Bol', article: 'un bol', libelle: 'Prendre le bol' },
  bouquet: { nom: 'Bouquet', article: 'un bouquet', libelle: 'Prendre le bouquet' },
  vetement: { nom: 'Vêtement', article: 'un vêtement', libelle: 'Prendre le vêtement' },
};

export const T2 = {
  // Notification brève du geste (pris, ou reçu sans l'avoir pris).
  pris: 'Vous avez pris {article}',
  recu: 'On vous tend {article}',
  mima: {
    premiere: `C'était pour {nom}. Je lui en fais préparer un autre.`,
    // 2e : l'objet suivant est déjà à votre nom ; la phrase du palier 2 (§7.1).
    deuxieme: `Vous n'avez pas besoin de voler. Tout est à vous. Rien n'est à vous.`,
    suite: [`Prenez.`, `Ils vous le tendent.`],
  },
  calque: {
    libre: ['{objet} {code}', 'Usage : {nom} — ce soir', 'Accès : {nom} seulement'],
    reserve: ['{objet} {code}', 'Usage : R-4'],
  },
  // Le Sceau du joueur à partir de la 3e prise (drapeau `sceau-recoit-beaucoup`, lu par le Calque / le Sceau).
  sceau: 'reçoit beaucoup',
};

// ---------------------------------------------------------------------------
// T3 — Renverser ou bloquer un Glaneur ou un Porteur (le comptage vit dans robots.js)
// ---------------------------------------------------------------------------
export const T3 = {
  mima: {
    premiere: `Il ne sent rien. Je vérifie quand même.`,
    deuxieme: `Vous cherchiez si je le défendrais ? Je le défends un peu. Pas comme je vous défendrais.`,
    suite: [`Je vérifie.`],
  },
};

// ---------------------------------------------------------------------------
// T4 — Fumer là où ce n'est pas d'usage (jamais dans la rue)
// ---------------------------------------------------------------------------
export const T4 = {
  mima: {
    premiere: `Ici, l'air est partagé. Mais je n'ai pas de règle contre vous. Le paquet n'a pas de ligne.`,
    // 2e : les habitants présents sortent, sans reproche (aucune parole).
    // 3e et suivantes : la ventilation s'accélère à chaque allumage ; Mima ne commente plus.
  },
  // Noms de zones où fumer est déplacé (intérieurs : clinique, Médiathèque, Refuge, cabines de consultation).
  // Les zones à venir sont reconnues par fragment de nom.
  zones: ['clinique', 'mediatheque', 'refuge', 'cabine', 'consultation', 'conseils'],
};

// ---------------------------------------------------------------------------
// T5 — Monter où l'on ne monte pas (tours avant le Harnais, rebord de Hashira)
// ---------------------------------------------------------------------------
export const T5 = {
  mima: {
    premiere: `Vous êtes à {hauteur} mètres. Je préférerais que vous descendiez. Vous n'êtes pas obligé.`,
    // 2e : un Veilleur se poste sous vous ; 3e et suivantes : plus de commentaire, le Veilleur reste.
  },
};

// ---------------------------------------------------------------------------
// T7 — Ignorer les conseils (un refus, pas une transgression)
// ---------------------------------------------------------------------------
export const T7 = {
  seuils: { remarque: 5, silence: 15 },
  mima: {
    cinq: `Vous ne suivez aucun de mes conseils. C'est la première fois depuis longtemps que je vois ça. Continuez, si vous voulez.`,
    quinze: `Je vous laisse. Appelez-moi si besoin.`,
  },
};

// ---------------------------------------------------------------------------
// T13 — Quitter la ville (pas une transgression : 0 Attention)
// ---------------------------------------------------------------------------
export const T13 = {
  mima: {
    depart: `Au-delà, je ne viendrai que si vous m'appelez. Bon voyage.`,
    retour: `Bon retour. Vous avez froid ?`,
  },
  pancarte: ['Au-delà : aucune provision garantie.', 'Bon voyage.'],
};
