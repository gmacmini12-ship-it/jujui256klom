import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

const EYE = 1.75;
const RADIUS = 0.6;

// Joueur : marche, course, saut, collisions 2D (boîtes au sol).
// Les touches viennent de input.js (event.code : ZQSD sur AZERTY = WASD).
// `bornes` : nombre (carré centré de demi-côté `bornes`) ou { minX, maxX, minZ, maxZ }.
export function createPlayer(camera, dom, colliders, bornes, input) {
  const controls = new PointerLockControls(camera, dom);
  const velocity = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const pos = new THREE.Vector3(30, 0, 30); // position des pieds
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  let onGround = true;
  let bob = 0;
  let limites = normaliser(bornes);

  function normaliser(b) {
    if (typeof b === 'number') return { minX: -b, maxX: b, minZ: -b, maxZ: b };
    return b || { minX: -Infinity, maxX: Infinity, minZ: -Infinity, maxZ: Infinity };
  }

  const down = (...codes) => codes.some((c) => input.isDown(c));

  const blocked = (x, z) => {
    for (const c of colliders) {
      if (x > c.minX - RADIUS && x < c.maxX + RADIUS && z > c.minZ - RADIUS && z < c.maxZ + RADIUS) return true;
    }
    return x < limites.minX || x > limites.maxX || z < limites.minZ || z > limites.maxZ;
  };

  function update(dt) {
    const f = (down('KeyW', 'ArrowUp') ? 1 : 0) - (down('KeyS', 'ArrowDown') ? 1 : 0);
    const s = (down('KeyD', 'ArrowRight') ? 1 : 0) - (down('KeyA', 'ArrowLeft') ? 1 : 0);
    const speed = down('ShiftLeft', 'ShiftRight') ? 11 : 5;

    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    right.crossVectors(forward, camera.up);

    const len = Math.hypot(f, s) || 1;
    const tx = ((forward.x * f + right.x * s) / len) * speed;
    const tz = ((forward.z * f + right.z * s) / len) * speed;
    const k = 1 - Math.exp(-dt * (onGround ? 12 : 3));
    velocity.x += (tx - velocity.x) * k;
    velocity.z += (tz - velocity.z) * k;

    const nx = pos.x + velocity.x * dt;
    if (!blocked(nx, pos.z)) pos.x = nx;
    else velocity.x = 0;
    const nz = pos.z + velocity.z * dt;
    if (!blocked(pos.x, nz)) pos.z = nz;
    else velocity.z = 0;

    if (onGround && down('Space')) {
      velocity.y = 6.5;
      onGround = false;
    }
    velocity.y -= 20 * dt;
    pos.y += velocity.y * dt;
    if (pos.y <= 0) {
      pos.y = 0;
      velocity.y = 0;
      onGround = true;
    }

    const moving = Math.hypot(velocity.x, velocity.z);
    if (onGround && moving > 0.5) bob += dt * moving * 1.6;
    placerCamera();
  }

  function placerCamera() {
    camera.position.set(pos.x, pos.y + EYE + (onGround ? Math.sin(bob) * 0.045 : 0), pos.z);
  }

  /** Remplace les colliders (tableau gardé par référence) et les bornes. */
  function setColliders(liste, b) {
    colliders = liste;
    limites = normaliser(b);
  }

  /** Place les pieds en (x, y, z) et arrête le mouvement. `yaw` (radians, 0 = regarde vers -z) optionnel. */
  function teleporter(x, y, z, yaw, pitch = 0) {
    pos.set(x, y, z);
    velocity.set(0, 0, 0);
    onGround = y <= 0;
    if (yaw !== undefined && yaw !== null) regarder(yaw, pitch);
    placerCamera();
  }

  /** Oriente la caméra : yaw autour de y (0 = vers -z, π/2 = vers -x), pitch vers le haut si positif. */
  function regarder(yaw, pitch = 0) {
    euler.set(pitch, yaw, 0, 'YXZ');
    camera.quaternion.setFromEuler(euler);
  }

  /** Orientation actuelle { yaw, pitch }. */
  function orientation() {
    euler.setFromQuaternion(camera.quaternion, 'YXZ');
    return { yaw: euler.y, pitch: euler.x };
  }

  placerCamera();
  return {
    controls,
    update,
    position: pos,
    velocity,
    get auSol() { return onGround; },
    setColliders,
    teleporter,
    regarder,
    orientation,
    bloque: blocked,
  };
}
