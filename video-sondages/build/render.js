// Rendu image par image dans Chromium headless.
//   node render.js stills 3.2,10.5 dossier      → images fixes (aperçus)
//   node render.js range 0 900 sortie.mp4       → images [0,900[ encodées en H.264
//   node render.js sfx sortie.json              → liste des bruitages
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const root = __dirname, FPS = 30;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.woff2': 'font/woff2' };
const srv = http.createServer((q, s) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); s.end(); } else { s.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream' }); s.end(d); } }); }).listen(0);
(async () => {
  const [mode, a, b, c] = process.argv.slice(2);
  const br = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const pg = await br.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  pg.on('console', m => console.log('[page]', m.text())); pg.on('pageerror', e => { console.log('[err]', e.message); });
  await pg.goto(`http://127.0.0.1:${srv.address().port}/web/index.html`);
  await pg.waitForFunction('window.ready', null, { timeout: 30000 });
  if (mode === 'sfx') fs.writeFileSync(a, JSON.stringify(await pg.evaluate('window.SFX')));
  if (mode === 'stills') { fs.mkdirSync(b, { recursive: true }); for (const t of a.split(',')) { await pg.evaluate(t => window.renderAt(t), +t); await pg.screenshot({ type: 'jpeg', quality: 80, path: path.join(b, `t${(+t).toFixed(2).padStart(6, '0')}.jpg`) }); } }
  if (mode === 'range') {
    const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', FPS, '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', FPS, c], { stdio: ['pipe', 'inherit', 'inherit'] });
    for (let f = +a; f < +b; f++) { await pg.evaluate(t => window.renderAt(t), f / FPS); const buf = await pg.screenshot({ type: 'jpeg', quality: 93 }); if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r)); }
    ff.stdin.end(); await new Promise(r => ff.on('close', r));
  }
  await br.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
