"""Étapes de fin de run : vidéos, planche, contrôles automatiques, rapport JSON."""
import json
import os

import cv2
import numpy as np

import fx_common as X
import fx_encode as EN

STAMPS = X.CACHE / "stamps.json"


def _stamps():
    try:
        return json.loads(STAMPS.read_text())
    except Exception:
        return {}


def _save_stamps(s):
    X.CACHE.mkdir(parents=True, exist_ok=True)
    STAMPS.write_text(json.dumps(s))


def _read16(f):
    im = cv2.imread(str(EN.master_path(f)), cv2.IMREAD_UNCHANGED)
    return None if im is None else cv2.cvtColor(im, cv2.COLOR_BGR2RGB)


def _psnr16(a, b):
    d = (a.astype(np.float64) - b.astype(np.float64)) / 257.0          # en niveaux 8 bits
    mse = float((d ** 2).mean())
    return 99.0 if mse == 0 else round(10 * np.log10(255.0 ** 2 / mse), 2)


def _ranges(frames):
    out, start, prev = [], None, None
    for f in frames:
        if start is None:
            start = prev = f
        elif f == prev + 1:
            prev = f
        else:
            out.append([start, prev]); start = prev = f
    if start is not None:
        out.append([start, prev])
    return out


def build(man, full, lo, hi, do_video, do_burn, force):
    infos = {int(k): v["info"] for k, v in man["frames"].items()}

    def info(f):
        return infos.get(X.canonical(f))

    rep = {"frames_range_this_run": [lo, hi], "partial": not full}
    avail = [f for f in range(X.NFRAMES) if info(f) is not None and EN.master_path(f).exists()]

    # ---- séquences finales / doublures
    seqs = {}
    for a, b, dirs, name in X.SEQDEF:
        fr = [f for f in range(a, b + 1) if f in avail]
        fin = [f for f in fr if info(f)["window"] in ("final", "logo-source")]
        st = [f for f in fr if info(f)["window"] == "standin"]
        seqs[name] = {"frames": [a, b], "analysed": len(fr), "window_final": _ranges(fin), "window_standin": _ranges(st),
                      "folders": [str(d) for d in dirs]}
    mat = [f for f in avail if info(f)["matiere"] is not None]
    seqs["seq56/matiere"] = {"frames": list(X.MATIERE_RANGE),
                             "final": _ranges([f for f in mat if info(f)["matiere"] == "final"]),
                             "standin": _ranges([f for f in mat if info(f)["matiere"] == "standin"])}
    stand = [f for f in avail if info(f)["standin"]]
    seqs["_images_with_MAQUETTE_tag"] = {"count": len(stand), "ranges": _ranges(stand)}
    seqs["_images_fully_final"] = {"count": len(avail) - len(stand)}
    rep["sequences"] = seqs
    n_src = {}
    for f in avail:
        i = info(f)
        if i.get("n") is not None:
            n_src[f] = i["n"]
    rep["counter_frames"] = _ranges(sorted(n_src))

    # ---- contrôles
    chk = {}
    hdr_bad = []
    present = 0
    for f in range(X.NFRAMES):
        p = EN.master_path(f)
        if p.exists():
            present += 1
            h = EN.png_header(p)
            if h != (X.W, X.H, 16, 2):
                hdr_bad.append([f, h])
    chk["master_files_present"] = present
    chk["master_png_1080x1920_16bit_rgb"] = {"ok": present > 0 and not hdr_bad, "bad": hdr_bad[:5]}
    chk["frame_count_ok"] = present == X.NFRAMES

    if present == X.NFRAMES:
        f0 = _read16(0)
        tail = {f: int(np.abs(_read16(f).astype(np.int32) - f0.astype(np.int32)).max()) for f in (*X.FLAT_HEAD, *X.FLAT_TAIL)}
        chk["loop_closure"] = {"max_abs_diff_16bit_frames_1to5_and_594to599_vs_0": tail,
                               "frame_599_vs_0_identical": tail[599] == 0, "ok": max(tail.values()) == 0}
        src = X.AC.logo_source().astype(np.int32) * 257
        ex = {}
        for f in (0, 5, 594, 599):
            box = _read16(f)[X.LOGO_Y:X.LOGO_Y + X.LOGO_S, X.LOGO_X:X.LOGO_X + X.LOGO_S].astype(np.int32)
            ex[f] = int(np.abs(box - src).max())
        chk["logo_box_exact_frames_0_5_594_599"] = {"max_abs_diff_16bit_vs_source_lanczos_x257": ex, "ok": max(ex.values()) == 0}
        b593 = _read16(593)[X.LOGO_Y:X.LOGO_Y + X.LOGO_S, X.LOGO_X:X.LOGO_X + X.LOGO_S].astype(np.int32)
        chk["seam_593_to_594_logo_box"] = {"max_abs_diff_8bit": round(int(np.abs(b593 - src).max()) / 257.0, 2),
                                           "psnr_db": _psnr16(b593, src)}
        # complétion pixel par pixel : fenêtres finales sans traits + couche `lines` à l'identité
        meas = {}
        for f in [*range(6, 12), 528, 540, 560, 593]:
            if info(f) and info(f)["window"] == "final":
                bx = _read16(f)[X.LOGO_Y:X.LOGO_Y + X.LOGO_S, X.LOGO_X:X.LOGO_X + X.LOGO_S]
                meas[f] = {"psnr_db": _psnr16(bx, src),
                           "max_abs_diff_8bit": round(int(np.abs(bx.astype(np.int32) - src).max()) / 257.0, 2)}
        chk["logo_completion_by_reticle_measured_on_final_windows"] = meas or "aucune fenêtre finale 6–11 / 528–593 : non mesurable ce jour"
    # limite physique de la complétion : logo recomposé SANS lignes + couche lines à l'identité vs source
    nolines = X.AC.to_u8(X.AC.compose_logo(lines=False)).astype(np.float32) * X.SCALE16
    box = np.zeros((X.H, X.W, 3), np.float32)
    box[X.LOGO_Y:X.LOGO_Y + X.LOGO_S, X.LOGO_X:X.LOGO_X + X.LOGO_S] = nolines
    import fx_reticle as R
    R.draw(box, R.state(0))
    comp = np.clip(box + 0.5, 0, 65535).astype(np.uint16)[X.LOGO_Y:X.LOGO_Y + X.LOGO_S, X.LOGO_X:X.LOGO_X + X.LOGO_S]
    chk["reticle_identity_completion_selftest"] = {
        "what": "logo recomposé par couches SANS cercle ni repères + couche lines posée par le réticule à l'identité, comparé au logo source",
        "psnr_db": _psnr16(comp, X.AC.logo_source().astype(np.int32) * 257),
        "note": "la limite vient de la recomposition du logo (rapport QA du logo : 45,2 dB), pas de la pose du réticule"}
    lock = [f for f in list(range(0, 12)) + list(range(528, 600)) if info(f)]
    cx, cy, r = X.AC.logo_circle()
    bad = [f for f in lock if not (info(f)["reticle"]["identity"] and abs(info(f)["reticle"]["cx"] - cx) < 1e-3
                                    and abs(info(f)["reticle"]["cy"] - cy) < 1e-3 and abs(info(f)["reticle"]["r"] - r) < 1e-3
                                    and info(f)["reticle"]["rot"] == 0.0)]
    chk["reticle_identity_at_locked_frames"] = {"frames_checked": len(lock), "logo_circle_px": [round(cx, 3), round(cy, 3), round(r, 3)],
                                                "violations": bad, "ok": not bad and len(lock) > 0}
    free = [f for f in range(12, 528) if info(f)]
    chk["reticle_not_identity_between_12_and_527"] = all(not info(f)["reticle"]["identity"] for f in free)
    tm = [info(f)["text_margin"] for f in avail]
    chk["annotation_min_distance_to_sheet_edge_px"] = {"min": min(tm) if tm else None, "limit": 24, "ok": (min(tm) >= 24) if tm else None}
    rep["checks"] = chk

    # ---- planche contact
    pl = X.FINAL / "planche.png"
    if all(EN.master_path(f).exists() for f in EN.PLANCHE_FRAMES) and all(info(f) for f in EN.PLANCHE_FRAMES):
        stamp = X.digest([man["frames"][str(X.canonical(f))]["digest"] for f in EN.PLANCHE_FRAMES])
        S = _stamps()
        if force or S.get("planche") != stamp or not pl.exists():
            EN.contact_sheet(pl, {f: info(f) for f in EN.PLANCHE_FRAMES})
            S["planche"] = stamp
            _save_stamps(S)
        rep["planche"] = str(pl)

    # ---- vidéos
    mp4 = X.FINAL / "insoumise_wip.mp4"
    rv = X.FINAL / "insoumise_wip_revue.mp4"
    if do_video and present == X.NFRAMES and all(info(f) for f in range(X.NFRAMES)):
        stamp = X.digest([[man["frames"][str(f)]["digest"] for f in sorted(man["frames"], key=int)], X._stat(EN.WAV),
                          EN.CRF, EN.AF, EN.VF, do_burn])
        S = _stamps()
        need = force or S.get("video") != stamp or not mp4.exists() or (do_burn and not rv.exists())
        if need:
            print("encodage des vidéos…", flush=True)
            rep["encode"] = EN.encode_videos(do_burn)
            S["video"] = stamp
            _save_stamps(S)
        else:
            rep["encode"] = "à jour (aucun master ni son changé)"
    if mp4.exists():
        rep["video"] = {"insoumise_wip.mp4": EN.probe(mp4)}
        p = rep["video"]["insoumise_wip.mp4"]
        chk["video_ok"] = {
            "frames_exactly_600": p["video"]["frames_counted"] == X.NFRAMES,
            "video_duration_s": p["video"]["duration_s"], "format_duration_s": p["format_duration_s"],
            "codec_h264_high_yuv420p_30fps": (p["video"]["codec"], p["video"]["profile"], p["video"]["pix_fmt"], p["video"]["r_frame_rate"]),
            "crf": p["video"]["crf_in_stream"], "crf_le_14": (p["video"]["crf_in_stream"] or 99) <= 14,
            "audio": p["audio"]}
    if rv.exists():
        rep.setdefault("video", {})["insoumise_wip_revue.mp4"] = EN.probe(rv)
    rep["outputs"] = {"master": str(X.MASTER), "mp4": str(mp4), "revue": str(rv), "planche": str(pl)}
    return rep


def summary(rep):
    c = rep["checks"]
    lines = ["", "=== rapport ==="]
    lines.append(f"masters présents : {c['master_files_present']}/600 ; 16 bits RGB : {c['master_png_1080x1920_16bit_rgb']['ok']}")
    if "loop_closure" in c:
        lines.append(f"boucle fermée : {c['loop_closure']['ok']} ; logo exact 0/5/594/599 : {c['logo_box_exact_frames_0_5_594_599']['ok']}")
    lines.append(f"identité du réticule aux images verrouillées : {c['reticle_identity_at_locked_frames']['ok']}")
    lines.append(f"marge minimale des annotations : {c['annotation_min_distance_to_sheet_edge_px']['min']} px")
    s = rep["sequences"]
    lines.append(f"images avec pastille MAQUETTE : {s['_images_with_MAQUETTE_tag']['count']} ; entièrement finales : {s['_images_fully_final']['count']}")
    if "video_ok" in c:
        lines.append(f"vidéo : {c['video_ok']['frames_exactly_600']=} durée {c['video_ok']['video_duration_s']} crf {c['video_ok']['crf']}")
    lines.append(f"rapport : {X.FINAL / 'rapport_compositeur.json'}")
    return "\n".join(lines)
