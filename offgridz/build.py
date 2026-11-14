import os, sys, math, subprocess
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont

W, H, FPS, DUR = 1080, 1920, 30, 15.0
NF = int(FPS * DUR)
SRC = '/tmp/claude-0/-home-user-jujui256klom/3db5b184-2b55-55a2-a11a-f08b63537c6a/images/1.webp'
src = np.array(Image.open(SRC).convert('RGB'))

def cl(x, a=0.0, b=1.0): return min(max(x, a), b)
def eo3(x): x = cl(x); return 1 - (1 - x) ** 3
def eo5(x): x = cl(x); return 1 - (1 - x) ** 5
def eio3(x):
    x = cl(x); return 4 * x ** 3 if x < .5 else 1 - (-2 * x + 2) ** 3 / 2
def eio5(x):
    x = cl(x); return 16 * x ** 5 if x < .5 else 1 - (-2 * x + 2) ** 5 / 2
def lerp(a, b, t): return a + (b - a) * t
def prog(t, t0, d): return cl((t - t0) / d)

# ---------- panels ----------
PAN = {'A': (2, 89, 428, 787), 'B': (436, 89, 862, 787), 'C': (2, 795, 428, 1535), 'D': (436, 795, 862, 1535)}
XB = {'A': 0.0, 'B': 0.0, 'C': 0.5, 'D': 0.5}

class Panel:
    def __init__(self, key):
        x0, y0, x1, y1 = PAN[key]
        self.key = key
        self.src = src[y0:y1, x0:x1].copy()
        self.h, self.w = self.src.shape[:2]
        self.k = H / self.h
        self.nw = int(round(self.w * self.k))
        self.xoff = int((self.nw - W) * XB[key])
        self.orig = self.up(self.src)
        self.clean = self.orig
        self.union = np.zeros((self.h, self.w), np.uint8)
        self.els = []

    def up(self, img, interp=cv2.INTER_LANCZOS4):
        r = cv2.resize(img, (self.nw, H), interpolation=interp)
        return r[:, self.xoff:self.xoff + W].copy()

    def pbox(self, b):  # panel bbox -> base bbox
        x0 = int(max(0, b[0] * self.k - self.xoff)); x1 = int(min(W, b[2] * self.k - self.xoff))
        y0 = int(max(0, b[1] * self.k)); y1 = int(min(H, b[3] * self.k))
        return x0, y0, x1, y1

    def add(self, bbox, pred, t0, dur, dirn='right', dil=2, par=None, feather=0.25):
        m = np.zeros((self.h, self.w), np.uint8)
        x0, y0, x1, y1 = bbox
        if pred is None:
            m[y0:y1, x0:x1] = 255
        else:
            sub = self.src[y0:y1, x0:x1].astype(int)
            m[y0:y1, x0:x1] = pred(sub).astype(np.uint8) * 255
            if dil: m = cv2.dilate(m, np.ones((2 * dil + 1, 2 * dil + 1), np.uint8))
        self.union = cv2.bitwise_or(self.union, m)
        self.els.append(dict(rect=pred is None, m=m, bbox=bbox, t0=t0, dur=dur, dirn=dirn, par=par, feather=feather))

    def finish(self, inpaint_r=3):
        if self.els:
            cl_src = cv2.inpaint(self.src, self.union, inpaint_r, cv2.INPAINT_TELEA)
            for e in self.els:
                if e.get('rect'):
                    x0, y0, x1, y1 = e['bbox']
                    ring = np.concatenate([self.src[y0-7:y0-2, x0:x1].reshape(-1,3), self.src[y1+2:y1+7, x0:x1].reshape(-1,3), self.src[y0:y1, x1+2:x1+7].reshape(-1,3)])
                    col = np.median(ring, axis=0)
                    fill = np.empty((y1-y0, x1-x0, 3), np.float32); fill[:] = col
                    # vertical gradient between top/bottom ring medians
                    rr = self.src[y0:y1, x1+3:x1+8]; ct = np.median(rr[:12].reshape(-1,3), axis=0); cb = np.median(rr[-12:].reshape(-1,3), axis=0)
                    g = np.linspace(0, 1, y1-y0)[:, None, None]
                    fill = ct * (1-g) + cb * g
                    rng2 = np.random.RandomState(3); fill = fill + rng2.randn(y1-y0, x1-x0, 1) * 1.5
                    cl_src[y0:y1, x0:x1] = np.clip(fill, 0, 255).astype(np.uint8)
            self.clean = self.up(cl_src)
        out = []
        for e in self.els:
            bx0, by0, bx1, by1 = self.pbox(e['bbox'])
            a = self.up(e['m'], cv2.INTER_LINEAR).astype(np.float32) / 255.0
            a = cv2.GaussianBlur(a, (0, 0), 0.8)[by0:by1, bx0:bx1]
            rgb = self.orig[by0:by1, bx0:bx1]
            hh, ww = a.shape
            ys, xs = np.mgrid[0:hh, 0:ww].astype(np.float32)
            d = e['dirn']
            u = {'right': xs / max(ww - 1, 1), 'left': 1 - xs / max(ww - 1, 1),
                 'down': ys / max(hh - 1, 1), 'up': 1 - ys / max(hh - 1, 1)}[d]
            out.append(dict(e, box=(bx0, by0, bx1, by1), a=a, rgb=rgb, u=u))
        self.els = out

    def compose(self, t):
        comp = self.clean.copy()
        for e in self.els:
            p = eio3(prog(t, e['t0'], e['dur']))
            if p <= 0: continue
            f = e['feather']
            m = np.clip((p * (1 + f) - e['u']) / f, 0, 1) if p < 1 else 1.0
            a = (e['a'] * m)[..., None]
            x0, y0, x1, y1 = e['box']
            dx, dy = (0, 0)
            if e['par']: dx, dy = e['par'](t)
            dx, dy = int(round(dx)), int(round(dy))
            X0, Y0, X1, Y1 = x0 + dx, y0 + dy, x1 + dx, y1 + dy
            cx0, cy0, cx1, cy1 = max(X0, 0), max(Y0, 0), min(X1, W), min(Y1, H)
            if cx1 <= cx0 or cy1 <= cy0: continue
            sa = a[cy0 - Y0:cy1 - Y0, cx0 - X0:cx1 - X0]
            sr = e['rgb'][cy0 - Y0:cy1 - Y0, cx0 - X0:cx1 - X0]
            reg = comp[cy0:cy1, cx0:cx1].astype(np.float32)
            comp[cy0:cy1, cx0:cx1] = (reg * (1 - sa) + sr * sa).astype(np.uint8)
        return comp

def warp(img, s, cx, cy, interp=cv2.INTER_LINEAR):
    s = max(s, 1.0)
    cx = cl(cx, W / 2 / s, W - W / 2 / s); cy = cl(cy, H / 2 / s, H - H / 2 / s)
    M = np.float32([[s, 0, W / 2 - cx * s], [0, s, H / 2 - cy * s]])
    return cv2.warpAffine(img, M, (W, H), flags=interp, borderMode=cv2.BORDER_REPLICATE)

# ---------- predicates ----------
def cream(sub): return (sub[..., 0] > 185) & (sub[..., 1] > 175) & (sub[..., 2] > 150)
def light(sub): return (sub.min(-1) > 150)
def red(sub): return (sub[..., 0] > 130) & (sub[..., 1] < 105) & (sub[..., 2] < 105) & (sub[..., 0] - sub[..., 1] > 60)
def white(sub): return sub.min(-1) > 175
def dark(sub): return (sub[..., 0] < 125) & (sub[..., 1] < 105) & (sub[..., 2] < 95)

# ================= SCENE A : SILLAGE =================
A = Panel('A')
A.add((6, 4, 108, 462), cream, 0.45, 0.95, 'up', dil=2, par=lambda t: (-34 * (1 - eo3(prog(t, 0.45, 1.4))), 0))
A.add((14, 488, 152, 540), light, 1.25, 0.55, 'right', dil=2)
A.add((14, 548, 152, 668), light, 1.55, 0.8, 'right', dil=2, par=lambda t: (-18 * (1 - eo3(prog(t, 1.55, 1.2))), 0))
A.finish()

def cam_A(t):
    p = eo5(prog(t, 0, 1.9))
    s = lerp(1.32, 1.04, p) + 0.05 * prog(t, 1.9, 1.3)
    cx = lerp(760, 540, p); cy = lerp(1000, 980, p)
    return s, cx, cy
def scene_A(t): return warp(A.compose(t), *cam_A(t))

# ================= SCENE B : BRUT =================
B = Panel('B')
tb = 3.0
B.add((6, 70, 112, 452), red, tb + 0.4, 0.8, 'up', dil=3, par=lambda t: (0, 40 * (1 - eo3(prog(t, tb + .4, 1.4)))))
B.add((8, 20, 104, 48), red, tb + 0.35, 0.4, 'right', dil=2)
B.add((120, 95, 300, 242), red, tb + 1.0, 0.7, 'down', dil=2)
B.add((170, 385, 395, 562), red, tb + 1.6, 0.8, 'right', dil=2)
B.add((14, 548, 168, 652), white, tb + 2.05, 0.6, 'right', dil=2)
B.add((14, 656, 64, 674), red, tb + 2.5, 0.35, 'right', dil=2)
B.finish(inpaint_r=4)

def cam_B(t):
    p = eio3(prog(t, 3.0, 3.0))
    s = lerp(1.0, 1.15, p)
    cx = lerp(540, 300, p); cy = lerp(960, 800, p)
    return s, cx, cy
def scene_B(t): return warp(B.compose(t), *cam_B(t))
RED = tuple(int(v) for v in np.median(B.src[red(B.src)], axis=0)) if red(B.src).any() else (225, 20, 20)

# ================= SCENE C : SAUVAGE =================
C = Panel('C')
C.add((18, 20, 130, 82), cream, 6.9, 0.6, 'right', dil=2)
C.finish()
poly = np.array([(338,0),(300,24),(262,62),(225,100),(180,135),(135,175),(95,215),(55,265),(20,320),(0,355),(0,640),(50,600),(110,560),(170,525),(215,498),(250,478),(290,455),(350,440),(430,430),(430,0)], np.float32) - 2
pm = np.zeros((C.h, C.w), np.uint8)
cv2.fillPoly(pm, [np.round(poly).astype(np.int32)], 255)
pm = cv2.erode(pm, np.ones((19, 19), np.uint8))
pmask = C.up(pm, cv2.INTER_LINEAR).astype(np.float32) / 255.0
pmask = cv2.GaussianBlur(pmask, (0, 0), 2.0)[..., None]
BAND_C = (260 * C.k - C.xoff, 250 * C.k)

def cam_C(t):
    p = prog(t, 6.0, 3.0)
    return lerp(1.0, 1.1, eio3(p)), lerp(540, 520, p), lerp(960, 930, p)

def scene_C(t):
    s, cx, cy = cam_C(t)
    out = warp(C.compose(t), s * lerp(1.0, 1.04, eo3(prog(t, 6.0, 1.5))) if False else s, cx, cy)
    bp = eo5(prog(t, 6.0, 1.4))
    bs = lerp(1.28, 1.0, bp)
    img = C.compose(t)
    # band content: extra scale about band centre + diagonal slide
    s2 = s * bs
    bx, by = BAND_C
    M = np.float32([[s2, 0, 0], [0, s2, 0]])
    # base -> screen with camera, then scale about band centre (screen space)
    ccx = cl(cx, W / 2 / s, W - W / 2 / s); ccy = cl(cy, H / 2 / s, H - H / 2 / s)
    sx = (bx - ccx) * s + W / 2; sy = (by - ccy) * s + H / 2
    A1 = np.float32([[s, 0, W / 2 - ccx * s], [0, s, H / 2 - ccy * s]])
    # screen-space scale about (sx,sy)
    shift = (70 * (1 - bp), -90 * (1 - bp))
    M2 = np.float32([[bs, 0, sx - bs * sx + shift[0]], [0, bs, sy - bs * sy + shift[1]]])
    full = np.vstack([A1, [0, 0, 1]]); full = M2 @ full
    band = cv2.warpAffine(img, full, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    # outside: slight counter push (depth)
    so = lerp(1.0, 1.0, 0)
    mk = warp(pmask, s, cx, cy)
    if mk.ndim == 2: mk = mk[..., None]
    return (out * (1 - mk) + band * mk).astype(np.uint8)

# ================= SCENE D : LE LEVAIN =================
D = Panel('D')
td = 9.0
D.add((8, 6, 316, 100), dark, td + 0.55, 0.6, 'right', dil=2)
D.add((6, 118, 278, 304), dark, td + 0.95, 0.7, 'right', dil=2)
for i, (py, ty) in enumerate([(329, 345), (461, 478), (594, 612)]):
    t0 = td + 1.5 + i * 0.42
    D.add((10, py, 198, py + 121), None, t0, 0.4, 'right', dil=0, feather=0.1)
    D.add((208, ty, 302, ty + 90), dark, t0 + 0.22, 0.4, 'right', dil=2)
HAND_BOX = (372, 186, 428, 222)
D.add(HAND_BOX, dark, 0, 0.01, 'right', dil=2)  # handled specially below
D.finish(inpaint_r=3)
HAND = D.els.pop()
CENTER = (470 * D.k - D.xoff, 230 * D.k)

def hand_layer(comp, t):
    x0, y0, x1, y1 = HAND['box']
    pad = 90
    wx0, wy0, wx1, wy1 = max(0, x0 - pad), max(0, y0 - pad), min(W, x1 + pad), min(H, y1 + pad)
    spr = np.zeros((wy1 - wy0, wx1 - wx0, 4), np.float32)
    spr[y0 - wy0:y1 - wy0, x0 - wx0:x1 - wx0, :3] = HAND['rgb']
    spr[y0 - wy0:y1 - wy0, x0 - wx0:x1 - wx0, 3] = HAND['a']
    # tick motion: 1.5deg per beat, easeOutBack
    tt = t - (td + 0.9)
    n = math.floor(tt / 0.5) if tt > 0 else 0
    fr = (tt / 0.5 - n) if tt > 0 else 0
    kick = 1 - (1 - cl(fr * 2.5)) ** 3 + 0.25 * math.sin(math.pi * cl(fr * 2.5)) * (1 - cl(fr * 2.5))
    ang = -3.0 + 1.6 * (n + kick) if tt > 0 else -3.0
    R = cv2.getRotationMatrix2D((CENTER[0] - wx0, CENTER[1] - wy0), -ang, 1.0)
    rot = cv2.warpAffine(spr, R, (wx1 - wx0, wy1 - wy0), flags=cv2.INTER_LINEAR)
    a = rot[..., 3:4]
    reg = comp[wy0:wy1, wx0:wx1].astype(np.float32)
    comp[wy0:wy1, wx0:wx1] = (reg * (1 - a) + rot[..., :3] * a).astype(np.uint8)
    return comp

def cam_D(t):
    p0 = eo3(prog(t, 9.0, 1.4))
    s = lerp(1.12, 1.18, p0); cx, cy = 600, 560
    # scroll down to photos
    q = eio5(prog(t, 10.45, 0.8))
    s = lerp(s, 1.22, q); cy = lerp(cy, 1480, q); cx = lerp(cx, 520, q)
    # pull back
    r = eio3(prog(t, 11.45, 0.55))
    s = lerp(s, 1.0, r); cx = lerp(cx, 540, r); cy = lerp(cy, 960, r)
    return s, cx, cy

def scene_D_full(t):
    comp = hand_layer(D.compose(t), t)
    return warp(comp, *cam_D(t))

# ================= SCENES dispatch =================
def scene_at(key, t):
    return {'A': scene_A, 'B': scene_B, 'C': scene_C, 'D': scene_D_full}[key](t)

# ---------- transitions ----------
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
def tr_red(a_img, b_img, t):
    lead = eio3(prog(t, 2.85, 0.2)) * (W + 4)
    trail = eio3(prog(t, 2.98, 0.24)) * (W + 4)
    out = a_img.copy()
    x_l, x_t = int(lead), int(trail)
    out[:, :x_l] = RED
    if x_t > 0: out[:, :x_t] = b_img[:, :x_t]
    return out

rng = np.random.RandomState(7)
def noise1d(n, scales):
    v = np.zeros(n, np.float32)
    for sc, amp in scales:
        pts = rng.randn(n // sc + 3).astype(np.float32)
        v += amp * np.interp(np.arange(n) / sc, np.arange(len(pts)), pts)
    return v
NZ = noise1d(4000, [(260, 20), (70, 12), (22, 6), (7, 2.5)])
NZ2 = noise1d(4000, [(90, 4), (18, 3), (5, 2)])
nx, ny = 0.74, 0.67  # normal to the "/" tear line
S_GRID = xx * nx + yy * ny
V_GRID = (xx * (-ny) + yy * nx + 1500).astype(np.int32)
S_MIN, S_MAX = float(S_GRID.min()), float(S_GRID.max())
def tr_tear(b_img, c_img, t):
    p = eio3(prog(t, 5.88, 0.5))
    front = lerp(S_MIN - 80, S_MAX + 80, p)
    edge = front + NZ[V_GRID]
    rimw = 26 + NZ2[V_GRID] * 2.2
    new_m = (S_GRID < edge)
    rim_m = (S_GRID >= edge) & (S_GRID < edge + rimw)
    out = b_img.copy()
    # shadow on old scene
    sh = np.clip(1 - (S_GRID - edge - rimw) / 70.0, 0, 1) * 0.35
    sh[S_GRID < edge + rimw] = 0
    out = (out * (1 - sh[..., None])).astype(np.uint8)
    out[new_m] = c_img[new_m]
    paper = np.array([246, 241, 232], np.float32)
    g = (0.92 + 0.08 * np.clip((S_GRID - edge) / rimw, 0, 1))[..., None]
    out[rim_m] = (paper * g)[rim_m].astype(np.uint8) if False else (paper * g.repeat(3, -1))[rim_m].astype(np.uint8)
    return out

def tr_paper(c_img, d_img, t):
    p = eio3(prog(t, 8.82, 0.62))
    edge = int(round(H * (1 - p)))
    out = (c_img.astype(np.float32) * lerp(1.0, 0.7, p)).astype(np.uint8)
    off = int(-120 * p)
    out = np.roll(out, off, axis=0) if off else out
    if edge < H:
        # shadow above the sheet edge
        sh_h = 90
        y0 = max(0, edge - sh_h)
        ramp = np.linspace(0, 0.45, edge - y0)[:, None, None] if edge > y0 else None
        if ramp is not None: out[y0:edge] = (out[y0:edge] * (1 - ramp)).astype(np.uint8)
        out[edge:] = d_img[:H - edge]
        # highlight lip
        if edge + 3 < H: out[edge:edge + 3] = (out[edge:edge + 3] * 0.6 + 255 * 0.4).astype(np.uint8)
    return out

# ---------- mosaic ----------
CELLS = {'A': (0, 0, 540, 960), 'B': (540, 0, 540, 960), 'C': (0, 960, 540, 960), 'D': (540, 960, 540, 960)}
SHR = {'D': 12.0, 'C': 12.16, 'B': 12.32, 'A': 12.48}
MOS_BG = (9, 9, 9)
def paste_rect(canvas, img, x, y, w, h):
    w, h = int(round(w)), int(round(h))
    if w < 2 or h < 2: return
    r = cv2.resize(img, (w, h), interpolation=cv2.INTER_AREA)
    x, y = int(round(x)), int(round(y))
    x0, y0, x1, y1 = max(x, 0), max(y, 0), min(x + w, W), min(y + h, H)
    if x1 > x0 and y1 > y0: canvas[y0:y1, x0:x1] = r[y0 - y:y1 - y, x0 - x:x1 - x]

def mosaic_frame(t, with_logo=True):
    canvas = np.full((H, W, 3), MOS_BG, np.uint8)
    for key in ['A', 'B', 'C', 'D']:
        pnl = {'A': A, 'B': B, 'C': C, 'D': D}[key].orig
        p = eio5(prog(t, SHR[key], 0.5))
        cx_, cy_, cw, ch = CELLS[key]
        gap = 5 * p
        x = lerp(0, cx_ + gap, p); y = lerp(0, cy_ + gap, p)
        w = lerp(W, cw - 2 * gap, p); h = lerp(H, ch - 2 * gap, p)
        paste_rect(canvas, pnl, x, y, w, h)
    return canvas

# ---------- logo ----------
CREAM = (240, 229, 208)
F_LOGO = ImageFont.truetype('/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf', 96)
F_SUB = ImageFont.truetype('/usr/share/fonts/opentype/inter/Inter-Medium.otf', 27)
F_SLO = ImageFont.truetype('/usr/share/fonts/opentype/inter/InterDisplay-Bold.otf', 44)

def letter_sprites(text, font, track):
    sp = []
    for ch in text:
        bb = font.getbbox(ch)
        adv = font.getlength(ch)
        sp.append((ch, adv))
    return sp

def draw_tracked(layer_draw, text, font, track, cx, y, alpha_fn, color, offs_fn=None):
    widths = [font.getlength(c) for c in text]
    total = sum(widths) + track * (len(text) - 1)
    x = cx - total / 2
    for i, ch in enumerate(text):
        a = alpha_fn(i, len(text))
        if a > 0.003:
            dy = offs_fn(i, len(text)) if offs_fn else 0
            layer_draw.text((x, y + dy), ch, font=font, fill=color + (int(255 * a),))
        x += widths[i] + track
    return total

def logo_overlay(t):
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    base = 13.08
    tr = lerp(60, 34, eo5(prog(t, base, 1.4)))
    def a_logo(i, n): return eo3(prog(t, base + 0.07 * i, 0.5))
    def o_logo(i, n): return 40 * (1 - eo5(prog(t, base + 0.07 * i, 0.7)))
    draw_tracked(d, 'OFFGRIDZ', F_LOGO, tr, W / 2 + 17, 830, a_logo, CREAM, o_logo)
    # rule + sub
    lp = eo5(prog(t, base + 0.75, 0.6))
    if lp > 0:
        half = 250 * lp
        d.line((W / 2 - half, 965, W / 2 + half, 965), fill=CREAM + (150,), width=2)
    def a_sub(i, n): return eo3(prog(t, base + 0.85 + 0.025 * i, 0.4))
    draw_tracked(d, 'STUDIO CRÉATIF', F_SUB, 20, W / 2 + 10, 985, a_sub, CREAM)
    # slogan
    def a_s(i, n): return eo3(prog(t, 13.95 + 0.018 * i, 0.35))
    def o_s(i, n): return 18 * (1 - eo5(prog(t, 13.95 + 0.018 * i, 0.5)))
    draw_tracked(d, 'FOUR WORLDS.', F_SLO, 14, W / 2 + 7, 1120, a_s, CREAM, o_s)
    def a_s2(i, n): return eo3(prog(t, 14.2 + 0.018 * i, 0.35))
    draw_tracked(d, 'ONE STUDIO.', F_SLO, 14, W / 2 + 7, 1185, a_s2, CREAM, o_s)
    return np.array(img)

def frame_final(t):
    m = mosaic_frame(t)
    dim = 0.78 * eo3(prog(t, 13.0, 0.35))
    m = (m.astype(np.float32) * (1 - dim)).astype(np.uint8)
    if t >= 13.0:
        ov = logo_overlay(t).astype(np.float32)
        a = ov[..., 3:4] / 255.0
        m = (m * (1 - a) + ov[..., :3] * a).astype(np.uint8)
    return m

# ---------- master ----------
def render(i):
    t = i / FPS
    if t < 2.85: return scene_at('A', t)
    if t < 3.26: return tr_red(scene_at('A', min(t, 3.0)), scene_at('B', t), t)
    if t < 5.88: return scene_at('B', t)
    if t < 6.4: return tr_tear(scene_at('B', min(t, 6.0)), scene_at('C', t), t)
    if t < 8.82: return scene_at('C', t)
    if t < 9.45: return tr_paper(scene_at('C', min(t, 9.0)), scene_at('D', t), t)
    if t < 12.0: return scene_at('D', t)
    return frame_final(t)

if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'prev':
        os.makedirs('/tmp/w/prev', exist_ok=True)
        for tt in [float(x) for x in sys.argv[2:]]:
            f = render(int(round(tt * FPS)))
            Image.fromarray(f).save(f'/tmp/w/prev/f_{tt:05.2f}.png')
        sys.exit()
    from multiprocessing import Pool
    out = sys.argv[1]
    audio = sys.argv[2] if len(sys.argv) > 2 else None
    cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-']
    if audio: cmd += ['-i', audio]
    cmd += ['-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-r', str(FPS)]
    if audio: cmd += ['-c:a', 'aac', '-b:a', '256k', '-shortest']
    cmd += ['-t', '15', '-movflags', '+faststart', out]
    pr = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    with Pool(os.cpu_count()) as pool:
        for n, fr in enumerate(pool.imap(render, range(NF), chunksize=2)):
            pr.stdin.write(np.ascontiguousarray(fr).tobytes())
            if n % 30 == 0: print('frame', n, flush=True)
    pr.stdin.close(); pr.wait()
