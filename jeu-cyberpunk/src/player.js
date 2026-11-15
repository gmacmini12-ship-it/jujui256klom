import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

const EYE = 1.75;
const RADIUS = 0.6;

export function createPlayer(camera, dom, colliders, limit) {
  const controls = new PointerLockControls(camera, dom);
  const keys = new Set();
  const velocity = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const pos = new THREE.Vector3(30, 0, 30); // position des pieds
  let onGround = true;
  let bob = 0;

  // event.code désigne la touche physique : ZQSD sur AZERTY = WASD sur QWERTY.
  addEventListener('keydown', (e) => {
    keys.add(e.code);
    if (e.code === 'Space') e.preventDefault();
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());

  const blocked = (x, z) => {
    for (const c of colliders) {
      if (x > c.minX - RADIUS && x < c.maxX + RADIUS && z > c.minZ - RADIUS && z < c.maxZ + RADIUS) return true;
    }
    return Math.abs(x) > limit || Math.abs(z) > limit;
  };

  function update(dt) {
    const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    const s = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 11 : 5;

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

    if (onGround && keys.has('Space')) {
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
    camera.position.set(pos.x, pos.y + EYE + (onGround ? Math.sin(bob) * 0.045 : 0), pos.z);
  }

  camera.position.set(pos.x, EYE, pos.z);
  return { controls, update, position: pos };
}
