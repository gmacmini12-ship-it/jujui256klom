// Système « questions » (étape 4, bible §2.1) : poser des questions à Mima, à l'anneau.
//
// `jeu.questions.ouvrir()` ouvre un dialogue construit à la volée (format de src/ui/dialogue.js) :
//   - la liste des questions disponibles (`si(etat)`), les non posées d'abord, les posées marquées en fin de liste ;
//   - choisir une question affiche la réponse de Mima (une ou plusieurs phrases), puis revient à la liste ;
//   - « (Ne rien demander.) » ferme ; au plus 9 choix à l'écran : au-delà, 7 questions par page et
//     « (Autres questions.) » tourne les pages.
// Les questions viennent de `QUESTIONS_MIMA` (src/data/dialogues-etape4.js, chargé avec import.meta.glob : le fichier
// peut manquer) ; sinon QUESTIONS_REPLI (src/data/questions.js).
// Pendant la Sourdine (`jeu.sourdine?.actif`) l'anneau ne répond pas : une ligne neutre.
//
// API : `jeu.questions` = { ouvrir() → Promise, disponibles(), posees, enCours }.
// Sauvegarde : `etat.questionsPosees` (ids). Évènement : `question:posee { id, premiere }`.
import { TEXTES, MAX_CHOIX, QUESTIONS_REPLI } from '../data/questions.js';

// Fichier écrit par l'agent dialogues (peut ne pas exister encore) : repli dans data/questions.js.
const _dlg = import.meta.glob('../data/dialogues-etape4.js', { eager: true });
const QUESTIONS = (() => {
  const q = Object.values(_dlg)[0]?.QUESTIONS_MIMA;
  return Array.isArray(q) && q.length ? q : QUESTIONS_REPLI;
})();

const PAR_PAGE = MAX_CHOIX - 2; // + « (Autres questions.) » + « (Ne rien demander.) »

export const questions = {
  nom: 'questions',
  enCours: false,

  /** Ids des questions déjà posées (`etat.questionsPosees`). */
  get posees() {
    const e = this.jeu.etat;
    if (!Array.isArray(e.questionsPosees)) e.questionsPosees = [];
    return e.questionsPosees;
  },

  init(jeu) {
    this.jeu = jeu;
    jeu.questions = this;
    this.posees; // crée la clé si une vieille sauvegarde l'ignore
    jeu.on('partie:nouvelle', () => { this.enCours = false; });
  },

  /** Les questions que le joueur peut poser maintenant, non posées d'abord. */
  disponibles() {
    const etat = this.jeu.etat;
    const ok = QUESTIONS.filter((q) => {
      try { return !q.si || q.si(etat); } catch (e) { return false; }
    });
    const dites = this.posees;
    return [...ok.filter((q) => !dites.includes(q.id)), ...ok.filter((q) => dites.includes(q.id))];
  },

  poser(q) {
    const jeu = this.jeu;
    const premiere = !this.posees.includes(q.id);
    if (premiere) this.posees.push(q.id);
    jeu.sauver?.();
    jeu.emettre('question:posee', { id: q.id, premiere });
  },

  /** Le dialogue de l'anneau. Construit à la demande ; la liste est relue à chaque retour. */
  construire() {
    const self = this;
    const liste = this.disponibles();
    const noeuds = {};
    let page = 0;
    const nPages = liste.length + 1 <= MAX_CHOIX ? 1 : Math.ceil(liste.length / PAR_PAGE);

    for (const q of liste) {
      const phrases = Array.isArray(q.reponse) ? q.reponse : [String(q.reponse)];
      phrases.forEach((p, i) => {
        noeuds[`${q.id}#${i}`] = { qui: TEXTES.qui, texte: p, suite: i < phrases.length - 1 ? `${q.id}#${i + 1}` : 'liste' };
      });
    }

    noeuds.liste = {
      qui: TEXTES.qui,
      get texte() { return self.disponibles().length ? TEXTES.accueil : TEXTES.accueilVide; },
      // relue à chaque affichage du nœud : les questions posées passent en fin de liste, avec leur marque
      get choix() {
        const dites = self.posees;
        const tout = self.disponibles().filter((q) => noeuds[`${q.id}#0`]);
        const paginee = nPages > 1;
        if (page >= nPages) page = 0;
        const vue = paginee ? tout.slice(page * PAR_PAGE, (page + 1) * PAR_PAGE) : tout;
        const choix = vue.map((q) => ({
          texte: (dites.includes(q.id) ? TEXTES.dejaPosee : '') + q.question,
          vers: `${q.id}#0`,
          effet: () => self.poser(q),
        }));
        if (paginee) choix.push({ texte: TEXTES.autres, vers: 'liste', effet: () => { page = (page + 1) % nPages; } });
        choix.push({ texte: TEXTES.rien, vers: null });
        return choix;
      },
    };
    return { debut: 'liste', noeuds };
  },

  /** Ouvre le dialogue de l'anneau. Renvoie la promesse de sa fin. */
  async ouvrir() {
    const jeu = this.jeu;
    if (this.enCours || jeu.dialogue?.estOuvert) return;
    this.enCours = true;
    try {
      if (jeu.sourdine?.actif) {
        await jeu.ouvrirDialogue({ debut: 'n', noeuds: { n: { qui: '', texte: TEXTES.sourdine } } });
      } else {
        await jeu.ouvrirDialogue(this.construire());
      }
    } finally {
      this.enCours = false;
    }
  },
};
