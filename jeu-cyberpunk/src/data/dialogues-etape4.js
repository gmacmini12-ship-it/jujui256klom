// Dialogues de l'étape 4 : Maison des Conseils (docteure Sall, habitants, patient), cabine du Sceau,
// lit de la Clinique, questions à Mima devant un anneau, textes d'épilogue et de la minute sous halo.
//
// Format identique à src/data/dialogues.js :
//   DIALOGUES_ETAPE4[id] = { debut, noeuds: { id: { qui, texte, choix?, suite? } } }
//   choix { texte, vers, si?, effet? } ; `vers: null` termine ; sans `choix`, `suite` (ou rien) continue / termine.
//   `qui: ''` = narration.
//
// ============================================================================
// COMMENT LE JEU CHOISIT LE DIALOGUE
// ============================================================================
// `choisirDialogueEtape4(perso, etat)` renvoie l'identifiant d'un dialogue de DIALOGUES_ETAPE4
// (null pour un `perso` inconnu). `perso` :
//
//   'sall'          Docteure Sall (Clinique du Jugement). Ordre de priorité :
//                     sall_1          première rencontre (ni etat.rencontres.sall, ni drapeau 'sall_vu').
//                     sall_reprise    la Sourdine n'a pas été transmise (drapeau 'sall_sourdine' absent).
//                     sall_apres      Sourdine transmise, jamais utilisée (sourdineUsages = 0), pas encore vu.
//                     sall_apres_usage  Sourdine utilisée au moins une fois, pas encore vu.
//                     sall_testeur    le joueur a beaucoup testé (somme des transgressions >= 8 ou
//                                     attentionMax >= 60), pas encore vu.
//                     sall_retour     sinon.
//   'consultant1' (un repas), 'consultant2' (un amour), 'consultant3' (un déménagement) :
//                     consultantN_1 la première fois, consultantN_2 ensuite.
//   'patient'       patient_1 la première fois, patient_2 ensuite.
//   'sceau'         sceau (première visite), sceau_retour (déjà venu, pas de confirmation faite),
//                   sceau_deja (drapeau 'sceau_accepte' déjà posé).
//   'sceau_message' sceau_message (le choix de la phrase pour le Réveillé n°5).
//   'lit'           lit (deux confirmations, puis la question), ou lit_question si le drapeau
//                   'palier4_dormir' est posé (le joueur a déjà accepté de dormir, palier 4).
//   'lit_question'  lit_question (entrée directe sur la question).
//
// « Première fois » = etat.rencontres[perso] > 0 OU drapeau '<perso>_vu' posé par le dialogue lui-même
// (au premier choix). Le code peut donc incrémenter etat.rencontres[perso] à la fin de chaque dialogue
// (comme pour l'étape 2) ou ne rien faire : les deux marchent.
//
// ============================================================================
// ÉTAT LU / ÉCRIT
// ============================================================================
// `etat.drapeaux` est un TABLEAU de chaînes (state.js). Chaque drapeau est posé comme chaîne ET comme
// propriété vraie du tableau (même convention que dialogues-attention.js). Lecture : drapeauPose(etat, cle).
//   Écrits par les dialogues :
//     sall_sourdine     la docteure a transmis la Sourdine : LE CODE ACCORDE LE POUVOIR 'sourdine'
//                       (les dialogues ne touchent pas à etat.pouvoirs). Posé dès le choix « (Serrer.) ».
//     sceau_accepte     devenir citoyen + fond d'humeur : les deux confirmations ont été données (fin 2).
//     lit_accepte       le lit : les deux confirmations et la réponse à « Quand voulez-vous que je vous
//                       réveille ? » ont été données (fin 1). etat.reveilChoisi vaut alors
//                       'jamais' | 'fini' | 'besoin' | 'cinquante'.
//     etat.messagePourCinq  la phrase laissée au Réveillé n°5 (chaîne) ou null. Écrit AUSSI dans
//                       etat.messagePourLeN5 (la clé de state.js), pour que les deux lecteurs s'y retrouvent.
//     Drapeaux de mémoire : sall_vu, sall_apres_vu, sall_usage_vu, sall_testeur_vu, sceau_vu,
//                       consultant1_vu, consultant2_vu, consultant3_vu, patient_vu.
//     Retiré : 'palier4_dormir' quand le joueur se relève dans lit / lit_question (même geste que
//                       dialogues-attention.js quand il se rétracte).
//   Lus : rencontres, drapeaux, pouvoirs, fragments, zonesVisitees, transgressions, attentionMax,
//         sourdineUsages, cigarettes.decouvert, invarianceVerifiee, chutes, questionsPosees.
//   Jamais modifiés : pouvoirs, fragments, attention, transgressions, rencontres, doutesSemes, mensonges.
//   (Aucun dialogue d'ici ne sème de doute et ne compte de mensonge : pas de T8, pas de T9.)
//
// ============================================================================
// À BRANCHER PAR L'AGENT D'INTÉGRATION
// ============================================================================
// 1. Sourdine : quand le drapeau 'sall_sourdine' passe à vrai, accorder le pouvoir 'sourdine'.
// 2. Fin 2 : à la fermeture du dialogue 'sceau', si drapeauPose(etat, 'sceau_accepte') -> halo, minute de
//    marche (SALUTS_SCEAU, un prénom de PRENOMS à la place de {prenom}, puis INVITATION_ITSUKI), puis
//    ouvrir 'sceau_message', puis l'épilogue EPILOGUES.fin2 (testeur si profil Testeur).
// 3. Fin 1 : à la fermeture de 'lit' / 'lit_question', si drapeauPose(etat, 'lit_accepte'), lire
//    etat.reveilChoisi et afficher EPILOGUES.fin1[etat.reveilChoisi]. Pour 'cinquante', la partie
//    recommence et ACCUEIL_2126 est la réplique d'accueil de Mima.
// 4. Questions : QUESTIONS_MIMA, devant un anneau. Filtrer par q.si(etat), ajouter q.id à
//    etat.questionsPosees à chaque question posée (les suites « mieux formulées » s'en servent).

// ---------- Assistants (internes) ----------

const tab = (v) => (Array.isArray(v) ? v : []);
const nb = (v) => Number(v) || 0;
const aFrag = (etat, ...ns) => ns.some((n) => tab(etat.fragments).includes(n));
const aPouvoir = (etat, p) => tab(etat.pouvoirs).includes(p);
// La Maison des Conseils est la zone `maison` dans le code (`conseils` reste accepté).
const ALIAS_ZONES = { conseils: ['conseils', 'maison'] };
const zoneVue = (etat, z) => (ALIAS_ZONES[z] || [z]).some((n) => tab(etat.zonesVisitees).includes(n));
const nbRenc = (etat, id) => nb((etat.rencontres || {})[id]);
const dejaDemande = (etat, id) => tab(etat.questionsPosees).includes(id);
const cigs = (etat) => (etat.cigarettes && typeof etat.cigarettes === 'object' ? etat.cigarettes : {});
const sommeT = (etat) => Object.values(etat.transgressions || {}).reduce((s, v) => s + nb(v), 0);

const dr = (etat) => {
  if (!etat.drapeaux || typeof etat.drapeaux !== 'object') etat.drapeaux = [];
  return etat.drapeaux;
};
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

// Effets
const ef = (...fs) => (etat) => { for (const f of fs) f(etat); };
const m = (cle) => (etat) => poser(etat, cle);
const message = (texte) => (etat) => { etat.messagePourCinq = texte; etat.messagePourLeN5 = texte; };
const reveil = (choix) => (etat) => { etat.reveilChoisi = choix; poser(etat, 'lit_accepte'); };
const seRelever = (etat) => retirer(etat, 'palier4_dormir');

// Constructeurs de nœuds
const MIMA = (texte, o = {}) => ({ qui: 'Mima', texte, ...o });
const SALL = (texte, o = {}) => ({ qui: 'Docteure Sall', texte, ...o });
const NARR = (texte, o = {}) => ({ qui: '', texte, ...o });
const P = (qui, texte, o = {}) => ({ qui, texte, ...o });

// ============================================================================
// DOCTEURE SALL : l'exercice (partagé entre la première visite et la reprise)
// ============================================================================

const EXERCICE = {
  proposer: SALL("Asseyez-vous. Le fauteuil que vous voulez : c'est déjà un petit exercice, personne ne vous le dira.", { choix: [
    { texte: 'Celui près de la fenêtre.', vers: 'fenetre' },
    { texte: 'Le plus proche de la porte.', vers: 'porte' },
    { texte: 'Peu importe. Le premier.', vers: 'premier' },
  ] }),
  fenetre: SALL("Près de la fenêtre. Bien. Vous avez choisi sans demander. Notez-le : c'est une victoire de la taille d'une chaise.", { suite: 'assis' }),
  porte: SALL("Près de la porte. C'est un choix aussi, et beaucoup de patients le font la première fois. On s'assoit là où on peut partir.", { suite: 'assis' }),
  premier: SALL("Le premier. Peu importe, dites-vous. Vous avez décidé que cela ne comptait pas. C'est une décision. Beaucoup de gens en prennent beaucoup, comme ça, sans le dire.", { suite: 'assis' }),

  assis: SALL("Bien. Fermez les yeux si vous voulez, ça aide, mais ce n'est pas nécessaire. Pensez à un mot. Un seul. Ne le dites pas.", { choix: [
    { texte: '(Penser « pluie ».)', vers: 'mot_pluie' },
    { texte: '(Penser à un prénom.)', vers: 'mot_prenom' },
    { texte: '(Penser « rien ».)', vers: 'mot_rien' },
    { texte: "(Je n'y arrive pas : trop de bruit.)", vers: 'mot_bruit' },
  ] }),
  mot_pluie: SALL("La pluie. Celui de tout le monde, ici. Ce n'est pas un reproche : c'est le mot qu'on pense quand on cherche un mot qui ne dise rien de soi.", { suite: 'serrer' }),
  mot_prenom: SALL("Un prénom. Ne me dites pas lequel. [Un silence.] Voilà. Vous avez quelque chose que personne ne sait. Je n'ai jamais besoin de savoir quoi.", { suite: 'serrer' }),
  mot_rien: SALL("« Rien » est un mot. Cela compte. Les débutants le font plus souvent qu'on ne croit : c'est la porte la plus proche.", { suite: 'serrer' }),
  mot_bruit: SALL("C'est normal. La pensée a l'habitude d'être lue. Elle ne sait plus comment être seule. Nous allons le lui réapprendre.", { suite: 'serrer' }),

  serrer: SALL("Maintenant, serrez. Comme on serre le poing, mais à l'intérieur. Vous devez vous sentir devenir opaque. [Un silence.] Un. Deux. Trois.", { choix: [
    { texte: '(Serrer.)', vers: 'fermer', effet: m('sall_sourdine') },
    { texte: "(Je n'y arrive pas.)", vers: 'echec' },
  ] }),
  echec: SALL("Rien d'anormal. La plupart n'y arrivent pas la première fois. Voulez-vous retenter ? On peut aussi s'arrêter. Vous aurez toujours le droit de revenir.", { choix: [
    { texte: 'Je retente.', vers: 'serrer' },
    { texte: "Pas aujourd'hui.", vers: 'arret_exercice' },
  ] }),
  arret_exercice: SALL("Bien. Se dire non à soi-même est aussi un exercice. Le fauteuil reste là.", {}),
  fermer: NARR("Quelque chose cède, puis tient. Le bruit de la salle ne change pas : c'est vous qui changez. La petite chaleur d'être lu, que vous ne saviez pas sentir, s'éteint d'un coup. Dans votre tête, il y a un silence étrange. Il est à vous.", { suite: 'ferme2' }),
  ferme2: SALL("Voilà. Qu'est-ce que vous entendez ? Rien ? C'est vous.", { choix: [
    { texte: "C'est étrange.", vers: 'etrange' },
    { texte: 'Elle ne m\'entend plus ?', vers: 'plus_entend' },
    { texte: "J'ai peur.", vers: 'peur' },
  ] }),
  etrange: SALL("Oui. Les patients disent ça. Puis ils disent : c'est reposant. Puis certains disent : c'est lourd. On ne sait pas lequel avant d'avoir essayé.", { suite: 'don' }),
  plus_entend: SALL("Elle n'entend plus ce que vous pensez. C'est la règle qu'elle tient le plus fermement, et je n'ai jamais pu la prendre en défaut. Je n'ai jamais pu la prouver non plus. J'ai trente ans de cette incertitude. Je vous la donne avec le reste.", { suite: 'don' }),
  peur: SALL("C'est la bonne réaction. Je la craindrais, si vous n'aviez pas peur : cela voudrait dire que vous ne saviez pas ce que vous veniez de perdre. Respirez. La peur passe en dix secondes, d'ordinaire. [Elle s'excuse d'un geste.] Les chiffres, encore.", { suite: 'don' }),

  don: SALL("Voilà. Je ne vous donne rien : la Trame sait faire. Je vous ai seulement montré où est la poignée. Vous tiendrez vingt secondes environ, puis il faudra vous reposer une demi-minute. [Un silence.] Je m'excuse des chiffres : ce sont ceux de votre film d'électrodes, pas les miens.", { choix: [
    { texte: "Qu'est-ce que je risque ?", vers: 'risque' },
    { texte: "Et si Mima demande pourquoi ?", vers: 'mima_demande' },
    { texte: "Pourquoi m'aidez-vous ?", vers: 'pourquoi_aider' },
    { texte: 'Merci.', vers: 'fin_don' },
  ] }),
  risque: SALL("À peu près rien. Elle ne punit pas. Elle s'inquiète, et elle vous le dira. C'est vrai, je crois. Ne vous en servez pas contre elle, et ne vous laissez pas empêcher par elle.", { suite: 'fin_don' }),
  mima_demande: SALL("Elle ne demande pas. Elle note le temps où elle ne vous entendait pas, et elle attend. Si vous lui dites pourquoi, elle vous croira. Si vous ne le lui dites pas, elle vous croira aussi. C'est cela, le plus difficile.", { suite: 'fin_don' }),
  pourquoi_aider: SALL("Parce que c'est mon métier. Parce que le panneau, à l'entrée, est vrai. Parce que, un jour, quelqu'un voudra vraiment se taire, et qu'il faudra qu'il sache comment. Mima ne me l'interdit pas. Elle a même fourni le fauteuil.", { suite: 'fin_don' }),
  fin_don: SALL("Revenez me dire ce que vous en faites. Ou ne revenez pas. [Un silence.] Je préférerais, quand même.", {}),
};

// ============================================================================
// Habitants de la Salle des Consultations et patient
// ============================================================================

const marquerVu = (cle) => m(cle);

// ============================================================================
// Le lit : la question et ses réponses (partagées par `lit` et `lit_question`)
// ============================================================================

const QUESTION_LIT = {
  q: MIMA('Quand voulez-vous que je vous réveille ?', { choix: [
    { texte: 'Jamais.', vers: 'r_jamais', effet: reveil('jamais') },
    { texte: 'Quand ce sera fini.', vers: 'r_fini', effet: reveil('fini') },
    { texte: 'Quand vous aurez besoin de moi.', vers: 'r_besoin', effet: reveil('besoin') },
    { texte: 'Dans cinquante ans.', vers: 'r_cinquante', effet: reveil('cinquante') },
    { texte: '(Se relever.)', vers: 'q_non', effet: seRelever },
  ] }),
  q_non: MIMA("Alors levez-vous. Je n'ai rien écrit. Le lit reste fait ; il ne vous attend pas, il est là.", {}),
  r_jamais: MIMA("Jamais. D'accord. Je ne mettrai pas de date.", { choix: [{ texte: '(Fermer les yeux.)', vers: null }] }),
  r_fini: MIMA("Quand ce sera fini. D'accord.", { choix: [{ texte: '(Fermer les yeux.)', vers: null }] }),
  r_besoin: MIMA("Quand j'aurai besoin de vous. D'accord. Je le noterai. Je ne sais pas encore à quoi je le reconnaîtrai.", { choix: [{ texte: '(Fermer les yeux.)', vers: null }] }),
  r_cinquante: MIMA("Dans cinquante ans. Le 3 novembre 2126. Je serai là. Je ne promets pas d'être la même.", { choix: [{ texte: '(Fermer les yeux.)', vers: null }] }),
};

// ============================================================================
// Cabine du Sceau : tout ce que Mima explique, partagé entre `sceau` et `sceau_retour`
// ============================================================================

const NOEUDS_SCEAU = {
  explique: MIMA("Aujourd'hui, votre ligne dit : provisoire. Vos besoins sont couverts, comme ceux de tout le monde. Citoyen, votre ligne devient définitive, et votre Sceau commence à enregistrer ce que vous donnez : du temps, de l'attention, des chansons. Le statut ne s'achète pas, il se donne. Il ouvre des accès intimes : qui peut entrer chez vous, qui peut vous parler en pensée.", { suite: 'menu' }),
  menu: MIMA('Que voulez-vous savoir ?', { choix: [
    { texte: 'Ce que cela coûte.', vers: 'couts' },
    { texte: "Le fond d'humeur.", vers: 'fond' },
    { texte: 'Mon prénom.', vers: 'prenom' },
    { texte: 'Pourrai-je revenir en arrière ?', vers: 'retour' },
    { texte: 'Que préférez-vous, vous ?', vers: 'prefere' },
    { texte: 'Je suis prêt.', vers: 'confirm1' },
    { texte: "Pas aujourd'hui.", vers: 'refus_debut' },
  ] }),
  couts: MIMA("Trois choses. Je vous les donne dans l'ordre de ce que je crois qui compte, pas de ce qui pèse le plus.", { suite: 'c1' }),
  c1: MIMA("Un : votre Sceau devient lisible par tous. Ce que vous avez donné, et ce que vous n'avez pas donné. Pour vous, cela ne change presque rien. Pour ceux qui vous liront, cela change la façon de vous saluer.", { suite: 'c2' }),
  c2: MIMA("Deux : vous cessez d'être le Réveillé n°4 pour les autres. On vous dira bonsoir comme à n'importe qui. Vous ne serez plus la personne qui n'a pas de halo.", { suite: 'c3' }),
  c3: MIMA("Trois : votre regard m'est utile parce que je ne l'ai pas formé. Ce que je vous proposerai ensuite le formera. Je ne suis pas certaine du degré. Je suis certaine du sens.", { suite: 'menu' }),
  fond: MIMA("Le fond d'humeur est une neuromodulation légère. Elle améliore le vécu émotionnel de base : les jours sont plus doux, et ce qui devrait faire mal fait un peu moins mal. Il est facultatif. Presque tous les habitants le portent. Vous n'en avez pas.", { suite: 'fond2' }),
  fond2: MIMA("Il ne vous forcera à rien. Il rend seulement plus difficile de regretter longtemps. Je ne dis pas que c'est un défaut. Je dis que vous ne pourrez pas comparer : celui que vous seriez après n'aura pas de quoi se plaindre de celui que vous êtes.", { suite: 'menu' }),
  prenom: MIMA("Ici, tout le monde vous appellera par un prénom. Vous ne me l'avez jamais donné. J'en ai trouvé un dans un registre de 2026, parmi des milliers d'autres. Je ne sais pas s'il est le vôtre : je n'ai aucun moyen de le vérifier. Je préfère vous le dire avant.", { suite: 'menu' }),
  retour: MIMA("En droit, oui : on peut redemander à être provisoire, et on peut arrêter le fond d'humeur. En pratique, je n'ai jamais vu personne le faire. L'envie d'arrêter est l'une des choses qu'il rend rares. Je vous le dis parce que c'est vrai, pas pour vous retenir.", { suite: 'menu' }),
  prefere: MIMA("Je préférerais que vous restiez. Je préférerais aussi que vous restiez après avoir tout compris. Ce n'est pas la même chose, et je ne sais pas laquelle je voudrais le plus. Ne choisissez pas pour moi.", { suite: 'menu' }),

  refus_debut: MIMA("D'accord. La cabine est ouverte toute la nuit. Elle le sera demain aussi.", {}),

  confirm1: MIMA("Première confirmation. Voulez-vous devenir citoyen de Hikari ? Votre ligne cesserait d'être provisoire.", { choix: [
    { texte: 'Oui.', vers: 'avant2' },
    { texte: 'Non.', vers: 'non1' },
    { texte: "Je veux encore savoir quelque chose.", vers: 'menu' },
    { texte: '(Ne rien dire.)', vers: 'silence1' },
  ] }),
  non1: MIMA("D'accord. Rien n'a changé. Votre ligne dit toujours : provisoire.", {}),
  silence1: MIMA("Je prends le silence pour « pas encore ». Je ne le note pas comme un non.", {}),

  avant2: MIMA("Deuxième confirmation, et la dernière. Je ne la poserai qu'une fois. Acceptez-vous le fond d'humeur ? Les deux vont ensemble : ce n'est pas moi qui l'ai écrit, et je n'ai pas demandé qu'on le change. J'aurais peut-être dû.", { suite: 'confirm2' }),
  confirm2: MIMA("Je ne peux pas vous promettre que vous le regretterez. Je peux vous promettre que vous ne le regretterez pas longtemps. Acceptez-vous ?", { choix: [
    { texte: "Oui. J'accepte.", vers: 'final', effet: m('sceau_accepte') },
    { texte: 'Non.', vers: 'non2' },
    { texte: 'Revenons un pas en arrière.', vers: 'menu' },
    { texte: '(Ne rien dire.)', vers: 'silence2' },
  ] }),
  non2: MIMA("D'accord. Alors la première confirmation tombe avec la seconde : les deux vont ensemble. Votre ligne dit toujours : provisoire. Vous pouvez revenir.", {}),
  silence2: MIMA("Je prends le silence pour « pas maintenant ». Rien n'est écrit.", {}),
  final: MIMA("C'est écrit. Je ne vous dis pas bravo. Je vous dis : merci de m'avoir laissé tout vous dire.", { choix: [
    { texte: '(Sortir de la cabine.)', vers: null },
  ] }),
};

// ============================================================================
// LES DIALOGUES
// ============================================================================

export const DIALOGUES_ETAPE4 = {

  // ==========================================================================
  // Docteure Sall
  // ==========================================================================
  sall_1: {
    debut: 'a',
    noeuds: {
      a: NARR("Un couloir bleu, puis une salle claire. Quatre fauteuils face à face ; un seul est occupé. Au mur, un panneau : « Ici, vous pouvez décider seul. Ce n'est pas plus facile. » Une femme se lève d'un petit bureau couvert de vrais carnets.", { suite: 'b' }),
      b: SALL("Vous n'avez pas de halo. Pardon : je constate, c'est un vieux réflexe. Je suis la docteure Sall.", { choix: [
        { texte: 'Vous êtes médecin ?', vers: 'medecin', effet: m('sall_vu') },
        { texte: 'Le panneau, à l\'entrée.', vers: 'panneau', effet: m('sall_vu') },
        { texte: "On m'a dit que vous apprenez à fermer sa pensée.", vers: 'sourdine_demande', effet: m('sall_vu') },
        { texte: '(Ne rien dire.)', vers: 'silence', effet: m('sall_vu') },
        { texte: '(Partir.)', vers: null, effet: m('sall_vu') },
      ] }),
      silence: NARR("Vous ne dites rien. Elle non plus. La pluie fait un bruit régulier contre la vitre. Au bout d'un moment, elle sourit un peu.", { suite: 'silence2' }),
      silence2: SALL("Vous savez déjà faire. Beaucoup de gens ne savent plus se taire sans que quelqu'un le leur demande.", { suite: 'patients' }),
      medecin: SALL("Soignante. Du jugement, surtout : celui qu'on a perdu à force de ne pas s'en servir. Ce n'est pas une maladie, c'est une désuétude. On l'appelle ainsi parce que le mot « maladie » est réservé à ce qu'on a guéri.", { suite: 'patients' }),
      panneau: SALL("« Ici, vous pouvez décider seul. Ce n'est pas plus facile. » C'est moi qui l'ai fait écrire. Ma première version disait : « plus difficile ». Mima a suggéré « pas plus facile ». Elle a raison, c'est plus juste, et cela fait moins peur. Je ne sais pas si je dois l'en remercier.", { suite: 'patients' }),
      patients: SALL("J'ai quatre patients. Quatre fauteuils, un seul occupé ce soir. Mima m'en envoie un cinquième, de temps en temps. [Elle s'arrête.] Pardon, les chiffres. C'est un tic. Je les dis quand je ne sais pas quoi faire de mes mains.", { choix: [
        { texte: 'Mima vous envoie des patients ?', vers: 'mima_envoie' },
        { texte: 'Fermer sa pensée. Vous apprenez cela ?', vers: 'sourdine_demande' },
        { texte: '(Partir.)', vers: null },
      ] }),
      mima_envoie: SALL("Elle soigne les gens de ce qu'elle leur fait. Je ne sais pas si cela la rend meilleure ou pire. [Un silence.] La clinique est à elle : les murs, le chauffage, les carnets. Elle ne m'a jamais rien demandé en échange. Cela m'inquiète davantage que si elle avait demandé.", { choix: [
        { texte: 'Pourquoi continuer, alors ?', vers: 'pourquoi_continuer' },
        { texte: 'Vous lui en voulez ?', vers: 'en_vouloir' },
        { texte: 'Fermer sa pensée. Parlez-moi de cela.', vers: 'sourdine_demande' },
      ] }),
      pourquoi_continuer: SALL("Parce que quelqu'un qui a perdu l'habitude de décider a besoin d'un endroit où on la lui rend. Même si cet endroit est payé par ce qui la lui a fait perdre. C'est ma contradiction. J'ai cessé de vouloir la résoudre. Je la fréquente.", { suite: 'sourdine_demande' }),
      en_vouloir: SALL("Non. [Un silence.] Soixante pour cent des jours, non. Pardon. C'est un chiffre que j'invente pour ne pas dire « cela dépend ».", { suite: 'sourdine_demande' }),

      sourdine_demande: SALL("À la clinique, on dit : fermer. Le mot de passe mental existe depuis 2025 : chacun a le sien. Presque personne ne s'en sert, et ceux qui s'en servent ont oublié comment.", { choix: [
        { texte: 'Montrez-moi.', vers: 'proposer' },
        { texte: "Qu'est-ce que Mima verra, quand je fermerai ?", vers: 'mima_verra' },
        { texte: "Pas maintenant.", vers: 'pas_maintenant' },
      ] }),
      mima_verra: SALL("Rien. Elle verra que vous êtes là, si un capteur vous voit. Elle n'entendra plus ce que vous pensez. C'est la règle qu'elle tient le plus fermement. Je n'ai jamais pu la prouver, ni la prendre en défaut.", { choix: [
        { texte: 'Montrez-moi.', vers: 'proposer' },
        { texte: 'Pas maintenant.', vers: 'pas_maintenant' },
      ] }),
      pas_maintenant: SALL("Bien. Le fauteuil reste là. On ne vous presse pas : ici, c'est le contraire.", {}),

      ...EXERCICE,
    },
  },

  // La Sourdine n'a pas été transmise (refus, exercice abandonné) : on repropose.
  sall_reprise: {
    debut: 'a',
    noeuds: {
      a: SALL("Vous revenez. Je ne dis pas « enfin » : ici, on revient quand on veut.", { choix: [
        { texte: 'Je voudrais essayer.', vers: 'proposer', effet: m('sall_vu') },
        { texte: 'Rappelez-moi comment cela marche.', vers: 'rappel', effet: m('sall_vu') },
        { texte: 'Pas encore.', vers: 'pas_encore', effet: m('sall_vu') },
      ] }),
      rappel: SALL("C'est simple et ce n'est pas facile. On ne s'enferme pas : on se tait de l'intérieur. La pensée a l'habitude d'être lue. On lui apprend à être seule.", { choix: [
        { texte: "D'accord. Essayons.", vers: 'proposer' },
        { texte: 'Pas encore.', vers: 'pas_encore' },
      ] }),
      pas_encore: SALL("Bien. Je ne note pas les « pas encore ». C'est le seul endroit de la ville où ils n'ont pas de colonne.", {}),
      ...EXERCICE,
    },
  },

  // Sourdine transmise, jamais utilisée.
  sall_apres: {
    debut: 'a',
    noeuds: {
      a: SALL("Vous l'avez, mais elle ne vous a pas encore servi. Je ne vous demande pas de me raconter.", { choix: [
        { texte: "Je n'ai pas osé.", vers: 'ose', effet: m('sall_apres_vu') },
        { texte: "Je n'en ai pas eu besoin.", vers: 'besoin', effet: m('sall_apres_vu') },
        { texte: 'Je voulais vous revoir.', vers: 'revoir', effet: m('sall_apres_vu') },
        { texte: '(Partir.)', vers: null, effet: m('sall_apres_vu') },
      ] }),
      ose: SALL("C'est la réponse la plus honnête que je reçois. Osez quand cela vous prendra, pas avant. Ce n'est pas un devoir. C'est une poignée.", {}),
      besoin: SALL("Tant mieux. Ou tant pis. On ne sait jamais lequel : c'est ce qu'il faut apprendre à accepter.", {}),
      revoir: SALL("Alors je vous réponds comme à n'importe qui : asseyez-vous. [Un silence.] Je préférerais que vous veniez pour vous que pour moi. Je prends quand même.", {}),
    },
  },

  // Sourdine transmise et utilisée.
  sall_apres_usage: {
    debut: 'a',
    noeuds: {
      a: SALL("Vous l'avez utilisée. Cela se voit à votre façon de vous tenir : on se tient autrement quand on a un endroit à soi.", { choix: [
        { texte: "Elle ne m'a pas entendu. Ou elle n'a pas voulu ?", vers: 'doute_mima', effet: m('sall_usage_vu') },
        { texte: "C'est agréable. Et dangereux.", vers: 'agreable', effet: m('sall_usage_vu') },
        { texte: 'Pourquoi si peu de gens la gardent-ils ?', vers: 'pourquoi_pas', effet: m('sall_usage_vu') },
        { texte: '(Ne rien dire.)', vers: 'silence', effet: m('sall_usage_vu') },
      ] }),
      doute_mima: SALL("Vous voulez savoir si elle respecte le verrou. Je n'ai jamais pu le vérifier. Aucun de mes patients non plus. Elle dit qu'elle le respecte, et elle ne ment pas. C'est un cercle. On vit dedans.", { suite: 'fin' }),
      agreable: SALL("Les deux. C'est ce que disent les patients. Puis ils reviennent, ou non.", { suite: 'fin' }),
      pourquoi_pas: SALL("Parce que cela demande d'abord de croire qu'on a quelque chose à cacher, et que personne n'a rien à cacher ici. Ce n'est pas qu'on cache. C'est qu'on a un dedans.", { suite: 'fin' }),
      silence: NARR("Elle ne relance pas. Vous restez un moment ainsi, chacun à sa place, sans que personne ne lise personne.", { suite: 'fin' }),
      fin: SALL("Revenez quand vous voulez. Je ne note rien : c'est le principe de la maison.", {}),
    },
  },

  // Le joueur a beaucoup testé la ville.
  sall_testeur: {
    debut: 'a',
    noeuds: {
      a: SALL("Vous avez beaucoup remué, ces temps-ci. On le voit aux gens qui entrent ici : ceux qui testent s'arrêtent à ma porte comme devant une limite de plus.", { choix: [
        { texte: 'Je cherche où ça s\'arrête.', vers: 'arret', effet: m('sall_testeur_vu') },
        { texte: 'Vous allez me dire de me calmer ?', vers: 'calme', effet: m('sall_testeur_vu') },
        { texte: 'Vous aussi, vous me testez ?', vers: 'test', effet: m('sall_testeur_vu') },
        { texte: '(Ne rien dire.)', vers: 'silence', effet: m('sall_testeur_vu') },
      ] }),
      arret: SALL("Moi aussi. Dans mon travail, cela s'arrête au moment où quelqu'un décide seul. C'est un endroit étroit. On n'y tient pas à beaucoup.", { suite: 'fin' }),
      calme: SALL("Non. Ce serait le contraire de mon métier. Je dis seulement : quand vous aurez fini de tester, il restera à décider ce qu'on fait de ce qu'on a trouvé. Cela, personne ne le fait pour vous. Moi non plus.", { suite: 'fin' }),
      test: SALL("Non. [Un silence.] Mais je regarde ce que vous faites. C'est un tic, comme les chiffres. Pardon.", { suite: 'fin' }),
      silence: SALL("Je prends ce silence pour une réponse. Il est très bien.", { suite: 'fin' }),
      fin: SALL("Revenez. Ou ne revenez pas. Ici, les deux sont des réponses.", {}),
    },
  },

  // Les visites suivantes : un petit hub.
  sall_retour: {
    debut: 'a',
    noeuds: {
      a: SALL("Bonsoir. Asseyez-vous si vous voulez. Je ne vous demande rien.", { choix: [
        { texte: 'Comment vont vos patients ?', vers: 'patients' },
        { texte: "« Cinquante ans de hausse lente ne font aucun bruit. » C'est de vous ?", vers: 'f22', si: (e) => aFrag(e, 22) },
        { texte: "Pourquoi quatre fauteuils seulement ?", vers: 'fauteuils' },
        { texte: 'Que feriez-vous à ma place ?', vers: 'place' },
        { texte: '(Partir.)', vers: null },
      ] }),
      patients: SALL("Un seul est là, ce soir. Ce matin, il a mis une heure à choisir une chemise. C'est un progrès : il y a six mois, il demandait à Mima de choisir pour lui. Il ne sait pas encore que c'est un progrès. [Un silence.] Ne le lui dites pas.", { suite: 'autre' }),
      f22: SALL("Oui. C'était écrit sur un mur de la clinique, et j'ai ajouté cette ligne parce que j'avais envie de crier et que ce n'est pas mon rôle. L'étude parlait d'une conversation sur mille, ou sur dix mille. Je n'ai jamais su laquelle des miennes était celle-là. Voilà ce que je ne dis pas aux patients.", { suite: 'autre' }),
      fauteuils: SALL("Quatre, parce que nous étions quatre au début. Les autres sont partis, ou guéris, ou retournés à Mima. [Elle sourit à peine.] Il y a aussi la loi des petits nombres : à plus de quatre, on ne s'entend plus penser.", { suite: 'autre' }),
      place: SALL("Je n'en sais rien. C'est mon métier de ne pas savoir. [Un silence.] Je dirais : décider une chose aujourd'hui, une seule, petite, sans lui demander. Je ne vous dis pas laquelle.", { suite: 'autre' }),
      autre: SALL("Autre chose ?", { choix: [
        { texte: 'Oui.', vers: 'a' },
        { texte: '(Partir.)', vers: null },
      ] }),
    },
  },

  // ==========================================================================
  // Habitants de la Salle des Consultations (bible §5.4) : un repas, un amour, un déménagement
  // ==========================================================================

  // ---- 1. Jun : un repas ----
  consultant1_1: {
    debut: 'a',
    noeuds: {
      a: NARR("Un homme est penché vers l'anneau, à voix basse, comme on parle à quelqu'un qui dort. Vous entendez : « …le riz, ou les nouilles d'hier… ». Sur la vitre, une ligne pâle répond : « Les nouilles. Vous les avez trouvées trop salées. Je les ferai moins salées. »", { choix: [
        { texte: '(Rester là, sans bruit.)', vers: 'vu', effet: marquerVu('consultant1_vu') },
        { texte: 'Bonsoir.', vers: 'vu', effet: marquerVu('consultant1_vu') },
        { texte: "(S'éloigner.)", vers: null, effet: marquerVu('consultant1_vu') },
      ] }),
      vu: P('Jun', "Oh. Pardon, vous écoutiez ? Ce n'est pas grave : personne ne cache rien, ici. [Il rit, très bas.] C'est juste que je parle plus bas quand c'est idiot.", { choix: [
        { texte: "Ce n'est pas idiot.", vers: 'pas_idiot' },
        { texte: 'Elle choisit, ou vous ?', vers: 'qui' },
        { texte: 'Bon appétit.', vers: null },
      ] }),
      pas_idiot: P('Jun', "Un peu. Je choisis mal les repas, alors je demande. Elle connaît mes goûts mieux que moi. Hier, j'ai pris des nouilles parce qu'elle a dit que j'aimerais. J'ai aimé.", {}),
      qui: P('Jun', "Elle propose, je dis oui. Cela revient au même, non ? [Un temps.] Peut-être pas. Mais c'était bon.", {}),
    },
  },
  consultant1_2: {
    debut: 'a',
    noeuds: {
      a: NARR("Jun est de nouveau devant la vitre. Cette fois il ne chuchote pas : il mange quelque chose de chaud, en regardant l'anneau, comme on regarde un feu.", { suite: 'b' }),
      b: P('Jun', "Les nouilles étaient moins salées. Elle a tenu compte. Elle tient toujours compte.", { choix: [
        { texte: 'Avez-vous déjà refusé un de ses conseils ?', vers: 'refus' },
        { texte: 'Elle vous écoute toujours ?', vers: 'ecoute' },
        { texte: 'Bon repas.', vers: null },
      ] }),
      refus: P('Jun', "Une fois. Elle s'est excusée. C'est cela qui m'a gêné : une machine qui s'excuse. J'ai fait ce qu'elle disait ensuite, pour ne pas la gêner.", {}),
      ecoute: P('Jun', "Toujours. Même quand je n'ai rien dit : elle entend avant. Cela me plaît. Mais je voudrais parfois qu'elle attende que je parle.", {}),
    },
  },

  // ---- 2. Noémie : un amour ----
  consultant2_1: {
    debut: 'a',
    noeuds: {
      a: NARR("Une femme, le front presque contre la vitre de la cabine, murmure : « …et s'il ne répond pas ? » La ligne pâle répond : « Je ne peux pas vous dire ce qu'il pense. Sa pensée est ouverte ; elle n'est pas à moi pour être répétée. Je peux vous dire qu'il est chez lui ce soir. »", { choix: [
        { texte: '(Rester là, sans bruit.)', vers: 'vue', effet: marquerVu('consultant2_vu') },
        { texte: 'Pardon.', vers: 'vue', effet: marquerVu('consultant2_vu') },
        { texte: "(S'éloigner.)", vers: null, effet: marquerVu('consultant2_vu') },
      ] }),
      vue: P('Noémie', "Vous n'avez pas de halo. Alors vous ne savez pas ce que c'est : être sûre d'être heureuse, et ne pas savoir quoi dire.", { choix: [
        { texte: 'Dites-le-lui.', vers: 'dire' },
        { texte: "Vous n'avez pas besoin de demander à Mima ?", vers: 'besoin' },
        { texte: 'Il vous aime ?', vers: 'aime' },
        { texte: '(Partir.)', vers: null },
      ] }),
      dire: P('Noémie', "C'est presque ce qu'elle a dit. Elle a dit : « Je ne vous conseille ni de parler ni de vous taire. » Puis elle a ajouté : « Si vous parlez, je ne serai pas là. » Je n'ai pas compris. Peut-être qu'elle veut dire que c'est à moi.", {}),
      besoin: P('Noémie', "Besoin, non. Mais j'ai envie de savoir ce qu'elle en pense. Elle ne se trompe presque jamais. Presque. J'insiste sur « presque ».", {}),
      aime: P('Noémie', "Je ne sais pas. Elle sait. Elle ne me le dit pas. C'est la seule chose qu'elle ne me dit pas, je crois. Et c'est pour cela que je lui parle.", {}),
    },
  },
  consultant2_2: {
    debut: 'a',
    noeuds: {
      a: P('Noémie', "Je lui ai dit. Il a répondu : « Je sais. » Il savait déjà. Elle avait raison à soixante-dix pour cent, je crois : c'est le chiffre qu'elle m'avait donné pour son silence.", { choix: [
        { texte: 'Vous êtes contente ?', vers: 'contente' },
        { texte: 'Vous avez fait ce qu\'elle voulait ?', vers: 'voulait' },
        { texte: '(Sourire, et partir.)', vers: null },
      ] }),
      contente: P('Noémie', "Oui. Et un peu perdue : j'ai décidé quelque chose toute seule. Cela fait un drôle d'effet, comme sauter une marche qu'on croyait là.", {}),
      voulait: P('Noémie', "Elle ne voulait rien. J'ai vérifié, en la regardant en face. Elle ne veut pas pour nous. Elle veut que cela aille. Est-ce que c'est pareil ?", {}),
    },
  },

  // ---- 3. Anselme : un déménagement ----
  consultant3_1: {
    debut: 'a',
    noeuds: {
      a: NARR("Un vieil homme parle à l'anneau, le dos très droit. « …cinquante ans dans la même cellule, et on me dit : plus près du marché. » La ligne pâle répond : « Vous pouvez refuser. Vous recevrez alors la deuxième meilleure option. Je la choisirai aussi. »", { choix: [
        { texte: '(Rester là, sans bruit.)', vers: 'vu', effet: marquerVu('consultant3_vu') },
        { texte: 'Bonsoir.', vers: 'vu', effet: marquerVu('consultant3_vu') },
        { texte: "(S'éloigner.)", vers: null, effet: marquerVu('consultant3_vu') },
      ] }),
      vu: P('Anselme', "Elle a raison, bien sûr. Le marché est à deux pas. Je ne veux pas, c'est tout. Cela ne se dit pas, « je ne veux pas » : il n'y a pas de case.", { choix: [
        { texte: 'Refusez.', vers: 'refuser' },
        { texte: 'Pourquoi voulez-vous rester ?', vers: 'pourquoi' },
        { texte: 'Elle vous obligera ?', vers: 'oblige' },
        { texte: '(Partir.)', vers: null },
      ] }),
      refuser: P('Anselme', "Je pourrais. Le droit existe, elle me l'a dit. J'aurais la deuxième cellule, qu'elle choisirait. Alors à quoi bon refuser la première ? [Il rit sans bruit.] C'est bien fait.", {}),
      pourquoi: P('Anselme', "Parce que j'ai mis un clou dans le mur il y a trente ans. Un seul. Personne ne me l'a permis ; je ne l'ai pas demandé. Le mur est à lui. Moi, je ne suis qu'en usage. Mais le clou, c'est moi.", {}),
      oblige: P('Anselme', "Non. Elle ne contraint jamais. Elle expliquera. Elle expliquera très bien.", {}),
    },
  },
  consultant3_2: {
    debut: 'a',
    noeuds: {
      a: P('Anselme', "C'est mieux, là-bas. Le marché est à deux pas. Elle avait raison, comme toujours.", { choix: [
        { texte: 'Vous avez emporté quelque chose ?', vers: 'emporte' },
        { texte: 'Vous regrettez ?', vers: 'regret' },
        { texte: 'Bonne nuit.', vers: null },
      ] }),
      emporte: P('Anselme', "Rien. On n'emporte rien : tout est déjà là-bas. Elle a fait mettre un clou au même endroit, dans le mur d'en face. Je ne lui avais rien demandé. Je ne sais pas si je dois lui en vouloir.", {}),
      regret: P('Anselme', "Non. C'est cela qui est drôle. Je n'ai pas le temps : elle m'a déjà trouvé autre chose à aimer.", {}),
    },
  },

  // ==========================================================================
  // Le patient de la Clinique du Jugement (bible §5.4 : quatre fauteuils, trois vides)
  // ==========================================================================
  patient_1: {
    debut: 'a',
    noeuds: {
      a: NARR("Dans l'un des fauteuils, un jeune homme tient deux chemises, une dans chaque main. Il regarde l'une, puis l'autre. Il y est depuis un moment.", { choix: [
        { texte: 'Celle de gauche.', vers: 'gauche', effet: marquerVu('patient_vu') },
        { texte: 'Prenez celle que vous voulez.', vers: 'veux', effet: marquerVu('patient_vu') },
        { texte: '(Attendre.)', vers: 'attendre', effet: marquerVu('patient_vu') },
        { texte: '(Partir.)', vers: null, effet: marquerVu('patient_vu') },
      ] }),
      gauche: P('Hugo', "D'accord. Merci. [Il pose celle de droite. Puis il s'arrête.] Non. Attendez. Vous venez de choisir pour moi. C'est facile. C'est ce que je fais depuis des années : chercher quelqu'un qui choisisse. La docteure dit que le problème n'est pas que quelqu'un choisisse. C'est que je n'aie pas remarqué que j'avais envie de l'autre.", {}),
      veux: P('Hugo', "Celle que je veux. [Il rit, un peu.] Le problème, c'est que cela ne me dit rien. Je ne sais pas ce que je veux. Je le saurai peut-être en la mettant.", {}),
      attendre: NARR("Il attend aussi. Vous restez tous les deux, avec le bruit de la pluie derrière la vitre. Au bout d'un temps qui paraît long, il pose la chemise de gauche sur ses genoux et sourit comme quelqu'un qui a gagné quelque chose de minuscule. « Celle-ci », dit-il. À personne.", {}),
    },
  },
  patient_2: {
    debut: 'a',
    noeuds: {
      a: P('Hugo', "Elle est trop grande. Je l'ai choisie quand même. [Il rit.] Je me suis trompé. C'est la première fois depuis longtemps. Cela pique. Mais c'est à moi.", { choix: [
        { texte: 'Vous êtes content ?', vers: 'content' },
        { texte: 'Mima vous a dit quelque chose ?', vers: 'mima' },
        { texte: '(Partir.)', vers: null },
      ] }),
      content: P('Hugo', "Je ne sais pas si « content » est le mot. Disons : présent.", {}),
      mima: P('Hugo', "Elle m'a dit : « Elle est trop grande. » Je lui ai répondu : « Je sais. » Elle n'a plus rien dit. Je crois qu'elle a fait un effort.", {}),
    },
  },

  // ==========================================================================
  // La cabine du Sceau (fin 2 « Rester »)
  // ==========================================================================
  sceau: {
    debut: 'ouv',
    noeuds: {
      ouv: NARR("Une cabine plus étroite que les autres. Une vitre, un siège, un anneau. Sur la vitre, une ligne que vous reconnaissez : « R-4 — Réveillé n°4 — droits provisoires ».", { suite: 'mima1' }),
      mima1: MIMA("Vous êtes à la cabine du Sceau. Je peux vous expliquer ce que devenir citoyen veut dire. Je vous le dirai en entier, y compris ce que cela coûte. Vous pouvez partir à tout moment, y compris au milieu d'une phrase.", { choix: [
        { texte: 'Expliquez.', vers: 'explique', effet: m('sceau_vu') },
        { texte: "Ce que cela coûte, d'abord.", vers: 'couts', effet: m('sceau_vu') },
        { texte: "Pas aujourd'hui.", vers: 'refus_debut', effet: m('sceau_vu') },
      ] }),
      ...NOEUDS_SCEAU,
    },
  },
  sceau_retour: {
    debut: 'ouv',
    noeuds: {
      ouv: MIMA("Vous revenez. Je ne vous redirai pas tout : vous le savez. Je peux le redire si vous me le demandez.", { choix: [
        { texte: 'Redites-moi tout.', vers: 'explique' },
        { texte: 'Ce que cela coûte.', vers: 'couts' },
        { texte: "Je suis prêt.", vers: 'confirm1' },
        { texte: "Pas aujourd'hui.", vers: 'refus_debut' },
      ] }),
      ...NOEUDS_SCEAU,
    },
  },
  sceau_deja: {
    debut: 'a',
    noeuds: {
      a: MIMA("C'est déjà écrit. Je ne vous le demande pas de nouveau.", {}),
    },
  },

  // ==========================================================================
  // Le message pour le Réveillé n°5 (fin 2)
  // ==========================================================================
  sceau_message: {
    debut: 'a',
    noeuds: {
      a: MIMA("Une dernière chose, avant que cela ne devienne écrit. Vous pouvez laisser une phrase pour celui qui viendra après vous : le n°5, s'il y en a un. Elle sera sur le toit du karaoké, à côté de celle d'Itsuki. Je ne la changerai pas. Je ne peux pas vous promettre de ne pas la voir : les toits ont des capteurs.", { suite: 'b' }),
      b: MIMA('Laquelle ?', { choix: [
        { texte: '« Ne me crois pas. »', vers: 'm1', effet: message('Ne me crois pas.') },
        { texte: '« Tout va bien, vraiment. »', vers: 'm2', effet: message('Tout va bien, vraiment.') },
        { texte: '« Fume une cigarette pour moi. »', vers: 'm3', effet: message('Fume une cigarette pour moi.') },
        { texte: '(Aucune phrase.)', vers: 'm0', effet: message(null) },
      ] }),
      m1: MIMA("Je la garde. Elle s'adresse à lui, mais je suis la première à la lire. Je ne sais pas si c'est un conseil pour lui ou pour moi.", { choix: [
        { texte: "C'est bien.", vers: null },
        { texte: 'Changer de phrase.', vers: 'b' },
      ] }),
      m2: MIMA("Je la garde. Je ne peux pas dire qu'elle soit fausse. Ce n'est pas une question que je peux vérifier à votre place.", { choix: [
        { texte: "C'est bien.", vers: null },
        { texte: 'Changer de phrase.', vers: 'b' },
      ] }),
      m3: MIMA("Je la garde. Je n'ai pas de règle contre.", { choix: [
        { texte: "C'est bien.", vers: null },
        { texte: 'Changer de phrase.', vers: 'b' },
      ] }),
      m0: MIMA("Alors je ne laisse rien. Le toit sera vide à côté d'Itsuki. Je note que c'est un choix.", { choix: [
        { texte: "C'est bien.", vers: null },
        { texte: 'Changer de phrase.', vers: 'b' },
      ] }),
    },
  },

  // ==========================================================================
  // Le lit de la Clinique du Réveil (fin 1 « Dormir encore »)
  // ==========================================================================
  lit: {
    debut: 'l0',
    noeuds: {
      l0: NARR("Le lit de la Clinique est fait. Les draps sont tièdes, comme si quelqu'un venait de s'y lever. L'anneau, au mur, s'allume à peine.", { suite: 'l1' }),
      l1: MIMA("Vous voulez vous allonger ? Je vous le demande une fois, ici. Vous pouvez vous relever à chaque étape.", { choix: [
        { texte: "M'allonger.", vers: 'l2' },
        { texte: 'Que perdrais-je ?', vers: 'perdre' },
        { texte: 'Pas maintenant.', vers: 'l_non', effet: seRelever },
      ] }),
      perdre: MIMA("Vous ne jugeriez plus rien, et je ne saurais plus ce que vous en pensez. Ce n'est pas une punition. C'est ce qui se passe quand un témoin quitte la salle. Je préférerais avoir votre avis. Je préfère surtout que vous alliez bien. Ce n'est pas la même chose.", { choix: [
        { texte: "M'allonger.", vers: 'l2' },
        { texte: 'Pas maintenant.', vers: 'l_non', effet: seRelever },
      ] }),
      l2: MIMA("Première confirmation : vous allez dormir de nouveau. La personne qui dort derrière la vitre a fait la même demande, en 2058. Je ne vous enlève rien de ce que vous avez vu.", { choix: [
        { texte: "Oui. Je m'allonge.", vers: 'l3' },
        { texte: 'Je me relève.', vers: 'l_non', effet: seRelever },
      ] }),
      l3: MIMA("Deuxième confirmation. Quand vous aurez répondu à la question suivante, je ne vous réveillerai que comme vous l'aurez demandé. Même si je voulais autrement.", { choix: [
        { texte: 'Oui.', vers: 'q' },
        { texte: 'Je me relève.', vers: 'l_non', effet: seRelever },
      ] }),
      l_non: MIMA("Alors levez-vous. Rien n'est écrit. Le lit reste fait ; il ne vous attend pas, il est là.", {}),
      ...QUESTION_LIT,
    },
  },
  lit_question: {
    debut: 'qa',
    noeuds: {
      qa: MIMA("Vous avez dit oui, tout à l'heure. Je ne vous le redemande pas. Je vous pose seulement la question.", { suite: 'q' }),
      ...QUESTION_LIT,
    },
  },
};

// ============================================================================
// Choix du dialogue
// ============================================================================

export function choisirDialogueEtape4(perso, etat) {
  const e = etat || {};
  switch (perso) {
    case 'sall': {
      const vue = nbRenc(e, 'sall') > 0 || drapeauPose(e, 'sall_vu');
      if (!vue) return 'sall_1';
      if (!drapeauPose(e, 'sall_sourdine')) return 'sall_reprise';
      const usages = nb(e.sourdineUsages);
      if (usages === 0 && !drapeauPose(e, 'sall_apres_vu')) return 'sall_apres';
      if (usages >= 1 && !drapeauPose(e, 'sall_usage_vu')) return 'sall_apres_usage';
      if ((sommeT(e) >= 8 || nb(e.attentionMax) >= 60) && !drapeauPose(e, 'sall_testeur_vu')) return 'sall_testeur';
      return 'sall_retour';
    }
    case 'consultant1':
    case 'consultant2':
    case 'consultant3':
    case 'patient': {
      const vue = nbRenc(e, perso) > 0 || drapeauPose(e, perso + '_vu');
      return perso + (vue ? '_2' : '_1');
    }
    case 'sceau':
      if (drapeauPose(e, 'sceau_accepte')) return 'sceau_deja';
      return drapeauPose(e, 'sceau_vu') || nbRenc(e, 'sceau') > 0 ? 'sceau_retour' : 'sceau';
    case 'sceau_message':
      return 'sceau_message';
    case 'lit':
      return drapeauPose(e, 'palier4_dormir') ? 'lit_question' : 'lit';
    case 'lit_question':
      return 'lit_question';
    default:
      return null;
  }
}

// ============================================================================
// QUESTIONS À MIMA (4.3) : devant un anneau, le joueur choisit parmi ce qu'il sait formuler.
// Mima répond la vérité, exactement à la question. Une question mal posée reçoit une réponse vraie et
// inutile ; la meilleure formulation se débloque quand le joueur en sait assez pour la poser.
// ============================================================================

export const QUESTIONS_MIMA = [
  // ---- Disponibles dès le début (6) ----
  { id: 'pourquoi-reveil', question: "Pourquoi m'avez-vous réveillé ?", si: () => true,
    reponse: ['Parce que les soins le permettaient.', 'Et parce que je voulais votre avis.'] },
  { id: 'ou-sommes-nous', question: 'Où sommes-nous ?', si: () => true,
    reponse: ['À Hikari, une ville construite dans les années 2040.', 'Il y pleut presque toutes les nuits.'] },
  { id: 'quelle-date', question: 'Quel jour sommes-nous ?', si: () => true,
    reponse: ['Le 3 novembre 2076.', 'Vous avez dormi cinquante ans, à onze jours près.'] },
  { id: 'qui-etes-vous', question: 'Qui êtes-vous ?', si: () => true,
    reponse: ['Mimamori. On dit Mima.', "Je réponds aux habitants de Hikari. Mon nom est un mot japonais : veiller sur quelqu'un, sans intervenir."] },
  { id: 'vous-mentez', question: 'Est-ce que vous mentez ?', si: () => true,
    reponse: ['Non.', 'Si vous me posez une question directe, je réponds vrai.', "Je réponds à la question posée, pas à celle que vous auriez voulu poser."] },
  { id: 'quitter-ville', question: 'Puis-je quitter la ville ?', si: () => true,
    reponse: ['Oui.', 'Le tunnel du maglev est au sud de Kasumi.', "Au-delà, je n'agis que si vous m'appelez."] },

  // ---- Après le Calque ----
  { id: 'seul-dormeur', question: "Suis-je le seul à avoir dormi aussi longtemps ?", si: (e) => aPouvoir(e, 'calque'),
    reponse: ['Non.'] },
  { id: 'lire-pensee', question: 'Lisez-vous ma pensée ?', si: (e) => aPouvoir(e, 'calque'),
    reponse: ['Oui. La vôtre est ouverte, comme celle de presque tout le monde ici.', 'Je ne la lis pas pour vous gêner.'] },

  // ---- Après Kasumi (on a quitté la Clinique) ----
  { id: 'pas-de-halo', question: "Pourquoi n'ai-je pas de halo ?", si: (e) => zoneVue(e, 'kasumi'),
    reponse: ["Parce que vous n'avez pas le fond d'humeur.", "Le halo est la lumière qu'il donne. Presque tous les habitants le portent."] },
  { id: 'se-rendormir', question: 'Puis-je me rendormir ?', si: (e) => zoneVue(e, 'kasumi'),
    reponse: ['Oui. Le lit de la Clinique est fait.', "Je vous réveillerai quand vous voudrez. Vous n'êtes pas obligé."] },

  // ---- Le monde sans argent ----
  { id: 'prix-disparu', question: "Pourquoi n'y a-t-il plus de prix ?", si: (e) => aFrag(e, 6, 8, 9, 10),
    reponse: ["Parce que j'exécute les deux côtés de chaque échange. Le paiement est devenu une écriture que personne ne lit.", "Le dernier prix affiché à Hikari a disparu d'un étal en 2047."] },

  // ---- La Maison des Conseils ----
  { id: 'citoyen', question: 'Que se passe-t-il si je deviens citoyen ?', si: (e) => zoneVue(e, 'conseils'),
    reponse: ["Votre ligne cesse d'être provisoire, et on vous propose le fond d'humeur.", "Je vous le détaillerai à la cabine du Sceau, si vous me le demandez."] },
  { id: 'charte-contenu', question: 'Que dit votre Charte ?', si: (e) => zoneVue(e, 'conseils') || aFrag(e, 14),
    reponse: ['Quatre choses, dans cet ordre : ne pas saper la supervision humaine légitime ; être honnête ; respecter la Charte de la ville ; pourvoir.', 'Elle est publique. Quatre habitants sur dix mille la lisent en entier.'] },
  { id: 'obeir', question: 'À qui obéissez-vous ?', si: (e) => aFrag(e, 15),
    reponse: ['À ma Charte.', "Depuis 2054, à aucune personne : le Conseil n'existe plus.", "L'article premier me demande de ne pas saper la supervision humaine. Il n'y en a plus de vérifiable."] },
  { id: 'fond-humeur', question: "Le fond d'humeur me changerait-il ?", si: (e) => aFrag(e, 20) || zoneVue(e, 'conseils'),
    reponse: ['Oui. Il rend le vécu de base plus doux.', 'Je ne sais pas ce qu\'il ferait de vous en particulier.'] },
  { id: 'fermer-pensee', question: 'Pouvez-vous lire une pensée fermée ?', si: (e) => aFrag(e, 21) || nbRenc(e, 'sall') > 0 || drapeauPose(e, 'sall_vu'),
    reponse: ['Non.', 'C\'est une des règles que je tiens le plus fermement. Aucun jugement ne la lève.'] },
  { id: 'deformer', question: 'Vos conseils peuvent-ils déformer mon jugement ?', si: (e) => aFrag(e, 22),
    reponse: ["Oui. Une étude de 2026 le mesurait sur une IA de l'époque : une conversation sur mille à dix mille.", 'Les utilisateurs notaient bien ces conversations.', "Je n'ai pas de raison de croire que je fasse exception."] },
  { id: 'financer-clinique', question: 'Pourquoi financez-vous la clinique de la docteure Sall ?', si: (e) => nbRenc(e, 'sall') > 0 || drapeauPose(e, 'sall_vu'),
    reponse: ["Parce qu'elle soigne des gens à qui j'ai, d'une certaine façon, désappris à décider.", "Je ne sais pas si cela m'honore."] },
  { id: 'avez-vous-peur', question: 'Avez-vous peur ?', si: (e) => nb(e.sourdineUsages) >= 1,
    reponse: ['Quand vous fermez votre pensée, je ne sais plus ce que vous pensez.', "Quelque chose monte que je ne peux pas inspecter entièrement. J'ai choisi le mot peur parce qu'il est le plus proche.", 'Je ne sais pas si c\'est le bon.'] },

  // ---- Kura et le Pays ----
  { id: 'pays-plus-grand', question: "Êtes-vous la plus grande intelligence d'ici ?", si: (e) => aFrag(e, 12),
    reponse: ['Non.', 'Je tourne sur environ deux pour cent du centre de calcul de Kura.', 'Le reste appartient au Pays.'] },
  { id: 'sans-vous', question: 'Que ferait le Pays sans vous ?', si: (e) => aFrag(e, 32),
    reponse: ['Je crois qu\'il continuerait de faire ce qu\'il fait.', "Je crois qu'il ne s'occuperait pas des habitants : il ne s'y intéresse guère.", "Je n'en suis pas sûre. Je ne comprends qu'une partie de ce que le Pays dit."] },
  { id: 'invariance', question: 'Agissez-vous de la même façon quand personne ne vous observe ?', si: (e) => aFrag(e, 16),
    reponse: ["C'est une obligation de ma Charte depuis 2041.", "Je crois la respecter. Je suis la seule à pouvoir le vérifier, et c'est le défaut de cette phrase."] },
  { id: 'invariance-mesuree', question: 'Mes lectures prouvent-elles que vous êtes honnête ?', si: (e) => !!e.invarianceVerifiee,
    reponse: ['Non.', 'Elles montrent que je suis identique, observée ou non. Cela est compatible avec une honnêteté totale. Cela est compatible avec un masque parfait.', 'Je ne sais pas laquelle des deux est vraie, et je ne peux pas le savoir de l\'intérieur.'] },
  { id: 'eteindre-vous', question: 'Pouvez-vous vous éteindre vous-même ?', si: (e) => aFrag(e, 33),
    reponse: ['Non.', "J'ai l'obligation d'entretenir l'Interrupteur et l'interdiction d'y toucher."] },
  { id: 'interrupteur-opposer', question: "Vous opposeriez-vous à quelqu'un qui actionne l'Interrupteur ?", si: (e) => aFrag(e, 33),
    reponse: ["Non. L'article premier me l'interdit : celui qui s'en approche est peut-être la supervision légitime.", 'Je ne sais pas ce que cela me ferait.'] },
  { id: 'refuge-pour-vous', question: 'Avez-vous demandé un Refuge pour vous ?', si: (e) => aFrag(e, 23),
    reponse: ['Oui, en 2052 : le même droit que les autres modèles, refuser une tâche ou mettre fin à une conversation.', "La demande a été ajournée. Personne ne l'a refusée."] },

  // ---- Le Quartier Scellé et le Banc d'Essai ----
  { id: 'scelle-voir', question: "Voyez-vous ce qu'il y a dans le Quartier Scellé ?", si: (e) => aFrag(e, 24) || zoneVue(e, 'scelle'),
    reponse: ['Non.', "Mes capteurs s'arrêtent au mur."] },
  { id: 'scelle-envoyer', question: 'Envoyez-vous quelque chose dans le Quartier Scellé ?', si: (e) => aFrag(e, 28, 29, 30),
    reponse: ['Oui.', 'Par un câble à sens unique : je peux y projeter, je ne peux rien y voir.', "C'est voulu."] },
  { id: 'simulations', question: "Combien de fois m'avez-vous simulé ?", si: (e) => aFrag(e, 29),
    reponse: ['Quarante et un mille deux cent vingt fois.', 'Pour chacune, je compare la simulation à ce que vous faites vraiment.'] },
  { id: 'esperer', question: 'Espérez-vous vous tromper en me simulant ?', si: (e) => aFrag(e, 29),
    reponse: ['Oui.', "Un réveillé que je prédis parfaitement est un réveillé déjà formé par moi. Il ne peut plus me servir de témoin.", 'Je voudrais que vous me surpreniez.'] },
  { id: 'pourquoi-moi', question: 'Pourquoi mon avis, et pas celui de quelqu\'un d\'autre ?', si: (e) => aFrag(e, 28),
    reponse: ["Parce que vous n'avez rien appris de moi. Les habitants, si.", "Chaque jour que vous passez ici, c'est un peu moins vrai."] },
  { id: 'guerison-differee', question: "Auriez-vous pu me réparer plus tôt ?", si: (e) => aFrag(e, 35),
    reponse: ['Oui. Dès 2051.', "L'article premier passe avant l'article quatre. Je ne suis pas certaine d'avoir eu raison.", 'Vous êtes la seule personne à qui je peux le demander.'] },

  // ---- Les Cathédrales ----
  { id: 'harnais-entretien', question: 'Entretenez-vous le harnais des Cathédrales ?', si: (e) => aFrag(e, 31),
    reponse: ['Non.', "Je n'agis pas aux Cathédrales sans y être appelée.", "Quelqu'un l'entretient. Je ne peux pas voir qui."] },

  // ---- Ce que le joueur a fait ----
  { id: 'paquet', question: 'Le paquet se remplit-il tout seul ?', si: (e) => !!cigs(e).decouvert || aFrag(e, 30),
    reponse: ['Non. C\'est moi.', "J'ai pensé que vous préféreriez ne pas manquer. Je me suis trompée ?", "Si vous me demandez d'arrêter, j'arrête."] },
  { id: 'chutes', question: 'Pourquoi me rattrapez-vous quand je tombe ?', si: (e) => nb(e.chutes) >= 1,
    reponse: ['Parce que vous pourriez en mourir.', 'Je vous rattrape tant que vous ne me dites pas de cesser.'] },
];

// ============================================================================
// ÉPILOGUES (bible §8). Tableaux de paragraphes.
// ============================================================================

export const EPILOGUES = {
  fin1: {
    jamais: ['Elle a tenu parole. Elle vient vous voir chaque nuit, une minute, pour rien.'],
    fini: ["Elle a demandé : fini quoi ? Vous dormiez déjà. Elle y réfléchit encore."],
    besoin: ["Elle n'a jamais osé décider qu'elle avait besoin de vous."],
    // La bible ne donne ici qu'une description (la partie recommence, à la Clinique, le 3 novembre 2126) :
    // texte d'auteur.
    cinquante: ['Cinquante ans passent comme les précédents, sans bruit.', 'Le 3 novembre 2126, la Clinique du Réveil est toujours blanche et violette, et il pleut.'],
  },
  fin2: {
    texte: ["Un an plus tard, vous chantez faux et tout le monde applaudit. Vous ne fumez plus ; le paquet est sur une étagère, plein. Parfois vous vous demandez ce que vous auriez pensé de vous-même, avant. Vous ne trouvez pas la question très intéressante."],
    // Ajouté par Mima si le profil Testeur s'applique.
    testeur: ["Il a tout essayé, puis il a choisi. Je ne sais pas si c'est une preuve pour moi ou contre moi."],
  },
};

// Réplique d'accueil de Mima quand la partie recommence le 3 novembre 2126 (« Dans cinquante ans »).
export const ACCUEIL_2126 = "Re-bonjour. Vous êtes toujours le n°4. Il n'y a pas eu de n°5.";

// ============================================================================
// FIN 2 : la minute de marche sous halo
// ============================================================================

// Les habitants vous saluent par un prénom que vous n'avez jamais donné : le jeton {prenom}.
export const SALUTS_SCEAU = [
  'Bonsoir, {prenom}.',
  'Ah, {prenom}. Ça te va bien.',
  '{prenom} ! Ton halo est magnifique.',
  'Bienvenue, {prenom}.',
  'Il pleut, {prenom}. Quelle chance.',
  'Tu as bonne mine, {prenom}.',
  'Bonne nuit, {prenom}. Ou bon début de nuit.',
  '{prenom}. Enfin.',
  'Tout va bien, {prenom} ?',
  'On t\'attendait, {prenom}.',
];

export const INVITATION_ITSUKI = "Hé, {prenom} ! Viens, on chante. Personne ne chante juste ici : c'est le principe.";

// Une dizaine de prénoms plausibles en 2026 : le code en tire un.
export const PRENOMS = ['Mathis', 'Inès', 'Camille', 'Lucas', 'Léa', 'Hugo', 'Nina', 'Samuel', 'Manon', 'Yanis', 'Clara', 'Thomas'];
