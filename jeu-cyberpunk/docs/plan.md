# RÉMANENCE — Plan de réalisation

Référence : `docs/bible.md` (contenu, règles, textes). Ce plan découpe le travail en **étapes jouables** : à la fin de chaque étape, `npm run dev` lance un jeu qui fonctionne, sans régression, et qu'on peut parcourir. Les étapes sont classées de la plus prioritaire à la moins prioritaire ; si le projet s'arrête après l'étape 4, on a déjà un jeu complet, court, avec deux fins.

Difficulté : **simple** (un agent léger suffit : données, texte, petite fonction isolée) · **moyenne** (un module à concevoir, intégration avec l'existant) · **difficile** (rendu ou physique délicats, architecture, risque de régression).

## Point de départ (prototype actuel)

- `src/main.js` : rendu basse résolution pixelisé (touche P), bloom, film, pluie, audio, boucle.
- `src/city.js` : ville de 9 × 9 pâtés (540 m), immeubles en boîtes fusionnées, vitrines, enseignes canvas, hologrammes à shader (anneau + ligne : ce sera le sceau de Mima), lampadaires, trafic aérien, ciel.
- `src/player.js` : marche, course, saut ; **collisions 2D uniquement** (boîtes au sol), sol à y = 0. C'est la principale limite technique : toits, Bond et Harnais exigent des collisions en hauteur (étape 2).
- `src/smoking.js` : cigarette sur F (allumage, bouffées, fumée en particules).

## Architecture visée (à créer au fil des étapes)

```
src/
  state.js            état du joueur + sauvegarde localStorage (bible §7.4)
  input.js            table des touches (event.code), affichage AZERTY/QWERTY
  interact.js         objets interactifs, invite « E », portée
  ui/                 hud.js (bande de Mima, notifications), dialogue.js, frise.js, ending.js
  zones/              manager.js (scènes, portes, fondus), clinique.js, kasumi.js, marche.js,
                      conseils.js, hashira.js, kura.js, scelle.js, dehors.js, cathedrales.js
  systems/            attention.js (paliers, réactions), powers.js, npc.js, robots.js, ghosts.js
  data/               fragments.js, dialogues.js, conseils.js, signs.js (existant)
```

Règle pour tous les agents : **tout le texte affiché vit dans `src/data/`**, jamais dans le code de rendu, pour que l'agent dialogues puisse travailler seul.

---

## Étape 0 — Fondations (aucun changement visible ou presque)

| Tâche | Détail | Difficulté |
|---|---|---|
| 0.1 `state.js` | Objet `etat` de la bible §7.4, `charger()`, `sauver()` (toutes les 5 s et à chaque évènement), `reinitialiser()`. Tout accès au `localStorage` dans un try/catch. | simple |
| 0.2 `input.js` | Centralise les touches (`KeyE`, `KeyC`, `KeyX`, `KeyV`, `KeyR`, `KeyJ`, `KeyF`, Espace maintenu). Fournit `isDown`, `pressed`, `heldFor(code)`. Libellés affichés selon la disposition détectée (`navigator.keyboard.getLayoutMap` si disponible, sinon AZERTY). | simple |
| 0.3 `interact.js` | Registre d'objets interactifs `{position, rayon, libellé, action}` ; le plus proche dans le cône de vue affiche « E — libellé ». | simple |
| 0.4 HUD et dialogue | Bande de Mima (anneau + texte, apparition/disparition douce), notifications courtes, boîte de dialogue à choix (clavier 1–4 et souris), file de messages. HTML/CSS par-dessus le canvas, police pixel. | moyenne |
| 0.5 Gestionnaire de zones | Plusieurs `THREE.Scene` ; une porte = un objet interactif qui fait un fondu au noir, change de scène, place le joueur, change les colliders et la couche sonore. La ville reste la scène principale (ne pas la reconstruire à chaque retour). | difficile |
| 0.6 Formats de données | `fragments.js` (id, titre, année, zone, texte, condition), `dialogues.js` (nœuds, choix, conditions sur `etat`, effets), `conseils.js`. Un exemple de chaque. | simple |

**Jouable à la fin** : le prototype, plus une porte de test vers une pièce vide et retour, et un objet qui affiche un texte.

---

## Étape 1 — Tranche verticale « Le réveil » (Clinique, Kasumi, Calque)

| Tâche | Détail | Difficulté |
|---|---|---|
| 1.1 Clinique du Réveil | Pièce en boîtes (bible §5.1), lumière froide unique, fenêtre émissive, lit, casier, borne, vitre de la chambre de veille. Départ du jeu ici ; porte vers Kasumi à (30, 30). Désactiver le `Reflector` en intérieur. | moyenne |
| 1.2 Séquence d'ouverture | Écran noir, bip, texte de date, fondu, première phrase de Mima. Pas de tutoriel : les invites « E » suffisent. | simple |
| 1.3 Calque (C) | Étiquettes texte en sprites canvas (ou `CSS2DRenderer`) au-dessus des portes, objets, robots, habitants dans 25 m ; ambre pour « sans ligne ». Données des lignes générées par graine (prénoms, horaires). Ligne du joueur : « Réveillé n°4 ». | moyenne |
| 1.4 Fragments et Frise (J) | Ramassage, notification, frise 2016–2076 avec une case par année, lecture des textes. Placer les fragments 1, 2, 3, 4, 25, 27 (le 27 attendra le Bond pour être atteignable). | moyenne |
| 1.5 Le paquet | Compteur (9) lié à `smoking.js` : affichage bref à l'allumage, paquet vide = la main ne trouve rien. Pendant qu'on fume : la bande de Mima se masque. | simple |
| 1.6 Hashira visible | Cylindre de 400 m au centre, texture de lignes défilantes (décalage d'UV). Remplace le pâté central. | simple |
| 1.7 Conseils de Mima | 10 premiers conseils contextuels (pluie, cantine, repos), compteur de refus. | simple |

**Jouable** : on se réveille, on sort, on voit les lignes, on trouve des fragments, on fume. 10 minutes de jeu.

---

## Étape 2 — Habitants, Marché des Mains, Bond, toits

| Tâche | Détail | Difficulté |
|---|---|---|
| 2.1 Silhouettes | Capsule + boîte sombres, halo en sprite additif (couleur selon l'humeur), déplacement par glissement le long de trajets (polylignes sur les trottoirs), rotation vers le joueur proche. `InstancedMesh` pour la foule, objets séparés pour les personnages nommés. Réaction « regardent le joueur qui fume ». | moyenne |
| 2.2 Robots | Glaneur, Porteur (formes de la bible §3.2), trajets, arrêt devant le joueur, Glaneur renversable (bascule animée). | moyenne |
| 2.3 Marché des Mains | Rue couverte (plans translucides), étals, lampions instanciés, vapeur (réemploi des particules de fumée), Kiosque à écran-visage, atelier de Kaede, tabouret d'Oba. Fragments 8, 10, 11, 19. | moyenne |
| 2.4 Collisions en hauteur | Colliders 3D (ajouter `minY`/`maxY`), sol = sommet de la boîte la plus haute sous le joueur, atterrissage sur les toits, murs latéraux seulement en dessous du toit. Escaliers de secours en boîtes. Prérequis du Bond et du Harnais. | difficile |
| 2.5 Bond | Espace maintenu 0,4 s puis relâché ; saut long en course ; amortissement jusqu'à 12 m. Installation chez Kaede (dialogue, choix). | moyenne |
| 2.6 Toits de Kasumi | Jardins (plans verts émissifs), antennes (cylindres), tabac d'Oba, toit du karaoké (fragment 27). | moyenne |
| 2.7 Chutes, Veilleur, Rémanences | Chute mortelle en ville : Veilleur (sphère) qui intercepte (deux fois), puis échec réel (T6). Bornes de Rémanence, fondu blanc à l'échec, retour à la dernière borne. | moyenne |
| 2.8 Dialogues de l'étape | Oba, Kaede, Kiosque, Itsuki (bible §9). | moyenne (écriture) |

**Jouable** : la ville est habitée, on parle, on saute sur les toits, on peut tomber. 25 minutes.

---

## Étape 3 — Tester les limites (le cœur du jeu)

| Tâche | Détail | Difficulté |
|---|---|---|
| 3.1 `attention.js` | Valeur 0–100, montants par transgression, décroissance 1 pt / 30 s, plancher = 4 × types commis, paliers (bible §7.2). Événements `onPalier`. | moyenne |
| 3.2 Transgressions de rue | T1 portes (se faufiler derrière un habitant, forcer en maintenant E), T2 prendre sans ligne, T3 robots, T4 fumer à l'intérieur, T5 hauteur, T7 refus, T13 quitter la ville. Réponses graduées 1re / 2e / 3e+ (texte dans `data/`). | moyenne |
| 3.3 Réactions du monde | Palier 1 : halos qui se tournent. Palier 2 : portes qui s'ouvrent d'avance, objets « à votre nom ». Palier 3 : Veilleur(s) qui suivent, habitants qui s'écartent, hologrammes « おかえり » (nouvelle texture du shader existant), portes « pour entretien ». | moyenne |
| 3.4 Palier 4 : la conversation | Écrans et cabines qui appellent « R-4 », refus possible (rappel toutes les 3 min), dialogue de fond, retour à 60. | moyenne |
| 3.5 Salle des Mains Courantes | Intérieur cylindrique au pied de Hashira ; murs de texte défilant ; les vraies écritures du joueur (portes, objets, cigarettes) s'insèrent dans le flux, lisibles. | moyenne |
| 3.6 T8 et T9 | Choix de dialogue marqués mensonge ou doute ; habitant « accompagné » au retour (halo rétabli, réplique changée). | simple |

**Jouable** : le joueur peut provoquer le système et le voir répondre de dix façons. C'est le moment de faire tester le jeu par quelqu'un.

---

## Étape 4 — Maison des Conseils, Sourdine, premières fins (premier jeu complet)

| Tâche | Détail | Difficulté |
|---|---|---|
| 4.1 Maison des Conseils | Scène intérieure : Salle des Consultations, Médiathèque des Avant, Clinique du Jugement, cabine du Sceau. Fragments 5, 6, 7, 9, 14, 15, 20, 21, 22. | moyenne |
| 4.2 Sourdine (X) | Jauge 20 s ; coupe la bande de Mima et la couche sonore « accompagnée » (gain à 0 en 0,5 s) ; met l'Attention en pause ; Veilleurs perdus. | moyenne |
| 4.3 Questions à Mima | Liste de questions débloquées par les fragments et les lieux (bible §2.1 : elle répond toujours la vérité, exactement à la question). Accessible en parlant à un anneau. | moyenne |
| 4.4 Écran de fin | Fondu, épilogue texte, ligne de bilan calculée depuis `etat`, retour au titre. Calcul du profil (bible §7.4). | simple |
| 4.5 Fin 1 « Dormir encore » | Lit de la Clinique, quatre réponses, quatre épilogues. (« Dans cinquante ans » relance simplement une partie pour l'instant.) | simple |
| 4.6 Fin 2 « Rester » | Cabine du Sceau, double confirmation, minute de marche sous halo (vignette, palette réchauffée, accord majeur), choix du message pour le n°5, épilogue. | moyenne |
| 4.7 Dialogues | Docteure Sall, habitants de la Maison. | moyenne (écriture) |

**Jouable** : environ 45 minutes, deux fins, la boucle « explorer / tester / reconstituer » complète.

---

## Étape 5 — Kura : l'échelle, la Lecture, l'Interrupteur

| Tâche | Détail | Difficulté |
|---|---|---|
| 5.1 Halls de Kura | Scène : dizaines de milliers de baies en `InstancedMesh`, diodes en vagues (shader émissif), brouillard dense, ronflement grave. Passerelle depuis le Marché. Viser 60 i/s : tester tôt. | moyenne |
| 5.2 Bibliothèque des Circuits et Refuge | Mezzanine de verre, cartes d'activations (textures canvas animées) ; Refuge froid, écrans éteints où défile du texte lent ; Ezra, Sept. Fragments 12, 13, 16, 17, 23. | moyenne |
| 5.3 Lecture (V) | Visée, quatre barres + clause, données par type de machine ; mode « non observé » si la Sourdine est active (valeurs différentes pour Kiosques et Porteurs, identiques pour Mima) ; `invarianceVerifiee`. | moyenne |
| 5.4 Profondeurs | Jauge de chaleur (bouches d'air chaud, distorsion), sol électrifié, ventilateurs ; Rémanence à mi-parcours. | moyenne |
| 5.5 Barrières de Prévenance | Volumes de danger connus ; une barrière (plan hexagonal + collider) se dresse quand le joueur se dirige vers l'un d'eux à moins de 8 m, sauf sous Sourdine. | moyenne |
| 5.6 T10, T12 | Franchissement de barrière ; arrachage de câble et réactions du Pays. | simple |
| 5.7 Fin 5 « Le Silence » | Salle de l'Interrupteur avec baie sur la ville ; E maintenu 30 s, interruptible ; voix du Refuge ; extinction de la ville quartier par quartier (intensité émissive par groupe de pâtés, hologrammes, lampadaires, halos), son qui se défait. Fragment 33. | difficile |
| 5.8 L'aube | Ciel qui passe du violet au gris pâle, brouillard éclairci, sortie à pied ; image clé n°4 en option. | moyenne |

**Jouable** : environ 65 minutes, trois fins.

---

## Étape 6 — Quartier Scellé, Banc d'Essai, Écho, fumée qui révèle

| Tâche | Détail | Difficulté |
|---|---|---|
| 6.1 Quartier Scellé | Bloc nord-ouest muré, verrière géodésique, éclairage ambré au sodium (seule zone sans violet), sans pluie, silence grésillant. Accès par les toits ou une bouche d'égout. Fragments 18, 24. | moyenne |
| 6.2 Sentinelles | Trépieds, cône ambré (cône transparent + test d'angle et de distance, occlusion simple par rayon), annonce en capitales, échec après 1,5 s dans le cône. | moyenne |
| 6.3 Enregistrement du trajet | `etat.trajet` : position toutes les 0,5 s + évènements (cigarette, transgression), plafonné (environ 15 000 points), hors Scellé. | simple |
| 6.4 Banc d'Essai | Paramétrer `buildCity` (`{ blankSigns, palette: 'blanc', rain: false, scale }`) et l'appeler avec la même graine 20771 ; silhouettes fantômes qui rejouent `etat.trajet`. Fragments 28, 29, 30, 35. | moyenne |
| 6.5 Écho (R) | 4 s de vision des contours à travers les murs (seconde passe : géométries simplifiées en matériau filaire/contours, `depthTest: false`, mélangée par-dessus), 60 m ; attire les Sentinelles dans le Scellé ; +Attention en ville. | difficile |
| 6.6 La fumée révèle les faisceaux | Faisceaux de capteurs (lignes fines) dont l'opacité dépend de la proximité des bouffées récentes (positions passées en uniform depuis `smoking.js`) : bleu en ville, ambre dans le Scellé. | difficile |
| 6.7 Réapprovisionnement du paquet | Paquet vide + Glaneur proche hors du champ de vision : paquet plein, ligne 7F3-0412 visible au Calque, répliques d'Oba et de Mima, don ou abandon (T15). | simple |
| 6.8 T11 | Réplique de sortie du Scellé ; questions de fond débloquées. | simple |

**Jouable** : environ 80 minutes. Tous les secrets de la ville sont accessibles.

---

## Étape 7 — Dehors : Lisière, Terres Rendues, Cathédrales, Harnais

| Tâche | Détail | Difficulté |
|---|---|---|
| 7.1 Tunnel du maglev | Couloir de lumière qui défile, pancarte, transition de scène et de son (sortie de la musique). | simple |
| 7.2 Terres Rendues | Plan déformé par bruit, herbes instanciées, champs de panneaux, pylônes, aurore lente, vent. | moyenne |
| 7.3 Moissonneuses | Blocs sur pattes, trajectoires lentes, échec si écrasé. | simple |
| 7.4 Camp des Sans-Lignes | Feux (sprites + lumière), abris de bâches, pile de caisses, Tomasz, Noor. Fragments 26, 34. | simple |
| 7.5 Cathédrales | Anneaux (`TorusGeometry`) en rotation, treillis, monolithes coulissants, impulsions lumineuses ; silhouettes visibles depuis la ville (hors brouillard). | moyenne |
| 7.6 Ascension | Plateformes mobiles (le joueur doit être porté par ce qui bouge), Rémanence au pied. | difficile |
| 7.7 Harnais | Poussée sur Espace maintenu en l'air, jauge 12 s, recharge au sol et lente en plané, plafond 420 m, traînée magenta, son de soufflante. Plateforme de Duarte, fragment 31. | moyenne |
| 7.8 Dialogues | Tomasz, Noor, enregistrements de Duarte. | simple (écriture) |

**Jouable** : environ 100 minutes, monde entier ouvert.

---

## Étape 8 — Vol libre et dernières fins

| Tâche | Détail | Difficulté |
|---|---|---|
| 8.1 Vol au-dessus de la ville | Collisions 3D avec les tours en vol, brouillard et distance d'affichage adaptés à l'altitude, trafic aérien qu'on croise. | moyenne |
| 8.2 Liaison des scènes en vol | Ville, Terres Rendues et Cathédrales doivent se rejoindre par les airs : soit une seule scène extérieure avec la ville au nord, soit une transition masquée par un banc de nuages. Choisir tôt (dès 7.2) pour ne pas refaire. | difficile |
| 8.3 Sommet de Hashira, Fin 4 « Siéger » | Salle du Conseil (31 sièges en arc + 1), poussière en particules, condition d'ouverture, quatre clauses, « se lever », épilogues. Image clé n°3 sur une vitrine. | moyenne |
| 8.4 Ligne d'horizon, Fin 3 « Partir » | Balise, choix « Couper le Lien », extinction des pouvoirs concernés, dernière marche, épilogue. | simple |
| 8.5 Fragment 32 | Traduction de la lumière des Cathédrales au sommet (Lecture requise). | simple |

**Jouable** : le jeu complet, cinq fins.

---

## Étape 9 — Finition

| Tâche | Détail | Difficulté |
|---|---|---|
| 9.1 Couches sonores | Couche « accompagnée », couche ville, couches de zone (bible §10), fondus entre zones, effets (soufflante, bip des Glaneurs, ronflement). | moyenne |
| 9.2 Variantes de fin selon le profil | Répliques de Mima et lignes de bilan pour chaque profil. | simple |
| 9.3 Relecture de tous les textes | Cohérence avec la bible, ton de chaque voix, longueur à l'écran. | moyenne (écriture) |
| 9.4 Images clés | Écran titre, photo de 2026 du téléphone, photo du Vote, aube (optionnelle). | simple |
| 9.5 Performances | Coût du `Reflector` (le couper en intérieur et en vol haut), nombre de draw calls, instanciation, lumières ponctuelles limitées. | moyenne |
| 9.6 « Dans cinquante ans » | Nouvelle partie qui garde fragments et souvenirs de Mima, réplique d'accueil différente ; message pour le n°5 visible. | moyenne |
| 9.7 Parcours complets | Trois parcours chronométrés (pressé, curieux, provocateur) : 60, 90 et 120 minutes visés ; ajuster jauges, distances, seuils. | moyenne |
| 9.8 Confort | Taille du texte, vitesse d'affichage, rappel des commandes, mise à jour du README. | simple |

---

## Risques à surveiller

- **Collisions verticales (2.4)** : tout ce qui suit en dépend. À faire par un agent de haut niveau, avec tests automatisés via `window.__game`.
- **Une ou plusieurs scènes pour le dehors (8.2)** : décision d'architecture à prendre au début de l'étape 7.
- **Écho et faisceaux dans la fumée (6.5, 6.6)** : les deux effets visuels les plus délicats ; prévoir une version dégradée (contours seuls ; faisceaux toujours visibles mais très pâles) si le temps manque.
- **Volume de texte** : environ 35 fragments, 10 personnages, 15 transgressions à trois niveaux, 5 fins à variantes. Confier l'écriture à un agent dédié, sur la base des voix de la bible §9, dès l'étape 2.
