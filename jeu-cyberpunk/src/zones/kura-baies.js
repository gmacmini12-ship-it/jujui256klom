import * as THREE from 'three';

// Kura : les baies de calcul et les sols (bible §5.6), en InstancedMesh et en shaders émissifs.
//
// - `materielBaies(opts)` : ShaderMaterial des baies. Corps sombre ; face avant et dessus parsemés de diodes
//   qui clignotent en VAGUES (une houle `sin(distance·k − t·vitesse)` qui traverse les rangées) ; au loin le
//   détail s'efface en une luminosité moyenne qui suit la houle. Aucune lumière dynamique. Le brouillard est celui de
//   la scène (FogExp2) ; les diodes ne s'y perdent qu'à 40 % de sa densité (elles scintillent dans la brume).
// - `champDeBaies(...)` : des rangées de baies en blocs d'InstancedMesh (visibilité par bloc, bornée en distance).
// - `solSombre(...)`, `solBassin(...)` : sols en shader (reflet de bandes de plafond, sillons de lumière, liquide).
//
// Les valeurs de couleur sont linéaires (THREE.Color) : le rendu passe par OutputPass.

export const TEMPS = { value: 0 }; // temps partagé de tous les shaders de la zone (mis à jour par kura.js)

const FOG_UNIFORMS = THREE.UniformsLib.fog;
/** UniformsUtils.merge clone les uniformes : on rattache le temps partagé après coup. */
const lier = (m) => { m.uniforms.uT = TEMPS; return m; };

/** Partie commune des GLSL : hachage, houle, brouillard à deux densités. */
const COMMUN = /* glsl */ `
  uniform float uT;
  uniform vec3 fogColor;
  uniform float fogDensity;
  float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float h11(float n) { return fract(sin(n * 127.1) * 43758.5453); }
  float brume(float d, float k) { float a = fogDensity * k * d; return 1.0 - exp(-a * a); }
`;

// ---------------------------------------------------------------------------------------- baies
export function materielBaies({
  corps = [0.012, 0.018, 0.045],
  couleurA = new THREE.Color(0x1a4cff),   // diode au repos
  couleurB = new THREE.Color(0x8fe4ff),   // crête de la houle
  direction = [0, -1],                     // sens de propagation dans le plan (x, z) : la houle s'éloigne
  k = 0.045,                               // nombre d'onde (rad/m)
  vitesse = 1.1,                           // rad/s
  force = 1,
  haut = 7,                                // hauteur de la baie
  rapide = 0,                              // 0..1 : clignotement individuel plus vif (hot aisle)
} = {}) {
  return lier(new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([FOG_UNIFORMS, {
      uT: TEMPS,
      uCorps: { value: new THREE.Vector3(...corps) },
      uA: { value: couleurA },
      uB: { value: couleurB },
      uDir: { value: new THREE.Vector2(direction[0], direction[1]).normalize() },
      uK: { value: k },
      uS: { value: vitesse },
      uForce: { value: force },
      uHaut: { value: haut },
      uRapide: { value: rapide },
    }]),
    vertexShader: /* glsl */ `
      varying vec3 vLoc; varying vec3 vNor; varying vec3 vWld; varying vec3 vCtr; varying float vDist; varying vec3 vNW;
      void main() {
        mat4 M = modelMatrix * instanceMatrix;
        vec4 wp = M * vec4(position, 1.0);
        vWld = wp.xyz;
        vCtr = (M * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vLoc = position; vNor = normal;
        vNW = normalize(mat3(M) * normal);
        vec4 mv = viewMatrix * wp;
        vDist = length(mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      ${COMMUN}
      uniform vec3 uCorps; uniform vec3 uA; uniform vec3 uB; uniform vec2 uDir;
      uniform float uK; uniform float uS; uniform float uForce; uniform float uHaut; uniform float uRapide;
      varying vec3 vLoc; varying vec3 vNor; varying vec3 vWld; varying vec3 vCtr; varying float vDist; varying vec3 vNW;

      float houle(vec3 p) {
        float ph = dot(p.xz, uDir) * uK - uT * uS + 0.9 * sin(p.x * 0.017 + p.z * 0.011);
        return pow(0.5 + 0.5 * sin(ph), 4.0);
      }
      void main() {
        float w = houle(vCtr);
        float proche = 1.0 - smoothstep(55.0, 150.0, vDist);   // détail des diodes seulement de près
        vec3 body = uCorps * (0.55 + 0.45 * vNW.y) * (0.8 + 0.4 * h21(vCtr.xz * 0.37));
        float glow = 0.0;
        float mean = 0.0;
        if (vNor.z > 0.5) {
          // face avant : lames de 0,3 m, huit colonnes ; une diode par case
          vec2 cell = vec2((vLoc.x + 0.75) / 0.1875, vLoc.y / 0.3);
          vec2 id = floor(cell), f = fract(cell);
          float r = h21(id + vCtr.xz * 0.731);
          float r2 = h21(id * 1.7 + vCtr.xz * 0.37 + 3.1);
          float dio = step(abs(f.x - 0.5), 0.2) * step(abs(f.y - 0.5), 0.13);
          float blink = step(0.5, fract(r * 9.0 + uT * (0.15 + 0.5 * r2 * (0.4 + uRapide))));
          float on = mix(0.18 + 0.22 * r, 0.25 + blink * 0.75, step(0.35, r2));
          float vague = w * (0.35 + 0.65 * step(0.3, r)) * 1.25;
          glow = dio * (on * 0.3 + vague) * proche;
          mean = 0.10 + w * 0.65;
          // lames : liserés plus clairs entre les tiroirs
          float lame = step(0.94, fract(vLoc.y / 2.4));
          body += vec3(0.02, 0.03, 0.07) * lame + vec3(0.012, 0.016, 0.03) * step(0.9, f.x);
        } else if (vNor.y > 0.5) {
          // dessus : grille de 12 x 8 cases, grilles d'aération qui scintillent avec la houle
          vec2 cell = vec2((vLoc.x + 0.75) / 0.125, (vLoc.z + 0.6) / 0.15);
          vec2 id = floor(cell), f = fract(cell);
          float r = h21(id + vCtr.xz * 0.53);
          float dio = step(abs(f.x - 0.5), 0.3) * step(abs(f.y - 0.5), 0.3);
          float blink = step(0.55, fract(r * 11.0 + uT * (0.2 + 0.4 * r)));
          glow = dio * (0.12 * blink + w * (0.3 + 0.9 * step(0.4, r))) * proche * 0.9;
          mean = 0.06 + w * 0.5;
        } else {
          // flancs et dos : un filet de lumière à mi-hauteur de chaque tiroir, très faible
          float li = step(0.96, fract(vLoc.y / 0.6));
          glow = li * 0.05 * proche * (0.3 + w * 0.7);
          mean = 0.025 + w * 0.12 * step(0.5, vNW.y + 0.5);
        }
        float g = glow + mean * (1.0 - proche) * 0.55;
        g *= uForce;
        vec3 em = uA * g * 2.4 + uB * pow(g, 2.2) * 2.8;
        float f1 = brume(vDist, 1.0);
        float f2 = brume(vDist, 0.4);
        vec3 col = mix(body + em * 0.04, fogColor, f1) + em * (1.0 - f2);
        gl_FragColor = vec4(col, 1.0);
      }`,
  }));
}

/**
 * Un champ de baies : `rangees` rangées parallèles à l'axe x, de `n` baies chacune.
 * Chaque baie est une boîte (1,5 × haut × 1,2) dont la face avant regarde `avant` (+1 : +z, −1 : −z).
 * Les rangées sont découpées en blocs d'InstancedMesh (nbBlocsX × nbBlocsZ) pour la visibilité.
 * Renvoie { groupe, blocs, instances, maj(camPos) }.
 */
export function champDeBaies({
  materiel, x0, x1, zPremiere, pasZ, rangees, haut = 7, y0 = 0, avant = 1, blocsX = 2, rangeesParBloc = 12,
  portee = 480, largeur = 1.5, profondeur = 1.2, trous = null,
}) {
  const groupe = new THREE.Group();
  const geo = new THREE.BoxGeometry(largeur, haut, profondeur);
  geo.translate(0, haut / 2, 0);
  const pasX = largeur + 0.02;
  const n = Math.floor((x1 - x0) / pasX);
  const blocs = [];
  const M = new THREE.Matrix4();
  const Q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), avant > 0 ? 0 : Math.PI);
  const S = new THREE.Vector3(1, 1, 1);
  const P = new THREE.Vector3();
  let total = 0;
  const parBlocX = Math.ceil(n / blocsX);
  for (let r0 = 0; r0 < rangees; r0 += rangeesParBloc) {
    for (let bx = 0; bx < blocsX; bx++) {
      const i0 = bx * parBlocX, i1 = Math.min(n, i0 + parBlocX);
      const r1 = Math.min(rangees, r0 + rangeesParBloc);
      const positions = [];
      for (let r = r0; r < r1; r++) {
        const z = zPremiere + r * pasZ;
        for (let i = i0; i < i1; i++) {
          const x = x0 + (i + 0.5) * pasX;
          if (trous && trous(x, z)) continue;
          positions.push(x, z);
        }
      }
      const cnt = positions.length / 2;
      if (!cnt) continue;
      const im = new THREE.InstancedMesh(geo, materiel, cnt);
      for (let j = 0; j < cnt; j++) {
        P.set(positions[j * 2], y0, positions[j * 2 + 1]);
        M.compose(P, Q, S);
        im.setMatrixAt(j, M);
      }
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.matrixAutoUpdate = false;
      im.updateMatrix();
      im.frustumCulled = true;
      groupe.add(im);
      blocs.push(im);
      total += cnt;
    }
  }
  const centre = new THREE.Vector3();
  return {
    groupe, blocs, instances: total,
    /** Masque les blocs trop loin de la caméra (le brouillard les a déjà effacés). */
    maj(camPos) {
      for (const b of blocs) {
        centre.copy(b.boundingSphere.center);
        b.visible = centre.distanceTo(camPos) - b.boundingSphere.radius < portee;
      }
    },
  };
}

// ---------------------------------------------------------------------------------------- sols
/**
 * Sol sombre « réfléchissant » : joints de dalles, reflet des bandes lumineuses du plafond (la réflexion du
 * rayon de vue est calculée dans le shader, pas de seconde passe) et reflet de Fresnel qui monte au loin.
 * `bandes` : { espX, espZ, largeur, hauteurPlafond } ; `teinte` : couleur du reflet.
 */
export function solSombre({ teinte = new THREE.Color(0x2a56ff), base = [0.006, 0.01, 0.026], plafond = 60, espX = 24, espZ = 70, largeur = 1.6, dalle = 4, force = 1 } = {}) {
  return lier(new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([FOG_UNIFORMS, {
      uT: TEMPS,
      uBase: { value: new THREE.Vector3(...base) },
      uTeinte: { value: teinte },
      uPlafond: { value: plafond },
      uBandes: { value: new THREE.Vector4(espX, espZ, largeur, dalle) },
      uForce: { value: force },
    }]),
    vertexShader: /* glsl */ `
      varying vec3 vWld; varying float vDist;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWld = wp.xyz;
        vec4 mv = viewMatrix * wp;
        vDist = length(mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      ${COMMUN}
      uniform vec3 uBase; uniform vec3 uTeinte; uniform float uPlafond; uniform vec4 uBandes; uniform float uForce;
      varying vec3 vWld; varying float vDist;
      void main() {
        vec3 v = vWld - cameraPosition;
        float h = max(cameraPosition.y - vWld.y, 0.4);           // hauteur de l'œil au-dessus du sol
        vec3 r = vec3(v.x, h, v.z);                              // rayon réfléchi (y inversé)
        float s = max(uPlafond - vWld.y, 1.0) / max(r.y, 0.001);
        vec3 q = vWld + r * min(s, 4000.0);
        // bandes du plafond : longues en z, espacées en x, et traverses
        float bx = abs(fract(q.x / uBandes.x) - 0.5) * uBandes.x;
        float bz = abs(fract(q.z / uBandes.y) - 0.5) * uBandes.y;
        float bande = (1.0 - smoothstep(uBandes.z * 0.5, uBandes.z * 0.5 + 1.2 * (1.0 + s * 0.01), bx)) * 0.9
                    + (1.0 - smoothstep(uBandes.z * 0.5, uBandes.z * 0.5 + 1.2 * (1.0 + s * 0.01), bz)) * 0.5;
        float fres = pow(1.0 - clamp(normalize(v).y * -1.0, 0.0, 1.0), 3.0);   // rasant : le reflet monte
        vec3 col = uBase;
        // joints des dalles
        vec2 d = abs(fract(vWld.xz / uBandes.w) - 0.5) * uBandes.w;
        float joint = 1.0 - smoothstep(0.0, 0.07 * (1.0 + vDist * 0.03), uBandes.w * 0.5 - max(d.x, d.y));
        col += vec3(0.01, 0.02, 0.05) * joint;
        col += uTeinte * bande * fres * 0.55 * uForce;
        col = mix(col, fogColor, brume(vDist, 1.0));
        gl_FragColor = vec4(col, 1.0);
      }`,
  }));
}

/**
 * Sol du champ de baies : sillons de lumière dans les allées entre les rangées (reflet des diodes), qui suivent
 * la houle ; rangées de `pasZ` à partir de `zPremiere`, avant des baies côté +z (la lumière tombe devant elles).
 */
export function solChamp({ zPremiere, pasZ, direction = [0, -1], k = 0.045, vitesse = 1.1, couleur = new THREE.Color(0x2a6bff) } = {}) {
  return lier(new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([FOG_UNIFORMS, {
      uT: TEMPS,
      uZ: { value: new THREE.Vector2(zPremiere, pasZ) },
      uDir: { value: new THREE.Vector2(direction[0], direction[1]).normalize() },
      uK: { value: k }, uS: { value: vitesse },
      uCol: { value: couleur },
    }]),
    vertexShader: /* glsl */ `
      varying vec3 vWld; varying float vDist;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWld = wp.xyz;
        vec4 mv = viewMatrix * wp;
        vDist = length(mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      ${COMMUN}
      uniform vec2 uZ; uniform vec2 uDir; uniform float uK; uniform float uS; uniform vec3 uCol;
      varying vec3 vWld; varying float vDist;
      void main() {
        float s = (vWld.z - uZ.x) / uZ.y;
        float rang = floor(s);
        float f = fract(s);                      // 0 : la baie ; 1 : la baie suivante
        // la baie de la rangée suivante (z plus négatif) éclaire l'allée devant elle : côté f proche de 0 vu de +z
        float devant = exp(-f * 4.2) * step(0.12, f);
        float ph = dot(vWld.xz, uDir) * uK - uT * uS + 0.9 * sin(vWld.x * 0.017 + vWld.z * 0.011);
        float w = pow(0.5 + 0.5 * sin(ph), 4.0);
        float proche = 1.0 - smoothstep(90.0, 260.0, vDist);
        float grain = 0.55 + 0.45 * step(0.35, h21(vec2(floor(vWld.x / 0.1875), rang)));
        float lum = devant * (0.07 + w * 0.7) * (0.5 + 0.5 * grain) * (0.35 + 0.65 * proche) + (0.015 + w * 0.05) * 0.5;
        vec3 col = vec3(0.004, 0.007, 0.018) + uCol * lum * 0.9;
        col = mix(col, fogColor, brume(vDist, 1.0));
        gl_FragColor = vec4(col, 1.0);
      }`,
  }));
}

/**
 * Bassin de liquide de refroidissement : surface sombre à ondes lentes et reflets froids (ou chauds).
 * Le motif est un jeu d'ondes dans le shader ; le liquide est plat à `y`.
 */
export function solBassin({ couleur = new THREE.Color(0x2fd6ff), profond = [0.004, 0.02, 0.03], chaud = 0 } = {}) {
  return lier(new THREE.ShaderMaterial({
    fog: true,
    transparent: false,
    uniforms: THREE.UniformsUtils.merge([FOG_UNIFORMS, {
      uT: TEMPS,
      uCol: { value: couleur },
      uProf: { value: new THREE.Vector3(...profond) },
      uChaud: { value: chaud },
    }]),
    vertexShader: /* glsl */ `
      varying vec3 vWld; varying float vDist;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWld = wp.xyz;
        vec4 mv = viewMatrix * wp;
        vDist = length(mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      ${COMMUN}
      uniform vec3 uCol; uniform vec3 uProf; uniform float uChaud;
      varying vec3 vWld; varying float vDist;
      void main() {
        vec2 p = vWld.xz;
        float a = sin(p.x * 0.9 + uT * 0.6) * sin(p.y * 0.7 - uT * 0.45)
                + 0.6 * sin(p.x * 2.1 - p.y * 1.3 + uT * 0.9)
                + 0.4 * sin(p.y * 3.3 + p.x * 0.8 - uT * 1.2);
        float crete = pow(0.5 + 0.5 * a / 2.0, 6.0);
        vec3 v = normalize(vWld - cameraPosition);
        float fres = pow(1.0 - clamp(-v.y, 0.0, 1.0), 3.0);
        vec3 col = uProf + uCol * (crete * 0.7 + fres * 0.35);
        col = mix(col, col * vec3(1.2, 0.8, 0.5) + vec3(0.08, 0.02, 0.0), uChaud);
        col = mix(col, fogColor, brume(vDist, 1.0));
        gl_FragColor = vec4(col, 1.0);
      }`,
  }));
}
