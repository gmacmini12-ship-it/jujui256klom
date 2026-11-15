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
      void main() { gl_FragColor = vec4(0.62, 0.74, 1.0, vAlpha); }`,
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

// Passe finale : aberration chromatique légère, vignette et grain.
export const FilmShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float time;
    varying vec2 vUv;
    void main() {
      vec2 d = vUv - 0.5;
      vec2 off = d * dot(d, d) * 0.012;
      vec3 col = vec3(
        texture2D(tDiffuse, vUv + off).r,
        texture2D(tDiffuse, vUv).g,
        texture2D(tDiffuse, vUv - off).b
      );
      col *= smoothstep(0.9, 0.3, length(d));
      float n = fract(sin(dot(vUv * 800.0 + time, vec2(12.9898, 78.233))) * 43758.5453);
      col += (n - 0.5) * 0.018;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

// Ambiance sonore synthétisée : pluie + nappe grave. Aucun fichier audio.
export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;
  function start() {
    if (ctx) return ctx.resume();
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.6;
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
    const rainGain = ctx.createGain();
    rainGain.gain.value = 0.07;
    noise.connect(hp).connect(rainGain).connect(master);
    noise.start();

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 240;
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.09;
    lp.connect(droneGain).connect(master);
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
  return { start, toggle };
}
