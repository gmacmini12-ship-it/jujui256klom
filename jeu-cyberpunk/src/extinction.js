import * as THREE from 'three';

// Extinction de la ville et aube (fin 5 « Le Silence », bible §8 ; systems/silence.js la pilote).
//
// LA VILLE PILOTABLE PAR QUARTIERS ET PAR CATÉGORIES, sans recompiler un seul matériau pendant la séquence :
//   - dix quartiers, les mêmes que le panorama de Kura (zones/kura-panorama.js) : 0..8 = grille 3 × 3 de la ville
//     (i + 3·j, i vers +x, j vers +z), 9 = le pâté de Hashira ; `quartierDe(x, z)` les calcule ;
//   - quatre catégories : enseignes, fenetres, hologrammes, halos ; chaque niveau vaut 0..1 (1 = allumé) ;
//   - les niveaux sont des tableaux d'uniforms PARTAGÉS (`EXTINCTION[cat].value`, Float32Array(10)) : les
//     shaders lisent le quartier du fragment (position monde) et multiplient leur lumière ;
//   - `EXTINCTION.actif.value` (0 ou 1) : à 0, le code ajouté est sauté par une branche (rendu strictement inchangé).
//
// Deux façons de rendre un matériau éteignable :
//   eteignable(materiau, categorie, { mode, plancher })   injection (onBeforeCompile) dans un matériau standard de
//       three.js (Basic, Standard/Physical, Lambert, Phong, Sprite, Points) ; mode 'emissive' : seule la lumière
//       émise est atténuée (fenêtres) ; mode 'sortie' : la couleur finale (enseignes, lampes, halos additifs) ;
//       `plancher` : part qui reste à 0 (un tube éteint reste un objet sombre) ; `reflet` (mode 'emissive') : la vitre
//       éteinte renvoie `EXTINCTION.reflet` (le ciel de l'aube) au lieu de noir. À appeler AVANT la première
//       compilation (sinon `needsUpdate` recompile une fois).
//   eteignableGroupe(objet, { exclure })   parcourt un groupe et rend éteignable tout ce qui brille (catégorie
//       devinée : additif → halos, émissif → fenetres, Basic/Sprite sans tone mapping → enseignes). Les ShaderMaterial
//       sur mesure ne s'injectent pas : renvoyés dans `sur_mesure` (l'appelant décide : uniforms à la main, ou masqués).
//   Pour un ShaderMaterial écrit à la main : `uniformsExtinction(cat, q?)` + `GLSL_EXTINCTION` (voir city.js, hashira.js).
//
// L'AUBE : `AUBE` = uniforms partagés du dôme du ciel (city.js : `cielAube(materiau)`), nuls hors de la fin 5.

export const NB_QUARTIERS = 10;
const PAS = 60;
const NB = 9;
const HASHIRA = 9;
export const CATEGORIES = ['enseignes', 'fenetres', 'hologrammes', 'halos'];

/** Quartier d'un point de la ville (mêmes règles que le panorama de Kura). */
export function quartierDe(x, z) {
  const i = Math.min(NB - 1, Math.max(0, Math.floor(x / PAS + (NB - 1) / 2 + 0.5)));
  const j = Math.min(NB - 1, Math.max(0, Math.floor(z / PAS + (NB - 1) / 2 + 0.5)));
  if (i === 4 && j === 4) return HASHIRA;
  return Math.floor(i / 3) + 3 * Math.floor(j / 3);
}

export const EXTINCTION = {
  actif: { value: 0 },
  enseignes: { value: new Float32Array(NB_QUARTIERS).fill(1) },
  fenetres: { value: new Float32Array(NB_QUARTIERS).fill(1) },
  hologrammes: { value: new Float32Array(NB_QUARTIERS).fill(1) },
  halos: { value: new Float32Array(NB_QUARTIERS).fill(1) },
  // fenêtres éteintes à l'aube : elles renvoient un peu de ciel (couleur linéaire ; noir = vitres mortes)
  reflet: { value: new THREE.Color(0, 0, 0) },
};

/** Niveau (0..1) d'une catégorie au point (x, z) de la ville ; 1 quand rien n'est éteint (côté CPU : npc.js, lumières). */
export function niveau(categorie, x, z) {
  if (!EXTINCTION.actif.value) return 1;
  const t = EXTINCTION[categorie]?.value;
  return t ? t[quartierDe(x, z)] : 1;
}

/** Remet tout allumé (et l'injection en sommeil). */
export function rallumerTout() {
  for (const c of CATEGORIES) EXTINCTION[c].value.fill(1);
  EXTINCTION.reflet.value.setRGB(0, 0, 0);
  EXTINCTION.actif.value = 0;
}

// ------------------------------------------------------------------------------------------- GLSL commun
const GLSL_QUARTIER = /* glsl */ `
  int extQuartier(vec2 p) {
    float i = clamp(floor(p.x / ${PAS.toFixed(1)} + 4.5), 0.0, 8.0);
    float j = clamp(floor(p.y / ${PAS.toFixed(1)} + 4.5), 0.0, 8.0);
    return (i == 4.0 && j == 4.0) ? ${HASHIRA} : int(floor(i / 3.0) + 3.0 * floor(j / 3.0));
  }`;

/** Déclarations à placer dans un fragment shader écrit à la main (avec `uniformsExtinction`). */
export const GLSL_EXTINCTION = /* glsl */ `
  uniform float uExtActif; uniform float uExtNiv[${NB_QUARTIERS}]; uniform int uExtQ;
  ${GLSL_QUARTIER}
  // facteur 0..1 du quartier fixe uExtQ (ou de la position p si uExtQ < 0) ; n'appeler que si uExtActif > 0.5
  float extNiveau(vec2 p) { return uExtNiv[uExtQ >= 0 ? uExtQ : extQuartier(p)]; }`;

/** Uniforms d'un ShaderMaterial sur mesure : catégorie, quartier fixe `q` (−1 : calculé depuis la position). */
export function uniformsExtinction(categorie, q = -1) {
  return { uExtActif: EXTINCTION.actif, uExtNiv: EXTINCTION[categorie], uExtQ: { value: q } };
}

// ------------------------------------------------------------------------------------------- injection
const VERT_DECL = 'varying vec2 vExtXZ;';
const VERT_MESH = /* glsl */ `
  {
    vec4 extP = vec4( transformed, 1.0 );
    #ifdef USE_BATCHING
      extP = batchingMatrix * extP;
    #endif
    #ifdef USE_INSTANCING
      extP = instanceMatrix * extP;
    #endif
    vExtXZ = ( modelMatrix * extP ).xz;
  }`;
const VERT_SPRITE = 'vExtXZ = ( modelMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xz;';
const FRAG_DECL = /* glsl */ `
  varying vec2 vExtXZ;
  uniform float uExtActif; uniform float uExtNiv[${NB_QUARTIERS}]; uniform float uExtPlancher;
  ${GLSL_QUARTIER}
  float extFacteur() { return mix( uExtPlancher, 1.0, uExtNiv[ extQuartier( vExtXZ ) ] ); }`;

function injecter(sh, categorie, mode, plancher, reflet) {
  let v = sh.vertexShader;
  let f = sh.fragmentShader;
  if (!v.includes('#include <common>') || !f.includes('#include <common>')) return false;
  if (v.includes('#include <project_vertex>')) v = v.replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_MESH}`);
  else if (v.includes('#include <logdepthbuf_vertex>')) v = v.replace('#include <logdepthbuf_vertex>', `${VERT_SPRITE}\n#include <logdepthbuf_vertex>`);
  else return false;
  if (mode === 'emissive' && f.includes('#include <lights_fragment_begin>')) {
    // après tout ce qui s'ajoute à la lumière émise (marche.js, npc.js y ajoutent leurs termes)
    const code = reflet
      ? 'if ( uExtActif > 0.5 ) { float extF = extFacteur(); vec3 extE = totalEmissiveRadiance; totalEmissiveRadiance = extE * extF + uExtReflet * dot( extE, vec3( 0.3333 ) ) * ( 1.0 - extF ); }'
      : 'if ( uExtActif > 0.5 ) totalEmissiveRadiance *= extFacteur();';
    f = f.replace('#include <lights_fragment_begin>', `${code}\n#include <lights_fragment_begin>`);
  } else if (f.includes('#include <opaque_fragment>')) {
    f = f.replace('#include <opaque_fragment>', '#include <opaque_fragment>\nif ( uExtActif > 0.5 ) gl_FragColor.rgb *= extFacteur();');
  } else return false;
  v = v.replace('#include <common>', `#include <common>\n${VERT_DECL}`);
  f = f.replace('#include <common>', `#include <common>\n${FRAG_DECL}${reflet ? '\nuniform vec3 uExtReflet;' : ''}`);
  sh.vertexShader = v;
  sh.fragmentShader = f;
  sh.uniforms.uExtActif = EXTINCTION.actif;
  sh.uniforms.uExtNiv = EXTINCTION[categorie];
  sh.uniforms.uExtPlancher = { value: plancher };
  if (reflet) sh.uniforms.uExtReflet = EXTINCTION.reflet;
  return true;
}

/** Clé de programme actuelle d'un matériau (vide s'il n'a rien de particulier). */
function cleDe(materiau) {
  const proto = THREE.Material.prototype;
  const special = materiau.onBeforeCompile !== proto.onBeforeCompile || materiau.customProgramCacheKey !== proto.customProgramCacheKey;
  return special ? String(materiau.customProgramCacheKey()) : '';
}

/**
 * Rend un matériau éteignable (voir l'en-tête). Renvoie le matériau. Sans effet sur un ShaderMaterial, ou si
 * le matériau l'est déjà.
 */
export function eteignable(materiau, categorie, { mode = null, plancher = 0, reflet = false } = {}) {
  if (!materiau || materiau.isShaderMaterial || materiau.userData?.extinction) return materiau;
  if (!EXTINCTION[categorie] || categorie === 'actif') return materiau;
  const emissif = !!(materiau.isMeshStandardMaterial || materiau.isMeshLambertMaterial || materiau.isMeshPhongMaterial || materiau.isMeshToonMaterial);
  const m = mode || (emissif ? 'emissive' : 'sortie');
  const avant = materiau.onBeforeCompile;
  const aAvant = typeof avant === 'function' && avant !== THREE.Material.prototype.onBeforeCompile;
  const cle0 = cleDe(materiau); // évaluée AVANT de remplacer onBeforeCompile (la clé par défaut en est le texte)
  materiau.onBeforeCompile = function (sh, renderer) {
    if (aAvant) avant.call(this, sh, renderer);
    injecter(sh, categorie, m, plancher, reflet && m === 'emissive');
  };
  materiau.customProgramCacheKey = () => `${cle0}|ext:${m}${reflet ? ':reflet' : ''}`;
  materiau.userData.extinction = { categorie, mode: m, plancher, reflet };
  materiau.needsUpdate = true;
  return materiau;
}

/** Catégorie devinée d'un matériau qui brille (ou null). */
export function categorieDe(m) {
  if (!m || m.isShaderMaterial) return null;
  if (m.blending === THREE.AdditiveBlending) return { categorie: 'halos', mode: 'sortie', plancher: 0 };
  if ((m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial) && m.emissive && m.emissiveIntensity > 0
      && (m.emissive.r + m.emissive.g + m.emissive.b > 0.001)) return { categorie: 'fenetres', mode: 'emissive', plancher: 0 };
  if ((m.isMeshBasicMaterial || m.isSpriteMaterial || m.isPointsMaterial || m.isLineBasicMaterial) && m.toneMapped === false) {
    return { categorie: 'enseignes', mode: 'sortie', plancher: 0.07 };
  }
  return null;
}

/**
 * Parcourt `objet` et rend éteignable ce qui brille. `exclure(o)` : vrai pour ignorer un objet et ses enfants.
 * Renvoie { injectes, sur_mesure: [objets à ShaderMaterial brillant non traités] }.
 */
export function eteignableGroupe(objet, { exclure = () => false } = {}) {
  let injectes = 0;
  const surMesure = [];
  const visiter = (o) => {
    if (exclure(o)) return;
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) {
      if (m.userData?.extinction) continue;
      if (m.isShaderMaterial) {
        const brille = m.blending === THREE.AdditiveBlending || m.toneMapped === false || m.transparent;
        if (brille && !m.userData?.extinctionSurMesure) surMesure.push(o);
        continue;
      }
      const c = categorieDe(m);
      if (!c) continue;
      eteignable(m, c.categorie, c);
      injectes++;
    }
    for (const enfant of o.children) visiter(enfant);
  };
  visiter(objet);
  return { injectes, sur_mesure: surMesure };
}

// ------------------------------------------------------------------------------------------- l'aube : le ciel
/**
 * Uniforms partagés du ciel de l'aube. `aube` 0 = ciel d'origine (branche sautée) ; 1 = ciel d'aube complet.
 * `zenith`, `horizon`, `est` : couleurs (linéaires) calculées par systems/silence.js ; `nuages` : contraste des nuages.
 */
export const AUBE = {
  aube: { value: 0 },
  zenith: { value: new THREE.Color(0, 0, 0) },
  horizon: { value: new THREE.Color(0, 0, 0) },
  est: { value: new THREE.Color(0, 0, 0) },
  nuages: { value: 0 },
  temps: { value: 0 },
};

/** Ajoute l'aube au matériau du dôme du ciel (MeshBasicMaterial à texture, BackSide). */
export function cielAube(materiau) {
  const avant = materiau.onBeforeCompile;
  const cle0 = cleDe(materiau);
  materiau.onBeforeCompile = function (sh, r) {
    if (typeof avant === 'function') avant.call(this, sh, r);
    sh.uniforms.uAube = AUBE.aube;
    sh.uniforms.uAubeZenith = AUBE.zenith;
    sh.uniforms.uAubeHorizon = AUBE.horizon;
    sh.uniforms.uAubeEst = AUBE.est;
    sh.uniforms.uAubeNuages = AUBE.nuages;
    sh.uniforms.uAubeT = AUBE.temps;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vAubeDir;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAubeDir = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vAubeDir;
        uniform float uAube; uniform vec3 uAubeZenith; uniform vec3 uAubeHorizon; uniform vec3 uAubeEst;
        uniform float uAubeNuages; uniform float uAubeT;
        float aubeH(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        float aubeBruit(vec2 p) {
          vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(aubeH(i), aubeH(i + vec2(1.0, 0.0)), f.x), mix(aubeH(i + vec2(0.0, 1.0)), aubeH(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        float aubeFbm(vec2 p) { float s = 0.0, a = 0.5; for (int k = 0; k < 5; k++) { s += a * aubeBruit(p); p = p * 2.03 + vec2(17.1, 3.7); a *= 0.5; } return s; }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        if ( uAube > 0.0 ) {
          vec3 d = normalize( vAubeDir );
          float h = clamp( d.y, 0.0, 1.0 );
          // dégradé : horizon pâle, zénith plus sombre ; à l'est (+x, derrière Kura), une clarté sans soleil
          vec3 c = mix( uAubeHorizon, uAubeZenith, pow( h, 0.55 ) );
          float est = max( 0.0, dot( normalize( d.xz + vec2( 1e-4 ) ), vec2( 1.0, -0.12 ) ) );
          c = mix( c, uAubeEst, pow( est, 2.2 ) * exp( -h * 4.2 ) );
          // une couche de nuages bas, étirés, qui défilent très lentement
          vec2 q = d.xz / ( h + 0.22 ) * vec2( 1.1, 2.6 ) + vec2( uAubeT * 0.004, 0.0 );
          float n = aubeFbm( q * 1.7 );
          float bandes = smoothstep( 0.38, 0.78, n );
          float voile = smoothstep( 0.0, 0.25, h ) * ( 1.0 - smoothstep( 0.55, 1.0, h ) * 0.6 );
          c *= 1.0 - uAubeNuages * voile * ( 0.32 * bandes - 0.1 * ( 1.0 - bandes ) );
          c += uAubeEst * uAubeNuages * voile * 0.18 * pow( est, 3.0 ) * ( 1.0 - bandes );
          diffuseColor.rgb = mix( diffuseColor.rgb, c, clamp( uAube, 0.0, 1.0 ) );
        }`);
  };
  materiau.customProgramCacheKey = () => `${cle0}|aube`;
  materiau.needsUpdate = true;
  return materiau;
}
