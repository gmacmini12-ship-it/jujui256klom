# INSOUMISE — Relecture critique de l'image (œil DA)

Périmètre : les 10 planches, les 7 raccords, une cinquantaine d'images agrandies (extraits 8 bits des maîtres 16 bits), réparties sur les 7 séquences. Rien n'a été modifié dans le projet.
Convention : **[constaté]** = vu à l'écran ou mesuré ; **[supposé]** = hypothèse sur la cause ou sur la réception.

## Verdict

**Pas livrable en l'état.** La séquence Signature, le logo et la boucle sont excellents ; la séquence 3 est belle mais s'écarte du cahier des charges sur trois points (liquide qui dépasse du verre, boisson peu reconnaissable, fin de plan non terminée) ; la séquence 4 enchaîne trois « explosions » alors que le client les proscrit ; la jonction 55–58 contient une image blanche et des éclats de polygones à l'allure de travail en cours.

Trois corrections prioritaires :
1. **Séquence 4 (360–455) : supprimer la répétition d'explosions** (voir B1). Reprise à l'assemblage 2D en priorité ; re-rendu léger des points si insuffisant.
2. **Séquence 3 : le liquide ne doit pas déborder du verre (297–312) et la boisson doit se lire « mojito »** (I1, I2). Demande un re-rendu 3D du liquide (et un recalcul de simulation pour le débordement).
3. **Jonction 55–58 et fin de séquence 3 (357–360)** : retirer l'image blanche, les éclats de polygones et les images mortes (I3, I4). Assemblage 2D seulement.

## Ce qui est bon (une ligne chacun)
- **Logo 0 et 599 [constaté]** : `f0599.png` est strictement identique à `f0000.png` (écart maximal 0) ; comparé au logo source 1254 px réduit à 1008 px, écart moyen 1,3 niveau sur 255, uniquement sur les contours (rééchantillonnage), aucune déformation. Orthographe « OFFGRIDZ » exacte partout où je l'ai lu (le roulement typographique ne produit aucune faute, voir M3 pour une réserve de lisibilité).
- **Boucle 599 → 0 [constaté]** : images 594–599 = image 0 au bit près ; le fondu des mentions de marge 588–593 est propre.
- **Séquence 0 (0–23)** et début de la déchirure (24–45) : très réussis, aucun défaut.
- **Sucre de canne (186–216) [constaté]** : grains fins, dorés, tassés au fond du verre, aucun grain hors verre ; c'est le moment le plus réaliste du film.
- **Citron vert (213–243)** : crédible, bien éclairé.
- **Verre (240–350)** : parois, buée et gouttelettes, paille métal : convaincants.
- **Séquence 6 (528–593)** : signature nette, séchage de l'encre sans scintillement, mentions de marge lisibles à pleine définition.
- **Aucun texte en anglais, aucun identifiant de compte** relevé dans les images vues.

## Défauts

### BLOQUANT

**B1 — Trois « explosions » en trois secondes dans la séquence 4 (360–447) — contrainte client n° 3** [constaté]
- 360–378 : un point central éclate en gerbe radiale (noir complet à 360, puis feu d'artifice blanc et rouge) ; c'est l'archétype de l'« impact générique ».
- 408–417 : le mot en points se déforme en traînées obliques (411 : barres inclinées, aspect glitch), puis un second éclatement radial gris et rouge, flou et bruité, remplit l'écran (414–417 : bouillie grise, aucune forme lisible).
- 441–453 : troisième expansion, des taches orange floues grossissent jusqu'au plein écran (aspect éclaboussure générique), puis 456–477 le déferlement de grains (celui-là est prévu au concept).
- Ce que voit le spectateur : trois gerbes consécutives avant même le climax. Le relief de portrait en points (420–438) est beau, mais il est coincé entre deux explosions.
- Correction : garder le mot en matrice de points (387–408) et le relief (420–438) ; remplacer 360–378 par une apparition des points par densité croissante sans centre éclatant (ou raccourcir à 6–8 images), supprimer le flou radial 411–417 (coupe sèche ou simple recul), faire monter l'orange par balayage plutôt que par taches (441–453). **Assemblage 2D possible pour couper, retimer, et fondre ; si on veut un vrai nouveau mouvement de points, un re-rendu 3D léger (moteur de points, 2 s par image selon le dossier) est suffisant, pas le mojito.**

### IMPORTANT

**I1 — Le liquide dépasse la paroi du verre (297–312) — contrainte client n° 4** [constaté]
- À l'agrandissement (297, 303, 306, 309), une collerette de liquide dentelée fait saillie de 8 à 12 px à gauche et à droite au niveau du bord supérieur, hors de la paroi. Elle est visible comme un « ruban » collé au verre dès les planches (300, 303, 306, 309).
- Dans la même zone (297–309), le filet de versement est un cylindre transparent rigide plutôt qu'un jet d'eau ; à 306–309 il laisse une colonne fantôme et un bloc rectangulaire clair derrière le glaçon, puis disparaît en deux images.
- Correction : **re-rendu 3D** (resserrer le maillage de liquide dans la paroi intérieure, abaisser le niveau d'une marge, ou relancer la simulation avec un collider de verre plus épais ; changer le matériau du jet). Pas de remède 2D propre.

**I2 — La boisson ne se lit pas comme un mojito (264–350) — contrainte n° 4** [constaté, jugement subjectif]
- Le liquide est gris-vert neutre, sans l'ambre attendu du sucre de canne ; la menthe n'est visible que comme une masse verte trouble au fond, le sucre comme un dépôt brun sombre. À 300–350 on lit « eau gazeuse avec glaçons ».
- À 264–282, la phase de versement est un amas turbulent de bulles et de projections quasi illisible (267, 270) : aspect brouillon plutôt que liquide.
- Correction : teinter légèrement le liquide (ambre/jaune pâle), éclaircir le fond pour que menthe et citron se voient en couches ; **re-rendu 3D (matériau et éclairage) ; la simulation peut être conservée.** Pas de gain sérieux en 2D.

**I3 — Image blanche et éclats « inachevés » à la jonction 55–58** [constaté]
- 56 : image presque entièrement crème (mur intérieur du O en gros plan) ; la mesure l'a vue : +0,29 de luminance 55→56, −0,44 56→57. Visuellement un flash d'une image suivi d'un changement de décor.
- 57 : paille ou herbe en bâtonnets clairs sur le contour gauche de la scène + dalle rouge sombre (éclairage plus bas que 58–59). 58 : en haut, une couronne d'éclats de polygones translucides à arêtes vives (aspect lowpoly), non fondus.
- Correction : **2D**. Supprimer ou raccourcir 56 (fondu de luminance sur 54–58 ou coupe franche 55→58), recadrer/masquer le haut de 58 et les bords de 57, ou décaler le début de la scène papier de 2 images. **Si on veut garder le plan, un re-rendu 3D de 57–58 serait nécessaire (fibres de papier trop dures).**

**I4 — Fin de séquence 3 sans résolution : 354–360** [constaté]
- La caméra devait « entrer dans la paille noire ». À l'écran : 354 gros plan sur le bord du verre, 357–359 grosse tache grise floue (un glaçon hors-champ) bordée à droite d'une bande de fenêtre noire (le rendu ne remplit pas la fenêtre), puis 360 : **image complètement noire avec seul le réticule** (aucune particule, compteur N = 0). Mesure : −0,111 de luminance 359→360.
- Spectateur : trois images de bouillie grise, puis une image vide : on lit un défaut de raccord.
- Correction : **2D** : couper 357–359 et enchaîner directement sur la première image de points, ou remplacer par un fondu court vers le noir calé sur le tic de la bande-son ; faire apparaître les premiers points dès 360.

**I5 — Débit de sucre devenu une traînée orange lisse et floue (186–213)** [constaté]
- La colonne de grains, nette et granuleuse en 171–183, devient un pinceau orange pêche sans texture (186–204 : flou de profondeur de champ), puis une goutte orange fantôme à 201–213 qui reste en l'air alors que le verre est déjà plein. Le spectateur perçoit un lavis, pas du sucre.
- Dans la même zone, des « poils » orange radiaux courent sur la paroi du verre vu du dessus (192–219) et sur la paroi en 225–260 : traînées fines orange/brunes scintillantes collées à la paroi. [supposé : grains hors profondeur de champ ou échantillons de reflet sous-échantillonnés (« lucioles »).]
- Correction : **re-rendu 3D** du débit (profondeur de champ moindre, plus d'échantillons, débruitage) ; à défaut, atténuer par 2D (flou plus léger, retouche de gain sur les traînées de paroi) ; les poils ne se corrigent pas proprement en 2D.

**I6 — Raccord 215 → 216 : saut de position du citron et de cadrage** [constaté]
- À 215, un quartier est en l'air au-dessus du sucre ; à 216 un quartier repose déjà sur le sucre, orientation différente, et un autre tombe en 217. Le verre est plus grand et le fond plus noir (changement de scène non dissimulé : planche raccord_215_216).
- Correction : **2D** : décaler la coupe d'une ou deux images, ou fondre 214–217. Si on veut la continuité réelle du citron, **re-rendu 3D**.

**I7 — Pâtes de grains en « drap » (96–117)** [constaté, appréciation]
- Le front de grains qui se détache de la dalle s'accroche et plisse comme une étoffe (99, 102, 105) avant de s'écrouler : lecture « tissu rouge » et non « pigment granulaire ». Un trou noir apparaît dans la nappe à 120–123 (vide laissant voir le fond).
- Correction : **re-rendu 3D** (simulation) ; en 2D on ne peut qu'accélérer le passage (réduire 96–120 de quelques images).

### MINEUR

- **M1 — Lettres du socle (60–125)** : la jointure du socle passe devant le R (« OFFGR IDZ », 57–108) ; au roulement, des lettres s'affichent en simple contour filaire (R à 84, « Z » et « A » à 108), qui se lit comme un modèle non fini. 2D impossible ; correction par masque du socle ou re-rendu 3D léger.
- **M2 — 48–53 : copie « OFFG » plus petite sous le mot** (ombre porte ou doublon de géométrie) [constaté]. À vérifier ; 2D difficile.
- **M3 — Lisibilité du roulement typographique** : 36 (« OFFGR.IDZ » en police pixel), 48 (« OFFGR1D » : le I Bodoni se lit « 1 » et le mot est rogné à droite). Pas de faute, mais lecture difficile à 4 images par caractère. 2D.
- **M4 — Marges illisibles sur téléphone [supposé]** : annotations de ~10 px de haut sur 1080 px de large, et la ligne « STUDIO CRÉATIF · IDENTITÉ · MOTION · 3D · PUBLICITÉ » (528–593) est plus petite encore ; à l'écran d'un téléphone elle n'est qu'un trait gris. Agrandir de 30 à 40 % (2D, gratuit).
- **M5 — Compteur de particules « N »** : saute de ~800 000 à 64 256 entre 189 et 192 et reste figé à 64 256 (192–215) pendant que le débit continue ; puis disparaît. 2D.
- **M6 — 456–470, plein écran de grains** : le déferlement est net, mais 474 laisse un bord de fenêtre déchiqueté (grains hors cadre jusqu'à la marge supérieure) : voulu par le concept ; à vérifier que le bord vif ne paraisse pas une erreur de masque.
- **M7 — 495–512 : nappe d'encre** : surface plate orange avec ondulations concentriques (anneaux de lumière) et un liseré noir de cadre (498–504) qui rappelle un plateau plastique ; la raclette (507–525) est un profilé métal à rivets assez « maquette ». Cohérent mais le moins subtil du film. Le balayage qui révèle le logo se lit comme une transition de type « essuie-glace » : à surveiller par rapport à la contrainte « pas de template ». Correction éventuelle : adoucir (reflets plus larges), 2D limité ; sinon 3D.
- **M8 — Menthe (312–350)** [constaté] : voir réponse ci-dessous.

## Réponse sur le brin de menthe (contrainte n° 5)
**Convaincant dans l'ensemble, mais encore un peu « bouquet posé ».** À 327 en pleine définition : trois à quatre petites feuilles aux nervures lisibles, vert uni, mat, plus plastique du tout ; la taille est correcte, la présence discrète comme demandé. Réserves : (a) le bouquet est posé sur le glaçon, pas planté dans le liquide (les tiges fines dépassent à gauche et la base est cachée derrière le glaçon) ; (b) les feuilles manquent de translucidité (pas de lumière traversante malgré le contre-jour orange). Ni bloquant ni gênant à l'échelle du téléphone. Une retouche de matériau (translucidité) demanderait un re-rendu 3D ; le client ne s'en plaindra pas probablement.

## Contrôle des contraintes
1. Logo : conforme (voir « Ce qui est bon »).
2. Textes en français : conformes ; aucune faute vue. Réserve de lisibilité M3/M4.
3. À éviter : **non respecté en séquence 4 (B1)** ; aucun glitch gratuit ailleurs, hormis 411 (barres obliques) et la jonction 56–58 (I3).
4. Réalisme : sucre réaliste ; verre, glace et gouttes très bons ; **liquide débordant (I1) et boisson peu reconnaissable (I2)** ; aucun grain hors du verre constaté en 180–225 ; rien ne traverse la paroi hormis I1.
5. Menthe : voir ci-dessus.
6. Inachevé / bruité / provisoire : 56–58, 357–360, 192–260 (poils de paroi), 411–417.

## Classement des corrections par coût
- **Assemblage 2D seulement (gratuit)** : B1 (en grande partie), I3, I4, I6, M3, M4, M5, M7 (partiel).
- **Re-rendu 3D nécessaire (coûteux)** : I1, I2, I5, I7, M1, M2 ; éventuellement B1 si l'on veut un nouveau mouvement de points.
