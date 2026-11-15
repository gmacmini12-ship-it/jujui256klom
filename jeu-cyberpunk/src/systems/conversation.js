// Conversation du palier 4 de l'Attention (bible §7.2, tâche 3.4) : « R-4. Puis-je vous parler ? »
//
// Quand `jeu.reactions.appelActif` (Attention >= 85), Mima pose la question (bande de Mima, une fois) et le joueur
// peut répondre quand il le décide : rien ne s'ouvre sans son geste (touche E).
//   - Écrans : « E — Répondre à R-4 » en regardant un hologramme proche (`zone.city.hologrammes`), l'écran du
//     Kiosque, ou un écran déclaré par `jeu.conversation.ajouterEcran` (cabines d'un lieu futur).
//   - Partout en ville : tant que la question est en attente (posée, ni acceptée ni refusée), une invite flotte
//     devant le joueur ; les hologrammes étant en hauteur, c'est le moyen sûr. Elle disparaît après un refus.
//   Dans les deux cas l'invite ouvre un petit dialogue à deux choix (accepter / refuser).
// Refus : réplique de Mima (texteApresRefus), `etat.conversation.refus` +1, rappel après 3 minutes de TEMPS DE JEU
//   (texteRappel(refus) dans la bande de Mima, invite libre de nouveau), tant que l'appel dure. Aucun effet sur l'Attention.
// Acceptation : ouvre DIALOGUES_ATTENTION[choisirConversation(etat)]. Conversation conclue (le dialogue a posé
//   `palier4_conv_N`) : Attention fixée à 60, l'appel cesse (palier 3), `conversation:fin`. Dialogue quitté avant la
//   fin (Échap sur un nœud sans choix) : `conversation:interrompue`, l'appel reste, rien n'est fixé.
//   Aucune fin n'est déclenchée ici : `palier4_dormir` / `palier4_chaise` sont seulement relus et émis.
// Sourdine (`jeu.sourdine?.actif`) : ni invite, ni question, ni rappel, le minuteur est suspendu.
// Sauvegarde : `etat.conversation = { refus, rappelRestant, enAttente }` ; l'appel lui-même dérive de l'Attention
//   (rechargé en plein appel, il reprend : question reposée, ou rappel pas encore échu). Nouvelle partie : remis à zéro.
//
// API : `jeu.conversation` = { disponible, enCours, enAttente, refus, rappelRestant, ecrans,
//   ajouterEcran({ zone, position, rayon }) -> objet interactif, proposer(), accepter(), refuser() }.
// Évènements : `conversation:debut`, `conversation:fin { dormir, chaise }` (une fois par conversation conclue),
//   `conversation:interrompue`, `conversation:refus { refus }`, `conversation:rappel { refus }`.
import * as THREE from 'three';
import { APPELS_PALIER4, DIALOGUES_ATTENTION, choisirConversation, texteRappel, texteApresRefus, drapeauPose } from '../data/dialogues-attention.js';
import { CONVERSATION, REGLAGES_CONVERSATION as R } from '../data/conversation.js';
import { marche } from './marche.js';

const nbConv = (etat) => {
  const d = etat.drapeaux;
  if (!d || typeof d !== 'object') return 0;
  const n = Array.isArray(d) ? d.filter((s) => /^palier4_conv_\d+$/.test(String(s))).length : 0;
  const m = Object.keys(d).filter((k) => /^palier4_conv_\d+$/.test(k)).length;
  return Math.max(Number(d.conversations) || 0, n, m);
};

export const conversation = {
  nom: 'conversation',
  ecrans: [],
  enCours: false,
  _vu: false,
  _jeton: 0,

  get refus() { return this.etat.refus; },
  get enAttente() { return this.etat.enAttente; },
  get rappelRestant() { return this.etat.rappelRestant; },
  /** L'appel peut être répondu maintenant (actif, pas de Sourdine, rien en cours). */
  get disponible() {
    const jeu = this.jeu;
    return !!jeu?.reactions?.appelActif && !jeu.sourdine?.actif && !this.enCours && !jeu.dialogue?.estOuvert;
  },
  /** `etat.conversation`, créé au besoin (jamais remplacé : la référence de `etat` est partagée). */
  get etat() {
    const e = this.jeu.etat;
    if (!e.conversation || typeof e.conversation !== 'object') e.conversation = { refus: 0, rappelRestant: 0, enAttente: false };
    return e.conversation;
  },

  init(jeu) {
    this.jeu = jeu;
    jeu.conversation = this;
    jeu.on('partie:nouvelle', () => this.remettre());
    // Hologrammes : un objet interactif par panneau (la ville peut ne pas en avoir : tableau vide).
    const k = jeu.zones.get('kasumi');
    for (const h of k?.city?.hologrammes || []) {
      this.ajouterEcran({
        zone: 'kasumi',
        position: h.mesh.position,
        rayon: R.rayonHologramme,
        // comme reactions.js : le panneau n'affiche l'appel que s'il est assez près
        proche: (cam) => Math.hypot(h.mesh.position.x - cam.x, h.mesh.position.z - cam.z) < R.rayonHologramme - 5,
      });
    }
    // L'écran-visage du Kiosque (position fournie par marche.js ; lue à l'usage).
    const kio = this.ajouterEcran({ zone: 'kasumi', position: [0, -100, 0], rayon: R.rayonKiosque });
    this._kiosque = kio;
    // Invite libre, partout en ville, tant que la question attend.
    this._libre = jeu.interact.ajouter({
      zone: 'kasumi',
      position: [0, -100, 0],
      rayon: R.distanceInviteLibre + 0.7,
      cone: 1.2,
      libelle: CONVERSATION.libelle,
      visible: () => this.disponible && this.etat.enAttente,
      action: () => this.proposer(),
    });
  },

  remettre() {
    this._jeton++;
    this.enCours = false;
    this._vu = false;
    this.jeu.etat.conversation = { refus: 0, rappelRestant: 0, enAttente: false };
  },

  /** Déclare un écran qui appelle : `zone` de la zone, `position` {x,y,z} | [x,y,z], `rayon` en m. Renvoie l'objet interactif. */
  ajouterEcran({ zone, position, rayon = 6, proche = null }) {
    const obj = this.jeu.interact.ajouter({
      zone,
      position,
      rayon,
      libelle: CONVERSATION.libelle,
      visible: () => this.disponible && (!proche || proche(this.jeu.camera.position)),
      action: () => this.proposer(),
    });
    this.ecrans.push(obj);
    return obj;
  },

  update(dt, t, jeu) {
    if (!jeu.enPartie) return;
    // Positions suivies : Kiosque (ancre du marché), invite libre (devant la caméra).
    const a = marche.ancres?.kiosqueVisage;
    if (a && this._kiosque) this._kiosque.position.set(a.x, a.y, a.z);
    if (this._libre) {
      jeu.camera.getWorldDirection(_d);
      this._libre.position.copy(jeu.camera.position).addScaledVector(_d, R.distanceInviteLibre);
    }

    const actif = !!jeu.reactions?.appelActif;
    const e = this.etat;
    if (!actif) {
      // L'appel est tombé (conversation, décroissance, nouvelle partie) : la question n'existe plus.
      this._vu = false;
      e.enAttente = false;
      e.rappelRestant = 0;
      return;
    }
    if (jeu.sourdine?.actif || this.enCours || !jeu.jouable) return;
    if (!this._vu) {
      // Début d'appel (ou reprise après rechargement)
      this._vu = true;
      if (e.refus > 0 && e.rappelRestant > 0) e.enAttente = false; // le rappel n'est pas encore échu
      else this.poserQuestion();
      return;
    }
    if (!e.enAttente && e.rappelRestant > 0) {
      e.rappelRestant -= dt;
      if (e.rappelRestant <= 0) { e.rappelRestant = 0; this.poserQuestion(); jeu.emettre('conversation:rappel', { refus: e.refus }); }
    }
  },

  texteQuestion() {
    return this.etat.refus > 0 ? texteRappel(this.etat.refus) : APPELS_PALIER4.ligne;
  },
  poserQuestion() {
    this.etat.enAttente = true;
    this.etat.rappelRestant = 0;
    this.jeu.hud?.mima(this.texteQuestion(), { duree: 8 });
    this.jeu.sauver?.();
  },

  /** Ouvre le petit dialogue accepter / refuser. Renvoie la promesse de fin (vrai si une conversation a été lancée). */
  async proposer() {
    if (!this.disponible) return false;
    const jeton = this._jeton;
    const refus = this.etat.refus + 1; // numéro du refus s'il a lieu
    let choix = null;
    const d = {
      debut: 'q',
      noeuds: {
        q: { qui: CONVERSATION.qui, texte: this.texteQuestion(), choix: [
          { texte: APPELS_PALIER4.choix.accepter, vers: null, effet: () => { choix = 'accepter'; } },
          { texte: APPELS_PALIER4.choix.refuser, vers: 'apres', effet: () => { choix = 'refuser'; this.enregistrerRefus(); } },
        ] },
        apres: { qui: CONVERSATION.qui, texte: texteApresRefus(refus) },
      },
    };
    this.enCours = true;
    await this.jeu.ouvrirDialogue(d);
    this.enCours = false;
    if (jeton !== this._jeton) return false; // nouvelle partie pendant le dialogue
    if (choix === 'accepter') { this.accepter(); return true; }
    return false;
  },

  enregistrerRefus() {
    const e = this.etat;
    e.refus += 1;
    e.enAttente = false;
    e.rappelRestant = APPELS_PALIER4.delaiRappelMs / 1000;
    this.jeu.sauver?.();
    this.jeu.emettre('conversation:refus', { refus: e.refus });
  },

  /** Refuse sans passer par le dialogue (réplique dans la bande de Mima). */
  refuser() {
    if (!this.disponible) return false;
    this.enregistrerRefus();
    this.jeu.hud?.mima(texteApresRefus(this.etat.refus), { duree: 8 });
    return true;
  },

  /** Accepte : ouvre la conversation (sans la question). */
  async accepter() {
    const jeu = this.jeu;
    if (!jeu.reactions?.appelActif || jeu.sourdine?.actif || this.enCours) return false;
    const jeton = this._jeton;
    const avant = nbConv(jeu.etat);
    this.enCours = true;
    this.etat.enAttente = false;
    jeu.emettre('conversation:debut');
    await jeu.ouvrirDialogue(DIALOGUES_ATTENTION[choisirConversation(jeu.etat)]);
    if (jeton !== this._jeton) return false;
    this.enCours = false;
    if (nbConv(jeu.etat) <= avant) {
      // quittée avant la fin : l'appel reste, la question attend
      this.etat.enAttente = true;
      jeu.emettre('conversation:interrompue');
      return false;
    }
    this.etat.enAttente = false;
    this.etat.rappelRestant = 0;
    jeu.attention?.fixer(R.attentionApres);
    this._vu = false;
    jeu.sauver?.();
    jeu.emettre('conversation:fin', {
      dormir: drapeauPose(jeu.etat, 'palier4_dormir'),
      chaise: drapeauPose(jeu.etat, 'palier4_chaise'),
    });
    return true;
  },
};

const _d = new THREE.Vector3();
