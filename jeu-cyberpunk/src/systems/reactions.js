// Réactions du monde à l'Attention de Mima (bible §7.1, §7.2 ; tâche 3.3). Aucune jauge : le monde répond.
//
// Les réactions sont cumulatives avec le palier (`jeu.attention.palier`, relu à chaque image : une partie
// rechargée au palier 3 retrouve ses réactions sans évènement) et se défont quand il redescend.
// Chaque réaction a un niveau 0..1 qui monte et retombe en ~1,5 s (REGLAGES.vitesseNiveau).
//   1  Remarque       halos des habitants proches tournés vers le joueur (crochet npc.reaction.halo : halo plus vif,
//                     rosé, avancé vers lui, têtes tournées).
//   2  Prévenance     enseignes proches plus vives à son passage (couleur des matériaux d'enseignes, zéro appel de
//                     dessin) ; paquets « à votre nom » (R-4) posés près de la sortie, du Kiosque et de l'entrée du
//                     marché (ou près de ce que le journal des transgressions montre qu'il a déjà pris) ; portes de
//                     `jeu.transgressions.portes` ouvertes d'avance si ce système en expose.
//   3  Accompagnement un Veilleur à 6 m derrière lui (deux au-delà de 75), mêmes maillages que veilleur.js ;
//                     habitants qui s'écartent (npc.reaction.ecart) ; hologrammes géants « おかえり » (uniform msg de
//                     city.hologrammes) ; entrées est et ouest du marché « fermées pour entretien » quand il fonce
//                     dessus, rouvertes dès qu'il change de direction (ou au bout de 14 s : jamais enfermé).
//   4  Conversation   AFFICHAGE seulement : anneau de Mima et ligne d'appel sur les hologrammes proches et l'écran
//                     du Kiosque. Ni acceptation ni dialogue ici.
// La Sourdine (`jeu.sourdine?.actif`) met tout en pause : l'état reste tel quel.
//
// API : `jeu.reactions` = { niveaux, appelActif, palier, paquets, veilleurs, portes }.
// Évènement : `attention:appel { actif }` quand l'appel du palier 4 apparaît / disparaît (une fois par changement).
// Sauvegarde : seuls les paquets déjà pris (`etat.reactions.paquets`) ; tout le reste dérive de l'Attention.
import * as THREE from 'three';
import { COULEURS, REGLAGES, HOLOGRAMME, APPEL_REPLI, PORTE, PAQUET, PAQUETS_DEFAUT } from '../data/reactions.js';
import { marche } from './marche.js';

// Texte d'appel écrit par l'agent dialogues (peut ne pas exister) : repli dans data/reactions.js.
const _dlg = import.meta.glob('../data/dialogues-attention.js', { eager: true });
const APPEL = Object.values(_dlg)[0]?.APPELS_PALIER4?.ecran || APPEL_REPLI;

const FONTE = '"Noto Sans JP", "Yu Gothic", "Hiragino Sans", sans-serif';
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lisse = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const vers = (v, cible, dt, k) => v + (cible - v) * Math.min(1, dt * k);

// ---------------------------------------------------------------- textures
function toile(l, h) {
  const c = document.createElement('canvas');
  c.width = l;
  c.height = h;
  return [c, c.getContext('2d')];
}
function texture(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function lueurTexte(g, texte, x, y, taille, couleur, flou, poids = 'bold') {
  g.font = `${poids} ${taille}px ${FONTE}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = couleur;
  g.shadowBlur = flou;
  g.fillStyle = COULEURS.pale;
  g.fillText(texte, x, y);
  g.shadowBlur = flou * 0.5;
  g.fillText(texte, x, y);
  g.shadowBlur = 0;
}
/** Panneau holographique « おかえり » (15 × 9 m, 1,67:1). */
function textureOkaeri() {
  const [c, g] = toile(640, 384);
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  const d = g.createRadialGradient(320, 192, 10, 320, 192, 300);
  d.addColorStop(0, 'rgba(255,43,214,0.42)');
  d.addColorStop(0.6, 'rgba(138,92,255,0.2)');
  d.addColorStop(1, 'rgba(61,107,255,0.05)');
  g.fillStyle = d;
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = COULEURS.violet;
  g.lineWidth = 3;
  g.globalAlpha = 0.7;
  g.strokeRect(14, 14, c.width - 28, c.height - 28);
  g.globalAlpha = 1;
  lueurTexte(g, HOLOGRAMME.bienvenue, 320, 178, 150, COULEURS.magenta, 36);
  lueurTexte(g, HOLOGRAMME.signature, 320, 312, 40, COULEURS.bleu, 14, 'normal');
  return texture(c);
}
/** Anneau de Mima et ligne d'appel (écrans de la rue, palier 4). `ratio` = largeur / hauteur. */
function textureAppel(ratio) {
  const h = 384, l = Math.round(h * ratio);
  const [c, g] = toile(l, h);
  g.fillStyle = '#000';
  g.fillRect(0, 0, l, h);
  const cx = l / 2, cy = h * 0.4, r = h * 0.2;
  const d = g.createRadialGradient(cx, cy, r * 0.4, cx, cy, r * 2.4);
  d.addColorStop(0, 'rgba(125,244,255,0.32)');
  d.addColorStop(1, 'rgba(61,107,255,0)');
  g.fillStyle = d;
  g.fillRect(0, 0, l, h);
  g.lineWidth = h * 0.028;
  g.strokeStyle = COULEURS.anneauMima;
  g.shadowColor = COULEURS.anneauMima;
  g.shadowBlur = 30;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.stroke();
  g.shadowBlur = 0;
  g.lineWidth = 2;
  g.globalAlpha = 0.55;
  g.beginPath();
  g.arc(cx, cy, r * 1.22, 0, Math.PI * 2);
  g.stroke();
  g.globalAlpha = 1;
  const t = Math.round(h * (ratio > 1.6 ? 0.075 : 0.068));
  lueurTexte(g, APPEL.texte, cx, h * 0.78, t, COULEURS.magenta, 18);
  if (APPEL.sousLigne) lueurTexte(g, APPEL.sousLigne, cx, h * 0.89, Math.round(t * 0.62), COULEURS.violet, 8, 'normal');
  return texture(c);
}
/** Rideau « Fermé pour entretien » (21 × 4,4 m). */
function texturePorte() {
  const [c, g] = toile(1536, 320);
  const f = g.createLinearGradient(0, 0, 0, 320);
  f.addColorStop(0, '#1a0c3a');
  f.addColorStop(1, '#0d0624');
  g.fillStyle = f;
  g.fillRect(0, 0, 1536, 320);
  g.fillStyle = 'rgba(138,92,255,0.22)';
  for (let y = 10; y < 320; y += 20) g.fillRect(0, y, 1536, 3);
  g.strokeStyle = COULEURS.magenta;
  g.lineWidth = 6;
  g.shadowColor = COULEURS.magenta;
  g.shadowBlur = 18;
  g.strokeRect(10, 10, 1516, 300);
  g.shadowBlur = 0;
  lueurTexte(g, PORTE.japonais, 330, 150, 150, COULEURS.magenta, 30);
  lueurTexte(g, PORTE.titre, 1000, 118, 76, COULEURS.violet, 20);
  lueurTexte(g, PORTE.sous, 1000, 214, 38, COULEURS.bleu, 12, 'normal');
  return texture(c);
}
/** Papier de soie violet, ruban magenta, « R-4 / à votre nom » : sur les six faces d'un petit paquet. */
function texturePaquet() {
  const [c, g] = toile(256, 256);
  const f = g.createLinearGradient(0, 0, 256, 256);
  f.addColorStop(0, '#6f3bd8');
  f.addColorStop(1, '#3a2aa8');
  g.fillStyle = f;
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#ff5ad0';
  g.fillRect(0, 118, 256, 20);
  g.fillRect(118, 0, 20, 256);
  g.fillStyle = 'rgba(15,6,40,0.78)';
  g.fillRect(48, 70, 160, 116);
  g.strokeStyle = '#ffd9f8';
  g.lineWidth = 3;
  g.strokeRect(48, 70, 160, 116);
  g.fillStyle = '#ffd9f8';
  g.font = `bold 58px ${FONTE}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(PAQUET.etiquette, 128, 110);
  g.font = `24px ${FONTE}`;
  g.fillText(PAQUET.sousEtiquette, 128, 158);
  return texture(c);
}

// ---------------------------------------------------------------- système
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export const reactions = {
  nom: 'reactions',

  /** Niveaux courants 0..1 de chaque réaction (lecture). */
  niveaux: { halo: 0, enseignes: 0, paquets: 0, veilleurs: 0, ecart: 0, holo: 0, appel: 0, portes: 0 },
  appelActif: false,
  palier: 0,
  veilleurs: [],
  paquets: [],
  portes: [],

  init(jeu) {
    this.jeu = jeu;
    jeu.reactions = this;
    this._pos = null;
    this._vit = new THREE.Vector3();
    this._enseignes = null;
    this._holo = null;
    this._scene = null;
    try {
      const k = jeu.zones.get('kasumi');
      this._zone = k;
      this._scene = k.scene;
      this.creerVeilleurs(k);
      this.creerPortes(k);
      this.creerPaquets(k);
    } catch (e) {
      console.error('[reactions] init :', e);
    }
    jeu.on('partie:nouvelle', () => this.remettre());
  },

  /** Nouvelle partie : tout est effacé (l'Attention revient à 0 ; les paquets pris sont oubliés avec l'état). */
  remettre() {
    this._enSourdine = false;
    this._reprise = 0;
    for (const k of Object.keys(this.niveaux)) this.niveaux[k] = 0;
    for (const v of this.veilleurs) { v.pos = null; v.alpha = 0; v.v.groupe.visible = false; }
    for (const g of this.portes) this.fermerPorte(g, false, true);
    this.appliquerPNJ();
    this.appliquerEnseignes(true);
    this.appliquerHolos(0, true);
    this.appliquerKiosque(false);
    this.majAppel(false);
  },

  // =====================================================================
  update(dt, t, jeu) {
    if (!this._scene) return;
    dt = Math.min(dt, 0.1);
    if (jeu.sourdine?.actif) { this.surSourdine(dt, t); return; } // tout reste figé, sauf ce qui perd sa cible
    this._enSourdine = false;
    if (this._reprise > 0) this._reprise = Math.max(0, this._reprise - dt);
    const p = jeu.attention?.palier ?? 0;
    this.palier = p;
    const N = this.niveaux;
    const k = REGLAGES.vitesseNiveau;
    N.halo = vers(N.halo, p >= 1 ? 1 : 0, dt, k);
    N.enseignes = vers(N.enseignes, p >= 2 ? 1 : 0, dt, k);
    N.paquets = vers(N.paquets, p >= 2 ? 1 : 0, dt, k);
    N.ecart = vers(N.ecart, p >= 3 ? 1 : 0, dt, k);
    N.holo = vers(N.holo, p >= 3 ? 1 : 0, dt, k);
    N.portes = vers(N.portes, p >= 3 ? 1 : 0, dt, k);
    N.veilleurs = vers(N.veilleurs, p >= 3 ? 1 : 0, dt, k);
    N.appel = vers(N.appel, p >= 4 ? 1 : 0, dt, k);
    for (const key of Object.keys(N)) if (N[key] < 0.002) N[key] = 0;

    this.suivreJoueur(dt);
    this.appliquerPNJ();
    this.majEnseignes(dt);
    this.majPaquets(t);
    this.majVeilleurs(dt, t);
    this.majPortes(dt, t);
    this.appliquerHolos(dt);
    this.appliquerKiosque(N.appel > 0.5);
    this.ouvrirPortesDeService(p);
    this.majAppel(p >= 4);
  },

  /**
   * Pendant la Sourdine (bible §4.3) : niveaux, enseignes, hologrammes et paquets restent figés. Le joueur reste suivi
   * (pour qu'aucun saut de position n'apparaisse à la fin), les Veilleurs perdent leur cible et dérivent, et les
   * rideaux « pour entretien » se relèvent sans jamais se refermer.
   */
  surSourdine(dt, t) {
    this._enSourdine = true;
    this._reprise = REGLAGES.veilleurPerdu.reprise;
    this.suivreJoueur(dt);
    this.majVeilleurs(dt, t);
    this.majPortes(dt, t);
  },

  /** Position et vitesse horizontales lissées du joueur (le joueur est suivi dans toutes les zones). */
  suivreJoueur(dt) {
    const pl = this.jeu.player.position;
    if (!this._pos) this._pos = new THREE.Vector3().copy(pl);
    if (dt > 0) {
      _v.set((pl.x - this._pos.x) / dt, 0, (pl.z - this._pos.z) / dt);
      if (_v.length() > 14) { _v.set(0, 0, 0); this._cap = null; } // téléportation : le cap est repris à la caméra
      this._vit.lerp(_v, Math.min(1, dt * 8));
      // cap de marche (les Veilleurs restent derrière lui, pas derrière sa caméra : se retourner les montre)
      const vl = Math.hypot(this._vit.x, this._vit.z);
      if (vl > 1.2) {
        const cx = this._vit.x / vl, cz = this._vit.z / vl;
        if (!this._cap) this._cap = { x: cx, z: cz };
        else {
          this._cap.x += (cx - this._cap.x) * Math.min(1, dt * 1.6);
          this._cap.z += (cz - this._cap.z) * Math.min(1, dt * 1.6);
          const n = Math.hypot(this._cap.x, this._cap.z) || 1;
          this._cap.x /= n; this._cap.z /= n;
        }
      }
    }
    this._pos.copy(pl);
  },

  get enVille() { return this.jeu.zones.nom === 'kasumi'; },

  // ---------------------------------------------------------------- palier 1 et 3 : habitants
  appliquerPNJ() {
    const R = this.jeu.npc?.reaction;
    if (!R) return;
    R.halo = this.niveaux.halo;
    R.ecart = this.niveaux.ecart;
    R.teinte.setHex(COULEURS.haloTeinte);
  },

  // ---------------------------------------------------------------- palier 2 : enseignes
  // Les matériaux d'enseigne sont partagés (texte|couleur|sens) : on module leur couleur (> 1 : plus vif, le bloom
  // fait le reste) selon la plus proche des enseignes qui les portent. Aucun appel de dessin en plus.
  listerEnseignes() {
    const groupe = this._zone.city?.enseignes;
    if (!groupe) return [];
    if (this._enseignes && this._enseignes.n === groupe.children.length) return this._enseignes.liste;
    const mats = new Map();
    const liste = [];
    for (const m of groupe.children) {
      if (!m.isMesh || !m.material?.isMeshBasicMaterial) continue;
      let e = mats.get(m.material);
      if (!e) { e = { mat: m.material, cur: 0, cible: 0 }; mats.set(m.material, e); }
      liste.push({ x: m.position.x, y: m.position.y, z: m.position.z, e });
    }
    this._enseignes = { n: groupe.children.length, liste, mats: [...mats.values()] };
    return liste;
  },

  majEnseignes(dt) {
    const N = this.niveaux.enseignes;
    if (!N && !this._enseigneActive) return;
    this._accEns = (this._accEns || 0) + dt;
    const liste = this.listerEnseignes();
    const E = this._enseignes;
    if (!E) return;
    const { rayon, plein, gain } = REGLAGES.enseignes;
    if (this._accEns > 0.1 && this.enVille) {
      this._accEns = 0;
      const cam = this.jeu.camera.position;
      for (const e of E.mats) e.cible = 0;
      for (const s of liste) {
        const d = Math.hypot(s.x - cam.x, s.z - cam.z);
        if (d >= rayon) continue;
        const w = 1 - lisse((d - plein) / (rayon - plein));
        if (w > s.e.cible) s.e.cible = w;
      }
    }
    this.appliquerEnseignes(false);
    void gain;
  },

  appliquerEnseignes(forcer) {
    const E = this._enseignes;
    if (!E) return;
    const N = this.niveaux.enseignes;
    let actif = false;
    for (const e of E.mats) {
      e.cur += (e.cible * N - e.cur) * 0.2;
      if (Math.abs(e.cur - e.cible * N) < 0.003) e.cur = e.cible * N;
      if (forcer) { e.cur = 0; e.cible = 0; }
      e.mat.color.setScalar(1 + REGLAGES.enseignes.gain * e.cur);
      if (e.cur > 0.002 || e.cible * N > 0.002) actif = true;
    }
    this._enseigneActive = actif;
  },

  // ---------------------------------------------------------------- hologrammes (palier 3 et 4)
  appliquerHolos(dt, forcer) {
    const H = this._zone?.city?.hologrammes;
    if (!H) return;
    if (!this._holo) this._holo = H.map(() => ({ tex: null, mix: 0 }));
    if (!this.texOkaeri && (this.niveaux.holo > 0 || this.niveaux.appel > 0)) {
      this.texOkaeri = textureOkaeri();
      this.texAppel = textureAppel(15 / 9);
    }
    const cam = this.jeu.camera.position;
    const N = this.niveaux;
    H.forEach((h, i) => {
      const s = this._holo[i];
      const u = h.mat.uniforms;
      let voulu = null;
      if (N.holo > 0.01 && this.texOkaeri) {
        voulu = this.texOkaeri;
        if (N.appel > 0.01 && Math.hypot(h.mesh.position.x - cam.x, h.mesh.position.z - cam.z) < REGLAGES.holo.rayonAppel) voulu = this.texAppel;
      }
      const niveau = voulu === this.texAppel && voulu ? Math.max(N.appel, 0) : N.holo;
      if (forcer) { s.mix = 0; s.tex = null; u.msgMix.value = 0; return; }
      if (voulu !== s.tex) {
        // fondu sortant avant de changer d'image
        s.mix = vers(s.mix, 0, dt || 0.016, 5);
        if (s.mix < 0.03) { s.tex = voulu; if (voulu) u.msg.value = voulu; }
      } else {
        s.mix = vers(s.mix, voulu ? niveau : 0, dt || 0.016, 3.5);
        if (!voulu && s.mix < 0.01) s.mix = 0;
      }
      u.msgMix.value = s.mix;
    });
  },

  // ---------------------------------------------------------------- palier 4 : écran du Kiosque
  appliquerKiosque(actif) {
    const ecran = marche.ecran;
    if (!ecran || !marche.visage) return;
    if (actif && this.enVille) {
      const a = marche.ancres?.kiosqueVisage;
      const cam = this.jeu.camera.position;
      if (a && Math.hypot(a.x - cam.x, a.z - cam.z) > REGLAGES.ecrans.rayonKiosque) actif = false;
    }
    if (actif) {
      if (!this.texKiosque) this.texKiosque = textureAppel(1.55 / 1.04);
      if (ecran.material.map !== this.texKiosque) { this._mapKiosque = ecran.material.map; ecran.material.map = this.texKiosque; }
    } else if (this.texKiosque && ecran.material.map === this.texKiosque) {
      ecran.material.map = marche.visage.tex;
    }
  },

  majAppel(actif) {
    if (actif === this.appelActif) return;
    this.appelActif = actif;
    this.jeu.emettre('attention:appel', { actif });
  },

  // ---------------------------------------------------------------- palier 3 : Veilleurs suiveurs
  creerVeilleurs(k) {
    const base = this.jeu.veilleur;
    if (!base?.creerVeilleur) return;
    for (let i = 0; i < 2; i++) {
      const v = base.creerVeilleur();
      v.base = REGLAGES.veilleur.echelle;
      v.groupe.visible = false;
      v.groupe.name = `veilleur-suiveur-${i}`;
      k.scene.add(v.groupe);
      this.veilleurs.push({ v, pos: null, alpha: 0, cote: i === 0 ? 1 : -1 });
    }
  },

  majVeilleurs(dt, t) {
    const base = this.jeu.veilleur;
    if (!this.veilleurs.length || !base) return;
    const a = this.jeu.attention.valeur;
    const voulu = this.niveaux.veilleurs > 0.01 ? (a > REGLAGES.veilleur.seuilDeux ? 2 : 1) : 0;
    const { distance, hauteur, decalage } = REGLAGES.veilleur;
    const pl = this.jeu.player.position;
    const cam = this.jeu.camera;
    if (!this._cap) {
      cam.getWorldDirection(_w);
      const fl = Math.hypot(_w.x, _w.z) || 1;
      this._cap = { x: _w.x / fl, z: _w.z / fl };
    }
    const fx = this._cap.x, fz = this._cap.z;
    const perdu = this._enSourdine || this._reprise > 0; // sans cible : Sourdine, puis le temps de retrouver sa trace
    const P = REGLAGES.veilleurPerdu;
    this.veilleurs.forEach((s, i) => {
      const cible = i < voulu ? 1 : 0;
      s.alpha = vers(s.alpha, cible * this.niveaux.veilleurs * (perdu ? P.alpha : 1), dt, 3);
      if (s.alpha < 0.01 && !cible) { s.v.groupe.visible = false; s.pos = null; return; }
      if (perdu) {
        if (!s.pos) { s.v.groupe.visible = false; return; }
        // il s'arrête et dérive : un cap lent qui tourne, sans plus regarder où est le joueur
        s.cap = (s.cap ?? (i * 2.4 + 1)) + dt * (0.35 + 0.2 * i) * (i ? -1 : 1);
        s.pos.x += Math.cos(s.cap) * P.derive * dt;
        s.pos.z += Math.sin(s.cap) * P.derive * dt;
        s.pos.y += Math.sin(t * 0.9 + i * 2) * 0.18 * dt;
        s.v.groupe.position.copy(s.pos);
        s.v.groupe.visible = this.enVille;
        base.fixerVeilleur(s.v, s.alpha, 1, t + i);
        return;
      }
      // derrière le joueur, de part et d'autre : 6 m
      const ang = Math.atan2(-fx, -fz) + s.cote * decalage;
      const cx = pl.x + Math.sin(ang) * distance;
      const cz = pl.z + Math.cos(ang) * distance;
      const cy = pl.y + hauteur + Math.sin(t * 0.9 + i * 2) * 0.18;
      if (!s.pos || s.pos.distanceTo(_v.set(cx, cy, cz)) > 40) {
        if (s.pos) s.alpha = 0; // resté très loin (Sourdine, téléportation) : il reparaît derrière lui en fondu
        s.pos = new THREE.Vector3(cx, cy, cz);
      }
      const r = 1 - Math.exp(-dt * 2.4);
      s.pos.x += (cx - s.pos.x) * r;
      s.pos.y += (cy - s.pos.y) * r;
      s.pos.z += (cz - s.pos.z) * r;
      // jamais plus loin que 7,5 m (il suit), jamais à moins de 4,5 m
      let dx = s.pos.x - pl.x, dz = s.pos.z - pl.z;
      const d = Math.hypot(dx, dz) || 1;
      // trop loin : il se rapproche vite (25 m/s) plutôt que de sauter, comme au retour d'une Sourdine
      const dmax = distance + 1.5;
      const dd = d > dmax ? Math.max(dmax, d - 25 * dt) : Math.max(d, 4.5);
      if (dd !== d) { s.pos.x = pl.x + (dx / d) * dd; s.pos.z = pl.z + (dz / d) * dd; }
      s.v.groupe.position.copy(s.pos);
      s.v.groupe.visible = this.enVille;
      base.fixerVeilleur(s.v, s.alpha, 1, t + i);
    });
  },

  // ---------------------------------------------------------------- palier 3 : portes « pour entretien »
  creerPortes(k) {
    const { hauteur } = REGLAGES.portes;
    const tex = texturePorte();
    const geo = new THREE.PlaneGeometry(21.2, hauteur);
    geo.translate(0, -hauteur / 2, 0); // l'ancre est le haut : le rideau descend
    const defs = [
      { nom: 'ouest', x: marche.entrees?.[0]?.position?.x ?? 45.4, z: 30, sens: -1 },
      { nom: 'est', x: marche.entrees?.[1]?.position?.x ?? 139.4, z: 30, sens: 1 },
    ];
    for (const d of defs) {
      const x = d.x + d.sens * 1.25; // juste en dehors de l'arche
      const mat = new THREE.MeshBasicMaterial({ map: tex, color: 0x9a8cc0, transparent: true, opacity: 0.94, toneMapped: false, side: THREE.FrontSide });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, hauteur, d.z);
      mesh.scale.y = 0.001;
      mesh.visible = false;
      mesh.renderOrder = 4;
      k.scene.add(mesh);
      const collider = { minX: x - 0.25, maxX: x + 0.25, minZ: d.z - 10.6, maxZ: d.z + 10.6 };
      this.portes.push({ ...d, x, mesh, collider, ferme: false, prog: 0, h0: 0, tFerme: 0, libreJusqua: 0, dansColliders: false, cote: d.sens });
    }
  },

  fermerPorte(g, oui, silence) {
    if (g.ferme === oui) return;
    g.ferme = oui;
    if (oui) {
      const pl = this.jeu.player.position;
      g.mesh.rotation.y = pl.x < g.x ? -Math.PI / 2 : Math.PI / 2; // le texte est lisible de son côté
      g.tFerme = this.jeu.t;
      const v = this._vit;
      g.h0 = Math.atan2(v.x, v.z);
      if (!silence) this.jeu.audio?.tonalite?.({ de: 640, vers: 420, duree: 0.5, volume: 0.03 });
    } else if (!silence) {
      this.jeu.audio?.tonalite?.({ de: 420, vers: 700, duree: 0.45, volume: 0.025 });
    }
  },

  majPortes(dt, t) {
    if (!this.portes.length) return;
    const zone = this._zone;
    const R = REGLAGES.portes;
    const pl = this._pos || this.jeu.player.position;
    const vit = this._vit;
    const v = Math.hypot(vit.x, vit.z);
    const enVille = this.enVille;
    for (const g of this.portes) {
      if (g.ferme) {
        let rouvrir = this.niveaux.portes < 0.5 || !enVille || this._enSourdine; // Sourdine : « pour entretien » cesse
        const dist = Math.abs(pl.x - g.x);
        if (v > R.vitesseMin) {
          const dh = Math.atan2(Math.sin(Math.atan2(vit.x, vit.z) - g.h0), Math.cos(Math.atan2(vit.x, vit.z) - g.h0));
          if (Math.abs(dh) > R.angleRouverture) rouvrir = true; // il a changé de direction
        }
        if (dist > R.distanceMax + 2 || t - g.tFerme > R.delaiMax) rouvrir = true;
        if (rouvrir) {
          this.fermerPorte(g, false);
          g.libreJusqua = t + R.grace; // après une attente, on le laisse passer
        }
      } else if (this.niveaux.portes > 0.5 && enVille && !this._enSourdine && t > g.libreJusqua && v > R.vitesseMin) {
        const dist = Math.abs(pl.x - g.x);
        const versPorte = Math.sign(g.x - pl.x) * vit.x / v;
        if (dist > R.distanceMin && dist < R.distanceMax && Math.abs(pl.z - g.z) < 10 && pl.y < 3 && versPorte > R.cosVers) this.fermerPorte(g, true);
      }
      g.prog = vers(g.prog, g.ferme ? 1 : 0, dt, g.ferme ? 3.2 : 4.5);
      if (g.prog < 0.004) g.prog = 0;
      g.mesh.visible = g.prog > 0.005;
      g.mesh.scale.y = Math.max(0.001, lisse(g.prog));
      const bloque = g.ferme && g.prog > 0.7;
      if (bloque && !g.dansColliders) { zone.colliders.push(g.collider); g.dansColliders = true; }
      else if (!bloque && g.dansColliders) {
        const i = zone.colliders.indexOf(g.collider);
        if (i >= 0) zone.colliders.splice(i, 1);
        g.dansColliders = false;
      }
    }
  },

  // ---------------------------------------------------------------- palier 2 : paquets « à votre nom »
  creerPaquets(k) {
    const tex = texturePaquet();
    const geo = new THREE.BoxGeometry(0.42, 0.3, 0.34);
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: 0xdcc8ff, toneMapped: false });
    this._paquetGeo = geo;
    this._paquetMat = mat;
    const deja = () => (this.jeu.etat.reactions ||= { paquets: [] }).paquets;
    const poser = (id, x, y, z) => {
      if (this.paquets.some((p) => p.id === id)) return;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y + 0.15, z);
      mesh.rotation.y = (x * 12.9 + z * 7.1) % 3;
      mesh.visible = false;
      k.scene.add(mesh);
      const p = { id, mesh, objet: null, x, y, z };
      p.objet = this.jeu.interact.ajouter({
        zone: 'kasumi',
        position: [x, y + 0.35, z],
        rayon: REGLAGES.paquets.rayonVue,
        libelle: PAQUET.libelle,
        lignes: PAQUET.lignes,
        visible: () => this.niveaux.paquets > 0.5 && !deja().includes(id),
        action: () => this.prendre(p),
      });
      this.paquets.push(p);
    };
    this._poser = poser;
    // Paquets par défaut ; ils attendent que le marché ait publié ses ancres (init de marche.js : déjà fait).
    for (const d of PAQUETS_DEFAUT) {
      let [x, y, z] = d.position || [0, 0, 0];
      if (d.ancre === 'kiosque') {
        const a = marche.approches?.kiosque;
        if (!a) continue;
        x = a.x + (d.decalage?.[0] ?? 0);
        z = a.z + (d.decalage?.[2] ?? 0);
        y = 0.3;
      }
      poser(d.id, x, y, z);
    }
  },

  /** Paquets près des transgressions déjà commises : `jeu.transgressions.journal` (autre agent), si présent. */
  poserPresDuJournal() {
    const journal = this.jeu.transgressions?.journal;
    if (!Array.isArray(journal) || journal.length === this._journalVu) return;
    this._journalVu = journal.length;
    let n = 0;
    for (let i = journal.length - 1; i >= 0 && n < 2; i--) {
      const e = journal[i];
      const pt = e?.position ?? e?.pos ?? e;
      const x = Array.isArray(pt) ? pt[0] : pt?.x;
      const z = Array.isArray(pt) ? pt[2] : pt?.z;
      if (!Number.isFinite(x) || !Number.isFinite(z) || e.zone && e.zone !== 'kasumi') continue;
      const id = `journal-${i}`;
      this._poser(id, x + 1.6, Number.isFinite(pt?.y) ? pt.y : 0, z + 0.4);
      n++;
    }
  },

  prendre(p) {
    const jeu = this.jeu;
    const pris = (jeu.etat.reactions ||= { paquets: [] }).paquets;
    if (pris.includes(p.id)) return;
    pris.push(p.id);
    jeu.sauver?.();
    p.mesh.visible = false;
    jeu.hud?.mima(PAQUET.mima[(pris.length - 1) % PAQUET.mima.length], { duree: PAQUET.duree });
    jeu.audio?.tonalite?.({ de: 520, vers: 880, duree: 0.45, volume: 0.03 });
    jeu.emettre('reactions:paquet', { id: p.id });
  },

  majPaquets() {
    this.poserPresDuJournal();
    const pris = this.jeu.etat.reactions?.paquets || [];
    for (const p of this.paquets) p.mesh.visible = this.niveaux.paquets > 0.5 && !pris.includes(p.id);
  },

  // ---------------------------------------------------------------- palier 2 : portes de service ouvertes d'avance
  // Branchement sur transgressions.js (autre agent) si ce système expose `portes` : [{ position, ouverte, ouvrir() }].
  ouvrirPortesDeService(p) {
    if (p < 2 || !this.enVille) return;
    const portes = this.jeu.transgressions?.portes;
    if (!Array.isArray(portes)) return;
    const cam = this.jeu.camera.position;
    for (const d of portes) {
      if (!d || d.ouverte) continue;
      const q = d.position ?? d;
      if (!Number.isFinite(q.x) || Math.hypot(q.x - cam.x, q.z - cam.z) > 22) continue;
      // ouverte d'avance : ce n'est pas le joueur qui force, rien n'est compté
      try { this.jeu.transgressions.ouvrirPorte(d, 'auto', false); } catch (e) { console.error('[reactions] porte :', e); }
    }
  },
};
