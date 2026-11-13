# build/seq56 -- Fond perdu + Signature (frames 456-599)

Two renderers for the matter layer share the same solver outputs: `scene.py` (Blender Cycles, path traced: the one to use) and
`run.py --stages matiere` (2.5D fallback, no Blender). The window layer, meta.json and the solvers are common.

## One command (from offgridz-showreel/)

    # 1. grains (MLS-MPM, variant seq56 of the Deferlement scene). Test scale here; final = GPU run:
    /opt/og/venv/bin/python build/sim/scenes.py deferlement --variant seq56 --arch cpu --scale 0.01 --threads 2 \
        --out cache/seq56/grains_s0.01 --frames 456:503
    #    final (GPU):  ... --arch cuda --scale 1.0 --out cache/seq56/grains_s1.0 --frames 456:503   (~2.2 M surge + bed grains x ~2)
    # 2. everything else (render grains, film solver, squeegee, window, preview, meta):
    /opt/og/venv/bin/python build/seq56/run.py --grains cache/seq56/grains_s0.01 --out out/final/seq56
    # 3. measurements
    /opt/og/venv/bin/python build/seq56/checks.py

`run.py --stages grains,film,matiere,fenetre,meta,preview` runs stages separately (work files in cache/seq56/work_<cache name>/).
The renderer reads spacing and counts from `<cache>/run.json`; nothing depends on the scale. If the cache stops at 479 the
last frame is reused for 480-503.

## Final-scale recipe (everything CPU-bound runs locally; the GPU only renders)

    # 1. grains at final scale: 420,286 grains of ~1.0 mm (scale 0.06), lean frames, 456-479 (the dry grains stay frozen after 479)
    python build/sim/scenes.py deferlement --variant seq56 --scale 0.06 --threads 1 --out cache/seq56/grains_final \
        --frames 456:479 --leger 1 --ckpt-every 4 --fresh                       # 94 min on one niced core
    # 2. height fields of the bed (no shading) and the film solver (ink), dir cache/seq56/work_grains_final/film_fpx4_mu2_g0.036_lv18
    python build/seq56/run.py --grains cache/seq56/grains_final --stages grains,film --height-only 1 \
        --mu 2 --film-gain 0.036 --fpx 4 --fpx-sq 6 --level-sigma 18 --h-pin 2.5 --threads 1       # 7 min
    # 3. pack the render caches (167 MB) and the code
    python build/gpu/kit.py code ; python build/gpu/kit.py seq56
    # 4. on the GPU machine (bpy module, no Blender binary): one process, resumable
    python -u build/seq56/scene.py -- --frames 456:527 --res 1080x1920 --spp 128 --device OPTIX \
        --reprise 1 --arret <unix time> --out out/final/seq56            # one line per frame: "SEQ56 image f : s (preparation s), grains n dont cristaux n"

Render dependencies (build/seq56/scene.py): `bpy==5.3.0` and `numpy` only (scipy is imported by atelier.GrainsMixtes but not by the
code path used here). The solvers need taichi, numpy, scipy and opencv-python-headless (run.py / film.py / grains.py).

## Path-traced matter layer (Blender, build/seq56/scene.py)

    /opt/og/blender/blender-5.3.0-linux-x64/blender -b -t 2 -P build/seq56/scene.py -- \
        --frames 456:527 --res 1080x1920 --spp 128 --device CPU|OPTIX --out out/final/seq56 \
        [--grains cache/seq56/grains_final] [--film <film dir>] [--list 470,492,514] [--lod-res 1080] [--arret T] [--reprise 1]

Orthographic camera straight above, ortho width 0.108 m (0.1 mm/px at 1080 px), film transparent, Cycles shadow catchers for the sheet
and tray (shadows = black alpha), 16-bit RGBA PNG, STRAIGHT alpha (proved by build/seq56/alpha_test.py: a 50 % transparent #EA470F
plane gives RGB 234,71,15 and alpha 0.5). Grains: atelier.Grains via `GrainsHaut` (orthographic adaptation of GrainsMixtes: instanced
crystals for the two top layers, shader-faceted points for every deeper grain). Ink: displaced grid from the film solver's height
field, clear-coated glossy Principled (roughness 0.17). Squeegee: 3D model; a fill light linked to the tool only keeps the rubber cream.
Behind the wetting front the grains sink into the ink (swallowed) and are dropped 4 frames later when fully hidden under it.
`--lod-res` fixes the width used for the crystal/point choice (use 1080 for timing tests at tiny resolution).
`run.py --stages preview --matiere-dir <dir> --tag _pt` and `checks.py --matiere-dir <dir> --tag _pt` work on any matter directory.

## Simulation variant `seq56` (build/sim/scenes.py, class Deferlement; `--variant seq56`)
* the tray (100.8 x 151.2 mm, 4 mm deep) is pre-filled to the brim with a jittered lattice of grains at bulk density
  and settles for 6 pre-roll frames (450-455) under the real MPM solver; frame 456 is exported at t = 0 untouched;
* at 456 the grains of the central column (r < 12 mm) are launched (1.2-1.8 m/s, 42 deg cone) and a vent in the tray floor
  keeps emitting for 10 film frames (1.5-2.3 m/s) a volume equal to a 16 mm layer over the sheet (`SURGE_MM`,
  physical volume, independent of `--scale`);  film time = 0.5 x real time (`ts`);
* parameters are class constants (`PREROLL, SURGE_MM, SURGE_V, SURGE_CONE, LAUNCH_V`), `--vol-factor` multiplies the surge volume.
Other variants (`spec`, `adj`) and the Dalle/Filet scenes are unchanged.

## Modules
* `grains.py`   2.5D depth-buffered sphere splats, analytic normals, AO + soft cast shadows from the height field, per-grain hue.
* `film.py`     thin-film (lubrication) solver, wetting front, moving squeegee wall + bead, open bottom edge.
* `inkrender.py` shading of the film height field (diffuse + drawn studio reflection).
* `squeegee.py` procedural 2D drawing of the tool (not simulated).
* `window.py`   window layer: logo layers recomposed without lines, reveal at the blade tip, drawn wet sheen drying 528 -> 574.
* `checks.py`   measurements written to out/final/seq56/checks.json.
