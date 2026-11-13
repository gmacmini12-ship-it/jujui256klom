"""checks.py -- measurements on the written frames. Resolution independent (the matter layer may be 540x960 or 1080x1920).

  python build/seq56/checks.py [--out out/final/seq56] [--matiere-dir DIR] [--tag _pt]

Writes <out>/checks<tag>.json.  Frames that are not present in the matter directory are skipped (stills, partial passes).
"""
import argparse
import json
import os
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from common import ROOT, W, H, WIN, tip_y, LOGO_Y_IN_WIN, WIN_W, WIN_H  # noqa: E402


def rd(path):
    a = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    assert a is not None and a.dtype == np.uint16, path
    return a


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "out", "final", "seq56"))
    ap.add_argument("--matiere-dir", default=None)
    ap.add_argument("--tag", default="")
    A = ap.parse_args()
    mdir = os.path.abspath(A.matiere_dir) if A.matiere_dir else os.path.join(A.out, "matiere")
    R = {"matiere_dir": mdir}
    have = sorted(int(p[1:5]) for p in os.listdir(mdir) if p.startswith("f") and p.endswith(".png"))
    R["frames_present"] = [have[0], have[-1], len(have)] if have else []

    def mat(f):
        return rd(os.path.join(mdir, "f%04d.png" % f))

    def alpha(f):
        return mat(f)[:, :, 3].astype(np.float32) / 65535

    win = lambda f: rd(os.path.join(A.out, "fenetre", "f%04d.png" % f))
    m0 = mat(have[0])
    hh, ww = m0.shape[:2]
    k = ww / float(W)
    R["format"] = dict(matiere_shape=list(m0.shape), matiere_dtype=str(m0.dtype), fenetre_shape=list(win(456).shape),
                       fenetre_dtype=str(win(456).dtype),
                       n_fenetre=len([p for p in os.listdir(os.path.join(A.out, "fenetre")) if p.endswith(".png")]))
    x0, y0, x1, y1 = [int(round(v * k)) for v in WIN]
    mask = np.ones((hh, ww), bool)
    mask[y0:y1, x0:x1] = False
    mw = max(int(round(2 * k)), 1)            # ignore the 1-2 px antialiasing ring on the rim
    mask_clean = np.ones((hh, ww), bool)
    mask_clean[max(y0 - mw, 0):y1 + mw, max(x0 - mw, 0):x1 + mw] = False

    if 456 in have:
        a = alpha(456)
        inside = a[y0:y1, x0:x1]
        R["f456"] = dict(window_alpha_mean=float(inside.mean()), window_fraction_alpha_ge_099=float((inside >= 0.99).mean()),
                         window_alpha_min=float(inside.min()),
                         margin_alpha_max=float(a[mask].max()), margin_pixels_alpha_gt_001=int((a[mask] > 0.01).sum()),
                         margin_pixels_alpha_gt_001_beyond_rim_ring=int((a[mask_clean] > 0.01).sum()),
                         margin_alpha_max_beyond_rim_ring=float(a[mask_clean].max()), margin_pixels_total=int(mask.sum()))
    cov = {}
    for f in (460, 470, 474, 476, 478, 479, 480, 490, 500, 503, 504):
        if f not in have:
            continue
        a = alpha(f)
        e = max(int(round(20 * k)), 2)
        cov[str(f)] = {"sheet_cover_ge_0.5": float((a >= 0.5).mean()), "margin_cover_ge_0.5": float((a[mask] >= 0.5).mean()),
                       "edge_bands_20px_cover": dict(top=float((a[:e] >= 0.5).mean()), bottom=float((a[-e:] >= 0.5).mean()),
                                                     left=float((a[:, :e] >= 0.5).mean()), right=float((a[:, -e:] >= 0.5).mean()))}
    R["coverage"] = cov
    # squeegee: rows made of opaque, low-saturation pixels (cream rubber and aluminium; the ink is saturated orange)
    sq = {}
    for f in range(504, 528):
        if f not in have:
            continue
        m = mat(f).astype(np.float32) / 65535
        r_, g_, b_, a_ = m[..., 2], m[..., 1], m[..., 0], m[..., 3]
        mx = np.maximum(np.maximum(r_, g_), b_)
        mn = np.minimum(np.minimum(r_, g_), b_)
        sat = (mx - mn) / np.maximum(mx, 1e-4)
        tool = (a_ > 0.98) & (sat < 0.40) & (mx > 0.25)
        rows = np.nonzero(tool.mean(axis=1) > 0.6)[0]
        e = dict(tip_expected_px=float(tip_y(f)))
        if len(rows):
            # the tool is a contiguous block ending at the tip (its lowest row)
            e["tool_rows_detected"] = [int(rows.min() / k), int((rows.max() + 1) / k)]
            e["tip_measured_px"] = float((rows.max() + 1) / k)
            e["tip_error_px"] = float((rows.max() + 1) / k - tip_y(f))
        else:
            e["tool_rows_detected"] = None
        sq[str(f)] = e
    R["squeegee"] = sq
    for f in (526, 527):
        if f in have:
            a = alpha(f)
            R["f%d" % f] = dict(max_alpha=float(a.max()), mean_alpha=float(a.mean()), fraction_alpha_gt_0_005=float((a > 0.005).mean()))
    # window: black until the reveal, flat from 574
    W456 = win(456)
    R["window"] = dict(black_frames_identical_456_503=bool(all(np.array_equal(win(f), W456) for f in (480, 503))),
                       black_value_16bit=[int(v) for v in W456[0, 0, ::-1]])
    flat = win(574).astype(np.int32)
    R["window"]["frames_574_to_599_identical"] = bool(all(np.array_equal(win(f).astype(np.int32), flat) for f in (574, 580, 590, 599)))
    import window as wmod
    lg, _ = wmod.logo_recomposed_1254()
    ref = cv2.resize(lg.astype(np.float32), (WIN_W, WIN_W), interpolation=cv2.INTER_AREA) / 255.0
    ref16 = np.round(ref * 65535).astype(np.int32)[:, :, ::-1]
    got = flat[LOGO_Y_IN_WIN:LOGO_Y_IN_WIN + WIN_W]
    d = np.abs(got - ref16)
    R["flat_logo"] = dict(vs_recomposition_16bit_max_abs=int(d.max()), mean_abs=float(d.mean()),
                          outside_logo_square_is_black=bool(np.all(flat[:LOGO_Y_IN_WIN] == flat[0, 0]) and np.all(flat[LOGO_Y_IN_WIN + WIN_W:] == flat[0, 0])))
    src = cv2.imread(os.path.join(ROOT, "assets", "logo", "source", "offgridz-logo-1254.png")).astype(np.float32)[:, :, ::-1]
    src_s = cv2.resize(src, (WIN_W, WIN_W), interpolation=cv2.INTER_AREA)
    ln = cv2.imread(os.path.join(ROOT, "assets", "logo", "layer_lines.png"), cv2.IMREAD_UNCHANGED)[:, :, 3]
    ln = cv2.resize(ln, (WIN_W, WIN_W), interpolation=cv2.INTER_AREA)
    lm = cv2.dilate((ln > 2).astype(np.uint8), np.ones((9, 9), np.uint8)) > 0
    got8 = got[:, :, ::-1].astype(np.float32) / 65535 * 255
    dd = np.abs(got8 - src_s).mean(axis=2)
    mse = float(((got8 - src_s) ** 2)[~lm].mean())
    R["flat_logo"]["vs_source_outside_lines"] = dict(mean_abs_8bit=float(dd[~lm].mean()), p99_abs_8bit=float(np.percentile(dd[~lm], 99)),
                                                    psnr_db=float(10 * np.log10(255 ** 2 / max(mse, 1e-9))), lines_mask_fraction=float(lm.mean()))
    mp = os.path.join(A.out, "meta.json")
    if os.path.exists(mp):
        me = json.load(open(mp))
        ks = sorted(int(k_) for k_ in me["images"])
        R["meta"] = dict(frames=[ks[0], ks[-1]], n_first=me["images"][str(ks[0])]["n"], n_last=me["images"][str(ks[-1])]["n"], count=len(ks))
    sl = os.path.join(os.path.dirname(mdir), "scene_log.json")
    if os.path.exists(sl):
        R["render_times_s"] = {k_: v.get("render_s") for k_, v in json.load(open(sl)).items()}
    with open(os.path.join(A.out, "checks%s.json" % A.tag), "w") as fo:
        json.dump(R, fo, indent=1)
    print(json.dumps({k_: R[k_] for k_ in R if k_ not in ("squeegee", "render_times_s")}, indent=1))


if __name__ == "__main__":
    main()
