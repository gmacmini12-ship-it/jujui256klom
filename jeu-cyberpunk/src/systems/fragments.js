import * as THREE from 'three';
import { jeu } from '../game.js';
import { ajouterFragment, aPouvoir } from '../state.js';
import { FRAGMENTS } from '../data/fragments.js';
import { POSITIONS_FRAGMENTS, TEXTES_FRAGMENTS } from '../data/fragments-positions.js';

// Ramassage des fragments du passé (bible §6).
// Chaque fragment est un éclat qui flotte et tourne, avec un halo additif qui accroche le bloom.
// Position : src/data/fragments-positions.js. Texte : src/data/fragments.js.

const DUREE_DISPARITION = 0.7;
const DELAI_LECTURE = 0.55;
const RAYON_DEFAUT = 2.4;

const sansAccent = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const parId = new Map(FRAGMENTS.map((f) => [f.id, f]));

// ---------- Matériaux et géométries partagés ----------
let partage = null;
function ressources() {
  if (partage) return partage;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.18, 'rgba(255,170,245,0.55)');
  grad.addColorStop(0.5, 'rgba(160,80,255,0.16)');
  grad.addColorStop(1, 'rgba(120,60,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const halo = new THREE.CanvasTexture(c);
  halo.colorSpace = THREE.SRGBColorSpace;
  partage = {
    halo,
    geoCoeur: new THREE.OctahedronGeometry(0.13, 0),
    geoCoque: new THREE.OctahedronGeometry(0.2, 0),
  };
  return partage;
}

// ---------- Supports simples (boîtes et plans) ----------
function textureAffiche() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = '#24113f'; g.fillRect(0, 0, 64, 96);
  g.fillStyle = '#3d2a78'; g.fillRect(4, 4, 56, 88);
  g.fillStyle = '#c44bff'; g.globalAlpha = 0.55;
  g.beginPath(); g.arc(32, 36, 17, 0, Math.PI * 2); g.fill();
  g.globalAlpha = 0.35; g.fillStyle = '#ff5ad0';
  for (let y = 62; y < 90; y += 7) g.fillRect(10, y, 44 - (y % 3) * 6, 3);
  g.globalAlpha = 1;
  // coin décollé : triangle clair en bas à droite
  g.fillStyle = '#0c0718'; g.beginPath(); g.moveTo(64, 70); g.lineTo(64, 96); g.lineTo(36, 96); g.fill();
  g.fillStyle = '#6a5aa8'; g.beginPath(); g.moveTo(64, 70); g.lineTo(36, 96); g.lineTo(52, 74); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

function textureAutocollant() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#8f86b8'; g.fillRect(0, 0, 32, 32);
  g.fillStyle = '#4a3d7a'; g.fillRect(2, 2, 28, 28);
  g.fillStyle = '#bfb2f0';
  for (let y = 6; y < 26; y += 5) g.fillRect(5, y, 22 - (y % 4) * 3, 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

function construireSupport(s, scene) {
  if (!s) return;
  const def = typeof s === 'string' ? { type: s } : s;
  const [x, y, z] = def.position || [0, 0, 0];
  const yaw = def.yaw || 0;
  let m = null;
  if (def.type === 'papier') {
    m = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.012, 0.2),
      new THREE.MeshStandardMaterial({ color: 0xd9d2f0, roughness: 0.9, emissive: 0x4a3d7a, emissiveIntensity: 0.6 })
    );
    m.rotation.set(0.04, yaw, 0.03);
  } else if (def.type === 'affiche') {
    m = new THREE.Mesh(
      new THREE.PlaneGeometry(1.0, 1.5),
      new THREE.MeshBasicMaterial({ map: textureAffiche(), toneMapped: false, side: THREE.DoubleSide })
    );
    m.rotation.y = yaw;
  } else if (def.type === 'autocollant') {
    m = new THREE.Mesh(
      new THREE.PlaneGeometry(0.24, 0.24),
      new THREE.MeshBasicMaterial({ map: textureAutocollant(), toneMapped: false })
    );
    m.rotation.y = yaw;
  }
  if (!m) return;
  m.position.set(x, y, z);
  scene.add(m);
}

// ---------- Condition (pouvoir requis) ----------
function conditionRemplie(f) {
  if (!f.condition) return true;
  const voulu = sansAccent(f.condition);
  return jeu.etat.pouvoirs.some((p) => sansAccent(p) === voulu) || aPouvoir(f.condition);
}

const deja = (id) => jeu.etat.fragments.includes(id);

// Un pouvoir de déplacement (Bond, Harnais) ne cache pas le fragment : on le voit sur son toit,
// on ne pourra le prendre qu'une fois le pouvoir acquis. Les pouvoirs de perception (Lecture,
// Écho, Calque…) le gardent invisible tant qu'on ne les a pas.
const POUVOIRS_DEPLACEMENT = new Set(['bond', 'harnais']);
const apercu = (f) => conditionRemplie(f) || POUVOIRS_DEPLACEMENT.has(sansAccent(f.condition));

export const fragments = {
  nom: 'fragments',
  zonesConstruites: new Set(),
  objets: [], // { def, data, groupe, coeur, coque, halo, mats, interaction, base, phase, fin }
  temps: 0,
  lecture: null, // { f, reste }

  init(jeu) {
    jeu.on('partie:nouvelle', () => {
      this.lecture = null;
      for (const o of this.objets) this.remettre(o);
    });
  },

  surZone(nom, zone) {
    if (this.zonesConstruites.has(nom)) return;
    this.zonesConstruites.add(nom);
    for (const def of POSITIONS_FRAGMENTS) {
      if (def.zone !== nom) continue;
      const data = parId.get(def.id);
      if (!data) continue;
      this.construire(def, data, zone);
    }
  },

  construire(def, data, zone) {
    const { halo, geoCoeur, geoCoque } = ressources();
    const taille = def.taille || 1;
    const groupe = new THREE.Group();
    const [x, y, z] = def.position;
    groupe.position.set(x, y, z);
    groupe.scale.setScalar(taille);

    const matCoeur = new THREE.MeshBasicMaterial({ color: 0xffd9fb, toneMapped: false, transparent: true });
    const matCoque = new THREE.MeshBasicMaterial({
      color: 0xb05bff, toneMapped: false, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const matHalo = new THREE.SpriteMaterial({
      map: halo, color: 0xff7ae6, transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false,
    });
    const coeur = new THREE.Mesh(geoCoeur, matCoeur);
    coeur.scale.set(0.8, 1.45, 0.8);
    const coque = new THREE.Mesh(geoCoque, matCoque);
    coque.scale.set(0.8, 1.45, 0.8);
    const sprite = new THREE.Sprite(matHalo);
    sprite.scale.setScalar(1.3);
    groupe.add(coeur, coque, sprite);
    zone.scene.add(groupe);

    construireSupport(def.support, zone.scene);

    const o = {
      def, data, groupe, coeur, coque, halo: sprite,
      mats: { coeur: matCoeur, coque: matCoque, halo: matHalo },
      opacites: { coeur: 1, coque: 0.55, halo: 0.8 },
      base: new THREE.Vector3(x, y, z),
      phase: (def.id * 1.7) % 6.28,
      fin: null,
      interaction: null,
    };
    o.interaction = jeu.interact.ajouter({
      zone: def.zone,
      position: [x, y, z],
      rayon: def.rayon || RAYON_DEFAUT,
      libelle: def.invite || TEXTES_FRAGMENTS.invite,
      visible: () => this.prenable(o),
      action: () => this.prendre(o),
    });
    this.objets.push(o);
    this.majVisibilite(o);
  },

  prenable(o) {
    return o.fin === null && !deja(o.data.id) && conditionRemplie(o.data);
  },

  majVisibilite(o) {
    const montre = o.fin !== null || (!deja(o.data.id) && apercu(o.data));
    o.groupe.visible = montre;
  },

  remettre(o) {
    o.fin = null;
    o.groupe.scale.setScalar(o.def.taille || 1);
    o.mats.coeur.opacity = o.opacites.coeur;
    o.mats.coque.opacity = o.opacites.coque;
    o.mats.halo.opacity = o.opacites.halo;
    this.majVisibilite(o);
  },

  prendre(o) {
    if (!this.prenable(o)) return;
    if (!ajouterFragment(o.data.id)) return;
    o.fin = 0;
    const touche = (() => { try { return jeu.input.label('KeyJ'); } catch (e) { return 'J'; } })();
    jeu.hud.notifier(TEXTES_FRAGMENTS.notification(o.data, touche), { duree: 5 });
    try {
      jeu.audio?.bip({ frequence: 698, duree: 0.45, volume: 0.06 });
      setTimeout(() => { try { jeu.audio?.bip({ frequence: 1047, duree: 0.7, volume: 0.05 }); } catch (e) { /* silence */ } }, 130);
    } catch (e) { /* le son est facultatif */ }
    this.lecture = { f: o.data, reste: DELAI_LECTURE };
  },

  lire(f) {
    const entete = f.annee == null ? f.titre : `${f.titre}  ·  ${f.annee}`;
    jeu.ouvrirDialogue({
      debut: 'n1',
      noeuds: { n1: { qui: '', texte: `${entete}\n\n${f.texte}` } },
    });
  },

  update(dt, t) {
    this.temps = t;
    if (this.lecture) {
      this.lecture.reste -= dt;
      if (this.lecture.reste <= 0) {
        const f = this.lecture.f;
        this.lecture = null;
        this.lire(f);
      }
    }
    for (const o of this.objets) {
      const trouve = deja(o.data.id);
      if (o.fin === null) {
        if (trouve || !apercu(o.data)) { o.groupe.visible = false; continue; }
        o.groupe.visible = true;
      } else if (o.fin >= DUREE_DISPARITION) {
        o.groupe.visible = false;
        continue;
      }
      if (jeu.zones.nom !== o.def.zone) continue;

      const taille = o.def.taille || 1;
      o.groupe.position.set(o.base.x, o.base.y + Math.sin(t * 1.6 + o.phase) * 0.07, o.base.z);
      o.coeur.rotation.y = t * 0.9 + o.phase;
      o.coque.rotation.y = -t * 0.6 - o.phase;
      o.coque.rotation.z = 0.25 * Math.sin(t * 0.7 + o.phase);
      const pulse = 1 + 0.08 * Math.sin(t * 2.3 + o.phase);
      o.halo.scale.setScalar(1.3 * pulse);

      if (o.fin !== null) {
        o.fin += dt;
        const k = Math.min(1, o.fin / DUREE_DISPARITION);
        const sortie = 1 - (1 - k) * (1 - k);
        o.coeur.rotation.y += k * 12 * dt * 10;
        o.groupe.scale.setScalar(taille * (1 + 1.6 * sortie));
        o.groupe.position.y += 0.5 * sortie;
        o.mats.coeur.opacity = 1 - k;
        o.mats.coque.opacity = o.opacites.coque * (1 - k);
        o.mats.halo.opacity = o.opacites.halo * (1 - k);
      }
    }
  },
};
