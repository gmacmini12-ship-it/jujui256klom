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
