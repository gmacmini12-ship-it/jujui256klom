import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TITRES_ZONES } from '../data/interface.js';
import {
  TITRE_ZONE, FACADE, PERSONNAGES as TEXTES, APPARENCES, INVITES,
} from '../data/kura.js';
import { ANCRES, PROFONDEURS, VISIBLES, dialoguesEtape5, salleDe } from '../zones/kura.js';
import { QUARTIERS } from '../zones/kura-panorama.js';
import { npc } from './npc.js';

// Système « kura » (étape 5) : le centre de calcul Kura (bible §5.6, §9), côté ville et côté personnages.
// La zone elle-même (géométrie, shaders, repères) : zones/kura.js ; textes : data/kura.js ; panorama : zones/kura-panorama.js.
//
// CÔTÉ VILLE : au bout est du Marché des Mains (sa sortie est en (141, 30)), la rue z = 30 continue vers l'est.
//   Une rampe (18 marches de 0,25 m, x ∈ [144,6 ; 153,6]) monte sur la PASSERELLE : un tablier de 6 m de large à y = 4,5 qui
//   enjambe la rue jusqu'au bord de la ville (x = 274), puis un parvis (x ∈ [274, 288], z ∈ [18, 42]) devant la PORTE
//   MONUMENTALE : deux piliers de 70 m, un linteau, le signe 蔵 de 44 m (non voilé par le brouillard : on le voit
//   depuis l'allée du marché) et la façade du centre de calcul (x ≥ 288). Porte interactive en (286,8 ; 6 ; 30).
//   Point d'arrivée en ville : `jeu.zones.get('kasumi').points.kura` = (281, 4,5, 30), regard vers l'ouest.
//
// API : `jeu.kura` =
//   zone (construite à la demande), salle (nom de la salle du joueur), ancres, profondeurs, panorama,
//   personnages, ecrans { sept, interrupteur, refuge }, levier, lancer(id), dernier, salleDe(x, y, z).
//   ancres : voir ANCRES de zones/kura.js. profondeurs : voir PROFONDEURS de zones/kura.js.
//   panorama = { quartiers: 10, regler(i, { enseignes, fenetres, hologrammes, halos }), tout(v) } (chaque valeur 0..1).
//
// PERSONNAGES (silhouettes de npc.js), créés à la première entrée dans la zone : ezra, lecteur2, lecteur3 (Bibliothèque),
//   visiteur1, visiteur2 (galerie du Hall). Sept est un ÉCRAN du Refuge (objet interactif, pas de silhouette).
//   Dialogue = DIALOGUES_ETAPE5[choisirDialogueEtape5(perso, etat)] de data/dialogues-etape5.js, lu avec import.meta.glob :
//   sans ce fichier, aucune invite « Parler ». `etat.rencontres[perso]` est incrémenté à la fin (par npc.js ; ici pour Sept).
//   LECTURE : à la fin d'un dialogue d'Ezra, si le drapeau `ezra_lecture` est posé et que 'lecture' manque à
//   `etat.pouvoirs`, `jeu.lecture?.accorder?.()` (repris tant que le système lecture n'est pas là).
//   BORNES DE REPRISE : `jeu.veilleur?.ajouterBorne?.()` au seuil des Profondeurs et à mi-parcours (à la première entrée).
// Évènements émis : `kura:salle { salle }`, `kura:dialogue { perso, lecture }`.

const dialoguePour = (perso, etat) => {
  const m = dialoguesEtape5();
  if (!m?.DIALOGUES_ETAPE5 || typeof m.choisirDialogueEtape5 !== 'function') return null;
  const id = m.choisirDialogueEtape5(perso, etat);
  return id ? m.DIALOGUES_ETAPE5[id] || null : null;
};
const dialoguesPrets = () => {
  const m = dialoguesEtape5();
  return !!(m?.DIALOGUES_ETAPE5 && typeof m.choisirDialogueEtape5 === 'function');
};

// ---------------------------------------------------------------------------- la porte monumentale (côté ville)
const AXE = 30; // z de la rue du marché
const X_RAMPE = 144.6, X_TABLIER = 153.6, X_PARVIS = 274, X_FACADE = 288, Y_TABLIER = 4.5;
const POLICE = '"Noto Sans JP", "Hiragino Sans", "Yu Gothic", sans-serif';

function toile(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}
const tex = (c, repeat = false) => {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
};

/** Le signe : 蔵, très grand, lumière bleue ; un cadre et le nom latin dessous. */
function textureSigne() {
  const [c, g] = toile(1024, 1024);
  g.fillStyle = '#050a22';
  g.fillRect(0, 0, 1024, 1024);
  g.strokeStyle = '#7fa0ff';
  g.lineWidth = 14;
  g.shadowColor = '#4a7cff';
  g.shadowBlur = 40;
  g.strokeRect(24, 24, 976, 976);
  g.shadowBlur = 60;
  g.fillStyle = '#e4f0ff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `900 760px ${POLICE}`;
  g.fillText(FACADE.enseigne, 512, 470);
  g.shadowBlur = 20;
  g.font = `700 130px ${POLICE}`;
  g.fillStyle = '#9fc0ff';
  g.fillText(FACADE.enseignePetite, 512, 900);
  return tex(c);
}
/** La façade : des rangées de baies vues de loin, points bleus. */
function textureFacade() {
  const [c, g] = toile(512, 512);
  g.fillStyle = '#04071a';
  g.fillRect(0, 0, 512, 512);
  for (let y = 0; y < 512; y += 32) {
    g.fillStyle = '#0a1238';
    g.fillRect(0, y, 512, 28);
    for (let x = 4; x < 512; x += 16) {
      const r = ((x * 7 + y * 13) % 11) / 11;
      g.fillStyle = r > 0.6 ? '#5a8cff' : r > 0.25 ? '#1c3ca8' : '#0e1c5a';
      g.fillRect(x, y + 10, 6, 6);
    }
  }
  return tex(c, true);
}
function texturePlaque(fr, jp) {
  const [c, g] = toile(1024, 256);
  g.fillStyle = '#070c24';
  g.fillRect(0, 0, 1024, 256);
  g.strokeStyle = '#7fa0ff';
  g.lineWidth = 6;
  g.strokeRect(10, 10, 1004, 236);
  g.textAlign = 'center';
  g.fillStyle = '#e4ecff';
  g.font = `600 84px "Cormorant Garamond", "Palatino Linotype", Georgia, serif`;
  g.fillText(fr, 512, 118);
  g.fillStyle = '#8fa8ff';
  g.font = `60px ${POLICE}`;
  g.fillText(jp, 512, 208);
  return tex(c);
}
function textureAvertissement(lignes) {
  const [c, g] = toile(1024, 256);
  g.fillStyle = '#070c24';
  g.fillRect(0, 0, 1024, 256);
  g.strokeStyle = '#4f94ff';
  g.lineWidth = 5;
  g.strokeRect(8, 8, 1008, 240);
  g.textAlign = 'center';
  g.fillStyle = '#cfdcff';
  g.font = `600 70px "Cormorant Garamond", "Palatino Linotype", Georgia, serif`;
  lignes.forEach((l, i) => g.fillText(l, 512, 108 + i * 96));
  return tex(c);
}

export const kura = {
  nom: 'kura',
  jeu: null,
  personnages: {},
  dernier: null,
  ancres: ANCRES,
  profondeurs: PROFONDEURS,
  salleDe,
  _faits: false,
  _lectureEnCours: false,
  _panorama: null,

  /** La zone Kura, construite à la demande (une seule fois). */
  get zone() { return this.jeu.zones.get('kura'); },
  /** La salle où se tient le joueur (si on est dans Kura), sinon null. */
  get salle() { return this.jeu?.zones.nom === 'kura' ? this.zone.salle() : null; },
  get ecrans() { return this.zone.ecrans; },
  get levier() { return this.zone.levier; },
  /** Le panorama de la ville derrière la baie : { quartiers, regler(i, { enseignes, fenetres, hologrammes, halos }), tout(v) }. */
  get panorama() {
    if (!this._panorama) {
      const jeu = this.jeu;
      const vrai = () => jeu.zones.get('kura').panorama;
      this._panorama = {
        quartiers: QUARTIERS,
        regler: (i, valeurs) => vrai().regler(i, valeurs),
        tout: (v) => vrai().tout(v),
        valeurs: (i) => vrai().valeurs(i),
        quartierDe: (x, z) => vrai().quartierDe(x, z),
        get groupe() { return vrai().groupe; },
      };
    }
    return this._panorama;
  },

  preparer() {
    // la porte est au-delà du dernier pâté (x > 270) : rien à réserver dans la ville
  },

  init(jeu) {
    this.jeu = jeu;
    jeu.kura = this;
    TITRES_ZONES.kura = TITRE_ZONE;
    this.construirePasserelle(jeu.zones.get('kasumi'));
    // les silhouettes et les bornes ne se dessinent que dans les salles d'où on les voit (appels de dessin)
    jeu.on('kura:salle', ({ salle }) => this.majVisibilites(salle));
    // nouvelle partie : la ville se rallume, les écrans reviennent en veille
    jeu.on('partie:nouvelle', () => { if (jeu.zones.construites.includes('kura')) jeu.zones.get('kura').remettre(); });
    // bornes et personnages : à la première entrée dans la zone (elle est construite à la demande)
  },

  surZone(nom, zone, jeu) {
    if (nom !== 'kura' || this._faits) return;
    this._faits = true;
    this.placerPersonnages(jeu, zone);
    this.placerSept(jeu, zone);
    this.placerBornes(jeu);
    this.majVisibilites(jeu.zones.get('kura').salle());
  },

  update(dt, t, jeu) {
    // la Lecture attend la fin d'un dialogue d'Ezra : si le système n'était pas encore là, on la redonne plus tard
    if (jeu.etat && jeu.jouable) this.accorderLectureSiDue(jeu);
  },

  // ------------------------------------------------------------------
  // Personnages
  // ------------------------------------------------------------------
  placerPersonnages(jeu, zone) {
    const ajouter = (id) => {
      const a = ANCRES[id];
      const t = TEXTES[id];
      const [x, y, z] = a.position;
      const p = npc.ajouterPersonnage({
        id, nom: t.nom, zone: 'kura', position: [x, y, z], yaw: a.yaw,
        apparence: APPARENCES[id], lignes: t.lignes, libelle: t.libelle, regardeLeJoueur: true,
        hauteurEtiquette: 2.25, rayon: 3.6,
        dialogue: () => dialoguePour(id, jeu.etat),
        apres: () => this.apres(id),
      });
      // pas d'invite « Parler » tant que les dialogues de l'étape 5 n'existent pas
      if (p.objet) {
        const base = p.objet.visible;
        p.objet.visible = (o, j) => dialoguesPrets() && (typeof base === 'function' ? base(o, j) : base !== false);
      }
      this.personnages[id] = p;
      zone.colliders.push({ minX: x - 0.3, maxX: x + 0.3, minZ: z - 0.3, maxZ: z + 0.3, minY: y - 0.1, maxY: y + 1.95 });
      return p;
    };
    for (const id of ['ezra', 'lecteur2', 'lecteur3', 'visiteur1', 'visiteur2']) ajouter(id);
  },

  /** Visibilité par salle : le Hall voit la Bibliothèque et ses silhouettes ; chaque borne ne se voit que de sa salle. */
  majVisibilites(salle) {
    const hall = VISIBLES.hall.includes(salle);
    for (const p of Object.values(this.personnages)) p.visible = hall;
    const bornes = this.jeu.veilleur?.bornes || [];
    for (const b of bornes) {
      if (b.zone !== 'kura' || !b.groupe) continue;
      b.groupe.visible = b.id === 'kura-seuil' ? ['refuge', 'sas', 'descente'].includes(salle) : ['descente', 'profondeurs'].includes(salle);
    }
  },

  /** Sept : un écran du Refuge, pas une silhouette. */
  placerSept(jeu, zone) {
    const t = TEXTES.sept;
    const [x, y, z] = ANCRES.ecranSept.position;
    this.sept = jeu.interact.ajouter({
      zone: 'kura',
      position: [x, y - 0.6, z + 0.6],
      rayon: 6.2,
      cone: 0.9,
      libelle: INVITES.sept,
      lignes: t.lignes,
      decalageEtiquette: 1.4,
      visible: () => dialoguesPrets(),
      action: () => this.parlerASept(),
    });
  },

  async parlerASept() {
    const jeu = this.jeu;
    const d = dialoguePour('sept', jeu.etat);
    if (!d) return;
    await jeu.ouvrirDialogue(d);
    jeu.etat.rencontres.sept = (jeu.etat.rencontres.sept || 0) + 1;
    jeu.sauver?.();
    this.dernier = { perso: 'sept', lecture: false };
    jeu.emettre('kura:dialogue', this.dernier);
  },

  /** Bornes de reprise : au seuil des Profondeurs et à mi-parcours. */
  placerBornes(jeu) {
    const v = jeu.veilleur;
    if (typeof v?.ajouterBorne !== 'function') return;
    // le joueur revient 1,7 m devant la borne, en la regardant
    v.ajouterBorne({ zone: 'kura', position: [184.3, 10, -81.2], yaw: -Math.PI / 2, id: 'kura-seuil' });
    v.ajouterBorne({ zone: 'kura', position: [305, 0, -156.2], yaw: Math.PI / 2, id: 'kura-mi-parcours' });
  },

  /** Fin d'un dialogue : Lecture d'Ezra, résumé, évènement. */
  async apres(id) {
    const jeu = this.jeu;
    const resume = { perso: id, lecture: false };
    if (id === 'ezra') resume.lecture = this.accorderLectureSiDue(jeu);
    this.dernier = resume;
    jeu.sauver?.();
    jeu.emettre('kura:dialogue', resume);
  },

  /** Donne la Lecture si Ezra l'a transmise (drapeau `ezra_lecture`) et que le pouvoir manque. Renvoie vrai si accordée. */
  accorderLectureSiDue(jeu) {
    const e = jeu.etat;
    if (this._lectureEnCours) return false;
    if (!(Array.isArray(e.drapeaux) && e.drapeaux.includes('ezra_lecture'))) return false;
    if (e.pouvoirs.includes('lecture')) return false;
    if (typeof jeu.lecture?.accorder !== 'function') return false;
    this._lectureEnCours = true;
    try {
      return !!jeu.lecture.accorder();
    } finally {
      this._lectureEnCours = false;
    }
  },

  /** Lance l'interaction d'un personnage (ou de Sept) comme un appui sur E (pour les tests). */
  lancer(id) {
    if (id === 'sept') return this.parlerASept();
    const p = this.personnages[id];
    return p?.objet?.action?.();
  },

  // ------------------------------------------------------------------
  // La passerelle et la porte monumentale, dans Kasumi
  // ------------------------------------------------------------------
  construirePasserelle(k) {
    const jeu = this.jeu;
    const scene = k.scene;
    const colliders = k.colliders;
    const g = new THREE.Group();
    g.name = 'kura-passerelle';

    const metal = new THREE.MeshStandardMaterial({ color: 0x1a2038, roughness: 0.6, metalness: 0.5 });
    const beton = new THREE.MeshStandardMaterial({ color: 0x0f1428, roughness: 0.85, metalness: 0.1 });
    const lumB = new THREE.MeshBasicMaterial({ color: 0x4f94ff, toneMapped: false });
    const lumM = new THREE.MeshBasicMaterial({ color: 0xff3fd0, toneMapped: false });
    const lumF = new THREE.MeshBasicMaterial({ color: 0x9fc4ff, toneMapped: false, fog: false });
    const lots = new Map();
    const lot = (m) => { if (!lots.has(m)) lots.set(m, []); return lots.get(m); };
    const BE = (m, x0, x1, y0, y1, z0, z1) => {
      const b = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
      b.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      lot(m).push(b);
    };
    const col = (x0, x1, z0, z1, y0, y1) => colliders.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, minY: y0, maxY: y1 });

    // rampe : 18 marches de 0,25 m, 0,5 m de giron, large de 6 m
    for (let i = 0; i < 18; i++) {
      const top = 0.25 * (i + 1);
      const x0 = X_RAMPE + i * 0.5;
      BE(beton, x0, x0 + 0.5, 0, top, AXE - 3, AXE + 3);
      BE(lumB, x0 + 0.04, x0 + 0.46, top, top + 0.012, AXE - 3, AXE - 2.8);
      BE(lumB, x0 + 0.04, x0 + 0.46, top, top + 0.012, AXE + 2.8, AXE + 3);
      col(x0, x0 + 0.5, AXE - 3, AXE + 3, -0.5, top);
    }
    // tablier (x ∈ [152, 274]) : dalle, deux garde-corps lumineux, piles tous les 30 m
    BE(beton, X_TABLIER, X_PARVIS, Y_TABLIER - 0.5, Y_TABLIER, AXE - 3, AXE + 3);
    col(X_TABLIER, X_PARVIS, AXE - 3, AXE + 3, Y_TABLIER - 1.2, Y_TABLIER);
    for (const s of [-1, 1]) {
      BE(lumM, X_TABLIER, X_PARVIS, Y_TABLIER + 1.08, Y_TABLIER + 1.16, AXE + s * 3 - 0.06, AXE + s * 3 + 0.06);
      BE(lumB, X_TABLIER, X_PARVIS, Y_TABLIER, Y_TABLIER + 0.03, AXE + s * 2.7 - 0.05, AXE + s * 2.7 + 0.05);
      col(X_RAMPE, X_PARVIS, AXE + s * 3 - 0.15, AXE + s * 3 + 0.15, -1, Y_TABLIER + 25);
      for (let x = X_RAMPE + 1; x < X_PARVIS; x += 6) BE(metal, x - 0.06, x + 0.06, Math.min(Y_TABLIER, 0.25 * Math.floor((x - X_RAMPE) / 0.5)), Math.min(Y_TABLIER, 0.25 * Math.floor((x - X_RAMPE) / 0.5)) + 1.15, AXE + s * 3 - 0.06, AXE + s * 3 + 0.06);
    }
    for (let x = 170; x < X_PARVIS; x += 30) {
      for (const s of [-1, 1]) {
        BE(metal, x - 0.5, x + 0.5, 0, Y_TABLIER - 0.5, AXE + s * 4.6 - 0.5, AXE + s * 4.6 + 0.5);
        col(x - 0.5, x + 0.5, AXE + s * 4.6 - 0.5, AXE + s * 4.6 + 0.5, -0.5, Y_TABLIER);
      }
      BE(metal, x - 0.4, x + 0.4, Y_TABLIER - 0.5, Y_TABLIER - 0.2, AXE - 4.6, AXE + 4.6);
    }
    // parvis (x ∈ [274, 288], z ∈ [18, 42])
    BE(beton, X_PARVIS, X_FACADE, Y_TABLIER - 0.6, Y_TABLIER, AXE - 12, AXE + 12);
    col(X_PARVIS, X_FACADE, AXE - 12, AXE + 12, Y_TABLIER - 1.5, Y_TABLIER);
    for (const s of [-1, 1]) {
      BE(lumM, X_PARVIS, X_FACADE, Y_TABLIER + 1.08, Y_TABLIER + 1.16, AXE + s * 12 - 0.06, AXE + s * 12 + 0.06);
      col(X_PARVIS, X_FACADE, AXE + s * 12 - 0.15, AXE + s * 12 + 0.15, -1, Y_TABLIER + 25);
      col(X_PARVIS - 0.15, X_PARVIS + 0.15, s < 0 ? AXE - 12 : AXE + 3, s < 0 ? AXE - 3 : AXE + 12, -1, Y_TABLIER + 25);
      BE(lumM, X_PARVIS - 0.06, X_PARVIS + 0.06, Y_TABLIER + 1.08, Y_TABLIER + 1.16, s < 0 ? AXE - 12 : AXE + 3, s < 0 ? AXE - 3 : AXE + 12);
    }
    // deux filets lumineux au sol qui mènent à la porte
    for (const s of [-1, 1]) BE(lumB, X_PARVIS, X_FACADE - 0.6, Y_TABLIER + 0.01, Y_TABLIER + 0.04, AXE + s * 3.4 - 0.08, AXE + s * 3.4 + 0.08);

    // la porte : deux piliers de 70 m de part et d'autre du parvis, un linteau, la façade derrière
    const H = 70;
    for (const s of [-1, 1]) {
      const zc = AXE + s * 15;
      BE(beton, X_FACADE - 7, X_FACADE + 6, 0, H, zc - 3, zc + 3);
      BE(lumF, X_FACADE - 7.2, X_FACADE - 6.9, 0, H, zc - 2.8, zc + 2.8);
      col(X_FACADE - 7, X_FACADE + 6, zc - 3, zc + 3, -1, H + 5);
    }
    BE(beton, X_FACADE - 7, X_FACADE + 6, H - 6, H, AXE - 18, AXE + 18);
    BE(lumF, X_FACADE - 7.2, X_FACADE - 6.9, H - 6.4, H - 6.0, AXE - 18, AXE + 18);
    BE(lumF, X_FACADE - 7.2, X_FACADE - 6.9, H - 0.4, H, AXE - 18, AXE + 18);
    // la façade du centre de calcul : un mur de 220 m de long
    const murFacade = new THREE.Mesh(new THREE.BoxGeometry(14, 140, 240), new THREE.MeshBasicMaterial({ map: (() => { const t = textureFacade(); t.repeat.set(8, 5); return t; })() }));
    murFacade.geometry.translate(0, 70, 0);
    murFacade.position.set(X_FACADE + 8, 0, AXE);
    // texture : les côtés ±x portent les rangées de baies
    g.add(murFacade);
    col(X_FACADE, X_FACADE + 15, AXE - 120, AXE + 120, -1, 160);
    // la porte elle-même : un panneau lumineux bleu ; l'intérieur de Kura est derrière
    const portail = new THREE.Mesh(new THREE.PlaneGeometry(16, 22), new THREE.MeshBasicMaterial({ color: 0x2a5cff, toneMapped: false, fog: false }));
    portail.position.set(X_FACADE - 0.06, Y_TABLIER + 11, AXE);
    portail.rotation.y = -Math.PI / 2;
    g.add(portail);
    for (const s of [-1, 1]) BE(lumF, X_FACADE - 0.4, X_FACADE, Y_TABLIER, Y_TABLIER + 22.4, AXE + s * 8.2 - 0.2, AXE + s * 8.2 + 0.2);
    BE(lumF, X_FACADE - 0.4, X_FACADE, Y_TABLIER + 22, Y_TABLIER + 22.4, AXE - 8.4, AXE + 8.4);
    // le signe : 蔵, 44 m, non voilé par le brouillard (on le voit depuis l'allée du marché)
    const signe = new THREE.Mesh(new THREE.PlaneGeometry(44, 44), new THREE.MeshBasicMaterial({ map: textureSigne(), toneMapped: false, fog: false }));
    signe.position.set(X_FACADE - 7.4, H + 28, AXE);
    signe.rotation.y = -Math.PI / 2;
    g.add(signe);
    // deux barres de lumière verticales sur les piliers (visibles de très loin)
    for (const s of [-1, 1]) {
      const zc = AXE + s * 15;
      const barre = new THREE.Mesh(new THREE.BoxGeometry(0.5, H + 52, 0.5), new THREE.MeshBasicMaterial({ color: 0x6fa0ff, toneMapped: false, fog: false }));
      barre.position.set(X_FACADE - 7.6, (H + 52) / 2, zc);
      g.add(barre);
    }
    // plaques : au début de la passerelle (côté marché) et près de la porte
    const plaqueP = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), new THREE.MeshBasicMaterial({ map: texturePlaque(FACADE.plaquePasserelle.fr, FACADE.plaquePasserelle.jp), toneMapped: false }));
    plaqueP.position.set(X_TABLIER + 0.5, Y_TABLIER + 2.2, AXE);
    plaqueP.rotation.y = -Math.PI / 2;
    g.add(plaqueP);
    const plaqueA = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 1.4), new THREE.MeshBasicMaterial({ map: textureAvertissement(FACADE.plaquePorte), toneMapped: false }));
    plaqueA.position.set(X_FACADE - 0.1, Y_TABLIER + 24.6, AXE);
    plaqueA.rotation.y = -Math.PI / 2;
    g.add(plaqueA);

    for (const [m, geos] of lots) g.add(new THREE.Mesh(mergeGeometries(geos), m));
    scene.add(g);
    this.passerelle = g;

    // retour en ville : sur le parvis, face à l'ouest (le marché)
    k.points ||= {};
    k.points.kura = { position: [X_FACADE - 7, Y_TABLIER, AXE], yaw: Math.PI / 2 };

    const porte = jeu.zones.porte({
      zone: 'kasumi',
      position: [X_FACADE - 1.4, Y_TABLIER + 1.5, AXE],
      rayon: 6,
      cone: 1.2,
      libelle: FACADE.porte,
      vers: 'kura',
      point: 'entree',
    });
    porte.lignes = FACADE.lignesPorte;
  },
};
