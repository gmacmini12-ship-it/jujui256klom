# OFFGRIDZ — « INSOUMISE »

Showreel de 20 secondes (1080 × 1920, 30 images/s, 150 BPM) pour le studio créatif OFFGRIDZ.
Le film est calculé, pas généré : simulations et rendus sont reproductibles depuis ce dossier.

- `BIBLE.md` : les décisions validées (concept, feuille, palette, grille, textes, règles de travail).
- `DOSSIER_PREPRODUCTION.md` : storyboard chronométré, architecture, partition, références, plan, stratégie Katana.
  Version illustrée : `preprod/dossier.html`.
- `suivi.json` : état d'avancement affiché par la bande de suivi (`outils/suivi-insoumise`).

## État

Phase 3 (préproduction) livrée, en attente de validation. Crédits Higgsfield : 8,63 dépensés (test GPU),
185 prévus au total, cible 200, plafond 345.

## Arborescence

| Dossier | Contenu |
|---|---|
| `timeline/partition.json` | La source unique des temps du film (88 événements sur la grille musicale) |
| `assets/logo/` | Logo source, calques séparés, vecteurs, mesures et rapport de fidélité |
| `assets/fonts/` | 38 caractères sous licence libre, contours du mot OFFGRIDZ, planches de spécimens |
| `build/timeline/` | Génération et vérification de la partition |
| `build/dossier/` | Contenu et fabrication du dossier de préproduction |
| `build/logo/` | Décomposition et vectorisation du logo |
| `build/type/` | Texte vers contours (polices statiques et variables) |
| `build/gpu/` | Scènes de calibration, banc du solveur de particules, script d'installation de la machine louée |
| `preprod/` | Page du dossier et ses images |
| `outils/suivi-insoumise/` | Module d'interface : bande de suivi au-dessus de la barre de chat |

## Commandes

Python de production : `/opt/og/venv/bin/python` (Blender 5.3 en module, Taichi, OpenCV, fontTools).

```bash
python build/timeline/make_partition.py     # régénère et vérifie timeline/partition.json
python build/dossier/make_dossier.py        # régénère preprod/dossier.html et DOSSIER_PREPRODUCTION.md
python build/logo/dissect.py                # calques, vecteurs et rapport du logo (environ 2 minutes)
python build/type/typekit.py --selftest     # contrôle de la conversion texte vers contours
python build/gpu/bench_scene.py --scene glass --device CPU --spp 16   # scène de calibration
```

## Mesures du test GPU (13 novembre, L40S louée 7 min 17 s)

| Scène | Machine louée | Notre machine (4 cœurs) |
|---|---|---|
| Verre, glace, liquide, 256 échantillons | 4,8 s par image | environ 11 minutes |
| 3 millions de grains, 128 échantillons | 1,2 s par image | environ 3 minutes |
| Solveur de particules | 8,6 ms par pas pour 4 millions | 129 ms par pas pour 400 000 |

La machine louée demande deux corrections à l'installation, déjà notées dans `build/gpu/box_bootstrap.sh` à reprendre :
`chmod 1777 /tmp` et l'option `-o APT::Sandbox::User=root` pour installer les bibliothèques système de Blender.
Le débruiteur OptiX n'y démarre pas ; utiliser OptiX pour le rendu et OpenImageDenoise pour le débruitage.
