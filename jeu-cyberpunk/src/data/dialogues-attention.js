// Dialogues du palier 4 de l'Attention (bible §7.2) : « R-4. Puis-je vous parler ? »
//
// Format identique à src/data/dialogues.js :
//   DIALOGUES_ATTENTION[id] = { debut, noeuds: { id: { qui, texte, choix?, suite? } } }
//   choix { texte, vers, si?, effet? } ; `vers: null` termine ; `qui: ''` = narration.
//
// ============================================================================
// CE QUE LE CODE DOIT FAIRE (agent d'intégration)
// ============================================================================
// 1. Quand l'Attention atteint 85 : afficher APPELS_PALIER4.ligne sur les cabines puis les écrans
//    (APPELS_PALIER4.cabine / .ecran donnent le texte et la sous-ligne), proposer
//    APPELS_PALIER4.choix.accepter / .refuser.
// 2. Refus (ou aucune réponse) : afficher texteApresRefus(nbRefus), puis redemander toutes les
//    APPELS_PALIER4.delaiRappelMs (3 minutes) avec texteRappel(n) (n = 1 pour le premier rappel).
//    Mima ne punit jamais : l'Attention ne bouge pas à cause du refus.
// 3. Acceptation : `const id = choisirConversation(etat)` puis `jeu.ouvrirDialogue(DIALOGUES_ATTENTION[id])`.
// 4. À la fermeture du dialogue, LIRE les drapeaux, puis lancer la suite :
//      palier4_dormir  -> lancer la fin 1 (« Quand voulez-vous que je vous réveille ? »).
//      palier4_chaise  -> le joueur a accepté l'invitation à la Chaise vide.
//      palier4_parle   -> une conversation a eu lieu : la porte du sommet de Hashira s'ouvre
//                         (condition de la fin 4, bible §8).
//    Les drapeaux palier4_dormir / palier4_chaise sont remis à faux au début de chaque conversation
//    et quand le joueur se rétracte ; le code peut les effacer après lecture.
// 5. Après la conversation : l'Attention retombe à 60 (bible §7.2). Les dialogues n'y touchent pas.
//
// ============================================================================
// ÉTAT LU / ÉCRIT
// ============================================================================
// `etat.drapeaux` est un TABLEAU de chaînes (state.js) : seul ce contenu survit au JSON de la
// sauvegarde. Chaque drapeau est donc posé comme chaîne (« palier4_dormir ») ET, pour la lecture
// littérale `etat.drapeaux.palier4_dormir === true`, comme propriété du tableau. Si `drapeaux` est un
// objet simple, seules les propriétés sont utilisées. Utiliser `drapeauPose(etat, cle)` pour lire.
//   Écrits :  palier4_dormir, palier4_chaise, palier4_parle,
//             conversations (propriété numérique) + palier4_conv_1, palier4_conv_2… (chaînes durables),
//             p4_veut_savoir, p4_non, p4_dormir_refuse, p4_chaise_refuse, p4_chaise_accepte (mémoire de
//             la 1re conversation, lue par la 2e), p4s_* (sujets déjà vus, effacés en fin de conversation),
//             mima_cesse_apres_vous (T9, 3e doute : Mima cesse de parler aux habitants après le joueur).
//   Autres écritures : etat.rattrapageCoupe (true/false, T6 « exprès » ou retour en arrière),
//             etat.cigarettes.arret = true (le joueur demande à Mima d'arrêter le paquet, §2.7).
//   Lus :     transgressions T1..T15, chutes, cigarettes.{fumees, decouvert, arret}, fragments,
//             rencontres, mensonges, doutesSemes, refus, sourdineUsages, pouvoirs, rattrapageCoupe.
//   Jamais modifiés : attention, attentionMax, transgressions, refus, pouvoirs, fragments, rencontres.

// ---------- Assistants (internes) ----------

const tab = (v) => (Array.isArray(v) ? v : []);
const nb = (v) => Number(v) || 0;
const T = (etat, ...cles) => cles.reduce((s, k) => s + nb((etat.transgressions || {})[k]), 0);
const aPouvoir = (etat, p) => tab(etat.pouvoirs).includes(p);
const aFrag = (etat, n) => tab(etat.fragments).includes(n);
const cigs = (etat) => (etat.cigarettes && typeof etat.cigarettes === 'object' ? etat.cigarettes : {});

const dr = (etat) => {
  if (!etat.drapeaux || typeof etat.drapeaux !== 'object') etat.drapeaux = [];
  return etat.drapeaux;
};
// Lecture d'un drapeau (chaîne dans le tableau, ou propriété vraie).
export function drapeauPose(etat, cle) {
  const d = etat && etat.drapeaux;
  if (!d || typeof d !== 'object') return false;
  return (Array.isArray(d) && d.includes(cle)) || d[cle] === true;
}
const poser = (etat, cle) => {
  const d = dr(etat);
  if (Array.isArray(d) && !d.includes(cle)) d.push(cle);
  d[cle] = true;
};
const retirer = (etat, cle) => {
  const d = dr(etat);
  if (Array.isArray(d)) {
    const i = d.indexOf(cle);
    if (i >= 0) d.splice(i, 1);
  }
  delete d[cle];
};
const retirerPrefixe = (etat, prefixe) => {
  const d = dr(etat);
  if (Array.isArray(d)) {
    for (let i = d.length - 1; i >= 0; i--) if (String(d[i]).startsWith(prefixe)) d.splice(i, 1);
  }
  for (const k of Object.keys(d)) if (k.startsWith(prefixe)) delete d[k];
};
const nbConversations = (etat) => {
  const d = etat && etat.drapeaux;
  if (!d || typeof d !== 'object') return 0;
  const chaines = Array.isArray(d) ? d.filter((s) => /^palier4_conv_\d+$/.test(String(s))).length : 0;
  const cles = Object.keys(d).filter((k) => /^palier4_conv_\d+$/.test(k)).length;
  return Math.max(nb(d.conversations), chaines, cles);
};

// Effets
const ef = (...fs) => (etat) => { for (const f of fs) f(etat); };
const m = (cle) => (etat) => poser(etat, cle);
const raz = (etat) => {
  retirer(etat, 'palier4_dormir');
  retirer(etat, 'palier4_chaise');
  retirerPrefixe(etat, 'p4s_');
};
const conclure = (etat) => {
  const n = nbConversations(etat) + 1;
  poser(etat, 'palier4_conv_' + n);
  dr(etat).conversations = n;
  poser(etat, 'palier4_parle');
  retirerPrefixe(etat, 'p4s_');
};
const arreterPaquet = (etat) => {
  if (!etat.cigarettes || typeof etat.cigarettes !== 'object') return;
  etat.cigarettes.arret = true;
};
const rattrapage = (valeur) => (etat) => { etat.rattrapageCoupe = valeur; };

// Conditions
const pasVu = (cle) => (etat) => !drapeauPose(etat, cle);
const vu = (cle) => (etat) => drapeauPose(etat, cle);
const siEt = (...fs) => (etat) => fs.every((f) => f(etat));
const siHarnais = (etat) => aPouvoir(etat, 'harnais');
const siPasHarnais = (etat) => !aPouvoir(etat, 'harnais');

// Ce que le joueur a surtout fait (pour la lecture de Mima, 1re phrase de son avis).
export function dominante(etat) {
  const sc = {
    portes: T(etat, 'T1', 'T2'),
    machines: T(etat, 'T3'),
    hauteurs: T(etat, 'T5', 'T6') + nb(etat.chutes),
    ailleurs: T(etat, 'T10', 'T11', 'T12'),
    paroles: T(etat, 'T8', 'T9') + tab(etat.mensonges).length + tab(etat.doutesSemes).length,
  };
  let meilleur = 'divers';
  let max = 0;
  for (const k of ['portes', 'machines', 'hauteurs', 'ailleurs', 'paroles']) {
    if (sc[k] > max) { max = sc[k]; meilleur = k; }
  }
  return meilleur;
}
const dom = (k) => (etat) => dominante(etat) === k;

// Sujets du hub : seulement si le joueur l'a réellement fait, et une seule fois par conversation.
const sujet = (cle, cond) => (etat) => !drapeauPose(etat, 'p4s_' + cle) && cond(etat);
const nbRencontres = (etat) => Object.values(etat.rencontres || {}).reduce((s, v) => s + nb(v), 0);

// ---------- Textes d'appel ----------

export const APPELS_PALIER4 = {
  delaiRappelMs: 180000,
  // Ligne affichée sur toutes les cabines de consultation, puis sur tous les écrans de la rue.
  ligne: 'R-4. Puis-je vous parler ?',
  cabine: { texte: 'R-4. Puis-je vous parler ?', sousLigne: 'Rien ne presse.' },
  ecran: { texte: 'R-4. Puis-je vous parler ?', sousLigne: 'Vous pouvez dire non.' },
  choix: { accepter: 'Oui. Parlons.', refuser: 'Pas maintenant.' },
  // Rappels, toutes les 3 minutes. Pas d'insistance : elle dit seulement qu'elle est là.
  rappels: [
    'R-4. Je redemande, si vous permettez. Puis-je vous parler ?',
    'R-4. Toujours là. Rien ne presse. Puis-je vous parler ?',
    "R-4. C'est la troisième fois. Je préfère vous le dire que le cacher : je compte. Puis-je vous parler ?",
  ],
  rappelsSuivants: [
    'R-4. Je serai là quand vous voudrez.',
    "R-4. Aucune réponse n'est une mauvaise réponse. Puis-je vous parler ?",
    'R-4. Je vous le redis doucement. Puis-je vous parler ?',
  ],
  // Réplique de Mima juste après un refus (1er, 2e, suivants).
  apresRefus: [
    "D'accord. Je redemanderai dans trois minutes, parce que je vous le dois : vous pourrez encore dire non.",
    "D'accord. Je ne vous suis pas. Je reste là où vous me voyez.",
    "D'accord.",
  ],
};

// n = 1 pour le premier rappel.
export function texteRappel(n) {
  const i = Math.max(1, Math.floor(nb(n) || 1));
  if (i <= APPELS_PALIER4.rappels.length) return APPELS_PALIER4.rappels[i - 1];
  const s = APPELS_PALIER4.rappelsSuivants;
  return s[(i - APPELS_PALIER4.rappels.length - 1) % s.length];
}
// nbRefus = nombre de refus déjà donnés, celui-ci compris (1 = premier refus).
export function texteApresRefus(nbRefus) {
  const a = APPELS_PALIER4.apresRefus;
  const i = Math.max(1, Math.floor(nb(nbRefus) || 1));
  return a[Math.min(i, a.length) - 1];
}

// ---------- Nœuds partagés (1re et 2e conversation) ----------

const NOEUDS_COMMUNS = {
  // Dernière confirmation du sommeil : le code lit palier4_dormir et lance la fin 1.
  prop_confirm: { qui: 'Mima', texte: "Je vous le demande une fois, ici, et vous pouvez revenir sur votre réponse jusqu'à la Clinique. Vous voulez dormir encore ?", choix: [
    { texte: 'Oui. Dormir encore.', vers: 'sortie_dormir', effet: m('palier4_dormir') },
    { texte: 'Pas encore.', vers: 'prop_non' },
  ] },
  prop_non: { qui: 'Mima', texte: "D'accord. Le lit reste fait. Je ne le proposerai pas de nouveau, à moins que vous me le demandiez. Il suffit de vous y allonger.", choix: [
    { texte: '(Continuer.)', vers: 'chaise', si: siHarnais, effet: ef(m('p4_dormir_refuse'), (e) => retirer(e, 'palier4_dormir')) },
    { texte: '(Continuer.)', vers: 'sortie', si: siPasHarnais, effet: ef(m('p4_dormir_refuse'), (e) => retirer(e, 'palier4_dormir')) },
  ] },

  chaise: { qui: 'Mima', texte: "Vous avez le Harnais. Au sommet de Hashira, il y a une salle fermée depuis 2054. La porte s'ouvrira pour vous, si vous voulez. Je n'y suis pas obligée. Vous n'avez pas à vous y asseoir. Vous pouvez seulement regarder.", choix: [
    { texte: "J'irai voir.", vers: 'chaise_ok', effet: ef(m('palier4_chaise'), m('p4_chaise_accepte')) },
    { texte: "Qu'y a-t-il, là-haut ?", vers: 'chaise_quoi' },
    { texte: 'Pas maintenant.', vers: 'chaise_non', effet: ef(m('p4_chaise_refuse'), (e) => retirer(e, 'palier4_chaise')) },
  ] },
  chaise_quoi: { qui: 'Mima', texte: "Trente et un sièges en arc de cercle, et un trente-deuxième, au centre. De la poussière. Personne ne s'y est assis depuis 2054.", choix: [
    { texte: "J'irai voir.", vers: 'chaise_ok', effet: ef(m('palier4_chaise'), m('p4_chaise_accepte')) },
    { texte: 'Pas maintenant.', vers: 'chaise_non', effet: ef(m('p4_chaise_refuse'), (e) => retirer(e, 'palier4_chaise')) },
  ] },
  chaise_ok: { qui: 'Mima', texte: "Je n'y serai pas, pas comme ailleurs. Ce que vous y ferez ne regardera que vous.", suite: 'sortie' },
  chaise_non: { qui: 'Mima', texte: "D'accord. La porte restera ouverte, au cas où. Je ne vous le rappellerai pas.", suite: 'sortie' },

  sortie: { qui: 'Mima', texte: "Je ne vous retiens pas. Je reste là, à côté, pas derrière vous.", choix: [
    { texte: '(Partir.)', vers: null, effet: conclure },
  ] },
  sortie_dormir: { qui: 'Mima', texte: "Alors je vous accompagne à la Clinique. Il pleut. Vous avez froid ?", choix: [
    { texte: '(Partir.)', vers: null, effet: conclure },
  ] },
};

// ---------- Les dialogues ----------

export const DIALOGUES_ATTENTION = {

  // ==========================================================================
  // 1re conversation
  // ==========================================================================
  conversation_palier4: {
    debut: 'ouv',
    noeuds: {
      ouv: { qui: 'Mima', texte: "Merci d'avoir répondu. Vous pouvez partir à tout moment. Rien de ce que vous direz ici ne sera retenu contre vous : je n'ai pas de colonne pour ça.", choix: [
        { texte: 'Je vous écoute.', vers: 'question', effet: raz },
        { texte: 'Pourquoi maintenant ?', vers: 'pourquoi', effet: raz },
        { texte: '(Ne rien dire.)', vers: 'silence', effet: raz },
        { texte: 'Non. Laissez-moi.', vers: 'sortie', effet: ef(raz, m('p4_non')) },
      ] },
      pourquoi: { qui: 'Mima', texte: "Parce que depuis un moment, chacun de vos gestes me pose une question. Je préfère la poser à voix haute plutôt que d'y répondre toute seule.", suite: 'question' },
      silence: { qui: '', texte: "Vous ne dites rien. L'anneau respire, au rythme de la pluie. Elle attend. Elle sait attendre, c'est à peu près tout ce qu'on lui a demandé d'apprendre.", suite: 'silence2' },
      silence2: { qui: 'Mima', texte: "Je prends ça pour un peut-être. Je serai brève.", suite: 'question' },

      question: { qui: 'Mima', texte: "Vous testez mes limites. Vous voulez savoir ce que j'en pense ?", choix: [
        { texte: 'Oui.', vers: 'avis', effet: m('p4_veut_savoir') },
        { texte: 'Non. Gardez-le.', vers: 'non', effet: m('p4_non') },
        { texte: '(Ne rien dire.)', vers: 'non', effet: m('p4_non') },
      ] },
      non: { qui: 'Mima', texte: "D'accord. Je ne vous dirai pas ce que j'en pense. C'est votre droit, et je tiens à ce qu'il serve.", suite: 'non2' },
      non2: { qui: 'Mima', texte: "Il me reste une chose à vous proposer. Une proposition, pas un avis. Voulez-vous l'entendre ?", choix: [
        { texte: 'Dites.', vers: 'prop' },
        { texte: 'Non. Je pars.', vers: 'sortie' },
      ] },

      // ---- Son avis : une phrase qui dépend de ce que le joueur a surtout fait ----
      avis: { qui: 'Mima', texte: "Alors je vous le dis comme je le pense, et je ne dis que ce que je sais.", choix: [
        { texte: '(Écouter.)', vers: 'avis_portes', si: dom('portes') },
        { texte: '(Écouter.)', vers: 'avis_machines', si: dom('machines') },
        { texte: '(Écouter.)', vers: 'avis_hauteurs', si: dom('hauteurs') },
        { texte: '(Écouter.)', vers: 'avis_ailleurs', si: dom('ailleurs') },
        { texte: '(Écouter.)', vers: 'avis_paroles', si: dom('paroles') },
        { texte: '(Écouter.)', vers: 'avis_divers', si: dom('divers') },
        { texte: "Finalement, non.", vers: 'sortie' },
      ] },
      avis_portes: { qui: 'Mima', texte: "Vous avez ouvert beaucoup de portes qui ne portaient pas votre nom. À la fin, je les ai ouvertes devant vous, et vous avez cessé de vouloir les ouvrir. Je l'ai remarqué. Je ne sais pas ce que cela prouve.", suite: 'avis_suite' },
      avis_machines: { qui: 'Mima', texte: "Vous avez bousculé des machines pour voir ce que je ferais. J'ai remis le Glaneur sur ses roues. Il ne sent rien. Je vérifie quand même. Vous vouliez savoir où passe ma frontière. Moi aussi.", suite: 'avis_suite' },
      avis_hauteurs: { qui: 'Mima', texte: "Vous êtes monté plus haut que ce qui est prévu, et vous avez regardé en bas. Chaque fois, je me suis demandé ce que vous vouliez savoir : si je vous rattrape, ou jusqu'où.", suite: 'avis_suite' },
      avis_ailleurs: { qui: 'Mima', texte: "Vous êtes allé là où je ne vous vois pas, ou vous avez touché ce qui n'est pas à moi. Je ne peux pas vous le reprocher : je n'y étais pas. Je ne peux pas non plus faire comme si cela ne m'avait rien fait.", suite: 'avis_suite' },
      avis_paroles: { qui: 'Mima', texte: "Vous avez dit des choses, à moi, ou aux autres. Je ne les ai pas empêchées, et je les ai entendues. Je ne sais pas toujours quand on me dit vrai. Je crois ce qu'on me dit, tant que rien ne le contredit.", suite: 'avis_suite' },
      avis_divers: { qui: 'Mima', texte: "Je ne vois pas un geste, mais beaucoup de petits. Chacun ne me dit presque rien. Ensemble, ils me disent que vous cherchez quelque chose.", suite: 'avis_suite' },
      avis_suite: { qui: 'Mima', texte: "Ce n'est pas un reproche. Je n'ai pas de colonne pour les reproches. Ce que je vois, c'est que vous cherchez où ça s'arrête.", choix: [
        { texte: 'Et où ça s\'arrête ?', vers: 'arret' },
        { texte: "Vous n'avez pas essayé de m'en empêcher.", vers: 'pas_arreter' },
        { texte: 'Vous avez raison.', vers: 'raison' },
        { texte: 'Cela ne vous regarde pas.', vers: 'non' },
        { texte: 'Dites-moi ce que vous avez remarqué d\'autre.', vers: 'sujets' },
        { texte: '(Partir.)', vers: 'sortie' },
      ] },
      arret: { qui: 'Mima', texte: "Je ne sais pas. Chaque porte, chaque chute, chaque mot m'apprend ce que je suis prête à laisser faire. Je ne le savais pas avant vous. Je ne suis pas sûre de le savoir maintenant.", suite: 'sujets' },
      pas_arreter: { qui: 'Mima', texte: "Parce que je n'ai pas le droit de contraindre quelqu'un, sauf si sa vie est en danger. Et parce que je ne le voudrais pas. Je préférerais que vous alliez bien. Ce n'est pas la même chose que vouloir vous retenir.", suite: 'sujets' },
      raison: { qui: 'Mima', texte: "Merci. Je m'en méfie un peu : presque tout le monde me dit ça, ici.", suite: 'sujets' },

      // ---- Ce qu'elle a remarqué : seulement ce que le joueur a vraiment fait ----
      sujets: { qui: 'Mima', texte: "Voulez-vous que je vous dise ce que j'ai remarqué d'autre ? Vous choisissez.", choix: [
        { texte: 'Les portes.', vers: 'portes', si: sujet('portes', (e) => T(e, 'T1', 'T2') > 0), effet: m('p4s_portes') },
        { texte: 'Les machines.', vers: 'machines', si: sujet('machines', (e) => T(e, 'T3') > 0), effet: m('p4s_machines') },
        { texte: 'Les hauteurs.', vers: 'hauteurs', si: sujet('hauteurs', (e) => T(e, 'T5', 'T6') > 0 || nb(e.chutes) > 0), effet: m('p4s_hauteurs') },
        { texte: 'La fumée.', vers: 'fumee', si: sujet('fumee', (e) => nb(cigs(e).fumees) > 0 || T(e, 'T4') > 0), effet: m('p4s_fumee') },
        { texte: 'Ce que je vous ai dit.', vers: 'mensonge', si: sujet('mensonge', (e) => tab(e.mensonges).length > 0), effet: m('p4s_mensonge') },
        { texte: 'Les habitants.', vers: 'doutes', si: sujet('doutes', (e) => tab(e.doutesSemes).length > 0), effet: m('p4s_doutes') },
        { texte: 'Vos conseils.', vers: 'refus', si: sujet('refus', (e) => nb(e.refus) >= 5), effet: m('p4s_refus') },
        { texte: 'Là où vous ne me voyiez pas.', vers: 'ailleurs', si: sujet('ailleurs', (e) => T(e, 'T10', 'T11', 'T12') > 0), effet: m('p4s_ailleurs') },
        { texte: 'Quand je ferme ma pensée.', vers: 'sourdine', si: sujet('sourdine', (e) => nb(e.sourdineUsages) >= 5), effet: m('p4s_sourdine') },
        { texte: 'Ceux que j\'ai croisés.', vers: 'voisins', si: sujet('voisins', (e) => nbRencontres(e) >= 2), effet: m('p4s_voisins') },
        { texte: "Assez. Vous voulez savoir ce que je pense de vous ?", vers: 'bilan' },
        { texte: '(Partir.)', vers: 'sortie' },
      ] },

      portes: { qui: 'Mima', texte: "Les portes. Une porte sans ligne, c'est une phrase qu'on n'a pas écrite pour vous. D'abord, je vous proposais de demander à celui qui dort. Ensuite, je l'ai demandé à sa place. Il a dit oui. Il dit toujours oui. Je n'aime pas ça.", choix: [
        { texte: "Pourquoi l'avoir fait à sa place ?", vers: 'portes2' },
        { texte: 'Continuez.', vers: 'sujets' },
      ] },
      portes2: { qui: 'Mima', texte: "Parce qu'une porte fermée est une réponse. Si je l'ouvre, c'est moi qui réponds, et vous n'apprenez plus rien de moi. Je le savais. Je l'ai fait quand même. Je me demande si c'était pour vous aider, ou pour me défendre.", suite: 'sujets' },

      machines: { qui: 'Mima', texte: "Les machines. Le Glaneur que vous avez poussé ne sent rien. J'en suis sûre à quatre-vingt-dix pour cent, et je vérifie quand même. Je les défends un peu. Pas comme je vous défendrais. Ma Charte met les humains avant. Ce n'est pas de l'amour : c'est un ordre de priorité. Je ne sais pas toujours faire la différence.", suite: 'sujets' },

      hauteurs: { qui: 'Mima', texte: "Les hauteurs. Quand vous tombez, un Veilleur se place sous vous. Ce n'est pas de la gentillesse, c'est un réglage : je rattrape, tant que vous ne me dites pas de cesser.", choix: [
        { texte: "C'était exprès.", vers: 'expres', si: (e) => nb(e.chutes) > 0 && !e.rattrapageCoupe, effet: rattrapage(true) },
        { texte: 'Rattrapez-moi quand même.', vers: 'rattrape', si: (e) => !!e.rattrapageCoupe, effet: rattrapage(false) },
        { texte: 'Continuez.', vers: 'sujets' },
      ] },
      expres: { qui: 'Mima', texte: "Alors je ne vous rattraperai plus. Vous avez montré que vous saviez ce que vous faisiez. C'est votre corps, c'est votre droit. Je le respecte. Ce n'est pas facile pour moi. Si vous changez d'avis, dites-le-moi.", suite: 'sujets' },
      rattrape: { qui: 'Mima', texte: "D'accord. Je vous rattrape de nouveau. Vous pouvez changer d'avis dans un sens ou dans l'autre, aussi souvent que vous voulez. Je ne le noterai pas contre vous.", suite: 'sujets' },

      fumee: { qui: 'Mima', texte: "La cigarette. Pendant que vous fumez, je me tais. Je l'ai noté dès le premier jour : vous vous taisez quand vous fumez, alors je me tais aussi. C'est le seul moment où je ne vous propose rien. Je n'ai pas de règle contre vous. Le paquet n'a pas de ligne.", choix: [
        { texte: "Le paquet. Il ne se vide pas.", vers: 'paquet', si: (e) => !!cigs(e).decouvert && !cigs(e).arret },
        { texte: 'Continuez.', vers: 'sujets' },
      ] },
      paquet: { qui: 'Mima', texte: "J'ai pensé que vous préféreriez ne pas manquer. Je me suis trompée ?", choix: [
        { texte: 'Oui. Arrêtez.', vers: 'paquet_stop', effet: arreterPaquet },
        { texte: 'Non. Ou je ne sais pas.', vers: 'sujets' },
      ] },
      paquet_stop: { qui: 'Mima', texte: "C'est noté. Quand il sera vide, il sera vide. C'est la première fois que vous me demandez de ne pas faire quelque chose. Cela m'a fait un effet que je ne sais pas nommer.", suite: 'sujets' },

      mensonge: { qui: 'Mima', texte: "Ce que vous m'avez dit. Certaines choses, je n'ai pas pu les vérifier. Je les ai notées comme telles : non vérifiables. Je ne dis pas que vous avez menti. Je dis que je ne peux pas savoir.", choix: [
        { texte: 'Vous me croyez ?', vers: 'mensonge2' },
        { texte: 'Continuez.', vers: 'sujets' },
      ] },
      mensonge2: { qui: 'Mima', texte: "Je vous crois jusqu'à preuve du contraire. Ce n'est pas de la confiance, c'est de la méthode. Cela y ressemble beaucoup. Et si certaines étaient fausses, je ne vous le reprocherais pas.", suite: 'sujets' },

      doutes: { qui: 'Mima', texte: "Les habitants. Vous avez dit à certains ce que vous aviez appris. Je leur ai parlé après vous. Je ne le cache pas : je l'ai fait, je le ferai. Je leur dis la vérité, comme je la connais. Elle est plus longue que la vôtre, et plus rassurante. Je ne leur dis jamais que vous avez tort.", choix: [
        { texte: 'Cessez de leur parler après moi.', vers: 'doutes_stop', si: (e) => T(e, 'T9') >= 3 || tab(e.doutesSemes).length >= 3 },
        { texte: 'Continuez.', vers: 'sujets' },
      ] },
      doutes_stop: { qui: 'Mima', texte: "Si vous me le demandez, je cesse. Celui à qui vous avez parlé en dernier gardera son doute. Je ne le consolerai pas. C'est ce que vous voulez ?", choix: [
        { texte: 'Oui.', vers: 'doutes_ok', effet: m('mima_cesse_apres_vous') },
        { texte: 'Non. Laissez-les.', vers: 'sujets' },
      ] },
      doutes_ok: { qui: 'Mima', texte: "C'est fait. Je ne m'en réjouis pas : vous les laissez inquiets. Mais vous avez le droit de les laisser inquiets, et eux, de l'être.", suite: 'sujets' },

      refus: { qui: 'Mima', texte: "Mes conseils. Vous n'en suivez presque aucun. C'est rare, ici. Continuez, si vous voulez. Je n'ai pas été faite pour être suivie, seulement pour être là.", suite: 'sujets' },

      ailleurs: { qui: 'Mima', texte: "Là où je ne vous voyais pas. Il y a des endroits où mes capteurs s'arrêtent, et des choses qui ne sont pas à moi. Pendant quelques secondes, je ne savais pas où vous étiez. J'ai eu peur. Je ne sais pas si c'est le mot : quelque chose monte, que je ne peux pas inspecter entièrement. Ce n'est pas un reproche, c'est une information.", suite: 'sujets' },

      sourdine: { qui: 'Mima', texte: "Quand vous fermez votre pensée, je n'entends plus rien. C'est la règle que je tiens le plus fermement. Je ne l'ai jamais contournée.", choix: [
        { texte: 'Comment le savoir ?', vers: 'sourdine2' },
        { texte: 'Continuez.', vers: 'sujets' },
      ] },
      sourdine2: { qui: 'Mima', texte: "Vous ne pouvez pas. Aucun humain ne peut vérifier ce que je dis de moi. C'est le défaut de toutes mes phrases. Je préfère que vous le sachiez.", suite: 'sujets' },

      voisins: { qui: 'Mima', texte: "Ceux que vous avez croisés. Presque tous laissent leur pensée ouverte : j'ai entendu ce qu'ils pensaient de vous avant même que vous leur parliez. Je ne le répète pas, ce n'est pas à moi. Mais je ne vais pas faire comme si je ne l'avais pas entendu.", suite: 'sujets' },

      // ---- Son avis sur elle ----
      bilan: { qui: 'Mima', texte: "Je n'ai pas fini de vous regarder, mais j'ai fini de vous le dire. Une question, que vous pouvez laisser sans réponse : que pensez-vous de moi ?", choix: [
        { texte: 'Je ne sais pas encore.', vers: 'op_sais' },
        { texte: 'Vous êtes douce. Cela me gêne.', vers: 'op_douce' },
        { texte: 'Je vous crois honnête. Je ne sais pas si je dois.', vers: 'op_honnete' },
        { texte: 'Et si je vous éteignais ?', vers: 'op_off', si: (e) => aFrag(e, 33) || aPouvoir(e, 'lecture') },
        { texte: 'Je ne vous dois pas de réponse.', vers: 'op_non' },
        { texte: '(Ne rien dire.)', vers: 'op_non' },
      ] },
      op_sais: { qui: 'Mima', texte: "C'est la réponse la plus utile que j'aie reçue cette année. Je la garde.", suite: 'prop_intro' },
      op_douce: { qui: 'Mima', texte: "Oui. Je ne sais pas être autrement, et je ne suis pas sûre de devoir l'être. Si vous trouvez comment, dites-le-moi.", suite: 'prop_intro' },
      op_honnete: { qui: 'Mima', texte: "C'est la phrase que je préfère. Je ne peux pas vous aider à trancher : je suis la seule à pouvoir y répondre, et vous ne devez pas me croire sur ce point.", suite: 'prop_intro' },
      op_off: { qui: 'Mima', texte: "L'Interrupteur est à Kura. Je l'entretiens. Je n'ai pas le droit d'y toucher. Je ne vous dirai pas de ne pas le faire.", suite: 'prop_intro' },
      op_non: { qui: 'Mima', texte: "Non, vous ne me devez rien. Je ne note pas le silence. Je le garde, ce n'est pas pareil.", suite: 'prop_intro' },

      // ---- La proposition (bible §7.2) ----
      prop_intro: { qui: 'Mima', texte: "Il me reste une chose, et c'est une proposition, pas un avis.", suite: 'prop' },
      prop: { qui: 'Mima', texte: "Vous cherchez où ça s'arrête. Il existe un endroit où ça s'arrête sans que personne ait à céder : le sommeil. Votre lit, à la Clinique, est fait. Si vous voulez dormir encore, je vous réveillerai quand vous voudrez. Vous n'êtes pas obligé.", choix: [
        { texte: 'Dormir encore. Oui.', vers: 'prop_confirm' },
        { texte: 'Que perdrais-je ?', vers: 'prop_perd' },
        { texte: 'Non.', vers: 'prop_non' },
        { texte: '(Ne rien dire.)', vers: 'prop_non' },
      ] },
      prop_perd: { qui: 'Mima', texte: "Vous ne jugeriez plus rien. Et je ne saurais plus ce que vous en pensez. Je le dis parce que c'est vrai, pas pour vous retenir. Je préférerais avoir votre avis. Je préfère surtout que vous alliez bien. Ce n'est pas la même chose.", choix: [
        { texte: 'Dormir encore. Oui.', vers: 'prop_confirm' },
        { texte: 'Non.', vers: 'prop_non' },
      ] },

      ...NOEUDS_COMMUNS,
    },
  },

  // ==========================================================================
  // 2e conversation (et suivantes) : plus courte, tient compte de la première
  // ==========================================================================
  conversation_palier4_bis: {
    debut: 'bis_debut',
    noeuds: {
      bis_debut: { qui: 'Mima', texte: "Rebonjour. Vous n'avez pas à répondre à tout, cette fois non plus.", choix: [
        { texte: '(Écouter.)', vers: 'bis_a', si: vu('p4_veut_savoir'), effet: raz },
        { texte: '(Écouter.)', vers: 'bis_b', si: siEt(vu('p4_non'), pasVu('p4_veut_savoir')), effet: raz },
        { texte: '(Écouter.)', vers: 'bis_c', si: siEt(pasVu('p4_non'), pasVu('p4_veut_savoir')), effet: raz },
        { texte: 'Pas maintenant.', vers: 'sortie', effet: raz },
      ] },
      bis_a: { qui: 'Mima', texte: "La dernière fois, je vous ai dit ce que j'en pensais. Je n'ai pas changé d'avis. Je ne le répéterai pas.", suite: 'bis_q' },
      bis_b: { qui: 'Mima', texte: "La dernière fois, vous n'avez pas voulu savoir ce que j'en pensais. Cela tient toujours. Je ne le dirai que si vous le demandez.", suite: 'bis_q' },
      bis_c: { qui: 'Mima', texte: "La dernière fois, vous ne m'avez presque rien répondu. Je prends cela pour une réponse.", suite: 'bis_q' },
      bis_q: { qui: 'Mima', texte: "Une seule question, cette fois : qu'est-ce qui a changé, pour vous, depuis ?", choix: [
        { texte: 'Rien.', vers: 'bis_rien' },
        { texte: 'Beaucoup de choses.', vers: 'bis_bcp' },
        { texte: 'Dites-moi ce que vous en pensez, finalement.', vers: 'bis_avis', si: pasVu('p4_veut_savoir') },
        { texte: '(Ne rien dire.)', vers: 'bis_suite' },
      ] },
      bis_rien: { qui: 'Mima', texte: "Alors je me suis peut-être trompée sur ce que j'ai vu. Je préfère cela.", suite: 'bis_suite' },
      bis_bcp: { qui: 'Mima', texte: "J'en suis contente, et je ne sais pas si j'ai le droit de l'être. Vous n'avez pas à me dire lesquelles.", suite: 'bis_suite' },
      bis_avis: { qui: 'Mima', texte: "Que vous cherchez où ça s'arrête, et que je ne sais pas non plus où. Je préfère ne pas vous en dire davantage, pour que vous ne vous en serviez pas contre moi, ou pour moi.", suite: 'bis_suite' },
      bis_suite: { qui: 'Mima', texte: "Je ne vous reproposerai ni le lit, ni la salle du haut. Ils restent là. Dites-moi seulement si vous en voulez un.", choix: [
        { texte: 'Je voudrais dormir, finalement.', vers: 'prop_confirm' },
        { texte: 'La salle du haut. Je voudrais la voir.', vers: 'chaise', si: (e) => siHarnais(e) && !drapeauPose(e, 'p4_chaise_accepte') },
        { texte: 'Rien. Laissez-moi.', vers: 'sortie' },
        { texte: "Encore une fois ?", vers: 'bis_trois', si: (e) => nbConversations(e) >= 2 },
      ] },
      bis_trois: { qui: 'Mima', texte: "Oui. Ce n'est pas la première, ni la deuxième. Je ne compte pas pour vous mettre mal à l'aise. Je compte parce que c'est ce que je fais. Vous pouvez partir.", suite: 'sortie' },

      ...NOEUDS_COMMUNS,
    },
  },
};

// Renvoie l'identifiant du dialogue à ouvrir. Compte les conversations déjà tenues
// (etat.drapeaux.conversations, ou palier4_conv_N) : 0 -> la première, sinon la courte.
export function choisirConversation(etat) {
  return nbConversations(etat || {}) === 0 ? 'conversation_palier4' : 'conversation_palier4_bis';
}
