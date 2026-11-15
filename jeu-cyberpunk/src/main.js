import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { jeu } from './game.js';
import { etat, charger, sauver, reinitialiser, demarrerSauvegardeAuto } from './state.js';
import { input } from './input.js';
import { createPlayer } from './player.js';
import { createRain, FilmShader, createAudio } from './effects.js';
import { createSmoking } from './smoking.js';
import { createHud } from './ui/hud.js';
import { createDialogue } from './ui/dialogue.js';
import { createFrise } from './ui/frise.js';
import { createOuverture } from './ui/ouverture.js';
import { createAccueil } from './ui/accueil.js';
import { createInteract } from './interact.js';
import { createZoneManager } from './zones/manager.js';
import { creerClinique } from './zones/clinique.js';
import { creerKasumi } from './zones/kasumi.js';
import { FRAGMENTS } from './data/fragments.js';
import { OUVERTURE } from './data/ouverture.js';
import { TITRES_ZONES } from './data/interface.js';
import './systems/index.js'; // enregistre les systèmes (voir docs/architecture.md)

// Paramètres d'URL : ?sanssouris (ou ?test) joue sans verrouiller la souris.
const params = new URLSearchParams(location.search);
jeu.sansSouris = params.has('sanssouris') || params.has('test');

// Rendu pixel art : l'image est calculée en basse résolution puis agrandie sans lissage.
// La touche P fait défiler les finesses (nombre de lignes de pixels).
const PIXEL_LINES = [480, 360, 720];
let pixelMode = 0;
const pixelRatio = () => Math.min(1, PIXEL_LINES[pixelMode] / innerHeight);

const renderer = new THREE.WebGLRenderer({
  antialias: false,
  powerPreference: 'high-performance',
  preserveDrawingBuffer: params.has('test'), // captures d'écran des tests
});
renderer.setPixelRatio(pixelRatio());
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.domElement.style.imageRendering = 'pixelated';
document.body.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 700);

const rain = createRain();

for (const code of ['KeyM', 'Semicolon', 'KeyP']) input.toujours.add(code);

const player = createPlayer(camera, renderer.domElement, [], 0, input);
// Les erreurs de verrouillage sont gérées plus bas (pas de message d'erreur en console).
document.removeEventListener('pointerlockerror', player.controls._onPointerlockError);

// La fumée et le mégot sont créés dans une scène d'attente puis suivent la zone courante.
const smoking = createSmoking(camera, new THREE.Scene());

const renderPass = new RenderPass(new THREE.Scene(), camera);
const composer = new EffectComposer(renderer);
composer.addPass(renderPass);
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.75, 0.7, 0.32);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const film = new ShaderPass(FilmShader); // après la sortie : travaille sur les couleurs affichées
composer.addPass(film);

const audio = createAudio();
const hud = createHud();

// ---------- Contexte partagé ----------
Object.assign(jeu, {
  renderer, composer, renderPass, bloom, film, camera, player, rain, smoking, audio, hud, input, etat, sauver,
});

const dialogue = createDialogue({
  etat,
  onOuvert: () => {
    jeu.suspendre('dialogue', { libererSouris: true });
    jeu.masquerMima('dialogue', true);
    jeu.emettre('dialogue:ouvert');
  },
  onFerme: () => {
    jeu.masquerMima('dialogue', false);
    jeu.reprendre('dialogue');
    jeu.emettre('dialogue:ferme');
  },
});
const frise = createFrise({
  fragments: FRAGMENTS,
  etat,
  onOuvert: () => {
    jeu.suspendre('frise', { libererSouris: true });
    jeu.masquerMima('frise', true);
    jeu.emettre('frise:ouverte');
  },
  onFerme: () => {
    jeu.masquerMima('frise', false);
    jeu.reprendre('frise');
    jeu.emettre('frise:fermee');
  },
});
const interact = createInteract({ camera, input, hud, jeu });
const zones = createZoneManager(jeu);
const ouverture = createOuverture(jeu, OUVERTURE);
Object.assign(jeu, { dialogue, frise, interact, zones, ouverture });

/** Ouvre un dialogue de data/dialogues.js. Renvoie la promesse de fin. */
jeu.ouvrirDialogue = (d) => dialogue.ouvrir(d);

/** Recopie la position du joueur dans `etat.position` (sauvegardée ensuite). */
jeu.memoriserPosition = () => {
  const p = player.position;
  const { yaw } = player.orientation();
  etat.position = { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), yaw: +yaw.toFixed(3) };
};

// ---------- Souris ----------
function demanderSouris() {
  if (jeu.sansSouris) {
    accueil.cacher();
    return;
  }
  try {
    const p = renderer.domElement.requestPointerLock();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch {
    /* refus : géré par pointerlockerror */
  }
}
jeu._reprendreSouris = demanderSouris;
document.addEventListener('pointerlockerror', () => {
  if (jeu.enPartie && jeu.suspensions.size === 0) accueil.montrer('souris');
});
player.controls.addEventListener('lock', () => accueil.cacher());
player.controls.addEventListener('unlock', () => {
  if (jeu._liberationVoulue) {
    jeu._liberationVoulue = false; // dialogue ou frise : pas d'écran de pause
    return;
  }
  if (jeu.enPartie) accueil.montrer('pause');
});

// ---------- Partie ----------
function jouer() {
  audio.start();
  if (!jeu.enPartie) {
    jeu.enPartie = true;
    const nouvelle = !etat.ouvertureVue;
    demanderSouris();
    jeu.emettre('partie:debut', { nouvelle });
    if (nouvelle) ouverture.lancer();
    else {
      const t = TITRES_ZONES[zones.nom];
      if (t) hud.titre(t.titre, t.sous);
    }
  } else {
    demanderSouris();
  }
}

function nouvellePartie() {
  if (dialogue.estOuvert) dialogue.fermer();
  if (frise.estOuvert) frise.fermer();
  reinitialiser();
  jeu.emettre('partie:nouvelle');
  hud.fondu(false, 0);
  zones.installer('clinique');
  jeu.enPartie = true;
  audio.start();
  demanderSouris();
  accueil.aUnePartie = true;
  ouverture.lancer();
}

const accueil = createAccueil({ input, surJouer: jouer, surNouvelle: nouvellePartie });
input.init().then(() => accueil.remplirCommandes());

// ---------- Cigarette ----------
function fumer() {
  const ev = jeu.emettre('cigarette:avant', { annule: false });
  if (ev.annule) return;
  const action = smoking.trigger();
  if (action) jeu.emettre(`cigarette:${action}`); // 'cigarette:allumage' | 'cigarette:bouffee'
}
let etatCigarette = smoking.etat;

// ---------- Redimensionnement ----------
function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(pixelRatio());
  composer.setPixelRatio(pixelRatio());
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', resize);

// ---------- Zones et démarrage ----------
jeu._preparerSystemes();
zones.enregistrer('clinique', creerClinique);
zones.enregistrer('kasumi', creerKasumi);

const sauvegarde = charger();
accueil.aUnePartie = sauvegarde && etat.ouvertureVue;
jeu._initSystemes();
if (etat.ouvertureVue && zones.connait(etat.zone)) {
  const p = etat.position;
  zones.installer(etat.zone, p ? { position: [p.x, p.y ?? 0, p.z], yaw: p.yaw ?? 0 } : undefined);
} else {
  zones.installer('clinique');
}
addEventListener('beforeunload', () => jeu.memoriserPosition());
demarrerSauvegardeAuto();

// ---------- Boucle ----------
let accPosition = 0;

/** Avance le jeu de `dt` secondes (sans rendre l'image). */
function step(dt) {
  jeu.t += dt;
  const t = jeu.t;

  if (input.pressed('KeyM') || input.pressed('Semicolon')) audio.toggle();
  if (input.pressed('KeyP')) {
    pixelMode = (pixelMode + 1) % PIXEL_LINES.length;
    resize();
  }

  if (jeu.jouable || window.__auto) player.update(dt);
  if (jeu.jouable) {
    if (input.pressed('KeyF')) fumer();
    if (input.pressed('KeyJ')) frise.ouvrir();
  }
  if (jeu.jouable) interact.update();
  else interact.masquer();

  if (!accueil.visible) ouverture.update(dt); // l'écran de pause fige l'ouverture
  zones.update(dt, t);
  if (zones.courante?.ambiance.pluie) rain.update(t, camera);
  smoking.update(dt, t);
  if (smoking.etat !== etatCigarette) {
    jeu.emettre('cigarette:etat', { de: etatCigarette, vers: smoking.etat });
    if (smoking.etat === 'discard') jeu.emettre('cigarette:jetee');
    etatCigarette = smoking.etat;
  }
  hud.update(dt);

  accPosition += dt;
  if (accPosition >= 0.5 && jeu.enPartie) {
    accPosition = 0;
    jeu.memoriserPosition();
  }

  jeu._updateSystemes(dt, t);
  film.uniforms.time.value = t;
  input.endFrame();
}

/** Dessine l'image courante. */
function rendre() {
  composer.render();
  jeu._apresRendu();
}

const timer = new THREE.Timer();
renderer.setAnimationLoop(() => {
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.05);
  step(dt);
  rendre();
});

// ---------- Accès pour les tests automatisés et la console ----------
// Sans carte graphique : arrêter la boucle (renderer.setAnimationLoop(null)),
// puis avancer avec step(), et capturer avec capture() dans le même appel.
window.__game = {
  jeu,
  get scene() { return jeu.scene; },
  get city() { return zones.construites.includes('kasumi') ? zones.get('kasumi').city : null; },
  camera, player, renderer, bloom, composer, rain, smoking, audio,
  etat, input, hud, dialogue, frise, interact, zones, ouverture, accueil,
  step(dt = 1 / 60, n = 1) {
    for (let i = 0; i < n; i++) step(dt);
  },
  rendre,
  /** Rend une image et la renvoie en data URL PNG. */
  capture() {
    rendre();
    return renderer.domElement.toDataURL('image/png');
  },
  /** Arrête la boucle d'animation (rendu logiciel lent). */
  arreter() {
    renderer.setAnimationLoop(null);
  },
  /**
   * Place le joueur dans la zone `zone` (installée sans fondu si besoin) en (x, z), orienté `yaw`.
   * `y` : hauteur des pieds (0 par défaut ; posé sur le sol s'il est juste dessous, sinon il tombe).
   */
  teleport(zone, x, z, yaw = 0, pitch = 0, y = 0) {
    if (zone && zone !== zones.nom) zones.installer(zone, { position: [x, y, z], yaw, pitch });
    else player.teleporter(x, y, z, yaw, pitch);
  },
  regarder: (yaw, pitch = 0) => player.regarder(yaw, pitch),
  /** Appuie sur une touche pendant une image (event.code), puis la relâche. */
  appuyer(code, dt = 1 / 60) {
    input._down(code);
    step(dt);
    input._up(code);
  },
  /** Maintient une touche pendant `secondes`, en avançant le jeu par pas de `dt`. */
  tenir(code, secondes, dt = 1 / 30) {
    input._down(code);
    for (let s = 0; s < secondes; s += dt) step(dt);
    input._up(code);
    step(dt);
  },
  jouer,
  nouvellePartie,
};
