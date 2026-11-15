import { ACCUEIL, COMMANDES } from '../data/interface.js';

// Écran d'accueil et de pause (#overlay dans index.html).
// Modes : 'titre' (premier lancement), 'pause' (Échap), 'souris' (la souris n'a pas pu être reprise).
//   surJouer()     : commencer, reprendre ou continuer
//   surNouvelle()  : recommencer une partie (demande une confirmation si une partie existe)

export function createAccueil({ input, surJouer, surNouvelle }) {
  const racine = document.getElementById('overlay');
  racine.textContent = '';
  const el = (tag, cls, parent, texte) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (texte != null) e.textContent = texte;
    parent.appendChild(e);
    return e;
  };

  const sur = el('div', 'sub', racine, ACCUEIL.surtitre);
  el('h1', null, racine, ACCUEIL.titre);
  const etatEl = el('div', 'etat', racine, '');
  const boutons = el('div', 'boutons', racine);
  const bJouer = el('button', 'go', boutons, ACCUEIL.commencer);
  bJouer.type = 'button';
  const bNouvelle = el('button', 'go secondaire', boutons, ACCUEIL.nouvellePartie);
  bNouvelle.type = 'button';
  const table = el('table', null, racine);

  let aUnePartie = false;
  let confirmation = false;
  let mode = 'titre';

  function remplirCommandes() {
    table.textContent = '';
    for (const c of COMMANDES) {
      const tr = el('tr', null, table);
      const touches = c.codes ? c.codes.map((k) => input.label(k)).join(' ') + (c.suffixe || '') : c.touche;
      el('td', null, tr, touches);
      el('td', null, tr, c.texte);
    }
  }

  function maj() {
    confirmation = false;
    bNouvelle.textContent = ACCUEIL.nouvellePartie;
    if (mode === 'titre') {
      bJouer.textContent = aUnePartie ? ACCUEIL.reprendre : ACCUEIL.commencer;
      etatEl.textContent = '';
    } else if (mode === 'pause') {
      bJouer.textContent = ACCUEIL.continuer;
      etatEl.textContent = ACCUEIL.pause;
    } else {
      bJouer.textContent = ACCUEIL.continuer;
      etatEl.textContent = ACCUEIL.sourisPerdue;
    }
    bNouvelle.style.display = aUnePartie || mode !== 'titre' ? '' : 'none';
    sur.style.display = '';
  }

  bJouer.addEventListener('click', (e) => {
    e.stopPropagation();
    surJouer();
  });
  bNouvelle.addEventListener('click', (e) => {
    e.stopPropagation();
    if ((aUnePartie || mode !== 'titre') && !confirmation) {
      confirmation = true;
      bNouvelle.textContent = ACCUEIL.confirmerNouvelle;
      return;
    }
    confirmation = false;
    surNouvelle();
  });
  // un clic ailleurs sur l'écran vaut « jouer » (comme le prototype)
  racine.addEventListener('click', () => surJouer());

  remplirCommandes();
  maj();

  return {
    montrer(m = 'pause') {
      mode = m;
      maj();
      racine.classList.remove('hidden');
    },
    cacher() {
      racine.classList.add('hidden');
    },
    get visible() {
      return !racine.classList.contains('hidden');
    },
    set aUnePartie(v) {
      aUnePartie = !!v;
      maj();
    },
    remplirCommandes,
  };
}
