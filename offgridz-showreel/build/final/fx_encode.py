"""Vidéos (masters 16 bits -> H.264 High yuv420p, AAC 320 kb/s), planche contact, contrôles de sortie."""
import json
import pathlib
import re
import struct
import subprocess

import cv2
import numpy as np

import fx_common as X
import fx_draw as D
import fx_sheet as SH

# bande son : la version « diffusion » si elle existe (plafond de crête abaissé pour l'encodage AAC, voir
# build/audio/diffusion.py), sinon la version finale, sinon la maquette
WAV = next((p for p in (X.ROOT / "out" / "audio" / "insoumise_v1_diffusion.wav", X.ROOT / "out" / "audio" / "insoumise_v1.wav",
                        X.ROOT / "out" / "audio" / "maquette_v0.wav") if p.exists()),
           X.ROOT / "out" / "audio" / "maquette_v0.wav")
DUR = X.NFRAMES / X.FPS
CRF = 13
AF = f"aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur={DUR},atrim=end={DUR},asetpts=N/SR/TB"
VF = ("scale=in_range=full:out_range=tv:out_color_matrix=bt709:flags=accurate_rnd+full_chroma_int:sws_dither=ed,"
      "format=yuv420p")


def master_path(f):
    return X.MASTER / f"f{f:04d}.png"


def png_header(path):
    """(largeur, hauteur, profondeur de bits, type de couleur) lus dans l'IHDR."""
    with open(path, "rb") as fh:
        b = fh.read(26)
    if b[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    w, h, bd, ct = struct.unpack(">IIBB", b[16:26])
    return w, h, bd, ct


def ffmpeg_cmd(out, threads):
    return ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb48le", "-s", f"{X.W}x{X.H}",
            "-r", str(X.FPS), "-i", "-", "-i", str(WAV), "-map", "0:v:0", "-map", "1:a:0",
            "-vf", VF, "-c:v", "libx264", "-profile:v", "high", "-preset", "medium", "-crf", str(CRF),
            "-threads", str(threads), "-pix_fmt", "yuv420p", "-r", str(X.FPS),
            "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
            "-af", AF, "-c:a", "aac", "-aac_pns", "0", "-b:a", "320k", "-ar", "48000", "-ac", "2", "-t", f"{DUR}",
            "-movflags", "+faststart", str(out)]


def burn_in(img16, f):
    """Incrustation de relecture discrète (haut droite, 16 px, voile noir à 50 %) : image, secondes, mesure.temps.
    Ne touche qu'une petite région."""
    x0, y0, x1, y1 = 700, 30, X.W - 24, 78
    buf = img16[y0:y1, x0:x1].astype(np.float32)
    D.paint(buf, np.full(buf.shape[:2], 0.5, np.float32), 0, 0, X.BLACK, 1.0)
    D.draw_text(buf, SH.burn_in_text(f), X.WX1 - x0, 62 - y0, 16, X.CREAM, 0.62, "r", 400, 0.04)
    img16[y0:y1, x0:x1] = np.clip(buf + 0.5, 0, 65535).astype(np.uint16)
    return img16


def encode_videos(do_burn, log=print):
    """Une seule lecture des masters ; un ffmpeg par variante (1 fil x264 chacun si deux, 2 sinon)."""
    out_dir = X.FINAL
    outs = [("clean", out_dir / "insoumise_wip.mp4")]
    if do_burn:
        outs.append(("revue", out_dir / "insoumise_wip_revue.mp4"))
    thr = 1 if len(outs) == 2 else 2
    procs = [subprocess.Popen(ffmpeg_cmd(p, thr), stdin=subprocess.PIPE) for _, p in outs]
    try:
        for f in range(X.NFRAMES):
            im = cv2.imread(str(master_path(f)), cv2.IMREAD_UNCHANGED)
            rgb = np.ascontiguousarray(cv2.cvtColor(im, cv2.COLOR_BGR2RGB))
            for (kind, _), pr in zip(outs, procs):
                data = rgb if kind == "clean" else burn_in(rgb.copy(), f)
                pr.stdin.write(data.tobytes())
            if f % 100 == 0:
                log(f"  encodage : image {f}")
    finally:
        for pr in procs:
            pr.stdin.close()
        rcs = [pr.wait() for pr in procs]
    return {k: {"path": str(p), "ffmpeg_rc": rc} for (k, p), rc in zip(outs, rcs)}


def probe(path):
    """ffprobe : nombre d'images lues, durée, codecs, débit audio, CRF lu dans le SEI x264."""
    path = str(path)
    r = subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-show_streams", "-show_format", "-of", "json", path],
                       capture_output=True, text=True)
    j = json.loads(r.stdout)
    v = next(s for s in j["streams"] if s["codec_type"] == "video")
    a = next((s for s in j["streams"] if s["codec_type"] == "audio"), {})
    raw = pathlib.Path(path).read_bytes()
    m = re.search(rb"crf=([0-9.]+)", raw[:400000] + raw[-400000:])
    return {"video": {"codec": v["codec_name"], "profile": v.get("profile"), "pix_fmt": v["pix_fmt"],
                      "size": f'{v["width"]}x{v["height"]}', "r_frame_rate": v["r_frame_rate"],
                      "frames_counted": int(v["nb_read_frames"]), "duration_s": float(v.get("duration", 0)),
                      "crf_in_stream": float(m.group(1)) if m else None},
            "audio": {"codec": a.get("codec_name"), "sample_rate": a.get("sample_rate"), "channels": a.get("channels"),
                      "bit_rate": int(a.get("bit_rate", 0)), "duration_s": float(a.get("duration", 0))},
            "format_duration_s": float(j["format"]["duration"]), "size_bytes": int(j["format"]["size"])}


# ------------------------------------------------------------------ planche contact
PLANCHE_FRAMES = [0, 12, 30, 72, 96, 150, 168, 216, 264, 318, 342, 372, 408, 432, 456, 468,
                  490, 510, 528, 540, 564, 588, 594, 599]


def contact_sheet(path, frame_status):
    """24 images étiquetées (image, temps, séquence, FINAL / MAQUETTE) sur 8 colonnes × 3 lignes."""
    cols, rows = 8, 3
    tw, th = 240, 427
    gx, gy, lab = 14, 14, 44
    Wc = cols * tw + (cols + 1) * gx
    Hc = rows * (th + lab) + (rows + 1) * gy
    S = np.empty((Hc, Wc, 3), np.float32)
    S[:] = D.rgb16((18, 17, 16))
    for i, f in enumerate(PLANCHE_FRAMES):
        r_, c_ = divmod(i, cols)
        x = gx + c_ * (tw + gx)
        y = gy + r_ * (th + lab + gy)
        im = cv2.imread(str(master_path(f)), cv2.IMREAD_UNCHANGED)
        small = cv2.resize(im, (tw, th), interpolation=cv2.INTER_AREA)
        S[y:y + th, x:x + tw] = cv2.cvtColor(small, cv2.COLOR_BGR2RGB).astype(np.float32)
        D.paint_rect(S, x - 1, y - 1, x + tw + 1, y, X.CREAM, 0.25)
        D.paint_rect(S, x - 1, y + th, x + tw + 1, y + th + 1, X.CREAM, 0.25)
        D.paint_rect(S, x - 1, y, x, y + th, X.CREAM, 0.25)
        D.paint_rect(S, x + tw, y, x + tw + 1, y + th, X.CREAM, 0.25)
        st = frame_status.get(f, {})
        seq = next(n for a, b, _, n in X.SEQDEF if a <= f <= b)
        tag = "MAQUETTE" if st.get("standin") else "FINAL"
        D.draw_text(S, f"F{f:03d} · {f / X.FPS:05.2f} s".replace(".", ",", 1), x, y + th + 18, 13, X.CREAM, 0.95, "l", 400, 0.02)
        D.draw_text(S, f"{seq} · {tag}", x, y + th + 36, 13, X.ORANGE_HI if st.get("standin") else X.CREAM,
                    0.8, "l", 400, 0.02)
    out = np.clip(S / X.SCALE16 + 0.5, 0, 255).astype(np.uint8)
    cv2.imwrite(str(path), cv2.cvtColor(out, cv2.COLOR_RGB2BGR))
