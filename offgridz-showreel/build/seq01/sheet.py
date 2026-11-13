#!/opt/og/venv/bin/python
"""Planche-contact : sheet.py dossier sortie.png f1,f2,... [colonnes] [largeur]"""
import sys, cv2, numpy as np
d, out, fl = sys.argv[1], sys.argv[2], [int(v) for v in sys.argv[3].split(',')]
cols = int(sys.argv[4]) if len(sys.argv) > 4 else 6
wd = int(sys.argv[5]) if len(sys.argv) > 5 else 336
ims = []
for f in fl:
    a = cv2.imread(f"{d}/f{f:04d}.png", cv2.IMREAD_UNCHANGED)
    a = (a / 257.0).astype(np.uint8) if a.dtype == np.uint16 else a
    a = cv2.resize(a, (wd, int(wd * 1.5)), interpolation=cv2.INTER_AREA)
    cv2.putText(a, f"f{f}", (8, 26), 0, 0.8, (0, 255, 255), 2, cv2.LINE_AA)
    cv2.rectangle(a, (0, 0), (wd - 1, int(wd * 1.5) - 1), (60, 60, 60), 1)
    ims.append(a)
while len(ims) % cols: ims.append(np.zeros_like(ims[0]))
rows = [np.concatenate(ims[i:i + cols], 1) for i in range(0, len(ims), cols)]
cv2.imwrite(out, np.concatenate(rows, 0))
