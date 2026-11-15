// Attention de Mima (bible §7.2) : valeur cachée 0–100 dans `etat.attention`.
//
// API : `jeu.attention` = { valeur, palier, plancher, enPause, ajouter(points, { id, source }), fixer(v) }.
//   - valeur  : 0..100 (lecture de etat.attention, sauvegardée) ; palier : 0..4 (data/attention.js, SEUILS) ;
//   - plancher : 4 × nombre de types de transgressions différents (etat.transgressions > 0) ;
//   - enPause : vrai si jeu.sourdine?.actif (ni montée ni descente) ;
//   - ajouter : ajoute des points (ignoré en pause), remet à zéro le délai de décroissance ;
//   - fixer(v) : impose la valeur (sans plancher, sans pause) : pour la conversation du palier 4 (retombée à 60) et les tests.
// Entrée : évènement `transgression { id: 'T1'…'T15', source, attention? }`. L'ÉMETTEUR incrémente
//   etat.transgressions[id] (une fois) et émet `transgression` (une fois) ; ici on n'ajoute que des points.
// Sortie : `attention:change { valeur, delta, id }` (id = 'T…', 'decroissance', 'fixer', 'nouvelle'),
//   `attention:palier { palier, ancien }` (montée et descente).
// Décroissance : 1 point toutes les 30 s sans transgression, jusqu'au plancher (partie en cours seulement).
// Débogage : `?attention` dans l'URL affiche la valeur en haut à gauche. Aucune jauge sinon.

import { MONTANTS, SEUILS, MAX, PERIODE_DECROISSANCE, FACTEUR_PLANCHER, TEXTES } from '../data/attention.js';

const borne = (v) => Math.max(0, Math.min(MAX, v));

export function palierDe(v) {
  let p = 0;
  for (let i = 0; i < SEUILS.length; i++) if (v >= SEUILS[i]) p = i;
  return p;
}

export const attention = {
  nom: 'attention',

  init(jeu) {
    this.jeu = jeu;
    this.calme = 0; // secondes depuis la dernière transgression
    this._palier = palierDe(this.valeurBrute());
    const systeme = this;

    jeu.attention = {
      get valeur() { return systeme.valeurBrute(); },
      get palier() { return palierDe(systeme.valeurBrute()); },
      get plancher() { return systeme.plancher(); },
      get enPause() { return !!jeu.sourdine?.actif; },
      ajouter: (points, infos) => systeme.ajouter(points, infos),
      fixer: (v) => systeme.fixer(v),
    };

    jeu.on('transgression', (ev) => {
      if (!ev || !ev.id) return;
      const pts = Number.isFinite(ev.attention) ? ev.attention : (MONTANTS[ev.id] ?? 0);
      systeme.ajouter(pts, { id: ev.id, source: ev.source });
    });
    jeu.on('partie:debut', () => { this.calme = 0; this._palier = palierDe(this.valeurBrute()); });
    jeu.on('partie:nouvelle', () => {
      this.calme = 0;
      const ancien = this._palier;
      this._palier = palierDe(this.valeurBrute());
      jeu.emettre('attention:change', { valeur: this.valeurBrute(), delta: 0, id: 'nouvelle' });
      if (this._palier !== ancien) jeu.emettre('attention:palier', { palier: this._palier, ancien });
    });

    if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('attention')) {
      const el = document.createElement('div');
      el.style.cssText = 'position:fixed;left:8px;top:8px;z-index:99999;padding:3px 8px;font:12px monospace;color:#9fe;background:rgba(0,0,0,.6);pointer-events:none';
      document.body.appendChild(el);
      this.debogage = el;
    }
  },

  valeurBrute() { return Number(this.jeu.etat.attention) || 0; },

  plancher() {
    const t = this.jeu.etat.transgressions || {};
    return FACTEUR_PLANCHER * Object.values(t).filter((n) => n > 0).length;
  },

  /** Écrit la valeur, met à jour le maximum, émet change puis palier. */
  ecrire(v, id) {
    const jeu = this.jeu;
    const ancienneValeur = this.valeurBrute();
    v = borne(v);
    const delta = v - ancienneValeur;
    jeu.etat.attention = v;
    if (v > (jeu.etat.attentionMax || 0)) jeu.etat.attentionMax = v;
    if (delta === 0) return 0;
    jeu.emettre('attention:change', { valeur: v, delta, id });
    const ancien = this._palier;
    const palier = palierDe(v);
    if (palier !== ancien) {
      this._palier = palier;
      jeu.emettre('attention:palier', { palier, ancien });
    }
    return delta;
  },

  ajouter(points, { id = 'ajout', source } = {}) {
    const jeu = this.jeu;
    if (jeu.sourdine?.actif) return 0;
    if (points > 0) this.calme = 0;
    if (!points) return 0;
    return this.ecrire(Math.max(this.valeurBrute() + points, Math.min(this.plancher(), MAX)), id);
  },

  fixer(v) {
    this.calme = 0;
    return this.ecrire(Number(v) || 0, 'fixer');
  },

  update(dt, t, jeu) {
    if (!jeu.enPartie) return;
    if (jeu.sourdine?.actif) { this.maj(); return; }
    this.calme += dt;
    while (this.calme >= PERIODE_DECROISSANCE) {
      this.calme -= PERIODE_DECROISSANCE;
      const v = this.valeurBrute();
      const plancher = this.plancher();
      if (v > plancher) this.ecrire(Math.max(plancher, v - 1), 'decroissance');
    }
    this.maj();
  },

  maj() {
    if (!this.debogage) return;
    const a = this.jeu.attention;
    const txt = TEXTES.debogage(Math.round(a.valeur * 10) / 10, a.palier, a.plancher, a.enPause);
    if (this.debogage.textContent !== txt) this.debogage.textContent = txt;
  },
};
