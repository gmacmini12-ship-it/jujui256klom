// Système « bond » (tâche 2.5, bible §4.2) : la neuroprothèse motrice des jambes.
//
// - N'agit que si `etat.pouvoirs` contient 'bond'. Sans lui, Espace reste le saut normal
//   (géré par player.js, dès l'appui).
// - Avec lui, le saut part au RELÂCHEMENT d'Espace : appui bref = saut normal ;
//   appui de 0,4 s ou plus = Bond : saut vertical d'environ 9 m, ou, en course (Maj),
//   saut long d'environ 15 m. Les chutes sont amorties jusqu'à 12 m
//   (`jeu.player.amortissement`, repris dans l'évènement `joueur:atterrissage`).
// - Retour sobre : pendant la charge, champ de vision qui se resserre un peu et vue qui
//   s'abaisse ; à l'impulsion, champ qui s'ouvre puis revient ; sons brefs via jeu.audio.
// - `bond.accorder()` : ajoute le pouvoir, sauve, notifie (appelé par le dialogue de Kaede).
//
// Évènements émis : `bond:charge` (la charge est prête), `bond:impulsion { type: 'vertical' | 'long' }`,
// `pouvoir:accorde { nom: 'bond' }`.
import { BOND } from '../data/bond.js';
import { AMORTI_BASE, GRAVITE } from '../player.js';

const CHARGE = 0.4; // s d'appui pour un Bond
const HAUTEUR = 9; // m, saut vertical
const V_VERTICAL = Math.sqrt(2 * GRAVITE * HAUTEUR); // ≈ 19 m/s
const LONG = { vy: 8.2, vh: 21, controleAir: 0.35 }; // saut long en course : ≈ 15 m sur le plat
const SEUIL_COURSE = 8; // m/s
const AMORTI = 12; // m
const FOV_CHARGE = -4; // degrés, au maximum de la charge
const FOV_IMPULSION = 9; // degrés, à l'impulsion (revient ensuite)
const ACCROUPI = -0.22; // m, vue abaissée pendant la charge

const possede = (jeu) => !!jeu.etat?.pouvoirs?.includes('bond');

export const bond = {
  nom: 'bond',
  /** Durée de la charge en cours (s). */
  charge: 0,
  /** La charge a atteint 0,4 s : relâcher déclenche un Bond. */
  pret: false,
  /** Un Bond est en vol (jusqu'à l'atterrissage). */
  enVol: null,
  fovBase: 72,
  kick: 0,
  sonCharge: false,
  applique: false,

  /** Donne le pouvoir (une fois), sauve et notifie. Renvoie vrai s'il vient d'être ajouté. */
  accorder() {
    const jeu = this.jeu;
    if (!jeu?.etat) return false;
    if (possede(jeu)) return false;
    jeu.etat.pouvoirs.push('bond');
    jeu.sauver?.();
    jeu.hud?.notifier(BOND.notification.replace('{touche}', jeu.input?.label('Space') ?? 'Espace'), { duree: 6 });
    jeu.emettre('pouvoir:accorde', { nom: 'bond' });
    return true;
  },

  get actif() {
    return !!this.jeu && possede(this.jeu);
  },

  init(jeu) {
    this.jeu = jeu;
    jeu.bond = this;
    this.fovBase = jeu.camera?.fov ?? 72;
    jeu.on('partie:nouvelle', () => this.remettre());
    jeu.on('joueur:atterrissage', (ev) => {
      if (!possede(jeu)) return;
      const enVol = this.enVol;
      this.enVol = null;
      // chute amortie par les tendons : un souffle grave, bref
      if (ev.amortie && ev.hauteurChute > AMORTI_BASE) jeu.audio?.souffle?.({ de: 900, vers: 110, duree: 0.28, volume: 0.1 });
      else if (enVol) jeu.audio?.tonalite?.({ de: 70, vers: 40, duree: 0.18, volume: 0.05 });
    });
  },

  remettre() {
    this.charge = 0;
    this.pret = false;
    this.enVol = null;
    this.kick = 0;
    this.sonCharge = false;
  },

  update(dt, t, jeu) {
    const p = jeu.player;
    if (!p) return;
    const a = possede(jeu);
    p.sautAuto = !a;
    // amortissement : porté à 12 m tant que le pouvoir est là
    if (a && p.amortissement < AMORTI) { p.amortissement = AMORTI; this.applique = true; }
    if (!a && this.applique) { p.amortissement = AMORTI_BASE; this.applique = false; }

    if (a && jeu.jouable) this.commande(dt, p, jeu);
    else { this.charge = 0; this.pret = false; this.sonCharge = false; }
    this.retour(dt, p, jeu);
  },

  commande(dt, p, jeu) {
    const input = jeu.input;
    if (input.isDown('Space')) {
      this.charge += dt;
      if (!this.sonCharge && this.charge >= 0.12 && p.auSol) {
        this.sonCharge = true;
        jeu.audio?.tonalite?.({ de: 70, vers: 150, duree: CHARGE - 0.1, volume: 0.035 });
      }
      if (!this.pret && this.charge >= CHARGE) {
        this.pret = true;
        jeu.audio?.bip?.({ frequence: 520, duree: 0.07, volume: 0.035 });
        jeu.emettre('bond:charge', {});
      }
      return;
    }
    if (this.charge <= 0) return;
    // relâché
    const c = this.charge;
    this.charge = 0;
    this.pret = false;
    this.sonCharge = false;
    if (!p.auSol) return;
    if (c < CHARGE) {
      p.sauter();
      return;
    }
    const v = p.velocity;
    const vh = Math.hypot(v.x, v.z);
    const court = vh > SEUIL_COURSE && (input.isDown('ShiftLeft') || input.isDown('ShiftRight'));
    if (court) {
      p.impulser((v.x / vh) * LONG.vh, LONG.vy, (v.z / vh) * LONG.vh, { controleAir: LONG.controleAir });
    } else {
      p.impulser(null, V_VERTICAL, null);
    }
    const type = court ? 'long' : 'vertical';
    this.enVol = { type, t: jeu.t, y: p.position.y };
    this.kick = 1;
    jeu.audio?.souffle?.({ de: 220, vers: 1700, duree: 0.42, volume: 0.13 });
    jeu.audio?.tonalite?.({ de: 120, vers: 45, duree: 0.22, volume: 0.07 });
    jeu.emettre('bond:impulsion', { type });
  },

  // Champ de vision et hauteur de vue.
  retour(dt, p, jeu) {
    const cam = jeu.camera;
    if (!cam) return;
    const k = Math.max(0, Math.min(1, (this.charge - 0.1) / (CHARGE - 0.1)));
    this.kick *= Math.exp(-dt * 4.5);
    if (this.kick < 0.002) this.kick = 0;
    const fov = this.fovBase + FOV_CHARGE * k + FOV_IMPULSION * this.kick;
    p.decalageVue = p.auSol ? ACCROUPI * k : 0;
    if (Math.abs(cam.fov - fov) > 1e-3) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  },
};
