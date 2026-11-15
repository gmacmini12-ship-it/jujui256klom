import * as THREE from 'three';

// Pluie : les gouttes sont recyclées autour de la caméra directement dans le shader.
export function createRain(count = 9000) {
  const BOX = 70;
  const HEIGHT = 45;
  const positions = new Float32Array(count * 6);
  const ends = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const x = Math.random() * BOX;
    const y = Math.random() * HEIGHT;
    const z = Math.random() * BOX;
    positions.set([x, y, z, x, y, z], i * 6);
    ends[i * 2 + 1] = 1;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('end', new THREE.BufferAttribute(ends, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { time: { value: 0 }, cam: { value: new THREE.Vector3() } },
    vertexShader: /* glsl */ `
      uniform float time; uniform vec3 cam;
      attribute float end;
      varying float vAlpha;
      void main() {
        vec3 p = position;
        float speed = 26.0 + fract(p.x * 7.13 + p.z * 3.7) * 12.0;
        p.y = mod(p.y - time * speed, ${HEIGHT.toFixed(1)}) + end * 0.9;
        p.x = mod(p.x - cam.x, ${BOX.toFixed(1)}) - ${(BOX / 2).toFixed(1)} + cam.x + end * 0.05;
        p.z = mod(p.z - cam.z, ${BOX.toFixed(1)}) - ${(BOX / 2).toFixed(1)} + cam.z;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vAlpha = 0.24 * smoothstep(${(BOX / 2).toFixed(1)}, 6.0, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      void main() { gl_FragColor = vec4(0.78, 0.62, 1.0, vAlpha); }`,
  });
  const mesh = new THREE.LineSegments(geo, mat);
  mesh.frustumCulled = false;
  return {
    mesh,
    update(t, camera) {
      mat.uniforms.time.value = t;
      mat.uniforms.cam.value.copy(camera.position);
    },
  };
}

// Passe finale, en espace écran : aberration chromatique, vignette, étalonnage violet
// et réduction du nombre de teintes avec tramage (rendu « dessiné »).
export const FilmShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, levels: { value: 14 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float time; uniform float levels;
    varying vec2 vUv;
    void main() {
      vec2 d = vUv - 0.5;
      vec2 off = d * dot(d, d) * 0.012;
      vec3 col = vec3(
        texture2D(tDiffuse, vUv + off).r,
        texture2D(tDiffuse, vUv).g,
        texture2D(tDiffuse, vUv - off).b
      );
      col *= smoothstep(0.95, 0.3, length(d));
      // étalonnage : ombres indigo, tons moyens violets, hautes lumières roses
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      vec3 sh = vec3(0.05, 0.015, 0.14);
      vec3 mid = vec3(0.5, 0.16, 0.92);
      vec3 hi = vec3(1.0, 0.72, 0.99);
      vec3 duo = lum < 0.5 ? mix(sh, mid, lum * 2.0) : mix(mid, hi, lum * 2.0 - 1.0);
      col = mix(col, duo, 0.42);
      // tramage ordonné 4x4 puis palette réduite
      ivec2 pi = ivec2(mod(gl_FragCoord.xy, 4.0));
      const float bayer[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
      float b = bayer[pi.x + pi.y * 4] / 16.0;
      col = floor(col * levels + b) / levels;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

// Ambiance sonore synthétisée : pluie + nappe grave. Aucun fichier audio.
// `regler({ pluie, filtre })` : volume de la pluie (0..1, 0.07 en ville) et
// fréquence de coupure du filtre général (Hz ; bas = « comme sous l'eau »).
// `bip()` : bip médical court (séquence d'ouverture).
export function createAudio() {
  let ctx = null;
  let master = null;
  let filtre = null;
  let rainGain = null;
  let muted = false;
  const reglage = { pluie: 0.07, filtre: 20000 };
  function start() {
    if (ctx) return ctx.resume();
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.6;
    filtre = ctx.createBiquadFilter();
    filtre.type = 'lowpass';
    filtre.frequency.value = reglage.filtre;
    filtre.connect(master);
    master.connect(ctx.destination);

    const buf = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1400;
    rainGain = ctx.createGain();
    rainGain.gain.value = reglage.pluie;
    noise.connect(hp).connect(rainGain).connect(filtre);
    noise.start();

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 240;
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.09;
    lp.connect(droneGain).connect(filtre);
    for (const f of [55, 55.35, 82.4, 110.3]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(lp);
      o.start();
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 110;
    lfo.connect(lfoGain).connect(lp.frequency);
    lfo.start();
  }
  function toggle() {
    muted = !muted;
    if (master) master.gain.value = muted ? 0 : 0.6;
  }
  function regler({ pluie, filtre: f, duree = 1.2 } = {}) {
    if (pluie !== undefined) reglage.pluie = pluie;
    if (f !== undefined) reglage.filtre = f;
    if (!ctx) return;
    const t = ctx.currentTime;
    rainGain.gain.cancelScheduledValues(t);
    rainGain.gain.setTargetAtTime(reglage.pluie, t, duree / 3);
    filtre.frequency.cancelScheduledValues(t);
    filtre.frequency.setTargetAtTime(reglage.filtre, t, duree / 3);
  }
  function bip({ frequence = 1046, duree = 0.16, volume = 0.12 } = {}) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = frequence;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(volume, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duree);
    o.connect(g).connect(master); // le bip n'est pas filtré : il est « dans la pièce »
    o.start(t);
    o.stop(t + duree + 0.05);
  }
  return {
    start,
    toggle,
    regler,
    bip,
    get demarre() { return !!ctx; },
    get coupe() { return muted; },
  };
}
