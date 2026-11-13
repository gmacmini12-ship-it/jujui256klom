# OFFGRIDZ — « INSOUMISE »

Showreel de 20 secondes (1080 × 1920, 30 images/s, 150 BPM) pour le studio créatif OFFGRIDZ.
Le film est calculé, pas généré : simulations et rendus sont reproductibles depuis ce dossier.

- `BIBLE.md` : les décisions validées (concept, feuille, palette, grille, textes, règles de travail, interfaces de fabrication).
- `DOSSIER_PREPRODUCTION.md` : storyboard chronométré, architecture, partition, références, plan, stratégie Katana.
  Version illustrée : `preprod/dossier.html`.
- `suivi.json` : état d'avancement affiché par la bande de suivi (`outils/suivi-insoumise`).

## État

Phase 4 (production) en cours. Crédits Higgsfield : 8,63 dépensés (test GPU) ; aucun autre engagé.
Cible 200, plafond 345 ; chaque palier payant est soumis au client avant d'être engagé.

| Séquence | Images | État |
|---|---|---|
| 0 – 1 Épreuve, déchirure | 0 – 71 | scène en fabrication (`build/seq01`) |
| 2 Grains | 72 – 215 | simulation et scène prêtes à l'échelle d'essai (`build/grains`) ; finale sur GPU |
| 3 Mojito | 216 – 359 | chutes et versement simulés, scène animée (`build/mojito`) ; rendu final sur GPU |
| 4 Données | 360 – 455 | rendue (`build/seq4`, 6 millions de points) |
| 5 – 6 Fond perdu, signature | 456 – 599 | simulations prêtes à l'échelle d'essai, rendu en reprise (`build/seq56`) |
| Assemblage | 0 – 599 | compositeur opérationnel (`build/final`), repli sur l'animatique pour ce qui n'est pas rendu |

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
| Versement | liquide simulé (FLIP) autour des corps au repos ; surface raccordée au verre après coup, sans toucher au mouvement |
| Points de la séquence 4 | champ de vecteurs sans divergence, attirés vers des formes cibles |
| Film d'encre, raclette | couche mince simulée, raclette comme paroi mobile |
| Caméra, brin de menthe, buée, bulles accrochées, réticule | animés à la main |
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

La machine louée demande deux corrections à l'installation, reprises dans `build/gpu/session.sh` :
`chmod 1777 /tmp` et l'option `-o APT::Sandbox::User=root` pour installer les bibliothèques système de Blender.
Le débruiteur OptiX n'y démarre pas ; utiliser OptiX pour le rendu et OpenImageDenoise pour le débruitage.
