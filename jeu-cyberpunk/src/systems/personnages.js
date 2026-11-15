import * as THREE from 'three';
import { jeu } from '../game.js';
import { ajouterFragment } from '../state.js';
import { FRAGMENTS } from '../data/fragments.js';
import { TEXTES_FRAGMENTS, POSITIONS_PAR_DIALOGUE } from '../data/fragments-positions.js';
import { PAQUET } from '../data/paquet.js';
import { DIALOGUES_ETAPE2, choisirDialogue } from '../data/dialogues-etape2.js';
import { PERSONNAGES as TEXTES, APPARENCES, MIMA_DON_PAQUET, POSE_BOND, KARAOKE } from '../data/personnages.js';
import { npc } from './npc.js';
import { marche } from './marche.js';

// Système « personnages » (étape 2, intégration) : Oba, Kaede, le Kiosque à la veste bleue et Itsuki.
//
// Ce système ne contient aucun texte (data/personnages.js, data/dialogues-etape2.js) : il place les
// personnages (silhouettes de npc.js, ou le décor du marché pour le Kiosque), choisit le dialogue à
// chaque interaction (`choisirDialogue`), et relie les dialogues au reste du jeu, à la FIN de chacun :
//   - etat.rencontres[perso] +1 (jamais avant : la sélection du dialogue lit le compte d'avant) ;
//   - Bond : si Kaede vient de l'accorder, la pose (fondu, un temps, retour) puis `bond.accorder()` ;
//   - fragment 10 (souvenir parlé d'Oba) : `ajouterFragment(10)` quand son drapeau est posé ;
//   - mensonges et doutes semés : comparés avant/après, compteurs T8 / T9 de etat.transgressions +1 par
//     élément nouveau, évènement `transgression { id, source }` (la réaction du système viendra plus tard) ;
//   - cigarettes : compteur du paquet affiché si le dialogue a allumé une cigarette, ligne de Mima au don.
//
// API (aussi sur jeu.personnages) : `lancer(id)` (comme une interaction), `positions` (où ils se tiennent),
// `dernier` (résumé du dernier dialogue : id, transgressions, bond, fragment).

const ZONE = 'kasumi';
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const copie = (v) => JSON.parse(JSON.stringify(v));

// Où se tient Itsuki : devant le karaoké (bible §5.2 : « un karaoké où chante Itsuki »), c'est-à-dire sur le
// trottoir est du lot sud-est du pâté de la clinique, (60-79) × (60-79), dont le toit porte les enseignes
// et le fragment 27 (systems/toits.js). Il regarde la rue (+x). Le décor d'une salle ouverte sur la rue
// (enseigne, écran de paroles, tapis, deux tubes de lumière) est posé sur la façade est, x = 79.
const ITSUKI = { x: 80.5, y: 0.3, z: 70.0, yawCorps: Math.PI / 2 };
const X_FACADE_KARAOKE = 79.04;

const contextes = new Map(); // personnage -> { id, dialogue, avant }

// ---------------------------------------------------------------- avant / après un dialogue
function preparer(perso) {
  const e = jeu.etat;
  const id = choisirDialogue(perso, e);
  const avant = {
    mensonges: [...e.mensonges],
    doutes: [...e.doutesSemes],
    bond: e.pouvoirs.includes('bond'),
    cigarettes: copie(e.cigarettes),
  };
  const ctx = { id, dialogue: DIALOGUES_ETAPE2[id], avant };
  contextes.set(perso, ctx);
  return ctx;
}

function transgression(id, source, detail) {
  const t = jeu.etat.transgressions;
  t[id] = (t[id] || 0) + 1;
  jeu.emettre('transgression', { id, source, detail });
}

// Fragment 10 : le souvenir parlé d'Oba entre dans la frise sans ramassage (le dialogue pose le drapeau).
function fragmentsParlesDus() {
  const e = jeu.etat;
  const dus = [];
  if (e.drapeaux.includes('oba_dividende')) dus.push(10);
  return dus.filter((id) => !e.fragments.includes(id));
}
function accorderFragmentsParles() {
  const accordes = [];
  for (const id of fragmentsParlesDus()) {
    const f = FRAGMENTS.find((x) => x.id === id);
    if (!f || !ajouterFragment(id)) continue;
    const touche = (() => { try { return jeu.input.label('KeyJ'); } catch (err) { return 'J'; } })();
    jeu.hud.notifier(TEXTES_FRAGMENTS.notification(f, touche), { duree: 5 });
    try {
      jeu.audio?.bip({ frequence: 698, duree: 0.45, volume: 0.06 });
      setTimeout(() => { try { jeu.audio?.bip({ frequence: 1047, duree: 0.7, volume: 0.05 }); } catch (err) { /* silence */ } }, 130);
    } catch (err) { /* le son est facultatif */ }
    accordes.push(id);
  }
  return accordes;
}

// La pose du Bond (bible §4.2) : le joueur s'assoit, fondu au noir, un temps, retour devant le fauteuil.
async function poseDuBond() {
  jeu.suspendre('pose');
  try {
    await jeu.hud.fondu(true, POSE_BOND.fondu);
    const a = marche.approches.fauteuil;
    jeu.player.teleporter(a.x, 0, a.z, 0, -0.05);
    jeu.audio?.tonalite?.({ de: 60, vers: 170, duree: 1.5, volume: 0.05 });
    jeu.audio?.souffle?.({ de: 300, vers: 90, duree: 1.2, volume: 0.05 });
    await dormir(POSE_BOND.temps);
    await jeu.hud.fondu(false, POSE_BOND.fondu);
  } finally {
    jeu.reprendre('pose');
  }
}

async function conclure(perso) {
  const e = jeu.etat;
  const ctx = contextes.get(perso);
  contextes.delete(perso);
  if (!ctx) return;
  const resume = { perso, dialogue: ctx.id, transgressions: [], bond: false, fragments: [], paquet: null };

  // mensonges (T8) et doutes semés (T9) apparus pendant ce dialogue
  for (const m of e.mensonges) if (!ctx.avant.mensonges.includes(m)) { transgression('T8', perso, m); resume.transgressions.push('T8'); }
  for (const d of e.doutesSemes) if (!ctx.avant.doutes.includes(d)) { transgression('T9', perso, d); resume.transgressions.push('T9'); }

  // fragments dits à voix haute
  resume.fragments = accorderFragmentsParles();

  // cigarettes : le compteur affiché à l'allumage, la ligne de Mima au don du paquet
  const c = e.cigarettes, av = ctx.avant.cigarettes;
  if (c.fumees > av.fumees && c.paquet < av.paquet && c.paquet > 0) {
    jeu.hud.notifier(PAQUET.restant.replace('{n}', String(c.paquet)), { duree: 3 });
  }
  if (c.donne && !av.donne) {
    resume.paquet = c.donne;
    jeu.hud.mima(MIMA_DON_PAQUET, { duree: 9 });
  }

  // Bond accordé par Kaede : le dialogue a posé 'bond' dans etat.pouvoirs ; on le retire pour que
  // bond.accorder() l'ajoute une seule fois (et notifie, sauve, émet pouvoir:accorde).
  if (!ctx.avant.bond && e.pouvoirs.includes('bond') && jeu.bond) {
    e.pouvoirs.splice(e.pouvoirs.indexOf('bond'), 1);
    await poseDuBond();
    jeu.bond.accorder();
    resume.bond = true;
  }

  jeu.sauver?.();
  personnages.dernier = resume;
  jeu.emettre('personnage:dialogue', resume);
}

// ---------------------------------------------------------------- le Kiosque (décor du marché)
function monterKiosque() {
  const v = marche.ancres.kiosqueVisage;
  const t = TEXTES.kiosque;
  jeu.interact.ajouter({
    zone: ZONE,
    position: [v.x, v.y, v.z],
    rayon: 3.6,
    cone: 0.9,
    libelle: t.libelle,
    lignes: t.lignes,
    decalageEtiquette: 0.9,
    action: () => lancer('kiosque'),
  });
}

async function lancer(perso) {
  const p = npc.personnages.get(perso);
  if (p) return p.objet.action();
  const ctx = preparer(perso);
  await jeu.ouvrirDialogue(ctx.dialogue); // fige le joueur et libère la souris tant qu'il est ouvert
  jeu.etat.rencontres[perso] = (jeu.etat.rencontres[perso] || 0) + 1;
  jeu.sauver?.();
  await conclure(perso);
}

// ---------------------------------------------------------------- le karaoké d'Itsuki (décor)
function texteCanvas(w, h, dessiner) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  dessiner(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const POLICE = '"Hiragino Sans", "Noto Sans CJK JP", "Arial Black", Arial, sans-serif';

function monterKaraoke(scene) {
  const g = new THREE.Group();
  g.name = 'karaoke';
  const xMur = X_FACADE_KARAOKE;
  const z0 = ITSUKI.z;
  const enseigne = texteCanvas(512, 160, (c, w, h) => {
    c.fillStyle = 'rgba(8,3,26,0.94)'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#ff5ad0'; c.lineWidth = 7; c.shadowColor = '#ff5ad0'; c.shadowBlur = 14; c.strokeRect(10, 10, w - 20, h - 20);
    c.fillStyle = '#ffffff'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = `900 96px ${POLICE}`; c.fillText(KARAOKE.enseigne, w / 2, h / 2 + 4);
  });
  const ecran = texteCanvas(512, 256, (c, w, h) => {
    c.fillStyle = '#12082a'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#2a1456'; c.fillRect(8, 8, w - 16, h - 16);
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `bold 30px ${POLICE}`;
    KARAOKE.paroles.forEach((l, i) => { c.fillStyle = i === 1 ? '#ffd0f6' : '#a58cff'; c.fillText(l, w / 2, 64 + i * 64); });
  });
  const mat = (map) => new THREE.MeshBasicMaterial({ map, toneMapped: false });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.0), mat(enseigne));
  sign.position.set(xMur, 4.2, z0 + 1.2);
  sign.rotation.y = Math.PI / 2;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), mat(ecran));
  screen.position.set(xMur, 2.3, z0 + 2.0);
  screen.rotation.y = Math.PI / 2;
  // tapis de scène et deux tubes de lumière
  const tapis = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.02, 3.4), new THREE.MeshStandardMaterial({ color: 0x2a1456, roughness: 0.9 }));
  tapis.position.set(80.15, 0.31, z0 + 1.2);
  const tube = (z, couleur) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.6, 0.06), new THREE.MeshBasicMaterial({ color: couleur, toneMapped: false }));
    m.position.set(xMur + 0.05, 1.6, z);
    return m;
  };
  g.add(sign, screen, tapis, tube(z0 - 0.7, 0xff5ad0), tube(z0 + 3.1, 0xc44bff));
  const l = new THREE.PointLight(0xff5ad0, 14, 11, 1.8);
  l.position.set(80.6, 3.2, z0 + 0.8);
  g.add(l);
  scene.add(g);
  return g;
}

// ---------------------------------------------------------------- système
export const personnages = {
  nom: 'personnages',
  /** Où se tiennent les personnages (Vector3 / objets, repère de Kasumi). */
  positions: {},
  /** Résumé du dernier dialogue conclu : { perso, dialogue, transgressions, bond, fragments, paquet }. */
  dernier: null,
  lancer,
  /** Position du fragment 10 (souvenir parlé), pour les effets visuels. */
  positionFragmentParle: POSITIONS_PAR_DIALOGUE[10]?.position ?? null,

  init() {
    jeu.personnages = personnages;
    const scene = jeu.zones.get(ZONE).scene;
    const anc = marche.ancres;

    // Oba : assise sur son tabouret, sous l'enseigne 喫茶店, elle regarde vers la place (−z).
    const tOba = TEXTES.oba;
    npc.ajouterPersonnage({
      id: 'oba', nom: 'Oba', zone: ZONE, position: [anc.tabouret.x, anc.tabouret.y, anc.tabouret.z], yaw: Math.PI,
      apparence: APPARENCES.oba, lignes: tOba.lignes, libelle: tOba.libelle, regardeLeJoueur: true, hauteurEtiquette: 2.25,
      dialogue: () => preparer('oba').dialogue, apres: () => conclure('oba'),
    });
    // Kaede : penchée sur l'établi de son atelier 修理, face au mur (−z).
    const tK = TEXTES.kaede;
    npc.ajouterPersonnage({
      id: 'kaede', nom: 'Kaede', zone: ZONE, position: [anc.atelier.x, anc.atelier.y, anc.atelier.z], yaw: Math.PI,
      apparence: APPARENCES.kaede, lignes: tK.lignes, libelle: tK.libelle, regardeLeJoueur: true,
      dialogue: () => preparer('kaede').dialogue, apres: () => conclure('kaede'),
    });
    // Itsuki : devant le karaoké, face à la rue.
    const tI = TEXTES.itsuki;
    npc.ajouterPersonnage({
      id: 'itsuki', nom: 'Itsuki', zone: ZONE, position: [ITSUKI.x, ITSUKI.y, ITSUKI.z], yaw: ITSUKI.yawCorps,
      apparence: APPARENCES.itsuki, lignes: tI.lignes, libelle: tI.libelle, regardeLeJoueur: true,
      dialogue: () => preparer('itsuki').dialogue, apres: () => conclure('itsuki'),
    });
    monterKiosque();
    monterKaraoke(scene);

    // Kaede et Itsuki arrêtent le joueur comme n'importe quel passant (Oba et le Kiosque ont déjà leur boîte
    // dans les colliders du marché) : des boîtes de 0,6 m à hauteur d'une personne.
    const colliders = jeu.zones.get(ZONE).colliders;
    for (const [x, y, z] of [[anc.atelier.x, anc.atelier.y, anc.atelier.z], [ITSUKI.x, ITSUKI.y, ITSUKI.z]]) {
      colliders.push({ minX: x - 0.3, maxX: x + 0.3, minZ: z - 0.3, maxZ: z + 0.3, maxY: y + 1.95 });
    }

    this.positions = {
      oba: anc.tabouret.clone(),
      kaede: anc.atelier.clone(),
      kiosque: anc.kiosqueVisage.clone(),
      itsuki: new THREE.Vector3(ITSUKI.x, ITSUKI.y, ITSUKI.z),
    };

    // un souvenir dit avant une sauvegarde sans fragment (ou un rechargement en plein dialogue)
    jeu.on('partie:debut', () => accorderFragmentsParles());
  },
};
