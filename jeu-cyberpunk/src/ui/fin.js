import './fin.css';
import { TEXTES_FINS } from '../data/fins.js';

// Écran de fin : fond noir, texte qui apparaît lentement, on avance avec Entrée / Espace / E / clic.
// Piloté par le temps réel (transitions CSS), pas par la boucle du jeu.
//
//   const fin = createFin();
//   await fin.assombrir(2.2);              // fondu au noir
//   await fin.jouer(pages);                // pages : [{ nom: 'epilogue', classe?, unites: [[{ texte, classe? }, …], …] }, …]
//   fin.cacher(1.2);                       // fondu de sortie (la couche noire reste tant qu'on ne l'enlève pas)
//
// Une page = une suite d'unités ; chaque unité (un paragraphe, ou un groupe de lignes qui arrivent l'une après l'autre)
// apparaît à l'appui suivant, la première seule. Après la dernière unité, l'appui suivant tourne la page ;
// après la dernière page, `jouer` se résout (l'écran reste noir).

const DELAI_ENTREE = 0.9; // s avant la première unité
const PAS_LIGNES = 1.1; // s entre les lignes d'une même unité
const GARDE = 380; // ms : un appui trop proche du précédent est ignoré (reste du dialogue, répétition)

export function createFin() {
  const racine = document.createElement('div');
  racine.className = 'ui-fin';
  const page = document.createElement('div');
  page.className = 'ui-fin-page';
  racine.appendChild(page);
  const suite = document.createElement('div');
  suite.className = 'ui-fin-suite';
  suite.textContent = TEXTES_FINS.suite;
  racine.appendChild(suite);
  document.body.appendChild(racine);

  let pages = [];
  let numero = -1;
  let unites = []; // [{ lignes: [el] }]
  let revelees = 0;
  let enCours = false;
  let resolution = null;
  let dernierAppui = 0;
  let minuteurs = [];

  const apres = (ms, fn) => {
    const id = setTimeout(fn, ms);
    minuteurs.push(id);
    return id;
  };
  const viderMinuteurs = () => {
    minuteurs.forEach(clearTimeout);
    minuteurs = [];
  };

  function reveler(i) {
    const u = unites[i];
    if (!u) return;
    suite.classList.remove('visible');
    u.lignes.forEach((el, k) => {
      apres(k * PAS_LIGNES * 1000, () => el.classList.add('visible'));
    });
    revelees = i + 1;
    // l'indication d'avancer revient quand la dernière ligne de l'unité est à peu près lisible
    apres(((u.lignes.length - 1) * PAS_LIGNES + 1.6) * 1000, () => suite.classList.add('visible'));
  }

  function construire(n) {
    viderMinuteurs();
    numero = n;
    const p = pages[n];
    page.textContent = '';
    page.className = `ui-fin-page ${p.nom || ''}`;
    unites = p.unites.map((lignes) => {
      const u = document.createElement('div');
      u.className = 'ui-fin-unite';
      const els = lignes.map((l) => {
        const el = document.createElement('p');
        el.className = `ui-fin-ligne ${l.classe || ''}`;
        el.textContent = l.texte;
        u.appendChild(el);
        return el;
      });
      page.appendChild(u);
      return { lignes: els };
    });
    revelees = 0;
    dernierAppui = performance.now();
    suite.classList.remove('visible');
    apres(DELAI_ENTREE * 1000, () => reveler(0));
  }

  function terminer() {
    enCours = false;
    viderMinuteurs();
    window.removeEventListener('keydown', surTouche, true);
    window.removeEventListener('keypress', bloquer, true);
    page.textContent = '';
    suite.classList.remove('visible');
    const r = resolution;
    resolution = null;
    r?.();
  }

  function avancer() {
    if (!enCours) return;
    const maintenant = performance.now();
    if (maintenant - dernierAppui < GARDE) return;
    dernierAppui = maintenant;
    if (revelees === 0) { viderMinuteurs(); reveler(0); return; }
    if (revelees < unites.length) { reveler(revelees); return; }
    // dernière unité : on finit d'afficher ses lignes, puis la page suivante
    const toutes = unites[unites.length - 1].lignes;
    if (toutes.some((el) => !el.classList.contains('visible'))) {
      viderMinuteurs();
      toutes.forEach((el) => el.classList.add('visible'));
      apres(500, () => suite.classList.add('visible'));
      return;
    }
    if (numero + 1 >= pages.length) { terminer(); return; }
    viderMinuteurs();
    suite.classList.remove('visible');
    page.classList.add('sortie');
    apres(750, () => construire(numero + 1));
  }

  function bloquer(e) { e.stopPropagation(); }
  function surTouche(e) {
    // le jeu ne reçoit plus rien tant que l'écran est ouvert
    e.stopPropagation();
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === 'Enter' || k === ' ' || k === 'e' || k === 'E' || k === 'ArrowRight') {
      e.preventDefault();
      if (!e.repeat) avancer();
    }
  }
  racine.addEventListener('mousedown', (e) => e.stopPropagation());
  racine.addEventListener('click', (e) => { e.stopPropagation(); avancer(); });
  racine.addEventListener('contextmenu', (e) => e.preventDefault());

  let timerNoir = 0;
  function fondu(vers, duree) {
    clearTimeout(timerNoir);
    racine.style.transitionDuration = `${duree}s`;
    if (vers) {
      racine.classList.add('present');
      void racine.offsetWidth;
      racine.classList.add('noir');
    } else {
      racine.classList.remove('noir');
    }
    return new Promise((res) => {
      timerNoir = setTimeout(() => {
        if (!vers) { racine.classList.remove('present'); page.textContent = ''; }
        res();
      }, duree * 1000 + 30);
    });
  }

  return {
    /** Fondu au noir (la couche passe devant tout sauf l'écran titre). */
    assombrir(duree = 2) { return fondu(true, duree); },
    /** Fondu de sortie, puis la couche disparaît. */
    cacher(duree = 1.2) { return fondu(false, duree); },
    /** Joue les pages ; se résout après la dernière (l'écran reste noir). */
    jouer(p) {
      pages = p.filter((x) => x.unites.length);
      return new Promise((res) => {
        if (!pages.length) { res(); return; }
        resolution = res;
        enCours = true;
        window.addEventListener('keydown', surTouche, true);
        window.addEventListener('keypress', bloquer, true);
        construire(0);
      });
    },
    get visible() { return racine.classList.contains('present'); },
    get enCours() { return enCours; },
    /** Diagnostic : numéro de page, unités révélées / total (tests). */
    get etat() { return { page: numero, nom: pages[numero]?.nom || null, reveles: revelees, unites: unites.length, pages: pages.length }; },
  };
}
