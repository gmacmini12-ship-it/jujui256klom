// Système « conseils » (tâche 1.7) : Mima propose, le joueur suit ou ignore.
//
// - au plus un conseil toutes les 45 s de jeu, chacun une seule fois par partie
//   (identifiants dans `etat.conseilsDits`, créé ici s'il manque) ;
// - rien tant que le joueur n'a pas la main (ouverture, dialogue, frise, pause) ni pendant
//   qu'il fume (bible §2.7 : Mima se tait) ;
// - si le conseil a un `suivi` mesurable, on observe 30 s de jeu ; s'il n'est pas suivi,
//   `etat.refus` augmente. Aucune réaction visible pour l'instant.
import { CONSEILS } from '../data/conseils.js';

const INTERVALLE = 45; // s entre deux conseils
const OBSERVATION = 30; // s d'observation d'un conseil mesurable
const REPRISE = 1.5; // s de calme après avoir retrouvé la main
const SEUIL_COURSE = 8; // vitesse au-delà de laquelle on court (marche : 5, course : 11)

const SEUILS = {
  course: 15, // s de course continue
  pluie: 90, // s dehors sous la pluie
  immobile: 60, // s sans bouger, dehors
  repos: 45, // s sans bouger, à la clinique
  rien: 240, // s de jeu sans rien avoir ramassé
  sauts: 6, // sauts…
  fenetreSauts: 20, // …en autant de secondes
  bord: 10, // m du bord de la ville
  hauteur: 60, // m
  evenement: 75, // s pendant lesquelles un évènement (sortie, retour, frise…) reste « récent »
};

// État local (non sauvé) : mesures et évènements récents.
let m;
function remettre() {
  m = {
    derniere: -Infinity, // jeu.t du dernier conseil dit
    bloqueDepuis: 0, // jeu.t du dernier instant où le joueur n'avait pas la main
    tCourse: 0, tImmobile: 0, tPluie: 0, tJeu: 0, tBord: 0,
    auSol: true, sauts: [], idleDepuis: 0,
    recents: {}, // nom → jeu.t de l'évènement
    obs: null,
  };
}
remettre();

function dits(jeu) {
  if (!Array.isArray(jeu.etat.conseilsDits)) jeu.etat.conseilsDits = [];
  return jeu.etat.conseilsDits;
}

const vitesse = (jeu) => Math.hypot(jeu.player.velocity.x, jeu.player.velocity.z);

function limites(jeu) {
  const b = jeu.zones?.courante?.bornes;
  if (typeof b === 'number') return { minX: -b, maxX: b, minZ: -b, maxZ: b };
  return b || null;
}
function distanceBord(jeu) {
  const l = limites(jeu);
  // seulement dans une zone assez vaste pour avoir un « bord de la ville »
  if (!l || Math.min(l.maxX - l.minX, l.maxZ - l.minZ) < 40) return Infinity;
  const p = jeu.player.position;
  return Math.min(p.x - l.minX, l.maxX - p.x, p.z - l.minZ, l.maxZ - p.z);
}
function distancePorte(jeu) {
  const pt = jeu.zones.get('kasumi')?.points?.clinique?.position;
  if (!pt || jeu.zones.nom !== 'kasumi') return Infinity;
  return Math.hypot(jeu.player.position.x - pt[0], jeu.player.position.z - pt[2]);
}
const recent = (nom, jeu) => nom in m.recents && jeu.t - m.recents[nom] <= SEUILS.evenement;

// Détecteurs : contexte → vrai si le contexte est présent maintenant.
const DETECTEURS = {
  hauteur: (jeu) => jeu.player.position.y >= SEUILS.hauteur,
  sortie: (jeu) => recent('sortie', jeu),
  clinique: (jeu) => recent('retour', jeu) && jeu.zones.nom === 'clinique',
  cigarette: (jeu) => recent('cigarette', jeu) && m.idle && jeu.t - m.idleDepuis >= 3,
  frise: (jeu) => recent('frise', jeu),
  bord: (jeu) => m.tBord >= 2,
  saut: (jeu) => m.sauts.length >= SEUILS.sauts,
  course: () => m.tCourse >= SEUILS.course,
  pluie: () => m.tPluie >= SEUILS.pluie,
  immobile: (jeu) => jeu.zones.nom !== 'clinique' && m.tImmobile >= SEUILS.immobile,
  repos: (jeu) => jeu.zones.nom === 'clinique' && m.tImmobile >= SEUILS.repos,
  rien: (jeu) => m.tJeu >= SEUILS.rien && (jeu.etat.fragments || []).length === 0,
};
const ORDRE = ['hauteur', 'sortie', 'clinique', 'cigarette', 'frise', 'bord', 'saut', 'course', 'pluie', 'immobile', 'repos', 'rien'];

// Mesures du « suivi » : init(jeu) prépare, tick(dt, jeu) renvoie true (suivi, on s'arrête),
// false (pas suivi), undefined (on continue) ; fin(jeu) tranche à la fin des 30 s.
const SUIVIS = {
  abri: {
    init: (jeu, o) => { o.d0 = distancePorte(jeu); },
    tick: (dt, jeu, o) => (jeu.zones.nom === 'clinique' || (o.d0 < Infinity && o.d0 - distancePorte(jeu) >= 10) ? true : undefined),
    fin: () => false,
  },
  arret: {
    init: (jeu, o) => { o.calme = 0; },
    tick: (dt, jeu, o) => { o.calme = vitesse(jeu) < 6 ? o.calme + dt : 0; return o.calme >= 3 ? true : undefined; },
    fin: () => false,
  },
  allure: {
    init: (jeu, o) => { o.cours = 0; },
    tick: (dt, jeu, o) => { o.cours = vitesse(jeu) > SEUIL_COURSE ? o.cours + dt : 0; return o.cours >= 1 ? false : undefined; },
    fin: () => true,
  },
  mouvement: {
    init: (jeu, o) => { o.x = jeu.player.position.x; o.z = jeu.player.position.z; },
    tick: (dt, jeu, o) => (Math.hypot(jeu.player.position.x - o.x, jeu.player.position.z - o.z) >= 5 ? true : undefined),
    fin: () => false,
  },
  calme: {
    init: (jeu, o) => { o.n = m.sauts.length; o.depart = jeu.t; },
    tick: (dt, jeu, o) => (m.dernierSaut > o.depart ? false : undefined),
    fin: () => true,
  },
  recul: {
    init: (jeu, o) => { o.d0 = distanceBord(jeu); },
    tick: (dt, jeu, o) => (distanceBord(jeu) >= Math.max(o.d0 + 8, SEUILS.bord + 5) ? true : undefined),
    fin: () => false,
  },
};
SUIVIS.retour = SUIVIS.abri;

function dire(jeu, c) {
  dits(jeu).push(c.id);
  m.derniere = jeu.t;
  jeu.hud.mima(c.texte, { duree: 8 });
  jeu.sauver?.();
  if (c.suivi && SUIVIS[c.suivi]) {
    const o = { suivi: c.suivi, reste: OBSERVATION };
    SUIVIS[c.suivi].init(jeu, o);
    m.obs = o;
  }
}

function observer(dt, jeu) {
  const o = m.obs;
  if (!o) return;
  const s = SUIVIS[o.suivi];
  o.reste -= dt;
  let verdict = s.tick(dt, jeu, o);
  if (verdict === undefined && o.reste <= 0) verdict = s.fin(jeu, o);
  if (verdict === undefined) return;
  if (verdict === false) {
    jeu.etat.refus = (jeu.etat.refus || 0) + 1;
    jeu.sauver?.();
  }
  m.obs = null;
}

function mesurer(dt, t, jeu) {
  const v = vitesse(jeu);
  const zone = jeu.zones.courante;
  const auSol = jeu.player.auSol;
  if (m.auSol && !auSol) {
    m.sauts.push(t);
    m.dernierSaut = t;
  }
  m.auSol = auSol;
  m.sauts = m.sauts.filter((s) => t - s <= SEUILS.fenetreSauts);

  m.tJeu += dt;
  m.tCourse = v > SEUIL_COURSE ? m.tCourse + dt : v < 6 ? 0 : m.tCourse;
  m.tImmobile = v < 0.3 && auSol ? m.tImmobile + dt : v > 0.5 ? 0 : m.tImmobile;
  m.tPluie = zone?.ambiance?.pluie ? m.tPluie + dt : 0;
  m.tBord = distanceBord(jeu) < SEUILS.bord ? m.tBord + dt : 0;
}

export const conseils = {
  nom: 'conseils',

  init(jeu) {
    dits(jeu);
    jeu.on('partie:nouvelle', () => { remettre(); });
    jeu.on('zone:entree', ({ nom, depuis }) => {
      m.tPluie = 0; m.tImmobile = 0; m.tBord = 0;
      if (nom === 'kasumi' && depuis === 'clinique' && !dits(jeu).includes('c5')) m.recents.sortie = jeu.t;
      if (nom === 'clinique' && depuis) m.recents.retour = jeu.t;
    });
    jeu.on('cigarette:allumage', () => { m.recents.cigarette = jeu.t; });
    jeu.on('frise:ouverte', () => { m.recents.frise = jeu.t; });
  },

  update(dt, t, jeu) {
    if (!jeu.player || !jeu.zones?.courante) return;
    const idle = !jeu.smoking || jeu.smoking.etat === 'idle';
    if (idle && !m.idle) m.idleDepuis = t;
    m.idle = idle;

    // Sourdine : Mima se tait, rien n'est mesuré ni observé (le délai de reprise s'applique à la fin)
    if (!jeu.jouable || jeu.sourdine?.actif || jeu.silence?.muette) { m.bloqueDepuis = t; return; } // fin 5 : Mima s'est tue
    mesurer(dt, t, jeu);
    observer(dt, jeu);

    if (!idle || t - m.bloqueDepuis < REPRISE || t - m.derniere < INTERVALLE || m.obs) return;
    const deja = dits(jeu);
    for (const contexte of ORDRE) {
      if (!DETECTEURS[contexte](jeu)) continue;
      const c = CONSEILS.find((x) => x.contexte === contexte && !deja.includes(x.id));
      if (c) return dire(jeu, c);
    }
  },
};
