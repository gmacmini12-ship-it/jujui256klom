import * as THREE from 'three';
import { rng } from '../textures.js';
import { boite } from './decor.js';
import { INVITES_SALLE, FLUX_GABARITS, FLUX_PORTES, PAN, HEURE } from '../data/mains-courantes.js';

// Salle des Mains Courantes (bible §5.5) : au pied de Hashira, ouverte à tous.
//
// Un cylindre haut (rayon 18 m, hauteur 72 m) dont les murs affichent les écritures du Registre,
// qui montent lentement. Une seule texture de canvas répétée autour de la salle, défilante par
// décalage d'UV dans le shader (une vitesse par colonne) : un seul objet pour tout le mur.
// Le sol sombre est « réfléchissant » : le même mur, retourné sous le sol, se voit à travers.
//
// Au nord (z = -18), en face de l'entrée : le pan de la ligne R-4, à hauteur d'yeux. Il reprend les
// écritures du joueur (systems/mainsCourantes.js `lignes()`), redessinées quand elles changent ;
// E tourne la page.
//
// Repère : entrée au sud (z = +18, x = 0), joueur qui regarde vers −z (yaw 0).

const R = 18;
const H = 72;
const FOND = 0x0c0524;
const REPETITIONS = 9; // tuiles de texte autour de la salle
const TUILE_H = ((2 * Math.PI * R) / REPETITIONS) * 2; // mètres couverts par la hauteur de la texture (1024 × 2048)
const R_JOUEUR = R - 1.1; // limite des pieds

const POLICE = "'Courier New', 'Liberation Mono', monospace";
const TONS = { norm: '#9fb2ff', vif: '#e4ecff', ecart: '#ff5ad0', dim: '#7a6cc0' };

const PAN_L = 10; // largeur du pan (m)
const PAN_H = 4.2;
const PAN_Y = 2.3; // centre
const PAN_PX = [2400, 1008];
const COLONNES = 2;
const LIGNES_COLONNE = 21;

const VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vVue;
  varying float vH;
  void main() {
    vUv = uv;
    vec4 monde = modelMatrix * vec4(position, 1.0);
    vH = abs(monde.y);
    vec4 mv = viewMatrix * monde;
    vVue = mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uT;
  uniform vec3 uFog;
  uniform float uDens;
  uniform float uRep;
  uniform float uTuile;
  uniform float uK;
  varying vec2 vUv;
  varying vec3 vVue;
  varying float vH;

  float h11(float n) { return fract(sin(n * 127.1) * 43758.5453); }

  void main() {
    // vu de l'intérieur, l'angle croît vers la gauche : on retourne u pour que le texte se lise
    float u = (1.0 - vUv.x) * uRep;
    float col = floor(u);
    float h = h11(col + 7.0);
    float vit = 0.25 + 0.75 * h;                 // m/s : lent, une vitesse par colonne
    float v = (vH - uT * vit) / uTuile + h * 3.0;
    vec3 txt = texture2D(uMap, vec2(u, v)).rgb;

    // fond : violet très sombre, plus clair vers le haut, avec les côtes de la paroi
    float haut = clamp(vH / ${H.toFixed(1)}, 0.0, 1.0);
    vec3 col0 = mix(vec3(0.016, 0.008, 0.050), vec3(0.040, 0.018, 0.110), haut);
    float cote = abs(fract(vUv.x * 24.0) - 0.5);
    col0 += vec3(0.07, 0.07, 0.30) * (1.0 - smoothstep(0.0, 0.02, cote)) * 0.55;

    // les lignes qui montent : un peu plus vives à mi-hauteur, ternes au pied
    float vif = 0.55 + 0.75 * smoothstep(0.0, 0.18, haut) * (1.0 - 0.35 * haut);
    vec3 c = col0 + txt * 2.1 * vif * (0.7 + 0.5 * h);
    c *= uK;

    float d = length(vVue);
    float ff = 1.0 - exp(-d * d * uDens * uDens);
    c = mix(c, uFog, clamp(ff, 0.0, 1.0));
    gl_FragColor = vec4(c, 1.0);
  }
`;

// ---------------------------------------------------------------------------
// Texture du flux : lignes du Registre, une vitesse par colonne dans le shader.
// ---------------------------------------------------------------------------
function textureFlux() {
  const rand = rng(1974);
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 2048;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  g.font = `bold 17px ${POLICE}`;
  g.textBaseline = 'middle';

  const total = FLUX_GABARITS.reduce((s, t) => s + t.poids, 0);
  const choisir = () => {
    let r = rand() * total;
    for (const t of FLUX_GABARITS) if ((r -= t.poids) < 0) return t;
    return FLUX_GABARITS[0];
  };
  const pad = (n) => String(n).padStart(2, '0');
  const num = (a, b) => a + Math.floor(rand() * (b - a));
  const heure = () => HEURE.gabarit.replace('{hh}', pad(num(0, 24))).replace('{mm}', pad(num(0, 60)));
  const vars = () => ({
    h: heure(), r: num(104, 9900), r2: num(104, 9900), n: num(2, 480),
    porte: `${FLUX_PORTES[num(0, FLUX_PORTES.length)]}-${num(100, 1900)}`,
  });

  const PAS = 26;
  const lignes = Math.floor(c.height / PAS);
  for (let i = 0; i < lignes; i++) {
    const modele = choisir();
    const v = vars();
    const texte = modele.texte.replace(/\{(\w+)\}/g, (m, k) => v[k] ?? m);
    // une ligne sur sept est laissée presque vide : des blancs, comme un registre qui respire
    if (rand() < 0.14) continue;
    g.fillStyle = modele.ton === 'ecart' ? '#ff5ad0' : modele.ton === 'vif' ? '#d8e4ff' : rand() < 0.5 ? '#8da4ff' : '#b49cff';
    g.globalAlpha = 0.55 + rand() * 0.45;
    g.fillText(texte, 14 + Math.floor(rand() * 6) * 6, i * PAS + PAS / 2);
  }
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

// Anneaux concentriques du sol (très discrets).
function textureSol() {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d');
  g.fillStyle = '#05020f';
  g.fillRect(0, 0, 1024, 1024);
  const gr = g.createRadialGradient(512, 512, 10, 512, 512, 512);
  gr.addColorStop(0, 'rgba(110,70,255,0.45)');
  gr.addColorStop(0.35, 'rgba(60,30,160,0.12)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 1024, 1024);
  g.strokeStyle = 'rgba(111,140,255,0.55)';
  for (const [r, a] of [[88, 1], [176, 0.6], [330, 0.4], [470, 0.7]]) {
    g.globalAlpha = a;
    g.lineWidth = r === 470 ? 5 : 2;
    g.beginPath();
    g.arc(512, 512, r, 0, Math.PI * 2);
    g.stroke();
  }
  g.globalAlpha = 0.5;
  g.lineWidth = 1;
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    g.beginPath();
    g.moveTo(512 + Math.cos(a) * 176, 512 + Math.sin(a) * 176);
    g.lineTo(512 + Math.cos(a) * 330, 512 + Math.sin(a) * 330);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// ---------------------------------------------------------------------------
// Le pan de la ligne R-4
// ---------------------------------------------------------------------------
function creerPan(jeu, sys) {
  const [W, Hc] = PAN_PX;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = Hc;
  const g = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.x = -1; // vu de l'intérieur, u croît vers la gauche
  tex.offset.x = 1;
  const etat = { page: 0, pages: 1, lignes: [] };

  function dessiner() {
    const lignes = sys.lignes();
    etat.lignes = lignes;
    const parPage = COLONNES * LIGNES_COLONNE;
    etat.pages = Math.max(1, Math.ceil(lignes.length / parPage));
    etat.page = Math.min(etat.page, etat.pages - 1);

    g.fillStyle = '#07031a';
    g.fillRect(0, 0, W, Hc);
    // fond de verre : fines côtes
    g.fillStyle = 'rgba(80,100,255,0.06)';
    for (let x = 0; x < W; x += 40) g.fillRect(x, 0, 2, Hc);
    g.strokeStyle = '#6f8cff';
    g.lineWidth = 4;
    g.strokeRect(10, 10, W - 20, Hc - 20);

    // en-tête
    g.textBaseline = 'alphabetic';
    g.fillStyle = '#e4ecff';
    g.font = `bold 62px ${POLICE}`;
    g.fillText(PAN.titre, 48, 84);
    g.fillStyle = TONS.dim;
    g.font = `30px ${POLICE}`;
    g.fillText(PAN.sousTitre.replace('{h}', sys.heure(sys.temps)), 48, 124);
    g.fillStyle = '#ff2bd6';
    g.fillRect(48, 140, W - 96, 3);

    // colonnes
    const hautLignes = 196;
    const pas = 36;
    const largeurCol = (W - 96 - 60) / COLONNES;
    g.font = `bold 27px ${POLICE}`;
    if (lignes.length === 0) {
      g.fillStyle = TONS.dim;
      g.fillText(PAN.vide, 48, hautLignes);
    }
    const debut = etat.page * parPage;
    for (let i = 0; i < parPage; i++) {
      const l = lignes[debut + i];
      if (!l) break;
      const col = Math.floor(i / LIGNES_COLONNE);
      const rang = i % LIGNES_COLONNE;
      const x = 48 + col * (largeurCol + 60);
      const y = hautLignes + rang * pas;
      g.fillStyle = TONS[l.ton] || TONS.norm;
      let texte = l.texte;
      while (g.measureText(texte).width > largeurCol && texte.length > 4) texte = texte.slice(0, -2);
      if (texte !== l.texte) texte = texte.trimEnd() + '…';
      g.fillText(texte, x, y);
    }
    // pied
    g.fillStyle = TONS.dim;
    g.font = `26px ${POLICE}`;
    g.textAlign = 'right';
    g.fillText(PAN.pied.replace('{page}', etat.page + 1).replace('{pages}', etat.pages), W - 48, Hc - 28);
    g.textAlign = 'left';
    tex.needsUpdate = true;
  }

  // Segment de paroi, légèrement en avant du mur
  const angle = PAN_L / (R - 0.05);
  const geo = new THREE.CylinderGeometry(R - 0.05, R - 0.05, PAN_H, 48, 1, true, Math.PI - angle / 2, angle);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, toneMapped: false }));
  mesh.position.y = PAN_Y;

  // Cadre : deux bandes courbes et deux montants
  const cadre = new THREE.Group();
  const bleu = new THREE.MeshBasicMaterial({ color: 0x6f8cff, toneMapped: false, side: THREE.BackSide });
  const rose = new THREE.MeshBasicMaterial({ color: 0xff2bd6, toneMapped: false, side: THREE.BackSide });
  for (const [dy, mat] of [[PAN_H / 2 + 0.06, bleu], [-PAN_H / 2 - 0.06, rose]]) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.07, R - 0.07, 0.1, 48, 1, true, Math.PI - angle / 2 - 0.01, angle + 0.02), mat);
    b.position.y = PAN_Y + dy;
    cadre.add(b);
  }
  for (const s of [-1, 1]) {
    const a = Math.PI + s * (angle / 2 + 0.003);
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, PAN_H + 0.22, 0.1), bleu);
    m.position.set((R - 0.07) * Math.sin(a), PAN_Y, (R - 0.07) * Math.cos(a));
    m.rotation.y = a;
    cadre.add(m);
  }

  return { mesh, cadre, dessiner, etat, tex };
}

// ---------------------------------------------------------------------------
export function creerMainsCourantes(jeu) {
  const sys = jeu.mainsCourantes;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(FOND);
  const colliders = [];
  const fogC = new THREE.Color(0x14083a);
  const DENS = 0.0105;

  // ---------- Mur (et son reflet sous le sol) ----------
  const flux = textureFlux();
  const uniformes = {
    uMap: { value: flux },
    uT: { value: 0 },
    uFog: { value: fogC },
    uDens: { value: DENS },
    uRep: { value: REPETITIONS },
    uTuile: { value: TUILE_H },
  };
  const mur = new THREE.Mesh(
    new THREE.CylinderGeometry(R, R, H, 96, 1, true),
    new THREE.ShaderMaterial({ uniforms: { ...uniformes, uK: { value: 1 } }, vertexShader: VERT, fragmentShader: FRAG, side: THREE.BackSide })
  );
  mur.position.y = H / 2;
  mur.frustumCulled = false;
  scene.add(mur);
  const reflet = new THREE.Mesh(
    mur.geometry,
    new THREE.ShaderMaterial({ uniforms: { ...uniformes, uK: { value: 0.5 } }, vertexShader: VERT, fragmentShader: FRAG, side: THREE.BackSide })
  );
  reflet.scale.y = -1;
  reflet.position.y = -H / 2;
  reflet.frustumCulled = false;
  scene.add(reflet);

  // ---------- Sol sombre, légèrement transparent : on y voit le reflet ----------
  const sol = new THREE.Mesh(
    new THREE.CircleGeometry(R, 96),
    new THREE.MeshBasicMaterial({ map: textureSol(), transparent: true, opacity: 0.84, toneMapped: false, depthWrite: true })
  );
  sol.rotation.x = -Math.PI / 2;
  sol.position.y = 0;
  scene.add(sol);

  // ---------- Plafond : un œil de lumière lilas, très haut ----------
  const plafond = new THREE.Mesh(new THREE.CircleGeometry(R, 48), new THREE.MeshBasicMaterial({ color: 0x1a0c44, fog: false }));
  plafond.rotation.x = Math.PI / 2;
  plafond.position.y = H;
  scene.add(plafond);
  const oeil = new THREE.Mesh(new THREE.TorusGeometry(6, 0.25, 6, 64), new THREE.MeshBasicMaterial({ color: 0xb49cff, toneMapped: false, fog: false }));
  oeil.rotation.x = Math.PI / 2;
  oeil.position.y = H - 0.3;
  scene.add(oeil);

  // ---------- Main courante : un anneau le long du mur, interrompu devant l'entrée ----------
  const RR = R - 0.75;
  const ecartPorte = 2.6 / RR;
  const ecartPan = (PAN_L / 2 + 0.4) / RR;
  const railMat = new THREE.MeshBasicMaterial({ color: 0x6f8cff, toneMapped: false });
  // deux arcs, entre l'entrée (φ = π/2 une fois le tore couché) et le pan (φ = −π/2) : l'un et l'autre
  // laissent le passage libre devant la porte et le regard libre devant le pan
  for (const debut of [Math.PI / 2 + ecartPorte, -Math.PI / 2 + ecartPan]) {
    const longueur = Math.PI - ecartPorte - ecartPan;
    const arc = new THREE.TorusGeometry(RR, 0.045, 6, 64, longueur);
    arc.rotateZ(debut);
    const m = new THREE.Mesh(arc, railMat);
    m.rotation.x = Math.PI / 2;
    m.position.y = 1.05;
    scene.add(m);
  }
  const nPoteaux = 72;
  const poteaux = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.035, 0.035, 1.05, 5),
    new THREE.MeshBasicMaterial({ color: 0x2c2a7a }),
    nPoteaux
  );
  const m4 = new THREE.Matrix4();
  let k = 0;
  for (let i = 0; i < nPoteaux; i++) {
    const a = (i / nPoteaux) * Math.PI * 2;
    const x = RR * Math.sin(a), z = RR * Math.cos(a);
    if (z > 0 && Math.abs(x) < 3.0) continue; // devant l'entrée
    if (z < 0 && Math.abs(x) < PAN_L / 2 + 0.4) continue; // devant le pan
    m4.makeTranslation(x, 0.525, z);
    poteaux.setMatrixAt(k++, m4);
  }
  poteaux.count = k;
  scene.add(poteaux);

  // ---------- Guide au sol : un filet lumineux de l'entrée au pan ----------
  const filet = new THREE.MeshBasicMaterial({ color: 0x6f8cff, toneMapped: false, transparent: true, opacity: 0.8 });
  for (const s of [-1, 1]) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(0.1, R * 2 - 7), filet);
    f.rotation.x = -Math.PI / 2;
    f.position.set(s * 1.2, 0.01, -1);
    scene.add(f);
  }

  // ---------- Entrée (porte du côté sud) ----------
  const seuil = new THREE.MeshBasicMaterial({ color: 0xff2bd6, toneMapped: false });
  boite(scene, 5.0, 0.07, 0.12, seuil, 0, 0.04, R - 0.45);
  boite(scene, 0.12, 4.2, 0.12, new THREE.MeshBasicMaterial({ color: 0x6f8cff, toneMapped: false }), -2.5, 2.1, R - 0.1);
  boite(scene, 0.12, 4.2, 0.12, new THREE.MeshBasicMaterial({ color: 0x6f8cff, toneMapped: false }), 2.5, 2.1, R - 0.1);
  boite(scene, 5.12, 0.12, 0.12, new THREE.MeshBasicMaterial({ color: 0x6f8cff, toneMapped: false }), 0, 4.2, R - 0.1);

  // ---------- Le pan du joueur ----------
  const pan = creerPan(jeu, sys);
  scene.add(pan.mesh, pan.cadre);
  pan.dessiner();

  // ---------- Lumière : pour la main et la fumée, pas pour le décor ----------
  scene.add(new THREE.HemisphereLight(0x8a6cff, 0x1a0838, 0.8));
  const lampe = new THREE.PointLight(0xa890ff, 6, 14, 1.6);
  lampe.position.set(0, 3.2, 4);
  scene.add(lampe);

  // ---------- Murs invisibles : le disque, en escalier ----------
  const Rp = R_JOUEUR;
  const pas = 0.5;
  for (let z0 = -Rp; z0 < Rp; z0 += pas) {
    const z1 = Math.min(z0 + pas, Rp);
    const zmin = z0 <= 0 && z1 >= 0 ? 0 : Math.min(Math.abs(z0), Math.abs(z1));
    const w = Math.sqrt(Math.max(0, Rp * Rp - zmin * zmin));
    colliders.push({ minX: w, maxX: R + 4, minZ: z0, maxZ: z1 }, { minX: -R - 4, maxX: -w, minZ: z0, maxZ: z1 });
  }
  for (let x0 = -Rp; x0 < Rp; x0 += pas) {
    const x1 = Math.min(x0 + pas, Rp);
    const xmin = x0 <= 0 && x1 >= 0 ? 0 : Math.min(Math.abs(x0), Math.abs(x1));
    const h = Math.sqrt(Math.max(0, Rp * Rp - xmin * xmin));
    colliders.push({ minX: x0, maxX: x1, minZ: h, maxZ: R + 4 }, { minX: x0, maxX: x1, minZ: -R - 4, maxZ: -h });
  }

  // ---------- Interactions ----------
  jeu.zones.porte({
    zone: 'mains-courantes',
    position: [0, 1.7, R - 0.5],
    rayon: 3.4,
    cone: 1.2,
    libelle: INVITES_SALLE.sortir,
    vers: 'kasumi',
    point: 'tour',
  });
  jeu.interact.ajouter({
    zone: 'mains-courantes',
    position: [0, 2.0, -R + 0.5],
    rayon: 5.5,
    cone: 0.9,
    libelle: () => (pan.etat.pages > 1 ? INVITES_SALLE.page : null),
    visible: () => pan.etat.pages > 1,
    action: () => {
      pan.etat.page = (pan.etat.page + 1) % pan.etat.pages;
      pan.dessiner();
    },
  });

  const rafraichir = () => {
    sys.sale = false;
    pan.dessiner();
  };

  return {
    scene,
    colliders,
    bornes: { minX: -R + 0.6, maxX: R - 0.6, minZ: -R + 0.6, maxZ: R - 0.6 },
    apparition: { position: [0, 0, R - 2.4], yaw: 0, pitch: 0.12 },
    points: {
      entree: { position: [0, 0, R - 2.4], yaw: 0, pitch: 0.12 },
    },
    pan,
    ambiance: {
      brouillard: { couleur: 0x14083a, densite: DENS },
      fond: FOND,
      exposition: 1.0,
      pluie: false,
      reflet: false,
      bloom: { force: 0.85, rayon: 0.7, seuil: 0.42 },
      son: { pluie: 0, filtre: 700 }, // pas de pluie ici : un bourdonnement étouffé
    },
    entrer() {
      pan.etat.page = 0;
      rafraichir();
    },
    update(dt, t) {
      uniformes.uT.value = t;
      if (sys.sale) rafraichir();
    },
  };
}
