"""Contenu du dossier de préproduction d'INSOUMISE (phase 3).

Une seule source pour la page (preprod/dossier.html) et pour DOSSIER_PREPRODUCTION.md.
Les temps viennent de timeline/partition.json ; ne pas les recopier ici autrement qu'en clair.
"""

CREDITS = {"depenses": 8.63, "vise": 200, "plafond": 345}

RESUME = (
    "Vingt secondes, un seul plan, une seule matière. La bande orange du logo échappe au réticule en changeant "
    "d'état, accepte une forme le temps d'un mojito, déborde de la feuille, puis reprend sa place sous un coup de raclette."
)

A_VALIDER = [
    ("Le storyboard et la partition",
     "Sept séquences calées sur 150 BPM. Dites ce qui doit changer ; sans remarque, je fabrique sur cette base."),
    ("Le plan de dépense par paliers",
     "185 crédits prévus au total, sous votre cible de 200. Chaque palier vous est soumis avant d'être engagé. "
     "La prochaine étape, l'animatique et la maquette sonore, ne coûte rien."),
]

TEST_GPU = [
    ("Machine louée", "NVIDIA L40S, 46 Go, Ubuntu 24.04, un seul cœur de processeur"),
    ("Durée et coût du test", "7 min 17 s, 8,63 crédits sur les 15 autorisés"),
    ("Verre, glace et liquide, 256 échantillons, débruité", "4,8 s par image"),
    ("Même scène, 512 échantillons", "12,2 s par image"),
    ("3 millions de grains, 128 échantillons", "1,2 s par image"),
    ("La même image du verre sur notre machine à 4 cœurs", "environ 11 minutes"),
    ("Solveur de particules, 4 millions de particules", "8,6 ms par pas de calcul"),
    ("Solveur de liquide de Blender, version officielle", "fonctionne sur la machine louée"),
    ("Échange de fichiers avec la machine louée", "fonctionne dans les deux sens"),
]

TEST_GPU_LIMITES = [
    "La machine louée n'a qu'un cœur de processeur : la simulation du liquide, qui n'utilise pas le GPU, "
    "se fera sur notre machine à 4 cœurs, gratuitement.",
    "Le débruiteur propre à la carte ne démarre pas sur cette machine ; le débruiteur libre intégré à Blender "
    "le remplace sans perte visible.",
    "Les temps mesurés portent sur une scène de calibration, pas sur les scènes finales. "
    "L'estimation du rendu double le temps du verre par prudence.",
]

PALIERS = [
    ("1", "Test GPU", 8.63, "fait"),
    ("2", "Textures (menthe, citron vert) et bruitages générés", 14, "à la demande, pendant la fabrication"),
    ("3", "Session GPU A : simulations finales des grains, images de référence en qualité finale", 36, "30 min"),
    ("4", "Session GPU B : rendu final", 102, "86 min"),
    ("5", "Session GPU C : corrections après contrôle qualité", 24, "20 min"),
]

RENDU = [
    ("0–1 Papier et déchirure", 72, "mat, 256 échantillons", 3, 3.6),
    ("2 Grains", 144, "5 à 8 millions de grains", 5, 12.0),
    ("3 Mojito", 144, "512 échantillons, deux fois le temps de la scène test", 20, 48.0),
    ("4 Données", 96, "moteur de points", 2, 3.2),
    ("5 Fond perdu", 72, "feuille entière, grains puis encre", 12, 14.4),
    ("6 Signature", 72, "assemblage local, sans GPU", 0, 0.0),
]

SEQUENCES = [
    {
        "id": "0", "titre": "Épreuve", "temps": "0,00 – 0,80 s", "images": "0 – 23", "mesures": "levée",
        "rendu": "logo à plat",
        "planches": [("logo", "Image 0 : le logo source"), ("dechirure", "Image 18 : la bande s'arrache")],
        "champs": [
            ("Composition", "Le logo source, au pixel près, centré dans la fenêtre. Dans les marges : traits de coupe, "
                            "« OFFGRIDZ — ÉPREUVE N° 01 » en haut, « REPÉRAGE : OK » en bas."),
            ("Caméra", "Fixe, de face. Aucune profondeur visible avant l'image 12."),
            ("Matériaux", "Papier noir mat ; le logo est une impression à plat."),
            ("Lumière", "Uniforme, comme sous un banc de reproduction."),
            ("Mouvement", "Images 0 à 5 immobiles : c'est le point d'arrivée de la boucle. Image 6 : un liseré de lumière "
                          "court le long de la bande déchirée. Images 12 à 23 : la bande s'arrache de droite à gauche et "
                          "s'enroule vers l'avant ; les lettres restent suspendues et prennent du volume ; le réticule se "
                          "décroche et pivote de 4°."),
            ("Simulation", "Papier déchiré simulé comme un tissu raide, retenu à gauche."),
            ("Transformation", "L'impression à plat devient un empilement de couches : le démontage des cinq signes commence."),
            ("Son", "Souffle de bande très bas. Tic de papier sec à l'image 6. À l'image 12, déchirure (bruit filtré, "
                    "craquements, hauteur descendante) et déclic inversé du réticule."),
            ("Raccord", "La fente laissée par la bande devient l'entrée de la caméra."),
        ],
    },
    {
        "id": "1", "titre": "Déchirure", "temps": "0,80 – 2,40 s", "images": "24 – 71", "mesures": "mesure 1",
        "rendu": "papier, mat",
        "planches": [("roulement", "Images 24 à 45 : roulement typographique"), ("plongee", "Image 60 : plongée dans le O")],
        "champs": [
            ("Composition", "Le mot flotte au centre, devant la fente. Photo et bande orange glissent en parallaxe. "
                            "Le réticule reste collé à l'écran."),
            ("Caméra", "Travelling avant continu, longue focale, puis plongée dans le creux du O (images 48 à 71). "
                       "C'est le début de la descente unique."),
            ("Matériaux", "Lettres en plâtre crème ; papier épais, fibres visibles sur la tranche déchirée."),
            ("Lumière", "Une source rasante à gauche, un remplissage large et doux, fond noir."),
            ("Mouvement", "Roulement typographique n° 1 : un caractère toutes les 3 images, de l'image 24 à l'image 45 "
                          "(Archivo, Anton, Permanent Marker, Saira Stencil, Doto, Major Mono, Instrument Serif), "
                          "arrêt sur Bodoni Moda."),
            ("Simulation", "Aucune nouvelle. Les fibres du papier sont une géométrie procédurale."),
            ("Transformation", "Les lettres plates deviennent des volumes ; le O devient un passage."),
            ("Son", "Le rythme entre sur le premier temps. Huit clics, un par caractère, chacun avec son timbre. "
                    "Glissé de basse au troisième temps. Souffle discret, piloté par la vitesse de la caméra."),
            ("Raccord", "Derrière la feuille, la bande orange apparaît comme une dalle de pigment pressé."),
        ],
    },
    {
        "id": "2", "titre": "Grains", "temps": "2,40 – 7,20 s", "images": "72 – 215", "mesures": "mesures 2 à 4",
        "rendu": "atelier, mat, macro",
        "planches": [("dalle", "Image 90 : la dalle s'effrite"), ("avalanche", "Image 140 : l'avalanche contourne les lettres"),
                     ("filet", "Image 200 : le filet tombe vers le verre")],
        "champs": [
            ("Composition", "Mesure 2 : la dalle orange debout, plein cadre, le réticule dessus. Mesure 3 : au ras du sol, "
                            "les lettres monumentales à demi ensevelies. Mesure 4 : un filet de grains vertical, puis un "
                            "cercle de lumière en contrebas."),
            ("Caméra", "Contre-plongée lente sur la dalle ; recul au ras des grains pendant l'avalanche ; descente verticale "
                       "le long du filet ; arrivée à la verticale du bord d'un verre."),
            ("Matériaux", "Pigment en grains mats, dont la teinte varie de 8 % d'un grain à l'autre ; lettres et sol en "
                          "plâtre ; poussière fine en suspension."),
            ("Lumière", "Rasante et chaude, ombres longues ; la poussière dessine les rayons."),
            ("Mouvement", "Image 72 : première tentative de verrouillage. Image 84 : le haut de la dalle s'effrite, le front "
                          "descend. Image 96 : le réticule décroche. Images 96 à 117 : roulement n° 2, arrêt sur Anton. "
                          "Mesure 3 : l'avalanche contourne les lettres et remplit le O. Image 168 : deuxième tentative, "
                          "sur le filet ; échec à l'image 180."),
            ("Simulation", "Grains calculés par la méthode des points matériels, 5 à 8 millions de particules. "
                           "La cohésion de la dalle est annulée par un front qui descend ; lettres et sol font obstacle."),
            ("Transformation", "Du solide au granulaire, dans le plan, sans coupe."),
            ("Son", "Rythme à demi-temps, basse en trois notes. Texture granulaire dont la densité suit le débit mesuré "
                    "dans la simulation. Un déclic à chaque tentative, un glissement désaccordé à chaque échec. "
                    "Dernière croche de la mesure 4 : silence."),
            ("Raccord", "Les grains tombent dans le verre. Le bord du verre épouse le réticule ; le pigment devient sucre de canne."),
        ],
    },
    {
        "id": "3", "titre": "Mojito", "temps": "7,20 – 12,00 s", "images": "216 – 359", "mesures": "mesures 5 à 7",
        "rendu": "bar, brillant",
        "planches": [("glacons", "Image 250 : les glaçons tombent"), ("versement", "Image 285 : versement"),
                     ("heros", "Image 325 : plan héros, verrouillage tenu")],
        "champs": [
            ("Composition", "Verre droit sur un comptoir noir laqué, vu de trois quarts. Derrière lui, une barre lumineuse "
                            "orange verticale (la bande devenue lumière) et une enseigne floue qui porte le mot. "
                            "Plan héros centré à la mesure 7."),
            ("Caméra", "Bascule de la verticale au trois-quarts macro ; orbite de 12° avec ralenti, de quatre fois plus lent "
                       "au temps réel ; quasi fixe pendant une seconde (images 318 à 347) ; puis glissement vers "
                       "l'ouverture de la paille."),
            ("Matériaux", "Verre, glace au cœur laiteux, liquide clair teinté d'ambre par le sucre, menthe, citron vert, "
                          "paille noire brillante, buée et gouttes, sous-verre rond imprimé du logo."),
            ("Lumière", "Éclairage de boisson : contre-jour orange, source douce au-dessus, cartons noirs pour dessiner "
                        "les arêtes du verre."),
            ("Mouvement", "Premier temps : quartiers de citron. Deuxième temps : menthe. Troisième et quatrième temps : "
                          "glaçons, et roulement n° 3 sur l'enseigne, arrêt sur Instrument Serif italique. Mesure 6 : "
                          "versement, le sucre se dissout en volutes ambrées, les bulles montent. Image 312 : la paille "
                          "tombe et se cale. Image 318 : troisième tentative, le verrouillage tient jusqu'à l'image 341."),
            ("Simulation", "Corps rigides pour le citron, les glaçons et la paille. Liquide calculé en particules avec "
                           "surface maillée. Bulles et buée procédurales."),
            ("Transformation", "Du granulaire au dissous : le sucre teinte le liquide. La matière accepte une forme."),
            ("Son", "Percussions réduites à des clics fins ; chaque choc de glaçon déclenche son tintement. Versement et "
                    "bulles synthétisés. Arpège montant à la mesure 6. Mesure 7 : accord ouvert, basse profonde, déclic "
                    "tenu. Aspiration en fin de mesure."),
            ("Raccord", "La caméra entre dans la paille noire. Le noir du tube devient le vide de l'univers suivant."),
        ],
    },
    {
        "id": "4", "titre": "Données", "temps": "12,00 – 15,20 s", "images": "360 – 455", "mesures": "mesures 8 et 9",
        "rendu": "points, abstrait",
        "planches": [("points", "Image 395 : le mot en matrice de points"), ("relief", "Image 420 : le portrait en relief de points")],
        "champs": [
            ("Composition", "Vide noir ; 6 à 8 millions de points crème et orange ; les traits du réticule prolongés en axes "
                            "gradués. Mesure 9 : le portrait du logo en relief de points, la zone des yeux laissée vide."),
            ("Caméra", "Dérive dans le champ ; orbite de 20° autour du relief ; recul accéléré sur les deux derniers temps."),
            ("Matériaux", "Points lumineux additionnés, forte profondeur de champ, brume de profondeur."),
            ("Lumière", "Aucune source : les points émettent."),
            ("Mouvement", "Les gouttes du tube deviennent des points. Images 384 à 407 : roulement n° 4, le mot en matrice "
                          "de points dont la graisse varie en continu. Mesure 9 : les points orange accélèrent vers l'objectif."),
            ("Simulation", "Points portés par un champ de vecteurs sans divergence, attirés vers des formes cibles "
                           "(lettres, relief)."),
            ("Transformation", "Du liquide à la lumière, puis de la lumière aux grains pendant le recul."),
            ("Son", "Rythme aérien, arpège cristallin en doubles-croches, signaux brefs. Mesure 9 : montée par roulement, "
                    "doubles puis triples-croches. Dernière double-croche : silence."),
            ("Raccord", "Les points grossissent et redeviennent des grains lancés vers l'objectif."),
        ],
    },
    {
        "id": "5", "titre": "Fond perdu", "temps": "15,20 – 17,60 s", "images": "456 – 527", "mesures": "mesure 10 et deux temps",
        "rendu": "mat, puis brillant",
        "planches": [("debordement", "Image 470 : les grains débordent dans les marges"),
                     ("raclette", "Image 515 : la raclette imprime le logo")],
        "champs": [
            ("Composition", "La feuille entière. Les grains frappent la fenêtre, franchissent ses bords et recouvrent les "
                            "marges : premier et seul plein écran du film."),
            ("Caméra", "Fixe, de face, comme à l'image 0."),
            ("Matériaux", "Grains mats, puis encre épaisse et brillante ; raclette en caoutchouc crème, monture d'aluminium."),
            ("Lumière", "Douce, au-dessus ; larges reflets sur l'encre."),
            ("Mouvement", "Images 456 à 479 : déferlement et débordement ; les annotations affichent FOND PERDU avant d'être "
                          "ensevelies. Images 480 à 503 : une vague de brillance change les grains en film d'encre. "
                          "Images 504 à 527 : la raclette descend sur toute la hauteur en deux temps ; derrière elle, "
                          "le logo imprimé apparaît de haut en bas."),
            ("Simulation", "Grains contre les bords de la fenêtre ; film d'encre calculé comme une couche mince poussée par la raclette."),
            ("Transformation", "Du granulaire au liquide, puis du liquide à l'impression."),
            ("Son", "Le moment le plus plein, sans explosion : nappe de bruit filtrée et basse tenue. Le timbre passe du sec "
                    "au mouillé. Puis tout s'efface devant un seul frottement long, dont la hauteur descend avec la raclette."),
            ("Raccord", "La raclette sort par le bas. Il ne reste que le logo."),
        ],
    },
    {
        "id": "6", "titre": "Signature", "temps": "17,60 – 20,00 s", "images": "528 – 599",
        "mesures": "mesure 11, troisième temps, à mesure 12", "rendu": "logo à plat",
        "planches": [("signature", "Image 560 : le logo seul")],
        "champs": [
            ("Composition", "Le logo source, au pixel près, seul. Aucune phrase de signature. "
                            "En marge : STUDIO CRÉATIF · IDENTITÉ · MOTION · 3D · PUBLICITÉ."),
            ("Caméra", "Fixe."),
            ("Matériaux", "L'encre de la bande, encore humide, devient mate en une seconde et demie."),
            ("Lumière", "Uniforme ; un dernier reflet glisse sur la bande."),
            ("Mouvement", "Image 528 : le réticule verrouille. Images 588 à 593 : les annotations de marge reviennent à leur "
                          "état de départ. Les six dernières images sont identiques à l'image 0."),
            ("Simulation", "Séchage : la brillance de l'encre décroît avec le temps."),
            ("Transformation", "Retour exact à l'état initial : la boucle est fermée."),
            ("Son", "Déclic final à deux notes et accord bref ; second appui à l'image 540 ; queue d'accord et grain de bande."),
            ("Raccord", "Boucle : l'image 599 précède l'image 0 sans saut."),
        ],
    },
]

SYNCHRO = [
    ("12", "0,40 s", "La bande s'arrache", "Déchirure, déclic inversé"),
    ("24", "0,80 s", "Premier caractère du roulement", "Entrée du rythme, premier clic"),
    ("72", "2,40 s", "Tentative 1 sur la dalle", "Déclic, premier temps de la mesure 2"),
    ("96", "3,20 s", "Le réticule décroche", "Glissement désaccordé"),
    ("168", "5,60 s", "Tentative 2 sur le filet", "Déclic"),
    ("210", "7,00 s", "Les grains touchent le fond du verre", "Silence d'une croche"),
    ("216", "7,20 s", "Changement de lumière, citron", "Premier temps de la mesure 5"),
    ("312", "10,40 s", "La paille se cale", "Accord ouvert"),
    ("318", "10,60 s", "Tentative 3 : verrouillage tenu", "Déclic tenu"),
    ("453", "15,10 s", "Dernier instant avant le déferlement", "Silence d'une double-croche"),
    ("456", "15,20 s", "Débordement dans les marges", "Plein contrôlé"),
    ("504", "16,80 s", "La raclette entre", "Retrait, frottement seul"),
    ("528", "17,60 s", "Verrouillage final sur le logo", "Déclic à deux notes, accord"),
    ("540", "18,00 s", "L'encre de la bande commence à sécher", "Second appui"),
]

ARCHITECTURE = [
    ("3D calculée", [
        ("Papier, déchirure, lettres en volume", "Blender, simulation de tissu, rendu par lancer de rayons"),
        ("Dalle, grains, déferlement", "Notre solveur de particules sur GPU, rendu en points natifs"),
        ("Verre, glace, paille, citron, menthe", "Modélisation procédurale dans Blender, corps rigides"),
        ("Liquide", "Solveur de liquide de Blender, calculé sur notre machine"),
    ]),
    ("Calculé par programmation", [
        ("Points et champs de vecteurs", "Moteur de points maison"),
        ("Film d'encre et raclette", "Solveur de couche mince à deux dimensions"),
        ("Roulement typographique", "Contours de polices libres, police variable pour le roulement n° 4"),
        ("Réticule, traits de coupe, annotations", "Tracé vectoriel piloté par la partition"),
        ("Musique et bruitages", "Synthèse par code à 48 kHz ; les chocs et débits viennent des simulations"),
    ]),
    ("Généré par IA, et signalé comme tel", [
        ("Textures de menthe et de pulpe de citron vert", "Image Higgsfield, 0,25 crédit l'une"),
        ("Bruitages réalistes, seulement si la synthèse ne suffit pas", "Audio Higgsfield, 1,25 crédit les 5 secondes"),
        ("Vidéo", "Aucune"),
    ]),
    ("Composité", [
        ("Feuille d'épreuve, réticule, annotations, grain, étalonnage", "Python"),
        ("Signature", "Logo source incrusté sans retouche"),
    ]),
    ("Monté", [
        ("Plan-séquence unique, encodage", "FFmpeg"),
    ]),
]

PALETTE = [
    ("Noir", "#0A0A09", "feuille, fonds"), ("Crème", "#EEDFD2", "lettres, papier, annotations"),
    ("Orange", "#EA470F", "la matière"), ("Orange clair", "#F65726", "hautes lumières"),
    ("Gris chaud foncé", "#4C352D", "ombres de la photo"), ("Gris chaud moyen", "#8A7E74", "demi-tons"),
    ("Gris chaud clair", "#B4A79C", "lumières de la photo"),
]

CARACTERES = [
    ("archivo-var", "Archivo large noir", "le plus proche du lettrage du logo"),
    ("anton", "Anton", "atelier d'impression : arrêt du roulement n° 2"),
    ("permanent-marker", "Permanent Marker", "le geste à la main"),
    ("saira-stencil-one", "Saira Stencil One", "le pochoir industriel"),
    ("doto-var", "Doto", "espace de données : arrêt du roulement n° 4"),
    ("major-mono-display", "Major Mono Display", "pleins et déliés alternés"),
    ("instrument-serif-italic", "Instrument Serif italique", "le bar : arrêt du roulement n° 3"),
    ("bodoni-moda-var", "Bodoni Moda noir", "papier éditorial : arrêt du roulement n° 1"),
]
CARACTERE_ANNOTATIONS = ("ibm-plex-mono-400", "IBM Plex Mono", "annotations des marges")

REGLES = [
    "L'action tient dans la zone sûre de 888 × 1170 pixels, à l'écart de l'interface des plateformes.",
    "Le réticule vit dans l'écran, pas dans la scène : centré, ou verrouillé sur une forme ronde.",
    "Les grands gestes sont verticaux, du haut vers le bas : bande, filet de grains, versement, paille, raclette.",
    "Un seul héros par plan.",
    "L'orange suit une courbe : un cinquième de l'image au départ, dispersé ensuite, une touche d'ambre dans le verre, "
    "toute l'image au débordement, un cinquième à la fin.",
    "Le vert n'existe que dans le verre.",
]

LUMIERE = [
    ("Mat (papier, grains)", "Une source rasante, un remplissage large, fond noir. Matières sèches : fibres, pigment, plâtre. Rien ne brille."),
    ("Brillant (mojito)", "Contre-jour orange, source douce au-dessus, cartons noirs. Verre à l'indice 1,5, glace 1,31, "
                          "liquide 1,33 avec absorption ambrée."),
    ("Données (points)", "Aucune source. Points additionnés, profondeur de champ, brume."),
]

REFERENCES = [
    "Stomakhin et al., 2013, A material point method for snow simulation : la méthode des grains.",
    "Klár et al., 2016, Drucker-Prager elastoplasticity for sand animation : le comportement du sable.",
    "Hu et al., 2018, A moving least squares material point method : la variante utilisée sur GPU.",
    "Zhu et Bridson, 2005, Animating sand as a fluid : la méthode du liquide.",
    "Bridson et al., 2007, Curl-noise for procedural fluid flow : le champ des points.",
    "van den Doel, 2005, Physically based models for liquid sounds : la synthèse des bulles.",
]

PLAN = [
    ("Fait", "Environnement de production, test GPU, kit typographique, décomposition du logo", "8,63"),
    ("1", "Animatique de 20 secondes et maquette sonore, pour valider le rythme", "0"),
    ("2", "Moteur de la feuille : fenêtre, marges, réticule, annotations pilotés par la partition", "0"),
    ("3", "Séquences 0 et 1 : papier, déchirure, roulement, rendus sur notre machine", "0"),
    ("4", "Grains : solveur et essais en basse définition sur notre machine", "0"),
    ("5", "Mojito : modèle, lumière, textures générées, image de référence", "4"),
    ("6", "Liquide : simulation sur notre machine avec la version officielle de Blender", "0"),
    ("7", "Points, film d'encre, raclette", "0"),
    ("8", "Session GPU A : simulations finales des grains, images de référence en qualité finale", "36"),
    ("9", "Votre validation des images de référence", "—"),
    ("10", "Session GPU B : rendu final des 600 images", "102"),
    ("11", "Musique et bruitages définitifs, mixage", "0 à 10"),
    ("12", "Assemblage et contrôle qualité", "0"),
    ("13", "Session GPU C : corrections", "24"),
    ("14", "Livraison : fichier maître, fichier de diffusion, image de couverture", "0"),
]

VALIDATIONS = [
    "Durée : 600 images exactement, vérifiées sur le fichier final.",
    "Synchronisation : chaque événement de la partition contrôlé à une image près, contre les attaques mesurées dans le son.",
    "Boucle : différence nulle entre les six dernières images et l'image 0.",
    "Logo : comparaison pixel à pixel de la signature avec le fichier source.",
    "Stabilité : mesure du scintillement d'une image à l'autre sur chaque séquence.",
    "Son : niveau moyen de −14 LUFS, crêtes sous −1 dB, écoute simulée sur haut-parleur de téléphone.",
    "Deux relectures critiques : celle du directeur technique, celle du client potentiel.",
]

RESTE_A_PROUVER = [
    "Le photoréalisme du mojito : il sera jugé sur une image de référence avant tout rendu final.",
    "La tenue du solveur de grains entre 5 et 8 millions de particules.",
    "Le liquide en haute résolution sur notre machine. Il faudra autoriser le téléchargement de la version "
    "officielle de Blender (une fenêtre de validation).",
    "La déchirure du papier en très gros plan.",
]

KATANA = [
    ("Décision", "Katana n'est pas retenu pour fabriquer le film."),
    ("Pourquoi", "C'est un outil de remix : il analyse une vidéo de référence, génère de nouvelles scènes avec un modèle "
                 "vidéo et les monte. Il ne calcule aucune simulation, ne garantit ni la géométrie ni le logo, et son "
                 "déroulement n'attend pas votre accord avant de dépenser."),
    ("Usage possible après livraison", "Décliner le film fini en formats courts de 6 à 10 secondes, avec notre film comme "
                                       "source, notre bande-son comme enregistrement fourni, et un plafond de crédits fixé d'avance."),
    ("Animatique", "Nous la construisons nous-mêmes, à partir de la partition. Elle sert à valider le rythme, pas à nourrir Katana."),
]

TEXTES = [
    ("Dans l'image, avant la signature", "OFFGRIDZ, seul mot du film"),
    ("Signature", "Le logo seul, sans phrase (ligne retirée à la demande du client)"),
    ("En marge, à la signature", "STUDIO CRÉATIF · IDENTITÉ · MOTION · 3D · PUBLICITÉ"),
    ("Annotations de marge", "ÉPREUVE N° 01 · REPÉRAGE : OK / PERDU · CIBLE : BANDE / FLUX / VERRE · "
                             "ÉTAT : SOLIDE / GRANULAIRE / LIQUIDE / LUMIÈRE · N = nombre de particules · FOND PERDU · BON À TIRER"),
    ("Voix", "Aucune"),
]
