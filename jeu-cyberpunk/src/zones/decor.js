import * as THREE from 'three';

// Petits outils de décor partagés par les zones (géométrie simple, matériaux).

/** Boîte de taille (w, h, d) posée par son centre en (x, y, z), ajoutée à `parent`. */
export function boite(parent, w, h, d, mat, x, y, z, { ry = 0, collider = null } = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  parent.add(m);
  if (collider) collider.push(colliderDe(x, z, w, d, ry));
  return m;
}

/** Collider 2D (boîte au sol) d'un rectangle centré en (x, z) ; rotation de 90° gérée. */
export function colliderDe(x, z, w, d, ry = 0) {
  const tourne = Math.abs(Math.sin(ry)) > 0.7;
  const hw = (tourne ? d : w) / 2;
  const hd = (tourne ? w : d) / 2;
  return { minX: x - hw, maxX: x + hw, minZ: z - hd, maxZ: z + hd };
}

/**
 * Sceau de Mima : anneau traversé d'une ligne (bible §2.1), sur fond transparent.
 * Cyan : c'est la seule couleur réservée à Mima.
 */
export function sceauTexture(couleur = '#5ef2ff', taille = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = taille;
  const g = c.getContext('2d');
  const r = taille * 0.34;
  g.translate(taille / 2, taille / 2);
  g.strokeStyle = couleur;
  g.shadowColor = couleur;
  g.shadowBlur = taille * 0.06;
  g.lineWidth = taille * 0.045;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = taille * 0.03;
  g.rotate(-0.3);
  g.beginPath();
  g.moveTo(-r * 1.3, 0);
  g.lineTo(r * 1.3, 0);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Matériau du sceau, qui « respire » : appeler `respirer(mat, t)` à chaque image. */
export function materiauSceau(couleur) {
  return new THREE.MeshBasicMaterial({
    map: sceauTexture(couleur),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
}

export function respirer(mat, t, vitesse = 1) {
  mat.opacity = 0.62 + 0.38 * Math.sin(t * 1.15 * vitesse) ** 2;
}

/** Vitre ruisselante : gouttes et coulures animées (uniform `time`). */
export function materiauVitrePluie({ teinte = new THREE.Color(0.75, 0.68, 1.0), opacite = 0.08 } = {}) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { time: { value: 0 }, teinte: { value: teinte }, opacite: { value: opacite } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float time; uniform vec3 teinte; uniform float opacite;
      varying vec2 vUv;
      float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        // gouttes immobiles
        vec2 g = vUv * vec2(46.0, 26.0);
        vec2 id = floor(g); vec2 f = fract(g);
        float r = h(id);
        float goutte = step(0.82, r) * smoothstep(0.22, 0.05, length(f - vec2(0.5, 0.35 + 0.3 * r)));
        // coulures qui descendent
        float col = floor(vUv.x * 120.0);
        float rc = h(vec2(col, 7.0));
        float y = fract(vUv.y * (0.6 + rc) + time * (0.12 + rc * 0.3) + rc * 13.0);
        float largeur = smoothstep(0.5, 0.15, abs(fract(vUv.x * 120.0) - 0.5));
        float coulure = step(0.86, rc) * largeur * smoothstep(0.0, 0.04, y) * smoothstep(0.35, 0.05, y);
        float a = opacite + goutte * 0.35 + coulure * 0.28;
        gl_FragColor = vec4(teinte * (0.6 + goutte + coulure), a);
      }`,
  });
}
