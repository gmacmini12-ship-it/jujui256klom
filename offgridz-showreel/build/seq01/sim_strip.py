#!/opt/og/venv/bin/python
"""Séquence 1 : simulation de la bande déchirée (papier raide, retenu à gauche, arrachée de droite à gauche).

Solveur de tissu à base de positions (PBD/XPBD) écrit pour ce plan : contraintes de distance (trame, cisaillement),
pliage par contraintes de saut de deux mailles avec courbure au repos qui s'installe à la libération, retenue
cinématique des mailles pas encore arrachées, contact avec le plan de la feuille, gravité, traînée. Déterministe
(numpy seul, pas de hasard), indépendant de la machine : le résultat est écrit une fois dans cache/seq01/strip.npz
et le rendu le relit (aucune simulation au moment du rendu).

  /opt/og/venv/bin/python build/seq01/sim_strip.py [--check]
"""
import math, os, sys, time
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
import tl  # noqa: E402

CACHE = os.path.join(ROOT, "cache", "seq01")
F0, F1 = 11, 47                    # images simulées (11 = repos)
SUB, ITERS = 10, 14

# paramètres (px, s)
R_CURL = 75.0                      # rayon de courbure au repos du papier libéré
CURL_RAMP = 5.0                    # images pour installer la courbure
G_Y = -2500.0                      # gravité (px/s²)
G_FALL = -11000.0                  # après libération de l'ancrage gauche : la bande tombe hors cadre
FOOT = (-432.0, 432.0, -52.0, 100.0)   # empreinte du lettrage (x0, x1, y0, y1) : la bande reste derrière lui
PEEL_ACC = 2000.0                  # poussée vers la caméra de la partie qui vient d'être arrachée (px/s²)
PEEL_FRAMES = 9.0
DRAG = 1.6
T_PEEL = (12.0, 24.0)              # image où se libère l'extrémité droite / la gauche
T_LEFT = 27.0                      # libération de l'ancrage gauche (la bande tombe)


def build():
    g = np.load(os.path.join(CACHE, "geo.npz"))
    V = g["strip_v"].astype(np.float64)
    nx, ny = [int(v) for v in g["strip_grid"]]
    idx = lambda i, j: i * ny + j
    cons = []                                   # (a, b, kind)
    for i in range(nx):
        for j in range(ny):
            if i + 1 < nx: cons.append((idx(i, j), idx(i + 1, j), 0))
            if j + 1 < ny: cons.append((idx(i, j), idx(i, j + 1), 0))
            if i + 1 < nx and j + 1 < ny:
                cons.append((idx(i, j), idx(i + 1, j + 1), 1))
                cons.append((idx(i + 1, j), idx(i, j + 1), 1))
            if i + 2 < nx: cons.append((idx(i, j), idx(i + 2, j), 2))     # pliage en x (courbure)
            if j + 2 < ny: cons.append((idx(i, j), idx(i, j + 2), 3))     # pliage en y (plat)
    a = np.array([c[0] for c in cons]); b = np.array([c[1] for c in cons]); kind = np.array([c[2] for c in cons])
    L0 = np.linalg.norm(V[a] - V[b], axis=1)
    # coloration gloutonne : aucune maille partagée dans une classe -> mises à jour vectorisées exactes
    color = np.zeros(len(a), int)
    used = {}
    for c in range(len(a)):
        k = 0
        while (a[c], k) in used or (b[c], k) in used:
            k += 1
        color[c] = k
        used[(a[c], k)] = 1; used[(b[c], k)] = 1
    groups = [np.nonzero(color == k)[0] for k in range(color.max() + 1)]
    u = np.repeat(np.linspace(0, 1, nx), ny)
    t_rel = T_PEEL[0] + (T_PEEL[1] - T_PEEL[0]) * (1 - u)
    t_rel[u < 0.035] = T_LEFT
    return V, nx, ny, a, b, kind, L0, groups, t_rel, u


def simulate(verbose=True):
    V0, nx, ny, a, b, kind, L0, groups, t_rel, u = build()
    n = len(V0)
    x = V0.copy(); v = np.zeros_like(x)
    k_of = np.array([1.0, 0.7, 0.45, 0.8])[kind]
    kk = 1 - (1 - k_of) ** (1.0 / ITERS)
    frames = {F0: x.copy()}
    dt = 1.0 / tl.FPS / SUB
    t0 = time.time()
    for f in range(F0 + 1, F1 + 1):
        for s in range(SUB):
            ft = (f - 1) + (s + 1) / SUB                        # temps en images à la fin du sous-pas
            pinned = ft < t_rel
            zceil = tl.letters_state(f)[0] - 8.0
            w = np.where(pinned, 0.0, 1.0)
            age = np.clip(ft - t_rel, 0, None)
            acc = np.zeros_like(x)
            acc[:, 1] += G_Y if ft < T_LEFT else G_FALL
            acc[:, 2] += PEEL_ACC * np.clip(1 - age / PEEL_FRAMES, 0, 1) * (~pinned)
            acc[:, 2] += 400.0 * (~pinned)
            v += acc * dt * w[:, None]
            v *= math.exp(-DRAG * dt)
            p = x + v * dt * w[:, None]
            p[pinned] = V0[pinned]
            # longueur au repos : courbure en x installée depuis la libération
            curl = np.clip(age[a] / CURL_RAMP, 0, 1) * (~pinned[a]) * (kind == 2)
            chord = np.where(kind == 2, (R_CURL / (L0 / 2.0)) * np.sin((L0 / 2.0) / R_CURL) , 1.0)
            Lr = L0 * (1 + (chord - 1) * curl)
            wa, wb = w[a], w[b]
            for it in range(ITERS):
                for gi in groups:
                    ia, ib = a[gi], b[gi]
                    d = p[ia] - p[ib]
                    dist = np.linalg.norm(d, axis=1) + 1e-12
                    C = dist - Lr[gi]
                    den = w[ia] + w[ib]
                    ok = den > 0
                    corr = (kk[gi] * C / np.where(ok, den, 1.0) * ok)[:, None] * (d / dist[:, None])
                    p[ia] -= corr * w[ia][:, None]
                    p[ib] += corr * w[ib][:, None]
                p[:, 2] = np.maximum(p[:, 2], 0.6)               # contact avec la feuille
                inb = (p[:, 0] > FOOT[0]) & (p[:, 0] < FOOT[1]) & (p[:, 1] > FOOT[2]) & (p[:, 1] < FOOT[3])
                p[inb, 2] = np.minimum(p[inb, 2], zceil)          # derrière le lettrage levé
                p[pinned] = V0[pinned]
            v = (p - x) / dt
            x = p
        frames[f] = x.copy()
        if verbose and f % 6 == 0:
            print(f"  f{f}: z max {x[:,2].max():.0f}, y min {x[:,1].min():.0f}, {time.time()-t0:.1f}s", flush=True)
    return frames, (nx, ny)


def main():
    frames, grid = simulate()
    ks = sorted(frames)
    arr = np.stack([frames[k] for k in ks]).astype(np.float32)
    np.savez_compressed(os.path.join(CACHE, "strip.npz"), frames=arr, first=np.array([ks[0]]), grid=np.array(grid))
    print("écrit", arr.shape)
    # contrôle d'allongement
    V0, nx, ny, a, b, kind, L0, groups, t_rel, u = build()
    for k in (12, 18, 24, 30, 40, 47):
        P = frames[k].astype(np.float64)
        st = np.linalg.norm(P[a] - P[b], axis=1)[kind == 0] / L0[kind == 0]
        print(f"f{k}: allongement structure max {st.max():.3f}, moyen {st.mean():.4f}; z max {P[:,2].max():.0f}; x [{P[:,0].min():.0f},{P[:,0].max():.0f}] y [{P[:,1].min():.0f},{P[:,1].max():.0f}]")


if __name__ == "__main__":
    main()
