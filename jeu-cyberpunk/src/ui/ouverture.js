import './ui.css';

// Séquence d'ouverture d'une nouvelle partie (plan 1.2). Les textes et le
// minutage viennent de data/ouverture.js. Pilotée par update(dt) depuis la
// boucle du jeu : elle avance au même pas que le jeu (et donc pas à pas en test).

const ease = (x) => {
  x = Math.min(1, Math.max(0, x));
  return x * x * (3 - 2 * x);
};

export function createOuverture(jeu, donnees) {
  const voile = document.createElement('div');
  voile.className = 'ui-ouverture';
  const lignesEl = document.createElement('div');
  lignesEl.className = 'ui-ouverture-lignes';
  voile.appendChild(lignesEl);
  document.body.appendChild(voile);

  let actif = false;
  let t = 0;
  let bipsFaits = 0;
  let mimaFaite = false;
  let controleRendu = false;
  let lignes = [];
  let yaw = 0;
  let resolution = null;

  function lancer() {
    actif = true;
    t = 0;
    bipsFaits = 0;
    mimaFaite = false;
    controleRendu = false;
    lignesEl.textContent = '';
    lignes = donnees.lignes.map((l) => {
      const e = document.createElement('div');
      e.className = `ui-ouverture-ligne ${l.classe || ''}`;
      e.textContent = l.texte;
      lignesEl.appendChild(e);
      return { ...l, e };
    });
    voile.style.opacity = '1';
    voile.classList.add('actif');
    yaw = jeu.player.orientation().yaw;
    jeu.player.regarder(yaw, donnees.regardInitial.pitch);
    jeu.player.controls.enabled = false;
    jeu.suspendre('ouverture');
    jeu.emettre('ouverture:debut');
    return new Promise((r) => (resolution = r));
  }

  function rendreControle() {
    if (controleRendu) return;
    controleRendu = true;
    jeu.player.regarder(yaw, 0);
    jeu.player.controls.enabled = true;
    jeu.etat.ouvertureVue = true;
    jeu.sauver();
    jeu.reprendre('ouverture');
    jeu.emettre('ouverture:fin');
  }

  function terminer() {
    actif = false;
    voile.classList.remove('actif');
    voile.style.opacity = '0';
    const r = resolution;
    resolution = null;
    r?.();
  }

  function update(dt) {
    if (!actif) return;
    t += dt;
    const d = donnees;

    const tb = t - d.noirInitial;
    while (bipsFaits < d.bips.length && tb >= d.bips[bipsFaits]) {
      jeu.audio.bip();
      bipsFaits++;
    }
    for (const l of lignes) l.e.classList.toggle('visible', t >= l.debut && t < d.finTexte);

    const k = (t - d.debutFondu) / d.dureeFondu;
    voile.style.opacity = String(1 - ease(k));
    if (t >= d.debutFondu && !controleRendu) {
      const r = ease((t - d.debutFondu) / d.dureeRegard);
      jeu.player.regarder(yaw, d.regardInitial.pitch * (1 - r));
    }

    if (!mimaFaite && d.mima.length && t >= d.mima[0].debut) {
      mimaFaite = true;
      for (const m of d.mima) jeu.hud.mima(m.texte, { duree: m.duree });
    }
    if (t >= d.finControle) rendreControle();
    if (controleRendu && k >= 1) terminer();
  }

  /** Saute la séquence (tests, ou reprise impossible). */
  function passer() {
    if (!actif) return;
    if (!mimaFaite) {
      mimaFaite = true;
      for (const m of donnees.mima) jeu.hud.mima(m.texte, { duree: m.duree });
    }
    rendreControle();
    terminer();
  }

  return {
    lancer,
    update,
    passer,
    get actif() { return actif; },
    get temps() { return t; },
  };
}
