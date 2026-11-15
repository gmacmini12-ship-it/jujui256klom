import * as THREE from 'three';
import { buildCity, HALF } from '../city.js';
import { signTexture } from '../textures.js';
import { INVITES, ENSEIGNES } from '../data/interface.js';
import { boite, materiauSceau, respirer } from './decor.js';

// Kasumi : la ville du prototype (city.js), enveloppée comme zone.
// Construite une seule fois ; on y revient sans la reconstruire.

const FOG = 0x1a0c44;

// Porte de la Clinique du Réveil : façade ouest du pâté (5, 5), au coin du
// carrefour (30, 30) prévu par le plan. On en sort sur le trottoir, tourné vers le carrefour.
export const PORTE_CLINIQUE = { x: 41, z: 44 };

export function creerKasumi(jeu) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(FOG);
  scene.fog = new THREE.FogExp2(FOG, 0.0075);

  const city = buildCity(scene, { blocsReserves: jeu.config.ville.blocsReserves });
  const animes = [];

  // ---------- Façade de la clinique ----------
  const { x: px, z: pz } = PORTE_CLINIQUE;
  const facade = new THREE.Group();
  scene.add(facade);
  const sombre = new THREE.MeshStandardMaterial({ color: 0x0b0718, roughness: 0.4, metalness: 0.6 });
  const neonBleu = new THREE.MeshBasicMaterial({ color: 0x6f8cff, toneMapped: false });
  const neonRose = new THREE.MeshBasicMaterial({ color: 0xff5ad0, toneMapped: false });
  // battant de porte (légèrement en avant de la vitrine) et cadre lumineux
  boite(facade, 0.12, 2.6, 1.7, sombre, px - 0.08, 1.3, pz);
  boite(facade, 0.06, 2.75, 0.07, neonBleu, px - 0.16, 1.37, pz - 0.9);
  boite(facade, 0.06, 2.75, 0.07, neonBleu, px - 0.16, 1.37, pz + 0.9);
  boite(facade, 0.06, 0.07, 1.87, neonBleu, px - 0.16, 2.74, pz);
  boite(facade, 0.03, 0.04, 1.2, neonRose, px - 0.16, 1.15, pz); // poignée-barre
  // auvent
  boite(facade, 1.6, 0.12, 3.2, sombre, px - 0.8, 3.15, pz);
  boite(facade, 0.05, 0.05, 3.2, neonRose, px - 1.6, 3.1, pz);
  // enseigne 治療所 au-dessus de l'auvent
  const ens = new THREE.Mesh(
    new THREE.PlaneGeometry(4.4, 1.1),
    new THREE.MeshBasicMaterial({ map: signTexture(ENSEIGNES.clinique, '#c44bff', false), transparent: true, toneMapped: false })
  );
  ens.position.set(px - 0.2, 4.1, pz);
  ens.rotation.y = -Math.PI / 2;
  facade.add(ens);
  // sceau de Mima au-dessus de la porte
  const sceauMat = materiauSceau('#5ef2ff');
  const sceau = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.6), sceauMat);
  sceau.position.set(px - 0.2, 1.9, pz - 1.45);
  sceau.rotation.y = -Math.PI / 2;
  facade.add(sceau);
  animes.push((t) => respirer(sceauMat, t));
  const lumiere = new THREE.PointLight(0x9a6bff, 18, 14, 1.8);
  lumiere.position.set(px - 2.2, 3.0, pz);
  scene.add(lumiere);

  jeu.zones.porte({
    zone: 'kasumi',
    position: [px - 0.1, 1.4, pz],
    rayon: 3,
    libelle: INVITES.entrerClinique,
    vers: 'clinique',
    point: 'porte',
  });

  const versCarrefour = Math.atan2(px - 2.6 - 30, pz - 30); // yaw tourné vers (30, 30)

  return {
    scene,
    city,
    colliders: city.colliders,
    bornes: HALF + 20,
    // point historique du prototype : le carrefour (30, 30), regard vers le nord
    apparition: { position: [30, 0, 30], yaw: 0, pitch: 0.018 },
    points: {
      clinique: { position: [px - 2.6, 0, pz], yaw: versCarrefour },
      carrefour: { position: [30, 0, 30], yaw: 0, pitch: 0.018 },
    },
    ambiance: {
      brouillard: { couleur: FOG, densite: 0.0075 },
      exposition: 1.15,
      pluie: true,
      reflet: true,
      bloom: { force: 0.75, rayon: 0.7, seuil: 0.32 },
      son: { pluie: 0.07, filtre: 20000 },
    },
    reflecteur: city.mirror,
    update(dt, t) {
      city.update(t, jeu.camera);
      for (const f of animes) f(t);
    },
  };
}
