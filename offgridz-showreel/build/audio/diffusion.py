#!/opt/og/venv/bin/python
"""Version « diffusion » de la bande son, pour les fichiers MP4 (son AAC).

    /opt/og/venv/bin/python build/audio/diffusion.py     ->  out/audio/insoumise_v1_diffusion.wav, diffusion.json

Le master (insoumise_v1.wav) plafonne à -1,25 dBTP. L'encodage AAC ajoute des dépassements sur les passages denses
en transitoires (les grains, de 2,4 à 7,2 s) : mesuré le 13 novembre, la crête décodée montait à +0,1 dBTP à
320 kb/s et +0,8 dBTP à 192 kb/s, donc au-dessus du plein niveau. Ce script abaisse le plafond du son envoyé à
l'encodeur, sans changer le niveau moyen (-14 LUFS), jusqu'à ce que la crête mesurée APRÈS encodage et décodage
reste sous -1 dBTP aux deux débits utilisés. Le master sans perte, lui, n'est pas modifié.
"""
import json
import pathlib
import subprocess
import sys
import tempfile

import numpy as np
import soundfile as sf

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import synth as sy  # noqa: E402

RACINE = pathlib.Path(__file__).resolve().parents[2]
AUDIO = RACINE / "out" / "audio"
CIBLE_LUFS, CRETE_MAX = -14.0, -1.0
DEBITS = ("320k", "192k")
OPTIONS_AAC = ["-c:a", "aac", "-aac_pns", "0"]       # sans substitution de bruit : elle aggrave les dépassements sur les grains


def crete_apres_aac(chemin_wav, debit, dossier):
    m4a = str(pathlib.Path(dossier) / f"essai_{debit}.m4a")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(chemin_wav), *OPTIONS_AAC, "-b:a", debit, "-ar", "48000", "-ac", "2", m4a], check=True)
    brut = subprocess.run(["ffmpeg", "-v", "error", "-i", m4a, "-ac", "2", "-ar", "192000", "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return float(20 * np.log10(np.abs(np.frombuffer(brut, np.float32)).max() + 1e-12))


if __name__ == "__main__":
    x, sr = sf.read(AUDIO / "insoumise_v1.wav", always_2d=True)
    assert sr == sy.SR, sr
    x = x.T.astype(np.float64)
    essais = []
    with tempfile.TemporaryDirectory() as dossier:
        for plafond in (-2.5, -3.0, -3.5, -4.0, -4.5, -5.0):
            y, _ = sy.soft_limit(x, plafond)
            for _ in range(5):                                   # recaler le niveau moyen après la limitation
                L = sy.lufs(y)
                if abs(L - CIBLE_LUFS) < 0.02:
                    break
                y, _ = sy.soft_limit(y * 10 ** ((CIBLE_LUFS - L) / 20.0), plafond)
            wav = pathlib.Path(dossier) / "essai.wav"
            sf.write(wav, y.T, sr, subtype="PCM_24")
            cretes = {d: round(crete_apres_aac(wav, d, dossier), 2) for d in DEBITS}
            essais.append(dict(plafond_dbtp=plafond, lufs=round(sy.lufs(y), 2), crete_wav_dbtp=round(sy.true_peak_db(y), 2), crete_apres_aac_dbtp=cretes))
            print(f"plafond {plafond} dBTP : {essais[-1]['lufs']} LUFS, crête du WAV {essais[-1]['crete_wav_dbtp']} dBTP, après AAC {cretes}", flush=True)
            if max(cretes.values()) <= CRETE_MAX:
                sf.write(AUDIO / "insoumise_v1_diffusion.wav", y.T, sr, subtype="PCM_24")
                json.dump(dict(retenu=essais[-1], essais=essais, cible_lufs=CIBLE_LUFS, crete_max_dbtp=CRETE_MAX, options_aac=OPTIONS_AAC),
                          open(AUDIO / "diffusion.json", "w"), indent=1, ensure_ascii=False)
                print("DIFFUSION retenu : plafond", plafond)
                break
        else:
            raise SystemExit("DIFFUSION : aucun plafond ne tient la crête après encodage")
