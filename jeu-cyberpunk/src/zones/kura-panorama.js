import * as THREE from 'three';
import { rng } from '../textures.js';

// Kura : le panorama de la ville derrière la baie vitrée de la salle de l'Interrupteur (bible §5.6, fin 5).
//
// Une ville de nuit en volume simple, à l'échelle de Hikari (9 × 9 pâtés de 60 m, tour Hashira au centre), en
// peu d'appels de dessin :
//   - immeubles : un InstancedMesh (≈ 720 boîtes), fenêtres émissives calculées dans le shader ;
//   - enseignes : un InstancedMesh de panneaux verticaux ;
//   - hologrammes : un InstancedMesh de colonnes translucides à balayage ;
//   - halos : un InstancedMesh de sprites additifs (lampadaires, places) ;
//   - Hashira : un fût à lignes de texte qui montent ; le sol (rues) ; un ciel.
//
// DIX QUARTIERS : les neuf carrés d'une grille 3 × 3 de la ville (indices 0..8, i + 3·j, i vers l'est de la ville,
// j vers le sud) et le dixième, « Hashira » (indice 9) : le pâté central, la tour et sa place.
// Chaque quartier a quatre intensités (0..1) réglées séparément, lues par les shaders (aucune lumière) :
//   enseignes, fenetres, hologrammes, halos.
//
// API : { quartiers: 10, regler(i, { enseignes, fenetres, hologrammes, halos }), tout(v), valeurs(i) }.
//   Éteindre à 0 : enseignes puis fenêtres puis hologrammes puis halos (c'est l'ordre de la bible, au gré de l'appelant).

export const QUARTIERS = 10;
const PAS = 60; // pitch d'un pâté
const NB = 9;
const HASHIRA = 9;
const H_TOUR = 330;

const bloc = (i) => (i - (NB - 1) / 2) * PAS;
/** Quartier d'un point de la ville (x, z centrés ; z vers le nord de la ville = −z de la scène). */
export function quartierDe(x, z) {
  const i = Math.min(NB - 1, Math.max(0, Math.round(x / PAS + (NB - 1) / 2)));
  const j = Math.min(NB - 1, Math.max(0, Math.round(z / PAS + (NB - 1) / 2)));
  if (i === 4 && j === 4) return HASHIRA;
  return Math.floor(i / 3) + 3 * Math.floor(j / 3);
}

const HAZE = ['uniform vec3 uHaze;', 'uniform float uHazeD;'].join('\n');

function communs() {
  const U = {
    uT: { value: 0 },
    uFen: { value: new Float32Array(QUARTIERS).fill(1) },
    uEns: { value: new Float32Array(QUARTIERS).fill(1) },
    uHol: { value: new Float32Array(QUARTIERS).fill(1) },
    uHal: { value: new Float32Array(QUARTIERS).fill(1) },
    uHaze: { value: new THREE.Color(0x1a0f3e) },
    uHazeD: { value: 0.0016 },
  };
  return U;
}

/** Construit le panorama. `echelle` : facteur de la ville (1 = taille réelle). Renvoie le groupe et l'API. */
export function creerPanorama({ echelle = 0.8, graine = 20771 } = {}) {
  const U = communs();
  const groupe = new THREE.Group();
  groupe.name = 'panorama-ville';
  const rand = rng(graine);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3();
  const E = new THREE.Euler();

  const shared = {
    uT: U.uT, uFen: U.uFen, uEns: U.uEns, uHol: U.uHol, uHal: U.uHal, uHaze: U.uHaze, uHazeD: U.uHazeD,
  };
  const brume = /* glsl */ `
    ${HAZE}
    vec3 voile(vec3 col, float d) { float a = uHazeD * d; return mix(col, uHaze, 1.0 - exp(-a * a)); }
  `;
  const hache = /* glsl */ `
    float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  `;

  // ---------------------------------------------------------------- immeubles
  const bat = []; // { x, z, w, d, h, q, seed }
  for (let i = 0; i < NB; i++) {
    for (let j = 0; j < NB; j++) {
      if (i === 4 && j === 4) continue;
      const cx = bloc(i), cz = bloc(j);
      const dc = Math.hypot(i - 4, j - 4);
      for (let a = 0; a < 3; a++) {
        for (let b = 0; b < 3; b++) {
          const x = cx + (a - 1) * 14.2, z = cz + (b - 1) * 14.2;
          const grand = rand() < 0.12 ? 1 : 0;
          const h = 10 + rand() * rand() * 70 * (1.4 - dc * 0.12) + grand * (40 + rand() * 90) * (1.1 - dc * 0.1);
          bat.push({ x, z, w: 11 + rand() * 2.4, d: 11 + rand() * 2.4, h: Math.max(8, h), q: quartierDe(x, z), seed: rand() });
        }
      }
    }
  }
  const geoBat = new THREE.BoxGeometry(1, 1, 1);
  geoBat.translate(0, 0.5, 0);
  const aQ = new Float32Array(bat.length), aS = new Float32Array(bat.length);
  const immeubles = new THREE.InstancedMesh(geoBat, new THREE.ShaderMaterial({
    uniforms: shared,
    vertexShader: /* glsl */ `
      attribute float aQ; attribute float aS;
      varying float vQ; varying float vS; varying vec3 vC; varying vec3 vN; varying float vD; varying vec3 vCt;
      void main() {
        vec4 cp = instanceMatrix * vec4(position, 1.0);
        vC = cp.xyz; vN = normal; vQ = aQ; vS = aS;
        vCt = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vec4 mv = viewMatrix * modelMatrix * cp;
        vD = length(mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uT; uniform float uFen[${QUARTIERS}];
      ${brume} ${hache}
      varying float vQ; varying float vS; varying vec3 vC; varying vec3 vN; varying float vD; varying vec3 vCt;
      void main() {
        float fen = uFen[int(vQ + 0.5)];
        vec3 col = vec3(0.012, 0.010, 0.028) * (0.6 + 0.4 * vN.y + 0.2 * vS);
        if (abs(vN.y) < 0.5) {
          float u = abs(vN.x) > 0.5 ? vC.z : vC.x;
          vec2 cell = vec2(u / 2.4, vC.y / 3.4);
          vec2 id = floor(cell), f = fract(cell);
          float r = h21(id + vCt.xz * 0.173 + vS * 17.0);
          float r2 = h21(id * 1.3 + vS * 5.0);
          float parc = 0.25 + 0.55 * vS;                        // part de fenêtres allumées de l'immeuble
          float fenetre = step(abs(f.x - 0.5), 0.3) * step(abs(f.y - 0.5), 0.3);
          float on = step(r, parc) * (0.55 + 0.45 * step(0.5, r2));
          float tremble = 0.85 + 0.15 * sin(uT * (0.4 + r * 2.0) + r * 40.0);
          vec3 tons = mix(vec3(1.0, 0.82, 0.52), mix(vec3(0.55, 0.85, 1.0), vec3(1.0, 0.45, 0.9), step(0.8, r2)), step(0.55, r));
          col += tons * fenetre * on * tremble * fen * 0.9;
          // petite frange de lumière de rue au pied des façades
          col += vec3(0.25, 0.12, 0.35) * 0.05 * smoothstep(14.0, 0.0, vC.y) * fen;
        } else if (vN.y > 0.5) {
          col += vec3(0.02, 0.012, 0.045);
        }
        gl_FragColor = vec4(voile(col, vD), 1.0);
      }`,
  }), bat.length);
  bat.forEach((b, k) => {
    M.compose(P.set(b.x, 0, b.z), Q.identity(), S.set(b.w, b.h, b.d));
    immeubles.setMatrixAt(k, M);
    aQ[k] = b.q; aS[k] = b.seed;
  });
  geoBat.setAttribute('aQ', new THREE.InstancedBufferAttribute(aQ, 1));
  geoBat.setAttribute('aS', new THREE.InstancedBufferAttribute(aS, 1));
  immeubles.instanceMatrix.needsUpdate = true;
  immeubles.frustumCulled = false;
  groupe.add(immeubles);

  // ---------------------------------------------------------------- enseignes (panneaux verticaux, plans)
  const ens = [];
  for (const b of bat) {
    if (b.h < 24 || rand() > 0.55) continue;
    const face = Math.floor(rand() * 4);
    const nx = [1, -1, 0, 0][face], nz = [0, 0, 1, -1][face];
    const hauteur = 4 + rand() * 11;
    ens.push({
      x: b.x + nx * (b.w / 2 + 0.2), z: b.z + nz * (b.d / 2 + 0.2),
      y: 6 + rand() * Math.max(2, b.h - hauteur - 6) + hauteur / 2,
      l: 1.6 + rand() * 3.4, h: hauteur, ry: Math.atan2(nx, nz), q: b.q, c: rand(), v: rand(),
    });
  }
  const geoEns = new THREE.PlaneGeometry(1, 1);
  const eQ = new Float32Array(ens.length), eC = new Float32Array(ens.length), eV = new Float32Array(ens.length);
  const enseignes = new THREE.InstancedMesh(geoEns, new THREE.ShaderMaterial({
    uniforms: shared,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute float eQ; attribute float eC; attribute float eV;
      varying float vQ; varying float vC; varying float vV; varying vec2 vUv; varying float vD;
      void main() {
        vQ = eQ; vC = eC; vV = eV; vUv = uv;
        vec4 mv = viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
        vD = length(mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uT; uniform float uEns[${QUARTIERS}];
      ${brume} ${hache}
      varying float vQ; varying float vC; varying float vV; varying vec2 vUv; varying float vD;
      void main() {
        float k = uEns[int(vQ + 0.5)];
        vec3 teinte = vC < 0.25 ? vec3(1.0, 0.18, 0.78) : vC < 0.5 ? vec3(0.25, 0.85, 1.0) : vC < 0.75 ? vec3(0.7, 0.35, 1.0) : vec3(1.0, 0.55, 0.2);
        float bord = step(0.08, vUv.x) * step(vUv.x, 0.92) * step(0.015, vUv.y) * step(vUv.y, 0.985);
        float lignes = 0.55 + 0.45 * step(0.5, h21(vec2(floor(vUv.y * 14.0), floor(vUv.x * 3.0) + vV * 9.0)));
        float scint = 0.8 + 0.2 * sin(uT * (1.0 + vV * 3.0) + vV * 30.0);
        vec3 col = teinte * (0.15 + 0.85 * lignes * bord) * k * scint * 1.35;
        gl_FragColor = vec4(voile(col, vD), 1.0);
      }`,
  }), ens.length);
  ens.forEach((e, k) => {
    M.compose(P.set(e.x, e.y, e.z), Q.setFromEuler(E.set(0, e.ry, 0)), S.set(e.l, e.h, 1));
    enseignes.setMatrixAt(k, M);
    eQ[k] = e.q; eC[k] = e.c; eV[k] = e.v;
  });
  geoEns.setAttribute('eQ', new THREE.InstancedBufferAttribute(eQ, 1));
  geoEns.setAttribute('eC', new THREE.InstancedBufferAttribute(eC, 1));
  geoEns.setAttribute('eV', new THREE.InstancedBufferAttribute(eV, 1));
  enseignes.instanceMatrix.needsUpdate = true;
  enseignes.frustumCulled = false;
  groupe.add(enseignes);

  // ---------------------------------------------------------------- hologrammes (colonnes à balayage, additives)
  const hol = [];
  for (let n = 0; n < 46; n++) {
    const i = Math.floor(rand() * NB), j = Math.floor(rand() * NB);
    if (i === 4 && j === 4) continue;
    const x = bloc(i) + (rand() - 0.5) * 30, z = bloc(j) + (rand() - 0.5) * 30;
    hol.push({ x, z, y: 30 + rand() * 50, r: 5 + rand() * 7, h: 24 + rand() * 40, q: quartierDe(x, z), c: rand() });
  }
  const geoHol = new THREE.CylinderGeometry(1, 0.55, 1, 10, 1, true);
  const hQ = new Float32Array(hol.length), hC = new Float32Array(hol.length);
  const hologrammes = new THREE.InstancedMesh(geoHol, new THREE.ShaderMaterial({
    uniforms: shared,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute float hQ; attribute float hC;
      varying float vQ; varying float vC; varying vec2 vUv; varying float vD; varying vec3 vN; varying vec3 vV;
      void main() {
        vQ = hQ; vC = hC; vUv = uv;
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        vec4 mv = viewMatrix * wp;
        vD = length(mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uT; uniform float uHol[${QUARTIERS}];
      ${brume}
      varying float vQ; varying float vC; varying vec2 vUv; varying float vD; varying vec3 vN; varying vec3 vV;
      void main() {
        float k = uHol[int(vQ + 0.5)];
        vec3 teinte = vC < 0.33 ? vec3(0.3, 0.9, 1.0) : vC < 0.66 ? vec3(1.0, 0.3, 0.85) : vec3(0.75, 0.5, 1.0);
        float balayage = 0.45 + 0.55 * step(0.5, fract(vUv.y * 22.0 - uT * (0.6 + vC)));
        float bord = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.5);
        float a = (0.08 + 0.5 * bord) * balayage * smoothstep(0.0, 0.2, vUv.y) * (1.0 - 0.6 * vUv.y) * k;
        gl_FragColor = vec4(voile(teinte * a * 2.2, vD) * step(0.001, k), a);
      }`,
  }), hol.length);
  hol.forEach((h, k) => {
    M.compose(P.set(h.x, h.y + h.h / 2, h.z), Q.identity(), S.set(h.r, h.h, h.r));
    hologrammes.setMatrixAt(k, M);
    hQ[k] = h.q; hC[k] = h.c;
  });
  geoHol.setAttribute('hQ', new THREE.InstancedBufferAttribute(hQ, 1));
  geoHol.setAttribute('hC', new THREE.InstancedBufferAttribute(hC, 1));
  hologrammes.instanceMatrix.needsUpdate = true;
  hologrammes.frustumCulled = false;
  hologrammes.renderOrder = 5;
  groupe.add(hologrammes);

  // ---------------------------------------------------------------- halos : lampadaires le long des rues + places
  const hal = [];
  for (let i = 0; i < NB; i++) {
    for (let j = 0; j < NB; j++) {
      const cx = bloc(i), cz = bloc(j);
      for (let n = 0; n < 5; n++) {
        const t = -20.5 + n * 10.25;
        for (const [dx, dz] of [[t, -22], [t, 22], [-22, t], [22, t]]) {
          if (rand() < 0.2) continue;
          const x = cx + dx, z = cz + dz;
          hal.push({ x, y: 5.2, z, s: 3.2 + rand() * 2.4, c: rand(), q: quartierDe(x, z) });
        }
      }
    }
  }
  // la place de Hashira : une couronne de grands halos
  for (let n = 0; n < 24; n++) {
    const a = (n / 24) * Math.PI * 2;
    hal.push({ x: Math.cos(a) * 34, y: 6, z: Math.sin(a) * 34, s: 9, c: 0.85, q: HASHIRA });
  }
  const geoHal = new THREE.PlaneGeometry(1, 1);
  const lQ = new Float32Array(hal.length), lC = new Float32Array(hal.length), lS = new Float32Array(hal.length), lP = new Float32Array(hal.length * 3);
  hal.forEach((h, k) => { lQ[k] = h.q; lC[k] = h.c; lS[k] = h.s; lP[k * 3] = h.x; lP[k * 3 + 1] = h.y; lP[k * 3 + 2] = h.z; });
  geoHal.setAttribute('lQ', new THREE.InstancedBufferAttribute(lQ, 1));
  geoHal.setAttribute('lC', new THREE.InstancedBufferAttribute(lC, 1));
  geoHal.setAttribute('lS', new THREE.InstancedBufferAttribute(lS, 1));
  geoHal.setAttribute('lP', new THREE.InstancedBufferAttribute(lP, 3));
  const halos = new THREE.InstancedMesh(geoHal, new THREE.ShaderMaterial({
    uniforms: shared,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float lQ; attribute float lC; attribute float lS; attribute vec3 lP;
      varying float vQ; varying float vC; varying vec2 vUv; varying float vD;
      void main() {
        vQ = lQ; vC = lC; vUv = uv;
        vec4 mv = viewMatrix * modelMatrix * vec4(lP, 1.0);
        vD = length(mv.xyz);
        mv.xy += position.xy * lS * ${echelle.toFixed(3)};
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uHal[${QUARTIERS}];
      ${brume}
      varying float vQ; varying float vC; varying vec2 vUv; varying float vD;
      void main() {
        float k = uHal[int(vQ + 0.5)];
        vec2 d = vUv - 0.5;
        float r = length(d) * 2.0;
        float g = pow(max(1.0 - r, 0.0), 2.2) + 0.5 * pow(max(1.0 - r * 3.0, 0.0), 2.0);
        vec3 teinte = vC < 0.45 ? vec3(1.0, 0.7, 0.4) : vC < 0.75 ? vec3(0.55, 0.8, 1.0) : vec3(1.0, 0.4, 0.9);
        gl_FragColor = vec4(voile(teinte * g * k * 1.1, vD), g * k);
      }`,
  }), hal.length);
  for (let k = 0; k < hal.length; k++) halos.setMatrixAt(k, M.identity());
  halos.instanceMatrix.needsUpdate = true;
  halos.frustumCulled = false;
  halos.renderOrder = 6;
  groupe.add(halos);

  // ---------------------------------------------------------------- Hashira : un fût de lignes qui montent
  const tour = new THREE.Mesh(new THREE.CylinderGeometry(9.5, 12, H_TOUR, 18, 1, false), new THREE.ShaderMaterial({
    uniforms: shared,
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vP; varying float vD;
      void main() {
        vUv = uv; vP = position;
        vec4 mv = viewMatrix * modelMatrix * vec4(position + vec3(0.0, ${(H_TOUR / 2).toFixed(1)}, 0.0), 1.0);
        vD = length(mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uT; uniform float uFen[${QUARTIERS}]; uniform float uEns[${QUARTIERS}];
      ${brume} ${hache}
      varying vec2 vUv; varying vec3 vP; varying float vD;
      void main() {
        float k = uFen[${HASHIRA}];
        float col = floor(vUv.x * 40.0);
        float v = vP.y + ${(H_TOUR / 2).toFixed(1)};
        float vit = 4.0 + 10.0 * h21(vec2(col, 3.0));
        float lig = fract((v - uT * vit) / 5.0);
        float txt = step(0.28, lig) * step(lig, 0.62) * step(0.35, h21(vec2(col, floor((v - uT * vit) / 5.0))));
        float f = abs(fract(vUv.x * 40.0) - 0.5);
        vec3 c = vec3(0.02, 0.01, 0.06) + vec3(0.55, 0.45, 1.0) * txt * step(f, 0.38) * k * 0.9;
        float couronne = smoothstep(${(H_TOUR - 14).toFixed(1)}, ${H_TOUR.toFixed(1)}, v);
        c += vec3(1.0, 0.5, 0.9) * couronne * uEns[${HASHIRA}] * 0.9;
        gl_FragColor = vec4(voile(c, vD), 1.0);
      }`,
  }));
  tour.position.y = H_TOUR / 2;
  groupe.add(tour);

  // ---------------------------------------------------------------- le sol : rues éclairées par leurs halos
  const sol = new THREE.Mesh(new THREE.PlaneGeometry(NB * PAS + 400, NB * PAS + 400), new THREE.ShaderMaterial({
    uniforms: shared,
    vertexShader: /* glsl */ `
      varying vec3 vW; varying float vD;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = (modelMatrix * vec4(position, 1.0)).xyz;
        vec4 mv = viewMatrix * wp;
        vD = length(mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uHal[${QUARTIERS}]; uniform mat4 uInv;
      ${brume} ${hache}
      varying vec3 vW; varying float vD;
      void main() {
        vec3 p = vW / ${echelle.toFixed(3)} - modelMatrix_origin();
        gl_FragColor = vec4(0.0);
      }`.replace('vec3 modelMatrix_origin()', ''),
  }));
  // (le sol est remplacé ci-dessous : version sans matrice inverse)
  sol.material.dispose();
  sol.material = new THREE.ShaderMaterial({
    uniforms: { ...shared, uE: { value: echelle }, uC: { value: new THREE.Vector3() } },
    vertexShader: /* glsl */ `
      varying vec3 vW; varying float vD;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        vec4 mv = viewMatrix * wp;
        vD = length(mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uHal[${QUARTIERS}]; uniform float uE; uniform vec3 uC;
      ${brume} ${hache}
      varying vec3 vW; varying float vD;
      void main() {
        vec2 p = (vW.xz - uC.xz) / uE;              // mètres de la ville
        vec2 cell = floor(p / ${PAS.toFixed(1)} + 4.5);
        vec2 f = (fract(p / ${PAS.toFixed(1)} + 0.5) - 0.5) * ${PAS.toFixed(1)};
        float rue = 1.0 - smoothstep(22.0, 23.2, max(abs(f.x), abs(f.y)));   // 1 dans le pâté, 0 dans la rue
        float rueLum = (1.0 - rue) * (0.6 + 0.4 * h21(floor(p / 4.0)));
        float i = clamp(floor(p.x / ${PAS.toFixed(1)} + 4.5), 0.0, 8.0), j = clamp(floor(p.y / ${PAS.toFixed(1)} + 4.5), 0.0, 8.0);
        int q = (i == 4.0 && j == 4.0) ? ${HASHIRA} : int(floor(i / 3.0) + 3.0 * floor(j / 3.0));
        float k = uHal[q];
        float dedans = step(abs(p.x), ${((NB * PAS) / 2).toFixed(1)}) * step(abs(p.y), ${((NB * PAS) / 2).toFixed(1)});
        vec3 col = vec3(0.004, 0.003, 0.012) + vec3(0.30, 0.14, 0.34) * rueLum * 0.10 * k * dedans;
        col += vec3(0.02, 0.012, 0.05) * rue * dedans * k;
        gl_FragColor = vec4(voile(col, vD), 1.0);
      }`,
  });
  sol.rotation.x = -Math.PI / 2;
  sol.position.y = -0.2;
  sol.name = 'panorama-sol';
  groupe.add(sol);

  // ---------------------------------------------------------------- ciel : dégradé violet, lueur de la ville à l'horizon
  const ciel = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 10), new THREE.ShaderMaterial({
    uniforms: shared,
    side: THREE.BackSide, depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() { vDir = normalize(position); gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uFen[${QUARTIERS}]; uniform float uHal[${QUARTIERS}]; uniform float uEns[${QUARTIERS}];
      ${hache}
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, -0.2, 1.0);
        float moy = 0.0;
        for (int i = 0; i < ${QUARTIERS}; i++) moy += (uFen[i] + uHal[i] + uEns[i]) / ${(QUARTIERS * 3).toFixed(1)};
        vec3 haut = vec3(0.010, 0.006, 0.030);
        vec3 bas = vec3(0.10, 0.045, 0.20) * (0.25 + 0.75 * moy);
        vec3 col = mix(bas, haut, pow(max(h, 0.0), 0.45));
        // étoiles très rares
        vec2 e = floor(vDir.xz / (abs(vDir.y) + 0.35) * 160.0);
        col += vec3(0.5, 0.55, 0.9) * step(0.9975, h21(e)) * smoothstep(0.1, 0.4, h);
        gl_FragColor = vec4(col, 1.0);
      }`,
  }));
  ciel.scale.setScalar(1250);
  ciel.renderOrder = -10;
  ciel.frustumCulled = false;
  ciel.name = 'panorama-ciel';
  groupe.add(ciel);

  // l'échelle s'applique à tout sauf au ciel (qui reste à grande taille) : on inverse pour lui
  groupe.scale.setScalar(echelle);
  ciel.scale.setScalar(1250 / echelle);

  // ---------------------------------------------------------------- API
  const tableaux = { enseignes: U.uEns.value, fenetres: U.uFen.value, hologrammes: U.uHol.value, halos: U.uHal.value };
  const bornes01 = (v) => Math.min(1, Math.max(0, +v));
  const api = {
    quartiers: QUARTIERS,
    groupe,
    /** Règle les quatre intensités (0..1) d'un quartier ; les clés absentes ne changent pas. */
    regler(i, valeurs = {}) {
      const n = Math.round(i);
      if (!(n >= 0 && n < QUARTIERS)) return false;
      for (const cle of Object.keys(tableaux)) {
        if (valeurs[cle] !== undefined && Number.isFinite(+valeurs[cle])) tableaux[cle][n] = bornes01(valeurs[cle]);
      }
      return true;
    },
    /** Règle d'un coup les quatre intensités de tous les quartiers. */
    tout(v) {
      const k = bornes01(v);
      for (const cle of Object.keys(tableaux)) tableaux[cle].fill(k);
    },
    /** Lecture : intensités d'un quartier. */
    valeurs(i) {
      return { enseignes: tableaux.enseignes[i], fenetres: tableaux.fenetres[i], hologrammes: tableaux.hologrammes[i], halos: tableaux.halos[i] };
    },
    /** Quartier d'un point de la ville (repère de la ville, mètres). */
    quartierDe,
    /** Appelé à chaque image (temps de jeu) et avec la position monde du groupe. */
    update(t) {
      U.uT.value = t;
      sol.material.uniforms.uC.value.copy(groupe.position);
      ciel.position.set(0, 0, 0);
    },
    comptes: { immeubles: bat.length, enseignes: ens.length, hologrammes: hol.length, halos: hal.length },
  };
  return api;
}
