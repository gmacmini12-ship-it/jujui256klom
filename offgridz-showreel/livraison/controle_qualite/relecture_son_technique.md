# INSOUMISE — Relecture critique du son, de la synchronisation et de la conformité technique

Relecteur indépendant. Lecture seule : aucun fichier du projet modifié. Scripts et décodages de travail dans `/tmp/relecture_son/`. Personne (ni moi) n'a écouté le film : tout ce qui est écrit « mesuré » l'est sur les fichiers ; ce qui relève de l'écoute est marqué « supposé ».

Fichiers examinés : `out/final/insoumise_wip.mp4`, `out/livraison/insoumise_v1_leger_720x1280.mp4`, `out/audio/insoumise_v1.wav` (maître), `insoumise_v1_diffusion.wav`, `v1/musique.wav`, `v1/bruitages.wav`, `v1/evenements.json`, `timeline/partition.json`, `out/qc/mesures.json`, images maîtres (quelques-unes seulement, pour recoupement).

## Verdict

**Livrable en l'état sur le plan technique : oui, sans BLOQUANT.** Conformité des fichiers, niveaux, crête vraie après AAC, boucle, tempo, synchronisation à l'image près : tout est mesuré conforme. Il reste **deux défauts IMPORTANTS** (un passage visuel majeur non accentué par le son à l'image 56–57 ; un aigu soutenu et brillant dans l'avalanche de grains, 3,4–4,5 s) et quelques défauts MINEURS. Les « mesures » de synchro des événements sont, à ce niveau de rigueur, bonnes ; c'est l'accentuation de deux moments clés qui manque.

Trois corrections prioritaires :
1. Poser un accent sonore sur la plongée dans le O (flash image 56, coupe image 57, 1,867–1,900 s), aujourd'hui muet.
2. Adoucir et/ou baisser l'aigu 4–16 kHz de l'avalanche (3,4–5,0 s, bruitages) : il y domine les médiums (voir §3).
3. Garder de la marge de crête pour les plateformes qui ré-encodent : le plafond après AAC (−1,6 / −1,9 dBTP) est conforme, mais la marge n'est que de 0,6–0,9 dB sous la limite de −1,0 dBTP ; viser −3 dBTP après AAC si la diffusion se fait sur réseau social (supposé : leur ré-encodage ajoute des dépassements).

---

## 1. Conformité des fichiers (mesuré, ffprobe)

| Point | `insoumise_wip.mp4` (1080) | `insoumise_v1_leger_720x1280.mp4` | Verdict |
|---|---|---|---|
| Conteneur | MP4 (isom/mp41), moov avant mdat (lecture progressive) | idem | OK |
| Vidéo | H.264 High, niveau 4.0, yuv420p 8 bits, progressif | H.264 High, niveau 3.1, yuv420p | OK |
| Dimensions | 1080 × 1920 | 720 × 1280 | 9:16 exact dans les deux |
| Cadence | 30/1 constante (r_frame_rate = avg), 600 images comptées (`-count_frames`), tous les pts à 1/30 s | idem, 600 images | OK |
| Durée | vidéo 20,000000 s ; audio 20,000000 s ; format 20,000 s | idem | OK |
| Couleur | bt709 / bt709 / bt709, plage « tv » | idem | cohérent, signalé |
| Débit | vidéo 23,04 Mb/s ; audio 335 kb/s ; total 23,38 Mb/s ; 58,5 Mo | vidéo 5,09 Mb/s ; audio 205 kb/s ; 13,3 Mo | OK |
| Audio | AAC-LC, 48 kHz, stéréo, début à 0, 939 paquets | idem | OK |
| Images clés | 5 sur 600 (une toutes les 4 s) | 5 sur 600 | MINEUR (voir D8) |

Cohérence 1080 / légère : mêmes 600 images, mêmes durées, même couleur, même audio (écart de gain décodé −0,13 dB, voir §2). Le décodage intégral des deux fichiers (`ffmpeg -f null`) ne signale aucune erreur.

Réserves (mesurées) : rapport d'aspect d'échantillon non renseigné (N/A, interprété 1:1 par les lecteurs, sans conséquence) ; le décodeur ffmpeg rend 960 512 échantillons audio pour 960 000 attendus (soit 512 échantillons = 10,7 ms de plus, d'amplitude max 2,5 × 10⁻⁴ = −72 dBFS, voir D9). La mention « WIP » dans le nom du fichier du film final est à retirer à la livraison (remarque de forme).

## 2. Niveaux (mesuré ; tous les décodages refaits par moi, `diffusion.json` non pris sur parole)

| Source | Sonie intégrée | LRA | Crête d'échantillon | Crête vraie (×8) | Composante continue | Écrêtage ≥ 0,999 |
|---|---|---|---|---|---|---|
| WAV maître `insoumise_v1.wav` | −14,00 LUFS | 4,6 LU | −1,26 dBFS | **−1,15 dBTP** | −2,9e-6 / −3,7e-6 | 0 |
| WAV diffusion | −14,00 LUFS | 4,6 LU | −3,01 dBFS | **−2,86 dBTP** | −1,9e-7 / −1,9e-6 | 0 |
| Son décodé du MP4 1080 | −14,08 LUFS | 4,6 LU | −2,18 dBFS | **−1,58 dBTP** | 1e-5 | 0 |
| Son décodé du MP4 léger | −14,11 LUFS | 4,6 LU | −2,11 dBFS | **−1,93 dBTP** | −4e-5 / −2e-5 | 0 |

- Crête vraie des deux MP4 : mesurée par ebur128 (×4) puis par sur-échantillonnage ×8 : −1,6 et −1,9 dBTP, donc sous le plafond de −1,0 dBTP. Aucun échantillon décodé au-dessus de −1 dBTP (0 occurrence sur les deux fichiers). Le chiffre de `diffusion.json` (−1,65 dBTP à 320 kb/s, −1,98 à 192 kb/s) est confirmé à 0,1 dB près. Ma corrélation montre que l'audio des MP4 provient bien de la version « diffusion » (résidu −22,3 dB, contre −20,7 dB pour le maître ; gain −0,07 dB).
- Point faible du maître seul : −1,15 dBTP est à 0,15 dB du plafond ; le maître encodé directement en AAC donnerait une crête plus élevée qu'avec la version diffusion (non encodé par moi, supposé). La version diffusion est donc la bonne source (et elle l'a été).
- Sonie : −14,0 LUFS cible tenue ; −14,1 après AAC. Sonie à court terme (3 s) de −20,2 à −11,8 LUFS ; maximum momentané −9,9 LUFS à 8,4 s.
- Bruit de fond : souffle de bande à −55/−56 dBFS RMS (images 0–5 et 596–599), sans ronflette notable. Composante continue négligeable.
- Silences numériques : deux, volontaires et conformes à la partition : 7,000–7,200 s (images 210–215, 200 ms) et 15,100–15,200 s (images 453–455, 100 ms), plus 2 échantillons isolés. Aucun silence numérique non prévu. Après AAC ces silences contiennent de la pré-résonance : crête −37 dBFS (7,0–7,2 s) et −33 dBFS (15,1–15,2 s) (RMS −70 / −63 dBFS), inaudible en pratique (supposé) ; voir D7.

## 3. Équilibre spectral (mesuré, Welch 8 192 points, deux canaux)

Part d'énergie par bande (20 Hz–24 kHz) :

| Bande | Mélange | Musique | Bruitages | MP4 1080 décodé |
|---|---|---|---|---|
| 20–60 Hz | 1,3 % | 2,0 % | 0,1 % | 1,4 % |
| 60–125 Hz | 11,7 % | 17,7 % | 0,4 % | 11,7 % |
| 125–500 Hz | 32,9 % | 44,9 % | 9,7 % | 33,3 % |
| 0,5–4 kHz | 39,9 % | 30,5 % | 58,5 % | 40,2 % |
| 4–16 kHz | 13,3 % | 4,2 % | 30,4 % | 12,6 % |
| 16–24 kHz | 0,9 % | 0,8 % | 1,0 % | 0,8 % |

**Basses : pas surdimensionnées.** 13 % de l'énergie du mélange sous 125 Hz, 1,3 % sous 60 Hz. Niveau 20–125 Hz par seconde : 5 à 10 dB sous le niveau total (par ex. −24,5 contre −21,0 dBFS à 2–3 s ; −23,2 contre −16,3 dBFS à 4–5 s), crête de la bande 20–125 Hz au plus −8,6 dBFS (5–6 s). La mesure 1 (0,8–2,4 s) est la plus lourde en proportion (39 % de l'énergie en 60–125 Hz), mais à un niveau global bas (−24 dBFS RMS). Le corps de la musique est en 125–500 Hz (45 %), ce qui est chaud, pas boomy. Contrainte « pas de basses surdimensionnées » : respectée (mesuré).

**Résonances :** pics étroits les plus saillants dans le mélange (prominence sur médiane glissante) : 522–524 Hz (+19 dB), 174 Hz (+18 dB), 348–350 Hz (+18 dB) ; dans la musique 619–625, 1 047 et 1 243 Hz (+21 à +23 dB). Ce sont des fréquences de notes (F3 = 174,6 Hz, F4 = 349 Hz, C5 = 523 Hz) : tonalité voulue, pas résonance parasite (interprétation, cohérente avec les notes du journal d'événements). Aucun pic étroit hors gamme musicale.

**Aigu, grains de sucre (2,4–7,2 s) : défaut D2 (IMPORTANT, à confirmer à l'écoute).** Niveau RMS par bande du mélange (dBFS) :

| Fenêtre | 125–500 | 0,5–2 k | 2–4 k | 4–8 k | 8–16 k | total |
|---|---|---|---|---|---|---|
| 2,4–3,4 s | −23,7 | −22,6 | −33,7 | −33,1 | −33,3 | −17,9 |
| **3,4–4,4 s** | −24,6 | −27,0 | −31,3 | **−24,0** | **−22,3** | −16,7 |
| 4,4–5,4 s | −24,2 | −28,6 | −28,1 | −25,5 | −28,8 | −18,3 |
| 5,4–6,4 s | −23,8 | −22,2 | −31,7 | −31,8 | −33,4 | −17,3 |

De 3,4 à 4,4 s, la bande 8–16 kHz (−22,3) est plus forte que 125–500 Hz et 0,5–2 kHz ; la composante 4–16 kHz entre 3,4 et 5,0 s a un RMS de −19,7 dBFS avec des crêtes à −1,2 dBFS (facteur de crête 18,5 dB). Le centroïde spectral des bruitages monte à 8,4–8,9 kHz entre 3,6 et 4,4 s ; plus de 2 500 sauts d'échantillon > 0,2 par seconde dans le stem bruitages aux secondes 3–5. Spectre par tiers d'octave presque plat de 3 à 12,8 kHz (≈ −32 à −34 dB), soit un bruit rose/blanc brillant, sans pic étroit. Donc : pas de résonance, mais un souffle d'aigu soutenu et fort, qui peut être perçu comme dur (supposé : dépend de l'écoute et de la restitution ; sur petit haut-parleur de téléphone, c'est moins gênant, sur casque plus).

## 4. Stéréo (mesuré)

Corrélation globale 0,715 (musique 0,726, bruitages 0,691) ; par séquence : 0,98 (levée), 0,87, 0,90, 0,67, 0,59, 0,61, 0,72. Bande 20–125 Hz corrélée à 0,989 : graves centrés, bien. Somme mono : perte de 0,67 dB RMS, sonie mono (L+R)/2 = −14,74 LUFS (−0,74 LU) ; rapport Side/Mid −7,8 dB. Pas de contre-phase soutenue. Seules 3 fenêtres de 200 ms ont une corrélation < 0,3 : 0–0,2 s (−0,15), 11,8–12,0 s (0,26), 19,7–19,9 s (0,13) ; celles de début et de fin sont le souffle à −55 dBFS (sans enjeu) ; à 11,8–12,0 s, perte mono de 2,0 dB sur le niveau −17,4 dBFS : légère, sans risque. **Compatibilité mono : bonne.**

## 5. Synchronisation (mesuré)

### 5.1 Détection d'attaques sur les stems

Méthode indépendante de celle du rapport de fabrication : enveloppe en dB (fenêtre 1 ms) filtrée par famille (graves 35–180 Hz pour kicks et basses, au-dessus de 5 kHz pour hats et clics, au-dessus de 400 Hz sinon) ; l'attaque est le point de plus forte montée dans [−21 ms ; +33 ms] autour de l'échantillon attendu (image × 1 600). Sur 373 événements discrets du journal, 282 ont une montée d'au moins 12 dB mesurable (les autres sont masqués par un autre son ou sont des nappes) : 202 sont à ±1 ms (le biais de mesure de −0,5 ms est dû au lissage de 1 ms), 212 à ±5 ms, **282 sur 282 à moins d'une image (1 600 échantillons)**. Médiane −23 échantillons (biais de lissage), sans dérive (dérive de la grille mesurée sur les hats : 0,16 image sur 600 images, soit 5 ms sur 20 s, dans le bruit de mesure).

Les écarts supérieurs à 5 ms (jusqu'à 33 ms) concernent exclusivement des grappes d'événements denses de la simulation (chocs de la séquence 3 aux images 228–256 : feuilles, glaçons, rondelles ; clics du roulement 4), où ma méthode pioche l'attaque d'un voisin : je les considère comme artefacts de mesure (supposé, vérifié à la main pour les événements clés ci-dessous), et ils restent de toute façon sous une image. Aucun événement n'est mesuré en retard ou en avance d'une image entière.

Vérification manuelle des événements clés (premier échantillon significatif par rapport à l'échantillon attendu, sur le stem concerné) :

| Événement | Image (s) | Mesure |
|---|---|---|
| Tic de papier | 6 (0,200) | 0 à +14 échantillons (≤ 0,3 ms) |
| Déchirure + déclic du réticule | 12 (0,400) | −1 échantillon (énergie −50 → −14 dB à l'image 12) |
| Kick d'entrée + premier clic de caractère | 24 (0,800) | 0 / −1 échantillon |
| 8 clics de caractères 24–47 | pas de 3 images | ≤ 0,4 ms |
| Déclic 1, kick A2.0, hat, basse | 72 (2,400) | +8 échantillons (0,2 ms) |
| Kick et glissement | 96 (3,200), 120, 168, 180 | ≤ 0,5 ms |
| Reprise après silence : kick doux B5, citron | 216 (7,200) | 0 échantillon |
| Paille (choc simulé) | 237 (7,900) | +1 échantillon ; énergie −46 → −17 dB |
| Brin de menthe | 312 (10,400) | attaque + 19 dB à l'image 312 (0 ms) |
| Déclic tenu | 318 (10,600) | ≤ 0,5 ms |
| Kick C.0 (coupe vers la séquence 4) | 360 (12,000) | +24 échantillons (0,5 ms) |
| Retour F : kick, déferlement | 456 (15,200) | 0 à +22 échantillons |
| Début de la raclette | 504 (16,800) | +818 échantillons (17 ms ; attaque douce) |
| Déclic final, accord final | 528 (17,600) | −1 / +128 échantillons (accord à attaque douce) |
| Second appui | 540 (18,000) | 0 échantillon (bruitages), accord +1 187 (24,7 ms, attaque douce) |

Les 133 événements musicaux discrets sont tous à des images entières multiples de 3 (grille de double croche) dans le journal ; vérification : `echantillon_attendu = image × 1600` pour tous.

### 5.2 Recoupement avec `mesures.json` (écart visuel / énergie sonore par image)

| Moment | Visuel | Son | Écart |
|---|---|---|---|
| Déchirure, image 12–24 | écart visuel qui décolle à 12 (0,0026) puis 0,0106 à 24 | énergie −50 → −14 dB à 12 ; −42 → −12 dB à 24 | 0 image |
| Image 72 | pic modéré (0,032) | −49 → −9 dB (kick) | 0 image |
| Image 168–169 | pic 0,137 à 169 | kick à 168 (−9,5 dB) | 1 image (le son devance, correct pour un coup) |
| Image 216 | pics 0,055–0,069 autour de 213–217 | silence numérique 210–215 puis −15 dB à 216 | 0 image |
| Jet sur la glace 264 | première matière dans le verre à l'image 264 (le filet est déjà dans le champ à 262–263) | énergie −15,8 → −11,7 dB (+4 dB) ; arpège à 264 | 0 image, mais aucune attaque propre (voir D5) |
| Brin de menthe 309–312 | tige verte apparaît en ligne fine à 311, pleine à 312 | attaque +19 dB à 312 | 0 à 1 image (le son suit l'apparition) |
| Coupe vers la séquence 4 | saut de luminance −0,111 entre 359 et 360 ; écart 0,107 | kick C.0 à 360 (−15,7 → −10,2 dB) | 0 image |
| Raclette 504–527 | écart visuel qui monte de 505, deux bosses à 509 (0,067) et 521–523 (0,081), retombée à 527–529 | bruitage de raclette de 504 à 527 (−17,8 dB vers 508–510, −19,5 dB vers 520), chute −30,5 / −43,6 dB à 526–527 puis déclic final à 528 | cohérent à 1–2 images près ; deux « temps » audibles par l'enveloppe mais peu contrastés (différence ≈ 2–6 dB) |
| **Passage dans le O, 56–57** | **flash crème à l'image 56 (luminance +0,29 puis −0,443 à 57 ; écart visuel 0,441, le plus grand du film, 3,2 fois le second)** | **aucun accent : énergie −20,9 / −20,9 / −20,6 dB aux images 56–58 ; le bruit de caméra monte lentement (−34 → −32 dB) ; coupure de la musique 60–62 ; kick syncopé 63** | **le son ne souligne pas l'événement visuel majeur, voir D1** |

## 6. Clics et discontinuités (mesuré)

- Plus grand saut d'échantillon à échantillon : 1,12 (maître, à 3,868 s, dans l'avalanche, bruit à haute fréquence très dense : pas un clic isolé, c'est la texture). Mais le critère pertinent est le saut rapporté à la médiane locale : 26 grappes de sauts abrupts (> 0,08 et > 60 × médiane locale) ; 19 coïncident à moins de 0,5 ms avec un événement du journal (attaques de clics, kicks, déclics : voulu). Les 7 autres (3,066 ; 3,079 ; 3,090 ; 3,172 ; 3,190 ; 3,466 ; 3,479 s, images 92–104) sont des éclats du stem bruitages dans la texture d'effritement, sans événement discret associé (sauts 0,22–0,76 dans un bruit dense) ; échantillon par échantillon ce sont des oscillations de bruit, pas des discontinuités (vérifié). Je ne les juge pas défectueux, à écouter (supposé).
- **Début (0 s)** : premiers échantillons 0,0024, pas de saut. **Fin (20 s)** : derniers échantillons 0,0020 (maître) ; dans le MP4 décodé, 5e-5 (la fin AAC est plus propre).
- **Point de boucle** (fin recollée au début) : saut maître 7,2e-4 (médiane locale 4,9e-4) ; MP4 décodé 1,2e-3 sur ±1 ms (maximum 2,1e-3). Niveaux : 100 dernières ms −56,3 dBFS, 100 premières −55,3 dBFS (−1,0 dB) ; spectre des 200 dernières contre 200 premières ms : écart de 0,6–1,5 dB par bande (20–200 Hz : −72,2 / −70,7 ; 0,2–2 kHz : −70,1 / −68,6 ; 2–8 kHz : −74,4 / −73,4 ; 8–20 kHz : −86,9 / −85,7). **La boucle sonore est inaudible (mesuré).** Les images 0, 599 et 594–599 sont identiques bit à bit selon le rapport du compositeur ; luminance 596–599 et 0–2 égales (0,11276).
- Attaques franches : à 0,8 s (0,003 → 0,769 en un échantillon : kick + clic) et à 7,2 s (0 numérique → 0,39 en un échantillon, après 200 ms de silence numérique ; musique 0,25, bruitages 0,13) : fronts d'attaque rectangulaires. Voir D6.

## 7. Impacts à large bande : y a-t-il des explosions répétées ? (mesuré, qualification supposée)

Détecteur d'attaques sur le mélange (montée ≥ 15 dB en 15 ms, niveau ≥ −24 dBFS) : 104 attaques en 20 s, dont l'immense majorité sont des événements rythmiques fins (hats, clics, roulements, clapotis). Les attaques les plus fortes (crête ≥ −3 dBFS) sont 0,8 s, 2,4 s (−1,3), 3,14–3,2 s, 3,77 s, 4,0 s (−1,3), 4,68 s, 5,6 s (−1,3), 5,94–6,0 s, 15,2 s (−1,9), 17,6 s (−1,3) : environ 10. Parmi elles, 5 sont des temps 1 de mesure avec kick (0,8 ; 2,4 ; 4,0 ; 5,6 ; 15,2 s ; au rythme de la partition, une mesure sur deux ou trois), plus l'accord final (17,6 s). Leur énergie sur 100 ms : RMS −12,9 à −14,2 dBFS, soit au plus +1 dB au-dessus de la sonie moyenne ; contenu dominant en graves-médiums (2,4 s : 64 % dans 20–125 Hz ; 4,0 s : 55 % ; 15,2 s : 74 %), mais crêtes de bande graves ≤ −8,6 dBFS et énergie 20–60 Hz totale de 1,3 %. Pas de réverbération longue ni de queue grave après ces coups (retour à −20 dBFS en 100–200 ms, vérifié sur les enveloppes). **Conclusion : pas d'explosions répétées ; ce sont des temps forts de groove (kick + clic) de niveau maîtrisé**, de timbre variable d'une mesure à l'autre (kick doux, basse tenue, caisse claire, accords). Le risque d'« impact générique » n'est pas démontré par la mesure ; à confirmer à l'écoute (supposé), notamment l'attaque du kick à 0,8 s (peak −2,3 dBFS, 93 % graves) qui est le premier choc du film.

## 8. Tempo (mesuré)

- Les 133 événements musicaux discrets du journal sont à des multiples exacts de 3 images (double croche à 150 BPM : 12 images/temps, 1 600 échantillons/image), sans écart (écart attendu/programmé = 0 échantillon).
- Sur le signal : 138 attaques aiguës détectées dans la musique ; écart à la grille de 3 images : médiane 0,03 image, 76 sur 109 à moins de 0,1 image, dérive linéaire 0,16 image sur toute la durée (≈ 5 ms sur 20 s : bruit de mesure, pas de dérive) ; les attaques hors grille (±1,2 à ±1,5 image) sont des roulements en triples ou en trente-deuxièmes (433,5 ; 436,5 ; … 451,5 : demi-pas de 1,5 image) et des arpèges, voulus. Autocorrélation des attaques dans le groove A (2,4–7 s) : période 400 ms = 150,0 BPM exactement. Sur les autres sections l'autocorrélation tombe sur des subdivisions (218 ms) ou sur des temps dilués : non concluante, mais compatible avec la grille. **150 BPM tenu (mesuré sur 2,4–7 s et sur les événements ; supposé ailleurs, mais sans écart de grille).**

## 9. Contraintes du client (récapitulatif)

| Contrainte | Résultat |
|---|---|
| 20 s exactes, 9:16, 1080 × 1920, 600 images à 30 i/s | OK (mesuré) |
| Musique électronique originale, synchro à l'image près | synchro OK à ±1 image (mesuré) ; « sophistiquée » : jugement d'écoute, non mesuré |
| Pas de basses surdimensionnées | OK (13 % sous 125 Hz, 1,3 % sous 60 Hz) |
| Pas d'explosions répétées, pas d'impacts génériques | pas d'explosions (mesuré) ; « générique » : non démontré, à écouter |
| Aucune voix | aucune mesure ne permet de détecter une voix ; le journal et le rapport de fabrication n'en mentionnent aucune. Non vérifié à l'écoute (supposé) |
| Le film boucle, son compris | OK (mesuré : saut 7e-4, −1,0 dB, spectre à ±1,5 dB) |

## 10. Liste des défauts

### D1 — IMPORTANT — Plongée dans le O sans accent sonore (images 56–57, 1,867–1,900 s)
- Mesuré : le plus fort changement visuel du film (écart 0,441 ; luminance +0,290 puis −0,443 entre 55–57 ; l'image 56 est un aplat crème, l'image 57 la coupe sur la scène suivante). Énergie sonore plate (−20,9 / −20,9 / −20,6 dB aux images 56–58) ; bruit de caméra en lente montée (−34 → −32 dB) ; la musique s'arrête aux images 60–62 (−44 à −53 dB) puis le kick syncopé tombe à 63 (2,100 s), soit 6 images (200 ms) après la coupe. Ni les temps de la grille (36, 48, 60, 72), ni la coupe visuelle ne coïncident (57 = 24 + 33, soit 11 doubles croches).
- Piste de correction : accent à l'image 56 ou 57 (montée d'un souffle ou d'une basse qui culmine à 56, coupure sèche à 57), ou décaler visuellement/sonorisation de façon à ce que la coupure de la musique (60) et la coupe image se rejoignent. Si le décalage est une intention (la plongée précède le coup), le dire dans la partition.

### D2 — IMPORTANT (à confirmer à l'écoute) — Aigu soutenu et brillant dans l'avalanche (3,4–5,0 s, images 102–150)
- Mesuré : 4–8 kHz à −24,0 dBFS et 8–16 kHz à −22,3 dBFS RMS en 3,4–4,4 s (plus fort que les graves et les médiums de la même fenêtre) ; crêtes de bande à −1,2 dBFS ; part 4–16 kHz de 24,5 % sur 2,4–7,2 s (contre 13,3 % sur le film) ; centroïde des bruitages 8,4–8,9 kHz.
- Piste de correction : baisser de 3 à 5 dB la couche de grains secs au-dessus de 6 kHz, ou filtre passe-bas doux (pente −6 dB/octave à partir de 6 kHz) ; vérifier à l'écoute au casque.

### D3 — MINEUR — Marge de crête vraie après AAC
- Mesuré : −1,58 dBTP (1080) et −1,93 dBTP (légère), pour une limite de −1,0 : 0,6 et 0,9 dB de marge. Conforme, mais mince si une plateforme ré-encode.
- Piste : version diffusion à −3,5 dBTP si la livraison finale passe par un ré-encodage.

### D4 — MINEUR — Plongée de sonie en fin de film
- Mesuré : sonie à court terme de −20,2 LUFS (0–3 s) et −15,2 LUFS (16–19 s), l'avant-dernière seconde chute à −39,7 dBFS RMS (19–20 s). C'est la queue de l'accord final voulue pour la boucle ; à noter pour la diffusion : la dernière seconde est très basse.

### D5 — MINEUR — Arrivée du jet sur la glace (image 264, 8,800 s) sans attaque propre
- Mesuré : énergie +4,1 dB seulement (−15,8 → −11,7 dB) ; l'enveloppe aiguë baisse même de −15 à −25 dB autour de 264 ; la plus forte montée sur 5 ms dans ±100 ms est de +4,9 dB, à +49 ms. Le début de l'arpège à 264 porte le temps fort mais le contact du filet sur la glace n'a pas d'événement net. Le journal le place pourtant à 264 (échantillon 422 400), et le filet est visible dès 262–263.
- Piste : un transitoire liquide-glace sec à 262–264 ou une montée courte avant 264.

### D6 — MINEUR — Fronts d'attaque rectangulaires (0,8 s et 7,2 s)
- Mesuré : 0,8 s : 0,003 → 0,769 en un échantillon ; 7,2 s : 0 → 0,389 en un échantillon, après 200 ms de silence numérique (rapport au saut médian local : ×1 158). Ce sont des clics possibles (supposé : audibles si le front est isolé ; ici ils sont couverts par le contenu du coup).
- Piste : montée de 1 à 3 ms sur le premier échantillon du kick doux de 7,2 s ; filtre passe-haut doux sur le front.

### D7 — MINEUR — Pré-résonance AAC dans les deux silences
- Mesuré : crête décodée −37 dBFS (7,0–7,2 s) et −33 dBFS (15,1–15,2 s) dans les silences numériques ; RMS −70 et −63 dBFS. Sans doute inaudible.

### D8 — MINEUR — Images clés espacées (5 sur 600)
- Mesuré : une image clé toutes les 4 s dans les deux MP4. Conséquence pour la lecture en boucle ou le positionnement : accès moins précis. Piste : une image clé toutes les 30 images si le fichier est destiné au web (non demandé).

### D9 — MINEUR — Excédent audio de 512 échantillons au décodage
- Mesuré : 960 512 échantillons décodés pour 960 000 attendus (10,7 ms, amplitude max −72 dBFS) ; durée du flux annoncée à 20,000 s. Sans conséquence audible, mais le raccord de la boucle sur un lecteur qui joue l'audio entier peut dériver de 10 ms.

## Résumé des mesures principales

- Fichiers : H.264 High 1080 × 1920 et 720 × 1280, 600 images à 30 i/s, 20,000 s, AAC-LC 48 kHz stéréo, bt709.
- Sonie −14,0 LUFS (MP4 : −14,1), LRA 4,6 LU ; crête vraie WAV maître −1,15 dBTP, MP4 1080 −1,58 dBTP, MP4 léger −1,93 dBTP ; 0 écrêtage ; aucun silence imprévu.
- Spectre : 1,3 % sous 60 Hz, 13 % sous 125 Hz ; corrélation 0,715 ; perte mono 0,67 dB.
- Synchro : 282 événements mesurables à moins d'une image (202 à ±1 ms) ; tempo 150 BPM ; boucle inaudible.
