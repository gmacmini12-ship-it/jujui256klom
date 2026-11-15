// Système « sourdine » (étape 4, bible §4.3) : fermer sa pensée. Le joueur devient opaque à Mima.
//
// - N'agit que si `etat.pouvoirs` contient 'sourdine' (accordé par `jeu.sourdine.accorder()`, appelé par le
//   dialogue de la docteure Sall). Sans lui, X ne fait rien.
// - Touche : maintenir X (`KeyX`). Jauge de 20 s ; elle se recharge relâchée, en 30 s pour une jauge vide.
//   Quand elle est vide, la Sourdine cesse et il faut relâcher X avant d'en rouvrir une.
// - Tant que `actif` :
//     · la bande de Mima se tait (`jeu.masquerMima('sourdine')`), sa file est vidée (rien ne ressort à la fin) ;
//     · la couche sonore « accompagnée » disparaît en 0,5 s (`jeu.audio.accompagnement`) : la pluie reste, plus brute ;
//     · image « brute » : couleurs désaturées, vignette plus serrée (uniform `sourdine` de FilmShader) ;
//     · l'Attention est en pause (attention.js), les réactions figées, les Veilleurs suiveurs perdent leur cible,
//       les rideaux « pour entretien » se relèvent (reactions.js), pas d'appel du palier 4 (conversation.js),
//       pas de rattrapage par le Veilleur (veilleur.js), plus de conseils (conseils.js).
//   N'a aucun effet sur les Sentinelles (aucune ici).
// - État sauvegardé : `etat.sourdineUsages` (activations), `etat.sourdineTemps` (secondes cumulées).
//
// API : `jeu.sourdine` = { actif, jauge (0..1), possede, accorder(), duree (s de l'usage en cours) }.
// Évènements : `sourdine:debut`, `sourdine:fin { duree }`, `pouvoir:accorde { nom: 'sourdine' }`.
import { SOURDINE } from '../data/sourdine.js';

const DUREE_JAUGE = 20; // s d'usage pour une jauge pleine
const DUREE_RECHARGE = 30; // s pour une recharge complète
const SEUIL_DEBUT = 0.05; // jauge minimale pour ouvrir une Sourdine
const FONDU_SON = 0.5; // s : la couche accompagnée disparaît
const FONDU_SON_RETOUR = 0.9; // s : elle revient
const VITESSE_IMAGE = 4; // 1/s : lissage du traitement d'image

const possede = (jeu) => !!jeu.etat?.pouvoirs?.includes('sourdine');

export const sourdine = {
  nom: 'sourdine',
  /** La Sourdine est ouverte (lue par attention, reactions, conversation, veilleur, conseils). */
  actif: false,
  /** Jauge 0..1 (1 = pleine). Non sauvegardée : elle est pleine au chargement. */
  jauge: 1,
  /** Durée (s) de l'usage en cours. */
  duree: 0,
  /** Niveau du traitement d'image 0..1 (lissé). */
  image: 0,
  /** X doit être relâché avant de rouvrir (jauge vidée en tenant la touche). */
  verrou: false,

  get possede() {
    return !!this.jeu && possede(this.jeu);
  },

  /** Donne le pouvoir (une fois), sauve et notifie. Renvoie vrai s'il vient d'être ajouté. */
  accorder() {
    const jeu = this.jeu;
    if (!jeu?.etat) return false;
    if (possede(jeu)) return false;
    jeu.etat.pouvoirs.push('sourdine');
    jeu.sauver?.();
    jeu.hud?.notifier(SOURDINE.notification.replace('{touche}', jeu.input?.label('KeyX') ?? 'X'), { duree: 6 });
    jeu.emettre('pouvoir:accorde', { nom: 'sourdine' });
    return true;
  },

  init(jeu) {
    this.jeu = jeu;
    jeu.sourdine = this;
    etatNombre(jeu.etat, 'sourdineUsages');
    etatNombre(jeu.etat, 'sourdineTemps');
    jeu.on('partie:nouvelle', () => this.remettre());
    this.construireIndicateur();
  },

  /** Nouvelle partie : tout revient au repos (aucun usage compté pour une Sourdine interrompue). */
  remettre() {
    const jeu = this.jeu;
    if (this.actif) this.fermer(false);
    this.jauge = 1;
    this.duree = 0;
    this.verrou = false;
    this.image = 0;
    this.majImage(0, true);
    this.majIndicateur();
    jeu.masquerMima('sourdine', false);
  },

  // ---------------------------------------------------------------- ouverture / fermeture
  ouvrir() {
    const jeu = this.jeu;
    this.actif = true;
    this.duree = 0;
    jeu.etat.sourdineUsages = (jeu.etat.sourdineUsages || 0) + 1;
    jeu.masquerMima('sourdine', true);
    jeu.hud?.viderMima?.({ courant: true }); // la voix se tait net, la file est jetée
    jeu.audio?.accompagnement?.(0, FONDU_SON);
    jeu.audio?.tonalite?.({ de: 260, vers: 55, duree: 0.45, volume: 0.05 });
    jeu.sauver?.();
    jeu.emettre('sourdine:debut', {});
  },

  /** Ferme la Sourdine. `compter` faux : fermeture silencieuse (nouvelle partie). */
  fermer(compter = true) {
    const jeu = this.jeu;
    if (!this.actif) return;
    const duree = this.duree;
    this.actif = false;
    this.duree = 0;
    jeu.hud?.viderMima?.(); // ce que Mima aurait dit pendant ce temps ne ressort pas
    jeu.masquerMima('sourdine', false);
    jeu.audio?.accompagnement?.(1, FONDU_SON_RETOUR);
    if (!compter) return;
    jeu.audio?.tonalite?.({ de: 70, vers: 190, duree: 0.5, volume: 0.04 });
    jeu.sauver?.();
    jeu.emettre('sourdine:fin', { duree });
  },

  // ---------------------------------------------------------------- boucle
  update(dt, t, jeu) {
    if (dt > 0.25) dt = 0.25;
    const veut = possede(jeu) && jeu.jouable && jeu.input.isDown('KeyX');
    if (!veut) this.verrou = false;

    if (this.actif) {
      if (!veut || this.jauge <= 0) {
        if (veut) this.verrou = true; // vide en tenant la touche : il faut relâcher
        this.fermer();
      } else {
        this.jauge = Math.max(0, this.jauge - dt / DUREE_JAUGE);
        this.duree += dt;
        jeu.etat.sourdineTemps = (jeu.etat.sourdineTemps || 0) + dt;
        jeu.hud?.viderMima?.(); // rien de ce qui est dit pendant la Sourdine ne reste en attente
        if (this.jauge <= 0) { this.verrou = true; this.fermer(); }
      }
    } else {
      if (veut && !this.verrou && this.jauge >= SEUIL_DEBUT) this.ouvrir();
      else if (this.jauge < 1) this.jauge = Math.min(1, this.jauge + dt / DUREE_RECHARGE);
    }
    this.majImage(dt);
    this.majIndicateur();
  },

  majImage(dt, force = false) {
    const cible = this.actif ? 1 : 0;
    this.image = force ? cible : this.image + (cible - this.image) * Math.min(1, dt * VITESSE_IMAGE);
    if (Math.abs(this.image - cible) < 0.004) this.image = cible;
    const u = this.jeu.film?.uniforms?.sourdine;
    if (u) u.value = this.image;
  },

  // ---------------------------------------------------------------- indicateur discret
  construireIndicateur() {
    if (typeof document === 'undefined') return;
    const racine = document.querySelector('.ui-root') || document.body;
    const boite = document.createElement('div');
    boite.className = 'ui-sourdine';
    const nom = document.createElement('span');
    nom.className = 'ui-sourdine-nom';
    const barre = document.createElement('span');
    barre.className = 'ui-sourdine-barre';
    const rempli = document.createElement('span');
    barre.appendChild(rempli);
    boite.append(nom, barre);
    racine.appendChild(boite);
    this._ui = { boite, nom, rempli, visible: false, recharge: null, largeur: -1 };
  },

  majIndicateur() {
    const ui = this._ui;
    if (!ui) return;
    const visible = this.possede && (this.actif || this.jauge < 0.999);
    if (visible !== ui.visible) { ui.visible = visible; ui.boite.classList.toggle('visible', visible); }
    if (!visible) return;
    const recharge = !this.actif;
    if (recharge !== ui.recharge) {
      ui.recharge = recharge;
      ui.boite.classList.toggle('recharge', recharge);
      ui.nom.textContent = recharge ? SOURDINE.recharge : SOURDINE.indicateur;
    }
    const l = Math.round(this.jauge * 100);
    if (l !== ui.largeur) { ui.largeur = l; ui.rempli.style.width = `${l}%`; }
  },
};

/** Garantit que `etat[cle]` est un nombre (sauvegarde ancienne) et le renvoie. */
function etatNombre(etat, cle) {
  if (typeof etat[cle] !== 'number' || !Number.isFinite(etat[cle])) etat[cle] = 0;
  return etat[cle];
}
