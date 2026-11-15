import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { jeu } from './game.js';

// Joueur : marche, course, saut, collisions en 3D (boîtes alignées sur les axes).
// Les touches viennent de input.js (event.code : ZQSD sur AZERTY = WASD).
//
// Collider : { minX, maxX, minZ, maxZ, minY?, maxY? }
//   - sans minY / maxY : mur infini (comportement historique, clinique, tour…) ;
//   - avec : boîte de minY à maxY. Son sommet (maxY) est un sol praticable (toits,
//     trottoirs, marches), son dessous (minY) un plafond.
// `bornes` : nombre (carré centré de demi-côté `bornes`) ou { minX, maxX, minZ, maxZ }.
//
// Corps du joueur : prisme de section carrée (demi-côté RAYON) et de hauteur TAILLE,
// pieds en `position`. Une boîte ne bloque latéralement que si son sommet dépasse
// les pieds de plus de MARCHE (on monte une marche de 35 cm sans sauter) et si son
// dessous est plus bas que la tête.
//
// Évènements (jeu.emettre) :
//   joueur:saut        { y, vitesse }                      le joueur quitte le sol par un saut
//   joueur:chute       { y }                               le joueur quitte le sol sans sauter (bord)
//   joueur:atterrissage { hauteurChute, vitesse, y, amortissement, amortie }
//     hauteurChute : point le plus haut atteint depuis le décollage − y d'arrivée (m, ≥ 0)
//     vitesse      : vitesse verticale à l'impact (m/s, ≥ 0)
//     amortissement: hauteur de chute encaissée sans conséquence (m), voir `player.amortissement`
//     amortie      : hauteurChute <= amortissement

export const EYE = 1.75; // hauteur des yeux
export const RAYON = 0.6; // demi-côté du corps
export const TAILLE = 1.85; // hauteur du corps (plafonds)
export const MARCHE = 0.35; // marche franchie sans sauter
export const GRAVITE = 20;
export const SAUT = 6.5; // vitesse verticale du saut normal (≈ 1,06 m)
export const AMORTI_BASE = 4; // hauteur de chute encaissée sans pouvoir (m)
const DESCENTE = 0.45; // au sol, on suit une descente jusqu'à cette hauteur (marches, trottoirs)
const PAS_MAX = 0.2; // déplacement maximal par sous-pas (m)
const CONTACT = 1e-4; // écart laissé contre une paroi
const CONTROLE_AIR = 3; // réactivité de la direction en l'air (1/s)

export function createPlayer(camera, dom, colliders, bornes, input) {
  const controls = new PointerLockControls(camera, dom);
  const velocity = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const pos = new THREE.Vector3(30, 0, 30); // position des pieds
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  let onGround = true;
  let bob = 0;
  let limites = normaliser(bornes);
  let apex = 0; // point le plus haut depuis le décollage
  let controleAir = CONTROLE_AIR;
  let lissage = 0; // décalage de caméra amorti après une marche (monte en douceur)
  let proches = []; // colliders candidats pour l'image en cours

  function normaliser(b) {
    if (typeof b === 'number') return { minX: -b, maxX: b, minZ: -b, maxZ: b };
    return b || { minX: -Infinity, maxX: Infinity, minZ: -Infinity, maxZ: Infinity };
  }

  const down = (...codes) => codes.some((c) => input.isDown(c));
  const bas = (c) => (c.minY ?? -Infinity);
  const haut = (c) => (c.maxY ?? Infinity);
  const recouvre = (c, x, z, r = RAYON) => x > c.minX - r && x < c.maxX + r && z > c.minZ - r && z < c.maxZ + r;
  // la boîte fait obstacle au corps dont les pieds sont en y
  const mur = (c, y) => haut(c) > y + MARCHE + 1e-6 && bas(c) < y + TAILLE;
  const horsBornes = (x, z) => x < limites.minX || x > limites.maxX || z < limites.minZ || z > limites.maxZ;

  /** Vrai si le corps, pieds en (x, y, z), heurte une boîte (ou sort des bornes). `y` : hauteur actuelle par défaut. */
  function blocked(x, z, y = pos.y) {
    for (const c of colliders) if (recouvre(c, x, z) && mur(c, y)) return true;
    return horsBornes(x, z);
  }

  /** Sommet le plus haut (≤ yMax) des boîtes sous l'empreinte (x, z, r) ; 0 au minimum. */
  function sol(x, z, yMax, r = RAYON, liste = proches) {
    let g = 0;
    for (const c of liste) {
      const h = c.maxY;
      if (h === undefined || h > yMax || h <= g || !recouvre(c, x, z, r)) continue;
      g = h;
    }
    return g;
  }

  /** Dessous le plus bas (≥ yTete) des boîtes au-dessus de l'empreinte. */
  function plafond(x, z, yTete) {
    let p = Infinity;
    for (const c of proches) {
      const b = c.minY;
      if (b === undefined || b < yTete - 0.02 || b >= p || !recouvre(c, x, z)) continue;
      p = b;
    }
    return p;
  }

  // Colliders qui peuvent être touchés pendant l'image (balayage du mouvement).
  function preselectionner(dt) {
    const m = (Math.abs(velocity.x) + Math.abs(velocity.z)) * dt + RAYON + 1;
    const y1 = Math.max(pos.y, pos.y + velocity.y * dt) + TAILLE + 1;
    proches = [];
    for (const c of colliders) {
      if (c.maxX < pos.x - m || c.minX > pos.x + m || c.maxZ < pos.z - m || c.minZ > pos.z + m) continue;
      if (bas(c) > y1) continue; // trop haut pour cette image (les boîtes plus basses servent de sol)
      proches.push(c);
    }
  }

  // Déplacement horizontal sur un axe, avec arrêt au contact (sans rebond ni tremblement).
  // Une boîte dans laquelle on se trouve déjà (téléportation, objet mobile) ne retient pas : on peut en sortir.
  function deplacer(axe, d) {
    if (d === 0) return;
    const x0 = pos.x, z0 = pos.z, y = pos.y;
    let nx = axe === 'x' ? x0 + d : x0;
    let nz = axe === 'z' ? z0 + d : z0;
    let touche = false;
    for (const c of proches) {
      if (!mur(c, y) || !recouvre(c, nx, nz) || recouvre(c, x0, z0)) continue;
      touche = true;
      if (axe === 'x') nx = d > 0 ? Math.min(nx, c.minX - RAYON - CONTACT) : Math.max(nx, c.maxX + RAYON + CONTACT);
      else nz = d > 0 ? Math.min(nz, c.minZ - RAYON - CONTACT) : Math.max(nz, c.maxZ + RAYON + CONTACT);
    }
    if (axe === 'x') {
      if (horsBornes(nx, z0)) { nx = Math.min(Math.max(nx, limites.minX), limites.maxX); touche = true; }
      if ((d > 0 && nx < x0) || (d < 0 && nx > x0)) nx = x0;
      pos.x = nx;
      if (touche) velocity.x = 0;
    } else {
      if (horsBornes(x0, nz)) { nz = Math.min(Math.max(nz, limites.minZ), limites.maxZ); touche = true; }
      if ((d > 0 && nz < z0) || (d < 0 && nz > z0)) nz = z0;
      pos.z = nz;
      if (touche) velocity.z = 0;
    }
  }

  function atterrir(g) {
    const vitesse = Math.max(0, -velocity.y);
    const hauteurChute = Math.max(0, apex - g);
    velocity.y = 0;
    onGround = true;
    controleAir = CONTROLE_AIR;
    derniere.hauteurChute = hauteurChute;
    derniere.vitesse = vitesse;
    const amortissement = api.amortissement;
    jeu.emettre('joueur:atterrissage', { hauteurChute, vitesse, y: g, amortissement, amortie: hauteurChute <= amortissement });
  }

  function vertical(h) {
    const y0 = pos.y;
    if (onGround) {
      const g = sol(pos.x, pos.z, y0 + MARCHE);
      if (g >= y0 - DESCENTE) {
        if (g !== y0) lissage = Math.max(-0.5, Math.min(0.5, lissage + y0 - g));
        pos.y = g;
        velocity.y = 0;
        return;
      }
      onGround = false; // le sol s'est dérobé : bord d'un toit, d'une marche haute
      apex = y0;
      jeu.emettre('joueur:chute', { y: y0 });
    }
    velocity.y -= GRAVITE * h;
    let y = y0 + velocity.y * h;
    if (velocity.y > 0) {
      const p = plafond(pos.x, pos.z, y0 + TAILLE);
      if (y + TAILLE > p) {
        y = Math.max(y0, p - TAILLE);
        velocity.y = 0;
      }
    }
    // balayage : tout sommet entre l'ancienne et la nouvelle hauteur arrête la chute
    const g = sol(pos.x, pos.z, y0 + MARCHE);
    if (y <= g) {
      if (velocity.y <= 0) {
        pos.y = g;
        if (g > y0) lissage = Math.max(-0.5, Math.min(0.5, lissage + y0 - g));
        atterrir(g);
        return;
      }
      y = g; // marche franchie en montant : on est soulevé, le saut continue
    }
    pos.y = y;
    if (y > apex) apex = y;
  }

  function update(dt) {
    const f = (down('KeyW', 'ArrowUp') ? 1 : 0) - (down('KeyS', 'ArrowDown') ? 1 : 0);
    const s = (down('KeyD', 'ArrowRight') ? 1 : 0) - (down('KeyA', 'ArrowLeft') ? 1 : 0);
    const speed = down('ShiftLeft', 'ShiftRight') ? 11 : 5;

    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    right.crossVectors(forward, camera.up);

    const len = Math.hypot(f, s) || 1;
    const tx = ((forward.x * f + right.x * s) / len) * speed;
    const tz = ((forward.z * f + right.z * s) / len) * speed;
    const k = 1 - Math.exp(-dt * (onGround ? 12 : controleAir));
    velocity.x += (tx - velocity.x) * k;
    velocity.z += (tz - velocity.z) * k;

    if (api.sautAuto && onGround && down('Space')) sauter();

    // sous-pas : jamais plus de PAS_MAX par pas, pour ne rien traverser (la gravité est appliquée par sous-pas)
    const vmax = Math.max(Math.abs(velocity.x), Math.abs(velocity.z), Math.abs(velocity.y) + GRAVITE * dt);
    const n = Math.min(400, Math.max(1, Math.ceil((vmax * dt) / PAS_MAX)));
    const h = dt / n;
    preselectionner(dt);
    for (let i = 0; i < n; i++) {
      deplacer('x', velocity.x * h);
      deplacer('z', velocity.z * h);
      vertical(h);
    }

    const moving = Math.hypot(velocity.x, velocity.z);
    if (onGround && moving > 0.5) bob += dt * moving * 1.6;
    lissage *= Math.exp(-dt * 14);
    if (Math.abs(lissage) < 1e-3) lissage = 0;
    placerCamera();
  }

  function placerCamera() {
    camera.position.set(
      pos.x,
      pos.y + EYE + lissage + api.decalageVue + (onGround ? Math.sin(bob) * 0.045 : 0),
      pos.z
    );
  }

  /** Saut depuis le sol (vitesse verticale `vy`, 6,5 m/s par défaut). Renvoie vrai si le saut a lieu. */
  function sauter(vy = SAUT) {
    if (!onGround) return false;
    velocity.y = vy;
    onGround = false;
    apex = pos.y;
    jeu.emettre('joueur:saut', { y: pos.y, vitesse: vy });
    return true;
  }

  /**
   * Impulsion libre (pouvoirs) : remplace la vitesse par (vx, vy, vz) ; `vx`/`vz` null = inchangé.
   * `controleAir` (1/s) : réactivité de la direction jusqu'à l'atterrissage (3 par défaut, plus bas = élan conservé).
   */
  function impulser(vx, vy, vz, { controleAir: ca = CONTROLE_AIR } = {}) {
    if (vx !== null && vx !== undefined) velocity.x = vx;
    if (vz !== null && vz !== undefined) velocity.z = vz;
    const quitte = onGround && vy > 0;
    velocity.y = vy;
    controleAir = ca;
    if (quitte) {
      onGround = false;
      apex = pos.y;
      jeu.emettre('joueur:saut', { y: pos.y, vitesse: vy });
    }
  }

  /** Remplace les colliders (tableau gardé par référence) et les bornes. */
  function setColliders(liste, b) {
    colliders = liste;
    limites = normaliser(b);
  }

  /**
   * Place les pieds en (x, y, z) et arrête le mouvement. `yaw` (radians, 0 = regarde vers -z) optionnel.
   * Si (x, y, z) est sous le sol (à moins d'une marche), le joueur est posé dessus ; au-dessus, il tombe.
   */
  function teleporter(x, y, z, yaw, pitch = 0) {
    pos.set(x, y || 0, z);
    velocity.set(0, 0, 0);
    controleAir = CONTROLE_AIR;
    lissage = 0;
    const g = sol(x, z, pos.y + MARCHE, RAYON, colliders);
    if (pos.y - g < 0.05) pos.y = g;
    onGround = pos.y === g;
    apex = pos.y;
    if (yaw !== undefined && yaw !== null) regarder(yaw, pitch);
    placerCamera();
  }

  /** Oriente la caméra : yaw autour de y (0 = vers -z, π/2 = vers -x), pitch vers le haut si positif. */
  function regarder(yaw, pitch = 0) {
    euler.set(pitch, yaw, 0, 'YXZ');
    camera.quaternion.setFromEuler(euler);
  }

  /** Orientation actuelle { yaw, pitch }. */
  function orientation() {
    euler.setFromQuaternion(camera.quaternion, 'YXZ');
    return { yaw: euler.y, pitch: euler.x };
  }

  /**
   * Hauteur du sol sous le point (x, z) pour quelqu'un qui se tient à la hauteur `y` :
   * sommet le plus haut des boîtes sous ce point qui ne dépasse pas `y` (0 au minimum).
   * Sans `y` : le sommet le plus haut sous ce point. `rayon` : empreinte (0 = un point).
   */
  function solSous(x, z, y = Infinity, rayon = 0) {
    return sol(x, z, y + 1e-3, rayon, colliders);
  }

  const derniere = { hauteurChute: 0, vitesse: 0 };

  const api = {
    controls,
    update,
    position: pos,
    velocity,
    get auSol() { return onGround; },
    /** Vitesse de chute actuelle (m/s, ≥ 0 ; 0 au sol ou en montée). */
    get vitesseChute() { return onGround ? 0 : Math.max(0, -velocity.y); },
    /** Hauteur déjà tombée depuis le point le plus haut du vol en cours (m ; 0 au sol). */
    get hauteurChute() { return onGround ? 0 : Math.max(0, apex - pos.y); },
    /** Dernier atterrissage : { hauteurChute, vitesse }. */
    derniereChute: derniere,
    /** Hauteur de chute encaissée sans conséquence (m) ; le Bond la porte à 12. */
    amortissement: AMORTI_BASE,
    /** Vrai : Espace fait sauter dès l'appui. Le Bond le met à faux et gère lui-même le saut. */
    sautAuto: true,
    /** Décalage vertical de la caméra (m), pour les pouvoirs (accroupi pendant la charge du Bond…). */
    decalageVue: 0,
    dimensions: { yeux: EYE, rayon: RAYON, taille: TAILLE, marche: MARCHE, gravite: GRAVITE, saut: SAUT },
    setColliders,
    teleporter,
    regarder,
    orientation,
    sauter,
    impulser,
    solSous,
    bloque: blocked,
  };
  placerCamera();
  return api;
}
