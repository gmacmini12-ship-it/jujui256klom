import * as THREE from 'three';

// Générateur pseudo-aléatoire déterministe : la ville est identique à chaque lancement.
export function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function finish(c, { repeat = true } = {}) {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

// Façade : grille de 16 x 16 fenêtres, utilisée comme carte émissive.
export function windowTexture(rand, palette, litRatio) {
  const [c, ctx] = canvas(1024, 1024);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 1024, 1024);
  for (let row = 0; row < 16; row++) {
    const floorLit = rand() < 0.12; // étage entièrement éclairé
    for (let col = 0; col < 16; col++) {
      const x = col * 64 + 12;
      const y = row * 64 + 16;
      if (floorLit || rand() < litRatio) {
        const color = palette[Math.floor(rand() * palette.length)];
        ctx.globalAlpha = 0.35 + rand() * 0.65;
        ctx.fillStyle = color;
        ctx.fillRect(x, y, 40, 34);
        if (rand() < 0.3) {
          // store à moitié baissé
          ctx.globalAlpha = 0.7;
          ctx.fillStyle = '#000';
          ctx.fillRect(x, y, 40, 8 + rand() * 18);
        }
      } else {
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#04060b';
        ctx.fillRect(x, y, 40, 34);
      }
    }
  }
  ctx.globalAlpha = 1;
  return finish(c);
}

const FONT = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans CJK JP", "Arial Black", Arial, sans-serif';

// Enseigne néon, horizontale ou verticale.
export function signTexture(text, color, vertical) {
  const [c, ctx] = vertical ? canvas(256, 1024) : canvas(1024, 256);
  const { width: w, height: h } = c;
  ctx.fillStyle = 'rgba(4, 3, 12, 0.88)';
  ctx.fillRect(0, 0, w, h);

  ctx.shadowColor = color;
  ctx.shadowBlur = 28;
  ctx.strokeStyle = color;
  ctx.lineWidth = 10;
  ctx.strokeRect(18, 18, w - 36, h - 36);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  const chars = [...text];
  if (vertical) {
    const step = (h - 90) / chars.length;
    const size = Math.min(170, step * 0.9);
    ctx.font = `900 ${size}px ${FONT}`;
    chars.forEach((ch, i) => {
      const y = 45 + step * (i + 0.5);
      ctx.fillText(ch, w / 2, y);
      ctx.fillText(ch, w / 2, y);
    });
  } else {
    let size = 150;
    ctx.font = `900 ${size}px ${FONT}`;
    const width = ctx.measureText(text).width;
    if (width > w - 110) {
      size *= (w - 110) / width;
      ctx.font = `900 ${size}px ${FONT}`;
    }
    ctx.fillText(text, w / 2, h / 2 + 6);
    ctx.fillText(text, w / 2, h / 2 + 6);
  }
  return finish(c, { repeat: false });
}

// Vitrine au rez-de-chaussée (motif répété tous les 8 m).
export function shopTexture(rand, hueA, hueB) {
  const [c, ctx] = canvas(512, 256);
  ctx.fillStyle = '#06070c';
  ctx.fillRect(0, 0, 512, 256);

  // bandeau lumineux
  ctx.fillStyle = `hsl(${hueA}, 100%, 60%)`;
  ctx.fillRect(0, 14, 512, 7);

  const panes = [
    [16, 150],
    [182, 96],
    [294, 202],
  ];
  panes.forEach(([x, w], i) => {
    const g = ctx.createLinearGradient(0, 44, 0, 236);
    const hue = i === 1 ? hueB : hueA;
    g.addColorStop(0, `hsla(${hue}, 90%, 62%, 0.85)`);
    g.addColorStop(1, `hsla(${hue + 30}, 90%, 28%, 0.7)`);
    ctx.fillStyle = g;
    ctx.fillRect(x, 44, w, 192);
    // silhouettes et étagères
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    for (let k = 0; k < 5; k++) {
      const bw = 10 + rand() * 30;
      const bh = 30 + rand() * 90;
      ctx.fillRect(x + rand() * (w - bw), 236 - bh, bw, bh);
    }
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(x, 120 + rand() * 30, w, 4);
  });
  // montant de porte
  ctx.fillStyle = '#020204';
  ctx.fillRect(234, 44, 6, 192);
  return finish(c);
}

// Carte d'opacité de la chaussée : les zones sombres laissent voir le reflet (flaques).
export function puddleTexture(rand) {
  const [c, ctx] = canvas(512, 512);
  ctx.fillStyle = 'rgb(236, 236, 236)';
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 46; i++) {
    const x = rand() * 512;
    const y = rand() * 512;
    const r = 22 + rand() * 70;
    // dessiné 9 fois pour que le motif se répète sans couture
    for (let ox = -512; ox <= 512; ox += 512) {
      for (let oy = -512; oy <= 512; oy += 512) {
        const g = ctx.createRadialGradient(x + ox, y + oy, r * 0.2, x + ox, y + oy, r);
        g.addColorStop(0, 'rgba(120, 120, 120, 0.95)');
        g.addColorStop(1, 'rgba(120, 120, 120, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}
