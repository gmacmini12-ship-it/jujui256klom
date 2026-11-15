import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { rng, windowTexture, signTexture, shopTexture, puddleTexture, skyTexture } from './textures.js';
import { SIGNS_H as SIGN_DATA_H, SIGNS_V as SIGN_DATA_V } from './data/signs.js';

export const BLOCKS = 9; // pâtés de maisons par côté
export const BLOCK = 44; // largeur d'un pâté (trottoir compris)
export const STREET = 16;
export const PITCH = BLOCK + STREET;
export const HALF = (BLOCKS * PITCH) / 2;

// Palette de la direction artistique : magenta, violet, bleu électrique.
const NEON = ['#ff2bd6', '#c44bff', '#3d6bff', '#8a5cff', '#ff5ad0', '#4aa8ff'];
const SIGNS_H = SIGN_DATA_H.map((s) => s.text);
const SIGNS_V = SIGN_DATA_V.map((s) => s.text);

const blockCenter = (i) => (i - (BLOCKS - 1) / 2) * PITCH;
export const streetCenter = (i) => blockCenter(i) + PITCH / 2;

// options.blocsReserves : [[i, j], …] pâtés laissés vides (trottoir seul, sans collider),
// pour qu'un autre module y construise autre chose (Hashira au centre : [4, 4]).
// Le tirage aléatoire est consommé à l'identique : le reste de la ville ne change pas.
export function buildCity(scene, options = {}) {
  const rand = rng(20771);
  const reserves = new Set((options.blocsReserves || []).map(([i, j]) => `${i},${j}`));
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const colliders = [];
  const animated = [];

  // ---------- Sol mouillé : miroir + chaussée semi-transparente par-dessus ----------
  const size = HALF * 2 + 120;
  const mirror = new Reflector(new THREE.PlaneGeometry(size, size), {
    textureWidth: 1024,
    textureHeight: 1024,
    color: 0x6a5c90,
    clipBias: 0.003,
  });
  mirror.rotation.x = -Math.PI / 2;
  scene.add(mirror);

  const puddles = puddleTexture(rand);
  puddles.repeat.set(size / 28, size / 28);
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({
      color: 0x0d0820,
      roughness: 0.55,
      metalness: 0.2,
      transparent: true,
      opacity: 0.97,
      alphaMap: puddles,
    })
  );
  road.rotation.x = -Math.PI / 2;
  road.position.y = 0.01;
  scene.add(road);

  // ---------- Bâtiments ----------
  const variants = [
    { tex: windowTexture(rand, ['#ff3fd8', '#ff7ae6', '#c44bff', '#ffd0f6'], 0.34), geos: [] },
    { tex: windowTexture(rand, ['#4a7dff', '#7aa6ff', '#9a6bff', '#dfe6ff'], 0.5), geos: [] },
    { tex: windowTexture(rand, ['#ff2bd6', '#7a5cff', '#3d6bff', '#b04bff'], 0.2), geos: [] },
  ];
  const sidewalkGeos = [];
  const buildings = [];

  for (let bi = 0; bi < BLOCKS; bi++) {
    for (let bj = 0; bj < BLOCKS; bj++) {
      const bx = blockCenter(bi);
      const bz = blockCenter(bj);
      const sw = new THREE.BoxGeometry(BLOCK, 0.3, BLOCK);
      sw.translate(bx, 0.15, bz);
      sidewalkGeos.push(sw);

      // Découpage du pâté : 1, 2 ou 4 immeubles.
      const zone = 38;
      const r = rand();
      const lots = [];
      if (r < 0.18) lots.push([0, 0, zone, zone]);
      else if (r < 0.45) lots.push([-zone / 4, 0, zone / 2, zone], [zone / 4, 0, zone / 2, zone]);
      else if (r < 0.7) lots.push([0, -zone / 4, zone, zone / 2], [0, zone / 4, zone, zone / 2]);
      else
        lots.push(
          [-zone / 4, -zone / 4, zone / 2, zone / 2],
          [zone / 4, -zone / 4, zone / 2, zone / 2],
          [-zone / 4, zone / 4, zone / 2, zone / 2],
          [zone / 4, zone / 4, zone / 2, zone / 2]
        );

      const centerDist = Math.hypot(bx, bz) / HALF;
      const reserve = reserves.has(`${bi},${bj}`);
      for (const [ox, oz, lw, ld] of lots) {
        const tower = rand() < 0.16;
        const h = tower ? 90 + rand() * 80 : 16 + rand() * 52 * (1.15 - centerDist * 0.4);
        const b = { x: bx + ox, z: bz + oz, w: lw, d: ld, h, bx, bz, reserve };
        buildings.push(b);
        if (!reserve) colliders.push({ minX: b.x - lw / 2, maxX: b.x + lw / 2, minZ: b.z - ld / 2, maxZ: b.z + ld / 2 });
        const variante = pick(variants);
        const geo = buildingGeometry(b, rand);
        if (!reserve) variante.geos.push(geo);
        // étage technique sur le toit
        if (rand() < 0.5) {
          const top = { x: b.x, z: b.z, w: lw * 0.5, d: ld * 0.5, h: 4 + rand() * 10 };
          const g = buildingGeometry(top, rand);
          g.translate(0, h, 0);
          const v2 = pick(variants);
          if (!reserve) v2.geos.push(g);
        }
      }
    }
  }

  for (const v of variants) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x130c2a,
      roughness: 0.55,
      metalness: 0.45,
      emissive: 0xffffff,
      emissiveMap: v.tex,
      emissiveIntensity: 1.15,
    });
    scene.add(new THREE.Mesh(mergeGeometries(v.geos), mat));
  }
  scene.add(
    new THREE.Mesh(
      mergeGeometries(sidewalkGeos),
      new THREE.MeshStandardMaterial({ color: 0x1c1436, roughness: 0.5, metalness: 0.3 })
    )
  );

  // ---------- Façades côté rue : vitrines, enseignes, hologrammes ----------
  const shops = [
    { tex: shopTexture(rand, 310, 250), geos: [] },
    { tex: shopTexture(rand, 235, 300), geos: [] },
    { tex: shopTexture(rand, 285, 215), geos: [] },
    { tex: shopTexture(rand, 265, 325), geos: [] },
  ];
  const signMats = new Map();
  const signMat = (text, color, vertical) => {
    const key = `${text}|${color}|${vertical}`;
    if (!signMats.has(key)) {
      signMats.set(
        key,
        new THREE.MeshBasicMaterial({
          map: signTexture(text, color, vertical),
          transparent: true,
          side: THREE.DoubleSide,
          toneMapped: false,
        })
      );
    }
    return signMats.get(key);
  };
  const unitPlane = new THREE.PlaneGeometry(1, 1);
  const signs = new THREE.Group();
  scene.add(signs);
  const holoSpots = [];
  const lightSpots = [];

  for (const b of buildings) {
    for (const f of streetFaces(b)) {
      const angle = Math.atan2(f.nx, f.nz);
      // vitrine
      const g = new THREE.PlaneGeometry(f.len, 3.4);
      const uv = g.attributes.uv;
      const reps = Math.max(1, Math.round(f.len / 8));
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * reps);
      g.rotateY(angle);
      g.translate(f.cx + f.nx * 0.06, 2.0, f.cz + f.nz * 0.06);
      const vitrine = pick(shops);
      if (!b.reserve) vitrine.geos.push(g);

      const tx = -f.nz; // tangente de la façade
      const tz = f.nx;
      // enseigne horizontale au-dessus des vitrines
      if (rand() < 0.6) {
        const color = pick(NEON);
        const w = Math.min(f.len - 2, 7 + rand() * 5);
        const m = new THREE.Mesh(unitPlane, signMat(pick(SIGNS_H), color, false));
        const t = (rand() - 0.5) * (f.len - w - 1);
        m.scale.set(w, w / 4, 1);
        m.position.set(f.cx + f.nx * 0.3 + tx * t, 5.2 + rand() * 1.5, f.cz + f.nz * 0.3 + tz * t);
        m.rotation.y = angle;
        if (!b.reserve) {
          signs.add(m);
          lightSpots.push({ x: m.position.x + f.nx * 3, z: m.position.z + f.nz * 3, color });
        }
      }
      // enseignes verticales en drapeau
      const count = rand() < 0.55 ? 1 + Math.floor(rand() * 2) : 0;
      for (let k = 0; k < count; k++) {
        const hgt = 5 + rand() * 4;
        if (b.h < hgt + 9) continue;
        const m = new THREE.Mesh(unitPlane, signMat(pick(SIGNS_V), pick(NEON), true));
        const t = (rand() - 0.5) * (f.len - 4);
        m.scale.set(hgt / 4, hgt, 1);
        m.position.set(f.cx + f.nx * 1.3 + tx * t, 7 + hgt / 2 + rand() * 6, f.cz + f.nz * 1.3 + tz * t);
        m.rotation.y = angle + Math.PI / 2;
        if (!b.reserve) signs.add(m);
      }
      if (b.h > 48 && f.len > 17 && !b.reserve) holoSpots.push({ f, angle, b });
    }
  }
  for (const s of shops) {
    scene.add(
      new THREE.Mesh(mergeGeometries(s.geos), new THREE.MeshBasicMaterial({ map: s.tex, toneMapped: false }))
    );
  }

  // Panneaux holographiques animés sur les grands immeubles.
  const holoGeo = new THREE.PlaneGeometry(15, 9);
  holoSpots
    .sort((a, b) => Math.hypot(a.f.cx, a.f.cz) - Math.hypot(b.f.cx, b.f.cz))
    .filter((_, i) => i % 2 === 0)
    .slice(0, 22)
    .forEach(({ f, angle, b }, i) => {
      const mat = holoMaterial(NEON[i % NEON.length], NEON[(i + 2) % NEON.length], i);
      const m = new THREE.Mesh(holoGeo, mat);
      m.position.set(f.cx + f.nx * 0.5, Math.min(b.h - 8, 22 + (i % 4) * 5), f.cz + f.nz * 0.5);
      m.rotation.y = angle;
      scene.add(m);
      animated.push((t) => (mat.uniforms.time.value = t));
    });

  // ---------- Lampadaires ----------
  const lampCount = BLOCKS * BLOCKS * 4;
  const poles = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.07, 0.11, 6, 6),
    new THREE.MeshStandardMaterial({ color: 0x14151c, roughness: 0.4, metalness: 0.8 }),
    lampCount
  );
  const bulbs = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.3, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xff9cf2, toneMapped: false }),
    lampCount
  );
  const dummy = new THREE.Object3D();
  let n = 0;
  for (let bi = 0; bi < BLOCKS; bi++) {
    for (let bj = 0; bj < BLOCKS; bj++) {
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        dummy.position.set(blockCenter(bi) + sx * 20.6, 3.3, blockCenter(bj) + sz * 20.6);
        dummy.updateMatrix();
        poles.setMatrixAt(n, dummy.matrix);
        dummy.position.y = 6.4;
        dummy.updateMatrix();
        bulbs.setMatrixAt(n, dummy.matrix);
        n++;
      }
    }
  }
  scene.add(poles, bulbs);

  // ---------- Marquage au sol ----------
  const dashes = [];
  for (let i = -1; i < BLOCKS; i++) {
    const c = streetCenter(i);
    for (let p = -HALF; p < HALF; p += 9) {
      dashes.push([c, p, 0], [p, c, Math.PI / 2]);
    }
  }
  const marks = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.25, 3.5),
    new THREE.MeshBasicMaterial({ color: 0x2a1c4a }),
    dashes.length
  );
  dashes.forEach(([x, z, rot], i) => {
    dummy.position.set(x, 0.03, z);
    dummy.rotation.set(-Math.PI / 2, 0, rot);
    dummy.updateMatrix();
    marks.setMatrixAt(i, dummy.matrix);
  });
  dummy.rotation.set(0, 0, 0);
  scene.add(marks);

  // ---------- Trafic aérien ----------
  const CARS = 70;
  const cars = new THREE.InstancedMesh(
    new THREE.BoxGeometry(3.4, 0.45, 1.3),
    new THREE.MeshBasicMaterial({ toneMapped: false }),
    CARS
  );
  const carColors = [0xff2bd6, 0x6f8cff, 0xe8d8ff, 0xc44bff, 0x3d6bff];
  const carData = [];
  const col = new THREE.Color();
  for (let i = 0; i < CARS; i++) {
    const alongX = rand() < 0.5;
    const dir = rand() < 0.5 ? 1 : -1;
    carData.push({
      alongX,
      lane: streetCenter(Math.floor(rand() * (BLOCKS - 1))) + dir * 3.5,
      y: 24 + rand() * 60,
      speed: dir * (14 + rand() * 26),
      phase: rand() * 1000,
    });
    cars.setColorAt(i, col.setHex(pick(carColors)));
  }
  cars.frustumCulled = false;
  scene.add(cars);
  const span = HALF * 2 + 80;
  animated.push((t) => {
    for (let i = 0; i < CARS; i++) {
      const c = carData[i];
      const p = ((((c.phase + t * c.speed) % span) + span) % span) - span / 2;
      dummy.position.set(c.alongX ? p : c.lane, c.y, c.alongX ? c.lane : p);
      dummy.rotation.y = c.alongX ? 0 : Math.PI / 2;
      dummy.updateMatrix();
      cars.setMatrixAt(i, dummy.matrix);
    }
    cars.instanceMatrix.needsUpdate = true;
  });

  // ---------- Lumières ----------
  scene.add(new THREE.HemisphereLight(0x6a3cff, 0x1a0838, 1.5));
  const moon = new THREE.DirectionalLight(0x9a6bff, 0.7);
  moon.position.set(-60, 120, 40);
  scene.add(moon);
  // Quelques lumières colorées près du point de départ, au pied des enseignes.
  lightSpots
    .sort((a, b) => Math.hypot(a.x - 30, a.z - 30) - Math.hypot(b.x - 30, b.z - 30))
    .filter((_, i) => i % 2 === 0)
    .slice(0, 12)
    .forEach((s) => {
      const l = new THREE.PointLight(s.color, 70, 46, 1.8);
      l.position.set(s.x, 6.5, s.z);
      scene.add(l);
    });

  // ---------- Ciel ----------
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(640, 32, 16),
    new THREE.MeshBasicMaterial({ map: skyTexture(rand), side: THREE.BackSide, fog: false, depthWrite: false })
  );
  sky.renderOrder = -1;
  scene.add(sky);

  return {
    colliders,
    mirror, // sol réfléchissant (coupé par le gestionnaire de zones selon l'ambiance)
    sky,
    update(t, camera) {
      if (camera) sky.position.copy(camera.position);
      animated.forEach((fn) => fn(t));
    },
  };
}

// Boîte dont les UV suivent les dimensions réelles : une fenêtre = 1,25 m x 2,2 m.
function buildingGeometry(b, rand) {
  const g = new THREE.BoxGeometry(b.w, b.h, b.d);
  const uv = g.attributes.uv;
  const ou = Math.floor(rand() * 32) / 32;
  const ov = Math.floor(rand() * 32) / 32;
  for (let face = 0; face < 6; face++) {
    for (let k = 0; k < 4; k++) {
      const i = face * 4 + k;
      if (face === 2 || face === 3) {
        uv.setXY(i, 0.002, 0.002); // toit et dessous : pas de fenêtres
      } else {
        const span = face < 2 ? b.d : b.w;
        const u = Math.round((uv.getX(i) * span) / 1.25) / 32;
        const v = Math.round((uv.getY(i) * b.h) / 2.2) / 32;
        uv.setXY(i, u + ou, v + ov);
      }
    }
  }
  g.translate(b.x, b.h / 2, b.z);
  return g;
}

// Faces d'un immeuble qui donnent sur une rue.
function streetFaces(b) {
  const edge = 19 - 3;
  const faces = [];
  if (b.x + b.w / 2 > b.bx + edge) faces.push({ nx: 1, nz: 0, cx: b.x + b.w / 2, cz: b.z, len: b.d });
  if (b.x - b.w / 2 < b.bx - edge) faces.push({ nx: -1, nz: 0, cx: b.x - b.w / 2, cz: b.z, len: b.d });
  if (b.z + b.d / 2 > b.bz + edge) faces.push({ nx: 0, nz: 1, cx: b.x, cz: b.z + b.d / 2, len: b.w });
  if (b.z - b.d / 2 < b.bz - edge) faces.push({ nx: 0, nz: -1, cx: b.x, cz: b.z - b.d / 2, len: b.w });
  return faces;
}

function holoMaterial(c1, c2, seed) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    uniforms: {
      time: { value: 0 },
      c1: { value: new THREE.Color(c1) },
      c2: { value: new THREE.Color(c2) },
      seed: { value: seed * 1.37 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float time; uniform float seed; uniform vec3 c1; uniform vec3 c2;
      varying vec2 vUv;
      void main() {
        float t = time + seed;
        vec2 p = (vUv - 0.5) * vec2(1.67, 1.0);
        float scan = 0.8 + 0.2 * sin(vUv.y * 260.0 + t * 8.0);
        float bands = smoothstep(0.45, 0.55, fract(vUv.y * 5.0 - t * 0.25 + 0.15 * sin(vUv.x * 5.0 + t)));
        float ring = smoothstep(0.035, 0.0, abs(length(p) - 0.3 - 0.03 * sin(t * 2.0)));
        float core = smoothstep(0.16, 0.0, abs(p.x)) * smoothstep(0.012, 0.0, abs(p.y - 0.1 * sin(t * 1.3 + p.x * 9.0)));
        float glitch = step(0.985, fract(sin(floor(t * 9.0) * 12.9898 + floor(vUv.y * 24.0) * 78.233) * 43758.5453));
        vec3 col = mix(c1, c2, vUv.y + 0.25 * sin(t + vUv.x * 6.0));
        float a = (0.16 + 0.3 * bands + 1.4 * ring + 1.6 * core + glitch * 0.8) * scan;
        vec2 e = smoothstep(0.0, 0.04, vUv) * smoothstep(0.0, 0.04, 1.0 - vUv);
        gl_FragColor = vec4(col * a * e.x * e.y, 1.0);
      }`,
  });
}
