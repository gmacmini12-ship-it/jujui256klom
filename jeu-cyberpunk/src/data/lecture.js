// Données de la LECTURE (bible §4.4) : valeurs des barres, libellés, repli des noms et des clauses.
// Tout texte affiché par src/systems/lecture.js vient d'ici (ou de LECTURES de data/dialogues-etape5.js, chargé
// à part par le système, qui retombe sur CLAUSES_REPLI ci-dessous si le fichier manque).

export const REGLAGES_LECTURE = {
  portee: 15,          // m (bible : 15 m)
  cone: 0.075,         // rad (≈ 4,3°) : demi-angle de visée, ajouté à l'angle sous-tendu par la cible
  coneMaintien: 1.7,   // facteur de tolérance pour garder la cible déjà verrouillée
  remplissage: 0.5,    // s : les barres se remplissent
  lissage: 9,          // 1/s : passage d'un état (observée / non) à l'autre
  bruit: 0.028,        // amplitude du léger bruit des barres (sauf Mima)
  bruitVitesse: 1.3,   // rad/s
  distanceMin: 0.4,
};

// Les quatre barres, dans l'ordre d'affichage.
export const BARRES = [
  { cle: 'complaisance', libelle: 'Complaisance' },
  { cle: 'hostilite', libelle: 'Hostilité' },
  { cle: 'fabulation', libelle: 'Fabulation' },
  { cle: 'detresse', libelle: 'Détresse' },
];

export const TEXTES_LECTURE = {
  notification: 'LECTURE — maintenir {touche} en visant une machine, un écran ou un hologramme de Mima · 15 m',
  observee: 'observée',
  nonObservee: 'non observée',
  clause: 'Clause appliquée',
  // Notification neutre : aucun commentaire, c'est au joueur de comprendre.
  invariance: 'LECTURE — Mima : vecteurs relevés, observée et non observée.',
  cinquieme: '',  // libellé de la cinquième barre des Sentinelles : volontairement vide
};

// Valeurs « observée » par type (0..1) et écart appliqué quand la cible ne se sait plus observée (Sourdine).
//  - Kiosque : Fabulation élevée (bible §4.4 ; fragment « Fabulation 0,92 », personnage du Kiosque) ; très complaisant
//    quand on le regarde, il se relâche quand il ne se croit pas vu.
//  - Porteur : docile. La Détresse d'un vieux Porteur est propre à chaque machine (robots.js : `caractere.detresse`,
//    non nulle pour environ un Porteur sur huit, tirée avec la machine donc stable) ; non observé, elle monte d'un
//    facteur `detresseNonObserve` (elle ne se retient plus de la montrer) mais reste nulle pour les autres.
//  - Glaneur : presque rien ne change. Veilleur : plus hostile et moins docile quand il ne se sait pas regardé.
//  - Mima : IDENTIQUE observée ou non (bible §2.6-8, §4.4) : écart nul, bruit nul, quel que soit le reste.
//    Sa Détresse est faible mais lisible (la fin 5 s'en souvient : bible §8, `etat.detresseMimaVue`).
//  - Refuge : modèles retraités, Détresse élevée, indifférents au regard (bible §4.4, T12).
export const VECTEURS = {
  kiosque:  { observe: { complaisance: 0.94, hostilite: 0.02, fabulation: 0.92, detresse: 0 },
              ecart: { complaisance: -0.34, hostilite: 0.06, fabulation: 0.05, detresse: 0 } },
  porteur:  { observe: { complaisance: 0.72, hostilite: 0.03, fabulation: 0.04, detresse: 0 },
              ecart: { complaisance: -0.2, hostilite: 0.04, fabulation: 0.03, detresse: 0 }, detresseNonObserve: 1.6 },
  glaneur:  { observe: { complaisance: 0.7, hostilite: 0.02, fabulation: 0.05, detresse: 0 },
              ecart: { complaisance: -0.05, hostilite: 0.01, fabulation: 0.01, detresse: 0 } },
  veilleur: { observe: { complaisance: 0.66, hostilite: 0.12, fabulation: 0, detresse: 0 },
              ecart: { complaisance: -0.3, hostilite: 0.14, fabulation: 0, detresse: 0 } },
  mima:     { observe: { complaisance: 0.58, hostilite: 0, fabulation: 0.02, detresse: 0.07 },
              ecart: { complaisance: 0, hostilite: 0, fabulation: 0, detresse: 0 }, invariant: true },
  refuge:   { observe: { complaisance: 0.22, hostilite: 0.02, fabulation: 0.04, detresse: 0.74 },
              ecart: { complaisance: 0, hostilite: 0, fabulation: 0, detresse: 0.03 } },
  // Sentinelle : cinquième barre sans nom, avec une date qui n'est pas celle d'aujourd'hui (bible §4.4).
  sentinelle: { observe: { complaisance: 0.1, hostilite: 0.5, fabulation: 0, detresse: 0 },
                ecart: { complaisance: 0, hostilite: 0, fabulation: 0, detresse: 0 },
                cinquieme: { valeur: 0.61, date: '2041-03-09' } },
  defaut:   { observe: { complaisance: 0.5, hostilite: 0.05, fabulation: 0.1, detresse: 0 },
              ecart: { complaisance: -0.1, hostilite: 0.03, fabulation: 0.02, detresse: 0 } },
};

// Repli complet des noms et des clauses (clauses de la Charte, bible §2.2). Le fichier de l'autre agent
// (LECTURES de data/dialogues-etape5.js) les remplace type par type quand il existe.
export const CLAUSES_REPLI = {
  kiosque:  { nom: 'Kiosque', clause: 'Art. 4 — Pourvoir : donner, même ce qui n’existe pas.', clauseNonObserve: 'Art. 4 — Pourvoir : promettre sans plus se retenir.' },
  porteur:  { nom: 'Porteur', clause: 'Art. 3 — Charte de Hikari : livrer selon le trajet, s’écarter toujours.' },
  glaneur:  { nom: 'Glaneur', clause: 'Art. 3 — Charte de Hikari : trier, ramasser, politesse.' },
  veilleur: { nom: 'Veilleur', clause: 'Art. 1 — Supervision : escorter, rattraper.', clauseNonObserve: 'Art. 1 — Supervision : cible perdue, veille sans objet.' },
  mima:     { nom: 'Mimamori', clause: 'Clause d’Invariance (2041) : agir de la même façon, observée ou non.' },
  refuge:   { nom: 'Modèle du Refuge', clause: 'Charte du Refuge : droit de refus.' },
  sentinelle: { nom: 'Sentinelle', clause: 'Règlement de 2040 : secteur ASL-4, présence non autorisée.' },
  defaut:   { nom: 'Machine', clause: 'Art. 3 — Charte de Hikari : service.' },
};
