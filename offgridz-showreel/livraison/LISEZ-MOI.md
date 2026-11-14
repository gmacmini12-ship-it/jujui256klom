# OFFGRIDZ — « INSOUMISE »

Showreel de 20 secondes, vertical. Livraison du 13 novembre 2026 ; fichier de diffusion réexporté le 14 novembre.

## Fichiers

| Fichier | Usage | Caractéristiques |
|---|---|---|
| `OFFGRIDZ_INSOUMISE_FINAL_1080x1920.mp4` | **diffusion : le fichier à utiliser** (67,7 Mo) | H.264 High niveau 4.1, 1080 × 1920, 30 images/s, 600 images, 20,000 s, 26,7 Mb/s ; son AAC 320 kb/s, -14,0 LUFS, crête -1,5 dBTP |
| `OFFGRIDZ_INSOUMISE_1080x1920.mp4` | diffusion, export du 13 novembre (58,4 Mo) | le même film, même taille d'image, 23,0 Mb/s ; même bande son |
| `OFFGRIDZ_INSOUMISE_720x1280_leger.mp4` | messagerie, téléphone | même film en 720 × 1280 ; son AAC 192 kb/s, crête -1,6 dBTP |
| `OFFGRIDZ_INSOUMISE_master_prores422hq.mov` | maître, montage, réencodages | ProRes 422 HQ 10 bits ; son PCM 24 bits 48 kHz, -14,0 LUFS, crête -1,2 dBTP |
| `OFFGRIDZ_INSOUMISE_son_master.wav` | bande son seule | 24 bits, 48 kHz, stéréo |
| `OFFGRIDZ_INSOUMISE_musique.wav`, `OFFGRIDZ_INSOUMISE_bruitages.wav` | pistes séparées | leur somme redonne la bande son |
| `OFFGRIDZ_INSOUMISE_affiche.png` | vignette | image 0 du film : le logo, identique à l'image 599 |

Le film boucle : la dernière image est identique à la première, et le son se raccorde.

## Réexport du 14 novembre (correction technique)

Une copie du film mesurait 512 × 910. Le fichier livré le 13 novembre mesure bien 1080 × 1920 et aucun fichier du
projet n'a cette taille : elle vient d'une copie recompressée en route (lecteur intégré d'une application,
messagerie), ce que nous ne pouvons pas vérifier d'ici. **Repère simple : le bon fichier pèse 67,7 Mo.** Une copie de
quelques mégaoctets est une version réduite ; prendre alors l'archive `.zip`, qui ne peut pas être recompressée.

- Fait : nouvel encodage depuis les 600 images maîtresses (1080 × 1920, 16 bits) et la bande son validée. Aucune
  image n'est redimensionnée ni recalculée ; même conversion de couleur ; la bande son est identique, au bit près, à
  celle du 13 novembre. Qualité d'encodage un cran au-dessus (26,7 Mb/s au lieu de 23,0).
- Vérifié sur le fichier (FFprobe et décodage complet) : 1080 × 1920, 600 images, 20,000 s, 30 images/s constantes,
  son présent, aucune erreur ni avertissement. Rapport : `controle_qualite/export_final_1080x1920.json`.
- Ce n'est pas un agrandissement. Mesure : réduit à 512 × 910 puis ragrandi, le film perd nettement (34,8 dB), alors
  qu'un fichier fabriqué par agrandissement en sort presque intact (47 dB).
- Rien n'a été agrandi pour cet export, et toutes les images du film sont calculées à leur taille d'affichage. Deux
  éléments sont, depuis l'origine, moins définis que l'image ; ils n'ont pas été touchés, car les refaire changerait
  des images validées :
  - ouverture, images 24 à 62 : la caméra s'approche de la feuille puis plonge dans le O. Les textures de la
    feuille, dont le logo (source de 1254 px, posé à 1008 px), sont alors vues de plus près que leur définition :
    6 % au plus jusqu'à l'image 47, bien davantage pendant la plongée, dans le flou de mouvement ;
  - film d'encre, 15,2 à 17,6 s : l'épaisseur de l'encre est simulée sur une grille de 4 à 6 pixels par maille ;
    l'image, elle, est calculée en 1080 × 1920 à partir de ce champ.

## Contenu

| Séquence | Images | Temps |
|---|---|---|
| 0 Épreuve | 0 – 23 | 0,0 – 0,8 s |
| 1 Déchirure | 24 – 71 | 0,8 – 2,4 s |
| 2 Grains | 72 – 215 | 2,4 – 7,2 s |
| 3 Mojito | 216 – 359 | 7,2 – 12,0 s |
| 4 Données | 360 – 455 | 12,0 – 15,2 s |
| 5 Fond perdu | 456 – 527 | 15,2 – 17,6 s |
| 6 Signature | 528 – 599 | 17,6 – 20,0 s |

Musique originale à 150 BPM, sans voix. Textes à l'écran en français. Le logo de fin est le logo source, non modifié.

## Ce qui est calculé, ce qui ne l'est pas

Le film est calculé : simulations physiques et rendu d'images, reproductibles depuis le dépôt. Aucune image, aucune
vidéo et aucun son n'ont été produits par un générateur. Les crédits Higgsfield (147,68) ont servi uniquement à louer
une machine de calcul.

- Simulés : les grains de sucre (893 319 grains), les chutes du citron, des feuilles, de la paille et des glaçons, le
  versement du liquide, les points de la séquence 4, le film d'encre et la raclette.
- Animés à la main : la caméra, le brin de menthe, la buée, les bulles accrochées, le réticule.
- Retouché après simulation, à votre demande : pendant le versement, la surface du liquide est tassée verticalement
  (images 281 à 320) et tout ce qui sortirait du verre est coupé (images 265 à 321). Ce n'est donc pas le mouvement
  brut de la simulation, qui débordait. Les grains tombés hors de l'atelier (756 sur 893 319) ne sont pas montrés.

## Validations du client (13 novembre)

- Grains (images 72 à 168), puis leur rectification (169 à 215) : validés.
- Mojito : correction du liquide et du brin de menthe demandées et validées sur aperçus ; rendu final livré.
- Papier (ouverture) et encre (fin) : validés sur aperçus. Depuis, seules les images 57 et 58 du papier ont été nettoyées (éclats de fibres).
- Séquence des points : gardée telle quelle.
- **Film complet : validé le 13 novembre.**

## Contrôle qualité

Deux relectures indépendantes (image ; son et conformité) et des mesures sur les fichiers livrés.

- Conformité : durée, format, cadence et nombre d'images exacts ; 282 événements sonores vérifiés, tous à moins
  d'une image de leur position ; aucun écrêtage.
- Corrigé après relecture : liquide hors du verre, éclats de la plongée dans le O (images 57 et 58), crête du son
  après encodage, aigu de l'avalanche de grains, son de la traversée du papier (image 56).
- Laissé tel quel par votre décision : la séquence des points (12 à 15 s), où le relecteur voit trois effets
  d'explosion.
- Signalé par le relecteur et non modifié, ces éléments étant validés : l'allure du filet de sucre, le front des
  grains, la coupe sur le quartier de citron (image 216), la teinte du mojito, le filet de versement très lisse, la
  fin du plan du mojito sur un flou (images 357 à 359) suivie d'une image noire (360).

Rapports complets dans le dépôt de travail : `out/qc/relecture_image.md`, `out/qc/relecture_son_technique.md`.
