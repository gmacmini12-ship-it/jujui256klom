import { THREE, C, U, UE, E, cl, pr, mix, rnd, snd, P, setCam, mat, umat, box, cyl, ico, grp, pawn, stage, strand, drop, pop3, Tn, popH, tag, defScene, source, clipFrame, state } from '/web/engine.js';

const Q = Math.PI / 4;
const camPath = keys => t => { const c = { ...keys[0][1] }; for (let i = 1; i < keys.length; i++) { const k = E.io(pr(t, keys[i][0], keys[i][2] || .7)); for (const p in keys[i][1]) c[p] = mix(c[p], keys[i][1][p], k); } c.az = .035 * Math.sin(t * .55); return c; };
const setY = (o, y) => { o.visible = y !== null; if (y !== null) o.position.y = y; };
function sheet(parent) {
  const g = grp(parent); box(1.5, 1.9, .08, C.white, g).position.y = .95;
  [[-.42, .5, C.red], [0, .95, C.amber], [.42, .7, C.red]].forEach(([x, h, c]) => { const b = box(.28, h, .06, c, g); b.position.set(x, .3 + h / 2, .07); });
  g.rotation.y = Q; return g;
}
function urn(parent) {
  const g = grp(parent); box(2, 1.4, 1.5, C.white, g).position.y = .7; box(2.16, .14, 1.66, '#cfd7ea', g).position.y = 1.47; box(1.1, .05, .2, C.night, g).position.y = 1.56;
  return g;
}
const lerpCol = (m, a, b, k) => m.color.set(a).lerp(new THREE.Color(b), k);

/* ───────────── 1. HOOK (plan Higgsfield) ───────────── */
defScene(1, s => {
  const q1 = s.H('stamp', 'Qui a payé ?'), q2 = s.H('chip amb big', "À qui est l'institut ?");
  snd('tvhum', .05, .7); snd('boom', U('s1u2', 1), 1); snd('boom', U('s1u3', 1), .8);
  s.update = (t, lt) => {
    popH(q1, t, U('s1u2', 1), null, { kind: 'slam', y: 330, r: -5 });
    popH(q2, t, U('s1u3', 1), null, { kind: 'slam', y: 520, r: 3 });
    return { bg: { src: clipFrame('p1', 166, lt * 30) } };
  };
});

/* ───────────── 2. CONTEXTE 2027 ───────────── */
defScene(2, s => {
  const g = s.g; stage(g);
  const base = [1.5, 2.3, 1.8, 2.7, 1.3], cols = [], pw = [], st = [], cm = [];
  const pc = ['#7f8fb6', '#c9d2e6', '#93a3c9', '#dfe5f2', '#6f80ab'];
  for (let i = 0; i < 5; i++) {
    cm[i] = umat(C.navy2); const b = box(1.15, 1, 1.15, cm[i], g); cols.push(b);
    pw.push(pawn(pc[i], g)); st.push(strand(g));
  }
  const u = urn(g); u.position.copy(P(0, 0, 3.6));
  const ti = s.H('chip big', 'Présidentielle 2027'), dt = s.H('chip amb', '1<sup style="font-size:.6em">er</sup> tour : 18 avril 2027');
  const ok = s.H('lbl amb', 'Crédible'), ko = s.H('lbl red', 'Hors jeu');
  const tC = U('s2u3', 2), tX = U('s2u4', 1);
  snd('pop', U('s2u1')); snd('tick', U('s2u2')); snd('tick', U('s2u2') + .35); snd('ding', tC); snd('fall', tX);
  source(U('s2u2'), U('s2u3') + 1.2, 'Conseil des ministres du 1<sup>er</sup> juillet 2026 (info.gouv.fr)');
  const cp = camPath([[0, { r: 0, y: 2.7, d: 1.2, zoom: 1.12 }], [U('s2u3'), { zoom: 1.0, y: 3.1 }, 1.2]]);
  s.update = (t) => {
    setCam(cp(t));
    for (let i = 0; i < 5; i++) {
      const r = (i - 2) * 1.75; let h = base[i] + .35 * Math.sin(t * 2.3 + i * 1.9), tilt = 0, off = 0;
      if (i === 3) { const k = E.back(pr(t, tC, .5)); h = mix(h, 4.3, k); lerpCol(cm[i], C.navy2, C.amber, cl(k)); }
      if (i === 1) { const k = E.out(pr(t, tX, .45)); h = mix(h, .3, k); lerpCol(cm[i], C.navy2, '#5b1a22', k); tilt = k * 1.5; off = k * .8; }
      cols[i].scale.y = h; cols[i].position.copy(P(r, h / 2, 0));
      pw[i].position.copy(P(r + off * .6, h - off * .25, off)); pw[i].rotation.set(tilt * .7, 0, -tilt * .7);
      const top = P(r + off * .6, h + 1.25 - off, off); st[i].set(top, P(r, 22, -1)); st[i].visible = !(i === 1 && t > tX);
    }
    popH(ti, t, U('s2u1'), null, { kind: 'slam', y: 300 });
    popH(dt, t, U('s2u2'), null, { kind: 'up', y: 420 });
    tag(ok, P(1.75, 3.3, 0), { dx: 190, o: pr(t, tC, .2), s: E.back(pr(t, tC, .3)) });
    tag(ko, P(-1.75 + .5, 1.9, 1), { o: pr(t, tX + .1, .2), s: E.back(pr(t, tX + .1, .3)), dy: 30 });
  };
});

/* ───────────── 3. BOLLORÉ : CSA → HAVAS → BOLLORÉ → 3 MÉDIAS ───────────── */
defScene(3, s => {
  const g = s.g; stage(g);
  const csa = box(2.6, 1.1, 1.6, C.white, g), hav = box(3.1, 1.1, 1.8, '#5670b8', g), bol = box(3.9, 1.35, 2.1, C.red, g);
  const yC = 1.4, yH = 4.4, yB = 7.6;
  const tCSA = U('s3u2', 0) + .3, tHAV = U('s3u2', 1) + .45, tBOL = U('s3u2', 3) + .15;
  const s1 = [strand(g), strand(g)], s2 = [strand(g), strand(g)], up = [strand(g), strand(g)];
  const lC = s.H('lbl dark l', 'CSA'), lH = s.H('lbl l', 'Havas'), lB = s.H('lbl l', 'Famille Bolloré');
  const sh = sheet(g), tS = U('s3u3', 1), dchip = s.H('chip sm amb', 'Sondage présidentielle · 4 nov. 2026');
  // médias
  const mm = [umat('#3a4a78'), umat('#3a4a78'), umat('#d5dcec')], md = [];
  const tv = grp(g); box(1.6, 1.15, .9, mm[0], tv).position.y = .78; box(1.2, .78, .06, mat(C.amber, { emissive: '#F4A261', emissiveIntensity: .7 }), tv).position.set(0, .8, .47); box(.9, .2, .5, C.night, tv).position.y = .1; tv.rotation.y = Q;
  const mic = grp(g); cyl(.4, .5, .12, 6, mm[1], mic).position.y = .06; cyl(.08, .08, 1.0, 6, mm[1], mic).position.y = .6; ico(.42, mm[1], mic).position.y = 1.35;
  const np = grp(g); box(1.5, .1, 1.05, mm[2], np).position.y = .1; const n2 = box(1.5, .1, 1.05, mm[2], np); n2.position.y = .24; n2.rotation.y = .18; box(1.0, .03, .14, C.night, np).position.set(0, .31, .25); np.rotation.y = Q;
  [tv, mic, np].forEach((m, i) => { m.userData.p = P((i - 1) * 3.3, 0, 3.7); m.position.copy(m.userData.p); md.push(m); });
  const ml = ['CNews', 'Europe 1', 'Le JDD'].map(x => s.H('chip sm', x)), ms = md.map(() => strand(g, C.red, .03));
  const tM = [U('s3u4', 0), U('s3u4', 1), U('s3u4', 2)], tG = U('s3u5', 1);
  const w = ['Sonde', 'Diffuse', 'Commente'].map((x, i) => s.H('chip big ' + ['red', 'amb', ''][i], x)), ar = [s.H('lbl l amb', '▼'), s.H('lbl l amb', '▼')], wb = s.H('lbl l', 'Bolloré');
  const tW = [U('s3u6', 1), U('s3u7', 1), U('s3u8', 1)];
  snd('pop', U('s3u1')); [tCSA, tHAV, tBOL].forEach((x, i) => snd('thunk', x + .18, .8 + i * .15)); snd('paper', tS); snd('pop', U('s3u3'));
  tM.forEach(x => snd('ding', x)); snd('chain', tG); tW.forEach(x => snd('stamp', x));
  source(tHAV, U('s3u3') - .1, 'Havas (rachat de CSA, 2015) · Bolloré SE, résultats 2025 : 53 % du capital de Havas');
  source(U('s3u3'), U('s3u6') - .1, 'Commission des sondages, notice CSA pour CNews / Europe 1 / JDD, 4 nov. 2026');
  const cp = camPath([[0, { r: 0, y: 4.7, d: 0, zoom: 1.18 }], [U('s3u3') - .2, { y: 3.5, d: 1.6, zoom: .98 }, .9]]);
  const ex = s.H('chip navy', 'Exemple n° 1');
  s.update = (t) => {
    setCam(cp(t));
    popH(ex, t, U('s3u1'), U('s3u2') + .2, { kind: 'slam', y: 330 });
    const a = drop(t, tCSA, yC), b = drop(t, tHAV, yH), c = drop(t, tBOL, yB);
    setY(csa, a); setY(hav, b); setY(bol, c);
    [-1, 1].forEach((sg, i) => {
      s1[i].visible = a !== null && b !== null; if (s1[i].visible) s1[i].set(P(sg * .9, a + .55, 0), P(sg * .9, b - .55, 0));
      s2[i].visible = b !== null && c !== null; if (s2[i].visible) s2[i].set(P(sg * 1.1, b + .55, 0), P(sg * 1.1, c - .67, 0));
      up[i].visible = c !== null; if (c !== null) up[i].set(P(sg * 1.4, c + .67, 0), P(sg * 1.4, 26, 0));
    });
    const fadeL = 1 - pr(t, U('s3u6') - .15, .2);
    tag(lC, P(0, a ?? 0, 0), { o: a === null ? 0 : fadeL }); tag(lH, P(0, b ?? 0, 0), { o: b === null ? 0 : fadeL }); tag(lB, P(0, c ?? 0, 0), { o: c === null ? 0 : fadeL, s: .86 });
    // feuille de sondage
    const ks = pr(t, tS, .45); sh.visible = ks > 0; sh.position.copy(P(mix(0, 3.1, E.out(ks)), mix(1.2, .9 + .12 * Math.sin(t * 2.4), E.out(ks)), .8)); sh.scale.setScalar(Math.max(.001, E.back(ks)) * .85);
    tag(dchip, P(1.2, 3.25, .8), { o: pr(t, U('s3u3'), .2) * fadeL, s: .9 * E.back(pr(t, U('s3u3'), .3)) });
    md.forEach((m, i) => {
      pop3(m, t, tM[i]); const k = E.io(pr(t, tG + i * .12, .5));
      ms[i].visible = k > 0 && c !== null; if (ms[i].visible) { const from = P((i - 1) * 1.5, c - .67, .4), to = m.userData.p.clone().add(new THREE.Vector3(0, i === 1 ? 1.7 : 1.3, 0)); ms[i].set(from, from.clone().lerp(to, k)); }
      lerpCol(mm[i], i === 2 ? '#d5dcec' : '#3a4a78', C.red, cl(pr(t, tG + i * .12 + .4, .3)));
      tag(ml[i], m.userData.p, { dy: 62, o: pr(t, tM[i] + .1, .2) * fadeL, s: E.back(pr(t, tM[i] + .1, .3)) });
    });
    // « sonde / diffuse / commente »
    state.dim = .8 * pr(t, U('s3u6') - .15, .25);
    popH(wb, t, U('s3u6'), null, { kind: 'up', y: 330 });
    w.forEach((e, i) => popH(e, t, tW[i], null, { kind: 'slam', y: 500 + i * 240, r: [-3, 2, -2][i], s: 1.25 }));
    ar.forEach((e, i) => popH(e, t, tW[i + 1] - .15, null, { kind: 'up', y: 620 + i * 240 }));
  };
});

/* ───────────── 4. LA CARTE DES PROPRIÉTAIRES ───────────── */
defScene(4, s => {
  const g = s.g;
  const pts = [[-.15, 1], [.45, .8], [.85, .55], [.7, .1], [.9, -.45], [.55, -.75], [.15, -.7], [0, -.95], [-.6, -.85], [-.55, -.2], [-1, .35], [-.5, .5], [-.45, .75]];
  const shp = new THREE.Shape(pts.map(p => new THREE.Vector2(p[0] * 5.2, p[1] * 5.2)));
  const geo = new THREE.ExtrudeGeometry(shp, { depth: .4, bevelEnabled: false }); geo.rotateX(-Math.PI / 2); geo.rotateY(Q);
  const fr = new THREE.Mesh(geo, mat('#26355c')); fr.receiveShadow = true; fr.position.y = -.4; g.add(fr);
  const T = [{ n: 'OpinionWay', r: -2.7, d: .2, t: U('s4u1') }, { n: 'Ifop', r: 0, d: 1.9, t: U('s4u7') }, { n: 'Ipsos', r: 2.8, d: .2, t: U('s4u9') }];
  T.forEach(o => { o.m = cyl(.62, .74, 1, 6, C.white, g); o.l = s.H('lbl dark s', o.n); o.st = strand(g); o.st2 = strand(g); o.h = 2.3; });
  const bva = cyl(.42, .5, 1, 6, C.grey, g), lbva = s.H('lbl xs', 'BVA');
  // blocs propriétaires
  const B = [
    { n: 'Les Échos – Le Parisien', i: 0, y: 4.9, t: U('s4u3', 1), m: box(3.0, .95, 1.5, '#5670b8', g), cls: 'lbl xs' },
    { n: 'LVMH', i: 0, y: 7.5, t: U('s4u5'), m: box(2.6, 1.15, 1.6, C.amber, g), cls: 'lbl dark l' },
    { n: 'Fonds LFPI', i: 1, y: 5.4, t: U('s4u8', 1), m: box(2.6, 1.05, 1.5, '#3f7f86', g), cls: 'lbl s' },
    { n: 'Bourse', i: 2, y: 5.2, t: U('s4u10'), m: box(2.4, 1.05, 1.5, '#8a6fc0', g), cls: 'lbl s' },
  ];
  B.forEach(b => { b.l = s.H(b.cls, b.n); snd('thunk', b.t + .18); });
  const arn = s.H('chip sm', 'Bernard Arnault'), pct = s.H('num', '0 %'), tP = U('s4u3', 3);
  const coins = [0, 1, 2].map(i => cyl(.22, .22, .12, 8, C.gold, g));
  const tMerge = U('s4u11', 0) + .25, t68 = U('s4u12');
  // foule
  const N = 150, crowd = new THREE.InstancedMesh(new THREE.ConeGeometry(.11, .34, 5), mat('#aeb9d6'), N), dm = new THREE.Object3D(); g.add(crowd);
  const cpos = []; let k = 0; while (cpos.length < N && k < 4000) { const e = rnd(k++) * 2 - 1, n = rnd(k++ + 77) * 2 - 1; if (shp.getPoints && inPoly(e, n, pts)) cpos.push([e * 5.2, -n * 5.2]); }
  function inPoly(x, y, p) { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) if ((p[i][1] > y) !== (p[j][1] > y) && x < (p[j][0] - p[i][0]) * (y - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]) c = !c; return c; }
  const big = s.H('num', '68 000 000<small>de Français</small>');
  T.forEach(o => snd('pop', o.t)); snd('tick', tP - .3); snd('ding', tP + .45); snd('ding', U('s4u6')); snd('coin', U('s4u8', 1) + .5); snd('thunk', tMerge + .5, 1.2); snd('riser', t68 + .2);
  source(U('s4u2'), U('s4u7') - .1, 'Groupe Les Échos–Le Parisien (LVMH), communiqué du 26 juillet 2022');
  source(U('s4u7'), U('s4u9') - .1, 'CB News, juillet 2022 : la famille Dentressangle cède l’Ifop au fonds LFPI');
  source(U('s4u9'), U('s4u12') - .1, 'Ipsos, communiqué du 24 juin 2025 (acquisition de The BVA Family)');
  const cp = camPath([[0, { r: -2.2, y: 3.4, d: .5, zoom: 1.32 }], [U('s4u4') - .2, { y: 4.4 }], [U('s4u7') - .25, { r: 0, y: 3.3, d: 1.4 }], [U('s4u9') - .25, { r: 2.2, y: 3.1, d: .3 }], [t68 - .2, { r: 0, y: 3.9, d: .6, zoom: .86 }, 1.0]]);
  s.update = (t) => {
    setCam(cp(t));
    const km = E.io(pr(t, tMerge, .55));
    T.forEach((o, i) => {
      const kk = E.back(pr(t, o.t, .45)); o.m.visible = t > o.t; let h = o.h * Math.max(.001, kk); if (i === 2) h += km * .9;
      o.m.scale.set(1 + (i === 2 ? km * .25 : 0), h, 1 + (i === 2 ? km * .25 : 0)); o.m.position.copy(P(o.r, h / 2, o.d)); o.top = h;
      if (i === 2) o.l.innerHTML = km > .6 ? 'Ipsos BVA' : 'Ipsos';
      tag(o.l, P(o.r, h * .55, o.d + .7), { o: pr(t, o.t + .15, .2) });
    });
    // BVA avalé
    const kb = pr(t, U('s4u9') + .15, .35); bva.visible = kb > 0 && km < 1;
    const br = mix(1.3, 2.8, km), bd = mix(-1.6, .2, km), bh = 1.4 * E.back(kb) * (1 - km * .8) + .001; bva.scale.set(1 - km * .5, bh, 1 - km * .5); bva.position.copy(P(br, bh / 2, bd));
    tag(lbva, P(br, bh + .45, bd), { o: kb * (1 - pr(t, tMerge, .3)) });
    B.forEach(b => {
      const o = T[b.i], y = drop(t, b.t, b.y); setY(b.m, y); if (y !== null) b.m.position.copy(P(o.r, y, o.d));
      tag(b.l, P(o.r, y ?? 0, o.d), { o: y === null ? 0 : 1 });
    });
    // fils : tour → bloc(s) → hors champ
    T.forEach((o, i) => {
      const bs = B.filter(b => b.i === i && b.m.visible); o.st.visible = bs.length > 0; o.st2.visible = bs.length > 0;
      if (!bs.length) return; const lo = bs[0], hi = bs[bs.length - 1];
      o.st.set(P(o.r, o.top, o.d), P(o.r, lo.m.position.y - .5, o.d));
      if (bs.length > 1) o.st2.set(P(o.r, lo.m.position.y + .5, o.d), P(o.r, hi.m.position.y - .55, o.d));
      else { const kz = E.io(pr(t, t68, .8)); o.st2.set(P(o.r, hi.m.position.y + .5, o.d), P(o.r, hi.m.position.y + .5 + kz * 20, o.d)); }
    });
    tag(arn, P(T[0].r, 7.5, T[0].d), { dy: 88, o: pr(t, U('s4u6'), .2), s: E.back(pr(t, U('s4u6'), .3)) });
    const kp = pr(t, tP - .3, .75); pct.innerHTML = Math.round(75 * E.out(kp)) + ' %';
    tag(pct, P(T[0].r + 2.9, 2.6, T[0].d), { o: pr(t, tP - .3, .15) * (1 - pr(t, U('s4u7') - .3, .2)), s: .62 * mix(1.5, 1, E.out(kp)) });
    coins.forEach((c, i) => { const y = drop(t, U('s4u8', 1) + .45 + i * .12, 5.4 + .6 + i * .13, 12, .4); setY(c, y); if (y !== null) c.position.copy(P(T[1].r + .7, y, T[1].d)); });
    // foule + compteur
    for (let i = 0; i < N; i++) {
      const [e, n] = cpos[i] || [0, 0], kk = E.back(pr(t, t68 + .2 + rnd(i) * .9, .3));
      dm.position.copy(P(e, .17 * kk, n)); dm.scale.setScalar(Math.max(.001, kk)); dm.updateMatrix(); crowd.setMatrixAt(i, dm.matrix);
    }
    crowd.instanceMatrix.needsUpdate = true; crowd.visible = t > t68 + .15;
    const k68 = pr(t, U('s4u12', 2) - .2, 1.0); big.firstChild.textContent = Math.round(68e6 * E.out(k68)).toLocaleString('fr-FR').replace(/ /g, ' ');
    popH(big, t, U('s4u12', 2) - .2, null, { kind: 'slam', y: 1165, s: .56 });
  };
});

/* ───────────── 5. QUI PASSE COMMANDE ? (plan Higgsfield puis chaîne de financement) ───────────── */
defScene(5, s => {
  const g = s.g, t0 = s.start, tCut = t0 + 3.0; stage(g);
  const card = s.H('card', '<h1>Grande enquête Ifop</h1><h2>Présidentielle 2027 · avril 2025</h2>');
  const N = [
    { n: 'Enquête Ifop', y: 1.3, t: tCut + .05, m: box(2.8, 1.1, 1.7, C.white, g), cls: 'lbl dark' },
    { n: 'Hexagone', y: 4.7, t: U('s5u4', 2), m: cyl(1.35, 1.35, 1.0, 6, '#5670b8', g), cls: 'lbl' },
    { n: 'Périclès', y: 8.1, t: U('s5u6', 2), m: box(3.0, 1.1, 1.8, C.amber, g), cls: 'lbl dark l' },
    { n: 'P.-É. Stérin', y: 11.5, t: U('s5u7', 1), m: box(3.6, 1.3, 2.0, C.red, g), cls: 'lbl l' },
  ];
  N.forEach((n, i) => { n.l = s.H(n.cls, n.n); n.st = [strand(g), strand(g)]; snd('thunk', n.t + .18, .8 + i * .12); });
  const top = [strand(g), strand(g)];
  const cnt = s.H('chip amb', '9 128 personnes interrogées'), an = s.H('chip navy sm', 'Assemblée nationale · commission d’enquête'), cmd = s.H('chip sm', '▲ commandée par'), fin = s.H('chip sm', '▲ financé par'), prj = s.H('chip sm', '▲ projet de');
  const o1 = s.H('chip navy', 'Objectif du projet :'), o2 = s.H('chip red big', 'faire gagner'), o3 = s.H('chip big', 'droite + extrême droite');
  const coins = [...Array(7)].map(() => cyl(.2, .2, .1, 8, C.gold, g)), tCo = U('s5u6', 1);
  snd('boom', t0 + .15, 1.1); snd('paper', U('s5u2', 1)); snd('tick', U('s5u3', 1)); snd('pop', U('s5u5')); for (let i = 0; i < 5; i++) snd('coin', tCo + .2 + i * .22, .8); snd('stamp', U('s5u8', 0) + .1); snd('stamp', U('s5u8', 2));
  source(U('s5u2'), U('s5u5') - .1, 'Observatoire Hexagone × Ifop, « Grande enquête électorale », mai 2025 (9 128 inscrits)');
  source(U('s5u5'), U('s5u7') - .1, 'Assemblée nationale, commission d’enquête sur l’organisation des élections, compte rendu n° 37 (2025)');
  source(U('s5u7'), UE('s5u8') + .3, 'L’Humanité, juillet 2024 (document interne « Périclès ») · Assemblée nationale, CR n° 37');
  const cp = camPath([[0, { r: 0, y: 1.9, d: .6, zoom: 1.3 }], [U('s5u4', 1), { y: 3.2, zoom: 1.08 }], [U('s5u6', 1), { y: 4.9, zoom: .92 }], [U('s5u7', 0), { y: 6.6, zoom: .8 }]]);
  s.update = (t, lt) => {
    setCam(cp(t)); const kc = pr(t, tCut - .12, .3), fl5 = 1 - pr(t, U('s5u8') - .1, .25);
    s.g.visible = kc > 0;
    popH(card, t, U('s5u2', 1), tCut, { kind: 'up', y: 600, s: 1.15 });
    N.forEach((n, i) => {
      const y = drop(t, n.t, n.y); setY(n.m, y); if (y !== null) n.m.position.copy(P(0, y, 0));
      tag(n.l, P(0, y ?? 0, 0), { o: y === null ? 0 : fl5, s: i === 3 ? .9 : 1 });
      const lo = N[i - 1]; n.st.forEach((st, j) => { st.visible = i > 0 && y !== null; if (st.visible) st.set(P((j ? 1 : -1) * .9, lo.m.position.y + .55, 0), P((j ? 1 : -1) * .9, y - .55, 0)); });
    });
    const last = [...N].reverse().find(n => n.m.visible);
    top.forEach((st, j) => { st.visible = !!last; if (last) st.set(P((j ? 1 : -1) * 1.1, last.m.position.y + .6, 0), P((j ? 1 : -1) * 1.1, 30, 0)); });
    tag(cnt, P(0, 1.3, 0), { dy: 105, o: pr(t, U('s5u3', 1), .2) * (1 - pr(t, U('s5u6') - .2, .2)), s: .92 * E.back(pr(t, U('s5u3', 1), .3)) });
    tag(cmd, P(0, 3.0, 0), { dx: 235, o: fl5 * pr(t, U('s5u4', 0), .2), s: E.back(pr(t, U('s5u4', 0), .3)) });
    tag(fin, P(0, 6.4, 0), { dx: 235, o: fl5 * pr(t, U('s5u6', 1), .2), s: E.back(pr(t, U('s5u6', 1), .3)) });
    tag(prj, P(0, 9.8, 0), { dx: 235, o: fl5 * pr(t, U('s5u7', 0), .2), s: E.back(pr(t, U('s5u7', 0), .3)) });
    popH(an, t, U('s5u5'), U('s5u7') - .1, { kind: 'slam', y: 290 });
    coins.forEach((c, i) => { const k = pr(t, tCo + i * .2, .6); c.visible = k > 0 && k < 1 && N[2].m.visible; c.position.copy(P(.4 * Math.sin(i * 2.1), mix(7.5, 5.3, E.in(k)), .9)); c.rotation.x = t * 6 + i; });
    const k8 = U('s5u8'); state.dim = .78 * pr(t, k8 - .1, .3);
    popH(o1, t, k8, null, { kind: 'up', y: 470 }); popH(o2, t, k8 + .1, null, { kind: 'slam', y: 620, r: -3, s: 1.2 }); popH(o3, t, U('s5u8', 1), null, { kind: 'slam', y: 800, r: 2 });
    if (lt < 3.1) return { bg: { src: clipFrame('p2', 91, lt * 30), o: 1 - kc, s: 1 + lt * .01 } };
  };
});

/* ───────────── 6. LA BOÎTE NOIRE ───────────── */
defScene(6, s => {
  const g = s.g; stage(g);
  // A. panneau attention
  const warn = grp(g); const wg = new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(-1.9, -1.1), new THREE.Vector2(1.9, -1.1), new THREE.Vector2(0, 2.1)]), { depth: .35, bevelEnabled: false });
  const tri = new THREE.Mesh(wg, mat(C.amber)); tri.castShadow = true; warn.add(tri); box(.32, 1.15, .1, C.night, warn).position.set(0, .45, .4); box(.32, .32, .1, C.night, warn).position.set(0, -.6, .4); warn.rotation.y = Q; warn.position.copy(P(0, 3.4, 0));
  const c1 = s.H('chip big', 'Chiffres inventés ? Non.'), c2 = s.H('chip red big', 'Le problème : tout le reste');
  // B. 1 000 personnes
  const NX = 40, NZ = 25, N = NX * NZ, dm = new THREE.Object3D();
  const im = new THREE.InstancedMesh(new THREE.ConeGeometry(.085, .3, 5), mat('#b9c3de'), N); im.castShadow = true; g.add(im);
  const k1000 = s.H('num', '1 000<small>personnes interrogées</small>'), tB = U('s6u4'), tC = U('s6u5') - .1;
  // C. marge d'erreur
  const bm = [umat(C.red), umat(C.amber)], bars = bm.map(m => box(1.5, 1, 1.5, m, g)), band = bars.map(() => box(1.9, 1.1, 1.9, umat(C.white, { transparent: true, opacity: .25, depthWrite: false }), g));
  band.forEach(b => b.castShadow = false); const bl = [s.H('lbl l', '26 %'), s.H('lbl l', '24 %')];
  const me = s.H('chip amb big', 'Marge : ± 3 points'), me2 = s.H('chip navy', 'Qui est devant ? Impossible à dire.');
  // D. machine à redresser
  const mac = grp(g); box(3.6, 2.7, 2.6, '#33426e', mac).position.y = 1.35; const gears = [cyl(.85, .85, .32, 8, C.amber, mac), cyl(.6, .6, .32, 8, C.red, mac)]; gears[0].position.set(-.7, 2.86, 0); gears[1].position.set(.75, 2.86, .2);
  const belt = box(12, .22, 1.3, '#111830', g); belt.rotation.y = Q; belt.position.y = .11;
  const raw = [...Array(4)].map(() => box(.5, 1, .5, C.grey, g)), outb = [...Array(4)].map((_, i) => box(.5, 1, .5, i % 2 ? C.amber : C.red, g));
  const lm = s.H('lbl', 'Redressement'), lr = s.H('chip sm', 'Réponses brutes'), lo = s.H('chip sm red', 'Chiffres publiés');
  const tD = U('s6u6'), tE = U('s6u8') - .12;
  // E. chiffres bruts enfermés
  const brut = box(2.6, 1.7, 1.9, '#9aa5c0', g), safe = box(3.3, 2.5, 2.6, '#141b33', g), lb = s.H('lbl dark', 'Chiffres bruts'), stp = s.H('stamp', 'Non publiés'), tS = U('s6u9', 1) - .05;
  // F. communiqué
  const tF = U('s6u15');
  const doc = s.H('card', '<h1>Commission des sondages</h1><h2>Communiqué du 5 novembre 2026 — elle demande aux instituts :</h2><div class="row"><s>1</s>le taux de non-réponse, question par question</div><div class="row"><s>2</s>les effectifs réellement pris en compte</div><div class="row"><s>3</s>des marges d’erreur calculées sur ces effectifs</div>');
  doc.style.width = '920px'; const rows = [...doc.querySelectorAll('.row')], tR = [U('s6u16', 1), U('s6u16', 3), U('s6u16', 4)];
  snd('boom', U('s6u1'), .9); snd('pop', U('s6u2', 1)); snd('stamp', U('s6u3', 1)); snd('riser', tB, .7); snd('ding', U('s6u4', 2)); snd('thunk', tC + .3); snd('glitch', U('s6u5', 0) + .5); snd('gears', tD, 1); snd('thunk', tE + .2); snd('stamp', tS + .12, 1.2); snd('thunk', tS, 1.2); snd('paper', tF); tR.forEach(x => snd('tick', x, 1.2));
  source(tB, tD - .1, 'Notices publiées par la Commission des sondages (≈ 1 000 personnes : ± 3,1 points)');
  source(tD, tF - .1, 'Sénat, rapport d’information n° 54 (2010), « Sondages et démocratie »');
  source(tF, UE('s6u16') + .3, 'Commission des sondages, communiqué du 5 novembre 2026');
  const cp = camPath([[0, { r: 0, y: 3.2, d: 0, zoom: 1.15 }], [tB - .2, { y: 1.6, d: .4, zoom: .98 }], [tC, { y: 2.9, d: 0, zoom: 1.12 }], [tD - .15, { y: 2.2, d: .3, zoom: 1.0 }], [tE, { y: 2.0, zoom: 1.2 }]]);
  s.update = (t) => {
    setCam(cp(t));
    // A
    const kw = E.back(pr(t, U('s6u1'), .35)) * (1 - pr(t, tB - .3, .2)); warn.visible = kw > .01; warn.scale.setScalar(Math.max(.001, kw)); warn.rotation.z = .08 * Math.sin(t * 7) * (1 - pr(t, U('s6u1'), .8));
    popH(c1, t, U('s6u2', 1), tB - .25, { kind: 'pop', y: 1010 }); popH(c2, t, U('s6u3', 1), tB - .25, { kind: 'slam', y: 1150, r: -2 });
    // B
    const kout = pr(t, tC, .3); im.visible = t > tB - .05 && kout < 1;
    if (im.visible) { for (let i = 0; i < N; i++) { const x = i % NX, z = (i / NX) | 0, k = E.back(pr(t, tB + x * .018 + rnd(i) * .25, .25)) * (1 - kout); dm.position.copy(P((x - NX / 2 + .5) * .245, .15 * k, (z - NZ / 2 + .5) * .27)); dm.scale.setScalar(Math.max(.001, k)); dm.updateMatrix(); im.setMatrixAt(i, dm.matrix); } im.instanceMatrix.needsUpdate = true; }
    const kn = pr(t, tB + .15, U('s6u4', 2) - tB); k1000.firstChild.textContent = Math.round(1000 * E.out(kn)).toLocaleString('fr-FR').replace(/ /g, ' ');
    popH(k1000, t, tB + .15, tC, { kind: 'slam', y: 380, s: .7 });
    // C
    const kb = E.back(pr(t, tC + .15, .45)) * (1 - pr(t, tD - .3, .2)), hh = [3.9, 3.6];
    bars.forEach((b, i) => {
      const h = Math.max(.001, (hh[i] + .42 * Math.sin(t * 5.2 + i * 2.6) * pr(t, U('s6u5', 0) + .45, .3)) * kb), r = i ? 1.7 : -1.7;
      b.visible = band[i].visible = kb > .01; b.scale.y = h; b.position.copy(P(r, h / 2, 0)); band[i].position.copy(P(r, hh[i] * kb, 0)); band[i].scale.y = Math.max(.001, pr(t, U('s6u5', 0) + .3, .25) * kb);
      bl[i].innerHTML = Math.round(26 - i * 2 + 2.6 * Math.sin(t * 5.2 + i * 2.6) * pr(t, U('s6u5', 0) + .45, .3)) + ' %';
      tag(bl[i], P(r, h + 1.0, 0), { o: kb > .5 ? 1 : 0 });
    });
    popH(me, t, U('s6u5', 0) + .3, tD - .3, { kind: 'slam', y: 330 }); popH(me2, t, U('s6u5', 1), tD - .3, { kind: 'up', y: 450 });
    // D
    const kmk = E.back(pr(t, tD, .4)) * (1 - pr(t, tE, .2)); mac.visible = belt.visible = kmk > .01; mac.scale.setScalar(Math.max(.001, kmk)); belt.scale.x = Math.max(.001, kmk);
    gears[0].rotation.y = t * 2.4; gears[1].rotation.y = -t * 3.4 + .4;
    raw.forEach((b, i) => { const ph = ((t - tD) * .55 + i * .25) % 1, r = mix(-5.6, -1.9, ph), h = .6 + rnd(i + 3) * 1.1; b.visible = kmk > .5 && t > tD + .3; b.scale.y = h; b.position.copy(P(r, .22 + h / 2, 0)); });
    outb.forEach((b, i) => { const ph = ((t - tD) * .55 + i * .25) % 1, r = mix(1.9, 5.6, ph), h = .5 + rnd(i + 11) * 1.6; b.visible = kmk > .5 && t > tD + 1.0; b.scale.y = h; b.position.copy(P(r, .22 + h / 2, 0)); });
    tag(lm, P(0, 1.5, 1.4), { o: kmk > .5 ? 1 : 0 }); tag(lr, P(-3.6, 2.6, 0), { o: pr(t, tD + .4, .2) * (kmk > .5), s: E.back(pr(t, tD + .4, .3)) }); tag(lo, P(3.6, 3.2, 0), { o: pr(t, U('s6u7', 0), .2) * (kmk > .5), s: E.back(pr(t, U('s6u7', 0), .3)) });
    // E
    const ke = E.back(pr(t, tE + .1, .35)) * (1 - pr(t, tF - .1, .2)); brut.visible = ke > .01 && t < tS + .5; brut.scale.setScalar(Math.max(.001, ke)); brut.position.copy(P(0, .85, 0));
    const ys = drop(t, tS, 1.25, 15, .5); safe.visible = ys !== null && t < tF + .1; if (ys !== null) safe.position.copy(P(0, ys, 0));
    tag(lb, P(0, .9, 1), { o: (brut.visible && t < tS + .12) ? 1 : 0 });
    popH(stp, t, tS + .15, tF - .1, { kind: 'slam', y: 430, r: -7, s: 1.15 });
    // F
    state.dim = .82 * pr(t, tF - .1, .3);
    popH(doc, t, tF, null, { kind: 'up', y: 700 }); rows.forEach((r, i) => { const k = pr(t, tR[i], .2); r.style.opacity = k; r.style.transform = `translateX(${(1 - E.out(k)) * 40}px)`; });
  };
});

/* ───────────── 7. LE POUVOIR S'EN SERT ───────────── */
defScene(7, s => {
  const g = s.g; stage(g);
  // A. Élysée
  const pal = grp(g), w = '#dfe4f0'; box(7.8, .24, 3.8, '#aab3c9', pal).position.y = .12; box(7.2, .5, 3.2, w, pal).position.y = .49;
  for (let i = 0; i < 6; i++) cyl(.26, .3, 2.6, 8, w, pal).position.set(-2.75 + i * 1.1, 2.04, 1.15);
  box(6.6, 2.6, 1.8, '#c3cade', pal).position.set(0, 2.04, -.4); box(1.1, 1.7, .1, C.navy, pal).position.set(0, 1.6, .52);
  box(7.2, .5, 3.2, w, pal).position.y = 3.59;
  const pg = new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(-3.6, 0), new THREE.Vector2(3.6, 0), new THREE.Vector2(0, 1.5)]), { depth: 3.0, bevelEnabled: false }); const ped = new THREE.Mesh(pg, mat(w)); ped.castShadow = true; ped.position.set(0, 3.84, -1.5); pal.add(ped);
  cyl(.045, .045, 2.2, 5, C.grey, pal).position.set(0, 6.3, 0); ['#2b4c9b', '#f1faee', '#E63946'].forEach((c, i) => box(.42, .7, .05, c, pal).position.set(.24 + i * .42, 7.0, 0));
  pal.rotation.y = Q; const pp = P(-.3, 0, -1.2);
  const sh = sheet(g); sh.position.copy(P(3.1, 0, 3.4)); const coins = [...Array(9)].map(() => cyl(.22, .22, .09, 8, C.gold, g)), tCo = U('s7u3', 1);
  const fp = s.H('chip amb big', 'Fonds publics'), ao = s.H('stamp', 'Sans appel d’offres'), el = s.H('lbl s', 'Palais de l’Élysée · 2007-2012');
  const gv = grp(g); box(1.5, .35, 1.5, C.wood, gv).position.y = .18; const arm = grp(gv); cyl(.07, .07, 1.9, 6, '#8a5626', arm).position.set(0, .95, 0); const hd = cyl(.33, .33, 1.0, 8, C.wood, arm); hd.rotation.z = Math.PI / 2; hd.position.y = 1.9; arm.position.set(1.9, .3, 0); gv.position.copy(P(-3.0, 0, 3.4)); gv.rotation.y = Q;
  const tH = U('s7u5', 1) + .1, jc = s.H('card', '<h1>Claude Guéant condamné en appel</h1><h2 style="margin:0">Cour d’appel de Paris, 4 novembre 2025 — favoritisme : 1 an de prison avec sursis. Pourvoi en cassation annoncé.</h2>'); jc.style.width = '900px';
  const tB = U('s7u6') - .15, tCc = U('s7u8') - .15;
  // B. les sondages départagent
  const bg = grp(g), cmB = [umat(C.navy2), umat(C.navy2)], colB = cmB.map(m => box(1.4, 1, 1.4, m, bg)), pwB = [pawn('#dfe5f2', bg, 1.2), pawn('#8fa0c8', bg, 1.2)], crown = cyl(.36, .24, .26, 6, C.gold, bg);
  const pan = grp(bg); box(4.6, 2.7, .16, '#33426e', pan).position.y = 0; const pb = [box(.9, 1, .1, C.red, pan), box(.9, 1, .1, C.grey, pan)]; pan.rotation.y = Q; pan.position.copy(P(0, 6.6, 0));
  const pst = [strand(bg), strand(bg)], lp = s.H('lbl s', 'Sondage'), la = [s.H('chip sm amb', 'Candidat désigné'), s.H('chip sm', 'Écarté')];
  const tP = U('s7u7', 2), tDp = U('s7u7', 3) + .1;
  // C. mur d'écrans + dominos
  const cg = grp(g), scm = [...Array(9)].map(() => umat('#1a2340')), tvs = scm.map((m, i) => { const q = grp(cg); box(2.3, 1.6, .5, '#33426e', q); box(1.95, 1.25, .06, m, q).position.z = .27; q.rotation.y = Q; q.userData.p = P((i % 3 - 1) * 2.75, 2.9 + ((i / 3) | 0) * 2.0, -1.2); q.position.copy(q.userData.p); return q; });
  const tl = tvs.map(() => s.H('lbl dark l', '31 %')), tT = i => U('s7u8') + [0, 4, 8, 2, 6, 1, 5, 3, 7][i] * .2;
  const ND = 11, dom = [...Array(ND)].map((_, i) => { const q = grp(cg); const b = box(.22, 1.5, .8, i === ND - 1 ? C.red : '#dfe5f2', q); b.position.y = .75; q.rotation.y = Q; q.position.copy(P(-4.6 + i * .86, 0, 3.4)); return q; }), tDo = U('s7u9', 0) + .25;
  const ur = urn(cg); ur.position.copy(P(4.3, 0, 1.0)); const d18 = s.H('chip amb', '1<sup style="font-size:.6em">er</sup> tour : 18 avril 2027');
  snd('thunk', U('s7u1') + .3, 1.3); for (let i = 0; i < 6; i++) snd('coin', tCo + .35 + i * .16, .8); snd('stamp', U('s7u4') + .05); snd('gavel', tH, 1.3); snd('pop', tB + .2); snd('tick', tP); snd('ding', tDp); snd('fall', tDp + .05);
  for (let i = 0; i < 9; i++) snd('glitch', tT(i), .5); for (let i = 0; i < ND; i++) snd('domino', tDo + i * .11 + .16, .7 + i * .03); snd('pop', U('s7u11'));
  source(U('s7u2'), U('s7u6') - .15, 'Cour d’appel de Paris, 4 nov. 2025 (affaire des « sondages de l’Élysée ») — décision non définitive');
  source(U('s7u6'), U('s7u8') - .15, 'LCP, « Présidentielle 2027 : les sondages vont-ils choisir les candidats ? »');
  const cp = camPath([[0, { r: 0, y: 3.4, d: .2, zoom: .98 }], [U('s7u5') - .2, { r: -.6, y: 2.4, d: 1.4, zoom: 1.12 }], [tB, { r: 0, y: 3.9, d: 0, zoom: 1.05 }, .5], [tCc, { r: 0, y: 3.6, d: .6, zoom: .92 }, .5]]);
  s.update = (t) => {
    setCam(cp(t));
    // A
    const yA = drop(t, U('s7u1'), 0, 16, .65), kA = 1 - pr(t, tB - .05, .2); pal.visible = yA !== null && kA > 0; if (pal.visible) { pal.position.copy(pp).setY(yA); pal.scale.setScalar(Math.max(.001, kA)); }
    tag(el, P(-.3, 8.6, -1.2), { o: pr(t, U('s7u2'), .2) * kA * (1 - pr(t, U('s7u3', 2) - .1, .2)) });
    pop3(sh, t, tCo - .1, .35, kA * .9); sh.visible = sh.visible && kA > 0;
    coins.forEach((c, i) => { const k = pr(t, tCo + .25 + i * .16, .7); c.visible = k > 0 && k < 1 && kA > 0; const a = P(.3, 1.4, .2), b = P(3.1, 1.2, 3.4); c.position.lerpVectors(a, b, k); c.position.y += Math.sin(k * Math.PI) * 3.2; c.rotation.set(t * 9 + i, 0, t * 5); });
    popH(fp, t, U('s7u3', 2), U('s7u5') - .1, { kind: 'slam', y: 300 }); popH(ao, t, U('s7u4') + .05, U('s7u5') - .1, { kind: 'slam', y: 450, r: -5, s: .9 });
    pop3(gv, t, U('s7u5') - .15, .3, kA); gv.visible = gv.visible && kA > 0; const kg = pr(t, tH - .22, .22); arm.rotation.z = mix(-.2, 1.25, E.in(kg)) - .25 * Math.sin(pr(t, tH, .3) * Math.PI);
    popH(jc, t, tH + .05, tB, { kind: 'up', y: 400 });
    // B
    const kB = E.back(pr(t, tB + .15, .4)) * (1 - pr(t, tCc - .05, .2)); bg.visible = kB > .01;
    if (bg.visible) {
      const kd = E.io(pr(t, tDp, .5)), hs = [mix(2.0, 3.3, kd), mix(2.0, .3, kd)];
      colB.forEach((c, i) => { const r = i ? 1.9 : -1.9, h = hs[i] * kB; c.scale.y = Math.max(.001, h); c.position.copy(P(r, h / 2, .6)); pwB[i].position.copy(P(r + (i ? kd * .5 : 0), h - (i ? kd * .2 : 0), .6 + (i ? kd * .9 : 0))); pwB[i].rotation.set(i ? kd * 1.1 : 0, 0, i ? -kd * 1.1 : 0); pwB[i].scale.setScalar(Math.max(.001, kB)); });
      lerpCol(cmB[0], C.navy2, C.amber, kd); lerpCol(cmB[1], C.navy2, '#5b1a22', kd);
      crown.visible = t > tDp; crown.position.copy(P(-1.9, hs[0] + mix(4, 1.72, E.bounce(pr(t, tDp, .5))), .6));
      pan.scale.setScalar(Math.max(.001, kB)); const kp = E.out(pr(t, tP, .6)); pb.forEach((b, i) => { const h = Math.max(.001, [1.7, 1.0][i] * kp); b.scale.y = h; b.position.set(i ? .8 : -.8, -1.0 + h / 2, .13); });
      pst.forEach((st, i) => st.set(P(i ? 1.5 : -1.5, 6.6 + 1.35, 0), P(i ? 1.5 : -1.5, 30, 0)));
    }
    tag(lp, P(0, 8.45, 0), { o: kB > .6 ? 1 : 0 });
    la.forEach((e, i) => tag(e, P(i ? 2.6 : -1.9, i ? 0 : 0, i ? 2.0 : .6), { dy: 64, o: pr(t, tDp + .25, .2) * (kB > .6), s: E.back(pr(t, tDp + .25, .3)) }));
    // C
    const kC = pr(t, tCc + .15, .01); cg.visible = kC > 0;
    tvs.forEach((q, i) => { const on = pr(t, tT(i), .12), k = E.back(pr(t, tCc + .15 + i * .03, .3)); q.scale.setScalar(Math.max(.001, k)); lerpCol(scm[i], '#1a2340', i % 2 ? C.amber : '#ffd9a8', on * (.85 + .15 * Math.sin(t * 20 + i))); tag(tl[i], q.userData.p, { o: on * kC, s: .8 * E.back(on) }); });
    dom.forEach((q, i) => { const k = E.in(pr(t, tDo + i * .11, .3)); pop3(q, t, tCc + .2 + i * .02, .25); q.children[0].rotation.z = -k * 1.25; });
    pop3(ur, t, tCc + .3, .3); ur.rotation.z = -.18 * Math.sin(pr(t, tDo + ND * .11 + .1, .5) * Math.PI);
    popH(d18, t, U('s7u11'), null, { kind: 'slam', y: 300 });
  };
});

/* ───────────── 8. TROIS QUESTIONS + CHUTE ───────────── */
defScene(8, s => {
  const g = s.g; stage(g);
  const hs = [2.0, 3.1, 4.2, 3.1, 2.0], bm = hs.map((_, i) => umat(i % 2 ? C.amber : C.red)), bars = bm.map(m => box(1.0, 1, 1.0, m, g)), lo = hs.map(() => strand(g)), hi = hs.map(() => strand(g));
  const ur = urn(g); ur.position.copy(P(0, 0, 3.4)); const bal = box(.9, .05, .6, C.white, g);
  const t3 = s.H('chip amb big', '3 questions'), qs = ['<em>1</em>Qui l’a commandé ?', '<em>2</em>À qui appartient l’institut ?', '<em>3</em>Quelle marge d’erreur ?'].map(x => s.H('q', x));
  const url = s.H('chip navy', '<span style="text-transform:none;font-family:Inter;font-weight:700;font-size:44px;letter-spacing:0">🔎 commission-des-sondages.fr</span>');
  const tQ = [U('s8u2'), U('s8u3'), U('s8u4')], tV = U('s8u7') - .15, tCut = U('s8u8', 0) + .3, tSh = U('s8u9');
  const fin = s.H('chip red big', 'Partage avant le prochain sondage'), ic = s.H('', '<svg width="230" height="230" viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="#E63946" stroke="#0B0F1A" stroke-width="5"/><path d="M28 62c4-17 15-24 30-24V26l20 20-20 20V54c-12 0-22 2-30 8z" fill="#F1FAEE" stroke="#0B0F1A" stroke-width="3" stroke-linejoin="round"/></svg>');
  snd('pop', U('s8u1', 3)); tQ.forEach((x, i) => snd('stamp', x, .9)); snd('ding', U('s8u6', 1)); snd('paper', tV + .35); snd('snip', tCut, 1.3); hs.forEach((_, i) => snd('thunk', tCut + .28 + i * .07, .8)); snd('boom', tCut + .5, 1.2); snd('pop', tSh); snd('ding', tSh + .25);
  source(U('s8u5'), U('s8u7') - .2, 'Les notices de chaque sondage électoral sont publiées sur commission-des-sondages.fr');
  const cp = camPath([[0, { r: 0, y: 3.0, d: 1.0, zoom: 1.0 }], [tV, { y: 2.6, d: 1.4, zoom: 1.12 }], [tSh, { zoom: 1.0, y: 3.0 }, 1.5]]);
  s.update = (t) => {
    setCam(cp(t));
    state.dim = .8 * pr(t, U('s8u1', 3) - .15, .3) * (1 - pr(t, tV, .3));
    popH(t3, t, U('s8u1', 3), tV, { kind: 'slam', y: 310 });
    qs.forEach((q, i) => popH(q, t, tQ[i], tV, { kind: 'up', y: 520 + i * 215 }));
    popH(url, t, U('s8u6', 1), tV, { kind: 'pop', y: 1190 });
    const kc = pr(t, tCut, .5);
    bars.forEach((b, i) => {
      const r = (i - 2) * 1.5, kk = E.bounce(pr(t, tCut + .12 + i * .07, .55)), h = mix(hs[i] + .25 * Math.sin(t * 2 + i * 1.7) * (1 - kc), .22, kk);
      b.scale.y = h; b.position.copy(P(r, h / 2, 0)); lerpCol(bm[i], i % 2 ? C.amber : C.red, '#3a4668', kk);
      const cutY = 7.4 + (i % 2) * .5, top = P(r, h, 0);
      if (t < tCut) { lo[i].set(top, P(r, 30, 0)); hi[i].visible = false; }
      else { const f = E.in(pr(t, tCut, .5)); lo[i].set(top, P(r + f * (i - 2) * .4, mix(cutY, h + .02, f), f * .8)); hi[i].set(P(r, cutY + f * 26, 0), P(r, 30 + f * 26, 0)); hi[i].visible = f < 1; lo[i].visible = f < .98; }
    });
    const kb = pr(t, tV + .25, .55); bal.visible = kb > 0 && kb < 1; bal.position.copy(P(0, mix(5.5, 1.5, E.in(kb)), 3.4)); bal.rotation.set(0, Q, .35 * Math.sin(kb * 9));
    popH(ic, t, tSh, null, { kind: 'pop', y: 330, s: .8 * (1 + .05 * Math.sin(t * 7)) });
    popH(fin, t, tSh + .25, null, { kind: 'slam', y: 510, s: .78, r: -2 });
  };
});
