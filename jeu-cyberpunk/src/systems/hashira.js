import * as THREE from 'three';

// Système « hashira » : la tour du Registre, un fût de 400 m au centre exact de
// la ville. Extérieur seulement (l'intérieur viendra plus tard). Un seul grand
// cylindre à shader (lignes de texte lumineuses qui montent), un couronnement,
// un socle. Aucune lumière dynamique.

const HAUTEUR = 400;
const RAYON = 14;
const FOG = new THREE.Color(0x1a0c44);

// Brouillard propre à la tour : beaucoup plus clair que celui de la ville
// (0.0075) pour qu'elle se voie de loin, mais assez pour qu'elle reste
// lointaine et enfouie dans la brume à sa base.
const DENSITE_BROUILLARD = 0.0026;

const VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vVue;
  varying float vY;
  void main() {
    vUv = uv;
    vY = position.y + 0.5 * 400.0;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vVue = mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  uniform float uT;
  uniform vec3 uFog;
  uniform float uDens;
  uniform float uHauteur;
  varying vec2 vUv;
  varying vec3 vVue;
  varying float vY;

  float h11(float n) { return fract(sin(n * 127.1) * 43758.5453); }
  float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  vec3 palette(float k) {
    if (k < 0.34) return vec3(1.0, 0.17, 0.84);   // magenta
    if (k < 0.62) return vec3(0.77, 0.29, 1.0);   // violet
    if (k < 0.86) return vec3(0.24, 0.42, 1.0);   // bleu électrique
    return vec3(0.74, 0.85, 1.0);                 // blanc bleuté, rare
  }

  void main() {
    float y = vY;                 // mètres depuis le sol
    float haut = y / uHauteur;

    // base sombre, légèrement bleutée, plus claire vers le haut
    vec3 col = mix(vec3(0.010, 0.006, 0.030), vec3(0.028, 0.016, 0.075), haut);

    // lignes de texte : une ligne tous les 1.7 m, montent à vitesses différentes par « colonne »
    float larg = 5.0;                         // nombre de bandes de vitesse autour
    float bande = floor(vUv.x * larg);
    float vit = 3.0 + 9.0 * h11(bande + 3.0); // m/s
    float yy = (y - uT * vit) / 1.7;
    float rang = floor(yy);
    float f = fract(yy);
    float trait = smoothstep(0.30, 0.36, f) * (1.0 - smoothstep(0.52, 0.58, f));

    // segments de « mots » le long de la ligne
    float nSeg = 230.0;
    float u = vUv.x * nSeg + h21(vec2(rang, bande)) * 80.0;
    float seg = floor(u);
    float g = fract(u);
    float lettre = step(0.12, g) * (1.0 - step(0.82, g));
    float mot = floor(seg / 9.0);                       // groupes de 5 glyphes
    float allume = step(0.22, h21(vec2(mot, rang + bande * 71.0)));
    float glyphe = step(0.12, h21(vec2(seg, rang * 1.7 + bande)));
    float ligne = trait * lettre * allume * glyphe;

    float kc = h21(vec2(rang, bande * 13.0));
    vec3 c = palette(kc);
    // scintillement léger et ligne « fraîche » plus vive
    float pulse = 0.75 + 0.25 * sin(uT * 2.0 + rang * 0.9);
    float fond = 0.45 + 0.55 * smoothstep(0.0, 0.08, haut); // plus discret au pied
    float ciel = mix(0.55, 1.0, smoothstep(0.0, 0.7, haut));
    col += c * ligne * pulse * 2.8 * fond * ciel;

    // veines verticales fines (côtes du fût)
    float cote = abs(fract(vUv.x * 16.0) - 0.5);
    col += vec3(0.20, 0.25, 0.85) * (1.0 - smoothstep(0.0, 0.018, cote)) * 0.30 * fond;

    // lueur de pied, magenta, pour l'ancrer au sol
    col += vec3(0.8, 0.12, 0.7) * exp(-y * 0.07) * 0.22;

    // brouillard plus clair que celui de la ville
    float d = length(vVue);
    float ff = 1.0 - exp(-d * d * uDens * uDens);
    col = mix(col, uFog, clamp(ff, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
  }
`;

export const hashira = {
  nom: 'hashira',
  mat: null,

  preparer(jeu) {
    jeu.config.ville.blocsReserves.push([4, 4]);
  },

  init(jeu) {
    const k = jeu.zones.get('kasumi');
    const groupe = new THREE.Group();
    groupe.name = 'hashira';

    // --- Le fût ---
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uT: { value: 0 },
        uFog: { value: FOG.clone() },
        uDens: { value: DENSITE_BROUILLARD },
        uHauteur: { value: HAUTEUR },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
    });
    const fut = new THREE.Mesh(new THREE.CylinderGeometry(RAYON, RAYON, HAUTEUR, 64, 1, true), this.mat);
    fut.position.y = HAUTEUR / 2;
    fut.frustumCulled = false;
    groupe.add(fut);

    // --- Matériaux simples (sans brouillard : même teinte que celui de la tour) ---
    const sombre = new THREE.MeshStandardMaterial({ color: 0x0b0718, roughness: 0.4, metalness: 0.6 });
    const neonMagenta = new THREE.MeshBasicMaterial({ color: 0xff2bd6, toneMapped: false, fog: false });
    const neonBleu = new THREE.MeshBasicMaterial({ color: 0x4a7dff, toneMapped: false, fog: false });

    // --- Socle : évasement + deux marches lumineuses ---
    const marche1 = new THREE.Mesh(new THREE.CylinderGeometry(RAYON + 2.4, RAYON + 3.4, 1.0, 64), sombre);
    marche1.position.y = 0.3 + 0.5;
    groupe.add(marche1);
    const anneauPied = new THREE.Mesh(new THREE.TorusGeometry(RAYON + 3.4, 0.14, 8, 96), neonMagenta);
    anneauPied.rotation.x = Math.PI / 2;
    anneauPied.position.y = 0.9;
    groupe.add(anneauPied);
    const anneauEvase = new THREE.Mesh(new THREE.TorusGeometry(RAYON + 0.3, 0.12, 8, 96), neonBleu);
    anneauEvase.rotation.x = Math.PI / 2;
    anneauEvase.position.y = 1.4;
    groupe.add(anneauEvase);

    // --- Couronnement : anneau plus large, deux liserés, balise ---
    const couronne = new THREE.Mesh(new THREE.CylinderGeometry(RAYON + 1.6, RAYON, 12, 64), sombre);
    couronne.position.y = HAUTEUR + 6 - 0.5;
    groupe.add(couronne);
    for (const [dy, m] of [
      [HAUTEUR - 0.2, neonMagenta],
      [HAUTEUR + 11.2, neonBleu],
    ]) {
      const a = new THREE.Mesh(new THREE.TorusGeometry(RAYON + 1.7, 0.45, 8, 96), m);
      a.rotation.x = Math.PI / 2;
      a.position.y = dy;
      groupe.add(a);
    }
    this.balise = new THREE.Mesh(
      new THREE.SphereGeometry(1.4, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xff5ad0, toneMapped: false, fog: false })
    );
    this.balise.position.y = HAUTEUR + 15;
    groupe.add(this.balise);
    const mat = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 14, 6), sombre);
    mat.position.y = HAUTEUR + 7 + 5;
    groupe.add(mat);

    k.scene.add(groupe);

    // --- Colliders : trois boîtes qui approchent le disque du pied (rayon 16.4) ---
    const R = RAYON + 2.4;
    const o = R * 0.7;
    k.colliders.push(
      { minX: -R, maxX: R, minZ: -o * 0.55, maxZ: o * 0.55 },
      { minX: -o * 0.55, maxX: o * 0.55, minZ: -R, maxZ: R },
      { minX: -o, maxX: o, minZ: -o, maxZ: o }
    );
  },

  update(dt, t) {
    if (!this.mat) return;
    this.mat.uniforms.uT.value = t;
    if (this.balise) this.balise.scale.setScalar(1 + 0.25 * Math.sin(t * 3));
  },
};
