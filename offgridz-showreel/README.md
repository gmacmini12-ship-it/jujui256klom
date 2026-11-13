# OFFGRIDZ — « INSOUMISE »

Showreel de 20 secondes (1080 × 1920, 30 images/s, 150 BPM) pour le studio créatif OFFGRIDZ.
Le film est calculé, pas généré : simulations et rendus sont reproductibles depuis ce dossier.

- `BIBLE.md` : les décisions validées (concept, feuille, palette, grille, textes, règles de travail, interfaces de fabrication).
- `DOSSIER_PREPRODUCTION.md` : storyboard chronométré, architecture, partition, références, plan, stratégie Katana.
  Version illustrée : `preprod/dossier.html`.
- `suivi.json` : état d'avancement affiché par la bande de suivi (`outils/suivi-insoumise`).

## État

Projet terminé : film livré et validé par le client le 13 novembre. Crédits Higgsfield dépensés : 147,68, uniquement en
location de machine de calcul (test GPU 8,63 ; palier 3 : 33,82 ; palier 4 : 70,99 ; session C : 16,98 ; session D : 17,26). Cible 200, plafond 345 ; chaque dépense est soumise au client avant d'être engagée.

| Séquence | Images | État |
|---|---|---|
| 0 – 1 Épreuve, déchirure | 0 – 71 | finale (`out/final/seq01`, session B) ; images 57 et 58 refaites en local sans les fibres |
| 2 Grains | 72 – 215 | finale (`out/final/seq2`) : 893 319 grains ; aucun grain hors du verre |
| 3 Mojito | 216 – 359 | finale ; liquide confiné, brin de menthe corrigé ; images 265 à 321 refaites pour que rien ne sorte du verre (session D) |
| 4 Données | 360 – 455 | finale (`build/seq4`, 6 millions de points), gardée telle quelle par le client |
| 5 – 6 Fond perdu, signature | 456 – 599 | finale (`out/final/seq56/matiere`, session B2) |
| Assemblage | 0 – 599 | `build/final/compose.py` ; contrôle `build/final/qc.py` |

## Arborescence

| Dossier | Contenu |
|---|---|
| `timeline/partition.json` | La source unique des temps du film (événements sur la grille musicale) |
| `assets/logo/` | Logo source, calques séparés, vecteurs, mesures et rapport de fidélité |
| `assets/fonts/` | 38 caractères sous licence libre, contours du mot OFFGRIDZ, planches de spécimens |
| `build/timeline/` | Génération et vérification de la partition |
| `build/dossier/` | Contenu et fabrication du dossier de préproduction |
| `build/logo/`, `build/type/` | Décomposition du logo ; texte vers contours (polices statiques et variables) |
| `build/animatique/` | Animatique schématique (référence de rythme, repli du compositeur) |
| `build/audio/` | Synthèse de la bande son (maquette, puis version finale pilotée par les simulations) |
| `build/sim/` | Solveur de grains (méthode des points matériels) et scène du déferlement |
| `build/grains/` | Séquence 2 : atelier, dalle, bec, filet (simulation et rendu) |
| `build/mojito/` | Séquence 3 : scène du verre, chutes, versement, finition du liquide, animation |
| `build/seq01/`, `build/seq4/`, `build/seq56/` | Séquences 0 – 1, 4, 5 – 6 |
| `build/final/` | Compositeur de la feuille (traits de coupe, annotations, réticule), encodage, contrôles |
| `build/gpu/` | Calibration, étapes de calcul sur la machine louée (`session.sh`), préparation des archives (`kit.py`) |
| `preprod/` | Page du dossier et ses images |
| `outils/suivi-insoumise/` | Module d'interface : bande de suivi au-dessus de la barre de chat |
| `out/`, `cache/` | Sorties et caches volumineux (hors dépôt) |

## Commandes

Python de production : `/opt/og/venv/bin/python` (Blender 5.3 en module, Taichi, OpenCV, fontTools).
Blender officiel (solveur de liquide, OpenVDB) : `BL=/opt/og/blender/blender-5.3.0-linux-x64/blender`.

```bash
python build/timeline/make_partition.py     # régénère et vérifie timeline/partition.json
python build/dossier/make_dossier.py        # régénère preprod/dossier.html et DOSSIER_PREPRODUCTION.md

# Séquence 3 — mojito (tout est local sauf le rendu final)
$BL -b -P build/mojito/chutes.py            # chutes simulées (corps rigides), calées sur les doubles-croches
$BL -b -P build/mojito/plantes.py           # passage libre pour le brin de menthe
$BL -b -P build/mojito/versement.py -- --res 256    # versement simulé (liquide), image par image
$BL -b -P build/mojito/surface.py -- --res 256      # raccord du liquide au verre et à la glace
$BL -b -P build/mojito/anim.py -- --frames 216:359 --res 1008x1512 --spp 256 --device OPTIX --sim 256 --out out/final/seq3

# Séquence 2 — grains
python build/grains/lettres.py                               # contours des lettres monumentales
python build/grains/sim.py dalle --scale 0.008 --threads 3   # échelle d'essai ; finale : --arch cuda --scale 0.12 --leger 1
python build/grains/sim.py filet --scale 0.008
$BL -b -P build/grains/scene.py -- --frames 72:215 --res 1008x1512 --spp 128 --device OPTIX --out out/final/seq2

# Session sur la machine GPU louée : une seule commande lance tout (build/gpu/pilote.sh), le suivi se fait sans commande
python build/gpu/kit.py code                 # archive à déposer : scripts, petites données, adresses de dépôt des résultats
python build/gpu/surveiller.py <créneaux.json> <dossier> <heure de départ>   # lit les journaux déposés par la machine
python build/gpu/recevoir.py <créneaux.json>  # récupère, range et contrôle les images, le filet et les journaux

# Assemblage
python build/final/compose.py               # out/final/master, insoumise_wip.mp4, planche, rapport de contrôles
python build/final/apercu.py                # aperçu complet à partir des rendus basse définition (out/apercu)
```

## Ce qui est simulé, ce qui est posé à la main

| Élément | Méthode |
|---|---|
| Dalle, avalanche, filet, déferlement | grains simulés (points matériels, sable de Drucker-Prager) |
| Citron, feuilles de menthe, paille, glaçons | corps rigides simulés ; premiers chocs calés sur la grille musicale |
| Versement | liquide simulé (FLIP) autour des corps au repos ; surface raccordée au verre après coup. Le mouvement n'est plus tout à fait celui de la simulation : pendant le trop-plein (images 281 à 320) sa surface est tassée verticalement, et tout ce qui sortirait du verre est coupé (images 265 à 321), à la demande du client |
| Points de la séquence 4 | champ de vecteurs sans divergence, attirés vers des formes cibles |
| Film d'encre, raclette | couche mince simulée, raclette comme paroi mobile |
| Caméra, brin de menthe, buée, bulles accrochées, réticule | animés à la main |
| Grains tombés du bord avant de l'atelier (756 sur 893 319) | simulés, mais non rendus une fois sous le sol : tout le sucre visible dans le bar passe par le bec et finit dans le verre (retour du client du 13 novembre) |
| Grains lointains, hors champ ou enfouis (séquence 2) | mêmes positions simulées ; rendus en sphères dont les facettes viennent de la normale, pas d'une géométrie de cristal (niveau de détail de rendu, aucun grain retiré) |

## Mesures du test GPU (13 novembre, L40S louée 7 min 17 s)

| Scène | Machine louée | Notre machine (4 cœurs) |
|---|---|---|
| Verre, glace, liquide, 256 échantillons | 4,8 s par image | environ 11 minutes |
| 3 millions de grains, 128 échantillons | 1,2 s par image | environ 3 minutes |
| Solveur de particules | 8,6 ms par pas pour 4 millions | 129 ms par pas pour 400 000 |

## Session GPU des grains (13 novembre, 10 h 08, L40S louée 11 min 17 s, 13,36 crédits)

| Étape | Durée mesurée |
|---|---|
| Installation : Python, Taichi, OpenCV ; puis Blender pendant la simulation | 6 s, puis 12 s |
| Simulation de la dalle : 893 319 grains, 27 661 pas | 85 s |
| Simulation du filet : 95 images | 35 s |
| Rendu de l'atelier, images 72 à 167, 128 échantillons | 318 s : 1,8 s par image en plan large, 4,5 à 5 s en gros plan (350 000 cristaux) |
| Rendu de la descente et du verre, images 168 à 215 | 139 s, soit 2,9 s par image |
| Envois : six tranches de 24 images (100 à 140 Mo), le filet (221 Mo) | 10 à 20 s chacun |

Trois locations ont été nécessaires ; deux ont échoué (20,46 crédits sans résultat). Ce qu'elles ont appris :

- Chaque commande envoyée à la machine peut attendre une autorisation dans l'application ; pendant ce temps la machine
  tourne. La session part donc d'une seule commande (`pilote.sh`), se suit sans commande (journaux déposés à heures fixes)
  et s'arrête seule : le pilote termine le processus d'accueil de la machine, qui s'éteint dans la minute.
- Une répétition n'est fidèle que dans un environnement créé de zéro par le script d'installation lui-même : la première
  utilisait l'environnement de production, où OpenCV était déjà présent.
- Le test de vitesse d'origine rendait des points, pas des cristaux instanciés : un million d'instances demandent 10 s de
  préparation par image sur un cœur. D'où le niveau de détail automatique (`GrainsMixtes`).

- Les adresses de dépôt des résultats annoncent 24 heures de validité, mais le jeton qu'elles portent expire bien avant :
  des adresses réservées à 8 h 39 et 9 h 35 UTC étaient refusées à 14 h 50 (`ExpiredToken`), alors qu'elles
  fonctionnaient 1 h 40 après leur réservation. Les réserver au plus une heure avant la session.
- Sans le connecteur Higgsfield, on ne peut ni louer ni réserver de dépôts : il n'y a pas de voie de secours. Les
  connecteurs ne sont lus qu'au démarrage d'une session ; si le processus de la conversation redémarre pendant une panne
  du connecteur, les appels passent par une session auxiliaire créée ensuite.

La machine louée demande deux corrections à l'installation, reprises dans `build/gpu/session.sh` :
`chmod 1777 /tmp` et l'option `-o APT::Sandbox::User=root` pour installer les bibliothèques système de Blender.
Le débruiteur OptiX n'y démarre pas ; utiliser OptiX pour le rendu et OpenImageDenoise pour le débruitage.

## Session A du palier 4 (13 novembre, 15 h 28, L40S louée 31 min 08 s, 36,84 crédits)

Conduite par `build/gpu/pilote_film.py` et son plan (`build/gpu/plan.py a`) : une commande, aucun échec d'étape.

| Étape | Durée mesurée |
|---|---|
| Installation : Python, Taichi, OpenCV ; Blender ; téléchargement du liquide (236 Mo) | 9 s ; 11 s ; 10 s |
| Simulation de la dalle (893 319 grains), puis du filet | 88 s ; 36 s |
| Rendu des images 169 à 215 (sucre rectifié), 128 échantillons | 134 s, soit 2,9 s par image |
| Mojito sans liquide (images 216 à 263 environ), 256 échantillons | 4,2 à 4,9 s par image |
| Mojito avec liquide trouble (images suivantes) | 13,6 à 17 s par image |
| Envois : huit tranches d'images (63 à 132 Mo), le filet (232 Mo) | 10 à 20 s chacun |

Le rendu s'est arrêté à l'échéance fixée (30 minutes) : 132 images du mojito sur 144, les images 348 à 359 restent à
rendre. L'estimation (8 à 10 s par image avec liquide) venait d'une mesure faite avec un liquide limpide (4,8 s) ; le
liquide trouble retenu ensuite diffuse la lumière dans son volume et coûte trois fois plus. À retenir : mesurer le
temps par image sur l'aspect définitif avant de chiffrer une session.


## Corrections du 13 novembre (retours du client) et sessions B et B2

- **Débordement du mojito.** À 510 ml/s (28 cl versés en 0,56 s de temps réel, montrés au ralenti), le liquide simulé
  s'accumule au-dessus de la glace plus vite qu'il ne s'infiltre : entre les images 284 et 314 son niveau moyen passe
  jusqu'à 14 mm au-dessus du bord et il sort du verre. `build/mojito/surface.py --confiner 1` tasse verticalement la
  surface simulée pendant ce trop-plein (niveau affiché plafonné 5 mm sous le bord) et coupe ce qui dépasse du diamètre
  intérieur au-dessus du bord. Le mouvement reste celui de la simulation, son amplitude verticale est réduite : ce
  n'est pas une nouvelle simulation. Images refaites : 281 à 320 (`cache/mojito/liquide_r256c`, lues avec
  `anim.py --variante c`).
- **Brin de menthe** (« trop plastique, trop présent ») : les quatre feuilles du bas sont retirées, le bouquet descend
  de 30 mm le long de sa tige et tourne de 180° (contrôle : aucune feuille ne traverse la glace), les feuilles sont
  plus mates. À l'origine, une des feuilles du bas traversait un glaçon. Images refaites : 309 à 359.
- **Session B** (17 h 29, 10 min 49 s, 12,80 crédits) : papier à 1,6 s par image (72 images en 131 s), mojito confiné
  à 14,8 s par image. L'étape de l'encre a échoué en 3 s : sa scène demandait le débruiteur OptiX, qui ne démarre pas
  sur la machine louée. La répétition locale ne pouvait pas le voir (elle tourne sur processeur, où ce réglage n'est pas
  pris). À retenir : relire dans chaque scène les branches réservées au GPU, que la répétition n'exécute pas.
- **Session B2** (17 h 50) : encre avec OpenImageDenoise, 5 s par image avec les grains ; puis mojito 309 à 359.


## Contrôle qualité (13 novembre) : deux relectures indépendantes, et ce qu'elles ont changé

Rapports complets : `out/qc/relecture_image.md` et `out/qc/relecture_son_technique.md` ; mesures : `build/final/qc.py`.

- **Son et conformité : livrable.** 282 événements sonores mesurés, tous à moins d'une image ; -14,0 LUFS. Corrections
  faites : crête après encodage AAC ramenée de +0,1 à -1,5 dBTP (`build/audio/diffusion.py`) ; déchirement de papier
  sur la traversée de la feuille (image 56, jusque-là muette) ; plateau de -4 dB au-dessus de 6 kHz sur les grains.
- **Image.** Corrigé : liquide hors du verre (ci-dessous) ; éclats anguleux de la plongée dans le O (fibres masquées
  après la traversée, images 57 et 58). Laissé tel quel par décision du client : la séquence des points, où le
  relecteur voit trois effets d'explosion. Non modifié car validé par le client : allure du filet de sucre, front des
  grains, coupe sur le quartier de citron, teinte du mojito, filet de versement.
- **Liquide hors du verre.** Après la première correction, il restait une collerette de liquide sur la face extérieure
  du verre (images 281 à 321) et la première gerbe en projetait dehors (265 à 280) : 56 images sur 98.
  `surface.py --confiner 1` ne laisse plus rien hors de la cavité ; `build/mojito/controle_liquide.py` le vérifie.
- **Session C (19 h 01, 16,98 crédits) : 55 images à refaire, par notre faute.** La coupe était un seuil net posé à une
  demi-maille de la paroi ; il déplaçait la surface du liquide par marches et, vu à travers le verre, tout ondulait.
  Les essais en petite définition ne le montraient pas. La coupe se fait désormais par intersection de champs de
  distance (surface lisse, identique à l'origine contre la paroi), le contrôle mesure aussi cette régularité, et une
  image a été rendue en pleine définition avant de relouer. À retenir : vérifier en pleine définition, et dans le
  verre autant qu'au bord, avant tout rendu payant.
- **Session D (20 h 09, 17,26 crédits)** : les 55 images refaites avec la finition corrigée ; contrôlées en pleine
  définition dès la première tranche (intérieur du verre identique à l'origine, rien hors du verre). L'image 321 a
  été rendue sur notre machine.

## Livraison (13 novembre)

`out/livraison/` (hors dépôt, trop lourd) ; fiche : `livraison/LISEZ-MOI.md` ; où retrouver les images finales :
`livraison/sources_rendus.json`.

| Fichier | Contenu |
|---|---|
| `OFFGRIDZ_INSOUMISE_1080x1920.mp4` | diffusion : H.264 High, 600 images, 20,000 s ; AAC 320 kb/s, -14,0 LUFS, -1,5 dBTP |
| `OFFGRIDZ_INSOUMISE_720x1280_leger.mp4` | version légère ; AAC 192 kb/s, -1,6 dBTP |
| `OFFGRIDZ_INSOUMISE_master_prores422hq.mov` | maître ProRes 422 HQ 10 bits, son PCM 24 bits (-1,2 dBTP) |
| `OFFGRIDZ_INSOUMISE_son_master.wav`, `_musique.wav`, `_bruitages.wav` | bande son et pistes séparées, 24 bits 48 kHz |
| `OFFGRIDZ_INSOUMISE_affiche.png` | image 0 : le logo (identique à l'image 599) |
