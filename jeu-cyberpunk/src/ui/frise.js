import './ui.css';
import { TEXTES_FINS } from '../data/fins.js';

const AN_MIN = 2026;
const AN_MAX = 2076;

function el(tag, cls, parent, texte) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (texte != null) e.textContent = texte;
  if (parent) parent.appendChild(e);
  return e;
}

export function createFrise({ fragments = [], etat = {}, onOuvert, onFerme } = {}) {
  const racine = el('div', 'ui-frise', document.body);
  racine.setAttribute('role', 'dialog');
  racine.setAttribute('aria-label', "Frise de l'absence");
  const cadre = el('div', 'ui-frise-cadre', racine);

  const entete = el('div', 'ui-frise-entete', cadre);
  const t = el('div', 'ui-frise-titre', entete, "Frise de l'absence");
  el('small', null, t, '2026 — 2076');
  const compteurBloc = el('div', 'ui-frise-compteur', entete);
  const compteur = el('div', null, compteurBloc);
  el('span', null, compteurBloc, 'fragments retrouvés');

  const corps = el('div', 'ui-frise-corps', cadre);
  const ligne = el('div', 'ui-frise-ligne', corps);
  const fiche = el('div', 'ui-frise-fiche', corps);

  const pied = el('div', 'ui-frise-pied', cadre);
  const aide = el('div', null, pied);
  aide.innerHTML = '<b>←</b> <b>→</b> parcourir &nbsp; <b>clic</b> choisir une année';
  const bFermer = el('button', 'ui-frise-fermer', pied, 'Fermer — Échap / J');
  bFermer.type = 'button';
  bFermer.addEventListener('click', () => fermer());

  let ouvert = false;
  let parAnnee = new Map(); // année | 'x' -> fragments trouvés
  let allumees = [];
  let courant = null;
  const cases = new Map();

  function construire() {
    const trouves = new Set(etat.fragments || []);
    parAnnee = new Map();
    let n = 0;
    for (const f of fragments) {
      if (!trouves.has(f.id)) continue;
      n++;
      const k = f.annee == null ? 'x' : f.annee;
      if (!parAnnee.has(k)) parAnnee.set(k, []);
      parAnnee.get(k).push(f);
    }
    compteur.textContent = `${n} / ${fragments.length}`;
    allumees = [...parAnnee.keys()].sort((a, b) => (a === 'x') - (b === 'x') || a - b);

    ligne.textContent = '';
    cases.clear();
    for (let dec = Math.floor(AN_MIN / 10) * 10; dec <= AN_MAX; dec += 10) {
      const row = el('div', 'ui-decennie', ligne);
      el('div', 'ui-decennie-nom', row, `${dec}s`);
      for (let i = 0; i < 10; i++) {
        const an = dec + i;
        const c = el('button', 'ui-an', row);
        c.type = 'button';
        if (an < AN_MIN || an > AN_MAX) { c.classList.add('vide'); c.disabled = true; continue; }
        el('span', null, c, String(an));
        if (parAnnee.has(an)) {
          c.classList.add('allume');
          if (parAnnee.get(an).length > 1) el('span', 'ui-an-n', c, `×${parAnnee.get(an).length}`);
          c.addEventListener('click', () => choisir(an));
        } else c.tabIndex = -1;
        cases.set(an, c);
      }
    }
    const sd = el('div', 'ui-sansdate', ligne);
    const c = el('button', 'ui-an', sd);
    c.type = 'button';
    el('span', null, c, 'sans date');
    if (parAnnee.has('x')) {
      c.classList.add('allume');
      c.addEventListener('click', () => choisir('x'));
    } else c.tabIndex = -1;
    cases.set('x', c);
  }

  function choisir(k) {
    courant = k;
    for (const [an, c] of cases) c.classList.toggle('choisi', an === k);
    fiche.textContent = '';
    const liste = parAnnee.get(k);
    if (!liste) {
      el('div', 'ui-frise-vide', fiche, fragments.length
        ? "Rien n'est encore remonté à la surface.\nLes années s'allument à mesure que tu retrouves des fragments."
        : '');
      fiche.firstChild && (fiche.firstChild.style.whiteSpace = 'pre-wrap');
      return;
    }
    for (const f of liste) {
      const b = el('div', 'ui-fragment', fiche);
      el('div', 'ui-fragment-an', b, f.annee == null ? 'SANS DATE' : String(f.annee));
      el('h2', 'ui-fragment-titre', b, f.titre);
      if (f.lieu) el('div', 'ui-fragment-lieu', b, f.lieu);
      if ((etat.fragmentsConnus || []).includes(f.id)) el('div', 'ui-fragment-connu', b, TEXTES_FINS.dejaConnu);
      el('div', 'ui-fragment-texte', b, f.texte);
    }
    fiche.scrollTop = 0;
  }

  function deplacer(d) {
    if (!allumees.length) return;
    let i = allumees.indexOf(courant);
    i = i < 0 ? 0 : Math.max(0, Math.min(allumees.length - 1, i + d));
    choisir(allumees[i]);
    const c = cases.get(allumees[i]);
    if (c && c.scrollIntoView) c.scrollIntoView({ block: 'nearest' });
  }

  function surTouche(e) {
    e.stopPropagation();
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === 'Escape' || k === 'j' || k === 'J') { e.preventDefault(); if (!e.repeat) fermer(); }
    else if (k === 'ArrowRight' || k === 'ArrowDown') { e.preventDefault(); deplacer(1); }
    else if (k === 'ArrowLeft' || k === 'ArrowUp') { e.preventDefault(); deplacer(-1); }
  }
  const bloquer = (e) => e.stopPropagation();

  function ouvrir() {
    if (ouvert) return;
    ouvert = true;
    construire();
    if (allumees.length) choisir(allumees[0]); else choisir(null);
    racine.classList.add('ouvert');
    window.addEventListener('keydown', surTouche, true);
    window.addEventListener('keypress', bloquer, true);
    if (onOuvert) onOuvert();
  }
  function fermer() {
    if (!ouvert) return;
    ouvert = false;
    racine.classList.remove('ouvert');
    window.removeEventListener('keydown', surTouche, true);
    window.removeEventListener('keypress', bloquer, true);
    if (onFerme) onFerme();
  }
  racine.addEventListener('mousedown', (e) => e.stopPropagation());
  racine.addEventListener('click', (e) => e.stopPropagation());

  return {
    basculer() { ouvert ? fermer() : ouvrir(); },
    ouvrir,
    fermer,
    get estOuvert() { return ouvert; },
  };
}
