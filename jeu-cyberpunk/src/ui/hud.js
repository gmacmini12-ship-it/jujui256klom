import './ui.css';

function el(tag, cls, parent, texte) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (texte != null) e.textContent = texte;
  if (parent) parent.appendChild(e);
  return e;
}

const VITESSE_ECRITURE = 42; // lettres par seconde
const SORTIE_MIMA = 0.75; // durée de la disparition douce (s)

export function createHud() {
  const racine = el('div', 'ui-root', document.body);

  // --- Bandeau de Mima ---
  const bandeau = el('div', 'ui-panneau ui-mima', racine);
  el('div', 'ui-sceau', bandeau);
  const mimaTexte = el('div', 'ui-mima-texte', bandeau);
  const file = [];
  let cur = null; // { texte, duree, t, phase: 'ecrit' | 'tenue' | 'sortie', hold }
  let masque = false;

  function afficherTexte(n) {
    // la partie non écrite reste présente (invisible) pour que le bandeau ne change pas de taille
    mimaTexte.textContent = '';
    mimaTexte.append(cur.texte.slice(0, n));
    const reste = el('span', 'ui-fantome', mimaTexte, cur.texte.slice(n));
    void reste;
  }

  function demarrerSuivant() {
    cur = file.shift() || null;
    if (!cur) return;
    cur.t = 0; cur.phase = 'ecrit';
    const tEcriture = cur.texte.length / VITESSE_ECRITURE;
    cur.hold = Math.max(cur.duree - tEcriture, 1.5);
    afficherTexte(0);
    bandeau.classList.add('visible');
  }

  function majMima(dt) {
    if (masque) return;
    if (!cur) { if (file.length) demarrerSuivant(); return; }
    cur.t += dt;
    if (cur.phase === 'ecrit') {
      const n = Math.min(cur.texte.length, Math.floor(cur.t * VITESSE_ECRITURE));
      if (n !== cur.n) { cur.n = n; afficherTexte(n); }
      if (n >= cur.texte.length) { cur.phase = 'tenue'; cur.t = 0; }
    } else if (cur.phase === 'tenue') {
      if (cur.t >= cur.hold) { cur.phase = 'sortie'; cur.t = 0; bandeau.classList.remove('visible'); }
    } else if (cur.t >= SORTIE_MIMA) {
      cur = null;
      if (file.length) demarrerSuivant();
    }
  }

  // --- Notifications ---
  const pile = el('div', 'ui-notifs', racine);
  function notifier(texte, { duree = 4 } = {}) {
    const n = el('div', 'ui-panneau ui-notif', pile, texte);
    requestAnimationFrame(() => requestAnimationFrame(() => n.classList.add('visible')));
    setTimeout(() => {
      n.classList.add('sortie');
      setTimeout(() => n.remove(), 550);
    }, duree * 1000);
  }

  // --- Invite ---
  const inv = el('div', 'ui-panneau ui-invite', racine);
  let invTexte = null;
  function invite(texte) {
    const v = texte || null;
    if (v === invTexte) return;
    invTexte = v;
    if (!v) { inv.classList.remove('visible'); return; }
    inv.textContent = '';
    const i = v.indexOf(' — ');
    if (i > 0) {
      el('span', 'ui-touche', inv, v.slice(0, i));
      el('span', 'ui-invite-sep', inv, '—');
      el('span', null, inv, v.slice(i + 3));
    } else {
      el('span', null, inv, v);
    }
    inv.classList.add('visible');
  }

  // --- Titre de zone ---
  const tit = el('div', 'ui-titre', racine);
  const titGrand = el('div', 'ui-titre-grand', tit);
  const titSous = el('div', 'ui-titre-sous', tit);
  el('div', 'ui-titre-trait', tit);
  let titTimer = 0;
  function titre(texte, sousTitre) {
    clearTimeout(titTimer);
    titGrand.textContent = texte || '';
    titSous.textContent = sousTitre || '';
    titSous.style.display = sousTitre ? '' : 'none';
    tit.classList.remove('visible');
    void tit.offsetWidth;
    tit.classList.add('visible');
    titTimer = setTimeout(() => tit.classList.remove('visible'), 4600);
  }

  // --- Fondu ---
  const fond = el('div', 'ui-fondu', racine);
  let fonduTimer = 0;
  let fonduResolve = null;
  function fondu(versNoir, duree = 0.6) {
    clearTimeout(fonduTimer);
    if (fonduResolve) fonduResolve();
    fond.style.transitionDuration = `${duree}s`;
    fond.classList.toggle('noir', !!versNoir);
    return new Promise((res) => {
      fonduResolve = res;
      fonduTimer = setTimeout(() => { fonduResolve = null; res(); }, duree * 1000 + 30);
    });
  }

  // --- Boucle interne (le jeu peut aussi appeler update(dt) ; les deux ne s'additionnent pas) ---
  let externe = false;
  let dernier = performance.now();
  function boucle(now) {
    if (!externe) majMima(Math.min(0.1, (now - dernier) / 1000));
    dernier = now;
    requestAnimationFrame(boucle);
  }
  requestAnimationFrame(boucle);

  return {
    mima(texte, { duree = 6 } = {}) { file.push({ texte: String(texte), duree }); },
    masquerMima(b) {
      masque = !!b;
      bandeau.classList.toggle('masque', masque);
    },
    notifier,
    invite,
    titre,
    fondu,
    update(dt) { externe = true; majMima(Math.min(0.1, dt)); },
  };
}
