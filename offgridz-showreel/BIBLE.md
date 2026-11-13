# OFFGRIDZ — « INSOUMISE » — Bible de production (v1)

Document de référence pour toute personne ou tout agent qui travaille sur le film.
Ce qui est écrit ici est décidé et validé par le client ; ne pas le réinterpréter.

## 1. Objet

Showreel de 20 secondes pour le studio créatif OFFGRIDZ (branding, motion design, 3D, publicité).
Deux réactions visées : « comment ont-ils fait ? » puis « je veux ce niveau pour ma marque ».

| Paramètre | Valeur |
|---|---|
| Durée | 20,000 s exactement, bouclable (dernière image = première image) |
| Image | 1080 × 1920 (9:16), 30 images/s, 600 images (0 à 599) |
| Son | 48 kHz stéréo, 960 000 échantillons, aucune voix |
| Langue des textes à l'image | français |
| Cibles | TikTok, Instagram Reels, YouTube Shorts |

## 2. Concept validé : INSOUMISE

Une matière orange que la grille n'arrive pas à contenir.
La bande orange du logo est une réserve de matière. Le réticule (cercle + repères) tente de la cadrer ;
elle lui échappe en changeant d'état : solide, grains, liquide, points. Elle accepte une seule forme,
le temps d'un produit (un mojito), puis déborde du cadre (« fond perdu ») et choisit sa place dans le logo.

Règles du film :

1. **Feuille d'épreuve.** L'écran 9:16 est une feuille d'imprimeur noire. L'image vit dans une fenêtre
   intérieure avec traits de coupe ; les marges portent des micro-annotations. La règle n'est brisée
   qu'une fois, au climax.
2. **Une seule matière orange**, jamais coupée : bande → grains → sucre → points → déferlement → encre → bande.
3. **Le réticule tente de verrouiller** trois fois (échecs ou prise provisoire) et réussit à la quatrième.
4. **Trois rendus, un par univers** : mat (papier, grains), brillant (mojito), données (points). Caméra macro partout,
   une seule descente continue.
5. **Roulement typographique** : à chaque entrée d'univers, le mot OFFGRIDZ change de caractère sur les
   doubles-croches puis se fixe. Le lettrage d'origine ne revient qu'à la signature.
6. **Le vert n'apparaît qu'une fois** : la menthe.
7. **Démontage réversible** : les cinq signes du logo (cercle, repères, bande, déchirure, lettres) se séparent,
   jouent chacun un rôle et se réassemblent. La signature finale est le logo d'origine, au pixel près.

## 3. Géométrie de la feuille (pixels, origine en haut à gauche)

| Élément | x0 | y0 | x1 | y1 | Taille |
|---|---|---|---|---|---|
| Feuille | 0 | 0 | 1080 | 1920 | 1080 × 1920 |
| Fenêtre image (2:3) | 36 | 204 | 1044 | 1716 | 1008 × 1512 |
| Zone d'action sûre | 96 | 330 | 984 | 1500 | 888 × 1170 |
| Logo en signature | 36 | 456 | 1044 | 1464 | 1008 × 1008 |

Marges : 36 px à gauche et à droite, 204 px en haut et en bas.

## 4. Palette (mesurée sur le logo fourni)

| Nom | Hex | Usage |
|---|---|---|
| Noir | `#0A0A09` | feuille, fonds |
| Crème | `#EEDFD2` | lettres, papier, annotations |
| Orange | `#EA470F` | la matière |
| Orange clair | `#F65726` | hautes lumières de la matière |
| Gris chaud foncé | `#4C352D` | ombres de la photo |
| Gris chaud moyen | `#8A7E74` | demi-tons de la photo |
| Gris chaud clair | `#B4A79C` | lumières de la photo |

Aucune autre teinte, sauf le vert de la menthe (séquence mojito uniquement).

## 5. Grille temporelle

150 BPM, mesure à 4 temps. À 30 images/s : 1 temps = 0,4 s = 12 images ; 1 double-croche = 0,1 s = 3 images ;
1 mesure = 1,6 s = 48 images. Structure : une levée de 2 temps, puis 12 mesures.
La mesure n (1 à 12) commence à t = 0,8 + 1,6 × (n − 1) s, soit l'image 24 + 48 × (n − 1).

| Séquence | Mesures | Temps (s) | Images | Univers et rendu |
|---|---|---|---|---|
| 0 Épreuve | levée | 0,0 – 0,8 | 0 – 23 | logo, première fissure |
| 1 Déchirure | 1 | 0,8 – 2,4 | 24 – 71 | papier, mat |
| 2 Grains | 2 – 4 | 2,4 – 7,2 | 72 – 215 | atelier, mat, macro |
| 3 Mojito | 5 – 7 | 7,2 – 12,0 | 216 – 359 | bar, brillant |
| 4 Données | 8 – 9 | 12,0 – 15,2 | 360 – 455 | points, abstrait |
| 5 Fond perdu | 10 – 11 (2 temps) | 15,2 – 17,6 | 456 – 527 | déferlement, encre, raclette |
| 6 Signature | 11 (temps 3) – 12 | 17,6 – 20,0 | 528 – 599 | logo d'origine |

## 6. Textes à l'image (français)

- Seul mot avant la signature : OFFGRIDZ.
- Signature : le logo seul, sans phrase. (La ligne « Hors-grille. Sous contrôle. » a été retirée par le client le 13 novembre.)
- Marges : micro-annotations d'atelier d'imprimerie (ÉPREUVE N° 01, REPÉRAGE, ÉTAT, compteur de particules,
  FOND PERDU, BON À TIRER). Elles réagissent à l'image.
- Aucune voix. Aucun identifiant de compte dans l'image.

## 7. Honnêteté de fabrication

- Simulations (grains, liquide, corps rigides) et rendus : réellement calculés, reproductibles depuis les sources.
- Aucune vidéo générée par IA dans le film. L'IA est limitée à des textures organiques et à quelques bruitages,
  et c'est signalé.
- On ne recrée jamais ce que le logo cache : la zone des yeux sous la bande déchirée n'est jamais inventée.
- Le logo maître n'est jamais modifié. La signature utilise le fichier source.

## 8. Environnement technique

- Python de production : `/opt/og/venv/bin/python` (Python 3.13) avec `bpy` 5.3 (Blender : Cycles, Bullet),
  `taichi` 1.7.4, `numpy`, `scipy`, `cv2`, `fontTools`, `brotli`, `soundfile`, `PIL`.
- Ajouter un paquet : `uv pip install --python /opt/og/venv/bin/python <paquet>`.
- Machine : 4 cœurs, 15 Go de RAM, pas de GPU. `ffmpeg` 6.1, Node 22, Chromium/Playwright disponibles.
- Blender officiel 5.3 (solveur de liquide compris) : `/opt/og/blender/blender-5.3.0-linux-x64/blender -b -P script.py -- arguments`.
  Le module `bpy` du venv n'a pas de solveur de liquide ; pour le reste les deux se valent. Toujours importer `bpy` avant `bmesh`.
- Le rendu final des scènes 3D se fera sur un GPU loué, avec le même script et `--device OPTIX` : chaque script de scène accepte
  `--frames a:b --res LxH --spp N --device CPU|OPTIX --out dossier` et donne le même résultat d'une machine à l'autre.
- Taichi doit être lancé depuis un fichier `.py` (pas depuis l'entrée standard).

## 9. Règles de travail

- Tout le code vit dans `offgridz-showreel/build/`, relançable par une commande.
- Sorties volumineuses dans `offgridz-showreel/out/` ou `cache/` (ignorés par git).
- Aucune dépense : aucun appel à un service payant (Higgsfield ou autre) sans l'accord explicite du client,
  donné palier par palier. Les agents n'appellent jamais d'outil Higgsfield.
- Ne pas faire de commit ni de push : l'intégration est centralisée.
- Machine partagée : les 4 cœurs servent à tout le monde en même temps. Un seul calcul lourd à la fois par agent, limité à 2 fils
  (`OMP_NUM_THREADS=2`, Blender `-t 2`, `--threads 2`). Tester d'abord en petit ; pas de boucle d'attente active.

## 10. Interfaces de fabrication du film final

Toutes les images finales vont dans `out/final/`, nommées `f%04d.png` où le numéro est l'image du film (0 à 599).

| Dossier | Contenu | Format |
|---|---|---|
| `out/final/seq01/` | fenêtre, images 0 à 71 | 1008 × 1512, PNG 16 bits sRGB, opaque |
| `out/final/seq2/` | fenêtre, images 72 à 215 | idem |
| `out/final/seq3/` | fenêtre, images 216 à 359 | idem |
| `out/final/seq4/` | fenêtre, images 360 à 455 | idem |
| `out/final/seq56/fenetre/` | fenêtre, images 456 à 599 | idem |
| `out/final/seq56/matiere/` | matière orange posée sur la feuille entière, images 456 à 527 | 1080 × 1920, PNG 16 bits RGBA, alpha droit (non prémultiplié) |
| `out/final/<séquence>/meta.json` | données par image pour le compositeur | voir ci-dessous |
| `out/final/master/` | feuille entière assemblée, images 0 à 599 | 1080 × 1920, PNG 16 bits sRGB |

Empilement du compositeur, du fond vers le dessus : feuille noire → fenêtre de la séquence → traits de coupe et annotations
de marge → matière (`seq56/matiere`) → réticule. Images 0 à 5 et 594 à 599 : le compositeur pose le logo source à plat,
quoi que contienne la séquence.

`meta.json` : `{"images": {"72": {"cible": {"x": 504.0, "y": 700.0, "r": 310.0}, "n": 58450}, ...}}`

- `cible` : cercle que le réticule épouse quand il tente un verrouillage ou qu'il le tient, en pixels de la fenêtre
  (origine en haut à gauche de la fenêtre). Absent : le réticule est libre.
- `n` : nombre de particules libres à afficher au compteur de marge. Absent : pas de compteur.

