import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildCity, HALF } from './city.js';
import { createPlayer } from './player.js';
import { createRain, FilmShader, createAudio } from './effects.js';
import { createSmoking } from './smoking.js';

const FOG = 0x1a0c44;

// Rendu pixel art : l'image est calculée en basse résolution puis agrandie sans lissage.
// La touche P fait défiler les finesses (nombre de lignes de pixels).
const PIXEL_LINES = [480, 360, 720];
let pixelMode = 0;
const pixelRatio = () => Math.min(1, PIXEL_LINES[pixelMode] / innerHeight);

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(pixelRatio());
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.domElement.style.imageRendering = 'pixelated';
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(FOG);
scene.fog = new THREE.FogExp2(FOG, 0.0075);

const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 700);

const city = buildCity(scene);
const rain = createRain();
scene.add(rain.mesh);

const player = createPlayer(camera, renderer.domElement, city.colliders, HALF + 20);
camera.lookAt(30, 6, -200);
scene.add(camera); // nécessaire pour afficher ce qui est attaché à la caméra (main, cigarette)
const smoking = createSmoking(camera, scene);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.75, 0.7, 0.32);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const film = new ShaderPass(FilmShader); // après la sortie : travaille sur les couleurs affichées
composer.addPass(film);

// ---------- Interface ----------
const overlay = document.getElementById('overlay');
const audio = createAudio();
overlay.addEventListener('click', () => {
  audio.start();
  player.controls.lock();
});
player.controls.addEventListener('lock', () => overlay.classList.add('hidden'));
player.controls.addEventListener('unlock', () => overlay.classList.remove('hidden'));
addEventListener('keydown', (e) => {
  if (e.code === 'KeyM') audio.toggle();
  if (e.code === 'KeyF' && !e.repeat) smoking.trigger();
});

function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(pixelRatio());
  composer.setPixelRatio(pixelRatio());
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', resize);
addEventListener('keydown', (e) => {
  if (e.code === 'KeyP') {
    pixelMode = (pixelMode + 1) % PIXEL_LINES.length;
    resize();
  }
});

// ---------- Boucle ----------
const timer = new THREE.Timer();
let t = 0;
renderer.setAnimationLoop(() => {
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.05);
  t += dt;
  if (player.controls.isLocked || window.__auto) player.update(dt);
  city.update(t, camera);
  rain.update(t, camera);
  smoking.update(dt, t);
  film.uniforms.time.value = t;
  composer.render();
});

// Accès pour les tests automatisés et le réglage depuis la console.
window.__game = { scene, camera, player, renderer, bloom, composer, city, rain, smoking };
