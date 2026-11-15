import * as THREE from 'three';
import { profils } from '../state.js';
import { FINS } from '../data/fins.js';
import { REGLAGES_SILENCE as R, TEXTES_SILENCE as T, REPLIS_SILENCE as REPLIS } from '../data/silence.js';
import {
  EXTINCTION, AUBE, CATEGORIES, NB_QUARTIERS, rallumerTout, eteignable, eteignableGroupe, niveau,
} from '../extinction.js';
import { dialoguesEtape5 } from '../zones/kura.js';
import { npc } from './npc.js';
import { marche } from './marche.js';
import { hashira } from './hashira.js';

// ============================================================================================================
// Fin 5 « Le Silence » (bible §8) et l'aube (plan 5.7, 5.8). Textes : data/dialogues-etape5.js (voix, phrase de
// Mima, épilogue) et data/silence.js (réglages, invites, replis). Ville éteignable : src/extinction.js.
//
// DÉROULÉ
//   1. Salle de l'Interrupteur (zone kura). L'invite « S'approcher de l'Interrupteur » sur le levier ouvre le
//      dialogue de seuil (`choisirDialogueEtape5('interrupteur')`). Sous Sourdine, ou si Mima s'est déjà tue, ses
//      répliques du seuil sont remplacées par une narration (« Rien ne répond »). Si à la fermeture le drapeau
//      `interrupteur_main` est posé (il est effacé), l'Interrupteur est ARMÉ : l'invite devient « Tenir
//      l'Interrupteur (maintenir) » ; E maintenu = la main sur l'Interrupteur (si E est encore enfoncé à la fermeture
//      du dialogue, la tenue commence tout de suite). On garde l'armement tant qu'on reste à moins de 8 m.
//   2. La TENUE : 30 s de E maintenu (temps de jeu, seulement quand le joueur a la main ; s'éloigner de plus de
//      1,5 m, ouvrir la pause ou lâcher E = lâcher). Au premier contact de la partie, Mima dit UNE phrase
//      (PHRASE_MIMA_SILENCE selon le profil, comme fins.js : le premier profil de `profils()` qui a une phrase, sinon
//      `defaut`), puis sa bande est masquée : `muette` (attention, conseils, réactions, Veilleurs, Calque se taisent).
//      Sous Sourdine au premier contact, elle n'entend pas : pas de phrase (elle reste due), mais elle se tait aussi.
//      Pendant la tenue (data/silence.js) : VOIX_SILENCE une à une sur les seize écrans de la salle (lettre à lettre,
//      ordre `ecransOrdre`) ; par la baie, le panorama s'éteint quartier par quartier (rangée du fond, du milieu, la
//      plus proche, le centre, la tour), et dans chaque quartier enseignes (qui grésillent), fenêtres, hologrammes,
//      halos ; le levier descend ; la nappe perd ses notes une à une, la pluie (à travers la vitre) monte, le filtre
//      s'ouvre ; à la fin le ronflement de Kura change de timbre ; des gouttes coulent sur la baie.
//      LÂCHER : rien n'est perdu ; tout remonte doucement (≈ 3 s), les seize écrans disent une ligne de VOIX_RELACHE
//      (une par lâcher, dans l'ordre), le levier remonte ; reprendre recommence du début.
//   3. À 30 s, c'est FAIT : `etat.silence.etape = 'aube'` (sauvegardé), joueur figé, la salle s'éteint, les écrans un
//      à un, 7,5 s de silence devant la ville noire, fondu au noir.
//   4. L'AUBE, dans Kasumi, sur le parvis de Kura : toute la ville éteinte (extinction.js, catégories à 0), les
//      ShaderMaterial brillants non éteignables masqués, lumières ponctuelles à 0, Veilleurs masqués, habitants
//      arrêtés (npc.reaction.aube ; un sur trois lève la tête), machines figées (robots.fige), aucune interaction
//      (interact.filtre), Mima muette. En 40 s le ciel passe du violet au gris pâle (AUBE + couleurs de
//      `palette`), le brouillard s'éclaircit et pâlit, la lumière monte, la pluie faiblit (image et son, puis presque
//      rien). Quelques habitants murmurent. Une braise à la main d'Oba. À l'arrivée au marché (ciel gris), ou après
//      115 s, ou hors de Kasumi : `jeu.fins.terminer('fin5', { paragraphes: EPILOGUE_SILENCE.texte })` ; la phrase
//      `EPILOGUE_SILENCE.detresse` s'ajoute au bilan si `etat.detresseMimaVue` (FINS.fin5.bilanSupplement).
//   5. Après l'écran de fin (`fin:terminee`), TOUT est rendu : ville de nuit, Mima, son, Kura (panorama, levier,
//      écrans). « Reprendre » rend une partie saine, là où l'aube l'a laissée (au marché), la fin étant enregistrée.
//
// ROBUSTESSE : rien de la tenue n'est sauvegardé (un rechargement pendant les 30 s rend une salle intacte) ; une fois
// FAIT, `etat.silence.etape = 'aube'` : un rechargement reprend l'aube (dans Kasumi, ou sur le parvis s'il était dans
// Kura) et mène à la fin ; effacé au début de l'écran de fin. Nouvelle partie : tout est remis.
//
// API (`jeu.silence`) : etat ('repos' | 'arme' | 'tenue' | 'fait' | 'aube' | 'fin'), tenue (s), progression (0..1),
//   muette, aube (0..1), arme, eteindreVille(niveaux), rallumerVille(), niveauxVille(), commencer() (tests : arme et
//   prend l'Interrupteur), lancerAube({ reprise }), restaurer(), compteurs { contacts, relaches, voix }.
//   eteindreVille(niveaux) : niveaux = nombre 0..1 (tout), ou { enseignes, fenetres, hologrammes, halos } dont chaque
//   valeur est un nombre ou un tableau de 10 (par quartier) ; la vraie ville (Kasumi) suit ; sans effet pendant
//   la séquence (elle pilote elle-même).
// Évènements : `silence:arme`, `silence:contact { premier, phrase }`, `silence:relache { tenue }`, `silence:fait`,
//   `silence:aube { reprise }`, `silence:fin`.
// État : `etat.silence = { phrase (la phrase de Mima a été dite), etape (null | 'aube'), contacts, relaches }`,
//   `etat.zonesVisitees` reçoit 'refuge' et 'interrupteur' (lus par les dialogues).
// ============================================================================================================

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lisse = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const lerp = (a, b, k) => a + (b - a) * k;
const tab = (x) => (Array.isArray(x) ? x : x == null ? [] : [x]);

/** Textes de dialogues-etape5.js (ou les replis). */
function textes() {
  const m = dialoguesEtape5() || {};
  return {
    voix: tab(m.VOIX_SILENCE).length ? tab(m.VOIX_SILENCE).map(String) : REPLIS.voix,
    relache: tab(m.VOIX_RELACHE).length ? tab(m.VOIX_RELACHE).map(String) : REPLIS.relache,
    phrase: m.PHRASE_MIMA_SILENCE && typeof m.PHRASE_MIMA_SILENCE === 'object' ? m.PHRASE_MIMA_SILENCE : REPLIS.phrase,
    epilogue: m.EPILOGUE_SILENCE?.texte ? m.EPILOGUE_SILENCE : REPLIS.epilogue,
  };
}

/** Coupe une ligne en lignes d'au plus `n` caractères (aux espaces). */
function couper(texte, n) {
  const mots = String(texte).split(/\s+/);
  const L = [];
  let cur = '';
  for (const m of mots) {
    if (!cur) cur = m;
    else if ((cur + ' ' + m).length <= n) cur += ' ' + m;
    else { L.push(cur); cur = m; }
  }
  if (cur) L.push(cur);
  return L;
}

const _couleurs = new Map();
/** Couleur sRGB → espace de travail linéaire (ColorManagement), gardée en cache. */
const couleur = (hex) => { let c = _couleurs.get(hex); if (!c) _couleurs.set(hex, (c = new THREE.Color(hex))); return c; };

/** Gouttes sur la baie : un plan additif, lignes qui coulent (temps et intensité en uniforms). */
function creerPluieVitre() {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    fog: false,
    uniforms: { uT: { value: 0 }, uI: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uT; uniform float uI;
      varying vec2 vUv;
      float h(float n) { return fract(sin(n * 127.1) * 43758.5453); }
      float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec2 p = vUv * vec2(36.0, 23.4);
        float a = 0.0;
        for (int k = 0; k < 2; k++) {
          float w = k == 0 ? 0.11 : 0.23;
          float col = floor(p.x / w) + float(k) * 91.0;
          float on = step(0.7, h(col + 11.3));
          float vit = 0.5 + 1.9 * h(col + 3.1);
          float L = 1.4 + 3.6 * h(col + 7.7);
          float s = fract((p.y + uT * vit + h(col) * 40.0) / L);
          float trainee = smoothstep(0.0, 0.03, s) * (1.0 - smoothstep(0.03, 0.55, s));
          float tete = 1.0 - smoothstep(0.0, 0.05, abs(s - 0.02));
          float x = abs(fract(p.x / w) - 0.5) * 2.0;
          float larg = 1.0 - smoothstep(0.0, 0.35, x);
          a += on * larg * (trainee * 0.55 + tete * 0.9);
        }
        // gouttes posées
        vec2 g = floor(p / 0.07);
        float d = step(0.992, h2(g)) * (1.0 - smoothstep(0.2, 0.5, length(fract(p / 0.07) - 0.5)));
        a += d * 0.7;
        gl_FragColor = vec4(vec3(0.50, 0.58, 0.74) * a * uI * 0.32, 1.0);
      }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(36, 23.4), mat);
  m.position.set(402, 0.6 + 11.7, -339.55);
  m.renderOrder = 9;
  m.frustumCulled = false;
  m.visible = false;
  m.name = 'silence-pluie-vitre';
  return m;
}

/** Multiplicateur d'une valeur qu'un autre code peut réécrire (lumières) : on garde la base, on détecte les écritures. */
function multiplicateur(obj, cle) {
  return { obj, cle, base: obj[cle], ecrit: null };
}
function appliquerMult(m, k) {
  if (m.ecrit === null || m.obj[m.cle] !== m.ecrit) m.base = m.obj[m.cle]; // quelqu'un d'autre l'a changée
  m.ecrit = m.base * k;
  m.obj[m.cle] = m.ecrit;
}
function rendreMult(m) {
  if (m.ecrit !== null && m.obj[m.cle] === m.ecrit) m.obj[m.cle] = m.base;
  m.ecrit = null;
}

// ============================================================================================================
export const silence = {
  nom: 'silence',
  etat: 'repos',
  tenue: 0,
  muette: false,
  aube: 0,
  compteurs: { contacts: 0, relaches: 0, voix: 0 },

  // interne
  _niv: null, // niveaux lissés par catégorie : Float32Array(10)
  _pilote: false, // la séquence pilote les niveaux de la ville (sinon eteindreVille est libre)
  _levier: 0, // 0 haut, 1 bas
  _nappe: [1, 1, 1, 1],
  _nappeEnvoye: [1, 1, 1, 1],
  _timbre: 0,
  _timbreEnvoye: 0,
  _sonSalle: { pluie: 0, filtre: 0, envoyeT: -9, actif: false },
  _voixMontrees: null,
  _ecrans: [], // { texte: [lignes], debut, n, dernier } par écran
  _relache: null, // { t0, texte }
  _contactPos: null,
  _phraseT: -1,
  _tf: 0,
  _ta: 0,
  _hors: 0,
  _marcheT: 0,
  _murmures: { n: 0, dernier: -99, dits: new Set() },
  _salle: null, // ressources de la salle (kura)
  _ville: null, // ressources de Kasumi
  _aReprendre: false,

  // -------------------------------------------------------------------------------------- initialisation
  init(jeu) {
    this.jeu = jeu;
    jeu.silence = this;
    this._niv = Object.fromEntries(CATEGORIES.map((c) => [c, new Float32Array(NB_QUARTIERS).fill(1)]));
    this.etatPartie();
    if (jeu.etat.silence?.etape === 'aube') this._aReprendre = true;

    // fin 5 : la phrase de détresse au bilan (fins.js lit FINS[id].bilanSupplement)
    FINS.fin5 = {
      titre: 'Le Silence',
      bilanSupplement: (etat) => (etat.detresseMimaVue ? tab(textes().epilogue.detresse).map(String) : []),
    };

    // le levier (zone kura) : invite, dialogue de seuil, puis la tenue
    this.objLevier = jeu.interact.ajouter({
      zone: 'kura',
      position: R.levier.position,
      rayon: R.levier.rayon,
      cone: R.levier.cone,
      libelle: () => (this.etat === 'arme' ? T.inviteTenir : T.inviteSeuil),
      visible: () => (this.etat === 'repos' || this.etat === 'arme') && jeu.kura?.salle === 'interrupteur',
      sansEtiquette: true,
      action: () => { if (this.etat === 'arme') this.commencerContact(); else if (this.etat === 'repos') this.ouvrirSeuil(); },
    });

    this.preparerVille(jeu);

    jeu.on('kura:salle', ({ salle }) => this.surSalle(salle));
    jeu.on('partie:nouvelle', () => this.surNouvellePartie());
    jeu.on('fin:debut', ({ id }) => {
      if (id !== 'fin5') return;
      if (this.etat === 'aube') this.etat = 'fin';
      // un rechargement pendant l'épilogue ne doit pas rejouer l'aube : la fin est déjà enregistrée
      jeu.etat.silence = { ...this.etatPartie(), etape: null };
    });
    jeu.on('fin:terminee', ({ id }) => { if (id === 'fin5') { this.restaurer(); jeu.emettre('silence:fin'); } });
  },

  /** `etat.silence`, créé au besoin. */
  etatPartie() {
    const e = this.jeu.etat;
    if (!e.silence || typeof e.silence !== 'object') e.silence = { phrase: false, etape: null, contacts: 0, relaches: 0 };
    return e.silence;
  },

  /** Ressources de Kasumi : ciel, lumières, matériaux éteignables (avant la première compilation). */
  preparerVille(jeu) {
    const k = jeu.zones.get('kasumi');
    const city = k.city;
    const scene = k.scene;
    const V = { zone: k, city, scene, surMesure: new Set(), masques: new Map(), lumieres: [], hemi: null, lune: null };
    scene.traverse((o) => {
      if (o.isHemisphereLight && !V.hemi) V.hemi = o;
      else if (o.isDirectionalLight && !V.lune) V.lune = o;
    });
    if (V.hemi) V.hemiBase = { ciel: V.hemi.color.clone(), sol: V.hemi.groundColor.clone(), i: V.hemi.intensity };
    if (V.lune) V.luneBase = { c: V.lune.color.clone(), i: V.lune.intensity, p: V.lune.position.clone() };
    V.miroirBase = city.mirror?.material?.uniforms?.color?.value?.clone?.() || null;

    this._ville = V;
    this.injecterVille();
  },

  /** La braise de la cigarette d'Oba (seule lumière chaude de l'aube), créée à la première aube (pendant le noir) :
   *  rien n'est créé tant que la fin n'est pas jouée (pas même un identifiant tiré au hasard : rendu normal inchangé). */
  creerBraise() {
    const V = this._ville;
    const t = marche.ancres?.tabouret;
    if (V.braise || !t) return;
    const b = new THREE.Mesh(new THREE.SphereGeometry(R.braise.taille, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff7a30, toneMapped: false }));
    b.position.set(t.x + R.braise.decalage[0], t.y + R.braise.decalage[1], t.z + R.braise.decalage[2]);
    b.visible = false;
    b.userData.silenceExclu = true;
    b.name = 'silence-braise';
    V.scene.add(b);
    V.braise = b;
  },

  /** Rend éteignable tout ce qui brille dans Kasumi (sauf Kura, la pluie, le ciel, le miroir) ; liste le reste. */
  injecterVille() {
    const V = this._ville;
    const jeu = this.jeu;
    const exclus = new Set([jeu.rain?.mesh, V.city.sky, V.city.mirror, jeu.kura?.passerelle, V.braise].filter(Boolean));
    const r = eteignableGroupe(V.scene, { exclure: (o) => exclus.has(o) || o.isReflector || o.userData?.silenceExclu });
    // la passerelle de Kura : ses filets bleus restent (Kura brille toujours), ses garde-corps magenta sont à la ville
    jeu.kura?.passerelle?.traverse((o) => {
      const m = o.material;
      if (m?.isMeshBasicMaterial && m.toneMapped === false && !m.map && !m.userData?.extinction && m.color.r > m.color.b + 0.05) {
        eteignable(m, 'enseignes', { plancher: 0.06 });
      }
    });
    for (const o of r.sur_mesure) V.surMesure.add(o);
    V.lumieres.length = 0;
    V.scene.traverse((o) => {
      if ((o.isPointLight || o.isSpotLight) && !o.userData?.silenceExclu) V.lumieres.push({ l: o, m: multiplicateur(o, 'intensity') });
    });
    return r.injectes;
  },

  surZone(nom, zone, jeu) {
    if (nom === 'kasumi') this.injecterVille(); // ce qui s'est créé depuis (robots : à la première entrée)
    if (nom === 'kura') this.preparerSalle(jeu);
  },

  /** Ressources de la salle de l'Interrupteur (zone kura, construite à la demande). */
  preparerSalle(jeu) {
    if (this._salle) return;
    const z = jeu.kura.zone;
    const S = { zone: z, hemi: null, dir: null, mats: [], forces: [] };
    z.scene.traverse((o) => {
      if (o.isHemisphereLight && !S.hemi) S.hemi = o;
      else if (o.isDirectionalLight && !S.dir) S.dir = o;
    });
    const groupe = z.groupes?.salle;
    const pano = z.panorama?.groupe;
    const ecrans = new Set((z.ecrans?.interrupteur || []).map((e) => (e.ecran || e).mesh));
    const vus = new Set();
    if (groupe) {
      const visiter = (o) => {
        if (o === pano || ecrans.has(o)) return;
        const m = o.material;
        if (m && !vus.has(m)) {
          vus.add(m);
          if ((m.isMeshBasicMaterial && m.toneMapped === false) && !m.transparent) S.mats.push({ m, base: m.color.clone() });
          else if (m.isShaderMaterial && m.uniforms?.uForce) S.forces.push({ u: m.uniforms.uForce, base: m.uniforms.uForce.value });
        }
        for (const e of o.children) visiter(e);
      };
      visiter(groupe);
      S.vitre = creerPluieVitre();
      groupe.add(S.vitre);
    }
    this._salle = S;
  },

  get ecransSalle() { return (this.jeu.kura?.zone?.ecrans?.interrupteur || []).map((e) => e.ecran || e); },
  get arme() { return this.etat === 'arme'; },
  get progression() { return clamp(this.tenue / R.duree, 0, 1); },

  // -------------------------------------------------------------------------------------- le seuil
  surSalle(salle) {
    const e = this.jeu.etat;
    const visiter = (n) => { if (!e.zonesVisitees.includes(n)) e.zonesVisitees.push(n); };
    if (salle === 'refuge') visiter('refuge');
    if (salle === 'interrupteur') visiter('interrupteur');
  },

  /** Le dialogue de seuil (sous Sourdine, ou Mima tue : elle ne répond pas). */
  dialogueSeuil() {
    const jeu = this.jeu;
    const m = dialoguesEtape5();
    let d = null;
    if (m?.DIALOGUES_ETAPE5 && typeof m.choisirDialogueEtape5 === 'function') {
      try { d = m.DIALOGUES_ETAPE5[m.choisirDialogueEtape5('interrupteur', jeu.etat)] || null; } catch (err) { console.error('[silence] seuil :', err); }
    }
    if (!d) d = REPLIS.seuil;
    const sourde = !!jeu.sourdine?.actif;
    if (!sourde && !this.muette) return d;
    // copie où chaque réplique de Mima devient une narration : l'appel reste sans réponse
    const noeuds = {};
    const texte = sourde ? T.appelSourdine : T.appelMuette;
    for (const [id, n] of Object.entries(d.noeuds)) {
      noeuds[id] = n.qui === 'Mima' ? { qui: '', texte, ...(d.noeuds.retour ? { suite: 'retour' } : {}) } : n;
    }
    return { ...d, noeuds };
  },

  async ouvrirSeuil() {
    const jeu = this.jeu;
    if (this._seuilOuvert || jeu.dialogue?.estOuvert) return;
    this._seuilOuvert = true;
    try {
      await jeu.ouvrirDialogue(this.dialogueSeuil());
    } finally {
      this._seuilOuvert = false;
    }
    const e = jeu.etat;
    e.rencontres.interrupteur = (e.rencontres.interrupteur || 0) + 1;
    const d = e.drapeaux;
    const pose = d && ((Array.isArray(d) && d.includes('interrupteur_main')) || d.interrupteur_main === true);
    if (Array.isArray(d)) { const i = d.indexOf('interrupteur_main'); if (i >= 0) d.splice(i, 1); }
    if (d) delete d.interrupteur_main;
    jeu.sauver?.();
    if (!pose || this.etat !== 'repos' || jeu.kura?.salle !== 'interrupteur') return;
    this.etat = 'arme';
    jeu.emettre('silence:arme');
    if (jeu.input.isDown('KeyE')) this.commencerContact(); // E encore tenu : la main reste posée
  },

  /** Tests : arme l'Interrupteur et prend le contact (comme après le seuil). */
  commencer() {
    if (this.etat === 'repos') this.etat = 'arme';
    if (this.etat === 'arme') this.commencerContact();
  },

  // -------------------------------------------------------------------------------------- la tenue
  commencerContact() {
    const jeu = this.jeu;
    if (this.etat !== 'arme') return;
    this.etat = 'tenue';
    this.tenue = 0;
    this._pilote = true;
    this._contactPos = jeu.player.position.clone();
    this._voixMontrees = new Set();
    this.effacerEcrans();
    this._relache = null;
    const ep = this.etatPartie();
    ep.contacts = (ep.contacts | 0) + 1;
    this.compteurs.contacts++;
    // la première fois (et seulement si elle entend) : une phrase, puis plus rien
    let phrase = null;
    const premier = !ep.phrase;
    if (premier && !jeu.sourdine?.actif) {
      const P = textes().phrase;
      const cle = profils().find((p) => P[p]) || 'defaut';
      phrase = P[cle] || P.defaut || REPLIS.phrase.defaut;
      ep.phrase = true;
      jeu.hud.viderMima({ courant: true });
      jeu.masquerMima('silence', false);
      jeu.hud.mima(phrase, { duree: R.phraseMima.duree });
      this._phraseT = jeu.t + R.phraseMima.duree + 0.4;
      this.derniereP = { cle, phrase };
    } else if (!this.muette) {
      jeu.hud.viderMima({ courant: true });
      this._phraseT = -1;
      jeu.masquerMima('silence', true);
    }
    this.muette = true;
    jeu.audio?.tonalite?.({ de: 74, vers: 61, duree: 1.4, volume: 0.035 });
    jeu.sauver?.();
    jeu.emettre('silence:contact', { premier, phrase });
  },

  relacher() {
    const jeu = this.jeu;
    if (this.etat !== 'tenue') return;
    const tenue = this.tenue;
    this.etat = 'arme';
    this.tenue = 0;
    const ep = this.etatPartie();
    const L = textes().relache;
    const texte = L[(ep.relaches | 0) % L.length];
    ep.relaches = (ep.relaches | 0) + 1;
    this.compteurs.relaches++;
    this._relache = { t0: jeu.t, texte, ecrit: false };
    this._ecrans = [];
    jeu.audio?.tonalite?.({ de: 61, vers: 70, duree: 1.6, volume: 0.025 });
    jeu.emettre('silence:relache', { tenue });
  },

  /** Quitter la salle (ou s'éloigner) sans avoir fini : Mima revient, l'Interrupteur se désarme. */
  desarmer() {
    if (this.etat === 'tenue') this.relacher();
    if (this.etat === 'arme') this.etat = 'repos';
    // Mima reste muette tant qu'on est dans la salle (update la rend à la sortie)
  },

  retablirMima() {
    const jeu = this.jeu;
    this.muette = false;
    this._phraseT = -1;
    jeu.hud.viderMima({ courant: true }); // ce qui s'est dit pendant qu'elle se taisait ne ressort pas
    jeu.masquerMima('silence', false);
  },

  /** Niveaux voulus d'un quartier à `tenue` secondes. */
  ciblesQuartier(q, tenue, t, sortie) {
    const d = R.quartiers.find((x) => x.q === q);
    const u = d ? clamp((tenue - d.debut) / (d.fin - d.debut), 0, 1) : 0;
    for (const c of CATEGORIES) {
      const [a, b] = R.phases[c];
      sortie[c] = 1 - lisse((u - a) / (b - a));
    }
    return sortie;
  },

  /** Avance les niveaux lissés (extinction immédiate, rallumage doux) et les applique au panorama et à la ville. */
  majNiveaux(dt, t) {
    const jeu = this.jeu;
    const tout0 = this.etat === 'fait' || this.etat === 'aube' || this.etat === 'fin';
    const tient = this.etat === 'tenue';
    const c = {};
    let tousAUn = true;
    for (let q = 0; q < NB_QUARTIERS; q++) {
      if (tient) this.ciblesQuartier(q, this.tenue, t, c);
      for (const cat of CATEGORIES) {
        const cible = tout0 ? 0 : tient ? c[cat] : 1;
        const n = this._niv[cat];
        n[q] = cible < n[q] ? cible : Math.min(cible, n[q] + R.rallumage * dt);
        if (n[q] < 1) tousAUn = false;
      }
    }
    // sortie : enseignes qui grésillent en mourant
    const pano = jeu.zones.construites.includes('kura') ? jeu.kura.panorama : null;
    for (let q = 0; q < NB_QUARTIERS; q++) {
      let ens = this._niv.enseignes[q];
      if (tient && ens > 0.03 && ens < 0.97) {
        const g = Math.sin(t * 37.1 + q * 3.7) * Math.sin(t * 23.3 + q * 1.3);
        if (g > 0.3) ens *= 1 - R.gresillement;
      }
      EXTINCTION.enseignes.value[q] = ens;
      EXTINCTION.fenetres.value[q] = this._niv.fenetres[q];
      EXTINCTION.hologrammes.value[q] = this._niv.hologrammes[q];
      EXTINCTION.halos.value[q] = this._niv.halos[q];
      pano?.regler(q, { enseignes: ens, fenetres: this._niv.fenetres[q], hologrammes: this._niv.hologrammes[q], halos: this._niv.halos[q] });
    }
    // la vraie ville n'est éteinte que quand on la voit (Kasumi) : ailleurs, les matériaux partagés restent intacts
    EXTINCTION.actif.value = !tousAUn && jeu.zones.nom === 'kasumi' ? 1 : 0;
    if (tousAUn && !tient && !tout0) this._pilote = false;
    return tousAUn;
  },

  /** Moyenne des niveaux (0 = ville éteinte). */
  moyenne() {
    let s = 0;
    for (const cat of CATEGORIES) for (let q = 0; q < NB_QUARTIERS; q++) s += this._niv[cat][q];
    return s / (CATEGORIES.length * NB_QUARTIERS);
  },

  majSon(dt, jeu) {
    const audio = jeu.audio;
    if (!audio) return;
    const tient = this.etat === 'tenue';
    const tout0 = this.etat === 'fait' || this.etat === 'aube' || this.etat === 'fin';
    for (const n of R.nappe) {
      const cible = tout0 ? 0 : tient ? 1 - lisse((this.tenue - n.debut) / (n.fin - n.debut)) : 1;
      const v = this._nappe[n.note];
      this._nappe[n.note] = cible < v ? cible : Math.min(cible, v + R.rallumage * dt);
    }
    if (this._nappe.some((v, i) => Math.abs(v - this._nappeEnvoye[i]) > 0.004 || (v === 1 && this._nappeEnvoye[i] !== 1))) {
      audio.nappeNotes?.(this._nappe, 0.3);
      this._nappeEnvoye = [...this._nappe];
    }
    const cibleT = tout0 ? 1 : tient ? lisse((this.tenue - R.ronflement.debut) / (R.ronflement.fin - R.ronflement.debut)) : 0;
    this._timbre = cibleT > this._timbre ? cibleT : Math.max(cibleT, this._timbre - R.rallumage * dt);
    if (Math.abs(this._timbre - this._timbreEnvoye) > 0.01 || (this._timbre === 0 && this._timbreEnvoye !== 0)) {
      audio.ronflementTimbre?.(this._timbre, 0.6);
      this._timbreEnvoye = this._timbre;
    }
    // dans la salle : la pluie à travers la vitre, le filtre qui s'ouvre
    const S = this._sonSalle;
    if (jeu.kura?.salle === 'interrupteur' && this.etat !== 'aube') {
      const k = 1 - this.moyenne();
      const pluie = R.pluieSalle * k;
      const filtre = lerp(R.filtreSalle, R.filtreOuvert, k);
      const fini = k === 0 && S.pluie !== 0;
      if (((Math.abs(pluie - S.pluie) > 0.002 || Math.abs(filtre - S.filtre) > 40) && jeu.t - S.envoyeT > 0.15) || fini) {
        audio.regler({ pluie, filtre, duree: 0.5 });
        S.pluie = pluie; S.filtre = filtre; S.envoyeT = jeu.t; S.actif = k > 0;
      }
    } else if (S.actif && jeu.zones.nom === 'kura') {
      audio.regler({ pluie: 0, filtre: R.filtreSalle, duree: 1 });
      S.actif = false; S.pluie = 0; S.filtre = R.filtreSalle;
    }
  },

  // -------------------------------------------------------------------------------------- écrans
  effacerEcrans() {
    for (const e of this.ecransSalle) { e.effacer(); e.materiau?.color.setScalar(1); }
    this._ecrans = [];
  },

  majVoix(t) {
    const E = this.ecransSalle;
    if (!E.length) return;
    const V = R.voix;
    const lignes = textes().voix;
    const N = lignes.length;
    if (this.etat === 'tenue') {
      for (let i = 0; i < N; i++) {
        if (this._voixMontrees.has(i)) continue;
        const ti = N > 1 ? V.debut + ((V.fin - V.debut) * i) / (N - 1) : V.debut;
        if (this.tenue < ti) break;
        this._voixMontrees.add(i);
        this.compteurs.voix++;
        const k = R.ecransOrdre[i % R.ecransOrdre.length] % E.length;
        this._ecrans = this._ecrans.filter((x) => x.k !== k);
        this._ecrans.push({ k, texte: couper(lignes[i], V.largeur), debut: t, n: -1, dernier: -9, i });
      }
      for (const x of this._ecrans) {
        const total = x.texte.reduce((s, l) => s + l.length, 0);
        const n = Math.min(total, Math.floor((t - x.debut) * V.vitesse));
        if (n === x.n || (t - x.dernier < 0.06 && n < total)) continue;
        x.n = n; x.dernier = t;
        let reste = n;
        const vis = x.texte.map((l) => { const s = l.slice(0, Math.max(0, reste)); reste -= l.length; return s; });
        E[x.k].materiau?.color.setScalar(1);
        E[x.k].ecrire(vis, { couleur: V.couleur, taille: V.taille });
      }
    }
    // la ligne du lâcher, sur tous les écrans, puis elle s'efface
    const r = this._relache;
    if (r && this.etat !== 'tenue') {
      const age = t - r.t0;
      if (!r.ecrit) {
        r.ecrit = true;
        const L = couper(r.texte, V.largeur);
        for (const e of E) { e.materiau?.color.setScalar(1); e.ecrire(L, { couleur: R.relache.couleur, taille: R.relache.taille, alignement: 'center' }); }
      }
      if (age > R.relache.duree) {
        const f = 1 - clamp((age - R.relache.duree) / 1.5, 0, 1);
        for (const e of E) e.materiau?.color.setScalar(f);
        if (f <= 0) { this.effacerEcrans(); this._relache = null; }
      }
    } else if (r && this.etat === 'tenue') {
      this._relache = null;
    }
  },

  // -------------------------------------------------------------------------------------- la salle
  majSalle(dt, t, jeu) {
    const S = this._salle;
    if (!S || jeu.zones.nom !== 'kura') return;
    // le levier descend avec la progression ; il remonte quand on lâche
    const cible = this.etat === 'tenue' ? this.progression : this.etat === 'fait' || this.etat === 'aube' ? 1 : 0;
    this._levier = cible > this._levier ? cible : Math.max(cible, this._levier - 0.7 * dt);
    const lev = jeu.kura.levier;
    if (lev) lev.rotation.x = lerp(R.levier.haut, R.levier.bas, lisse(this._levier));
    // lumières de la salle (après la mise à jour de la zone, qui les recalcule à chaque image)
    let f = 1;
    if (this.etat === 'fait') f = lerp(1, R.fait.residuel, lisse((this._tf - R.fait.lumieres[0]) / (R.fait.lumieres[1] - R.fait.lumieres[0])));
    if (f < 1) {
      if (S.hemi) S.hemi.intensity *= f;
      if (S.dir) S.dir.intensity *= f;
      for (const x of S.mats) x.m.color.copy(x.base).multiplyScalar(f);
      for (const x of S.forces) x.u.value = x.base * f;
      S.eteinte = true;
    } else if (S.eteinte) this.rallumerSalle();
    // les gouttes sur la baie, plus visibles à mesure que la ville s'éteint
    if (S.vitre) {
      const k = (1 - this.moyenne()) * R.pluieVitre;
      S.vitre.material.uniforms.uI.value = k;
      S.vitre.material.uniforms.uT.value = t;
      // toujours dessinée dans la salle (un plan additif, nul au repos) : son shader est compilé dès l'entrée
      S.vitre.visible = jeu.kura.salle === 'interrupteur';
    }
  },

  rallumerSalle() {
    const S = this._salle;
    if (!S) return;
    for (const x of S.mats) x.m.color.copy(x.base);
    for (const x of S.forces) x.u.value = x.base;
    S.eteinte = false;
  },

  // -------------------------------------------------------------------------------------- c'est fait
  faire() {
    const jeu = this.jeu;
    this.etat = 'fait';
    this.tenue = R.duree;
    this._tf = 0;
    this._fondu = false;
    jeu.suspendre('silence');
    jeu.etat.silence = { ...this.etatPartie(), etape: 'aube' };
    jeu.sauver?.();
    jeu.audio?.souffle?.({ de: 160, vers: 40, duree: 1.6, volume: 0.09, q: 0.8 });
    jeu.audio?.tonalite?.({ de: 55, vers: 38, duree: 2.6, volume: 0.05 });
    jeu.emettre('silence:fait');
  },

  majFait(dt, jeu) {
    if (!jeu.accueil?.visible || jeu.sansSouris) this._tf += dt;
    const F = R.fait;
    // les écrans s'éteignent un à un (du plus récent au plus ancien)
    const E = this.ecransSalle;
    const ordre = [...R.ecransOrdre].reverse();
    ordre.forEach((k, i) => {
      const e = E[k % (E.length || 1)];
      if (!e) return;
      const t0 = F.ecrans[0] + ((F.ecrans[1] - F.ecrans[0]) * i) / ordre.length;
      const v = 1 - clamp((this._tf - t0) / 0.7, 0, 1);
      e.materiau?.color.setScalar(v);
    });
    if (!this._fondu && this._tf >= F.silence) {
      this._fondu = true;
      jeu.hud.fondu(true, F.fondu);
    }
    if (this._tf >= F.silence + F.fondu + F.noir) this.lancerAube();
  },

  // -------------------------------------------------------------------------------------- l'aube
  lancerAube({ reprise = false } = {}) {
    const jeu = this.jeu;
    this.etat = 'aube';
    this._pilote = true;
    this.tenue = R.duree;
    this._ta = reprise ? R.aube.duree * 0.3 : 0;
    this._hors = 0;
    this._marcheT = 0;
    this._murmures = { n: 0, dernier: -99, dits: new Set() };
    for (const cat of CATEGORIES) this._niv[cat].fill(0);
    this._nappe = [0, 0, 0, 0];
    this._timbre = 1;
    this.muette = true;
    jeu.hud.viderMima({ courant: true });
    jeu.masquerMima('silence', true);
    jeu.etat.silence = { ...this.etatPartie(), etape: 'aube' };
    if (jeu.zones.nom !== 'kasumi' || !reprise) jeu.zones.installer('kasumi', R.aube.point);
    if (this._salle) {
      this.effacerEcrans();
      this.rallumerSalle();
    }
    this.creerBraise();
    this.appliquerVilleEteinte(true);
    npc.peuplerMarche?.(R.aube.habitantsMarche); // au marché, des gens (arrêtés) ; placés pendant le noir
    this.majAube(0, jeu);
    jeu.audio?.nappeNotes?.([0, 0, 0, 0], 0.1);
    this._nappeEnvoye = [0, 0, 0, 0];
    jeu.hud.fondu(false, reprise ? 1.2 : R.fait.ouverture);
    jeu.reprendre('silence');
    jeu.sauver?.();
    jeu.emettre('silence:aube', { reprise });
  },

  /** Masques et figements de l'aube (appliqués à chaque image, rendus par `restaurer`). */
  appliquerVilleEteinte(oui) {
    const jeu = this.jeu;
    const V = this._ville;
    // aucun titre de lieu ne s'affiche à l'aube (le marché en affiche un quand on y entre)
    if (oui && !this._titre) { this._titre = jeu.hud.titre; jeu.hud.titre = () => {}; }
    else if (!oui && this._titre) { jeu.hud.titre = this._titre; this._titre = null; }
    npc.reaction.aube = oui ? 1 : 0;
    if (jeu.robots) jeu.robots.fige = oui;
    jeu.interact.filtre = oui ? () => false : null;
    if (V.braise) V.braise.visible = oui;
    const masquer = (o) => { if (!V.masques.has(o)) V.masques.set(o, o.visible); o.visible = false; };
    if (oui) {
      for (const o of V.surMesure) masquer(o);
      for (const p of jeu.veilleur?.patrouilles || []) if (p.v?.groupe) masquer(p.v.groupe);
    } else {
      for (const [o, vis] of V.masques) o.visible = vis;
      V.masques.clear();
    }
    if (oui) for (const x of V.lumieres) appliquerMult(x.m, 0);
    else for (const x of V.lumieres) rendreMult(x.m);
  },

  /** Avancée de l'aube a (0..1) : ciel, brouillard, lumière, image, pluie. */
  majAube(dt, jeu) {
    const V = this._ville;
    const P = R.palette;
    if (!jeu.accueil?.visible || jeu.sansSouris) this._ta += dt;
    const a = lisse(this._ta / R.aube.duree);
    this.aube = a;
    // trois étapes : nuit → violet → gris
    const ev = P.etapeViolet;
    const [A, B, k] = a < ev ? [P.nuit, P.violet, lisse(a / ev)] : [P.violet, P.gris, lisse((a - ev) / (1 - ev))];
    const mixC = (cle, cible) => cible.copy(couleur(A[cle])).lerp(couleur(B[cle]), k);
    const mix3 = (t3) => (a < ev ? lerp(t3[0], t3[1], k) : lerp(t3[1], t3[2], k));
    const C = this._c || (this._c = { z: new THREE.Color(), h: new THREE.Color(), e: new THREE.Color(), f: new THREE.Color(), hc: new THREE.Color(), hs: new THREE.Color(), s: new THREE.Color(), m: new THREE.Color() });
    mixC('zenith', AUBE.zenith.value);
    mixC('horizon', AUBE.horizon.value);
    mixC('est', AUBE.est.value);
    AUBE.aube.value = lisse(a / 0.22);
    AUBE.nuages.value = P.nuages * lisse(a / 0.4);
    AUBE.temps.value = jeu.t;
    mixC('brouillard', C.f);
    if (jeu.zones.nom !== 'kasumi') return a;
    const scene = V.scene;
    if (scene.fog) { scene.fog.color.copy(C.f); scene.fog.density = mix3(P.densite); }
    if (scene.background?.isColor) scene.background.copy(C.f);
    if (hashira.mat?.uniforms?.uFog) hashira.mat.uniforms.uFog.value.copy(C.f);
    if (V.hemi) {
      mixC('hemiCiel', V.hemi.color);
      mixC('hemiSol', V.hemi.groundColor);
      V.hemi.intensity = lerp(A.hemi, B.hemi, k);
    }
    if (V.lune) {
      mixC('soleil', V.lune.color);
      V.lune.intensity = lerp(A.soleilI, B.soleilI, k);
      V.lune.position.copy(V.luneBase.p).lerp(this._soleil || (this._soleil = new THREE.Vector3(...P.soleilPosition)), lisse(a / 0.5));
    }
    const mu = V.city.mirror?.material?.uniforms?.color?.value;
    if (mu) mixC('miroir', mu);
    jeu.renderer.toneMappingExposure = mix3(P.exposition);
    if (jeu.bloom) {
      jeu.bloom.strength = mix3(P.bloom.force);
      jeu.bloom.radius = mix3(P.bloom.rayon);
      jeu.bloom.threshold = mix3(P.bloom.seuil);
    }
    if (jeu.film?.uniforms?.aube) jeu.film.uniforms.aube.value = P.film * a;
    EXTINCTION.reflet.value.copy(AUBE.horizon.value).multiplyScalar(P.reflet * a); // les vitres mortes renvoient le ciel
    if (jeu.rain && 'densite' in jeu.rain) jeu.rain.densite = lerp(1, P.pluieImage, a);
    // le son : la pluie seule, puis presque rien
    const S = R.aube.pluie;
    const pluie = this._ta < S.finDepuis ? lerp(S.debut, S.aube, a) : lerp(S.aube, S.fin, lisse((this._ta - S.finDepuis) / S.finSur));
    if (!this._pluieEnvoyee || Math.abs(pluie - this._pluieEnvoyee) > 0.0015) {
      jeu.audio?.regler({ pluie, duree: 1.5 });
      this._pluieEnvoyee = pluie;
    }
    // les Veilleurs en patrouille, les lumières : rien ne revient pendant l'aube
    this.appliquerVilleEteinte(true);
    if (V.braise) {
      const b = V.braise;
      const pouls = 0.75 + 0.25 * Math.sin(jeu.t * 2.3) * Math.sin(jeu.t * 0.7 + 1.3);
      b.material.color.setRGB(1.0 * pouls, 0.42 * pouls, 0.16 * pouls);
    }
    return a;
  },

  /** Quelques murmures d'habitants arrêtés, près du joueur. */
  majMurmures(jeu) {
    const M = R.aube.murmures;
    const m = this._murmures;
    if (this._ta < M.debut || m.n >= M.max || this._ta - m.dernier < M.intervalle || typeof npc.dire !== 'function') return;
    const p = jeu.player.position;
    const dir = jeu.camera.getWorldDirection(this._d || (this._d = new THREE.Vector3()));
    let meilleur = null;
    for (const n of npc.habitants) {
      if (!(n.vis > 0.8)) continue;
      const vx = n.x - p.x, vz = n.z - p.z, d = Math.hypot(vx, vz);
      if (d < M.rayonMin || d > M.rayonMax) continue;
      if ((vx * dir.x + vz * dir.z) / d < 0.3) continue;
      if (!meilleur || d < meilleur.d) meilleur = { n, d };
    }
    if (!meilleur) return;
    const L = T.murmures.filter((x) => !m.dits.has(x));
    if (!L.length) return;
    const texte = L[Math.floor(Math.random() * L.length)];
    if (npc.dire(meilleur.n, texte)) { m.dits.add(texte); m.n++; m.dernier = this._ta; }
  },

  /** L'arrivée au marché, le délai, ou la sortie de la ville : l'écran de fin. */
  verifierFin(dt, jeu) {
    const A = R.aube;
    if (jeu.zones.enTransition) return;
    if (jeu.zones.nom !== 'kasumi') {
      this._hors += dt;
      if (this._hors >= A.horsVille) this.terminerAube();
      return;
    }
    this._hors = 0;
    const p = jeu.player.position;
    const M = A.marche;
    const auMarche = p.x >= M.minX && p.x <= M.maxX && p.z >= M.minZ && p.z <= M.maxZ && p.y < 2.5;
    if (auMarche && this.aube >= A.minAube) this._marcheT += dt;
    if (this._marcheT >= A.attenteMarche || this._ta >= A.delaiMax) this.terminerAube();
  },

  terminerAube() {
    const jeu = this.jeu;
    if (this.etat !== 'aube' || !jeu.fins || jeu.fins.enCours) return;
    this.etat = 'fin';
    jeu.fins.terminer('fin5', { paragraphes: tab(textes().epilogue.texte).map(String) });
  },

  // -------------------------------------------------------------------------------------- tout rendre
  /** Rend la ville de nuit, Mima, le son, la salle ; aucune trace de la séquence. */
  restaurer() {
    const jeu = this.jeu;
    const V = this._ville;
    const enAube = this.etat === 'aube' || this.etat === 'fin' || this.etat === 'fait';
    this.etat = 'repos';
    this.tenue = 0;
    this._pilote = false;
    this.aube = 0;
    this._ta = 0;
    this._relache = null;
    this._pluieEnvoyee = 0;
    for (const cat of CATEGORIES) this._niv[cat].fill(1);
    rallumerTout();
    if (jeu.zones.construites.includes('kura')) jeu.kura.panorama.tout(1);
    this._nappe = [1, 1, 1, 1];
    this._nappeEnvoye = [1, 1, 1, 1];
    this._timbre = 0;
    this._timbreEnvoye = 0;
    this._levier = 0;
    jeu.audio?.nappeNotes?.([1, 1, 1, 1], 1.5);
    jeu.audio?.ronflementTimbre?.(0, 0.5);
    // l'aube
    AUBE.aube.value = 0;
    AUBE.nuages.value = 0;
    if (jeu.film?.uniforms?.aube) jeu.film.uniforms.aube.value = 0;
    if (jeu.rain && 'densite' in jeu.rain) jeu.rain.densite = 1;
    this.appliquerVilleEteinte(false);
    if (V.hemi && V.hemiBase) { V.hemi.color.copy(V.hemiBase.ciel); V.hemi.groundColor.copy(V.hemiBase.sol); V.hemi.intensity = V.hemiBase.i; }
    if (V.lune && V.luneBase) { V.lune.color.copy(V.luneBase.c); V.lune.intensity = V.luneBase.i; V.lune.position.copy(V.luneBase.p); }
    const mu = V.city.mirror?.material?.uniforms?.color?.value;
    if (mu && V.miroirBase) mu.copy(V.miroirBase);
    const amb = V.zone.ambiance;
    if (V.scene.fog && amb?.brouillard) { V.scene.fog.color.set(amb.brouillard.couleur); V.scene.fog.density = amb.brouillard.densite; }
    if (V.scene.background?.isColor) V.scene.background.set(amb?.fond ?? amb?.brouillard?.couleur ?? 0x1a0c44);
    if (hashira.mat?.uniforms?.uFog) hashira.mat.uniforms.uFog.value.set(0x1a0c44);
    const courante = jeu.zones.courante;
    if (enAube && courante) {
      const a = courante.ambiance;
      jeu.renderer.toneMappingExposure = a.exposition;
      if (jeu.bloom) { jeu.bloom.strength = a.bloom.force; jeu.bloom.radius = a.bloom.rayon; jeu.bloom.threshold = a.bloom.seuil; }
      jeu.audio?.regler(a.son);
    }
    // la salle
    if (this._salle) {
      this.rallumerSalle();
      this.effacerEcrans();
      if (this._salle.vitre) { this._salle.vitre.visible = false; this._salle.vitre.material.uniforms.uI.value = 0; }
      const lev = jeu.kura?.levier;
      if (lev) lev.rotation.x = R.levier.haut;
    }
    this._sonSalle = { pluie: 0, filtre: 0, envoyeT: -9, actif: false };
    // Mima
    if (this.muette) this.retablirMima();
    jeu.reprendre('silence');
    const ep = this.etatPartie();
    ep.etape = null;
    jeu.sauver?.();
  },

  surNouvellePartie() {
    this._aReprendre = false;
    this.muette = true; // pour que restaurer() rende la bande de Mima
    this.restaurer();
    this.compteurs = { contacts: 0, relaches: 0, voix: 0 };
    this.etatPartie();
  },

  // -------------------------------------------------------------------------------------- l'API publique
  /** Éteint la vraie ville (Kasumi) : voir l'en-tête. Sans effet pendant la séquence. */
  eteindreVille(niveaux = 0) {
    if (this.etat !== 'repos' && this.etat !== 'arme') return false;
    const N = typeof niveaux === 'number' ? Object.fromEntries(CATEGORIES.map((c) => [c, niveaux])) : niveaux || {};
    let tousAUn = true;
    for (const c of CATEGORIES) {
      const v = N[c];
      if (v === undefined) continue;
      for (let q = 0; q < NB_QUARTIERS; q++) {
        const x = clamp(Array.isArray(v) || ArrayBuffer.isView(v) ? +v[q] : +v, 0, 1);
        EXTINCTION[c].value[q] = Number.isFinite(x) ? x : 1;
      }
    }
    for (const c of CATEGORIES) for (let q = 0; q < NB_QUARTIERS; q++) if (EXTINCTION[c].value[q] < 1) tousAUn = false;
    EXTINCTION.actif.value = tousAUn ? 0 : 1;
    return true;
  },
  rallumerVille() { if (this.etat === 'repos' || this.etat === 'arme') rallumerTout(); },
  niveauxVille() {
    return Object.fromEntries([['actif', EXTINCTION.actif.value], ...CATEGORIES.map((c) => [c, [...EXTINCTION[c].value]])]);
  },
  niveau,

  // -------------------------------------------------------------------------------------- boucle
  update(dt, t, jeu) {
    dt = Math.min(dt, 0.1);
    // reprise d'une aube sauvegardée (rechargement après la fin de la tenue)
    if (this._aReprendre && jeu.enPartie && jeu.zones.courante && !jeu.zones.enTransition) {
      this._aReprendre = false;
      if (jeu.etat.silence?.etape === 'aube' && !jeu.fins?.enCours) this.lancerAube({ reprise: true });
    }
    // la phrase de Mima dite, elle se tait
    if (this._phraseT > 0 && jeu.t >= this._phraseT) {
      this._phraseT = -1;
      if (this.muette) { jeu.hud.viderMima(); jeu.masquerMima('silence', true); }
    }

    const salle = jeu.zones.nom === 'kura' ? jeu.kura?.salle : null;
    if (this.etat === 'arme' || this.etat === 'tenue') {
      const p = jeu.player.position;
      const [lx, , lz] = R.levier.position;
      if (salle !== 'interrupteur' || Math.hypot(p.x - lx, p.z - lz) > R.rayonDesarmer) this.desarmer();
    } else if (this.muette && this.etat === 'repos' && salle !== 'interrupteur') {
      this.retablirMima();
    }

    if (this.etat === 'tenue') {
      const p = jeu.player.position;
      const garde = jeu.jouable && jeu.input.isDown('KeyE') && this._contactPos && Math.hypot(p.x - this._contactPos.x, p.z - this._contactPos.z) <= R.ecartMax;
      if (!garde) this.relacher();
      else {
        this.tenue += dt;
        if (this.tenue >= R.duree) this.faire();
      }
    }
    if (this.etat === 'fait') this.majFait(dt, jeu);

    if (this._pilote) this.majNiveaux(dt, t);
    if (this._pilote || this._timbre > 0 || this._nappe.some((v) => v < 1) || this._sonSalle.actif) this.majSon(dt, jeu);
    if (salle === 'interrupteur' || this._relache) this.majVoix(t);
    this.majSalle(dt, t, jeu);

    if (this.etat === 'aube') {
      this.majAube(dt, jeu);
      if (jeu.jouable) this.majMurmures(jeu);
      this.verifierFin(dt, jeu);
    }
  },
};
