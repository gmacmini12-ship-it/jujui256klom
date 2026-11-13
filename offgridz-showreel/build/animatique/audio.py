#!/opt/og/venv/bin/python
"""Piste de clics de l'animatique, calculée depuis la partition (numpy, graine sans objet : aucun hasard).

    python build/animatique/audio.py        # écrit out/animatique/click_track.wav (48 kHz stéréo, 20,000 s)

Un tic à chaque temps, un tic plus fort à chaque début de mesure, un bip distinct à chaque instant du
réticule, un bip aigu à chaque changement de caractère et à chaque ligne de signature.
"""
import pathlib
import sys

import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import common as C  # noqa: E402

SR = 48000
OUT = C.ROOT / "out" / "animatique"


def burst(freq, dur, amp, decay=40.0, f1=None):
    n = int(SR * dur)
    t = np.arange(n) / SR
    fr = freq if f1 is None else np.linspace(freq, f1, n)
    ph = 2 * np.pi * np.cumsum(np.broadcast_to(fr, (n,))) / SR
    return amp * np.sin(ph) * np.exp(-decay * t) * np.minimum(1, t * 2000)


def stack(*parts):
    n = max(len(p) for p in parts)
    out = np.zeros(n)
    for p in parts:
        out[:len(p)] += p
    return out


def events():
    """(image, type) de tous les repères sonores, tirés de la partition."""
    ev = []
    n = C.NFRAMES
    for f in range(0, n, C.PER_BEAT):
        ev.append((f, "beat"))
    for m in C.PART["grille"]["mesures"]:
        ev.append((m["image"], "bar"))
    for e in C.EV:
        if e["piste"] == "reticule":
            if "image" in e:
                ev.append((e["image"], "reticle"))
                if "fin" in e:
                    ev.append((e["fin"], "reticle_end"))
        if e["piste"] == "typo":
            if "image" in e:
                ev.append((e["image"], "typo_line"))
            elif "caracteres" in e or e["nom"].startswith("roulement"):
                for f in range(e["debut"], e["fin"] + 1, C.PER_16TH):
                    ev.append((f, "typo_char"))
    return sorted(ev)


def build():
    y = np.zeros(int(C.NFRAMES / C.FPS * SR), np.float64)
    sounds = {
        "beat": burst(1000, 0.020, 0.28, 90),
        "bar": stack(burst(700, 0.060, 0.55, 45), burst(1500, 0.030, 0.30, 70)),
        "reticle": burst(1800, 0.080, 0.45, 35, 2800),
        "reticle_end": burst(1400, 0.070, 0.30, 40, 700),
        "typo_char": burst(3400, 0.012, 0.22, 200),
        "typo_line": stack(burst(2200, 0.120, 0.45, 25), burst(3300, 0.120, 0.30, 25)),
    }
    for f, kind in events():
        i = int(round(f / C.FPS * SR))
        s = sounds[kind]
        j = min(len(y), i + len(s))
        y[i:j] += s[:j - i]
    y = np.clip(y, -0.9, 0.9)
    return (np.stack([y, y], 1) * 32767).astype(np.int16)


def main():
    import soundfile as sf
    OUT.mkdir(parents=True, exist_ok=True)
    a = build()
    p = OUT / "click_track.wav"
    sf.write(p, a, SR, subtype="PCM_16")
    print(p, a.shape, a.shape[0] / SR, "s")


if __name__ == "__main__":
    main()
