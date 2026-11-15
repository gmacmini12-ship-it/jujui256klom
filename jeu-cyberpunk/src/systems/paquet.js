// Système « paquet » : le paquet de cigarettes du joueur (etat.cigarettes.paquet, 9 au départ).
// Paquet vide : la main ne trouve plus rien à allumer. Textes dans src/data/paquet.js.
import { sauver } from '../state.js';
import { PAQUET } from '../data/paquet.js';

const DELAI_VIDE = 3; // secondes minimum entre deux notifications « paquet vide »

// Valeurs de `smoking.etat` où aucune cigarette n'est en main : 'idle' (rien),
// 'discard' (la cigarette vient d'être jetée ; F en relance une, voir smoking.trigger).
const RIEN_EN_MAIN = ['idle', 'discard'];

export const paquet = {
  nom: 'paquet',
  horloge: 0,
  dernierVide: -Infinity,

  init(jeu) {
    jeu.on('cigarette:avant', (ev, jeu) => {
      if (jeu.etat.cigarettes.paquet > 0) return;
      if (!RIEN_EN_MAIN.includes(jeu.smoking.etat)) return;
      ev.annule = true;
      if (this.horloge - this.dernierVide >= DELAI_VIDE) {
        this.dernierVide = this.horloge;
        jeu.hud?.notifier(PAQUET.vide);
      }
    });

    jeu.on('cigarette:allumage', (_, jeu) => {
      const c = jeu.etat.cigarettes;
      c.paquet -= 1;
      c.fumees += 1;
      sauver();
      jeu.hud?.notifier(PAQUET.restant.replace('{n}', String(c.paquet)), { duree: 3 });
      jeu.masquerMima('cigarette', true);
    });

    jeu.on('cigarette:jetee', (_, jeu) => jeu.masquerMima('cigarette', false));
    jeu.on('partie:nouvelle', (_, jeu) => jeu.masquerMima('cigarette', false));
  },

  update(dt) {
    this.horloge += dt;
  },
};
