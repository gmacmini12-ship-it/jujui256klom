# « Qui tient les sondages ? » — vidéo TikTok 9:16

- `DOSSIER_VALIDATION.md` : plan, script validé, sources, budget.
- `audio/` : narration (voix « Julian », ElevenLabs via Higgsfield), un fichier par scène.
- `assets/` : 2 images clés + 2 plans Higgsfield (Kling 4.0 Flash).
- `build/` : tout le motion design est du code.
  - `align.py` : resserre les silences, accélère la voix (×1,14), cale sous-titres et scènes → `out/timeline.json`.
  - `web/` : moteur Three.js (low poly 2.5D) + les 8 scènes.
  - `render.js` : rendu image par image (Chromium headless) ; `sfx.py` : bruitages synthétisés ; `assemble.sh` : montage final.

## Reconstruire
```bash
cd build && npm install
python3 align.py 1.14
ffmpeg -i ../assets/plan1.mp4 -vf "setpts=PTS*1.10,fps=30,scale=1080:1931,crop=1080:1920" -q:v 3 out/clips/p1/%04d.jpg
ffmpeg -i ../assets/plan2.mp4 -vf "fps=30,scale=1080:1931,crop=1080:1920" -q:v 3 out/clips/p2/%04d.jpg
node render.js sfx out/sfx.json && python3 sfx.py
node render.js range 0 3567 out/chunks/c0.mp4   # (découpé en 4 morceaux en pratique)
./assemble.sh
```

## Écarts par rapport au script validé
Texte enregistré = script validé, avec ces ajustements (exactitude et durée) :
1. « contrôlé par **la famille** Bolloré » (53 % du capital de Havas, 2026) et « médias de **la galaxie** Bolloré » (CNews, Europe 1 et le JDD sont dans des sociétés distinctes dont Bolloré est l'actionnaire de référence).
2. OpinionWay : « En 2022, le groupe Les Échos–Le Parisien **annonce en prendre 75 %** » (je n'ai pas trouvé le communiqué de clôture de l'opération).
3. Commission des sondages : « a encore dû **réclamer aux instituts plus de clarté** sur leurs marges d'erreur » (au lieu de « rappeler à l'ordre »).
4. Redressement : « corrigées par l'institut. Les chiffres bruts ? Vous ne les verrez jamais. »
5. Coupés au montage pour tenir sous 120 s : « Restez trente secondes. Vous allez comprendre. » et la phrase sur les deux sénateurs de 2010 (le rapport du Sénat reste cité en source à l'écran).
6. À l'écran : « 1er tour : 18 avril 2027 » à la place du compte à rebours « J-150 ».
