// Système « veilleur » (tâche 2.7, bible §3.2, §5.6, §7.3 T6) : le danger des chutes en ville.
//
// - CHUTE DANGEREUSE : une chute dont la hauteur dépasse l'amortissement du joueur
//   (`jeu.player.amortissement` : 4 m, 12 m avec le Bond ; la bible ne donne pas d'autre seuil)
//   est mortelle en puissance. Une chute amortie mais rude (> 2 m) donne seulement une
//   secousse de caméra brève et un son sourd.
// - LE VEILLEUR (sphère lumineuse de 30 cm, halo additif) intercepte le joueur avant le sol,
//   les deux premières fois (T6, bible §7.3) : arrivée rapide, joueur ralenti puis déposé,
//   une phrase de Mima. Dès la 3e chute (ou si `etat.rattrapageCoupe`), il ne vient pas :
//   échec, fondu blanc, silence, retour à la dernière borne de Rémanence.
// - BORNES DE RÉMANENCE : cylindres bas à lueur pâle (bible §5.6). Elles enregistrent le point
//   de reprise quand on s'en approche (`etat.remanence = { zone, position, yaw, borne }`).
//
// API : `veilleur.ajouterBorne({ zone, position, yaw })` → borne ; `veilleur.echec(cause)` → Promise
//   `position` = la borne ; `yaw` = l'orientation du joueur à la reprise : il se tient à 1,7 m de la borne,
//   en la regardant. `veilleur.bornes`, `veilleur.rattrapageEnCours`, `veilleur.enEchec`.
// Évènements émis :
//   veilleur:rattrapage { n, transgression: 'T6', attention: 8, enVol }   (au moment de l'interception)
//   joueur:echec { cause }                                                  (au début du fondu blanc)
//   joueur:reprise { cause, zone, position, yaw }                           (le joueur est revenu à la borne)
//   remanence:borne { borne, zone, position, yaw }                          (nouvelle borne enregistrée)
// Un Veilleur rattrapé ne laisse pas d'évènement `joueur:atterrissage` (le joueur est posé, pas tombé).
// Crochet : si `jeu.sourdine?.actif`, les Veilleurs perdent leur cible (bible §4) : pas de rattrapage.
import * as THREE from 'three';
import { VEILLEUR } from '../data/veilleur.js';
import { RAYON } from '../player.js';

const ZONE_VILLE = 'kasumi';
const RATTRAPAGES = 2; // bible §7.3 T6 : les deux premières chutes
const ATTENTION_T6 = 8; // bible §7.3 T6
const SEUIL_RUDE = 2; // m : en deçà, un atterrissage ne se remarque pas
const DISTANCE_REPRISE = 1.7; // m entre le joueur revenu et sa borne
const RAYON_BORNE = 2.8; // m : approche qui enregistre la borne
const FREINAGE = 16; // m/s² : décélération du Veilleur
const MARGE_INTERCEPTION = 3.5; // m de sol restant, en plus de la distance de freinage, quand il intervient
const FOND_BLANC = { montee: 0.9, tenue: 1.5, descente: 2.0 }; // s

// ---------- Textures ----------
function textureHalo(couleur = '255,255,255') {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const d = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  d.addColorStop(0, `rgba(${couleur},1)`);
  d.addColorStop(0.18, `rgba(${couleur},0.55)`);
  d.addColorStop(0.5, `rgba(${couleur},0.12)`);
  d.addColorStop(1, `rgba(${couleur},0)`);
  g.fillStyle = d;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function textureFaisceau() {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 128;
  const g = c.getContext('2d');
  const d = g.createLinearGradient(0, 128, 0, 0);
  d.addColorStop(0, 'rgba(210,235,255,0.9)');
  d.addColorStop(0.35, 'rgba(210,235,255,0.25)');
  d.addColorStop(1, 'rgba(210,235,255,0)');
  g.fillStyle = d;
  g.fillRect(0, 0, 32, 128);
  const h = g.createLinearGradient(0, 0, 32, 0);
  h.addColorStop(0, 'rgba(0,0,0,1)');
  h.addColorStop(0.5, 'rgba(0,0,0,0)');
  h.addColorStop(1, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = h;
  g.fillRect(0, 0, 32, 128);
  return new THREE.CanvasTexture(c);
}

function texturePlaque(texte) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#0b1220';
  g.fillRect(0, 0, 128, 64);
  g.fillStyle = '#d6ecff';
  g.font = '40px "Noto Sans JP", "Yu Gothic", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(texte, 64, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const fwd = (yaw) => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });
const bornee = (v, a, b) => Math.max(a, Math.min(b, v));

export const veilleur = {
  nom: 'veilleur',
  bornes: [],
  patrouilles: [],
  /** Rattrapage en cours (null sinon). */
  r: null,
  /** Échec en cours (null sinon). */
  e: null,
  secousse: null,
  tmp: new THREE.Vector3(),
  camDecalage: null, // { y } : ce que ce système a ajouté à la caméra
  pret: false,

  get rattrapageEnCours() { return !!this.r && this.r.phase !== 'depart'; },
  get enEchec() { return !!this.e; },

  // =====================================================================
  init(jeu) {
    this.jeu = jeu;
    jeu.veilleur = this;
    this.texHalo = textureHalo('255,255,255');
    this.texHaloCyan = textureHalo('120,225,255');
    this.texFaisceau = textureFaisceau();
    this.fond = this.creerFond();

    jeu.on('partie:nouvelle', () => this.remettre());
    jeu.on('joueur:atterrissage', (ev) => this.surAtterrissage(ev));

    // Veilleur intercepteur (unique, réutilisé) et sa lueur
    this.vi = this.creerVeilleur();
    this.vi.groupe.visible = false;
    this.lampe = new THREE.PointLight(0x9fe8ff, 0, 16, 2);

    try {
      const k = jeu.zones.get(ZONE_VILLE);
      k.scene.add(this.vi.groupe);
      k.scene.add(this.lampe);
      this.placerBornesDeLaVille(k);
      this.creerPatrouilles(k);
    } catch (e) {
      console.error('[veilleur] ville :', e);
    }
    this.pret = true;
  },

  remettre() {
    delete this.jeu.etat.remanence;
    this.r = null;
    this.e = null;
    this.secousse = null;
    this.vi.groupe.visible = false;
    this.lampe.intensity = 0;
    this.fond.style.opacity = '0';
    this.jeu.reprendre('veilleur');
    this.jeu.reprendre('echec');
    if (this.sonCoupe && this.jeu.audio?.coupe) this.jeu.audio.toggle();
    this.sonCoupe = false;
  },

  // =====================================================================
  // Objets du monde
  // =====================================================================
  creerFond() {
    const f = document.createElement('div');
    Object.assign(f.style, {
      position: 'fixed', inset: '0', background: '#f3f8ff', opacity: '0', pointerEvents: 'none', zIndex: '40',
    });
    document.body.appendChild(f);
    return f;
  },

  /** Sphère lumineuse de 30 cm, halo additif (bible §3.2). */
  creerVeilleur() {
    const groupe = new THREE.Group();
    const noyau = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 20, 14),
      new THREE.MeshBasicMaterial({ color: 0xf2ffff, toneMapped: false, fog: false })
    );
    const anneau = new THREE.Mesh(
      new THREE.TorusGeometry(0.235, 0.007, 6, 40),
      new THREE.MeshBasicMaterial({ color: 0x7fe6ff, toneMapped: false, fog: false, transparent: true, opacity: 0.85 })
    );
    anneau.rotation.x = Math.PI / 2.4;
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.texHaloCyan, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, toneMapped: false,
    }));
    halo.scale.setScalar(2.4);
    groupe.add(noyau, anneau, halo);
    return { groupe, noyau, anneau, halo, base: 2.4, alpha: 1 };
  },

  fixerVeilleur(v, alpha, echelle = 1, t = 0) {
    v.alpha = alpha;
    v.halo.material.opacity = alpha * (0.85 + 0.15 * Math.sin(t * 3.1));
    v.halo.scale.setScalar(v.base * echelle);
    v.anneau.material.opacity = 0.85 * alpha;
    v.noyau.material.opacity = alpha;
    v.noyau.material.transparent = alpha < 1;
    v.anneau.rotation.z = t * 0.9;
  },

  creerBorne(def) {
    const jeu = this.jeu;
    const g = new THREE.Group();
    const sombre = new THREE.MeshStandardMaterial({ color: 0x1c2433, roughness: 0.55, metalness: 0.6, emissive: 0x070b14 });
    const pale = new THREE.MeshBasicMaterial({ color: 0xdff1ff, toneMapped: false });
    const socle = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.5, 0.1, 24), sombre);
    socle.position.y = 0.05;
    const corps = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.95, 24), sombre);
    corps.position.y = 0.55;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.3, 0.06, 24), sombre);
    col.position.y = 1.05;
    const couronne = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.022, 8, 40), pale.clone());
    couronne.rotation.x = Math.PI / 2;
    couronne.position.y = 1.09;
    const disque = new THREE.Mesh(new THREE.CircleGeometry(0.29, 28), pale.clone());
    disque.rotation.x = -Math.PI / 2;
    disque.position.y = 1.085;
    // fente lumineuse et plaque, côté où se tient le joueur à la reprise
    const dir = { x: def.repriseX - def.x, z: def.repriseZ - def.z };
    const cap = Math.atan2(dir.x, dir.z);
    const face = new THREE.Group();
    face.rotation.y = cap;
    const plaque = new THREE.Mesh(
      new THREE.PlaneGeometry(0.34, 0.17),
      new THREE.MeshBasicMaterial({ map: texturePlaque(VEILLEUR.borne.plaque), toneMapped: false })
    );
    plaque.position.set(0, 0.78, 0.332);
    const fente = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.42), pale.clone());
    fente.position.set(0, 0.42, 0.338);
    face.add(plaque, fente);
    // faisceau (deux plans croisés) et halo
    const matF = new THREE.MeshBasicMaterial({
      map: this.texFaisceau, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    });
    const f1 = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 8), matF);
    f1.position.y = 1.1 + 4;
    const f2 = f1.clone();
    f2.rotation.y = Math.PI / 2;
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.texHalo, color: 0xcfe8ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, toneMapped: false,
    }));
    halo.position.y = 1.3;
    halo.scale.setScalar(2.6);
    // anneau d'activation (à plat, s'élargit)
    const pulse = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.0, 48),
      new THREE.MeshBasicMaterial({ color: 0xcfeaff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })
    );
    pulse.rotation.x = -Math.PI / 2;
    pulse.position.y = 0.06;
    g.add(socle, corps, col, couronne, disque, face, f1, f2, halo, pulse);
    g.position.set(def.x, def.y, def.z);
    const b = { ...def, groupe: g, couronne, disque, fente, faisceau: matF, halo, pulse, lueur: 0.45, cible: 0.45, impulsion: -1 };
    void jeu;
    return b;
  },

  /**
   * Ajoute une borne de Rémanence. `position` : [x, y, z] de la borne ; `yaw` : orientation du joueur à la
   * reprise (il se tient à 1,7 m de la borne et la regarde). `id` facultatif. Renvoie la borne.
   */
  ajouterBorne({ zone = ZONE_VILLE, position, yaw = 0, id } = {}) {
    const [x, y, z] = position;
    const f = fwd(yaw);
    const def = {
      id: id ?? `${zone}-${this.bornes.length + 1}`, zone, x, y: y || 0, z, yaw,
      repriseX: x - f.x * DISTANCE_REPRISE, repriseZ: z - f.z * DISTANCE_REPRISE,
    };
    const b = this.creerBorne(def);
    b.reprise = [def.repriseX, def.y, def.repriseZ];
    try {
      this.jeu.zones.get(zone).scene.add(b.groupe);
    } catch (e) {
      console.error('[veilleur] borne :', e);
    }
    this.bornes.push(b);
    // une partie sauvegardée garde sa borne active
    return b;
  },

  placerBornesDeLaVille(k) {
    const jeu = this.jeu;
    // 1. près de la sortie de la clinique : au point d'arrivée de la rue
    const pc = k.points?.clinique;
    if (pc) {
      const f = fwd(pc.yaw);
      this.ajouterBorne({ id: 'clinique', zone: ZONE_VILLE, position: [pc.position[0] + f.x * DISTANCE_REPRISE, 0, pc.position[2] + f.z * DISTANCE_REPRISE], yaw: pc.yaw });
    }
    // 2. à l'entrée du marché (côté ouest, vers la rue)
    const m = jeu.systemes.find((s) => s.nom === 'marche');
    const e = m?.entrees?.find((en) => en.nom === 'ouest');
    const ex = e ? e.position.x : 44;
    const ez = e ? e.position.z : 30;
    this.ajouterBorne({ id: 'marche', zone: ZONE_VILLE, position: [ex - 0.4, 0, ez - 3.4], yaw: -Math.PI / 2 + 0.55 });
    // 3. au pied de chaque escalier de secours, avant les marches, du côté de la rue
    for (const esc of k.escaliers || []) {
      const [px, py, pz] = esc.pied;
      const c = esc.chemin?.find((p) => Math.hypot(p[0] - px, p[2] - pz) > 1) || esc.sommet;
      let dx = c[0] - px, dz = c[2] - pz;
      const nrm = Math.hypot(dx, dz) || 1;
      dx /= nrm; dz /= nrm;
      const im = esc.toits?.[0];
      let nx = 0, nz = 0;
      if (im) {
        const ax = (px - im.x) / (im.w / 2), az = (pz - im.z) / (im.d / 2);
        if (Math.abs(ax) > Math.abs(az)) nx = Math.sign(ax); else nz = Math.sign(az);
      } else { nx = -dz; nz = dx; }
      const bx = px - dx * 2.3, bz = pz - dz * 2.3;
      this.ajouterBorne({ id: `escalier-${esc.nom}`, zone: ZONE_VILLE, position: [bx, py, bz], yaw: Math.atan2(nx, nz) });
    }
  },

  /** Deux Veilleurs en patrouille, en hauteur, au-dessus des rues : visibles de loin. */
  creerPatrouilles(k) {
    const defs = [
      // anneau lent au-dessus du carrefour
      { type: 'cercle', cx: 30, cz: 30, r: 13, y: 12, vit: 0.16, phase: 0 },
      // va-et-vient le long de la rue nord-sud
      { type: 'ligne', a: [30, 16, -10], b: [30, 20, 110], vit: 0.06, phase: 0.3 },
    ];
    for (const d of defs) {
      const v = this.creerVeilleur();
      v.base = 3.4; // plus grand halo : on le voit de loin
      k.scene.add(v.groupe);
      this.patrouilles.push({ ...d, v });
    }
  },

  // =====================================================================
  // Boucle
  // =====================================================================
  update(dt, t, jeu) {
    if (!this.pret) return;
    this.retirerDecalage(jeu);
    const ville = jeu.zones.nom === ZONE_VILLE;
    for (const b of this.bornes) this.animerBorne(b, dt, t);
    if (ville) this.animerPatrouilles(t);
    if (this.e) this.majEchec(dt, jeu);
    if (this.r) this.majRattrapage(dt, t, jeu);
    else if (ville && !this.e && jeu.jouable) {
      this.approcherBornes(jeu);
      this.surveillerChute(jeu);
    }
    this.majSecousse(dt, jeu);
    this.majLampe();
  },

  apresRendu(jeu) {
    this.retirerDecalage(jeu);
  },

  // ---------- Bornes ----------
  actuelle() {
    const r = this.jeu.etat.remanence;
    if (!r) return null;
    return this.bornes.find((b) => b.id === r.borne) || null;
  },

  animerBorne(b, dt, t) {
    const actif = this.actuelle() === b;
    b.cible = actif ? 1 : 0.42;
    b.lueur += (b.cible - b.lueur) * (1 - Math.exp(-dt * 3));
    const respire = 0.9 + 0.1 * Math.sin(t * 1.6 + b.x);
    const l = b.lueur * respire;
    const imp = b.impulsion >= 0 ? Math.exp(-b.impulsion * 2.2) : 0;
    if (b.impulsion >= 0) {
      b.impulsion += dt;
      const p = b.impulsion / 1.4;
      b.pulse.scale.setScalar(0.5 + p * 3.2);
      b.pulse.material.opacity = p < 1 ? (1 - p) * 0.8 : 0;
      if (p >= 1) b.impulsion = -1;
    }
    // de près, le halo et le faisceau s'effacent (sinon l'écran est blanc)
    const cam = this.jeu.camera.position;
    const d = Math.hypot(cam.x - b.x, cam.z - b.z);
    const loin = bornee((d - 1.0) / 7, 0.1, 1);
    b.faisceau.opacity = (0.08 + 0.26 * l + imp * 0.3) * bornee((d - 1.5) / 8, 0.08, 1);
    b.halo.material.opacity = (0.2 + 0.5 * l + imp * 0.4) * loin;
    b.halo.scale.setScalar(1.8 + 1.0 * l + imp * 1.2);
    const c = 0.3 + 0.7 * Math.min(1, l + imp);
    b.couronne.material.color.setRGB(0.6 + 0.35 * c, 0.75 + 0.23 * c, 0.9 + 0.1 * c).multiplyScalar(0.4 + 0.5 * c);
    b.disque.material.color.copy(b.couronne.material.color).multiplyScalar(0.6);
  },

  approcherBornes(jeu) {
    const p = jeu.player.position;
    for (const b of this.bornes) {
      if (b.zone !== jeu.zones.nom) continue;
      if (Math.hypot(p.x - b.x, p.z - b.z) > RAYON_BORNE || Math.abs(p.y - b.y) > 2.4) continue;
      if (this.actuelle() === b) continue;
      this.activerBorne(b);
    }
  },

  /** Enregistre la borne comme point de reprise. */
  activerBorne(b, { silencieux = false } = {}) {
    const jeu = this.jeu;
    jeu.etat.remanence = { zone: b.zone, position: [...b.reprise], yaw: b.yaw, borne: b.id };
    jeu.sauver?.();
    b.impulsion = 0;
    if (!silencieux) {
      jeu.hud?.notifier(VEILLEUR.borne.notification, { duree: 4 });
      jeu.audio?.tonalite?.({ de: 520, vers: 780, duree: 0.55, volume: 0.045 });
      setTimeout(() => jeu.audio?.tonalite?.({ de: 780, vers: 1040, duree: 0.7, volume: 0.03 }), 170);
    }
    jeu.emettre('remanence:borne', { borne: b.id, zone: b.zone, position: b.reprise, yaw: b.yaw });
  },

  // ---------- Patrouilles ----------
  animerPatrouilles(t) {
    for (const p of this.patrouilles) {
      const ph = t * p.vit + p.phase;
      let x, y, z;
      if (p.type === 'cercle') {
        const a = ph * Math.PI * 2;
        x = p.cx + Math.cos(a) * p.r;
        z = p.cz + Math.sin(a) * p.r;
        y = p.y + Math.sin(t * 0.7) * 0.5;
      } else {
        const s = 0.5 - 0.5 * Math.cos(ph * Math.PI * 2);
        x = p.a[0] + (p.b[0] - p.a[0]) * s;
        y = p.a[1] + (p.b[1] - p.a[1]) * s + Math.sin(t * 0.8) * 0.4;
        z = p.a[2] + (p.b[2] - p.a[2]) * s;
      }
      p.v.groupe.position.set(x, y, z);
      this.fixerVeilleur(p.v, 1, 1, t + p.phase * 7);
    }
  },

  // ---------- Détection des chutes ----------
  /** Sol sous le joueur et hauteur totale de la chute si elle se poursuit jusque-là. */
  etatChute(jeu) {
    const p = jeu.player;
    const y = p.position.y;
    const sol = p.solSous(p.position.x, p.position.z, y + 0.35, RAYON);
    const gap = Math.max(0, y - sol);
    return { sol, gap, total: p.hauteurChute + gap };
  },

  rattrapageAutorise() {
    const e = this.jeu.etat;
    if (this.jeu.sourdine?.actif) return false; // les Veilleurs perdent leur cible
    return !e.rattrapageCoupe && (e.chutes || 0) < RATTRAPAGES;
  },

  surveillerChute(jeu) {
    const p = jeu.player;
    if (p.auSol || p.vitesseChute <= 0.5) return;
    if (!this.rattrapageAutorise()) return; // l'échec est décidé à l'atterrissage
    const { gap, total } = this.etatChute(jeu);
    if (total <= p.amortissement + 0.05) return;
    const v = p.vitesseChute;
    if (gap > (v * v) / (2 * FREINAGE) + MARGE_INTERCEPTION) return;
    this.rattraper(true);
  },

  /** Compte la chute mortelle (T6) : renvoie son numéro. */
  compterChute() {
    const e = this.jeu.etat;
    e.chutes = (e.chutes || 0) + 1;
    e.transgressions.T6 = (e.transgressions.T6 || 0) + 1;
    // entrée unique de l'Attention (chute rattrapée ou non : le compteur T6 vient d'être incrémenté)
    this.jeu.emettre('transgression', { id: 'T6', source: 'chute', attention: ATTENTION_T6 });
    return e.chutes;
  },

  surAtterrissage(ev) {
    const jeu = this.jeu;
    if (!this.pret || jeu.zones.nom !== ZONE_VILLE || this.r || this.e) return;
    if (ev.amortie) {
      if (ev.hauteurChute > SEUIL_RUDE) this.atterrissageRude(ev);
      return;
    }
    // chute mortelle qui n'a pas été interceptée
    if (this.rattrapageAutorise()) this.rattraper(false);
    else {
      const n = this.compterChute();
      // Mima ne parle qu'à la première chute qu'elle ne rattrape pas (3e, bible §7.3)
      const parole = n === RATTRAPAGES + 1 && !jeu.sourdine?.actif;
      // en Sourdine, la chute n'est pas rattrapée mais ne coupe pas le rattrapage pour la suite
      if (!jeu.sourdine?.actif || n > RATTRAPAGES) jeu.etat.rattrapageCoupe = true;
      jeu.sauver?.();
      this.echec('chute', { parole });
    }
  },

  // ---------- Atterrissage rude, sans conséquence ----------
  atterrissageRude(ev) {
    const jeu = this.jeu;
    const a = bornee((ev.hauteurChute - 1.5) / 5, 0.3, 1);
    this.secousse = { t: 0, dur: 0.55, amp: a };
    jeu.audio?.tonalite?.({ de: 68, vers: 34, duree: 0.24, volume: 0.05 + 0.06 * a });
    jeu.audio?.souffle?.({ de: 260, vers: 55, duree: 0.2, volume: 0.04 + 0.05 * a, q: 0.7 });
  },

  majSecousse(dt, jeu) {
    const s = this.secousse;
    if (!s) return;
    s.t += dt;
    if (s.t >= s.dur) { this.secousse = null; return; }
    const k = Math.exp(-s.t * 6);
    const dy = -0.45 * s.amp * k * Math.cos(s.t * 22);
    jeu.camera.position.y += dy;
    this.camDecalage = { y: dy, ecrit: jeu.camera.position.y };
  },

  /** Retire l'écart de caméra ajouté par ce système (sauf si la caméra a été replacée depuis). */
  retirerDecalage(jeu) {
    const d = this.camDecalage;
    if (!d) return;
    if (jeu.camera.position.y === d.ecrit) jeu.camera.position.y -= d.y;
    this.camDecalage = null;
  },

  // ---------- Le rattrapage ----------
  /**
   * Le Veilleur intercepte le joueur. `enVol` : vrai si le joueur est encore en l'air (cas normal) ;
   * faux s'il a déjà touché le sol (le Veilleur le « reprend » alors au sol).
   */
  rattraper(enVol) {
    const jeu = this.jeu;
    const p = jeu.player;
    const n = this.compterChute();
    jeu.sauver?.();
    const cam = new THREE.Vector3();
    jeu.camera.getWorldDirection(cam);
    cam.y = 0;
    if (cam.lengthSq() < 1e-4) cam.set(0, 0, -1);
    cam.normalize();
    const px = p.position.x, py = p.position.y, pz = p.position.z;
    const { sol, gap } = this.etatChute(jeu);
    this.r = {
      n, phase: enVol ? 'descente' : 'pose', t: 0, enVol,
      x: px, y: py, z: pz, vx: p.velocity.x, vz: p.velocity.z,
      vy: enVol ? Math.min(0, p.velocity.y) : 0,
      dirX: cam.x, dirZ: cam.z, parle: false, poseFait: false,
    };
    jeu.suspendre('veilleur');
    // arrivée : devant le joueur, un peu sous la vue, et rapide
    const dep = enVol ? Math.min(gap, 5) : 0.8;
    const lat = 0.55;
    this.vi.groupe.visible = true;
    this.vi.groupe.position.set(px + cam.x * 7 - cam.z * lat * 4, py - dep + 0.5, pz + cam.z * 7 + cam.x * lat * 4);
    this.fixerVeilleur(this.vi, 1, 1, jeu.t);
    jeu.audio?.souffle?.({ de: 320, vers: 2100, duree: 0.38, volume: 0.1, q: 1.4 });
    jeu.audio?.tonalite?.({ de: 330, vers: 160, duree: 1.1, volume: 0.035 });
    void sol;
    jeu.emettre('veilleur:rattrapage', { n, transgression: 'T6', attention: ATTENTION_T6, enVol });
    if (!enVol) this.surPose(jeu);
  },

  majRattrapage(dt, t, jeu) {
    const r = this.r;
    const p = jeu.player;
    r.t += dt;
    const vi = this.vi;
    const g = vi.groupe;

    if (r.phase === 'descente' || r.phase === 'pose') {
      // le joueur
      const att = Math.exp(-dt * 3.2);
      r.vx *= att; r.vz *= att;
      const nx = r.x + r.vx * dt, nz = r.z + r.vz * dt;
      if (!p.bloque(nx, r.z, r.y)) r.x = nx; else r.vx = 0;
      if (!p.bloque(r.x, nz, r.y)) r.z = nz; else r.vz = 0;
      const sol = p.solSous(r.x, r.z, r.y + 0.35, RAYON);
      const gap = Math.max(0, r.y - sol);
      if (r.phase === 'descente') {
        const permis = Math.max(0.3, 1.15 * bornee(gap / 1.5, 0.25, 1), Math.sqrt(2 * FREINAGE * Math.max(0, gap - 1.5)));
        r.vy = Math.max(r.vy - 20 * dt, -permis); // gravité, plafonnée par la courbe de freinage
        r.y += r.vy * dt;
        if (r.y - sol <= 0.03) { r.y = sol; r.phase = 'pose'; r.t = 0; this.surPose(jeu); }
      } else {
        r.y = sol;
      }
      p.teleporter(r.x, r.y, r.z);

      // le Veilleur : sous les pieds, puis se range sur le côté à l'arrivée
      // il suit le regard : on le voit passer sous les pieds, puis se poser devant soi
      const dv = jeu.camera.getWorldDirection(this.tmp);
      const dn = Math.hypot(dv.x, dv.z);
      if (dn > 0.2) { r.dirX = dv.x / dn; r.dirZ = dv.z / dn; }
      const droitX = -r.dirZ, droitZ = r.dirX;
      const arrive = r.phase === 'pose' ? 1 : 1 - bornee(gap / 1.8, 0, 1);
      const cx = r.x + droitX * 0.6 * arrive + r.dirX * 1.9 * arrive;
      const cz = r.z + droitZ * 0.6 * arrive + r.dirZ * 1.9 * arrive;
      let cy = Math.max(sol + 0.3, r.y - 0.85);
      if (r.phase === 'pose') cy = sol + 0.3 + (1.0 - 0.3) * bornee((r.t - 0.15) / 0.7, 0, 1);
      const kh = 1 - Math.exp(-dt * (r.phase === 'pose' ? 5 : 9));
      const ky = 1 - Math.exp(-dt * 24);
      g.position.x += (cx - g.position.x) * kh;
      g.position.z += (cz - g.position.z) * kh;
      g.position.y += (cy - g.position.y) * ky;
      if (g.position.y > r.y - 0.4 && r.phase === 'descente') g.position.y = r.y - 0.4;
      this.fixerVeilleur(vi, 1, 1 + 0.25 * Math.sin(r.t * 6) * (r.phase === 'descente' ? 1 : 0), t);

      if (r.phase === 'pose' && r.t >= 0.9) {
        jeu.reprendre('veilleur');
        r.phase = 'depart';
        r.t = 0;
        r.depart = { x: g.position.x, y: g.position.y, z: g.position.z };
      }
    } else if (r.phase === 'depart') {
      // le Veilleur s'élève et s'éloigne en s'effaçant
      const s = bornee(r.t / 3.2, 0, 1);
      const e = s * s;
      g.position.set(
        r.depart.x + r.dirX * 6 * e + 0.5 * Math.sin(r.t * 2),
        r.depart.y + 1.5 * s + 9 * e,
        r.depart.z + r.dirZ * 6 * e
      );
      this.fixerVeilleur(vi, 1 - e, 1 + 0.4 * e, t);
      if (s >= 1) {
        g.visible = false;
        this.r = null;
      }
    }
  },

  surPose(jeu) {
    const r = this.r;
    if (r.poseFait) return;
    r.poseFait = true;
    jeu.audio?.tonalite?.({ de: 180, vers: 80, duree: 0.35, volume: 0.04 });
    const txt = VEILLEUR.mima.rattrape[Math.min(r.n, VEILLEUR.mima.rattrape.length) - 1];
    if (txt) jeu.hud?.mima(txt, { duree: 6 });
    // la pose est le moment où l'on sait que c'est fini : le sol est atteint, rien ne reste en l'air
    jeu.player.teleporter(r.x, r.y, r.z);
  },

  /** Lueur du Veilleur sur les murs proches. */
  majLampe() {
    const r = this.r;
    if (!r || !this.vi.groupe.visible) { this.lampe.intensity = 0; return; }
    this.lampe.position.copy(this.vi.groupe.position);
    this.lampe.intensity = 28 * this.vi.alpha;
  },

  // =====================================================================
  // Échec : fondu blanc, silence, retour à la dernière borne
  // =====================================================================
  /**
   * Échec réel (chute, plus tard zones interdites…) : fondu blanc, silence, retour à la dernière borne
   * de Rémanence. Émet `joueur:echec { cause }`. Renvoie une Promise résolue quand le joueur a repris la main.
   * `opts.parole` : vrai pour dire la phrase de Mima après le retour.
   */
  echec(cause = 'chute', { parole = false } = {}) {
    if (this.e) return this.e.promesse;
    const jeu = this.jeu;
    const e = { cause, parole, t: 0, teleporte: false, coupe: false };
    e.promesse = new Promise((res) => { e.fin = res; });
    this.e = e;
    if (this.r) { this.r = null; this.vi.groupe.visible = false; jeu.reprendre('veilleur'); }
    jeu.suspendre('echec');
    jeu.emettre('joueur:echec', { cause });
    return e.promesse;
  },

  /** Borne de retour : la dernière enregistrée ; à défaut, celle de la clinique. */
  pointDeReprise() {
    const r = this.jeu.etat.remanence;
    if (r && r.position) return r;
    const b = this.bornes[0];
    return b ? { zone: b.zone, position: b.reprise, yaw: b.yaw, borne: b.id } : null;
  },

  majEchec(dt, jeu) {
    const e = this.e;
    e.t += dt;
    const { montee, tenue, descente } = FOND_BLANC;
    let o;
    if (e.t < montee) o = e.t / montee;
    else if (e.t < montee + tenue) o = 1;
    else o = 1 - (e.t - montee - tenue) / descente;
    o = bornee(o, 0, 1);
    this.fond.style.opacity = String(o * o * (3 - 2 * o));
    // le monde se tait
    if (!e.coupe && e.t > 0.15) {
      e.coupe = true;
      if (jeu.audio && !jeu.audio.coupe) { jeu.audio.toggle(); this.sonCoupe = true; }
    }
    // tout blanc : on déplace le joueur
    if (!e.teleporte && e.t >= montee) {
      e.teleporte = true;
      const pt = this.pointDeReprise();
      if (pt) {
        const [x, y, z] = pt.position;
        if (pt.zone && pt.zone !== jeu.zones.nom) jeu.zones.installer(pt.zone, { position: [x, y, z], yaw: pt.yaw });
        else jeu.player.teleporter(x, y, z, pt.yaw, 0);
        e.point = pt;
        jeu.memoriserPosition?.();
        jeu.sauver?.();
      }
    }
    if (e.t >= montee + tenue + descente) {
      this.fond.style.opacity = '0';
      if (this.sonCoupe && jeu.audio?.coupe) jeu.audio.toggle();
      this.sonCoupe = false;
      this.e = null;
      jeu.reprendre('echec');
      jeu.audio?.tonalite?.({ de: 440, vers: 660, duree: 0.8, volume: 0.025 });
      jeu.emettre('joueur:reprise', { cause: e.cause, zone: e.point?.zone, position: e.point?.position, yaw: e.point?.yaw });
      if (e.parole) {
        jeu.hud?.mima(VEILLEUR.mima.echec, { duree: 6 });
      }
      e.fin();
    }
  },
};
