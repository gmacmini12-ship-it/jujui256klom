import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ETEINT } from '../zones/kura-baies.js';
import {
  REGLAGES as R, TEXTES, JOURNAL, REPLI_T10, REPLI_T12, REPLI_PAYS, enLettres,
} from '../data/profondeurs.js';

// Les dangers des Profondeurs de Kura (étape 5, tâches 5.4, 5.5, 5.6 ; bible §5.6, §4.3, §7.3). Réglages et textes :
// src/data/profondeurs.js. Géométrie lue dans `jeu.kura.profondeurs` (zones/kura.js : allées, bouches, bassins,
// ventilateurs, câbles). Rien ne tourne hors de la zone `kura` ; rien n'est posé dans la salle de l'Interrupteur
// ni sur le parcours sûr (A, Est, C, Ouest, E, Finale).
//
// 1. CHALEUR (jauge `jeu.profondeurs.chaleur`, 0..1). Monte dans les allées chaudes (B, D, raccourcis), plus vite
//    près des bouches ; redescend dans les allées froides et hors des Profondeurs. Rendue par le monde : ondulation
//    de l'image (`zone.ondulationExtra` → uniform `ondulation`), bords qui rougissent (DOM), souffle et respiration.
//    Un indicateur discret apparaît au-delà de la moitié. À 1 : `jeu.veilleur.echec('chaleur')` (fondu blanc, retour
//    à la dernière borne : seuil ou mi-parcours), jauge remise à 0 à la reprise.
// 2. SOL ÉLECTRIFIÉ : les six bassins qui coupent les allées chaudes (B et D) sont chargés par cycle de 7 s (repos,
//    alerte de 1,3 s : petits arcs et crépitement, décharge de 2,4 s : arcs, nappe lumineuse, éclair). Y être pendant
//    la décharge (pieds sous 0,6 m) : `echec('electricite')`. Les deux bassins le long des allées sûres sont inertes.
// 3. VENTILATEURS : cycle de 17 s (aspiration, répit, poussée, répit). Dérive appliquée à la vitesse du joueur
//    (jusqu'à 2,7 m/s contre le rotor, en dessous de la marche à 5 m/s), sens de rotation inversé en poussée.
//    Les pales tuent (`echec('ventilateur')`) dans la tranche de 1,3 m devant la paroi, sur le disque du rotor.
// 4. BARRIÈRES DE PRÉVENANCE : volumes de danger (bassins, ventilateurs, bouches d'accès) et bouches des allées mortelles
//    (raccourcis). Quand le joueur marche vers l'un d'eux à moins de 8 m, un plan hexagonal translucide se dresse
//    (apparition douce, collider), puis tombe quand il se détourne. Jamais quand on sort d'un volume. Pas de
//    barrière sous Sourdine : celles qui sont dressées tombent.
// 5. T10 : franchir (de l'extérieur vers l'intérieur) l'emplacement d'une barrière d'allée mortelle SOUS SOURDINE :
//    `etat.transgressions.T10` +1 une fois par franchissement tout de suite, journal ; l'évènement `transgression`
//    (Attention) est émis à la FIN de la Sourdine (l'Attention est en pause pendant : `attention.ajouter` renvoie 0),
//    puis la réplique de REPONSES_T10 avec la durée passée derrière la barrière.
// 6. T12 : arracher un câble de baie (onze : six au Hall, cinq aux Profondeurs), E maintenu 5 s. 1re et 2e fois : le
//    câble reste arraché (sauvegardé), baies éteintes autour (uniform `uEteint` des baies), réaction du Pays
//    (REACTION_PAYS), réplique de Mima (REPONSES_T12 ; la 2e est un silence, et « pourquoi » s'écrit sur l'écran de
//    Sept). 3e et suivantes : les câbles ne cèdent plus (verrouillés), répliques `suite`, pas de nouvelle
//    transgression (la bible ne dit pas qu'elle compte quand rien n'est arraché).
//
// API : `jeu.profondeurs` = { chaleur, faces, bassins, ventilateurs, barriereActive(), etatBassin(i, t), arracher(i), cables,
//   attente, reglerChaleur(v) }. Évènements émis : `transgression { id: 'T10' | 'T12', source, detail, n }`,
//   `profondeurs:barriere { id }` (une barrière se dresse), `profondeurs:chaleur { valeur }` (franchit un seuil de 0,25),
//   `profondeurs:echec { cause }`.
// État sauvegardé : `etat.profondeurs = { arraches: [indices], gestes, pourquoi, barriereVue, attente: [...] }`.

const modEtape5 = Object.values(import.meta.glob('../data/dialogues-etape5.js', { eager: true }))[0] || null;
const REP_T10 = () => modEtape5?.REPONSES_T10 || REPLI_T10;
const REP_T12 = () => modEtape5?.REPONSES_T12 || REPLI_T12;
const PAYS = () => modEtape5?.REACTION_PAYS || REPLI_PAYS;

const DY = 0;
const PLAFOND = 23.5;
const horsDansProf = (p) => p.x >= 228 && p.z <= -70;
const borne = (v, a, b) => Math.max(a, Math.min(b, v));
const dans = (r, x, z, m = 0) => x >= r.minX - m && x <= r.maxX + m && z >= r.minZ - m && z <= r.maxZ + m;
const recouvre = (a, b) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
const rand = (a, b) => a + Math.random() * (b - a);

function ep(jeu) {
  const e = jeu.etat;
  if (!e.profondeurs || typeof e.profondeurs !== 'object' || Array.isArray(e.profondeurs)) {
    e.profondeurs = { arraches: [], gestes: 0, pourquoi: false, barriereVue: false, attente: [] };
  }
  const o = e.profondeurs;
  if (!Array.isArray(o.arraches)) o.arraches = [];
  if (!Array.isArray(o.attente)) o.attente = [];
  if (typeof o.gestes !== 'number') o.gestes = 0;
  return o;
}

// ------------------------------------------------------------------------------------------ matériaux
/** Plan hexagonal : nid d'abeille translucide dont les cellules apparaissent une à une (uAlpha). */
function materielBarriere() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false,
    uniforms: { uAlpha: { value: 0 }, uT: { value: 0 }, uSize: { value: new THREE.Vector2(8, 11) }, uSeed: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uAlpha; uniform float uT; uniform vec2 uSize; uniform float uSeed;
      varying vec2 vUv;
      float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float hexd(vec2 p) { p = abs(p); return max(dot(p, normalize(vec2(1.0, 1.7320508))), p.x); }
      void main() {
        vec2 p = vUv * uSize / 0.62;
        vec2 r = vec2(1.0, 1.7320508);
        vec2 hh = r * 0.5;
        vec2 a = mod(p, r) - hh;
        vec2 b = mod(p - hh, r) - hh;
        vec2 gv = dot(a, a) < dot(b, b) ? a : b;
        vec2 id = p - gv;
        float e = 0.5 - hexd(gv);                         // distance au bord de la cellule
        float arete = 1.0 - smoothstep(0.0, 0.075, e);
        float rnd = h21(id + uSeed);
        float vis = smoothstep(rnd - 0.12, rnd + 0.02, uAlpha * 1.18);   // les cellules apparaissent une à une
        float pouls = 0.55 + 0.45 * sin(uT * 2.2 + rnd * 40.0 + id.y * 0.5);
        float rempli = (0.10 + 0.20 * pouls * step(0.78, rnd)) * (1.0 - arete);
        float bas = smoothstep(0.0, 0.10, vUv.y);                      // pied lumineux, sommet qui se dissout
        float haut = 1.0 - smoothstep(0.62, 1.0, vUv.y);
        float cote = smoothstep(0.0, 0.05, vUv.x) * smoothstep(0.0, 0.05, 1.0 - vUv.x);
        float onde = 0.75 + 0.25 * sin(vUv.y * 9.0 - uT * 2.6 + vUv.x * 3.0);
        float k = (arete * 0.95 + rempli) * vis * bas * haut * cote * onde;
        vec3 cMur = vec3(0.62, 0.38, 1.0);
        vec3 cBord = vec3(0.92, 0.84, 1.0);
        vec3 col = mix(cMur, cBord, arete) * k;
        float pied = (1.0 - smoothstep(0.0, 0.035, vUv.y)) * vis;
        col += vec3(0.95, 0.5, 1.0) * pied * 0.9;
        gl_FragColor = vec4(col * 1.05, 1.0);
      }`,
  });
}

/** Nappe d'électricité sur les bassins chargés (un seul maillage, charge par sommet). */
function materielNappe() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    uniforms: { uT: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float aCharge; attribute vec2 aTaille; varying vec2 vUv; varying float vC; varying vec2 vT;
      void main() { vUv = uv; vC = aCharge; vT = aTaille; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uT; varying vec2 vUv; varying float vC; varying vec2 vT;
      void main() {
        if (vC <= 0.001) discard;
        vec2 q = vUv * vT;
        float n1 = sin(q.x * 2.3 + uT * 11.0 + sin(q.y * 3.1 + uT * 7.0) * 1.6) * sin(q.y * 2.9 - uT * 9.0 + sin(q.x * 2.1 + uT * 3.0) * 1.3);
        float n2 = sin(q.x * 5.1 - uT * 13.0 + q.y * 1.7) * sin(q.y * 4.3 + uT * 10.0 - q.x * 1.1);
        float v = pow(1.0 - abs(n1), 12.0) + 0.6 * pow(1.0 - abs(n2), 16.0);
        float flick = 0.7 + 0.3 * sin(uT * 60.0 + q.x * 0.4);
        float bord = 1.0 - smoothstep(0.0, 0.35, min(min(q.x, vT.x - q.x), min(q.y, vT.y - q.y)));
        float a = vC * (0.16 + v * 0.95) * flick + bord * vC * 0.45;
        gl_FragColor = vec4(vec3(0.55, 0.9, 1.25) * a, 1.0);
      }`,
  });
}

// ------------------------------------------------------------------------------------------ le système
export const profondeurs = {
  nom: 'profondeurs',
  jeu: null,
  pret: false,
  /** Jauge de chaleur 0..1. */
  chaleur: 0,
  faces: [],
  bassins: [],
  ventilateurs: [],
  cables: [],
  actifZone: false,
  arrachage: null,
  minuteries: [],
  attenteEnCours: false,
  _chocT: 0,
  _echecEnvoye: false,
  _respire: 0,
  _souffleFan: 0,
  _crepite: 0,
  _arcT: 0,
  _palierChaleur: 0,

  get attente() { return this.jeu ? ep(this.jeu).attente : []; },

  // ---------------------------------------------------------------------------------------- init
  init(jeu) {
    this.jeu = jeu;
    jeu.profondeurs = this;
    this.styles();
    this.construireDom();
    jeu.on('partie:nouvelle', () => this.nouvellePartie());
    jeu.on('joueur:reprise', () => this.reprise());
    jeu.on('joueur:echec', () => { this._echecEnvoye = true; this.arreterArrachage(); });
    jeu.on('sourdine:fin', () => this.finSourdine());
    this.creerObjetsCables();
  },

  surZone(nom, zone, jeu) {
    if (nom === 'kura' && !this.pret) this.construire(jeu);
  },

  // ---------------------------------------------------------------------------------------- construction
  /** Géométrie lue dans la zone (après sa construction) : bassins, ventilateurs, barrières, câbles arrachés. */
  construire(jeu) {
    const kz = jeu.zones.get('kura');
    const P = kz?.profondeurs;
    if (!kz || !P || !kz.groupes) return;
    this.kz = kz;
    this.P = P;
    this.groupeProf = kz.groupes.prof;
    this.groupeHall = kz.groupes.hall;
    this.allees = P.allees;
    this.chaudes = P.allees.filter((a) => a.type === 'chaude');

    // ---- bassins électrifiés : ceux qui coupent une allée chaude
    this.bassins = [];
    P.bassins.forEach((b, i) => {
      if (!this.chaudes.some((a) => recouvre(a, b))) return;
      const k = this.bassins.length;
      this.bassins.push({ i, rect: b, k, off: (k * R.electricite.decalage) % R.electricite.periode, charge: 0, phase: 'repos', prec: 'repos' });
    });
    this.construireNappe();

    // ---- ventilateurs : ceux de la zone, ordonnés comme P.ventilateurs
    this.ventilateurs = P.ventilateurs.map((d, i) => {
      const f = kz.ventilateurs?.[i];
      const [ax, , az] = d.axe;
      return { ...d, i, rotor: f, vBase: f ? f.vitesse : 1, mode: 'repos', force: 0, facteur: 1, ax, az };
    });

    this.construireAir();

    // ---- barrières
    this.construireBarrieres();

    // ---- câbles : état sauvegardé
    this.pret = true;
    this.restaurerCables();
  },

  /** Poussière d'air devant les rotors : elle file vers les pales (aspiration) ou s'en éloigne (poussée). */
  construireAir() {
    const N = 40;
    const total = this.ventilateurs.length * N;
    this.airPos = new Float32Array(total * 3);
    this.air = this.ventilateurs.flatMap((v) => Array.from({ length: N }, () => ({ u: rand(0.5, 11), l: rand(-v.rayon, v.rayon), h: rand(-v.rayon * 0.9, v.rayon * 0.9), v })));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.airPos, 3));
    this.airMat = new THREE.PointsMaterial({ color: 0xffd2a0, size: 0.14, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const pts = new THREE.Points(g, this.airMat);
    pts.frustumCulled = false;
    pts.renderOrder = 4;
    this.groupeProf.add(pts);
    this.airPts = pts;
  },

  majAir(dt) {
    const pos = this.airPos;
    this.air.forEach((a, k) => {
      const v = a.v;
      const vit = v.mode === 'aspiration' ? -(2 + 3.2 * Math.max(0, v.facteur)) : v.mode === 'poussee' ? 2 + 2.6 * Math.max(0, -v.facteur) : 0.15;
      a.u += vit * dt;
      if (a.u < 0.4) a.u = 11;
      else if (a.u > 11) a.u = 0.6;
      pos[k * 3] = v.position[0] + v.ax * a.u + Math.abs(v.az) * a.l;
      pos[k * 3 + 1] = v.position[1] + a.h;
      pos[k * 3 + 2] = v.position[2] + v.az * a.u + Math.abs(v.ax) * a.l;
    });
    this.airPts.geometry.getAttribute('position').needsUpdate = true;
  },

  construireNappe() {
    const B = this.bassins;
    const n = B.length;
    const pos = new Float32Array(n * 4 * 3);
    const uv = new Float32Array(n * 4 * 2);
    const ch = new Float32Array(n * 4);
    const tl = new Float32Array(n * 4 * 2);
    const idx = [];
    B.forEach((b, k) => {
      const { minX, maxX, minZ, maxZ } = b.rect;
      const y = DY + 0.1;
      const s = [[minX, minZ, 0, 0], [maxX, minZ, 1, 0], [maxX, maxZ, 1, 1], [minX, maxZ, 0, 1]];
      s.forEach(([x, z, u, v], j) => {
        pos.set([x, y, z], (k * 4 + j) * 3);
        uv.set([u, v], (k * 4 + j) * 2);
        tl.set([maxX - minX, maxZ - minZ], (k * 4 + j) * 2);
      });
      const o = k * 4;
      idx.push(o, o + 2, o + 1, o, o + 3, o + 2);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('aCharge', new THREE.BufferAttribute(ch, 1));
    g.setAttribute('aTaille', new THREE.BufferAttribute(tl, 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    this.nappeMat = materielNappe();
    this.nappe = new THREE.Mesh(g, this.nappeMat);
    this.nappe.frustumCulled = false;
    this.nappe.renderOrder = 5;
    this.groupeProf.add(this.nappe);

    // arcs : segments en lignes, régénérés ~14 fois par seconde
    const SEG = 7;
    this.arcsParBassin = R.electricite.arcs;
    this.segArc = SEG;
    const total = n * this.arcsParBassin * SEG * 2 * 3;
    this.arcPos = new Float32Array(total);
    const ga = new THREE.BufferGeometry();
    ga.setAttribute('position', new THREE.BufferAttribute(this.arcPos, 3));
    this.arcs = new THREE.LineSegments(ga, new THREE.LineBasicMaterial({ color: 0xbfeaff, toneMapped: false, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.arcs.frustumCulled = false;
    this.arcs.renderOrder = 6;
    this.groupeProf.add(this.arcs);
  },

  /** Les volumes et leurs faces. Une face = un plan de barrière : { c: [x, z], n: [nx, nz], t: [tx, tz], demi, y0, haut, ... }. */
  construireBarrieres() {
    const Rb = R.barrieres;
    const faces = [];
    const faceDe = (id, type, cx, cz, nx, nz, demi, haut, extra = {}) => {
      const f = {
        id, type, c: [cx, cz], n: [nx, nz], t: [Math.abs(nz), Math.abs(nx)], demi, y0: DY, haut,
        alpha: 0, voulu: false, depuis: 0, hors: 0, collider: null, mesh: null, dnPrev: null, compte: false, actif: () => true, ...extra,
      };
      faces.push(f);
      return f;
    };
    // bouches des allées mortelles (raccourcis) : le plan ferme l'ouverture, côté allée sûre ; franchissement = T10
    for (const a of this.allees.filter((x) => x.id.startsWith('raccourci'))) {
      const demi = (a.maxX - a.minX) / 2;
      const cx = (a.minX + a.maxX) / 2;
      faceDe(`bouche-${a.id}-nord`, 'allee', cx, a.maxZ, 0, 1, demi, Rb.hauteur, { compte: true });
      faceDe(`bouche-${a.id}-sud`, 'allee', cx, a.minZ, 0, -1, demi, Rb.hauteur, { compte: true });
    }
    // accès final (réglage, fermé par défaut)
    const fin = this.allees.find((a) => a.id === 'finale');
    if (fin) {
      faceDe('acces-final', 'final', (fin.minX + fin.maxX) / 2, -285, 0, 1, (fin.maxX - fin.minX) / 2, Rb.hauteur, { actif: () => Rb.fermerAccesFinal, compte: true });
    }
    // bassins électrifiés : quatre côtés
    const m = Rb.margeBassin;
    for (const b of this.bassins) {
      const r = b.rect;
      const cx = (r.minX + r.maxX) / 2, cz = (r.minZ + r.maxZ) / 2;
      const dx = (r.maxX - r.minX) / 2 + m, dz = (r.maxZ - r.minZ) / 2 + m;
      faceDe(`bassin${b.i}-O`, 'bassin', r.minX - m, cz, -1, 0, dz, 4.5);
      faceDe(`bassin${b.i}-E`, 'bassin', r.maxX + m, cz, 1, 0, dz, 4.5);
      faceDe(`bassin${b.i}-S`, 'bassin', cx, r.minZ - m, 0, -1, dx, 4.5);
      faceDe(`bassin${b.i}-N`, 'bassin', cx, r.maxZ + m, 0, 1, dx, 4.5);
    }
    // ventilateurs : un plan devant le rotor et deux plans sur les flancs, entre la paroi et lui
    for (const v of this.ventilateurs) {
      const [px, py, pz] = v.position;
      const marge = Rb.margeVentilateur;
      const haut = py + v.rayon + 0.5 - DY;
      const demi = v.rayon + 0.5;
      const lat = [Math.abs(v.az), Math.abs(v.ax)]; // axe latéral (perpendiculaire à l'axe du rotor)
      faceDe(`ventilateur${v.i}-face`, 'ventilateur', px + v.ax * marge, pz + v.az * marge, v.ax, v.az, demi, haut);
      for (const s of [-1, 1]) {
        const cx = px + v.ax * marge / 2 + lat[0] * s * demi;
        const cz = pz + v.az * marge / 2 + lat[1] * s * demi;
        faceDe(`ventilateur${v.i}-flanc${s > 0 ? '+' : '-'}`, 'ventilateur', cx, cz, lat[0] * s, lat[1] * s, marge / 2 + 0.3, haut);
      }
    }
    this.faces = faces;
    // le pool de maillages (au plus quelques barrières à la fois)
    this.pool = [];
    const geo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 6; i++) {
      const mat = materielBarriere();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.renderOrder = 7;
      mesh.frustumCulled = false;
      this.groupeProf.add(mesh);
      this.pool.push({ mesh, mat, face: null });
    }
  },

  // ---------------------------------------------------------------------------------------- interface (DOM)
  styles() {
    if (typeof document === 'undefined' || document.getElementById('prof-style')) return;
    const s = document.createElement('style');
    s.id = 'prof-style';
    s.textContent = `
.prof-bords { position: absolute; inset: 0; pointer-events: none; opacity: 0; mix-blend-mode: screen;
  background: radial-gradient(ellipse at 50% 50%, rgba(255,70,10,0) 38%, rgba(255,60,10,0.42) 78%, rgba(255,150,40,0.85) 100%); }
.prof-indic { position: absolute; left: 22px; bottom: 58px; display: flex; align-items: center; gap: 10px;
  font-size: 11px; letter-spacing: 0.22em; color: #ffb48a; opacity: 0; transition: opacity 0.5s ease; pointer-events: none; }
.prof-indic.visible { opacity: 0.85; }
.prof-indic-barre { position: relative; width: 74px; height: 3px; background: rgba(255,150,100,0.22); }
.prof-indic-barre > span { position: absolute; left: 0; top: 0; bottom: 0; background: #ff8a5a; box-shadow: 0 0 6px #ff6a2a; }
.prof-indic.critique { color: #ffd6b8; }
.prof-indic.critique .prof-indic-barre > span { background: #ffd0a0; }
.prof-flash { position: absolute; inset: 0; pointer-events: none; opacity: 0; background: #dff6ff; }
`;
    document.head.appendChild(s);
  },

  construireDom() {
    if (typeof document === 'undefined') return;
    const racine = document.querySelector('.ui-root') || document.body;
    const bords = document.createElement('div');
    bords.className = 'prof-bords';
    const indic = document.createElement('div');
    indic.className = 'prof-indic';
    const nom = document.createElement('span');
    nom.textContent = TEXTES.indicateurChaleur;
    const barre = document.createElement('span');
    barre.className = 'prof-indic-barre';
    const rempli = document.createElement('span');
    barre.appendChild(rempli);
    indic.append(nom, barre);
    racine.append(bords, indic);

    // barre de progression de l'arrachage : même forme que le forçage des portes (transgressions.js)
    const prog = document.createElement('div');
    prog.style.cssText = 'position:fixed;left:50%;bottom:31vh;transform:translateX(-50%);z-index:60;display:none;pointer-events:none;text-align:center;font:600 13px ui-monospace,Menlo,Consolas,monospace;color:#efe6ff;letter-spacing:.06em';
    const label = document.createElement('div');
    label.textContent = TEXTES.progression;
    label.style.cssText = 'margin-bottom:5px;text-shadow:2px 2px 0 rgba(8,2,22,.8)';
    const cadre = document.createElement('div');
    cadre.style.cssText = 'width:240px;height:14px;border:2px solid #c44bff;background:rgba(14,6,34,.86);box-shadow:4px 4px 0 rgba(8,2,22,.8)';
    const pr = document.createElement('div');
    pr.style.cssText = 'height:100%;width:0;background:#ff8a2b;box-shadow:0 0 8px #ff8a2b';
    cadre.appendChild(pr);
    prog.append(label, cadre);
    document.body.appendChild(prog);
    this.dom = { bords, indic, rempli, prog, pr, visible: false, critique: false, largeur: -1 };
  },

  majAffichage() {
    const d = this.dom;
    if (!d) return;
    const j = this.chaleur;
    const dansKura = this.actifZone;
    const o = dansKura ? borne((j - 0.12) / 0.88, 0, 1) * R.chaleur.rougeurMax : 0;
    d.bords.style.opacity = o.toFixed(3);
    const vis = dansKura && j > R.chaleur.seuilIndicateur;
    if (vis !== d.visible) { d.visible = vis; d.indic.classList.toggle('visible', vis); }
    const crit = j > 0.8;
    if (crit !== d.critique) { d.critique = crit; d.indic.classList.toggle('critique', crit); }
    const l = Math.round(j * 100);
    if (l !== d.largeur) { d.largeur = l; d.rempli.style.width = `${l}%`; }
    if (this.kz) this.kz.ondulationExtra = dansKura ? j * R.chaleur.ondulation : 0;
  },

  // ---------------------------------------------------------------------------------------- boucle
  update(dt, t, jeu) {
    if (!this.jeu) return;
    dt = Math.min(dt, 0.1);
    this.avancerMinuteries(dt);
    const kura = jeu.zones?.nom === 'kura';
    if (!kura || !this.pret) {
      if (this.actifZone) this.quitter();
      return;
    }
    this.actifZone = true;
    const p = jeu.player.position;
    const enJeu = jeu.jouable && !jeu.veilleur?.enEchec && !this._echecEnvoye;
    if (this._echecEnvoye && !jeu.veilleur?.enEchec && !jeu.suspensions.has('echec')) this._echecEnvoye = false;
    this.majCables(dt, t, jeu, enJeu);
    this.majAttente(dt, jeu);
    const prof = horsDansProf(p);
    if (prof) {
      this.majElectricite(dt, t, p, enJeu);
      this.majVentilateurs(dt, t, p, enJeu);
      this.majAir(dt);
      this.majBarrieres(dt, t, p, enJeu);
    } else {
      this.relacherBarrieres();
      this.majVentilateursRepos(dt);
    }
    this.majChaleur(dt, p, enJeu, prof);
    this.majAffichage();
  },

  /** On quitte la zone : tout revient au repos, rien ne tourne. */
  quitter() {
    this.actifZone = false;
    this.relacherBarrieres(true);
    this.chaleur = 0;
    this._palierChaleur = 0;
    this.arreterArrachage();
    for (const v of this.ventilateurs) if (v.rotor) { v.rotor.vitesse = v.vBase; v.facteur = 1; }
    if (this.kz) this.kz.ondulationExtra = 0;
    this.majAffichage();
  },

  // ---------------------------------------------------------------------------------------- échec commun
  echec(cause) {
    const jeu = this.jeu;
    if (this._echecEnvoye || !jeu.veilleur?.echec) return;
    this._echecEnvoye = true;
    this.arreterArrachage();
    jeu.emettre('profondeurs:echec', { cause });
    jeu.veilleur.echec(cause);
  },

  reprise() {
    this.chaleur = 0;
    this._palierChaleur = 0;
    this._chocT = 0;
    this._echecEnvoye = false;
    this.relacherBarrieres(true);
    for (const f of this.faces) f.dnPrev = null;
  },

  nouvellePartie() {
    this.chaleur = 0;
    this._palierChaleur = 0;
    this._echecEnvoye = false;
    this.minuteries.length = 0;
    this.relacherBarrieres(true);
    this.arreterArrachage();
    this.impulsion = null;
    for (const v of ETEINT.value) v.set(0, 1, 1, 0);
    this.effacerCablesVisuels();
    this.majAffichage();
  },

  // ---------------------------------------------------------------------------------------- chaleur
  majChaleur(dt, p, enJeu, prof) {
    const C = R.chaleur;
    if (!enJeu) return;
    let montee = 0;
    let chaud = false;
    if (prof) {
      for (const a of this.chaudes) if (dans(a, p.x, p.z)) { chaud = true; break; }
      for (const b of this.P.bouches) {
        const portee = b.rayon * C.porteeBouche;
        const d = Math.hypot(p.x - b.position[0], p.z - b.position[2]);
        if (d < portee) montee += C.bouche * (1 - d / portee) ** 2;
      }
    }
    const taux = chaud || montee > 0 ? (chaud ? C.montee : 0) + montee : -(prof ? C.refroidissement : C.refroidissementHors);
    this.chaleur = borne(this.chaleur + taux * dt, 0, 1);
    const palier = Math.floor(this.chaleur / 0.25);
    if (palier !== this._palierChaleur) {
      this._palierChaleur = palier;
      this.jeu.emettre('profondeurs:chaleur', { valeur: this.chaleur, palier });
    }
    // respiration : plus rapprochée quand la jauge monte
    if (this.chaleur > C.respiration.seuil) {
      this._respire -= dt;
      if (this._respire <= 0) {
        const k = borne((this.chaleur - C.respiration.seuil) / (1 - C.respiration.seuil), 0, 1);
        this._respire = C.respiration.intervalleCalme + (C.respiration.intervallePanique - C.respiration.intervalleCalme) * k;
        const a = this.jeu.audio;
        a?.souffle?.({ de: 320 + 400 * k, vers: 120, duree: 0.55 - 0.2 * k, volume: 0.025 + 0.06 * k, q: 0.7 });
        if (this.chaleur > 0.5) a?.tonalite?.({ de: 62, vers: 44, duree: 0.2, volume: 0.04 + 0.05 * k });
      }
    }
    if (this.chaleur >= 1) this.echec('chaleur');
  },

  /** Réglage direct (tests) */
  reglerChaleur(v) { this.chaleur = borne(v, 0, 1); },

  // ---------------------------------------------------------------------------------------- sol électrifié
  /** { phase: 'repos' | 'alerte' | 'actif', charge 0..1, reste (s avant la décharge ou avant le repos) } du bassin k (indice dans `bassins`). */
  etatBassin(k, t = this.jeu.t) {
    const b = this.bassins[k];
    const E = R.electricite;
    const u = ((t + b.off) % E.periode + E.periode) % E.periode;
    const debutActif = E.periode - E.decharge;
    const debutAlerte = debutActif - E.alerte;
    if (u >= debutActif) return { phase: 'actif', charge: 1, reste: E.periode - u };
    if (u >= debutAlerte) return { phase: 'alerte', charge: 0.25 + 0.2 * Math.sin(t * 40), reste: debutActif - u };
    return { phase: 'repos', charge: 0, reste: debutAlerte - u };
  },

  majElectricite(dt, t, p, enJeu) {
    const E = R.electricite;
    const g = this.nappe.geometry.getAttribute('aCharge');
    let proche = null;
    for (const b of this.bassins) {
      const s = this.etatBassin(b.k, t);
      b.phase = s.phase;
      b.charge = s.charge;
      for (let j = 0; j < 4; j++) g.setX(b.k * 4 + j, Math.max(0, s.charge));
      const r = b.rect;
      const d = Math.hypot(p.x - borne(p.x, r.minX, r.maxX), p.z - borne(p.z, r.minZ, r.maxZ));
      b.dist = d;
      // sons aux changements de phase
      if (s.phase !== b.prec) {
        const vol = borne(1 - d / 60, 0, 1);
        if (vol > 0.02) {
          if (s.phase === 'alerte') this.jeu.audio?.tonalite?.({ de: 240, vers: 820, duree: E.alerte, volume: 0.035 * vol, type: 'sawtooth' });
          if (s.phase === 'actif') this.jeu.audio?.souffle?.({ de: 4200, vers: 700, duree: 0.35, volume: 0.1 * vol, q: 2 });
        }
        b.prec = s.phase;
      }
      if (s.phase !== 'repos' && d < 70 && (!proche || d < proche.d)) proche = { b, d, s };
      // mortel : pieds dans le bassin chargé
      if (s.phase === 'actif' && enJeu && p.y < E.hauteurSure && dans(r, p.x, p.z, -0.15)) {
        this._chocT += dt;
        if (this._chocT >= E.grace) { this._chocT = 0; this.echec('electricite'); }
      }
    }
    if (!this.bassins.some((b) => b.phase === 'actif' && b.dist < 1 && p.y < E.hauteurSure && dans(b.rect, p.x, p.z, -0.15))) this._chocT = 0;
    g.needsUpdate = true;
    this.nappeMat.uniforms.uT.value = t;
    // arcs et crépitement
    this._arcT -= dt;
    if (this._arcT <= 0) { this._arcT = 0.07; this.majArcs(t); }
    this._crepite -= dt;
    if (proche && this._crepite <= 0) {
      this._crepite = proche.s.phase === 'actif' ? 0.16 : 0.5;
      const vol = borne(1 - proche.d / 60, 0, 1) ** 1.5 * (proche.s.phase === 'actif' ? 0.07 : 0.025);
      if (vol > 0.003) this.jeu.audio?.souffle?.({ de: rand(2600, 5200), vers: rand(700, 1500), duree: rand(0.04, 0.1), volume: vol, q: 3 });
    }
  },

  majArcs(t) {
    const pos = this.arcPos;
    const SEG = this.segArc;
    const A = this.arcsParBassin;
    let o = 0;
    for (const b of this.bassins) {
      const r = b.rect;
      for (let a = 0; a < A; a++) {
        const actif = b.phase === 'actif' || (b.phase === 'alerte' && a < 1 && Math.random() < 0.5);
        const hmax = b.phase === 'actif' ? rand(0.5, 1.5) : 0.25;
        let x0 = rand(r.minX, r.maxX), z0 = rand(r.minZ, r.maxZ);
        let x1 = borne(x0 + rand(-4, 4), r.minX, r.maxX), z1 = borne(z0 + rand(-1.5, 1.5), r.minZ, r.maxZ);
        let px = x0, py = DY + 0.1, pz = z0;
        for (let s = 0; s < SEG; s++) {
          const u = (s + 1) / SEG;
          const nx = x0 + (x1 - x0) * u + (s < SEG - 1 ? rand(-0.35, 0.35) : 0);
          const nz = z0 + (z1 - z0) * u + (s < SEG - 1 ? rand(-0.35, 0.35) : 0);
          const ny = DY + 0.1 + (s < SEG - 1 ? Math.sin(u * Math.PI) * hmax * rand(0.4, 1) : 0);
          if (actif) pos.set([px, py, pz, nx, ny, nz], o);
          else pos.fill(0, o, o + 6);
          o += 6;
          px = nx; py = ny; pz = nz;
        }
      }
    }
    this.arcs.geometry.getAttribute('position').needsUpdate = true;
  },

  // ---------------------------------------------------------------------------------------- ventilateurs
  /** Mode du cycle : { mode: 'aspiration' | 'poussee' | 'repit', k: 0..1 d'intensité }. */
  modeVentilateur(v, t) {
    const F = R.ventilateurs;
    const u = (((t + v.i * 5.3) % F.periode) + F.periode) % F.periode;
    if (u < F.aspiration) return { mode: 'aspiration', k: Math.min(1, u / 0.8, (F.aspiration - u) / 0.8 + 0.25) };
    if (u < F.aspiration + F.repit) return { mode: 'repit', k: 0 };
    if (u < F.aspiration + F.repit + F.poussee) { const w = u - F.aspiration - F.repit; return { mode: 'poussee', k: Math.min(1, w / 0.8, (F.poussee - w) / 0.8 + 0.25) }; }
    return { mode: 'repit', k: 0 };
  },

  majVentilateursRepos(dt) {
    for (const v of this.ventilateurs) {
      if (!v.rotor) continue;
      v.facteur += (1 - v.facteur) * Math.min(1, dt * 1.5);
      v.rotor.vitesse = v.vBase * v.facteur;
    }
  },

  majVentilateurs(dt, t, p, enJeu) {
    const F = R.ventilateurs;
    const jeu = this.jeu;
    const vit = jeu.player.velocity;
    this._souffleFan -= dt;
    for (const v of this.ventilateurs) {
      const m = this.modeVentilateur(v, t);
      v.mode = m.mode;
      // rotation : à l'endroit en aspiration, à l'envers et un peu plus lente en poussée, presque au repos entre deux
      const cible = m.mode === 'aspiration' ? 1 : m.mode === 'poussee' ? -0.8 : 0.12;
      v.facteur += (cible - v.facteur) * Math.min(1, dt * 1.4);
      if (v.rotor) v.rotor.vitesse = v.vBase * v.facteur;
      const [cx, cy, cz] = v.position;
      const dx = p.x - cx, dz = p.z - cz, dy = p.y + 0.9 - cy;
      const d = Math.hypot(dx, dy, dz);
      const along = dx * v.ax + dz * v.az; // > 0 : du côté du couloir
      v.dist = d;
      if (along < -0.8) { v.force = 0; continue; }
      // dérive : vers le rotor (aspiration) ou loin de lui (poussée)
      let force = 0;
      if (m.mode !== 'repit' && d < F.portee) {
        const vd = (m.mode === 'aspiration' ? F.vitesseAspiration : F.vitessePoussee) * (1 - d / F.portee) ** 1.5 * m.k;
        const h = Math.hypot(dx, dz) || 1;
        const sens = m.mode === 'aspiration' ? -1 : 1; // -1 : vers le rotor
        if (enJeu) {
          const a = vd * (jeu.player.auSol ? 12 : 3);
          vit.x += (dx / h) * sens * a * dt;
          vit.z += (dz / h) * sens * a * dt;
        }
        force = vd;
      }
      v.force = force;
      // bruit de l'air, proportionnel à la force ressentie
      if (force > 0.12 && this._souffleFan <= 0) {
        this._souffleFan = 0.35;
        jeu.audio?.souffle?.({ de: m.mode === 'aspiration' ? 500 : 900, vers: m.mode === 'aspiration' ? 260 : 400, duree: 0.6, volume: Math.min(0.1, 0.02 + force * 0.04), q: 0.6 });
      }
      // pales : tranche devant la paroi, sur le disque du rotor (le corps déborde de 0,6 m)
      if (enJeu && along < F.epaisseurPales) {
        const yb = borne(cy, p.y, p.y + 1.85);
        const lat = Math.abs(dx * Math.abs(v.az) + dz * Math.abs(v.ax) - 0); // distance latérale à l'axe
        if (Math.hypot(Math.max(0, lat - F.margeLaterale), yb - cy) <= v.rayon) this.echec('ventilateur');
      }
    }
  },

  // ---------------------------------------------------------------------------------------- barrières
  barriereActive() { return this.faces.some((f) => f.collider); },

  /** Les faces qui se dressent ou sont dressées en ce moment. */
  get dressees() { return this.faces.filter((f) => f.alpha > 0.02); },

  majBarrieres(dt, t, p, enJeu) {
    const jeu = this.jeu;
    const B = R.barrieres;
    const sourd = !!jeu.sourdine?.actif;
    const vx = jeu.player.velocity.x, vz = jeu.player.velocity.z;
    const vit = Math.hypot(vx, vz);
    let hx = 0, hz = 0, cap = false;
    if (vit > B.vitesseMin) { hx = vx / vit; hz = vz / vit; cap = true; }
    // regard (maintien : on peut s'être arrêté contre le plan)
    const yaw = jeu.player.orientation().yaw;
    const rx = -Math.sin(yaw), rz = -Math.cos(yaw);
    const dirx = cap ? hx : rx, dirz = cap ? hz : rz;
    for (const f of this.faces) {
      const px = p.x - f.c[0], pz = p.z - f.c[1];
      const dn = px * f.n[0] + pz * f.n[1];
      const lat = px * f.t[0] + pz * f.t[1];
      const hn = dirx * f.n[0] + dirz * f.n[1];
      const ht = dirx * f.t[0] + dirz * f.t[1];
      // T10 : de l'extérieur vers l'intérieur d'une allée mortelle, Sourdine ouverte
      if (f.compte && enJeu && f.dnPrev !== null && f.dnPrev > 0 && dn <= 0 && Math.abs(f.dnPrev) < 3 && Math.abs(lat) <= f.demi && p.y < f.haut && sourd) this.franchir(f);
      f.dnPrev = dn;
      if (!f.actif() || sourd || !enJeu) {
        if (f.voulu) f.voulu = false;
      } else {
        if (!f.voulu) {
          // formation : on marche vers le plan, à moins de `portee`
          if (cap && dn > B.distanceMini && hn < -0.15) {
            const th = dn / -hn;
            const latHit = lat + th * ht;
            if (th <= B.portee && dn < B.portee && Math.abs(latHit) <= f.demi + 0.5) { f.voulu = true; f.hors = 0; this.dresser(f); }
          }
        } else {
          // maintien : tant qu'on la regarde ou qu'on avance vers elle (même arrêté contre le plan)
          let garde = false;
          if (dn > 0.05 && dn < B.maintien && hn < -0.05) {
            const th = dn / -hn;
            garde = th <= B.maintien && Math.abs(lat + th * ht) <= f.demi + 2.2;
          }
          f.hors = garde ? 0 : f.hors + dt;
          if (dn <= 0.05 || f.hors > B.delaiEffacement) f.voulu = false;
        }
      }
      // animation
      const cible = f.voulu ? 1 : 0;
      if (f.alpha !== cible) {
        const vitesse = sourd ? 1 / B.tauxCoupure : f.voulu ? 1 / B.montee : 1 / B.descente;
        f.alpha = f.alpha < cible ? Math.min(cible, f.alpha + dt * vitesse) : Math.max(cible, f.alpha - dt * vitesse);
      }
      // collider : présent tant qu'elle est voulue et à moitié formée
      const veutCollider = f.voulu && f.alpha > 0.5;
      if (veutCollider && !f.collider) this.poserCollider(f);
      else if (!veutCollider && f.collider) this.retirerCollider(f);
      // maillage
      if (f.alpha > 0.01) this.afficher(f, t);
      else if (f.mesh) this.liberer(f);
    }
  },

  dresser(f) {
    const jeu = this.jeu;
    jeu.audio?.tonalite?.({ de: 170, vers: 340, duree: 0.55, volume: 0.03, type: 'triangle' });
    jeu.emettre('profondeurs:barriere', { id: f.id, type: f.type });
    const e = ep(jeu);
    if (!e.barriereVue) {
      e.barriereVue = true;
      jeu.hud?.mima(TEXTES.premiereBarriere, { duree: 7 });
      jeu.sauver?.();
    }
  },

  poserCollider(f) {
    const ep2 = R.barrieres.epaisseur / 2;
    const [cx, cz] = f.c;
    const surX = Math.abs(f.n[0]) > 0.5;
    const c = surX
      ? { minX: cx - ep2, maxX: cx + ep2, minZ: cz - f.demi, maxZ: cz + f.demi, minY: DY - 1, maxY: DY + PLAFOND, barriere: f.id }
      : { minX: cx - f.demi, maxX: cx + f.demi, minZ: cz - ep2, maxZ: cz + ep2, minY: DY - 1, maxY: DY + PLAFOND, barriere: f.id };
    f.collider = c;
    this.kz.colliders.push(c);
  },

  retirerCollider(f) {
    if (!f.collider) return;
    const i = this.kz.colliders.indexOf(f.collider);
    if (i >= 0) this.kz.colliders.splice(i, 1);
    f.collider = null;
  },

  afficher(f, t) {
    if (!f.mesh) {
      const e = this.pool.find((x) => !x.face);
      if (!e) return;
      e.face = f;
      f.mesh = e;
      e.mesh.visible = true;
      e.mesh.scale.set(f.demi * 2, f.haut, 1);
      e.mesh.position.set(f.c[0], f.y0 + f.haut / 2, f.c[1]);
      e.mesh.rotation.set(0, Math.atan2(f.n[0], f.n[1]), 0);
      e.mat.uniforms.uSize.value.set(f.demi * 2, f.haut);
      e.mat.uniforms.uSeed.value = (f.c[0] * 7.3 + f.c[1] * 3.1) % 50;
    }
    const e = f.mesh;
    e.mat.uniforms.uAlpha.value = f.alpha;
    e.mat.uniforms.uT.value = t;
  },

  liberer(f) {
    const e = f.mesh;
    if (!e) return;
    e.face = null;
    e.mesh.visible = false;
    e.mat.uniforms.uAlpha.value = 0;
    f.mesh = null;
  },

  /** Toutes les barrières tombent (sortie des Profondeurs, reprise, zone quittée). `net` : tout de suite. */
  relacherBarrieres(net = false) {
    for (const f of this.faces) {
      f.voulu = false;
      f.dnPrev = null;
      if (f.collider) this.retirerCollider(f);
      if (net) f.alpha = 0;
      else f.alpha = Math.max(0, f.alpha - 0.05);
      if (f.alpha <= 0.01 && f.mesh) this.liberer(f);
    }
  },

  // ---------------------------------------------------------------------------------------- T10
  franchir(f) {
    const jeu = this.jeu;
    const e = ep(jeu);
    const t = jeu.etat.transgressions;
    t.T10 = (t.T10 || 0) + 1;
    const n = t.T10;
    if (!Array.isArray(jeu.etat.journal)) jeu.etat.journal = [];
    jeu.etat.journal.push({ id: 'T10', quoi: JOURNAL.T10.quoi, ou: JOURNAL.T10.ou, t: Math.round(jeu.t * 10) / 10 });
    e.attente.push({ id: 'T10', n, duree: 0, source: f.id });
    jeu.sauver?.();
    jeu.audio?.tonalite?.({ de: 90, vers: 55, duree: 0.4, volume: 0.03 });
  },

  /** Sourdine fermée : ce qui attendait est dit (l'Attention est de nouveau à l'écoute). */
  finSourdine() {
    this.viderAttente();
  },

  majAttente(dt, jeu) {
    const e = ep(jeu);
    if (!e.attente.length) return;
    if (jeu.sourdine?.actif) {
      for (const a of e.attente) if (a.id === 'T10') a.duree += dt;
      return;
    }
    if (jeu.jouable) this.viderAttente();
  },

  viderAttente() {
    const jeu = this.jeu;
    const e = ep(jeu);
    if (jeu.sourdine?.actif || !e.attente.length) return;
    const liste = e.attente.splice(0);
    let premier = true;
    for (const a of liste) {
      jeu.emettre('transgression', { id: a.id, source: a.source, detail: { secondes: a.duree }, n: a.n });
      if (a.id === 'T10' && premier) {
        premier = false;
        this.apres(R.t10.delaiParole, () => this.direT10(a));
      } else if (a.id === 'T12') {
        this.apres(R.t12.delaiMima, () => this.direT12(a.n));
      }
    }
    jeu.sauver?.();
  },

  direT10(a) {
    const REP = REP_T10();
    const s = Math.max(1, Math.round(a.duree));
    const base = a.n <= 1 ? REP.premiere : a.n === 2 ? REP.deuxieme : (REP.suite || [])[(a.n - 3) % Math.max(1, (REP.suite || []).length)] || REP.deuxieme;
    const txt = String(base)
      .replace(/\{secondes\} secondes/g, s === 1 ? 'une seconde' : `${enLettres(s)} secondes`)
      .replace(/\{secondes\}/g, String(s));
    this.jeu.hud?.mima(txt, { duree: 9 });
  },

  direT12(rang) {
    const REP = REP_T12();
    let txt;
    if (rang <= 1) txt = REP.premiere;
    else if (rang === 2) txt = REP.deuxieme;
    else txt = (REP.suite || [])[(rang - 3) % Math.max(1, (REP.suite || []).length)];
    if (!txt || /^[…\s.]+$/.test(txt)) return; // silence
    this.jeu.hud?.mima(txt, { duree: 8 });
  },

  apres(secondes, fn) { this.minuteries.push({ t: secondes, fn }); },

  avancerMinuteries(dt) {
    for (const m of this.minuteries) m.t -= dt;
    const pretes = this.minuteries.filter((m) => m.t <= 0);
    if (!pretes.length) return;
    this.minuteries = this.minuteries.filter((m) => m.t > 0);
    for (const m of pretes) { try { m.fn(); } catch (err) { console.error('[profondeurs]', err); } }
  },

  // ---------------------------------------------------------------------------------------- T12 : les câbles
  creerObjetsCables() {
    const jeu = this.jeu;
    const liste = jeu.kura?.profondeurs?.cables;
    if (!liste) return;
    this.cables = liste.map((c, i) => {
      const [x, y, z] = c.position;
      const hall = z > -60;
      const cable = { i, x, y, z, hall, sleeve: null, spark: null };
      cable.objet = jeu.interact.ajouter({
        zone: 'kura', position: [x, hall ? 2.4 : 2.2, z], rayon: 3.4, cone: 0.75,
        libelle: () => (ep(jeu).gestes >= 2 ? TEXTES.libelleCableVerrouille : TEXTES.libelleCable),
        sansEtiquette: true,
        visible: () => !ep(jeu).arraches.includes(i),
        action: () => this.commencerArrachage(cable),
      });
      return cable;
    });
  },

  commencerArrachage(c) {
    if (this.arrachage) return;
    this.arrachage = { cable: c, t: 0 };
  },

  arreterArrachage() {
    this.arrachage = null;
    if (this.dom) this.dom.prog.style.display = 'none';
  },

  majCables(dt, t, jeu, enJeu) {
    // impulsion qui court le long d'une rangée (réaction du Pays)
    const im = this.impulsion;
    if (im) {
      im.t += dt;
      if (im.t >= im.duree) { this.impulsion = null; ETEINT.value[3].set(0, 1, 1, 0); } else {
        ETEINT.value[3].set(im.x + im.vitesse * im.t, im.z, im.rayon, -0.9 * Math.min(1, (im.duree - im.t) / 0.6));
      }
    }
    // étincelles au bout des câbles arrachés (seulement ceux qu'on peut voir)
    for (const c of this.cables) {
      if (!c.spark) continue;
      const visible = c.hall ? this.groupeHall?.visible : this.groupeProf?.visible;
      c.spark.visible = !!visible && Math.random() < 0.55;
      if (c.spark.visible) c.spark.material.opacity = rand(0.4, 1);
    }
    const a = this.arrachage;
    if (!a) return;
    const p = jeu.player.position;
    const c = a.cable;
    if (!enJeu || !jeu.input.isDown('KeyE') || Math.hypot(p.x - c.x, p.z - c.z) > R.t12.portee || ep(jeu).arraches.includes(c.i)) {
      this.arreterArrachage();
      return;
    }
    a.t += dt;
    const k = Math.min(1, a.t / R.t12.duree);
    this.dom.prog.style.display = 'block';
    this.dom.pr.style.width = `${Math.round(k * 100)}%`;
    if (a.t >= R.t12.duree) {
      this.arreterArrachage();
      this.arracher(c.i);
    }
  },

  /** Termine l'arrachage du câble i (aussi pour les tests). Renvoie le rang du geste. */
  arracher(i) {
    const jeu = this.jeu;
    const c = this.cables[i];
    const e = ep(jeu);
    if (!c || e.arraches.includes(i)) return 0;
    e.gestes += 1;
    const g = e.gestes;
    const L = PAYS();
    const tx = g === 1 ? L.premiere : g === 2 ? L.deuxieme : L.suite;
    // ---- le monde
    jeu.audio?.tonalite?.({ de: 220, vers: 60, duree: 0.45, volume: 0.07, type: 'sawtooth' });
    jeu.audio?.souffle?.({ de: 5200, vers: 600, duree: 0.4, volume: 0.12, q: 1.5 });
    if (g <= 2) {
      e.arraches.push(i);
      this.appliquerCable(c, g, true);
      const t = jeu.etat.transgressions;
      t.T12 = (t.T12 || 0) + 1;
      if (!Array.isArray(jeu.etat.journal)) jeu.etat.journal = [];
      jeu.etat.journal.push({ id: 'T12', quoi: JOURNAL.T12.quoi, ou: c.hall ? JOURNAL.ouHall : JOURNAL.ouProfondeurs, t: Math.round(jeu.t * 10) / 10 });
      e.attente.push({ id: 'T12', n: t.T12, duree: 0, source: `cable-${i}` });
      if (g === 2) this.ecrireSept();
    } else {
      this.lancerImpulsion(c, 5, 8, 3.2); // « une impulsion lente traverse la rangée, une seule fois »
    }
    // réaction du Pays : lignes lentes, puis ce que montre la Lecture au 1er arrachage
    const lignes = [...(Array.isArray(tx) ? tx : [tx])];
    if (g === 1 && jeu.lecture?.possede && L.lecturePremiere) lignes.push(L.lecturePremiere);
    lignes.forEach((l, k) => this.apres(0.8 + k * R.t12.pause, () => jeu.hud?.notifier(l, { duree: 5 })));
    if (g >= 3) this.apres(R.t12.delaiMima, () => this.direT12(g));
    jeu.sauver?.();
    if (g <= 2) this.viderAttente();
    return g;
  },

  ecrireSept() {
    const jeu = this.jeu;
    const e = ep(jeu);
    e.pourquoi = true;
    const ligne = REP_T12().ecranRefuge || 'pourquoi';
    try { jeu.kura?.ecrans?.sept?.ecrire?.([ligne], { couleur: '#9fd8ff', taille: 64 }); } catch (err) { /* écran absent */ }
  },

  /** Ce que le monde garde du câble arraché : gaine sombre sur le cœur lumineux, étincelle au bout, baies éteintes. */
  appliquerCable(c, ordre, effets) {
    if (!c.sleeve) {
      // le bout arraché pend, noir, et crache des étincelles ; le cœur lumineux disparaît (reconstruireNoyaux)
      const parent = c.hall ? this.groupeHall : this.groupeProf;
      const ang = 0.32 + (c.i % 3) * 0.12;
      const long = 1.7;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.07, long, 6), new THREE.MeshBasicMaterial({ color: 0x06040c }));
      m.position.set(c.x + Math.sin(ang) * long / 2, c.y - 1.6 - Math.cos(ang) * long / 2, c.z);
      m.rotation.z = ang;
      parent.add(m);
      c.sleeve = m;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffa860, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, transparent: true, fog: false }));
      s.scale.set(0.7, 0.7, 1);
      s.position.set(c.x + Math.sin(ang) * long, c.y - 1.6 - Math.cos(ang) * long, c.z);
      parent.add(s);
      c.spark = s;
    }
    this.reconstruireNoyaux();
    const V = ETEINT.value;
    const Rg = R.t12;
    if (ordre === 1) V[0].set(c.x, c.z, Rg.rayonPremier, 1);
    else {
      V[1].set(c.x, c.z, Rg.rayonAllee, 1);
      const ax = c.x + (c.x < 330 ? Rg.decalageAilleurs : -Rg.decalageAilleurs);
      V[2].set(ax, c.z, Rg.rayonAilleurs, -1);
    }
    if (effets) this.lancerImpulsion(c, ordre === 1 ? 4 : 10, ordre === 1 ? 12 : 20, ordre === 1 ? 2.4 : 5);
  },

  /** Cœur lumineux des câbles encore en place : deux maillages fusionnés (Hall, Profondeurs). */
  reconstruireNoyaux() {
    const e = ep(this.jeu);
    this.noyaux ||= { hall: null, prof: null };
    for (const k of ['hall', 'prof']) {
      const m = this.noyaux[k];
      if (m) { m.parent?.remove(m); m.geometry.dispose(); this.noyaux[k] = null; }
      const geos = [];
      for (const c of this.cables) {
        if ((c.hall ? 'hall' : 'prof') !== k || e.arraches.includes(c.i)) continue;
        const g = new THREE.CylinderGeometry(0.17, 0.17, 4.7, 6);
        g.translate(c.x, c.y - 1.6 + 2.35, c.z);
        geos.push(g);
      }
      if (!geos.length) continue;
      const mat = this.matNoyau?.[k] || ((this.matNoyau ||= {})[k] = new THREE.MeshBasicMaterial({ color: k === 'hall' ? 0x6fa4ff : 0xff9a50, toneMapped: false }));
      const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
      (k === 'hall' ? this.groupeHall : this.groupeProf).add(mesh);
      this.noyaux[k] = mesh;
      geos.forEach((g) => g.dispose());
    }
  },

  lancerImpulsion(c, vitesse, longueur, duree) {
    this.impulsion = { x: c.x, z: c.z, vitesse, duree: Math.min(duree, longueur / vitesse + 0.5), t: 0, rayon: 4 };
  },

  effacerCablesVisuels() {
    for (const c of this.cables) {
      for (const k of ['sleeve', 'spark']) {
        if (!c[k]) continue;
        c[k].parent?.remove(c[k]);
        c[k].geometry?.dispose?.();
        c[k].material?.dispose?.();
        c[k] = null;
      }
    }
  },

  /** Rechargement : câbles arrachés et baies éteintes d'après `etat.profondeurs` ; Sept reprend son « pourquoi ». */
  restaurerCables() {
    const jeu = this.jeu;
    const e = ep(jeu);
    this.effacerCablesVisuels();
    for (const v of ETEINT.value) v.set(0, 1, 1, 0);
    e.arraches.forEach((idx, k) => { const c = this.cables[idx]; if (c) this.appliquerCable(c, k + 1, false); });
    this.reconstruireNoyaux();
    if (e.pourquoi) this.ecrireSept();
  },
};
