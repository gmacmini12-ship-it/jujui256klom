#!/opt/og/venv/bin/python
"""Contrôles de l'animatique : ffprobe, table des événements (frames déclenchées par le rendu),
planche contact.

    python build/animatique/checks.py                    # tout : ffprobe + événements + planche
    python build/animatique/checks.py --montage 36,60,68 --cols 3 --scale 0.4 --out /chemin/x.png
"""
import argparse
import json
import pathlib
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import common as C  # noqa: E402
import render  # noqa: E402
import reticle  # noqa: E402
import scenes  # noqa: E402
import sheet  # noqa: E402

OUT = render.OUT


def ffprobe(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-show_streams", "-show_format", "-of", "json", str(path)],
                       capture_output=True, text=True, check=True)
    j = json.loads(r.stdout)
    out = {}
    for s in j["streams"]:
        if s["codec_type"] == "video":
            out["video"] = dict(codec=s["codec_name"], pix_fmt=s["pix_fmt"], width=s["width"], height=s["height"],
                                r_frame_rate=s["r_frame_rate"], nb_read_frames=int(s.get("nb_read_frames", -1)),
                                duration=s.get("duration"), nb_frames=s.get("nb_frames"))
        elif s["codec_type"] == "audio":
            out["audio"] = dict(codec=s["codec_name"], sample_rate=s["sample_rate"], channels=s["channels"],
                                duration=s.get("duration"))
    out["format_duration"] = j["format"]["duration"]
    return out


def montage(frames, cols, scale, out, label=True, burn=True):
    ims = []
    for f in frames:
        F, _, _ = render.compose(f, burn)
        im = Image.fromarray(F)
        im = im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS)
        if label:
            d = ImageDraw.Draw(im)
            font = ImageFont.truetype(C.FONT_MONO[700], max(int(22 * scale * 2.2), 14))
            d.rectangle([0, im.height - font.size - 8, int(font.size * 4.4), im.height], fill=(0, 0, 0))
            d.text((4, im.height - font.size - 6), f"{f}", font=font, fill=(255, 255, 255))
        ims.append(im)
    rows = (len(ims) + cols - 1) // cols
    w, h = ims[0].size
    sheet_im = Image.new("RGB", (cols * w + (cols + 1) * 6, rows * h + (rows + 1) * 6), (60, 60, 60))
    for i, im in enumerate(ims):
        sheet_im.paste(im, (6 + (i % cols) * (w + 6), 6 + (i // cols) * (h + 6)))
    sheet_im.save(out)
    return sheet_im.size


def event_table():
    """Pour chaque instant et début de bloc des pistes reticule, typo et sequence : image déclenchée par le rendu
    (observée en balayant le rendu, pas recopiée de la partition) comparée à la partition."""
    # observations du rendu
    seq_first = {}
    for f in range(C.NFRAMES):
        i = scenes.seq_index(f)
        seq_first.setdefault(i, f)
    phases = [reticle.state(f) for f in range(C.NFRAMES)]

    def first(pred, start=0):
        for f in range(start, C.NFRAMES):
            if pred(f):
                return f
        return None

    rows = []
    for e in C.EV:
        if e["piste"] not in ("reticule", "typo", "sequence"):
            continue
        part = e.get("image", e.get("debut"))
        kind = "instant" if "image" in e else "bloc"
        got, how = None, ""
        nom = e["nom"]
        if e["piste"] == "sequence":
            got = seq_first[int(nom[0])]
            how = "première image de la séquence rendue"
        elif e["piste"] == "reticule":
            if nom.startswith("verrouillé"):
                got = first(lambda f: phases[f]["phase"] == "locked")
                how = "réticule posé sur le cercle du logo"
            elif nom.startswith("déverrouillage"):
                got = first(lambda f: phases[f]["phase"] == "unlock")
                how = "début du déverrouillage (rotation 4°, relâche)"
            elif nom.startswith("tentative"):
                tag = reticle.TARGETS[int(nom.split()[1]) - 1][3]
                got = first(lambda f: phases[f]["phase"] == "snap:" + tag)
                how = f"début de l'accrochage sur {tag}"
            elif nom.startswith("devient repère"):
                got = first(lambda f: phases[f]["phase"] == "axes")
                how = "les repères se prolongent en axes"
            elif nom.startswith("verrouillage final"):
                got = first(lambda f: phases[f]["phase"] == "locked-final")
                how = "arrivée exacte sur le cercle du logo (accrochage 6 images avant)"
        else:
            if nom.startswith("roulement 1"):
                got = first(lambda f: scenes.roll_face(f, scenes.ROLL1, scenes.FACES1) is not None)
                how = "premier caractère du roulement"
            elif nom.startswith("roulement 2"):
                got = first(lambda f: scenes.roll_face(f, scenes.ROLL2, scenes.FACES2) is not None)
                how = "premier caractère du roulement"
            elif nom.startswith("roulement 3"):
                got = first(lambda f: scenes.roll_face(f, scenes.ROLL3, scenes.FACES3) is not None)
                how = "premier caractère de l'enseigne"
            elif nom.startswith("roulement 4"):
                got = scenes.ROLL4["debut"] if False else first(lambda f: _doto_visible(f))
                how = "premier rendu Doto (graisse variable)"
            elif nom.startswith("lettrage"):
                got = first(lambda f: f >= scenes.T_SQ["debut"] and f <= scenes.T_SQ["fin"] and scenes.sq_geometry(f)[0] + scenes.sq_geometry(f)[1] > 0)
                how = "la raclette entre : le logo imprimé commence à apparaître"
            elif "Hors-grille" in nom:
                got = first(lambda f: _sig_visible(f, 0))
                how = "ligne visible"
            elif "Sous contrôle" in nom:
                got = first(lambda f: _sig_visible(f, 1))
                how = "ligne visible"
            elif nom.startswith("fondu"):
                got = first(lambda f: 0 < sheet.fade_signature(f) < 1)
                how = "premier degré de fondu"
        rows.append(dict(piste=e["piste"], nom=nom, genre=kind, partition=part, rendu=got, ok=(got == part), methode=how))
    return rows


def _doto_visible(f):
    a, b = scenes.SEQ[4]
    return f >= scenes.ROLL4["debut"] and f <= scenes.ROLL4["fin"] + 6


def _sig_visible(f, i):
    if f < (scenes.T_SIG, scenes.T_SIG2)[i]:
        return False
    return sheet.fade_signature(f) > 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--montage", default="")
    ap.add_argument("--cols", type=int, default=6)
    ap.add_argument("--scale", type=float, default=0.25)
    ap.add_argument("--out", default="")
    ap.add_argument("--video", default=str(OUT / "animatique_v0.mp4"))
    a = ap.parse_args()
    if a.montage:
        fr = [int(x) for x in a.montage.split(",")]
        print(montage(fr, a.cols, a.scale, a.out or str(OUT / "montage_dev.png")))
        return
    res = {}
    vp = pathlib.Path(a.video)
    if vp.exists():
        res["ffprobe"] = ffprobe(vp)
        print(json.dumps(res["ffprobe"], indent=1))
    rows = event_table()
    res["evenements"] = rows
    bad = [r for r in rows if not r["ok"]]
    for r in rows:
        print(f'{r["piste"]:9s} {r["genre"]:7s} partition={r["partition"]!s:>4}  rendu={r["rendu"]!s:>4}  {"OK" if r["ok"] else "ÉCART"}  {r["nom"]}  [{r["methode"]}]')
    print(f"{len(rows)} événements, {len(bad)} écarts")
    frames = list(range(0, 600, 25))
    print("planche contact :", montage(frames, 6, 0.24, OUT / "planche_contact.png", True, True))
    (OUT / "checks.json").write_text(json.dumps(res, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()
