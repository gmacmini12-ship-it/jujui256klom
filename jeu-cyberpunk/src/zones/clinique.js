import * as THREE from 'three';
import { rng, windowTexture, signTexture, skyTexture } from '../textures.js';
import { SIGNS_H, SIGNS_V } from '../data/signs.js';
import { INVITES } from '../data/interface.js';
import { DIALOGUES } from '../data/dialogues.js';
import { boite, colliderDe, materiauSceau, respirer, materiauVitrePluie } from './decor.js';

// Clinique du Réveil (bible §5.1) : point de départ d'une nouvelle partie.
//
// Pièce de 14 × 10 m, hauteur 3,4 m, centrée sur l'origine de sa propre scène.
//   nord (z = -5) : la fenêtre sur la ville qui ruisselle
//   ouest (x = -7) : la vitre de la chambre de veille (x de -11 à -7)
//   est (x = 7)   : le casier, la porte vers la rue
//   sud (z = 5)   : l'anneau de Mima
// Éclairage : une seule lumière froide au plafond, plus la fenêtre.

const L = 14, P = 10, H = 3.4;
const X0 = -L / 2, X1 = L / 2, Z0 = -P / 2, Z1 = P / 2;
const FOND = 0x120828;

// Positions utiles aux autres modules (fragments, Calque…) : jeu.zones.get('clinique').ancres
export const ANCRES = {
  lit: new THREE.Vector3(-3.2, 0.62, 1.8), // lit du joueur (fin « Dormir encore »)
  litVide: new THREE.Vector3(-3.2, 0.62, -2.4), // lit d'Hélène, draps faits
  oreillerVide: new THREE.Vector3(-4.05, 0.72, -2.4), // fragment 25
  casier: new THREE.Vector3(6.55, 1.2, -2.2), // veste, téléphone, paquet, bracelet (fragment 1)
  borne: new THREE.Vector3(4.6, 1.35, -3.7), // fragment 2
  vitreVeille: new THREE.Vector3(-7, 1.6, 0), // la chambre de veille, derrière la vitre
  dormeuse: new THREE.Vector3(-9.3, 0.85, 0), // silhouette immobile, halo éteint
  anneau: new THREE.Vector3(0, 1.9, Z1 - 0.05), // anneau de Mima (mur sud)
  porte: new THREE.Vector3(X1 - 0.05, 1.3, 2.8),
  fenetre: new THREE.Vector3(0, 1.85, Z0),
};

export function creerClinique(jeu) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(FOND);
  const rand = rng(2076);
  const colliders = [];
  const animes = [];

  // ---------------- Matériaux ----------------
  const mur = new THREE.MeshStandardMaterial({ color: 0xcfc4ec, roughness: 0.85, metalness: 0.0 });
  const murSombre = new THREE.MeshStandardMaterial({ color: 0x8f84b8, roughness: 0.8 });
  const sol = new THREE.MeshStandardMaterial({ color: 0x3a3060, roughness: 0.28, metalness: 0.35 });
  const plafond = new THREE.MeshStandardMaterial({ color: 0xb8aedc, roughness: 0.9 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x9a94b8, roughness: 0.35, metalness: 0.75 });
  const metalSombre = new THREE.MeshStandardMaterial({ color: 0x2a2440, roughness: 0.4, metalness: 0.7 });
  const drap = new THREE.MeshStandardMaterial({ color: 0xeee8ff, roughness: 0.95 });
  const drapFroisse = new THREE.MeshStandardMaterial({ color: 0xd9d0f4, roughness: 1.0 });
  const tissuSombre = new THREE.MeshStandardMaterial({ color: 0x1c1830, roughness: 0.95 });
  const peau = new THREE.MeshStandardMaterial({ color: 0x7a6cb0, roughness: 0.85 });
  const neonFroid = new THREE.MeshBasicMaterial({ color: 0xdce8ff, toneMapped: false });
  const neonBleu = new THREE.MeshBasicMaterial({ color: 0x6f8cff, toneMapped: false });
  const neonRose = new THREE.MeshBasicMaterial({ color: 0xff5ad0, toneMapped: false });

  // ---------------- Sol, plafond, murs ----------------
  boite(scene, L + 8.4, 0.1, P + 0.4, sol, -2, -0.05, 0);
  boite(scene, L, 0.12, P, plafond, 0, H + 0.06, 0);
  // fines lignes au sol, comme un carrelage clinique
  const joints = new THREE.MeshBasicMaterial({ color: 0x4c4078 });
  for (let x = X0 + 1.4; x < X1; x += 1.4) boite(scene, 0.02, 0.005, P, joints, x, 0.003, 0);
  for (let z = Z0 + 1.4; z < Z1; z += 1.4) boite(scene, L, 0.005, 0.02, joints, 0, 0.003, z);

  // Mur nord, percé de la fenêtre (x de -3.6 à 3.6, y de 0.8 à 2.9).
  const FX = 3.6, FY0 = 0.8, FY1 = 2.9;
  boite(scene, X1 - FX, H, 0.2, mur, (FX + X1) / 2, H / 2, Z0 - 0.1);
  boite(scene, -FX - X0, H, 0.2, mur, (X0 - FX) / 2, H / 2, Z0 - 0.1);
  boite(scene, FX * 2, FY0, 0.2, mur, 0, FY0 / 2, Z0 - 0.1);
  boite(scene, FX * 2, H - FY1, 0.2, mur, 0, (H + FY1) / 2, Z0 - 0.1);
  // encadrement et meneaux
  boite(scene, FX * 2 + 0.2, 0.12, 0.34, metal, 0, FY0, Z0 - 0.05);
  boite(scene, FX * 2 + 0.2, 0.08, 0.3, metal, 0, FY1, Z0 - 0.1);
  for (const x of [-FX, -FX / 3, FX / 3, FX]) boite(scene, 0.07, FY1 - FY0, 0.24, metal, x, (FY0 + FY1) / 2, Z0 - 0.1);
  const vitre = materiauVitrePluie();
  const vitreMesh = new THREE.Mesh(new THREE.PlaneGeometry(FX * 2, FY1 - FY0), vitre);
  vitreMesh.position.set(0, (FY0 + FY1) / 2, Z0 - 0.12);
  vitreMesh.renderOrder = 4;
  scene.add(vitreMesh);
  animes.push((t) => (vitre.uniforms.time.value = t));

  // Mur sud
  boite(scene, L, H, 0.2, mur, 0, H / 2, Z1 + 0.1);
  // Mur est, percé de la porte (z de 2.0 à 3.6, hauteur 2.5)
  const PZ0 = 2.0, PZ1 = 3.6, PH = 2.5;
  boite(scene, 0.2, H, PZ0 - Z0, mur, X1 + 0.1, H / 2, (Z0 + PZ0) / 2);
  boite(scene, 0.2, H, Z1 - PZ1, mur, X1 + 0.1, H / 2, (PZ1 + Z1) / 2);
  boite(scene, 0.2, H - PH, PZ1 - PZ0, mur, X1 + 0.1, (H + PH) / 2, (PZ0 + PZ1) / 2);
  // porte coulissante fermée, cadre lumineux
  boite(scene, 0.08, PH, PZ1 - PZ0, metalSombre, X1 + 0.02, PH / 2, (PZ0 + PZ1) / 2);
  boite(scene, 0.04, PH + 0.08, 0.05, neonBleu, X1 - 0.03, PH / 2, PZ0);
  boite(scene, 0.04, PH + 0.08, 0.05, neonBleu, X1 - 0.03, PH / 2, PZ1);
  boite(scene, 0.04, 0.05, PZ1 - PZ0, neonBleu, X1 - 0.03, PH + 0.04, (PZ0 + PZ1) / 2);
  boite(scene, 0.03, 0.5, 0.04, neonRose, X1 - 0.03, 1.15, PZ0 + 0.25);
  // enseigne « sortie » au-dessus
  const sortie = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 0.9 / 4),
    new THREE.MeshBasicMaterial({ map: signTexture(SIGNS_V.find((s) => s.fr === 'sortie de secours')?.text || '出口', '#6f8cff', false), transparent: true, toneMapped: false })
  );
  sortie.position.set(X1 - 0.06, PH + 0.42, (PZ0 + PZ1) / 2);
  sortie.rotation.y = -Math.PI / 2;
  scene.add(sortie);

  // Mur ouest, percé de la vitre de la chambre de veille (z de -3.4 à 3.4, y de 0.6 à 2.9)
  const VZ = 3.4, VY0 = 0.6, VY1 = 2.9;
  boite(scene, 0.2, H, Z1 - VZ, mur, X0 - 0.1, H / 2, (VZ + Z1) / 2);
  boite(scene, 0.2, H, -VZ - Z0, mur, X0 - 0.1, H / 2, (Z0 - VZ) / 2);
  boite(scene, 0.2, VY0, VZ * 2, murSombre, X0 - 0.1, VY0 / 2, 0);
  boite(scene, 0.2, H - VY1, VZ * 2, mur, X0 - 0.1, (H + VY1) / 2, 0);
  for (const z of [-VZ, 0, VZ]) boite(scene, 0.22, VY1 - VY0, 0.06, metal, X0 - 0.1, (VY0 + VY1) / 2, z);
  const verreVeille = new THREE.Mesh(
    new THREE.PlaneGeometry(VZ * 2, VY1 - VY0),
    new THREE.MeshStandardMaterial({ color: 0x9fb6ff, roughness: 0.22, metalness: 0.8, transparent: true, opacity: 0.16, depthWrite: false })
  );
  verreVeille.position.set(X0 - 0.1, (VY0 + VY1) / 2, 0);
  verreVeille.rotation.y = Math.PI / 2;
  verreVeille.renderOrder = 3;
  scene.add(verreVeille);

  // ---------------- Chambre de veille (derrière la vitre) ----------------
  const veille = new THREE.Group();
  scene.add(veille);
  const murVeille = new THREE.MeshStandardMaterial({ color: 0x4a4480, roughness: 0.9 });
  boite(veille, 4, H, 0.2, murVeille, -9, H / 2, Z0 - 0.1);
  boite(veille, 4, H, 0.2, murVeille, -9, H / 2, Z1 + 0.1);
  boite(veille, 0.2, H, P, murVeille, -11.1, H / 2, 0);
  boite(veille, 4, 0.12, P, plafond, -9, H + 0.06, 0);
  // lit et dormeuse
  boite(veille, 1.0, 0.5, 2.2, metalSombre, -9.3, 0.35, 0);
  boite(veille, 0.94, 0.14, 2.1, drap, -9.3, 0.67, 0.02);
  const dormeuse = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 1.2, 4, 10), peau);
  dormeuse.rotation.x = Math.PI / 2;
  dormeuse.position.set(-9.3, 0.95, 0.15);
  veille.add(dormeuse);
  const tete = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), peau);
  tete.position.set(-9.3, 0.95, -0.78);
  veille.add(tete);
  // halo éteint : anneau gris, sans lumière
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.015, 6, 32), new THREE.MeshStandardMaterial({ color: 0x55506a, roughness: 0.6 }));
  halo.position.set(-9.3, 1.25, -0.75);
  halo.rotation.x = Math.PI / 2;
  veille.add(halo);
  // veilleuse bleue très faible et moniteur
  const veilleuse = new THREE.PointLight(0x6a7bff, 2.2, 6, 1.4);
  veilleuse.position.set(-8.2, 2.0, 1.2);
  veille.add(veilleuse);
  boite(veille, 0.06, 0.4, 0.55, metalSombre, -10.95, 1.5, -1.3);
  boite(veille, 0.02, 0.3, 0.45, neonBleu, -10.9, 1.5, -1.3);

  // ---------------- Lit du joueur (draps défaits) ----------------
  const lit = (cx, cz, fait) => {
    const g = new THREE.Group();
    boite(g, 2.1, 0.42, 1.0, metalSombre, cx, 0.33, cz);
    for (const dx of [-0.95, 0.95]) for (const dz of [-0.42, 0.42]) boite(g, 0.06, 0.18, 0.06, metal, cx + dx, 0.09, cz + dz);
    boite(g, 2.0, 0.12, 0.94, drap, cx, 0.6, cz);
    boite(g, 0.08, 0.9, 1.0, metal, cx - 1.06, 0.75, cz); // tête de lit
    boite(g, 0.42, 0.12, 0.7, drap, cx - 0.78, 0.72, cz); // oreiller
    if (fait) {
      boite(g, 1.4, 0.05, 0.98, drapFroisse, cx + 0.28, 0.68, cz); // drap tiré
      boite(g, 0.2, 0.06, 0.99, drap, cx - 0.36, 0.7, cz); // revers plié net
    } else {
      const froisse = boite(g, 1.3, 0.1, 0.9, drapFroisse, cx + 0.45, 0.68, cz + 0.12);
      froisse.rotation.set(0.05, 0.22, -0.04);
      boite(g, 0.6, 0.06, 0.5, drapFroisse, cx + 1.05, 0.66, cz + 0.55).rotation.set(0.3, 0.6, 0.2);
    }
    scene.add(g);
    colliders.push(colliderDe(cx, cz, 2.2, 1.05));
  };
  lit(ANCRES.lit.x, ANCRES.lit.z, false);
  lit(ANCRES.litVide.x, ANCRES.litVide.z, true);
  // table de chevet entre les lits
  boite(scene, 0.5, 0.6, 0.5, metalSombre, -4.0, 0.3, -0.3, { collider: colliders });
  boite(scene, 0.12, 0.2, 0.12, neonRose, -3.95, 0.7, -0.25);

  // ---------------- Bras robotique au plafond (immobile) ----------------
  const bras = new THREE.Group();
  bras.position.set(-2.6, H, 1.8);
  scene.add(bras);
  const disque = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.38, 0.12, 20), metal);
  disque.position.y = -0.06;
  bras.add(disque);
  const segment = (longueur, rayon) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rayon, rayon, longueur, 12), metal);
    m.position.y = -longueur / 2;
    const pivot = new THREE.Group();
    pivot.add(m);
    const articulation = new THREE.Mesh(new THREE.SphereGeometry(rayon * 1.5, 12, 10), metalSombre);
    pivot.add(articulation);
    const bout = new THREE.Group();
    bout.position.y = -longueur;
    pivot.add(bout);
    return { pivot, bout };
  };
  const s1 = segment(0.9, 0.07);
  s1.pivot.position.y = -0.12;
  s1.pivot.rotation.z = 0.6;
  bras.add(s1.pivot);
  const s2 = segment(0.8, 0.055);
  s2.pivot.rotation.z = -1.35;
  s1.bout.add(s2.pivot);
  const s3 = segment(0.3, 0.04);
  s3.pivot.rotation.z = 0.5;
  s2.bout.add(s3.pivot);
  const pointe = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 10), metalSombre);
  pointe.position.y = -0.06;
  s3.bout.add(pointe);
  const voyant = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), neonRose);
  voyant.position.set(0.07, 0, 0);
  s2.bout.add(voyant);

  // ---------------- Casier (est) ----------------
  const casier = new THREE.Group();
  scene.add(casier);
  const { x: cx, z: cz } = ANCRES.casier;
  boite(casier, 0.6, 2.1, 0.9, metal, cx + 0.05, 1.05, cz);
  boite(casier, 0.5, 1.9, 0.8, tissuSombre, cx - 0.02, 1.05, cz); // intérieur sombre
  const battant = boite(casier, 0.04, 1.95, 0.85, metal, cx - 0.3, 1.05, cz);
  battant.geometry.translate(0, 0, 0.42);
  battant.position.z = cz - 0.43;
  battant.rotation.y = -0.55; // entrouvert
  boite(casier, 0.3, 0.9, 0.55, new THREE.MeshStandardMaterial({ color: 0x2b2a4a, roughness: 0.9 }), cx - 0.05, 1.45, cz + 0.05); // la veste
  boite(casier, 0.03, 0.03, 0.4, neonBleu, cx - 0.31, 2.02, cz);
  colliders.push(colliderDe(cx + 0.05, cz, 0.7, 1.0));

  // ---------------- Borne (sceau de Mima à l'écran) ----------------
  const { x: bx, z: bz } = ANCRES.borne;
  boite(scene, 0.4, 1.1, 0.34, metalSombre, bx, 0.55, bz, { collider: colliders });
  const ecran = boite(scene, 0.55, 0.42, 0.05, metal, bx, 1.28, bz + 0.05);
  ecran.rotation.x = -0.35;
  const sceauBorne = materiauSceau('#5ef2ff');
  const plaque = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), sceauBorne);
  plaque.position.set(bx, 1.29, bz + 0.085);
  plaque.rotation.x = -0.35;
  scene.add(plaque);
  animes.push((t) => respirer(sceauBorne, t, 1.3));

  // ---------------- Anneau de Mima (mur sud) ----------------
  const sceauMur = materiauSceau('#5ef2ff');
  const anneau = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), sceauMur);
  anneau.position.copy(ANCRES.anneau);
  anneau.rotation.y = Math.PI;
  scene.add(anneau);
  animes.push((t) => respirer(sceauMur, t));

  // ---------------- Lumières ----------------
  // la lumière froide unique, au plafond, et son panneau
  boite(scene, 1.8, 0.04, 0.7, neonFroid, -0.8, H - 0.01, 0.6);
  const froide = new THREE.PointLight(0xc8dcff, 14, 22, 1.5);
  froide.position.set(-0.8, H - 0.3, 0.6);
  scene.add(froide);
  // la fenêtre : lueur de la ville qui entre (magenta / violet), faible
  const lueur = new THREE.PointLight(0xc44bff, 5, 10, 1.6);
  lueur.position.set(0, 1.9, Z0 + 0.6);
  scene.add(lueur);
  scene.add(new THREE.HemisphereLight(0x6a3cff, 0x1a0838, 0.35));

  // ---------------- La ville derrière la fenêtre ----------------
  construireVue(scene, rand, animes);

  // ---------------- Interactions ----------------
  jeu.zones.porte({
    zone: 'clinique',
    position: ANCRES.porte,
    rayon: 2.6,
    libelle: INVITES.sortirClinique,
    vers: 'kasumi',
    point: 'clinique',
  });
  jeu.interact.ajouter({
    zone: 'clinique',
    position: ANCRES.anneau,
    rayon: 3,
    libelle: INVITES.parlerMima,
    action: () => jeu.ouvrirDialogue(DIALOGUES.anneauClinique),
  });

  return {
    scene,
    colliders,
    // limites des pieds (murs moins le rayon du joueur)
    bornes: { minX: X0 + 0.6, maxX: X1 - 0.6, minZ: Z0 + 0.6, maxZ: Z1 - 0.6 },
    // réveil : debout au bord du lit, tourné vers la fenêtre
    apparition: { position: [-1.5, 0, 1.6], yaw: -0.22 },
    points: {
      // retour depuis la rue : devant la porte, tourné vers l'intérieur
      porte: { position: [X1 - 1.4, 0, (PZ0 + PZ1) / 2], yaw: Math.PI / 2 },
    },
    ancres: ANCRES,
    ambiance: {
      brouillard: { couleur: 0x1c0d40, densite: 0.0062 },
      fond: FOND,
      exposition: 1.0,
      pluie: false,
      reflet: false,
      bloom: { force: 0.9, rayon: 0.6, seuil: 0.36 },
      son: { pluie: 0.025, filtre: 900 }, // « comme sous l'eau »
    },
    update(dt, t) {
      for (const f of animes) f(t);
    },
  };
}

// Vue par la fenêtre : rue mouillée, immeubles à fenêtres, enseignes, hologramme
// de Mima et voitures volantes. Tout est au nord de la pièce (z < -5).
function construireVue(scene, rand, animes) {
  const vue = new THREE.Group();
  scene.add(vue);
  const NEON = ['#ff2bd6', '#c44bff', '#3d6bff', '#8a5cff', '#ff5ad0', '#4aa8ff'];
  const variantes = [
    windowTexture(rand, ['#ff3fd8', '#ff7ae6', '#c44bff', '#ffd0f6'], 0.34),
    windowTexture(rand, ['#4a7dff', '#7aa6ff', '#9a6bff', '#dfe6ff'], 0.5),
    windowTexture(rand, ['#ff2bd6', '#7a5cff', '#3d6bff', '#b04bff'], 0.2),
  ];
  const mats = variantes.map((tex) => new THREE.MeshStandardMaterial({
    color: 0x130c2a, roughness: 0.55, metalness: 0.45, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.15,
  }));

  // rue mouillée
  const rue = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshStandardMaterial({ color: 0x1a1236, roughness: 0.18, metalness: 0.7 })
  );
  rue.rotation.x = -Math.PI / 2;
  rue.position.set(0, -0.4, -205);
  vue.add(rue);

  const immeuble = (x, z, w, d, h) => {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      const face = Math.floor(i / 4);
      if (face === 2 || face === 3) uv.setXY(i, 0.002, 0.002);
      else uv.setXY(i, (uv.getX(i) * (face < 2 ? d : w)) / 1.25 / 32 + 0.3, (uv.getY(i) * h) / 2.2 / 32 + 0.2);
    }
    const m = new THREE.Mesh(g, mats[Math.floor(rand() * mats.length)]);
    m.position.set(x, h / 2 - 0.4, z);
    vue.add(m);
    return m;
  };
  // rangée d'en face, puis plus loin, puis les tours
  // rangée basse d'en face (boutiques), avec des trouées : on voit les tours derrière
  for (let x = -34; x < 34; x += 11 + rand() * 6) if (rand() < 0.75) immeuble(x, -26, 9, 8, 4 + rand() * 4);
  for (let x = -70; x < 70; x += 15 + rand() * 8) immeuble(x + rand() * 4, -55 - rand() * 15, 13, 12, 26 + rand() * 45);
  for (let x = -140; x < 140; x += 30 + rand() * 20) immeuble(x, -130 - rand() * 50, 20, 20, 70 + rand() * 90);

  // enseignes sur la rangée d'en face
  for (let i = 0; i < 7; i++) {
    const vertical = rand() < 0.45;
    const textes = vertical ? SIGNS_V : SIGNS_H;
    const texte = textes[Math.floor(rand() * textes.length)].text;
    const couleur = NEON[Math.floor(rand() * NEON.length)];
    const w = vertical ? 1.3 : 4 + rand() * 2.5;
    const h = vertical ? 5.2 : w / 4;
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: signTexture(texte, couleur, vertical), transparent: true, toneMapped: false })
    );
    m.position.set(-28 + i * 9 + rand() * 3, vertical ? 4.2 + rand() * 1.5 : 2.6 + rand() * 1.2, -21.6);
    vue.add(m);
  }

  // hologramme de Mima, très grand, sur une tour du fond
  const holo = materiauSceau('#5ef2ff');
  const plan = new THREE.Mesh(new THREE.PlaneGeometry(26, 26), holo);
  plan.position.set(18, 52, -118);
  vue.add(plan);
  animes.push((t) => respirer(holo, t, 0.7));

  // voitures volantes
  const voitures = [];
  const vmat = [0xff2bd6, 0x6f8cff, 0xe8d8ff, 0xc44bff].map((c) => new THREE.MeshBasicMaterial({ color: c, toneMapped: false }));
  for (let i = 0; i < 9; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.45, 1.2), vmat[i % vmat.length]);
    vue.add(m);
    voitures.push({ m, y: 14 + rand() * 40, z: -35 - rand() * 90, v: (rand() < 0.5 ? 1 : -1) * (12 + rand() * 20), p: rand() * 300 });
  }
  animes.push((t) => {
    for (const c of voitures) {
      const x = ((((c.p + t * c.v) % 300) + 300) % 300) - 150;
      c.m.position.set(x, c.y, c.z);
    }
  });

  // ciel
  const ciel = new THREE.Mesh(
    new THREE.SphereGeometry(330, 32, 16),
    new THREE.MeshBasicMaterial({ map: skyTexture(rand), side: THREE.BackSide, fog: false, depthWrite: false })
  );
  ciel.renderOrder = -1;
  vue.add(ciel);
  // lumière de rue (éclaire les façades d'en face)
  const rueLumiere = new THREE.PointLight(0xff2bd6, 22, 40, 1.8);
  rueLumiere.position.set(-8, 3, -16);
  vue.add(rueLumiere);
  const rueLumiere2 = new THREE.PointLight(0x3d6bff, 22, 40, 1.8);
  rueLumiere2.position.set(12, 3, -16);
  vue.add(rueLumiere2);
}
