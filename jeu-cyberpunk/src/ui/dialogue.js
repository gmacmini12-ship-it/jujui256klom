import './ui.css';

function el(tag, cls, parent, texte) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (texte != null) e.textContent = texte;
  if (parent) parent.appendChild(e);
  return e;
}

const VITESSE = 55; // lettres par seconde
const TOUCHES_CAPTEES = new Set(['Enter', ' ', 'e', 'E', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export function createDialogue({ etat = {}, onOuvert, onFerme } = {}) {
  const voile = el('div', 'ui-dialogue-voile', document.body);
  const boite = el('div', 'ui-panneau ui-dialogue', voile);
  const nomEl = el('div', 'ui-dialogue-nom', boite);
  const texteEl = el('div', 'ui-dialogue-texte', boite);
  const choixEl = el('div', 'ui-dialogue-choix', boite);
  const suiteEl = el('div', 'ui-dialogue-suite', boite, '▼');

  let ouvert = false;
  let dlg = null, noeud = null, resolveFin = null;
  let plein = ''; let nEcrit = 0; let ecrit = true; let rafId = 0; let t0 = 0;
  let visibles = []; let actif = 0;

  function afficherChoix() {
    choixEl.textContent = '';
    visibles.forEach((c, i) => {
      const ligne = el('div', 'ui-choix' + (i === actif ? ' actif' : ''), choixEl);
      el('span', 'ui-choix-num', ligne, `${i + 1}.`);
      el('span', null, ligne, c.texte);
      ligne.addEventListener('mouseenter', () => { actif = i; majActif(); });
      ligne.addEventListener('click', (e) => { e.stopPropagation(); choisir(i); });
    });
    choixEl.classList.add('visible');
  }
  function majActif() {
    [...choixEl.children].forEach((c, i) => c.classList.toggle('actif', i === actif));
  }

  function finEcriture() {
    cancelAnimationFrame(rafId);
    ecrit = true;
    texteEl.textContent = plein;
    if (visibles.length) { actif = 0; afficherChoix(); suiteEl.classList.remove('visible'); }
    else suiteEl.classList.add('visible');
  }

  function boucle(now) {
    const n = Math.floor((now - t0) / 1000 * VITESSE);
    if (n >= plein.length) { finEcriture(); return; }
    if (n !== nEcrit) { nEcrit = n; texteEl.textContent = plein.slice(0, n); }
    rafId = requestAnimationFrame(boucle);
  }

  function aller(id) {
    if (id == null || !dlg.noeuds[id]) { fin(); return; }
    noeud = dlg.noeuds[id];
    plein = String(noeud.texte ?? '');
    visibles = (noeud.choix || []).filter((c) => !c.si || c.si(etat));
    // un nœud dont tous les choix sont masqués se comporte comme un nœud sans choix
    const qui = noeud.qui || '';
    nomEl.textContent = '';
    nomEl.classList.toggle('vide', !qui);
    if (qui) {
      if (qui.toLowerCase() === 'mima') el('span', 'ui-sceau', nomEl);
      el('span', null, nomEl, qui);
    }
    texteEl.classList.toggle('narration', !qui);
    choixEl.classList.remove('visible');
    suiteEl.classList.remove('visible');
    choixEl.textContent = '';
    nEcrit = 0; ecrit = false; t0 = performance.now();
    texteEl.textContent = '';
    cancelAnimationFrame(rafId);
    if (!plein.length) finEcriture(); else rafId = requestAnimationFrame(boucle);
  }

  function suivant() {
    if (!ecrit) { finEcriture(); return; }
    if (visibles.length) return; // il faut choisir
    aller(noeud.suite ?? null);
  }

  function choisir(i) {
    if (!ecrit) { finEcriture(); return; }
    const c = visibles[i];
    if (!c) return;
    if (c.effet) c.effet(etat);
    aller(c.vers ?? null);
  }

  function fin() {
    if (!ouvert) return;
    ouvert = false;
    cancelAnimationFrame(rafId);
    window.removeEventListener('keydown', surTouche, true);
    window.removeEventListener('keypress', bloquer, true);
    voile.classList.remove('ouvert');
    const r = resolveFin; resolveFin = null; dlg = null; noeud = null;
    if (onFerme) onFerme();
    if (r) r();
  }

  function bloquer(e) { e.stopPropagation(); }

  function surTouche(e) {
    // le jeu ne doit rien recevoir tant que le dialogue est ouvert
    e.stopPropagation();
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (TOUCHES_CAPTEES.has(e.key) || /^[1-9]$/.test(e.key)) e.preventDefault();
    if (e.repeat) return;
    const k = e.key;
    if (k === 'Escape') {
      if (visibles.length) return; // choix en attente : on ne ferme pas
      fin();
    } else if (k === 'Enter' || k === ' ' || k === 'e' || k === 'E') {
      if (ecrit && visibles.length) { if (k === 'Enter') choisir(actif); }
      else suivant();
    } else if (/^[1-9]$/.test(k)) {
      if (!ecrit) finEcriture();
      else if (visibles[+k - 1]) choisir(+k - 1);
    } else if ((k === 'ArrowDown' || k === 'ArrowUp') && ecrit && visibles.length) {
      actif = (actif + (k === 'ArrowDown' ? 1 : visibles.length - 1)) % visibles.length;
      majActif();
    }
  }

  // clic n'importe où : accélère / avance (les choix gèrent leur propre clic)
  voile.addEventListener('mousedown', (e) => e.stopPropagation());
  voile.addEventListener('click', (e) => { e.stopPropagation(); suivant(); });
  voile.addEventListener('contextmenu', (e) => e.preventDefault());

  return {
    ouvrir(dialogue) {
      if (ouvert) fin();
      return new Promise((resolve) => {
        resolveFin = resolve;
        dlg = dialogue; ouvert = true;
        voile.classList.add('ouvert');
        boite.style.animation = 'none'; void boite.offsetWidth; boite.style.animation = '';
        window.addEventListener('keydown', surTouche, true);
        window.addEventListener('keypress', bloquer, true);
        if (onOuvert) onOuvert();
        aller(dialogue.debut);
      });
    },
    get estOuvert() { return ouvert; },
    fermer() { fin(); },
  };
}
