import * as THREE from 'three';

// Objets interactifs.
//
//   const obj = interact.ajouter({
//     position: new THREE.Vector3(x, y, z) | [x, y, z],  // point visé (centre de l'objet)
//     rayon: 2.2,                    // portée en mètres (distance caméra → position)
//     libelle: 'Ouvrir le casier',   // texte de data/ (ou fonction (obj, jeu) => texte)
//     action: (obj, jeu) => { … },   // appelée quand le joueur appuie sur E
//     zone: 'clinique',              // nom de la zone où l'objet existe
//     visible: true,                 // facultatif : booléen ou fonction (obj, jeu) => booléen
//     touche: 'KeyE',                // facultatif
//     cone: 0.8,                     // facultatif : demi-angle du cône de vue (radians)
//   });
//   interact.retirer(obj);
//
// À chaque image, l'objet le plus proche de la zone courante, à portée et
// dans le cône de vue, est désigné ; l'invite « E — libellé » s'affiche.

const CONE_DEFAUT = 0.62; // ≈ 35°

export function createInteract({ camera, input, hud, jeu }) {
  const objets = new Set();
  const dir = new THREE.Vector3();
  const vers = new THREE.Vector3();
  const p = new THREE.Vector3();
  let cible = null;

  function versVecteur(v) {
    if (v instanceof THREE.Vector3) return v;
    if (Array.isArray(v)) return new THREE.Vector3(v[0], v[1], v[2]);
    return new THREE.Vector3(v.x, v.y, v.z);
  }

  function ajouter(def) {
    const obj = { rayon: 2.2, cone: CONE_DEFAUT, touche: 'KeyE' };
    for (const [k, v] of Object.entries(def)) if (v !== undefined) obj[k] = v;
    obj.position = versVecteur(def.position);
    objets.add(obj);
    return obj;
  }

  function retirer(obj) {
    objets.delete(obj);
    if (cible === obj) masquer();
  }

  const estVisible = (o) => (typeof o.visible === 'function' ? o.visible(o, jeu) !== false : o.visible !== false);
  const texte = (o) => (typeof o.libelle === 'function' ? o.libelle(o, jeu) : o.libelle);

  /** Objet désigné en ce moment (ou null). */
  function chercher() {
    const zone = jeu.zones?.nom;
    camera.getWorldPosition(p);
    camera.getWorldDirection(dir);
    let meilleur = null;
    let score = Infinity;
    for (const o of objets) {
      if (o.zone && o.zone !== zone) continue;
      if (!estVisible(o)) continue;
      vers.subVectors(o.position, p);
      const d = vers.length();
      if (d > o.rayon) continue;
      const angle = d < 0.35 ? 0 : Math.acos(Math.min(1, Math.max(-1, vers.dot(dir) / d)));
      if (angle > o.cone) continue;
      const s = d * (1 + angle * 1.5);
      if (s < score) {
        score = s;
        meilleur = o;
      }
    }
    return meilleur;
  }

  function masquer() {
    cible = null;
    hud.invite(null);
  }

  /** Appelé par la boucle quand le joueur a la main. */
  function update() {
    cible = chercher();
    if (!cible) {
      hud.invite(null);
      return;
    }
    hud.invite(`${input.label(cible.touche)} — ${texte(cible)}`);
    if (input.pressed(cible.touche)) {
      const o = cible;
      masquer();
      jeu.emettre('interaction', { objet: o });
      o.action?.(o, jeu);
    }
  }

  return {
    ajouter,
    retirer,
    update,
    masquer,
    /** Liste des objets (tous, ou ceux de la zone `zone`). */
    liste(zone) {
      return [...objets].filter((o) => !zone || o.zone === zone);
    },
    get cible() {
      return cible;
    },
  };
}
