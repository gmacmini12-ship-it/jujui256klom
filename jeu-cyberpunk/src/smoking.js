import * as THREE from 'three';

// Mécanique de la cigarette (touche F).
//  - main/cigarette : géométrie simple attachée à la caméra (espace caméra)
//  - fumée : pool fixe d'instances billboard en espace monde (une seule draw call)

const MAX_PUFFS = 10;
const IDLE_TIMEOUT = 40;
const POOL = 220;

// ---------- Utilitaires ----------
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const ease = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const lerp = (a, b, k) => a + (b - a) * k;
const seg = (t, a, b) => clamp01((t - a) / (b - a));

// Texture de fumée générée par canvas : nuage bruité, quantifié en paliers (pixel art).
function makeSmokeTexture() {
  const N = 64;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(N, N);
  const rnd = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
  const vnoise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return lerp(lerp(rnd(xi, yi), rnd(xi + 1, yi), u), lerp(rnd(xi, yi + 1), rnd(xi + 1, yi + 1), u), v);
  };
  const fbm = (x, y) => vnoise(x, y) * 0.55 + vnoise(x * 2.1, y * 2.1) * 0.3 + vnoise(x * 4.3, y * 4.3) * 0.15;
  const LV = 5;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = (x + 0.5) / N * 2 - 1, dy = (y + 0.5) / N * 2 - 1;
      const d = Math.hypot(dx, dy);
      const n = fbm(x * 0.11 + 3.1, y * 0.11 + 7.7);
      let a = clamp01(1 - d * (0.95 + (n - 0.5) * 0.9)) ; // bord irrégulier
      a = Math.pow(a, 0.8);
      a = Math.floor(a * LV + 0.5) / LV;
      const shade = Math.floor(clamp01(0.45 + n * 0.8 - d * 0.35) * 4 + 0.5) / 4;
      const i = (y * N + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(shade * 255);
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

export function createSmoking(camera, scene) {
  // =====================================================================
  // Fumée (monde)
  // =====================================================================
  const aPos = new THREE.InstancedBufferAttribute(new Float32Array(POOL * 3), 3);
  const aData = new THREE.InstancedBufferAttribute(new Float32Array(POOL * 4), 4); // âge, taille, graine, alpha
  aPos.setUsage(THREE.DynamicDrawUsage);
  aData.setUsage(THREE.DynamicDrawUsage);
  const quad = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.getAttribute('position'));
  geo.setAttribute('uv', quad.getAttribute('uv'));
  geo.setAttribute('aPos', aPos);
  geo.setAttribute('aData', aData);
  geo.instanceCount = POOL;

  const smokeMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    uniforms: {
      map: { value: makeSmokeTexture() },
      uEmber: { value: new THREE.Vector4(0, 0, 0, 0) }, // xyz position monde, w intensité
    },
    vertexShader: /* glsl */ `
      attribute vec3 aPos; attribute vec4 aData;
      varying vec2 vUv; varying vec4 vD; varying vec3 vW; varying float vDist;
      void main() {
        vec4 mv = viewMatrix * vec4(aPos, 1.0);
        float ang = aData.z * 6.2831 + aData.x * (aData.z - 0.5) * 1.6;
        float c = cos(ang), s = sin(ang);
        vec2 p = vec2(c * position.x - s * position.y, s * position.x + c * position.y);
        mv.xy += p * aData.y;
        vUv = uv; vD = aData; vW = aPos; vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map; uniform vec4 uEmber;
      varying vec2 vUv; varying vec4 vD; varying vec3 vW; varying float vDist;
      void main() {
        vec4 tx = texture2D(map, vUv);
        float a = tx.a * vD.w * smoothstep(0.15, 0.9, vDist);
        if (a < 0.02) discard;
        // teinte ville : violet -> rose -> bleu électrique selon la graine et l'âge
        vec3 violet = vec3(0.36, 0.16, 0.72);
        vec3 pink   = vec3(0.95, 0.30, 0.70);
        vec3 blue   = vec3(0.22, 0.42, 1.00);
        vec3 col = mix(violet, pink, smoothstep(0.2, 0.8, vD.z));
        col = mix(col, blue, smoothstep(0.55, 1.0, vD.x) * 0.55);
        col *= 0.25 + tx.r * 0.55;
        float d = distance(vW, uEmber.xyz);
        col += vec3(1.0, 0.38, 0.16) * uEmber.w * 1.4 / (1.0 + d * d * 6.0) * tx.r;
        gl_FragColor = vec4(col, a);
      }`,
  });
  const smoke = new THREE.Mesh(geo, smokeMat);
  smoke.frustumCulled = false;
  smoke.renderOrder = 5;
  scene.add(smoke);

  // pool : état CPU
  const P = {
    alive: new Uint8Array(POOL),
    age: new Float32Array(POOL),
    life: new Float32Array(POOL),
    x: new Float32Array(POOL), y: new Float32Array(POOL), z: new Float32Array(POOL),
    vx: new Float32Array(POOL), vy: new Float32Array(POOL), vz: new Float32Array(POOL),
    s0: new Float32Array(POOL), s1: new Float32Array(POOL),
    seed: new Float32Array(POOL), alpha: new Float32Array(POOL),
    drag: new Float32Array(POOL), lift: new Float32Array(POOL), kind: new Uint8Array(POOL),
  };
  let cursor = 0;
  function spawn(x, y, z, vx, vy, vz, life, s0, s1, alpha, drag, lift, kind) {
    // recycle : cherche une place libre, sinon écrase la plus ancienne (curseur circulaire)
    let i = -1;
    for (let k = 0; k < POOL; k++) {
      const j = (cursor + k) % POOL;
      if (!P.alive[j]) { i = j; break; }
    }
    if (i < 0) i = cursor;
    cursor = (i + 1) % POOL;
    P.alive[i] = 1; P.age[i] = 0; P.life[i] = life;
    P.x[i] = x; P.y[i] = y; P.z[i] = z; P.vx[i] = vx; P.vy[i] = vy; P.vz[i] = vz;
    P.s0[i] = s0; P.s1[i] = s1; P.seed[i] = Math.random(); P.alpha[i] = alpha;
    P.drag[i] = drag; P.lift[i] = lift; P.kind[i] = kind;
  }

  function updateSmoke(dt, t) {
    const pa = aPos.array, da = aData.array;
    for (let i = 0; i < POOL; i++) {
      if (!P.alive[i]) { da[i * 4 + 3] = 0; da[i * 4 + 1] = 0; continue; }
      P.age[i] += dt;
      const u = P.age[i] / P.life[i];
      if (u >= 1) { P.alive[i] = 0; da[i * 4 + 3] = 0; da[i * 4 + 1] = 0; continue; }
      const k = Math.exp(-P.drag[i] * dt);
      P.vx[i] *= k; P.vy[i] *= k; P.vz[i] *= k;
      P.vy[i] += P.lift[i] * dt;
      // léger tourbillon
      const sw = Math.sin(t * 1.3 + P.seed[i] * 40) * (P.kind[i] === 1 ? 0.22 : 0.08) * dt;
      P.vx[i] += sw; P.vz[i] += Math.cos(t * 1.1 + P.seed[i] * 31) * sw;
      P.x[i] += P.vx[i] * dt; P.y[i] += P.vy[i] * dt; P.z[i] += P.vz[i] * dt;
      const size = lerp(P.s0[i], P.s1[i], 1 - (1 - u) * (1 - u));
      const env = Math.min(ease(u / 0.12), 1 - ease((u - 0.45) / 0.55));
      pa[i * 3] = P.x[i]; pa[i * 3 + 1] = P.y[i]; pa[i * 3 + 2] = P.z[i];
      da[i * 4] = u; da[i * 4 + 1] = size; da[i * 4 + 2] = P.seed[i]; da[i * 4 + 3] = env * P.alpha[i];
    }
    aPos.needsUpdate = true;
    aData.needsUpdate = true;
  }

  // =====================================================================
  // Main + cigarette (espace caméra)
  // =====================================================================
  const skin = new THREE.MeshLambertMaterial({ color: 0xe0b09c, emissive: 0x5a3038 });
  const sleeveMat = new THREE.MeshLambertMaterial({ color: 0x120e1c, emissive: 0x070310 });
  const cuffMat = new THREE.MeshLambertMaterial({ color: 0x1d1730, emissive: 0x0c0620 });
  const paperMat = new THREE.MeshLambertMaterial({ color: 0xe8e0f0, emissive: 0x3a3050 });
  const filterMat = new THREE.MeshLambertMaterial({ color: 0xd9a35c, emissive: 0x401c08 });
  const ashMat = new THREE.MeshLambertMaterial({ color: 0x8c8794, emissive: 0x2a2630 });
  const emberMat = new THREE.MeshBasicMaterial({ color: 0xff5a20, toneMapped: false, fog: false });
  const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.5, 0.5), toneMapped: false, fog: false });
  const metalMat = new THREE.MeshLambertMaterial({ color: 0x9aa0c0, emissive: 0x1a2040 });
  for (const m of [skin, sleeveMat, cuffMat, paperMat, filterMat, ashMat, metalMat]) m.fog = false;

  const box = new THREE.BoxGeometry(1, 1, 1);
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 8);
  cyl.rotateX(Math.PI / 2); // axe le long de z
  const cone = new THREE.ConeGeometry(1, 1, 6);

  const mesh = (g, m, sx, sy, sz, x, y, z, parent) => {
    const o = new THREE.Mesh(g, m);
    o.scale.set(sx, sy, sz); o.position.set(x, y, z);
    o.frustumCulled = false;
    parent.add(o);
    return o;
  };

  // Cigarette : filtre à l'origine, corps vers -z, braise au bout.
  const R = 0.007, FIL = 0.026, L0 = 0.088;
  function buildCig() {
    const g = new THREE.Group();
    mesh(cyl, filterMat, R, R, FIL, 0, 0, -FIL / 2, g);
    const body = mesh(cyl, paperMat, R, R, 1, 0, 0, 0, g);
    const ash = mesh(cyl, ashMat, R * 1.02, R * 1.02, 0.006, 0, 0, 0, g);
    const ember = mesh(cyl, emberMat, R * 1.05, R * 1.05, 0.005, 0, 0, 0, g);
    const tip = new THREE.Object3D();
    g.add(tip);
    const set = (len) => {
      const bl = len - FIL;
      body.scale.z = bl; body.position.z = -FIL - bl / 2;
      ember.position.z = -len - 0.001;
      ash.position.z = -len + 0.0055;
      tip.position.z = -len - 0.004;
    };
    set(L0);
    return { group: g, body, ash, ember, tip, set };
  }

  const hand = new THREE.Group(); // origine = point de pincement du filtre
  hand.visible = false;
  hand.rotation.order = 'YXZ';
  hand.scale.setScalar(1.7);
  camera.add(hand);
  const cig = buildCig();
  hand.add(cig.group);
  // main : paume + doigts pincés + pouce + avant-bras avec manche de sweat
  mesh(box, skin, 0.052, 0.034, 0.07, 0.012, -0.012, 0.06, hand); // paume
  mesh(box, skin, 0.014, 0.014, 0.04, 0.004, 0.002, 0.012, hand); // index (dessus)
  mesh(box, skin, 0.014, 0.014, 0.04, 0.004, -0.014, 0.012, hand); // majeur
  mesh(box, skin, 0.013, 0.013, 0.03, -0.014, -0.006, 0.03, hand).rotation.y = 0.5; // pouce
  mesh(box, skin, 0.014, 0.014, 0.03, 0.02, -0.03, 0.02, hand).rotation.x = 0.3; // annulaire replié
  const wrist = mesh(box, cuffMat, 0.062, 0.05, 0.03, 0.012, -0.012, 0.11, hand); // poignet de manche
  const sleeve = mesh(cyl, sleeveMat, 0.056, 0.05, 0.5, 0.012, -0.012, 0.38, hand);
  sleeve.scale.set(0.075, 0.065, 0.5);
  void wrist;

  // briquet (visible pendant l'allumage)
  const lighter = new THREE.Group();
  lighter.visible = false;
  hand.add(lighter);
  mesh(box, metalMat, 0.012, 0.03, 0.01, 0, 0, 0, lighter);
  const flame = mesh(cone, flameMat, 0.007, 0.024, 0.007, 0, 0.026, 0, lighter);
  lighter.position.set(0, -0.012, -L0 - 0.022);

  // lumière de braise (toujours présente : pas de recompilation de shaders en cours de jeu)
  const light = new THREE.PointLight(0xff5a30, 0, 5, 2);
  camera.add(light);
  const tmpV = new THREE.Vector3();

  // mégot jeté
  const stub = buildCig();
  stub.set(0.04);
  stub.group.visible = false;
  stub.group.rotation.order = 'YXZ';
  scene.add(stub.group);
  const stubS = { on: false, age: 0, v: new THREE.Vector3(), spin: 0 };

  // poses (espace caméra)
  const POSE = {
    off:  { p: [0.4, -0.6, -0.5], r: [0.5, 0.85, -0.25] },
    rest: { p: [0.17, -0.15, -0.5], r: [0.5, 0.85, -0.25] },
    light: { p: [0.09, -0.1, -0.46], r: [0.55, 0.7, -0.2] },
    mouth: { p: [0.05, -0.05, -0.32], r: [0.8, 0.45, -0.2] },
  };
  const cur = { p: new THREE.Vector3(), r: [0, 0, 0] };
  function applyPose(a, b, k, extra) {
    k = ease(k);
    cur.p.set(lerp(a.p[0], b.p[0], k), lerp(a.p[1], b.p[1], k), lerp(a.p[2], b.p[2], k));
    cur.r[0] = lerp(a.r[0], b.r[0], k); cur.r[1] = lerp(a.r[1], b.r[1], k); cur.r[2] = lerp(a.r[2], b.r[2], k);
    if (extra) cur.p.add(extra);
  }

  // =====================================================================
  // Machine à états
  // =====================================================================
  let clock = 0;
  let state = 'idle'; // idle | lighting | hold | puff | discard
  let st = 0;         // temps dans l'état
  let puffs = 0;
  let lastPress = 0;
  let glow = 0;       // intensité de la braise (0..1.5)
  let wispAcc = 0;
  let exhaleAcc = 0;
  let exhaleLeft = 0;
  let cigLen = L0;
  let from = POSE.off;

  const PUFF = { raise: 0.5, draw: 0.9, lower: 0.55, exhaleStart: 1.55, exhaleDur: 1.0 };
  const PUFF_T = PUFF.raise + PUFF.draw + PUFF.lower;

  function go(s) { state = s; st = 0; }

  function trigger() {
    lastPress = clock;
    if (state === 'idle' || state === 'discard') {
      if (state === 'discard') killHeld();
      puffs = 0; cigLen = L0; cig.set(cigLen); cig.group.visible = true;
      cig.ember.visible = true;
      hand.visible = true;
      from = POSE.off; glow = 0; lighter.visible = true;
      go('lighting');
    } else if (state === 'hold') {
      go('puff');
    }
  }
  function killHeld() { /* rien à libérer : la main est simplement réinitialisée */ }

  function discard() {
    // la cigarette part en petit mégot incandescent
    cig.tip.getWorldPosition(tmpV);
    stub.group.position.copy(tmpV);
    stub.group.rotation.set(Math.random() * 1.5, Math.random() * 6, 0);
    stub.set(Math.max(0.03, cigLen * 0.6));
    stub.group.visible = true;
    const d = new THREE.Vector3(0.7, -0.5, -0.9).transformDirection(camera.matrixWorld);
    stubS.v.copy(d).multiplyScalar(1.4); stubS.v.y += 0.8;
    stubS.on = true; stubS.age = 0; stubS.spin = (Math.random() - 0.5) * 12;
    cig.group.visible = false;
    from = cur;
    go('discard');
  }

  const fwd = new THREE.Vector3(), up = new THREE.Vector3(), rgt = new THREE.Vector3(), mp = new THREE.Vector3();

  function emitExhale(n) {
    camera.updateMatrixWorld();
    camera.getWorldDirection(fwd);
    rgt.set(1, 0, 0).transformDirection(camera.matrixWorld);
    up.set(0, 1, 0).transformDirection(camera.matrixWorld);
    mp.set(0, -0.1, -0.2).applyMatrix4(camera.matrixWorld);
    for (let i = 0; i < n; i++) {
      const sp = 0.35 + Math.random() * 0.3;
      const sp2 = 1.6 + Math.random() * 1.3;
      spawn(
        mp.x + (Math.random() - 0.5) * 0.08, mp.y + (Math.random() - 0.5) * 0.06, mp.z + (Math.random() - 0.5) * 0.08,
        fwd.x * sp2 + rgt.x * (Math.random() - 0.5) * sp + up.x * 0.25,
        fwd.y * sp2 + (Math.random() - 0.3) * sp * 0.6 + 0.2,
        fwd.z * sp2 + rgt.z * (Math.random() - 0.5) * sp + up.z * 0.25,
        3.4 + Math.random() * 2.0, 0.2 + Math.random() * 0.12, 1.0 + Math.random() * 0.7,
        0.16 + Math.random() * 0.1, 1.5, 0.28, 0,
      );
    }
  }

  function emitWisp() {
    cig.tip.getWorldPosition(tmpV);
    spawn(
      tmpV.x + (Math.random() - 0.5) * 0.01, tmpV.y, tmpV.z + (Math.random() - 0.5) * 0.01,
      (Math.random() - 0.5) * 0.04, 0.2 + Math.random() * 0.08, (Math.random() - 0.5) * 0.04,
      2.6 + Math.random() * 1.0, 0.03, 0.1 + Math.random() * 0.05,
      0.4, 0.5, 0.08, 1,
    );
  }

  function update(dt, t) {
    clock += dt;
    st += dt;
    camera.updateMatrixWorld();

    let target = 0; // braise cible
    let extra = null;

    if (state === 'lighting') {
      const T = 1.9;
      if (st < 0.7) applyPose(from, POSE.light, st / 0.7);
      else applyPose(POSE.light, POSE.rest, seg(st, 1.2, T));
      // flamme du briquet
      const lit = st > 0.45 && st < 1.2;
      lighter.visible = st < 1.35;
      flame.visible = lit;
      const fl = lit ? 0.85 + Math.sin(st * 60) * 0.15 + Math.random() * 0.2 : 0;
      flame.scale.set(0.011 * fl, 0.04 * fl, 0.011 * fl);
      if (lit) {
        // éclat bref : la lumière monte puis la braise s'allume
        const ig = seg(st, 0.85, 1.2);
        target = ig * 1.1;
        glow = Math.max(glow, ig * 0.9);
        lighter.getWorldPosition(tmpV);
        tmpV.y += 0.03;
        light.position.copy(camera.worldToLocal(tmpV.clone()));
        light.color.setHex(0xffa040);
        light.intensity = 0.9 * fl * seg(st, 0.45, 0.6);
      } else {
        target = st > 1.2 ? 0.35 : 0;
      }
      if (st >= T) { light.color.setHex(0xff5a30); go('hold'); }
      if (st > 1.2 && st < 1.3) { // première volute à l'allumage
        for (let i = 0; i < 2; i++) emitWisp();
      }
    } else if (state === 'hold') {
      applyPose(POSE.rest, POSE.rest, 1);
      target = 0.3;
      // petit balancement de respiration
      cur.p.y += Math.sin(clock * 1.4) * 0.003;
      cur.p.x += Math.sin(clock * 0.9) * 0.002;
      if (clock - lastPress > IDLE_TIMEOUT) discard();
    } else if (state === 'puff') {
      const a = PUFF.raise, b = PUFF.raise + PUFF.draw;
      if (st < a) applyPose(POSE.rest, POSE.mouth, st / a);
      else if (st < b) applyPose(POSE.mouth, POSE.mouth, 1);
      else applyPose(POSE.mouth, POSE.rest, (st - b) / PUFF.lower);
      // braise : monte pendant l'aspiration, redescend ensuite
      target = 0.3 + 1.2 * ease(seg(st, a * 0.7, a + 0.25)) * (1 - 0.8 * ease(seg(st, b, b + 0.5)));
      if (st >= PUFF.raise + PUFF.draw && exhaleLeft <= 0 && !puff.exhaled) {
        puff.exhaled = true; exhaleLeft = PUFF.exhaleDur;
      }
      if (st >= PUFF_T) {
        puffs++;
        cigLen = Math.max(0.05, L0 * (1 - 0.07 * puffs));
        cig.set(cigLen);
        puff.exhaled = false;
        if (puffs >= MAX_PUFFS) discard(); else go('hold');
      }
    } else if (state === 'discard') {
      applyPose(from === cur ? POSE.rest : POSE.rest, POSE.off, seg(st, 0.1, 0.7));
      if (st >= 0.8) hand.visible = false;
      target = 0;
      if (st > 3.2 && !stubS.on) go('idle');
    }

    // main
    if (state !== 'idle') {
      hand.position.copy(cur.p);
      hand.rotation.set(cur.r[0], cur.r[1], cur.r[2]);
    }

    // exhale continu (en dehors de l'état pour qu'il survive au retour en 'hold')
    if (exhaleLeft > 0) {
      exhaleLeft -= dt;
      exhaleAcc += dt * 30;
      const n = Math.floor(exhaleAcc); exhaleAcc -= n;
      if (n > 0) emitExhale(n);
    }

    // braise lissée + scintillement
    const flick = 1 + (Math.sin(clock * 23) * 0.08 + Math.sin(clock * 9.1) * 0.06);
    glow += (target - glow) * Math.min(1, dt * (target > glow ? 14 : 3.5));
    if (state === 'idle') glow = 0;
    const hot = glow * flick;
    emberMat.color.setRGB(1.0 + hot * 2.2, 0.22 + hot * 0.9, 0.05 + hot * 0.25).multiplyScalar(state === 'idle' ? 0 : 1);
    cig.ember.scale.set(R * 1.05, R * 1.05, 0.004 + 0.003 * hot);
    if (state !== 'lighting') {
      light.position.copy(cig.tip.getWorldPosition(tmpV) && camera.worldToLocal(tmpV.clone()));
      light.position.z += 0.02;
      light.intensity = hand.visible ? hot * hot * 0.3 + hot * 0.03 : 0;
      light.color.setRGB(1.0, 0.33 + hot * 0.1, 0.38 - hot * 0.1);
    }

    // fumée continue de la braise
    if (hand.visible && state !== 'discard' && state !== 'lighting') {
      wispAcc += dt * (state === 'puff' && st > 0.5 ? 4 : 11);
      while (wispAcc >= 1) { wispAcc -= 1; emitWisp(); }
      cig.tip.getWorldPosition(tmpV);
      smokeMat.uniforms.uEmber.value.set(tmpV.x, tmpV.y, tmpV.z, hot);
    } else if (!stubS.on) {
      smokeMat.uniforms.uEmber.value.w = 0;
    }

    // mégot en chute
    if (stubS.on) {
      stubS.age += dt;
      stubS.v.y -= 9.8 * dt;
      const g = stub.group;
      g.position.addScaledVector(stubS.v, dt);
      g.rotateX(stubS.spin * dt);
      if (g.position.y < 0.02) {
        g.position.y = 0.02;
        stubS.v.y *= -0.3; stubS.v.x *= 0.5; stubS.v.z *= 0.5; stubS.spin *= 0.4;
      }
      const k = Math.max(0, 1 - stubS.age / 2.6);
      if (Math.random() < dt * 14 * k) {
        stub.tip.getWorldPosition(tmpV);
        spawn(tmpV.x, tmpV.y, tmpV.z, 0, 0.2, 0, 1.6, 0.03, 0.14, 0.4, 0.5, 0.1, 1);
      }
      smokeMat.uniforms.uEmber.value.set(g.position.x, g.position.y, g.position.z, k * 0.8);
      emberMat.color.setRGB(1 + k * 1.5, 0.2 + k * 0.5, 0.05);
      if (stubS.age > 2.6) { stubS.on = false; g.visible = false; smokeMat.uniforms.uEmber.value.w = 0; }
    }

    updateSmoke(dt, t);
  }
  const puff = { exhaled: false };

  return { trigger, update };
}
