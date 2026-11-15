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
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, levels: { value: 14 }, sourdine: { value: 0 }, halo: { value: 0 }, ondulation: { value: 0 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float time; uniform float levels; uniform float sourdine; uniform float halo; uniform float ondulation;
    varying vec2 vUv;
    void main() {
      vec2 d = vUv - 0.5;
      vec2 off = d * dot(d, d) * 0.012;
      // Air chaud (Kura ; 0 = rendu inchangé) : l'image ondule, surtout vers l'horizon
      vec2 uv = vUv;
      if (ondulation > 0.0) {
        float bande = 0.35 + 0.65 * exp(-pow((vUv.y - 0.5) / 0.3, 2.0));
        uv += vec2(sin(vUv.y * 60.0 + time * 2.2) * 0.0042 + sin(vUv.y * 23.0 - time * 1.3) * 0.0025,
                   cos(vUv.x * 41.0 + time * 1.7) * 0.0022) * ondulation * bande;
      }
      vec3 col = vec3(
        texture2D(tDiffuse, uv + off).r,
        texture2D(tDiffuse, uv).g,
        texture2D(tDiffuse, uv - off).b
      );
      // Sourdine (0 = rendu inchangé) : vignette plus serrée
      col *= smoothstep(0.95 - 0.22 * sourdine, 0.3, length(d));
      // étalonnage : ombres indigo, tons moyens violets, hautes lumières roses
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      vec3 sh = vec3(0.05, 0.015, 0.14);
      vec3 mid = vec3(0.5, 0.16, 0.92);
      vec3 hi = vec3(1.0, 0.72, 0.99);
      vec3 duo = lum < 0.5 ? mix(sh, mid, lum * 2.0) : mix(mid, hi, lum * 2.0 - 1.0);
      col = mix(col, duo, 0.42 * (1.0 - 0.5 * sourdine));
      // Sourdine : couleurs désaturées, la ville « brute »
      col = mix(col, vec3(dot(col, vec3(0.299, 0.587, 0.114))), 0.55 * sourdine);
      // Halo du Sceau (fin « Rester », 0 = rendu inchangé) : couleurs réchauffées, vignette rose-violet
      if (halo > 0.0) {
        col = mix(col, col * vec3(1.2, 0.93, 0.82) + vec3(0.04, 0.015, 0.0), halo * 0.75);
        float bord = smoothstep(0.18, 0.72, length(d));
        col += vec3(0.8, 0.22, 0.92) * bord * bord * halo * 0.85;
      }
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
// `accompagnement(niveau, duree)` : niveau 1 = ville « accompagnée » (nappe + pluie voilée), 0 = ville brute
// (nappe coupée en `duree` s, pluie plus présente, filtre ouvert) : la Sourdine (bible §4.3).
// `ronflement(volume, duree)` : couche grave de Kura (0 = absente, rien n'est créé ni changé ; 0,15 = fort), fondue en `duree` s.
// `tonalite({ de, vers, duree, volume, type })`, `souffle({ de, vers, duree, volume, q })` : sons brefs des pouvoirs.
const ACCORDS = { defaut: [55, 55.35, 82.4, 110.3], majeur: [55, 69.3, 82.4, 138.6] };
export function createAudio() {
  let ctx = null;
  let master = null;
  let filtre = null;
  let rainGain = null;
  let droneGain = null;
  let muted = false;
  let accordNom = 'defaut'; // accord de la nappe (voir accord())
  const droneOsc = [];
  let droneFiltre = null;
  let accomp = 1; // niveau de la couche « accompagnée » (Sourdine : 0)
  const reglage = { pluie: 0.07, filtre: 20000 };
  const NAPPE = 0.09; // volume de la nappe grave
  let ronflVol = 0; // couche de ronflement (Kura) : volume voulu
  let ronflGain = null;
  // valeurs effectives : la ville brute a une pluie plus présente (×1,6) et un filtre ouvert
  const pluieEff = () => reglage.pluie * (1 + 0.6 * (1 - accomp));
  const filtreEff = () => reglage.filtre + (20000 - reglage.filtre) * (1 - accomp);
  function start() {
    if (ctx) return ctx.resume();
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.6;
    filtre = ctx.createBiquadFilter();
    filtre.type = 'lowpass';
    filtre.frequency.value = filtreEff();
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
    rainGain.gain.value = pluieEff();
    noise.connect(hp).connect(rainGain).connect(filtre);
    noise.start();

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 240;
    droneGain = ctx.createGain();
    droneGain.gain.value = NAPPE * accomp;
    lp.connect(droneGain).connect(filtre);
    droneFiltre = lp;
    lp.frequency.value = accordNom === 'majeur' ? 420 : 240;
    for (const f of ACCORDS[accordNom]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      droneOsc.push(o);
      o.connect(lp);
      o.start();
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 110;
    lfo.connect(lfoGain).connect(lp.frequency);
    lfo.start();
    if (ronflVol > 0) creerRonflement();
  }
  // Ronflement des baies : bruit brun très filtré + deux sinus graves qui battent lentement. Créé au premier besoin.
  function creerRonflement() {
    if (!ctx || ronflGain) return;
    ronflGain = ctx.createGain();
    ronflGain.gain.value = 0;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let acc = 0;
    for (let i = 0; i < data.length; i++) { acc = (acc + (Math.random() * 2 - 1) * 0.04) / 1.02; data[i] = acc * 9; }
    const bruit = ctx.createBufferSource();
    bruit.buffer = buf;
    bruit.loop = true;
    const lpR = ctx.createBiquadFilter();
    lpR.type = 'lowpass';
    lpR.frequency.value = 110;
    bruit.connect(lpR).connect(ronflGain);
    bruit.start();
    for (const [f, g] of [[41, 0.8], [41.7, 0.6], [82.4, 0.25]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = g;
      o.connect(og).connect(ronflGain);
      o.start();
    }
    ronflGain.connect(filtre);
  }
  function ronflement(volume = 0, duree = 1.5) {
    ronflVol = Math.max(0, volume);
    if (!ctx) return;
    if (ronflVol > 0) creerRonflement();
    if (!ronflGain) return;
    const t = ctx.currentTime;
    ronflGain.gain.cancelScheduledValues(t);
    ronflGain.gain.setTargetAtTime(ronflVol, t, Math.max(0.05, duree) / 3);
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
    rainGain.gain.setTargetAtTime(pluieEff(), t, duree / 3);
    filtre.frequency.cancelScheduledValues(t);
    filtre.frequency.setTargetAtTime(filtreEff(), t, duree / 3);
  }
  // Couche « accompagnée » : 1 = normale, 0 = coupée (nappe muette, pluie brute). Le réglage de zone reste respecté.
  function accompagnement(niveau = 1, duree = 0.5) {
    accomp = Math.max(0, Math.min(1, niveau));
    if (!ctx) return;
    const t = ctx.currentTime;
    const k = Math.max(0.01, duree) / 3;
    droneGain.gain.cancelScheduledValues(t);
    droneGain.gain.setTargetAtTime(NAPPE * accomp, t, k);
    rainGain.gain.cancelScheduledValues(t);
    rainGain.gain.setTargetAtTime(pluieEff(), t, k);
    filtre.frequency.cancelScheduledValues(t);
    filtre.frequency.setTargetAtTime(filtreEff(), t, k);
  }
  // Accord de la nappe : 'defaut' (quinte grave, un peu désaccordée) ou 'majeur' (fin « Rester » : la nappe se résout).
  // Les oscillateurs glissent vers l'accord en `duree` s ; le filtre de la nappe s'ouvre un peu.
  function accord(nom = 'defaut', duree = 4) {
    if (!ACCORDS[nom]) return;
    accordNom = nom;
    if (!ctx || !droneOsc.length) return;
    const t = ctx.currentTime;
    droneOsc.forEach((o, i) => {
      o.frequency.cancelScheduledValues(t);
      o.frequency.setValueAtTime(o.frequency.value, t);
      o.frequency.linearRampToValueAtTime(ACCORDS[nom][i], t + Math.max(0.05, duree));
    });
    droneFiltre.frequency.setTargetAtTime(nom === 'majeur' ? 420 : 240, t, Math.max(0.05, duree) / 3);
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
  // Tonalité glissée (pouvoirs) : de `de` à `vers` Hz en `duree` s. Passe par le filtre de zone.
  function tonalite({ de = 90, vers = 160, duree = 0.4, volume = 0.05, type = 'sine' } = {}) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(de, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, vers), t + duree);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(volume, t + Math.min(0.05, duree / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + duree);
    o.connect(g).connect(filtre);
    o.start(t);
    o.stop(t + duree + 0.05);
  }
  // Souffle (bruit filtré dont la fréquence glisse de `de` à `vers` Hz), pour une impulsion, un impact.
  function souffle({ de = 300, vers = 1800, duree = 0.35, volume = 0.12, q = 1.2 } = {}) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const n = Math.ceil(ctx.sampleRate * (duree + 0.05));
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = q;
    bp.frequency.setValueAtTime(de, t);
    bp.frequency.exponentialRampToValueAtTime(Math.max(20, vers), t + duree);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(volume, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duree);
    src.connect(bp).connect(g).connect(filtre);
    src.start(t);
    src.stop(t + duree + 0.05);
  }
  return {
    start,
    toggle,
    regler,
    accompagnement,
    ronflement,
    accord,
    bip,
    tonalite,
    souffle,
    get demarre() { return !!ctx; },
    get coupe() { return muted; },
    get accordActuel() { return accordNom; },
    /** Diagnostic (tests) : fréquences courantes des oscillateurs de la nappe. */
    get frequencesNappe() { return droneOsc.map((o) => +o.frequency.value.toFixed(2)); },
    get niveauAccompagnement() { return accomp; },
    get ronflementActuel() { return ronflGain ? ronflGain.gain.value : 0; },
    /** Diagnostic (tests) : gains courants de la nappe, de la pluie et fréquence du filtre. */
    get diagnostic() { return ctx ? { nappe: droneGain.gain.value, pluie: rainGain.gain.value, filtre: filtre.frequency.value, accomp } : { accomp }; },
  };
}
