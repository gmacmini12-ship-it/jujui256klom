# RÉMANENCE — Architecture (une page)

```
src/main.js          assemble tout, boucle step(dt) → rendre(), window.__game
src/game.js          `jeu` : contexte partagé, évènements, systèmes, suspensions
src/state.js         `etat` + sauvegarde (localStorage « remanence.etat », toutes les 5 s)
src/input.js         touches (event.code), pressed/isDown/heldFor, label() AZERTY/QWERTY
src/interact.js      objets interactifs, invite « E — libellé »
src/zones/           manager.js (zones, portes, fondus), clinique.js, kasumi.js, decor.js
src/systems/         index.js (registre) + un fichier par système
src/ui/              hud, dialogue, frise, ouverture, accueil
src/data/            TOUT le texte affiché (interface, ouverture, dialogues, fragments, conseils…)
```

Règle : un agent ajoute **son propre fichier** et, au plus, une ligne dans `systems/index.js`, `data/` ou `main.js` (enregistrement d'une zone). On ne réécrit pas la boucle.

## Le contexte `jeu` (src/game.js)

`import { jeu } from '../game.js'` donne : `renderer, composer, bloom, camera, player, hud, dialogue, frise, interact, zones, etat, sauver, input, smoking, audio, rain, ouverture`, `jeu.scene` (scène courante), `jeu.t`, `jeu.jouable` (le joueur a la main), `jeu.config` (lu avant la construction des zones).

- Évènements : `jeu.on(nom, fn)` → fonction de désabonnement ; `jeu.emettre(nom, donnees)` renvoie `donnees`.
  Émis : `partie:debut {nouvelle}`, `partie:nouvelle`, `ouverture:debut`, `ouverture:fin`, `zone:sortie {nom, zone, vers}`, `zone:entree {nom, zone, depuis}`, `interaction {objet}`, `dialogue:ouvert`, `dialogue:ferme`, `frise:ouverte`, `frise:fermee`, `cigarette:avant {annule}` (mettre `annule = true` empêche d'allumer), `cigarette:allumage`, `cigarette:bouffee`, `cigarette:etat {de, vers}`, `cigarette:jetee`.
- Figer le joueur : `jeu.suspendre(raison, { libererSouris })` / `jeu.reprendre(raison)` (la souris est reprise quand plus rien ne suspend).
- Bande de Mima : `jeu.hud.mima(texte, { duree })` ; la masquer : `jeu.masquerMima(raison, true|false)` (plusieurs raisons peuvent coexister).
- Dialogue : `jeu.ouvrirDialogue(DIALOGUES.x)` → Promise (fin du dialogue). La souris est libérée et le joueur figé automatiquement.

## Ajouter un système

```js
// src/systems/paquet.js
export const paquet = {
  nom: 'paquet',
  preparer(jeu) {},                 // avant les zones : régler jeu.config
  init(jeu) { jeu.on('cigarette:avant', (ev) => { if (jeu.etat.cigarettes.paquet <= 0) ev.annule = true; }); },
  update(dt, t, jeu) {},            // chaque image (même en pause : tester jeu.jouable)
  surZone(nom, zone, jeu) {},       // entrée dans une zone, y compris la première
  apresRendu(jeu) {},               // après composer.render() (CSS2DRenderer, etc.)
};
// src/systems/index.js : import { paquet } from './paquet.js'; jeu.enregistrer(paquet);
```

Modèle commenté : `src/systems/exemple.js`. Un système qui modifie la ville (Hashira) fait dans `preparer` : `jeu.config.ville.blocsReserves.push([4, 4])` (pâté central vide, reste de la ville identique), puis dans `init` : `const k = jeu.zones.get('kasumi'); k.scene.add(tour); k.colliders.push({ minX, maxX, minZ, maxZ });`.

## Collisions, hauteur, joueur (src/player.js)

Collider : `{ minX, maxX, minZ, maxZ, minY?, maxY? }`, dans le tableau `zone.colliders` (gardé par référence, on peut y pousser plus tard).
- **Sans `minY`/`maxY`** : mur infini (clinique, tour, décor ajouté par les systèmes) : rien à changer.
- **Avec** : boîte 3D. Son sommet `maxY` est un sol praticable (toits, trottoirs à 0,3 m, marches), son dessous `minY` un plafond (on s'y cogne la tête).
- Le sol sous le joueur = le sommet le plus haut sous son empreinte (carré de 1,2 m) qui ne dépasse pas ses pieds de plus d'une marche (0,35 m), ou y = 0. Une boîte ne bloque latéralement que si son sommet dépasse les pieds de plus de 0,35 m et si son dessous est sous la tête (corps de 1,85 m). Au sol, on suit les descentes jusqu'à 0,45 m (escaliers, trottoirs) sans « tomber ».
- Sous-pas de 0,2 m au plus et balayage vertical : pas de traversée, même à 60 m/s ou avec un pas de 0,2 s. Arrêt au contact (pas de rebond), glissement le long des murs. Une boîte dans laquelle on se trouve déjà ne retient pas (on peut en sortir).

`jeu.player` (en plus de `position`, `velocity`, `update`, `teleporter(x, y, z, yaw, pitch)`, `regarder`, `orientation`, `setColliders`, `bloque(x, z, y?)`) :
- `auSol` ; `vitesseChute` (m/s, ≥ 0, 0 au sol) ; `hauteurChute` (m déjà tombés depuis le point le plus haut du vol en cours) ; `derniereChute { hauteurChute, vitesse }`.
- `solSous(x, z, y = Infinity, rayon = 0)` → hauteur du sol sous le point (x, z) pour qui se tient à `y` (sommet le plus haut ≤ y, 0 au minimum).
- `sauter(vy = 6.5)` → bool (seulement au sol) ; `impulser(vx|null, vy, vz|null, { controleAir })` (pouvoirs : remplace la vitesse ; `controleAir` bas = élan conservé jusqu'à l'atterrissage).
- `amortissement` (m, 4 par défaut, 12 avec le Bond) : hauteur de chute encaissée sans conséquence, recopiée dans l'évènement d'atterrissage. Les conséquences (Veilleur, échec) restent à écrire, à partir des évènements.
- `sautAuto` (vrai : Espace saute dès l'appui ; le Bond le met à faux et gère le saut au relâchement), `decalageVue` (m, ajouté à la hauteur de la caméra), `dimensions { yeux, rayon, taille, marche, gravite, saut }`.
- Constantes exportées : `EYE, RAYON, TAILLE, MARCHE, GRAVITE, SAUT, AMORTI_BASE`.

Évènements : `joueur:saut { y, vitesse }` (décollage par un saut ou une impulsion), `joueur:chute { y }` (le sol se dérobe : bord d'un toit, sans sauter), `joueur:atterrissage { hauteurChute, vitesse, y, amortissement, amortie }` (`hauteurChute` = plus haut point du vol − y d'arrivée ; `vitesse` = vitesse verticale à l'impact, m/s ; `amortie` = `hauteurChute <= amortissement`).

Sauvegarde : `etat.position = { x, y, z, yaw }` (la hauteur est reprise : on se réveille sur le toit). Tests : `__game.teleport(zone, x, z, yaw, pitch, y = 0)`.

Ville (`jeu.zones.get('kasumi')`) :
- `immeubles` : `[{ x, z, w, d, h, hMax, etage, bloc }]` (centre, largeurs, `h` = toit principal, `etage` = `{ x, z, w, d, h0, h1 }` étage technique ou null, `hMax` = sommet réel, `bloc` = [i, j]). Les colliders des immeubles et de leurs étages techniques sont des boîtes 3D ; les trottoirs aussi (0,3 m).
- `escaliers` : `[{ nom, pied: [x, y, z], yawMontee, sommet: [x, y, z], chemin: [[x, y, z]…], hauteurMarche, marches, immeuble, toits: [{ x, z, w, d, h }], escalierToit?, marchesToits? }]` (zones/escaliers.js, liste `ESCALIERS` pour en ajouter).
- `city.enseignes` : groupe des enseignes de façade (on peut retirer celles qui gênent).

## Le Bond (src/systems/bond.js)

`jeu.bond` : `accorder()` (ajoute 'bond' à `etat.pouvoirs`, sauve, notifie, émet `pouvoir:accorde { nom }` ; renvoie vrai la première fois), `actif`, `charge` (s), `pret`. Avec le pouvoir : Espace bref = saut normal (au relâchement) ; maintenu 0,4 s puis relâché = Bond vertical (≈ 9 m) ou, en courant (Maj), saut long (≈ 15 m) ; chutes amorties jusqu'à 12 m. Évènements : `bond:charge`, `bond:impulsion { type: 'vertical' | 'long' }`. Sons : `jeu.audio.tonalite({ de, vers, duree, volume, type })`, `jeu.audio.souffle({ de, vers, duree, volume, q })`.

## Personnages nommés, marché, foule (étape 2)

- `jeu.npc.ajouterPersonnage({ id, nom, position, yaw, apparence, lignes, libelle, dialogue, apres })` (src/systems/npc.js, en-tête pour le détail) : silhouette + halo + objet interactif. `dialogue` est évalué à l'appui sur E ; **à la fin** du dialogue `etat.rencontres[id]` est incrémenté, puis `apres(p, dialogue)`. `apparence.variante` 3 = assis (dessus du tabouret à 0,56 m), `penche`, `vacille`, accessoires `micro`/`loupe`.
- `jeu.personnages` (src/systems/personnages.js, textes dans data/personnages.js) : Oba (tabouret du salon de thé), Kaede (atelier 修理), le Kiosque (décor du marché, interaction sur l'écran-visage), Itsuki (trottoir est du karaoké, lot (60-79) × (60-79), dont le toit porte le fragment 27 : toits.js). Après chaque dialogue : T8 / T9 de `etat.transgressions` (+1 par mensonge / doute semé nouveau) et évènement `transgression { id, source }` ; Bond de Kaede = pose (fondu, un temps, retour) puis `bond.accorder()` ; fragment 10 (souvenir d'Oba, sans ramassage) par `ajouterFragment(10)` ; évènement `personnage:dialogue { perso, dialogue, transgressions, bond, fragments, paquet }`. `jeu.personnages.dernier` = le dernier résumé.
- Objets interactifs et Calque : un objet qui porte `lignes` (et `sansLigne`, `decalageEtiquette`) donne son propre texte au Calque ; `sansEtiquette: true` le fait ignorer.
- Marché (`jeu.zones` Kasumi, systems/marche.js) : `marche.colliders` ont des hauteurs (étal 1,1 m au-dessus du trottoir, cloisons, arches 7,6 m, mât 50 m ; estrades basses = marches de 0,3 m) ; `marche.allees` = segments des allées où marchent les habitants (npc.js : graphe des allées, 60 % des habitants placés quand le joueur est près, arrêts face aux étals) et trois Glaneurs (robots.js). Les côtés de pâté couverts par les étals sont interdits aux habitants ; les trajets de robots qui touchent un collider haut sont abandonnés.
- Fragments obtenus en parlant : `POSITIONS_PAR_DIALOGUE` (data/fragments-positions.js), non ramassables.

## L'Attention (src/systems/attention.js, montants et seuils dans data/attention.js)

`jeu.attention` = `{ valeur, palier, plancher, enPause, ajouter(points, { id, source }), fixer(v) }`. Valeur 0–100 dans `etat.attention` (sauvegardée ; `etat.attentionMax` suit le maximum), paliers 0–14 / 15–34 / 35–59 / 60–84 / 85–100. Plancher = 4 × nombre de types `etat.transgressions[Tn] > 0`. Décroissance : −1 point toutes les 30 s sans montée (partie en cours), jusqu'au plancher. `jeu.sourdine?.actif` : ni montée ni descente. `fixer(v)` impose la valeur sans plancher (retombée à 60 après la conversation du palier 4).
- Entrée unique : `transgression { id: 'T1'…'T15', source, attention? }` (montant de l'évènement s'il est fourni, sinon `MONTANTS[id]`). **L'émetteur** incrémente `etat.transgressions[id]` (une fois) puis émet `transgression` (une fois) ; l'Attention n'incrémente rien. Émetteurs actuels : robots.js (T3, avec `robot:renverse` conservé), veilleur.js (T6 dans `compterChute`, rattrapée ou non ; `veilleur:rattrapage` conservé), personnages.js (T8, T9). T7 (conseils ignorés) n'est pas une transgression : `etat.refus` +1, 0 point, aucun évènement.
- Sorties : `attention:change { valeur, delta, id }` (id = Tn, `decroissance`, `fixer`, `nouvelle`), `attention:palier { palier, ancien }` (montée et descente).
- Aucune jauge ; `?attention` dans l'URL affiche une ligne de débogage en haut à gauche.

### La conversation du palier 4 (src/systems/conversation.js, textes dans data/dialogues-attention.js et data/conversation.js)

Quand `jeu.reactions.appelActif` (Attention ≥ 85), Mima pose la question dans sa bande ; rien ne s'ouvre sans E. Invite « E — Répondre à R-4 » devant un hologramme proche, l'écran du Kiosque ou un écran déclaré par `jeu.conversation.ajouterEcran({ zone, position, rayon })` (cabines d'un lieu futur), et, tant que la question attend, une invite libre partout en ville. L'invite ouvre un dialogue à deux choix. Refus : `etat.conversation.refus` +1, réplique, rappel après 3 min de temps de jeu (`texteRappel(refus)`), Attention inchangée. Acceptation : `DIALOGUES_ATTENTION[choisirConversation(etat)]` ; si elle va à son terme, `jeu.attention.fixer(60)` (l'appel cesse) puis `conversation:fin { dormir, chaise }` (drapeaux `palier4_dormir` / `palier4_chaise`, laissés posés ; aucune fin n'est lancée ici). Évènements : `conversation:debut`, `conversation:fin`, `conversation:interrompue` (dialogue quitté avant la fin : l'appel reste), `conversation:refus { refus }`, `conversation:rappel { refus }`. API : `jeu.conversation` = `{ disponible, enCours, enAttente, refus, rappelRestant, ajouterEcran, proposer(), accepter(), refuser() }`. État sauvegardé : `etat.conversation = { refus, rappelRestant (s), enAttente }` ; l'appel dérive de l'Attention, donc reprend après rechargement. Sourdine : ni invite, ni question, ni minuteur. Si l'Attention redescend sous 85 sans conversation, la question et le minuteur sont annulés (le compteur de refus reste).

## La Sourdine et les questions à Mima (étape 4)

`jeu.sourdine` (src/systems/sourdine.js, textes dans data/sourdine.js) = `{ actif, jauge (0..1), possede, accorder(), duree }`. `accorder()` ajoute `'sourdine'` à `etat.pouvoirs`, sauve, notifie et émet `pouvoir:accorde { nom: 'sourdine' }` (un dialogue de la docteure Sall l'appellera). Maintenir X : jauge de 20 s, recharge complète en 30 s (relâchée seulement) ; à vide, il faut relâcher X avant de rouvrir ; sans le pouvoir X ne fait rien ; un dialogue, la pause ou une suspension la ferment. Évènements `sourdine:debut`, `sourdine:fin { duree }` ; état sauvegardé `etat.sourdineUsages` (activations) et `etat.sourdineTemps` (s cumulées). Quand `actif` : la bande de Mima est masquée (`masquerMima('sourdine')`) et sa file jetée (`jeu.hud.viderMima({ courant })`, rien ne ressort à la fin) ; `jeu.audio.accompagnement(niveau, duree)` coupe la nappe en 0,5 s et laisse la pluie, plus présente, filtre ouvert (`audio.diagnostic` donne les gains) ; l'uniform `sourdine` (0..1, lissé) de `FilmShader` désature et serre la vignette (rendu strictement inchangé à 0) ; l'Attention est en pause ; `reactions.js` fige tout sauf les Veilleurs suiveurs (ils perdent leur cible, dérivent, s'estompent, mettent 2,5 s à retrouver le joueur à la fin, `REGLAGES.veilleurPerdu`) et les rideaux « pour entretien » (ils se relèvent, ne se referment pas) ; pas d'appel du palier 4 (`conversation.js`), pas de rattrapage (`veilleur.js` : la chute échoue, sans couper le rattrapage pour la suite), plus de conseils (`conseils.js`). Aucune Barrière de Prévenance ni Sentinelle n'existe encore.

`jeu.questions` (src/systems/questions.js, textes dans data/questions.js) = `{ ouvrir() → Promise, disponibles(), posees, enCours, banque }`. `ouvrir()` construit à la volée un dialogue : liste des questions de `QUESTIONS_MIMA` (data/dialogues-etape4.js, chargé par `import.meta.glob`, repli `QUESTIONS_REPLI`) filtrées par `si(etat)`, non posées d'abord, posées marquées « ✓ » en fin de liste ; choisir affiche la réponse (une ou plusieurs phrases) puis revient à la liste ; « (Ne rien demander.) » ferme ; au-delà de neuf choix, 7 questions par page et « (Autres questions.) ». `etat.questionsPosees` (ids, sauvegardé), évènement `question:posee { id, premiere }`. Pendant la Sourdine l'anneau ne répond pas (une ligne de narration). Aucun point d'accès n'est posé : l'écran-visage du Kiosque est un autre personnage ; l'agent qui pose les anneaux appelle `jeu.questions.ouvrir()`.

## La Lecture (étape 5 ; src/systems/lecture.js, valeurs et libellés dans src/data/lecture.js)

`jeu.lecture` = `{ possede, accorder(), actif, cible, enregistrerCible({ type, position | objet | suivre(), zone, rayon?, id?, nom?, vecteurs?, portee? }) → { retirer() } }`. `accorder()` ajoute `'lecture'` à `etat.pouvoirs` (comme les autres pouvoirs ; le dialogue du Lecteur Ezra l'appellera). Maintenir V avec le pouvoir : portée 15 m, cône étroit (`REGLAGES_LECTURE.cone` + ce que la cible sous-tend), pas de lecture à travers un collider. Sans cible : réticule discret ; avec une cible : panneau DOM ancré (trait vers la cible), nom, quatre barres (Complaisance, Hostilité, Fabulation, Détresse) qui se remplissent en 0,5 s puis vivent (bruit léger, jamais pour Mima) et la clause de la Charte appliquée. Avec la Sourdine (`jeu.sourdine.actif`) la cible « ne se sait plus observée » : le panneau dit « non observée » et les barres prennent `observe + ecart` (data/lecture.js, par type : `kiosque`, `porteur`, `glaneur`, `veilleur`, `mima`, `refuge`, `sentinelle`, `defaut`) ; Mima : écart nul, sans bruit, clause identique, donc barres identiques au pixel près. Noms et clauses : `LECTURES` de `data/dialogues-etape5.js` (`import.meta.glob`, repli `CLAUSES_REPLI`). Cibles relevées à chaque image de la zone courante : `jeu.robots.liste()` (barres propres à chaque machine : `caractere` de robots.js ; la Détresse non nulle marque un Porteur sur quatre, par ordre de création), le Kiosque (`marche.ancres.kiosqueVisage` ; compté comme `mima` quand l'appel du palier 4 y affiche Mima), les Veilleurs (patrouilles, suiveurs du palier 3, intercepteur), les hologrammes de la ville dont `msgMix > 0,35` (donc affichant Mima ; portée comptée au bord du panneau), les anneaux de la Maison, les écrans déclarés à `jeu.conversation.ajouterEcran` dans d'autres zones, et tout ce que les zones déclarent par `enregistrerCible` (types `refuge`, `sentinelle`…). Les habitants ne sont pas lisibles. État sauvegardé : `etat.lectures` `{ type: n }` (une lecture par cible et par maintien, comptée quand les barres ont fini de se remplir), `etat.lecturesSousSourdine`, `etat.detresseVue` (Détresse non nulle hors Mima), `etat.detresseMimaVue`, `etat.lectureMima` `{ observe, nonObserve }`, `etat.invarianceVerifiee` (posée une fois quand Mima a été lue dans les deux états ; évènement `lecture:invariance` et notification neutre). Évènements : `lecture:debut { type, id }`, `lecture:lue { type, id, nonObserve }`, `lecture:fin { type, id }`, `lecture:invariance`.

## La Maison des Conseils (étape 4 ; src/zones/maison.js, src/systems/maison.js, src/data/maison.js)

Zone `maison` (intérieur, un seul fondu) et système `maison`. **Entrée** : le pâté [4, 2] de Kasumi (centre (0, −120), réservé par `preparer`) porte la façade : portique de six colonnes, fronton gravé « Vous ne posséderez rien et vous serez heureux », pylône 相談所 de 44 m au coin sud-est ; porte en (0, −100,7), arrivée en ville `points.maison` = (0, 0, −96,4). Du départ (38, 44) : carrefour (30, 30), rue x = 30 jusqu'à z = −90, puis ouest jusqu'à x = 0 (~190 m). **Intérieur** (repère : entrée au sud z = +18, regard −z) : nef x ∈ [−9, 9] × z ∈ [−12, 18] (fronton de la Charte à z = 5, accueil et anneau à l'ouest) ; escalier de 21 marches (0,2 m) en z ∈ [−12, −6,1] vers l'étage y = 4,2 ; transept z ∈ [−34, −12] = Clinique du Jugement à l'étage (fauteuils, bureau de la docteure) et, au rez-de-chaussée sous la dalle, la Cabine du Sceau (x ∈ [−4,5 ; 4,5], z ∈ [−31, −19], porte au sud) ; aile ouest = Salle des Consultations (dix cabines, un anneau de Mima chacune) ; aile est = Médiathèque des Avant (neuf écrans 2020–2049 à texte défilant par décalage d'UV). Collisions : au rez-de-chaussée de 0 à 4 m, à l'étage de 4 m vers le haut (la dalle est une boîte 3D praticable, les rampes de l'escalier des boîtes pleines). Décor fusionné par matériau (≈ 50 appels de dessin au plus).

Branchements (tous testés à l'exécution, rien n'est importé en dur) : `data/dialogues-etape4.js` lu par `import.meta.glob` (sans lui, aucune invite « Parler ») pour `sall`, `patient`, `consultant1..3` (silhouettes `npc.ajouterPersonnage`, créées à la première entrée) ; fin d'un dialogue de Sall avec le drapeau `sall_sourdine` → `jeu.sourdine.accorder()` (réessayé à chaque image tant que le pouvoir manque) ; anneaux libres (cabines, accueil) → `jeu.questions.ouvrir()` ; chaque anneau déclaré à `jeu.conversation.ajouterEcran` ; Cabine du Sceau → `jeu.fins.sceau()` (fins.js ouvre le dialogue `sceau`). `'maison'` est dans `T4.zones` (fumer y est déplacé). Fragments 5, 6, 7, 9 (Médiathèque, mur est), 14 (Charte), 15 (vitrine), 20, 21, 22 (Clinique du Jugement) : lignes `zone: 'maison'` de data/fragments-positions.js. API : `jeu.maison` = `{ zone, personnages, lancer(id), dernier, LIEUX }` ; évènement `maison:dialogue { perso, sourdine }`.

## Ajouter un objet interactif

```js
const obj = jeu.interact.ajouter({
  zone: 'clinique', position: [x, y, z], rayon: 2.2, libelle: TEXTES.casier,  // texte venu de data/
  action: (obj, jeu) => { … }, visible: (obj, jeu) => true,  // facultatif
});
jeu.interact.retirer(obj);
```
L'objet le plus proche dans le cône de vue (≈ 35°) affiche `E — libellé` (`input.label('KeyE')`). Points utiles de la clinique : `jeu.zones.get('clinique').ancres` (casier, borne, oreillerVide, lit…). Pour un label au-dessus de chaque objet (Calque), parcourir `jeu.interact.liste(jeu.zones.nom)`.

## Ajouter une zone

```js
// src/zones/marche.js
export function creerMarche(jeu) {
  const scene = new THREE.Scene();
  … // géométrie ; jeu.zones.porte({ zone: 'marche', position, libelle, vers: 'kasumi', point: 'marche' })
  return { scene, colliders: [], bornes: 40, apparition: { position: [0, 0, 0], yaw: 0 },
           points: { kasumi: { position: […], yaw } },
           ambiance: { brouillard: { couleur, densite }, exposition: 1.1, pluie: false, reflet: false,
                       bloom: { force, rayon, seuil }, son: { pluie: 0.03, filtre: 4000 } },
           entrer(jeu) {}, sortir(jeu) {}, update(dt, t, jeu) {} };
}
// main.js, à côté des autres : zones.enregistrer('marche', creerMarche);
// data/interface.js : TITRES_ZONES.marche = { titre, sous }
```
Une zone est construite une seule fois, au premier `get`/`aller`. Le gestionnaire déplace la caméra (main, cigarette), la fumée et la pluie (si `ambiance.pluie`), coupe le `reflecteur` si `ambiance.reflet` est faux, change les colliders, place le joueur et sauve `etat.zone`. Changer de zone en code : `jeu.zones.aller(nom, { point })` (fondu) ou `jeu.zones.installer(nom, point)` (immédiat). Yaw : 0 = regarde vers −z, π/2 = vers −x.

## Ajouter un texte

Tout texte affiché vit dans `src/data/` : `interface.js` (accueil, commandes, invites `INVITES`, titres de zones, enseignes), `ouverture.js` (séquence et minutage), `dialogues.js` (format en tête du fichier), `fragments.js`, `conseils.js`. Le code importe la constante ; il n'écrit jamais de phrase.

## Tester sans carte graphique

Serveur : `npx vite --port 5173 --strictPort`. Ouvrir `http://localhost:5173/?test` (= `?sanssouris` + `preserveDrawingBuffer`) : on joue sans verrouiller la souris. Playwright (`NODE_PATH=$(npm root -g) node script.cjs`), Chromium avec `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`, fenêtre 1120×630.

```js
await page.waitForFunction(() => window.__game?.zones.courante);
await page.evaluate(() => { const g = window.__game; g.arreter(); g.jouer(); g.ouverture.passer(); });
const png = await page.evaluate(() => { const g = window.__game;
  g.teleport('kasumi', 30, 30, 0); g.tenir('KeyW', 2); g.step(1/30, 10); return g.capture(); });
```
`window.__game` : `step(dt, n)`, `rendre()`, `capture()` (PNG du canvas), `arreter()`, `teleport(zone, x, z, yaw, pitch)`, `regarder(yaw, pitch)`, `appuyer(code)`, `tenir(code, secondes)`, `jouer()`, `nouvellePartie()`, et `jeu, etat, input, hud, dialogue, frise, interact, zones, ouverture, accueil, player, camera, renderer, composer, smoking, audio`. Le HUD, les dialogues et la frise sont en HTML : pour les voir, `rendre()` puis `page.screenshot()`. Les vraies touches (`page.keyboard.press`) passent par `input.js`, puis `step()` les traite. `localStorage.clear()` pour repartir d'une nouvelle partie.

## Les fins (src/systems/fins.js, src/ui/fin.js, textes dans data/fins.js et data/dialogues-etape4.js)

`jeu.fins.terminer(idFin, { variante, paragraphes })` : joueur figé (`'fin'`), fondu noir, épilogue en paragraphes (un par appui sur Entrée / Espace / E / clic, apparition lente), bilan (une ligne par élément non nul : cigarettes fumées et contenance du paquet, fragments sur 35, `transgressions.T1` = portes ouvertes sans ligne, conseils ignorés, mensonges, doutes semés, soin, chutes ; `FINS[id].bilanSupplement(etat)` pour les fins 3 à 5), profil(s) de Mima (`profils()` de state.js, règles de la bible §7.4 ; aucun profil : la phrase « très peu de choses que je n'avais pas prévues »), puis l'écran titre (« Reprendre » rend la partie là où elle était : debout, lumière et son rendus). Évènements `fin:debut { id, variante }`, `fin:terminee { id, variante }` ; `jeu.fins.dernier` garde `{ id, variante, paragraphes, bilan, profils }`. Pour ajouter une fin : appeler `terminer('fin3', { paragraphes: [...] })` et déclarer l'entrée dans `FINS` (data/fins.js). `jeu.accueil` et `jeu.nouvellePartie` sont exposés par main.js pour cet usage.

Mémoire entre les parties : localStorage `remanence.memoire` = `{ finsVues, variantes, messagePourCinq, fragmentsConnus, cycle, relance }`, recopiée dans `etat` à chaque `partie:nouvelle` (`etat.finsVues`, `etat.messagePourLeN5`, `etat.cycle`, `etat.fragmentsConnus`). L'écran titre affiche « FINS VUES : n / 5 » (nombre seulement).

- **Fin 1** : le lit de la Clinique (invite « S'allonger » dès que `etat.zonesVisitees` contient `kasumi`) ; la caméra bascule vers le plafond (temps de jeu), dialogue `choisirDialogueEtape4('lit')`, puis lumières (`light.intensity` et exposition) et son (`audio.regler`) se ferment, `terminer('fin1', { variante: etat.reveilChoisi })`. Se relever sans finir rend la main. `conversation:fin { dormir: true }` conduit le joueur au lit (fondu) et ouvre `lit_question`. « Dans cinquante ans » (`variante: 'cinquante'`) relance une partie via `jeu.nouvellePartie()` : ouverture à la date de 2126 (`ACCUEIL_2126`, `OUVERTURE` patché à chaque nouvelle partie), fragments déjà trouvés restaurés dans `etat.fragments` et marqués « Déjà connu » dans la frise.
- **Fin 2** : `jeu.fins.sceau()` (à appeler à l'entrée de la cabine) ouvre `choisirDialogueEtape4('sceau')` ; si le drapeau `sceau_accepte` est posé : halo (`film.uniforms.halo` : couleurs réchauffées et vignette rose-violet, nul = rendu inchangé), `audio.accord('majeur', duree)` (la nappe se résout, `accord('defaut')` la rend), retour en ville (point `REGLAGES_FINS.sceau.point`, près d'Itsuki), une minute de marche (le temps ne compte que quand le joueur a la main) avec saluts à prénom stable (`etat.prenomSceau`, bulles HTML) et l'invitation d'Itsuki, puis `sceau_message` (sauvé dans la mémoire, objet « Lire » + éclat sur le toit du karaoké dans les parties suivantes, à côté du fragment 27) et `terminer('fin2')`.
