# build/seq56 -- Fond perdu + Signature (frames 456-599)

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
