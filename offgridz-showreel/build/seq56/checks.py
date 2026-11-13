"""checks.py -- measurements on the written frames (out/final/seq56). Writes out/final/seq56/checks.json and prints a summary.

  python build/seq56/checks.py [--out out/final/seq56]
"""
import argparse
import json
import os
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from common import ROOT, W, H, WIN, tip_y, RUBBER_LEN, HOLDER_LEN, LOGO_Y_IN_WIN, WIN_W, WIN_H  # noqa: E402


def rd(path):
    a = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    assert a.dtype == np.uint16, path
    return a


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "out", "final", "seq56"))
    A = ap.parse_args()
    R = {}
    mat = lambda f: rd(os.path.join(A.out, "matiere", "f%04d.png" % f))
    win = lambda f: rd(os.path.join(A.out, "fenetre", "f%04d.png" % f))
    # ---- format
    m = mat(456)
    w = win(456)
    R["format"] = dict(matiere_shape=list(m.shape), matiere_dtype=str(m.dtype), fenetre_shape=list(w.shape), fenetre_dtype=str(w.dtype),
                       n_matiere=len([p for p in os.listdir(os.path.join(A.out, "matiere")) if p.endswith(".png")]),
                       n_fenetre=len([p for p in os.listdir(os.path.join(A.out, "fenetre")) if p.endswith(".png")]))
    # ---- frame 456: window covered, margins clean
    a = m[:, :, 3].astype(np.float32) / 65535
    x0, y0, x1, y1 = WIN
    inside = a[y0:y1, x0:x1]
    mask = np.ones((H, W), bool)
    mask[y0:y1, x0:x1] = False
    R["f456"] = dict(window_alpha_min=float(inside.min()), window_alpha_mean=float(inside.mean()),
                     window_fraction_alpha_ge_099=float((inside >= 0.99).mean()),
                     margin_alpha_max=float(a[mask].max()), margin_alpha_mean=float(a[mask].mean()),
                     margin_pixels_alpha_gt_0_01=int((a[mask] > 0.01).sum()), margin_pixels_total=int(mask.sum()))
    # ---- coverage of the sheet by the overflow
    cov = {}
    for f in (460, 465, 470, 472, 474, 475, 476, 477, 478, 479):
        a = mat(f)[:, :, 3].astype(np.float32) / 65535
        d = {"sheet_cover_ge_0.5": float((a >= 0.5).mean())}
        d["margin_cover_ge_0.5"] = float((a[mask] >= 0.5).mean())
        d["edge_bands_20px_cover"] = dict(top=float((a[:20] >= 0.5).mean()), bottom=float((a[-20:] >= 0.5).mean()),
                                          left=float((a[:, :20] >= 0.5).mean()), right=float((a[:, -20:] >= 0.5).mean()))
        cov[str(f)] = d
    R["coverage"] = cov
    # ---- squeegee: detect the cream rubber rows in the written frames (alpha ~1, R>G>B cream, row-wise)
    sq = {}
    for f in range(504, 528):
        mm = mat(f).astype(np.float32) / 65535
        R_, G_, B_, A_ = mm[..., 2], mm[..., 1], mm[..., 0], mm[..., 3]
        cream = (A_ > 0.98) & (R_ > 0.80) & (G_ > 0.72) & (B_ > 0.62) & (R_ - B_ > 0.02) & (R_ - B_ < 0.2)
        frac = cream.mean(axis=1)
        rows = np.nonzero(frac > 0.6)[0]
        exp_tip = float(tip_y(f))
        e = dict(tip_expected_px=exp_tip, rubber_rows_detected=None)
        if len(rows):
            e["rubber_rows_detected"] = [int(rows.min()), int(rows.max())]
            e["tip_measured_px"] = float(rows.max() + 1)
            e["tip_error_px"] = float(rows.max() + 1 - exp_tip)
        sq[str(f)] = e
    R["squeegee"] = sq
    a527 = mat(527)[:, :, 3].astype(np.float32) / 65535
    a526 = mat(526)[:, :, 3].astype(np.float32) / 65535
    R["f527"] = dict(max_alpha=float(a527.max()), mean_alpha=float(a527.mean()), fraction_alpha_gt_0_005=float((a527 > 0.005).mean()))
    R["f526"] = dict(max_alpha=float(a526.max()), mean_alpha=float(a526.mean()))
    # ---- window: black until the reveal, flat from 574
    W456 = win(456)
    R["window"] = dict(black_frames_identical_456_503=bool(all(np.array_equal(win(f), W456) for f in (480, 503))),
                       black_value_16bit=[int(v) for v in W456[0, 0, ::-1]])
    flat = win(574).astype(np.int32)
    same = all(np.array_equal(win(f).astype(np.int32), flat) for f in (574, 580, 590, 599))
    R["window"]["frames_574_to_599_identical"] = bool(same)
    # reference: independent recomposition of the logo layers without lines, resized 1254 -> 1008, placed at y=252
    sys.path.insert(0, HERE)
    import window as wmod
    lg, _ = wmod.logo_recomposed_1254()
    ref = cv2.resize(lg.astype(np.float32), (WIN_W, WIN_W), interpolation=cv2.INTER_AREA) / 255.0
    ref16 = np.round(ref * 65535).astype(np.int32)[:, :, ::-1]
    got = flat[LOGO_Y_IN_WIN:LOGO_Y_IN_WIN + WIN_W]
    d = np.abs(got - ref16)
    R["flat_logo"] = dict(vs_recomposition_16bit_max_abs=int(d.max()), mean_abs=float(d.mean()),
                          outside_logo_square_is_black=bool(np.all(flat[:LOGO_Y_IN_WIN] == flat[0, 0]) and np.all(flat[LOGO_Y_IN_WIN + WIN_W:] == flat[0, 0])))
    # vs the untouched source logo, outside the ring/crosshair (layer_lines alpha dilated)
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
    # ---- meta
    mp = os.path.join(A.out, "meta.json")
    if os.path.exists(mp):
        me = json.load(open(mp))
        ks = sorted(int(k) for k in me["images"])
        R["meta"] = dict(frames=[ks[0], ks[-1]], n_first=me["images"][str(ks[0])]["n"], n_last=me["images"][str(ks[-1])]["n"], count=len(ks))
    with open(os.path.join(A.out, "checks.json"), "w") as fo:
        json.dump(R, fo, indent=1)
    print(json.dumps(R, indent=1))


if __name__ == "__main__":
    main()
