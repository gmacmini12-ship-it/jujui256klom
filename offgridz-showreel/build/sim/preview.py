"""preview.py -- orthographic point previews (numpy + cv2, no Blender) and contact sheets.

  python preview.py dalle [--dir out/sim/dalle] [--every 12] [--mp4]
  python preview.py filet | deferlement

Writes <dir>/planche.png (contact sheet) and <dir>/apercu.mp4.  Orange points on near-black, 540x960 views.
"""
import argparse
import glob
import json
import os
import subprocess
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "build", "type"))

W, H = 540, 960
BG = (9, 10, 10)                       # BGR of #0A0A09
ORANGE = np.array([15, 71, 234], float)      # BGR of #EA470F
LIGHT = np.array([38, 87, 246], float)       # BGR of #F65726
CREAM = (210, 223, 238)


class View:
    """Orthographic view: (u, v) world axes -> pixels; `depth` axis sign decides draw order/brightness."""

    def __init__(self, name, ax_u, ax_v, flip_u, centre, height, depth_axis, depth_sign):
        self.name, self.ax_u, self.ax_v, self.flip_u = name, ax_u, ax_v, flip_u
        self.cu, self.cv = centre
        self.height = height
        self.width = height * W / H
        self.depth_axis, self.depth_sign = depth_axis, depth_sign
        self.s = H / height

    def px(self, P):
        u = P[..., self.ax_u]
        v = P[..., self.ax_v]
        if self.flip_u:
            u = -u
            cu = -self.cu
        else:
            cu = self.cu
        X = (u - cu) * self.s + W / 2
        Y = H / 2 - (v - self.cv) * self.s
        return X, Y


def draw_points(view, pos, state, spacing, dmin, dmax):
    img = np.zeros((H, W, 3), np.uint8)
    img[:] = BG
    if len(pos) == 0:
        return img
    X, Y = view.px(pos)
    d = view.depth_sign * pos[:, view.depth_axis]
    order = np.argsort(-d)            # far first
    dn = np.clip((d - dmin) / max(dmax - dmin, 1e-9), 0, 1)
    rad = max(0.5 * spacing * view.s * 1.05, 0.8)
    for i in order:
        x, y = X[i], Y[i]
        if x < -3 or y < -3 or x > W + 3 or y > H + 3:
            continue
        k = 1.0 - 0.45 * dn[i]        # nearer = brighter
        col = (ORANGE * (0.35 + 0.65 * k) + LIGHT * 0.0)
        if state[i] == 1:
            col = col * 0.8
        cv2.circle(img, (int(round(x * 16)), int(round(y * 16))), int(round(rad * 16)),
                   tuple(int(c) for c in col), -1, cv2.LINE_AA, 4)
    return img


def poly_overlay(img, view, polys3, color=(80, 85, 90), closed=True, thick=1):
    for P in polys3:
        X, Y = view.px(np.asarray(P, float))
        pts = np.stack([X, Y], 1).astype(np.int32).reshape(-1, 1, 2)
        cv2.polylines(img, [pts], closed, color, thick, cv2.LINE_AA)


def label(img, text):
    cv2.putText(img, text, (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.6, CREAM, 1, cv2.LINE_AA)


# ------------------------------------------------------------------------------------------------
def scene_views(scene, run):
    info = run.get("info", {})
    sp = info.get("spacing", 0.002)
    ov = {}
    if scene == "dalle":
        views = {
            "cam": View("cam", 0, 2, False, (0.0, 0.115), 0.30, 1, -1),       # camera at -y looking +y: x right, z up
            "side": View("side", 1, 2, True, (-0.06, 0.115), 0.30, 0, 1),     # -y to the right (toward the camera side)
        }
        import scenes
        sc = scenes.Dalle(scale=run["scale"])
        polys, holes, chars = sc.letter_polys()
        y0, y1 = sc.LETTER_Y1 - sc.LETTER_THICK, sc.LETTER_Y1
        lp_front = [np.stack([p[:, 0], np.full(len(p), y0), p[:, 1]], 1) for p in polys]
        ov["cam"] = lp_front + [np.array([[-0.5, 0, 0], [0.5, 0, 0]])]
        ov["side"] = [np.array([[0, y1, 0], [0, y0, 0], [0, y0, sc.CAP], [0, y1, sc.CAP]]),
                      np.array([[0, sc.FLOOR_EDGE_Y, 0], [0, 0.0005, 0]]), np.array([[0, 0.0005, 0], [0, 0.0005, 0.3]])]
    elif scene == "filet":
        gy = info["glass_axis"][1]
        views = {
            "cam": View("cam", 0, 2, False, (0.0, -0.215), 0.45, 1, -1),
            "side": View("side", 1, 2, True, (gy - 0.03, -0.215), 0.45, 0, 1),
        }
        rb, rt, h, w = 0.032, 0.034, 0.129, 0.0025
        zb = -0.30
        cup = lambda c, ax: np.array([[c - rb - w, zb - w], [c - rb - w * 0 - w, zb - w], [c - rt - w, zb + h], [c - rt, zb + h], [c - rb, zb], [c + rb, zb],
                                      [c + rt, zb + h], [c + rt + w, zb + h], [c + rb + w, zb - w], [c - rb - w, zb - w]])
        def to3(P2, c_ax):
            return np.array([[(q[0] if c_ax == 0 else 0), (q[0] if c_ax == 1 else 0), q[1]] for q in P2])
        ov["cam"] = [to3(cup(0.0, 0), 0)]
        ov["side"] = [to3(cup(gy, 1), 1)]
    else:
        views = {"top": View("top", 0, 1, False, (0.0, 0.0), 0.192, 2, 1)}
        tx, ty = 0.0504, 0.0756
        ov["top"] = [np.array([[-tx, -ty, 0], [tx, -ty, 0], [tx, ty, 0], [-tx, ty, 0]])]
        a = np.linspace(0, 2 * np.pi, 60)
        ov["top"].append(np.stack([0.012 * np.cos(a), 0.012 * np.sin(a), np.zeros_like(a)], 1))
    return views, ov, sp


def render_frame(scene, f, d, views, ov, sp):
    Z = np.load(os.path.join(d, f"f{f:04d}.npz"))
    pos, st = Z["pos"], Z["state"]
    out = {}
    for name, v in views.items():
        dd = v.depth_sign * pos[:, v.depth_axis] if len(pos) else np.zeros(1)
        img = draw_points(v, pos, st, sp, dd.min() if len(dd) else 0, dd.max() if len(dd) else 1)
        if scene == "deferlement":
            pass
        poly_overlay(img, v, ov.get(name, []))
        label(img, f"{scene} {name}  f{f}  n_free={int(Z['n_free'])}")
        out[name] = img
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("scene", choices=["dalle", "filet", "deferlement"])
    ap.add_argument("--dir", default=None)
    ap.add_argument("--every", type=int, default=12)
    ap.add_argument("--cols", type=int, default=6)
    ap.add_argument("--fps", type=int, default=15)
    ap.add_argument("--no-mp4", action="store_true")
    A = ap.parse_args()
    d = A.dir or os.path.join(ROOT, "out", "sim", A.scene)
    run = json.load(open(os.path.join(d, "run.json")))
    files = sorted(glob.glob(os.path.join(d, "f[0-9][0-9][0-9][0-9].npz")))
    frames = [int(os.path.basename(p)[1:5]) for p in files]
    views, ov, sp = scene_views(A.scene, run)
    sel = frames[::A.every]
    if frames[-1] not in sel:
        sel.append(frames[-1])
    sheets = {n: [] for n in views}
    for f in sel:
        im = render_frame(A.scene, f, d, views, ov, sp)
        for n, i in im.items():
            sheets[n].append(cv2.resize(i, (W // 2, H // 2), interpolation=cv2.INTER_AREA))
    rows = []
    for n, lst in sheets.items():
        c = A.cols
        for i in range(0, len(lst), c):
            r = lst[i:i + c]
            while len(r) < c:
                r.append(np.zeros_like(lst[0]))
            rows.append(np.hstack(r))
    cv2.imwrite(os.path.join(d, "planche.png"), np.vstack(rows))
    print("planche:", os.path.join(d, "planche.png"), "frames", sel)
    if not A.no_mp4:
        tmp = os.path.join(d, "_mp4")
        os.makedirs(tmp, exist_ok=True)
        for p in glob.glob(os.path.join(tmp, "*.png")):
            os.remove(p)
        for k, f in enumerate(frames):
            im = render_frame(A.scene, f, d, views, ov, sp)
            cv2.imwrite(os.path.join(tmp, f"{k:05d}.png"), np.hstack(list(im.values())))
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(A.fps), "-i", os.path.join(tmp, "%05d.png"),
                        "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                        os.path.join(d, "apercu.mp4")], check=True)
        for p in glob.glob(os.path.join(tmp, "*.png")):
            os.remove(p)
        os.rmdir(tmp)
        print("apercu:", os.path.join(d, "apercu.mp4"))


if __name__ == "__main__":
    main()
