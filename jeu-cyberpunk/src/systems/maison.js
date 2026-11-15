import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TITRES_ZONES } from '../data/interface.js';
import {
  TITRE_ZONE, FACADE, PERSONNAGES as TEXTES, APPARENCES,
} from '../data/maison.js';
import { LIEUX } from '../zones/maison.js';
import { npc } from './npc.js';

// Système « maison » (étape 4) : la Maison des Conseils, côté ville et côté personnages (bible §5.4, §9).
//
// L'intérieur est la zone `maison` (zones/maison.js, textes dans data/maison.js).
//
// ENTRÉE : le pâté [4, 2] de Kasumi (centre (0, −120), au nord de la tour Hashira, dans l'axe de la Salle des
//   Mains Courantes) est réservé (`jeu.config.ville.blocsReserves`) et remplacé par la façade : un volume de bois
//   sombre de 38 × 22 × 38 m, un portique de six colonnes sur le trottoir, le fronton gravé
//   « Vous ne posséderez rien et vous serez heureux » (texte de la bible) et, au coin sud-est, un pylône
//   à l'enseigne 相談所 qui dépasse des toits (visible depuis l'avenue de la clinique).
//   Porte : (0, −100,7), côté rue (z = −98 : le trottoir). Point d'arrivée en ville :
//   `jeu.zones.get('kasumi').points.maison` = (0, 0, −96,5), face au sud.
//   Chemin depuis la clinique (38, 44) : carrefour (30, 30), rue x = 30 jusqu'à z = −90, puis à l'ouest jusqu'à x = 0
//   (environ 190 m, une demi-minute de marche).
//
// PERSONNAGES (silhouettes de npc.js), créés à la première entrée dans la zone :
//   sall, patient (Clinique du Jugement), consultant1..3 (cabines de la Salle des Consultations).
//   Dialogue = DIALOGUES_ETAPE4[choisirDialogueEtape4(perso, etat)] de data/dialogues-etape4.js, lu avec import.meta.glob :
//   si le fichier manque, aucune invite « Parler » n'est affichée. Le fichier peut arriver plus tard sans rien changer ici.
//   Sourdine : à la fin d'un dialogue de Sall, si le drapeau `sall_sourdine` est posé et que `etat.pouvoirs` n'a pas
//   'sourdine', `jeu.sourdine?.accorder?.()` ; repris à chaque image tant que le pouvoir manque et que le système
//   `sourdine` n'est pas encore là.
//
// BRANCHEMENTS DE LA ZONE (zones/maison.js) : anneaux libres → `jeu.questions?.ouvrir?.()` ; chaque anneau est déclaré
//   à `jeu.conversation?.ajouterEcran` ; cabine du Sceau → `jeu.fins?.sceau?.()` (c'est fins.js qui ouvre le dialogue
//   'sceau' d'étape 4 : rien à faire ici) ; fumer y est déplacé (T4.zones de data/transgressions.js).
//
// API : `jeu.maison` = { zone (la zone, une fois construite), personnages, lancer(id), dernier, LIEUX }.

const dialoguesMod = Object.values(import.meta.glob('../data/dialogues-etape4.js', { eager: true }))[0] || null;
const dialoguesPrets = () => !!(dialoguesMod?.DIALOGUES_ETAPE4 && typeof dialoguesMod.choisirDialogueEtape4 === 'function');
const dialoguePour = (perso, etat) => {
  if (!dialoguesPrets()) return null;
  const id = dialoguesMod.choisirDialogueEtape4(perso, etat);
  return id ? dialoguesMod.DIALOGUES_ETAPE4[id] || null : null;
};

const BLOC = [4, 2];
const CX = 0, CZ = -120; // centre du pâté
const DEMI = 19; // demi-largeur du lot (38 m)
const Z_FACADE = CZ + DEMI; // −101
const H = 22;
const SOL = 0.3; // trottoir

const POLICE = '"Noto Sans JP", "Hiragino Sans", "Yu Gothic", sans-serif';
const SERIF = '"Cormorant Garamond", "Palatino Linotype", "Book Antiqua", Georgia, serif';

function toile(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}
function tex(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Le fronton gravé : pierre sombre, lettres claires en creux. */
function textureFronton() {
  const [c, g] = toile(2048, 256);
  g.fillStyle = '#10162c';
  g.fillRect(0, 0, 2048, 256);
  g.strokeStyle = '#6f8cff';
  g.lineWidth = 5;
  g.shadowColor = '#6f8cff';
  g.shadowBlur = 14;
  g.strokeRect(10, 10, 2028, 236);
  g.shadowBlur = 0;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let taille = 112;
  g.font = `600 ${taille}px ${SERIF}`;
  while (g.measureText(FACADE.fronton).width > 1900 && taille > 40) {
    taille -= 4;
    g.font = `600 ${taille}px ${SERIF}`;
  }
  g.fillStyle = '#04060f'; // le creux
  g.fillText(FACADE.fronton, 1026, 134);
  g.fillStyle = '#d6e2ff'; // la lumière sur l'arête
  g.fillText(FACADE.fronton, 1024, 130);
  return tex(c);
}

/** Murs : bois sombre, lamelles de fenêtres bleues. */
function textureMurs() {
  const [c, g] = toile(512, 512);
  g.fillStyle = '#1b1514';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 16; i++) {
    const t = 0.8 + ((i * 29) % 9) / 45;
    g.fillStyle = `rgb(${Math.round(34 * t)},${Math.round(24 * t)},${Math.round(22 * t)})`;
    g.fillRect(i * 32 + 1, 0, 30, 512);
  }
  // fenêtres : cinq colonnes, quatre rangées, quelques-unes éteintes
  for (let r = 0; r < 4; r++) {
    for (let k = 0; k < 5; k++) {
      const x = 28 + k * 98, y = 40 + r * 120;
      const eteinte = ((r * 7 + k * 3) % 5) === 0;
      g.fillStyle = eteinte ? '#0a1024' : (k + r) % 2 ? '#5a7cff' : '#7f9cff';
      g.globalAlpha = eteinte ? 1 : 0.85;
      g.fillRect(x, y, 56, 88);
      g.globalAlpha = 1;
      g.fillStyle = '#0a0e22';
      g.fillRect(x + 27, y, 3, 88);
    }
  }
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export const maison = {
  nom: 'maison',
  jeu: null,
  /** La zone intérieure, une fois construite. */
  zone: null,
  personnages: {},
  dernier: null,
  LIEUX,
  _faits: false,
  _sourdineEnCours: false,

  preparer(jeu) {
    jeu.config.ville.blocsReserves.push(BLOC);
  },

  init(jeu) {
    this.jeu = jeu;
    jeu.maison = this;
    TITRES_ZONES.maison = TITRE_ZONE;
    this.construireFacade(jeu.zones.get('kasumi'));
  },

  surZone(nom, zone, jeu) {
    if (nom !== 'maison') return;
    this.zone = zone;
    if (!this._faits) {
      this._faits = true;
      this.placerPersonnages(jeu);
    }
  },

  update(dt, t, jeu) {
    // la Sourdine attend la fin d'un dialogue de Sall : si le système n'était pas encore là, on la redonne plus tard
    if (jeu.etat && jeu.jouable) this.accorderSourdineSiDue(jeu);
  },

  // ------------------------------------------------------------------
  // Personnages
  // ------------------------------------------------------------------
  placerPersonnages(jeu) {
    const ajouter = (id, def) => {
      const t = TEXTES[id];
      const p = npc.ajouterPersonnage({
        id, nom: t.nom, zone: 'maison', position: [def.x, def.y ?? 0, def.z], yaw: def.yaw ?? 0,
        apparence: APPARENCES[id], lignes: t.lignes, libelle: t.libelle, regardeLeJoueur: id === 'sall' || id === 'patient',
        hauteurEtiquette: 2.25, rayon: 3.4,
        dialogue: () => dialoguePour(id, jeu.etat),
        apres: () => this.apres(id),
      });
      // pas d'invite « Parler » tant que les dialogues de l'étape 4 n'existent pas
      if (p.objet) {
        const base = p.objet.visible;
        p.objet.visible = (o, j) => dialoguesPrets() && (typeof base === 'function' ? base(o, j) : base !== false);
      }
      this.personnages[id] = p;
      // un habitant arrête le joueur
      jeu.zones.get('maison').colliders.push({
        minX: def.x - 0.3, maxX: def.x + 0.3, minZ: def.z - 0.3, maxZ: def.z + 0.3,
        minY: (def.y ?? 0) - 0.1, maxY: (def.y ?? 0) + 1.95,
      });
      return p;
    };
    ajouter('sall', LIEUX.sall);
    ajouter('patient', LIEUX.patient);
    for (const c of LIEUX.consultants) ajouter(c.id, c);
  },

  /** Fin d'un dialogue : Sourdine de Sall, résumé, évènement. */
  async apres(id) {
    const jeu = this.jeu;
    const resume = { perso: id, sourdine: false };
    if (id === 'sall') resume.sourdine = this.accorderSourdineSiDue(jeu);
    this.dernier = resume;
    jeu.sauver?.();
    jeu.emettre('maison:dialogue', resume);
  },

  /** Donne la Sourdine si Sall l'a transmise (drapeau `sall_sourdine`) et que le pouvoir manque. Renvoie vrai si accordée. */
  accorderSourdineSiDue(jeu) {
    const e = jeu.etat;
    if (this._sourdineEnCours) return false;
    if (!(Array.isArray(e.drapeaux) && e.drapeaux.includes('sall_sourdine'))) return false;
    if (e.pouvoirs.includes('sourdine')) return false;
    if (typeof jeu.sourdine?.accorder !== 'function') return false;
    this._sourdineEnCours = true;
    try {
      return !!jeu.sourdine.accorder();
    } finally {
      this._sourdineEnCours = false;
    }
  },

  /** Lance l'interaction d'un personnage comme un appui sur E (pour les tests). */
  lancer(id) {
    const p = this.personnages[id];
    return p?.objet?.action?.();
  },

  // ------------------------------------------------------------------
  // Façade, côté ville
  // ------------------------------------------------------------------
  construireFacade(k) {
    const jeu = this.jeu;
    const g = new THREE.Group();
    g.name = 'maison-des-conseils';
    const colliders = k.colliders;

    // volume : 6 matériaux (est, ouest, dessus, dessous, sud, nord) ; les côtés portent les fenêtres
    const murTex = textureMurs();
    const matCote = (rx, ry) => {
      const t = murTex.clone();
      t.needsUpdate = true;
      t.repeat.set(rx, ry);
      return new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.8 });
    };
    const matToit = new THREE.MeshStandardMaterial({ color: 0x0f1428, roughness: 0.9 });
    const cote = matCote(5, 3);
    const volume = new THREE.Mesh(new THREE.BoxGeometry(DEMI * 2, H, DEMI * 2), [cote, cote, matToit, matToit, cote, cote]);
    volume.position.set(CX, SOL + H / 2, CZ);
    g.add(volume);
    colliders.push({ minX: CX - DEMI, maxX: CX + DEMI, minZ: CZ - DEMI, maxZ: CZ + DEMI, minY: 0, maxY: SOL + H });

    // Décor fusionné par matériau : bois (colonnes), pierre (socles, entablement, fronton, mât), lumière (filets).
    const bois = new THREE.MeshStandardMaterial({ color: 0x5a3e2e, roughness: 0.7, metalness: 0.1 });
    const pierre = new THREE.MeshStandardMaterial({ color: 0x1a2038, roughness: 0.6, metalness: 0.2 });
    const lumiere = new THREE.MeshBasicMaterial({ color: 0x4f94ff, toneMapped: false });
    const lots = { bois: [], pierre: [], lumiere: [] };
    const poser = (lot, geo, x, y, z, rz = 0) => {
      const n = geo.index ? geo.toNonIndexed() : geo;
      if (rz) n.rotateZ(rz);
      n.translate(x, y, z);
      lots[lot].push(n);
    };
    const boite = (lot, w, h, d, x, y, z, rz = 0) => poser(lot, new THREE.BoxGeometry(w, h, d), x, y, z, rz);

    // portique : six colonnes sur le trottoir, entablement, fronton
    const zc = Z_FACADE + 2.2; // −98,8 (le trottoir finit à −98)
    for (const x of [-11.6, -7.6, -3.6, 3.6, 7.6, 11.6]) {
      poser('bois', new THREE.CylinderGeometry(0.6, 0.7, 10, 14), CX + x, SOL + 5, zc);
      poser('pierre', new THREE.CylinderGeometry(0.95, 0.95, 0.5, 14), CX + x, SOL + 0.25, zc);
      colliders.push({ minX: CX + x - 0.85, maxX: CX + x + 0.85, minZ: zc - 0.85, maxZ: zc + 0.85, minY: 0, maxY: SOL + 10.5 });
    }
    boite('pierre', 27.6, 3.4, 2.6, CX, SOL + 11.7, zc);
    for (const dy of [-1.74, 1.74]) boite('lumiere', 27.8, 0.12, 2.7, CX, SOL + 11.7 + dy, zc);
    const frise = new THREE.Mesh(new THREE.PlaneGeometry(26, 3.0), new THREE.MeshBasicMaterial({ map: textureFronton(), toneMapped: false }));
    frise.position.set(CX, SOL + 11.7, zc + 1.32);
    g.add(frise);
    // fronton triangulaire
    const tri = new THREE.Shape();
    tri.moveTo(-14.2, 0);
    tri.lineTo(14.2, 0);
    tri.lineTo(0, 5.2);
    tri.closePath();
    poser('pierre', new THREE.ExtrudeGeometry(tri, { depth: 2.6, bevelEnabled: false }), CX, SOL + 13.4, zc - 1.3);
    const tymp = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 2),
      new THREE.MeshBasicMaterial({ map: signeTympan(), transparent: true, toneMapped: false })
    );
    tymp.position.set(CX, SOL + 15.1, zc + 1.33);
    g.add(tymp);
    // les rampants du fronton, en lumière
    const long = Math.hypot(14.2, 5.2);
    for (const s of [-1, 1]) boite('lumiere', long, 0.12, 0.12, CX + s * 7.1, SOL + 13.4 + 2.6, zc + 1.33, -s * Math.atan2(5.2, 14.2));

    // porte : un portail bleu dans le mur
    const portail = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 6.2), new THREE.MeshBasicMaterial({ color: 0x1c2c66, toneMapped: false }));
    portail.position.set(CX, SOL + 3.1, Z_FACADE - 0.02);
    g.add(portail);
    for (const s of [-1, 1]) boite('lumiere', 0.16, 6.4, 0.22, CX + s * 1.88, SOL + 3.2, Z_FACADE - 0.05);
    boite('lumiere', 3.9, 0.16, 0.22, CX, SOL + 6.4, Z_FACADE - 0.05);
    // deux filets au sol qui mènent à la porte
    for (const s of [-1, 1]) boite('lumiere', 0.14, 0.02, 6.6, CX + s * 1.6, SOL + 0.02, Z_FACADE + 3.3);
    // lueur au-dessus de la porte
    const lueur = new THREE.Mesh(new THREE.PlaneGeometry(8, 3), new THREE.MeshBasicMaterial({
      map: lueurTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    lueur.position.set(CX, SOL + 3.6, Z_FACADE - 0.03);
    g.add(lueur);

    // pylône à l'enseigne : visible de loin, au coin sud-est, au-dessus des toits
    const px = CX + DEMI + 0.9, pz = Z_FACADE - 0.9;
    boite('pierre', 0.5, 40, 0.5, px, SOL + 20, pz);
    boite('lumiere', 0.7, 0.7, 0.7, px, SOL + 40.4, pz);
    colliders.push({ minX: px - 0.3, maxX: px + 0.3, minZ: pz - 0.3, maxZ: pz + 0.3, minY: 0, maxY: SOL + 40 });
    const matEnseigne = new THREE.MeshBasicMaterial({ map: enseigneVerticale(), transparent: true, toneMapped: false, side: THREE.DoubleSide });
    for (const ry of [0, Math.PI / 2]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 11.5), matEnseigne);
      p.position.set(px, SOL + 33, pz);
      p.rotation.y = ry;
      g.add(p);
    }
    for (const [nom, mat] of [['bois', bois], ['pierre', pierre], ['lumiere', lumiere]]) g.add(new THREE.Mesh(mergeGeometries(lots[nom]), mat));

    k.scene.add(g);
    this.facade = g;

    // retour en ville : sur la chaussée, face à la rue
    k.points ||= {};
    k.points.maison = { position: [CX, 0, Z_FACADE + 4.6], yaw: Math.PI };

    jeu.zones.porte({
      zone: 'kasumi',
      position: [CX, 1.5, Z_FACADE + 0.4],
      rayon: 5,
      cone: 1.2,
      libelle: FACADE.porte,
      lignes: FACADE.lignesPorte,
      vers: 'maison',
      point: 'entree',
    });
  },
};

/** Le tympan : le nom de la maison. */
function signeTympan() {
  const [c, g] = toile(768, 256);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#cfe0ff';
  g.shadowColor = '#6f8cff';
  g.shadowBlur = 22;
  g.font = `700 150px ${POLICE}`;
  g.fillText(FACADE.enseigne, 384, 136);
  return tex(c);
}

function lueurTexture() {
  const [c, g] = toile(256, 96);
  const grad = g.createRadialGradient(128, 70, 6, 128, 70, 120);
  grad.addColorStop(0, 'rgba(120,150,255,0.55)');
  grad.addColorStop(1, 'rgba(60,80,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 96);
  return tex(c);
}

/** Enseigne verticale de l'entrée : 相談所, sur fond sombre, bordure bleue. */
function enseigneVerticale() {
  const [c, g] = toile(256, 1024);
  g.fillStyle = '#0a1128';
  g.fillRect(0, 0, 256, 1024);
  g.strokeStyle = '#6f8cff';
  g.lineWidth = 8;
  g.shadowColor = '#6f8cff';
  g.shadowBlur = 20;
  g.strokeRect(12, 12, 232, 1000);
  g.shadowBlur = 24;
  g.fillStyle = '#dce8ff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `700 150px ${POLICE}`;
  [...FACADE.enseigne].forEach((ch, i) => g.fillText(ch, 128, 210 + i * 270));
  return tex(c);
}

