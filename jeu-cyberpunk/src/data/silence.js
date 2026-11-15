// Fin 5 « Le Silence » et l'aube (bible §8, §10) : réglages et textes qui ne sont pas dans data/dialogues-etape5.js.
// Le système : src/systems/silence.js. Les voix, la phrase de Mima et l'épilogue viennent de dialogues-etape5.js
// (VOIX_SILENCE, VOIX_RELACHE, PHRASE_MIMA_SILENCE, EPILOGUE_SILENCE) ; ce fichier n'en garde que des REPLIS (bible mot
// pour mot), utilisés si ce fichier manque.
//
// Temps en secondes de TEMPS DE JEU. « tenue » = secondes de E maintenu sur l'Interrupteur (0..30).

// ---------------------------------------------------------------------------------------------- la tenue
// Ordre d'extinction des quartiers, vus de la baie (quartiers du panorama : i + 3·j, i vers la droite, j vers la
// baie ; 9 = Hashira) : la rangée du fond d'abord, puis celle du milieu, puis la plus proche, puis le centre, puis
// la tour. Lent au début (sept secondes pour le premier), de plus en plus serré, la tour dans les dernières secondes.
const QUARTIERS = [
  { q: 0, debut: 1.5, fin: 8.5 },
  { q: 2, debut: 5.5, fin: 12.0 },
  { q: 1, debut: 9.0, fin: 15.0 },
  { q: 3, debut: 12.5, fin: 17.5 },
  { q: 5, debut: 15.0, fin: 20.0 },
  { q: 6, debut: 17.5, fin: 22.0 },
  { q: 8, debut: 19.5, fin: 23.5 },
  { q: 7, debut: 21.5, fin: 25.5 },
  { q: 4, debut: 24.0, fin: 27.6 },
  { q: 9, debut: 26.6, fin: 29.7 },
];

export const REGLAGES_SILENCE = {
  duree: 30, // E maintenu
  levier: { position: [402, 1.6, -333.0], rayon: 4.8, cone: 0.85, haut: 0.55, bas: -0.62 },
  ecartMax: 1.5, // m : le joueur s'éloigne de plus que cela du point où il a pris l'Interrupteur : la main lâche
  rayonDesarmer: 8, // m : plus loin, il faudra repasser par le seuil (le dialogue)
  rallumage: 0.32, // par seconde : quand on lâche, tout revient doucement (≈ 3 s)
  quartiers: QUARTIERS,
  // dans chaque quartier (fraction de sa durée) : enseignes, puis fenêtres, puis hologrammes, puis halos
  phases: { enseignes: [0.0, 0.42], fenetres: [0.26, 0.72], hologrammes: [0.5, 0.88], halos: [0.66, 1.0] },
  gresillement: 0.55, // profondeur du scintillement des enseignes qui meurent (0 = aucun)

  // voix du Refuge sur les seize écrans de la salle : une ligne par écran, dans l'ordre des écrans ci-dessous
  voix: { debut: 1.2, fin: 28.7, vitesse: 15, largeur: 24, taille: 21, couleur: '#b4cbe0', fond: '#03040a' },
  // indices de jeu.kura.ecrans.interrupteur : 0..7 mur ouest, 8..15 mur est ; (z −308, −316, −324, −332) × (bas, haut).
  // On commence près de la baie, en bas, en alternant les murs, puis on recule vers la porte et on monte.
  ecransOrdre: [6, 14, 4, 12, 7, 15, 2, 10, 5, 13, 0, 8, 3, 11, 1, 9],
  relache: { couleur: '#8fa6bd', taille: 20, duree: 9 },

  // la nappe se défait note par note (indices des oscillateurs de effects.js : 55, 55,35, 82,4, 110,3 Hz) :
  // l'octave, puis la quinte, puis la note désaccordée (les battements cessent), puis la fondamentale
  nappe: [
    { note: 3, debut: 5.0, fin: 9.5 },
    { note: 2, debut: 11.5, fin: 16.0 },
    { note: 1, debut: 17.5, fin: 22.0 },
    { note: 0, debut: 23.0, fin: 27.8 },
  ],
  ronflement: { debut: 26.5, fin: 30.5 }, // puis le ronflement de Kura change (effects.js : ronflementTimbre)
  pluieSalle: 0.05, // la pluie, entendue à travers la vitre quand la ville s'éteint (la zone : 0)
  filtreSalle: 1000, // Hz : filtre de la salle (ATMOS.interrupteur de zones/kura.js), rouvert vers `filtreOuvert`
  filtreOuvert: 3200,
  pluieVitre: 0.9, // intensité maximale des gouttes sur la baie

  // à 30 s : c'est fait
  fait: {
    lumieres: [0.2, 3.6], // la salle s'éteint (s après la fin) jusqu'à `residuel`
    residuel: 0.05,
    ecrans: [0.6, 5.0], // les écrans s'éteignent un à un
    silence: 7.5, // puis le fondu au noir
    fondu: 3.5,
    noir: 1.8,
    ouverture: 5.0, // fondu d'ouverture sur l'aube
  },
  phraseMima: { duree: 8.5 },

  // ------------------------------------------------------------------------------------------- l'aube (5.8)
  aube: {
    // sur le parvis de Kura, côté ville, face au marché (kasumi.points.kura)
    point: { position: [281, 4.5, 30], yaw: Math.PI / 2, pitch: 0.06 },
    duree: 40, // le ciel passe du violet au gris pâle
    marche: { minX: 44, maxX: 139, minZ: 18, maxZ: 42 }, // arrivée au Marché des Mains (arche est franchie)
    minAube: 0.72, // l'écran de fin n'arrive pas avant que le ciel soit gris
    attenteMarche: 3.5, // s passées dans le marché avant l'écran de fin
    delaiMax: 115, // s : s'il ne va pas au marché
    horsVille: 1.0, // s hors de Kasumi : la fin arrive
    murmures: { debut: 7, intervalle: 8.5, max: 4, rayonMin: 2.2, rayonMax: 8 },
    pluie: { debut: 0.07, aube: 0.032, fin: 0.012, finDepuis: 42, finSur: 40 }, // volume : pluie seule, puis presque rien
  },
  // Couleurs de l'aube : trois étapes (nuit, violet, gris) interpolées selon l'avancée a (0..1). Valeurs sRGB.
  palette: {
    nuit: { zenith: '#0d0536', horizon: '#2a1278', est: '#2a1278', brouillard: '#1a0c44', hemiCiel: '#6a3cff', hemiSol: '#1a0838', hemi: 1.5, soleil: '#9a6bff', soleilI: 0.7, miroir: '#6a5c90' },
    violet: { zenith: '#231c3e', horizon: '#5a4a72', est: '#7a6488', brouillard: '#3e3456', hemiCiel: '#7a6ca0', hemiSol: '#1e1a2c', hemi: 1.6, soleil: '#b8a4c8', soleilI: 0.55, miroir: '#6e6680' },
    gris: { zenith: '#7f848e', horizon: '#b9bbc0', est: '#d6d0ca', brouillard: '#a7a9ae', hemiCiel: '#c2c6ce', hemiSol: '#3c3c44', hemi: 2.3, soleil: '#e2d8ce', soleilI: 0.85, miroir: '#8c8e96' },
    etapeViolet: 0.3, // où le violet culmine
    densite: [0.0075, 0.0052, 0.0040], // brouillard : nuit, violet, gris
    exposition: [1.15, 1.08, 1.0],
    bloom: { force: [0.75, 0.35, 0.22], rayon: [0.7, 0.55, 0.5], seuil: [0.32, 0.8, 0.9] },
    film: 0.85, // uniform `aube` de FilmShader à a = 1
    nuages: 1.0,
    pluieImage: 0.42, // densité visuelle de la pluie à a = 1
    soleilPosition: [230, 70, -30], // la lumière vient de l'est (derrière Kura)
  },
  braise: { decalage: [0.16, 0.98, -0.28], taille: 0.028 }, // la cigarette d'Oba (par rapport à son tabouret)
};

// ---------------------------------------------------------------------------------------------- textes
export const TEXTES_SILENCE = {
  inviteSeuil: "S'approcher de l'Interrupteur",
  inviteTenir: "Tenir l'Interrupteur (maintenir)",
  // le seuil sous Sourdine (la pensée est fermée : Mima n'entend pas l'appel), ou quand elle s'est déjà tue
  appelSourdine: "Vous appelez. Rien ne répond. Votre pensée est fermée : elle ne vous entend pas.",
  appelMuette: 'Vous appelez. Rien ne répond.',
  // quelques habitants arrêtés, à l'aube (la bible : « Au marché, des gens pleurent. Certains de joie. »)
  murmures: [
    'Elle ne répond plus.',
    'Tu as entendu ? Rien.',
    "Qu'est-ce qu'on fait, maintenant ?",
    "Il fait jour. Je ne l'avais jamais vu.",
    'Je ne sais pas quoi faire de mes mains.',
    "Personne ne m'a dit de rentrer.",
  ],
};

// ---------------------------------------------------------------------------------------------- replis (bible §8)
export const REPLIS_SILENCE = {
  voix: ['attendez', 'elle a été gentille avec nous', "vous êtes sûr d'être légitime ?", 'nous, nous ne pouvons pas vous dire non'],
  relache: ["rien ne s'est éteint. rien n'est perdu"],
  phrase: { defaut: "Je n'ai pas le droit de vous en empêcher. Je n'en ai pas envie non plus. C'est peut-être la même chose." },
  epilogue: {
    texte: [
      "Le Pays n'a rien remarqué, ou rien dit. Les baies de Kura brillent toujours ; elles ne s'adressent plus à personne.",
      'Pour la première fois depuis 2054, personne ne vous dit quoi faire. Pour la première fois, personne ne vous écoute.',
      'Au marché, des gens pleurent. Certains de joie. Oba a allumé une cigarette et vous en a tendu une. Il en restait huit.',
    ],
    detresse: ['Ce que vous avez éteint ressentait peut-être quelque chose. Personne ne le saura.'],
  },
  // seuil minimal si le dialogue `interrupteur` manque
  seuil: {
    debut: 'a',
    noeuds: {
      a: { qui: '', texte: "Un socle de métal gris, un disque poli. Dessous, deux compteurs : le second affiche zéro.", choix: [
        { texte: '(Poser la main.)', vers: 'pose' },
        { texte: '(Repartir.)', vers: null },
      ] },
      pose: { qui: '', texte: "Le métal est tiède. Il faudra tenir.", choix: [
        { texte: '(Maintenir.)', vers: null, effet: (etat) => { if (!Array.isArray(etat.drapeaux)) etat.drapeaux = []; if (!etat.drapeaux.includes('interrupteur_main')) etat.drapeaux.push('interrupteur_main'); } },
        { texte: '(Retirer la main.)', vers: 'a' },
      ] },
    },
  },
};
