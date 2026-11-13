#!/opt/og/venv/bin/python
"""Ajoute le son à la vidéo muette SANS refaire le rendu des images (la vidéo est copiée telle quelle).

    python build/animatique/mux.py                       # maquette_v0.wav si présente, sinon piste de clics
    python build/animatique/mux.py --audio /chemin/x.wav # un son précis

Sortie : out/animatique/animatique_v0.mp4 (H.264 copié, AAC 48 kHz stéréo, 20,000 s).
"""
import argparse
import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import common as C  # noqa: E402

OUT = C.ROOT / "out" / "animatique"
SILENT = OUT / "video_muette.mp4"
FINAL = OUT / "animatique_v0.mp4"
MAQUETTE = C.ROOT / "out" / "audio" / "maquette_v0.wav"
DUR = C.NFRAMES / C.FPS


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio", default="")
    ap.add_argument("--out", default=str(FINAL))
    a = ap.parse_args()
    if a.audio:
        src = pathlib.Path(a.audio)
    elif MAQUETTE.exists():
        src = MAQUETTE
    else:
        import audio
        audio.main()
        src = OUT / "click_track.wav"
    print("son :", src)
    # le son est ramené à 48 kHz stéréo, complété ou coupé à exactement 20,000 s
    af = f"aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur={DUR},atrim=end={DUR},asetpts=N/SR/TB"
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(SILENT), "-i", str(src), "-map", "0:v:0", "-map", "1:a:0",
           "-c:v", "copy", "-af", af, "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-t", f"{DUR}",
           "-movflags", "+faststart", a.out]
    subprocess.run(cmd, check=True)
    print("écrit", a.out)


if __name__ == "__main__":
    main()
