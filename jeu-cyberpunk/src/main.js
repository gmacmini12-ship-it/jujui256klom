import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildCity, HALF } from './city.js';
import { createPlayer } from './player.js';
import { createRain, FilmShader, createAudio } from './effects.js';

const FOG = 0x0c0720;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(FOG);
scene.fog = new THREE.FogExp2(FOG, 0.0085);

const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 700);

const city = buildCity(scene);
const rain = createRain();
scene.add(rain.mesh);

const player = createPlayer(camera, renderer.domElement, city.colliders, HALF + 20);
camera.lookAt(30, 6, -200);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.75, 0.7, 0.32);
composer.addPass(bloom);
const film = new ShaderPass(FilmShader);
composer.addPass(film);
composer.addPass(new OutputPass());

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
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

// ---------- Boucle ----------
const timer = new THREE.Timer();
let t = 0;
renderer.setAnimationLoop(() => {
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.05);
  t += dt;
  if (player.controls.isLocked || window.__auto) player.update(dt);
  city.update(t);
  rain.update(t, camera);
  film.uniforms.time.value = t;
  composer.render();
});

// Accès pour les tests automatisés et le réglage depuis la console.
window.__game = { scene, camera, player, renderer, bloom, composer, city, rain };
