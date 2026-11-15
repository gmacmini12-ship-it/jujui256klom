import * as THREE from 'three';
import { TITRES_ZONES } from '../data/interface.js';

// Gestionnaire de zones.
//
// Une zone est construite une seule fois, au premier besoin, par sa fabrique
// `fabrique(jeu)` qui renvoie :
//
//   {
//     scene: THREE.Scene,              // ou un THREE.Group : il est alors placé dans une scène neuve
//     colliders: [{ minX, maxX, minZ, maxZ }],   // tableau gardé par référence (modifiable ensuite)
//     bornes: 50 | { minX, maxX, minZ, maxZ },   // limites où les pieds du joueur peuvent aller
//     apparition: { position: [x, y, z], yaw, pitch? },   // point par défaut
//     points: { nom: { position, yaw, pitch? } },         // points d'arrivée nommés (portes)
//     ambiance: {
//       brouillard: { couleur: 0x1a0c44, densite: 0.0075 } | null,
//       fond: 0x1a0c44,                // couleur de fond (sinon celle du brouillard)
//       exposition: 1.15,              // renderer.toneMappingExposure
//       pluie: true,                   // la pluie suit la caméra dans cette zone
//       reflet: true,                  // `reflecteur` visible (sol miroir)
//       bloom: { force, rayon, seuil },
//       son: { pluie: 0.07, filtre: 20000 },   // voir effects.js, audio.regler
//     },
//     reflecteur?: THREE.Object3D,     // Reflector de la zone, coupé si ambiance.reflet est faux
//     entrer?(jeu), sortir?(jeu), update?(dt, t, jeu),
//   }
//
// Le gestionnaire ajoute `nom` à la zone, déplace la caméra, la fumée et la
// pluie dans la scène, change les colliders, place le joueur et sauve `etat.zone`.

const AMBIANCE_DEFAUT = {
  brouillard: { couleur: 0x1a0c44, densite: 0.0075 },
  fond: null,
  exposition: 1.15,
  pluie: false,
  reflet: false,
  bloom: { force: 0.75, rayon: 0.7, seuil: 0.32 },
  son: { pluie: 0.07, filtre: 20000 },
};

export function createZoneManager(jeu) {
  const fabriques = new Map();
  const zones = new Map();
  let courante = null;
  let nom = null;
  let enTransition = false;

  function enregistrer(n, fabrique) {
    fabriques.set(n, fabrique);
  }

  /** La zone `n`, construite si besoin (une seule fois). */
  function get(n) {
    if (zones.has(n)) return zones.get(n);
    const fabrique = fabriques.get(n);
    if (!fabrique) throw new Error(`Zone inconnue : ${n}`);
    const z = fabrique(jeu);
    if (!(z.scene instanceof THREE.Scene)) {
      const s = new THREE.Scene();
      s.add(z.scene);
      z.scene = s;
    }
    z.nom = n;
    z.colliders ||= [];
    z.points ||= {};
    z.ambiance = { ...AMBIANCE_DEFAUT, ...(z.ambiance || {}) };
    zones.set(n, z);
    return z;
  }

  function appliquerAmbiance(z) {
    const a = z.ambiance;
    const s = z.scene;
    if (a.brouillard) {
      if (!(s.fog instanceof THREE.FogExp2)) s.fog = new THREE.FogExp2(a.brouillard.couleur, a.brouillard.densite);
      s.fog.color.set(a.brouillard.couleur);
      s.fog.density = a.brouillard.densite;
    } else s.fog = null;
    const fond = a.fond ?? a.brouillard?.couleur;
    if (fond != null) s.background = new THREE.Color(fond);
    jeu.renderer.toneMappingExposure = a.exposition;
    if (jeu.bloom) {
      jeu.bloom.strength = a.bloom.force;
      jeu.bloom.radius = a.bloom.rayon;
      jeu.bloom.threshold = a.bloom.seuil;
    }
    if (jeu.rain) {
      if (a.pluie) s.add(jeu.rain.mesh);
      else jeu.rain.mesh.removeFromParent();
    }
    if (z.reflecteur) z.reflecteur.visible = !!a.reflet;
    jeu.audio?.regler(a.son);
  }

  /** Résout un point d'arrivée : nom, objet { position, yaw } ou rien (apparition). */
  function resoudrePoint(z, point) {
    if (!point) return z.apparition;
    if (typeof point === 'string') return z.points[point] || z.apparition;
    return point;
  }

  /** Installe la zone tout de suite, sans fondu. */
  function installer(n, point) {
    const z = get(n);
    const depuis = nom;
    if (courante && courante !== z) {
      courante.sortir?.(jeu);
      jeu.emettre('zone:sortie', { nom: depuis, zone: courante, vers: n });
    }
    z.scene.add(jeu.camera);
    jeu.smoking?.attacher(z.scene);
    jeu.renderPass.scene = z.scene;
    jeu.player.setColliders(z.colliders, z.bornes);
    const p = resoudrePoint(z, point);
    if (p) {
      const [x, y, zz] = Array.isArray(p.position) ? p.position : [p.position.x, p.position.y, p.position.z];
      jeu.player.teleporter(x, y, zz, p.yaw ?? 0, p.pitch ?? 0);
    }
    courante = z;
    nom = n;
    appliquerAmbiance(z);
    z.entrer?.(jeu);

    jeu.etat.zone = n;
    if (!jeu.etat.zonesVisitees.includes(n)) jeu.etat.zonesVisitees.push(n);
    jeu.memoriserPosition?.();
    jeu.sauver?.();

    jeu.emettre('zone:entree', { nom: n, zone: z, depuis });
    jeu._surZone(n, z);
    return z;
  }

  /**
   * Va dans la zone `n` avec un fondu au noir.
   * options : { point: 'nom' | { position, yaw }, fondu: true, duree: 0.6, titre: true }
   */
  async function aller(n, { point, fondu = true, duree = 0.6, titre = true } = {}) {
    if (enTransition) return false;
    enTransition = true;
    jeu.suspendre('transition');
    try {
      if (fondu) await jeu.hud.fondu(true, duree);
      const premiere = !zones.has(n);
      const z = installer(n, point);
      if (premiere) jeu.renderer.compile(z.scene, jeu.camera);
      if (fondu) {
        // laisse une image se dessiner dans la nouvelle scène avant d'ouvrir
        await new Promise((r) => setTimeout(r, 120));
        jeu.hud.fondu(false, duree);
      }
      const t = TITRES_ZONES[n];
      if (titre && t) jeu.hud.titre(t.titre, t.sous);
    } finally {
      enTransition = false;
      jeu.reprendre('transition');
    }
    return true;
  }

  /**
   * Porte : objet interactif qui mène à la zone `vers`, au point `point`.
   * { zone, position, rayon?, libelle, vers, point?, visible? } → l'objet interactif.
   */
  function porte({ zone, position, rayon = 2.6, libelle, vers, point, visible, cone }) {
    return jeu.interact.ajouter({
      zone,
      position,
      rayon,
      libelle,
      visible,
      cone,
      porte: { vers, point },
      action: () => aller(vers, { point }),
    });
  }

  return {
    enregistrer,
    get,
    installer,
    aller,
    porte,
    /** Zone affichée (objet). */
    get courante() { return courante; },
    /** Nom de la zone affichée. */
    get nom() { return nom; },
    get enTransition() { return enTransition; },
    /** Zones déjà construites. */
    get construites() { return [...zones.keys()]; },
    connait: (n) => fabriques.has(n),
    update(dt, t) {
      courante?.update?.(dt, t, jeu);
    },
  };
}
