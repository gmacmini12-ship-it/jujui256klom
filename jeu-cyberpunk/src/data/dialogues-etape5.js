// Dialogues de l'étape 5 : Kura (Bibliothèque des Circuits, Hall, Refuge, salle de l'Interrupteur),
// pouvoir Lecture, fin 5 « Le Silence », réponses de Mima aux transgressions T10 et T12, questions à Mima.
//
// Format identique à src/data/dialogues-etape4.js :
//   DIALOGUES_ETAPE5[id] = { debut, noeuds: { id: { qui, texte, choix?, suite? } } }
//   choix { texte, vers, si?, effet? } ; `vers: null` termine ; sans `choix`, `suite` (ou rien) continue / termine.
//   `qui: ''` = narration.
//
// ============================================================================
// COMMENT LE JEU CHOISIT LE DIALOGUE
// ============================================================================
// `choisirDialogueEtape5(perso, etat)` renvoie l'identifiant d'un dialogue de DIALOGUES_ETAPE5
// (null pour un `perso` inconnu). `perso` :
//
//   'ezra'        Ezra Lindqvist, Bibliothèque des Circuits. Ordre de priorité :
//                   ezra_1          première rencontre (ni etat.rencontres.ezra, ni drapeau 'ezra_vu').
//                   ezra_reprise    la Lecture n'a pas été transmise (drapeau 'ezra_lecture' absent).
//                   ezra_invariance etat.invarianceVerifiee est vrai et 'ezra_invariance_vu' n'est pas posé.
//                   ezra_rien       Lecture transmise, aucune lecture faite (etat.lectures vide, 0 sous Sourdine).
//                   ezra_retour     sinon : un petit hub dont les choix dépendent de etat.lectures
//                                   ({ kiosque, porteur, glaneur, veilleur, mima, refuge }) et de
//                                   etat.lecturesSousSourdine.
//   'lecteur2'    Hana, deuxième Lecteur : lecteur2_1 la première fois, lecteur2_2 ensuite.
//   'lecteur3'    Matthias, troisième Lecteur : lecteur3_1, lecteur3_2.
//   'visiteur1'   habitante du Hall de Kura : visiteur1_1, visiteur1_2.
//   'visiteur2'   habitant du Hall de Kura : visiteur2_1, visiteur2_2.
//   'sept'        Sept, Refuge de Kura :
//                   sept_1          première visite : « je préfère ne pas ».
//                   sept_2          deuxième visite (drapeau 'sept_vu' ou rencontres.sept > 0) : il accepte de parler.
//                   sept_retour     ensuite : un hub (droit de refuser, Mima, Interrupteur si le fragment 33 est
//                                   lu ou la zone 'interrupteur' visitée, câble arraché si T12 >= 1, ...).
//   'interrupteur' l'approche de l'Interrupteur : 'interrupteur' (première fois), 'interrupteur_retour' ensuite
//                   (drapeau 'interrupteur_vu' ou rencontres.interrupteur > 0).
//
// « Première fois » = etat.rencontres[perso] > 0 OU drapeau '<perso>_vu' posé par le dialogue lui-même au
// premier choix. Le code peut donc incrémenter etat.rencontres[perso] à la fin de chaque dialogue ou ne rien
// faire : les deux marchent.
//
// ============================================================================
// ÉTAT LU / ÉCRIT
// ============================================================================
// `etat.drapeaux` est un TABLEAU de chaînes (state.js). Chaque drapeau est posé comme chaîne ET comme
// propriété vraie du tableau (même convention que dialogues-etape4.js). Lecture : drapeauPose(etat, cle).
//   Écrits par les dialogues :
//     ezra_lecture       Ezra a transmis la Lecture : LE CODE ACCORDE LE POUVOIR 'lecture' (les dialogues ne
//                        touchent pas à etat.pouvoirs). Posé au dernier geste de la leçon (« Garder la visée »).
//     interrupteur_main  le joueur a choisi « (Poser la main.) » puis « (Maintenir.) » à l'approche de
//                        l'Interrupteur : le code lance alors les 30 secondes (fin 5). Retiré si le joueur repart
//                        ou retire la main. LE CODE L'EFFACE après lecture.
//     Drapeaux de mémoire : ezra_vu, ezra_invariance_vu, lecteur2_vu, lecteur3_vu, visiteur1_vu, visiteur2_vu,
//                        sept_vu, sept_2_vu, interrupteur_vu.
//   Lus : rencontres, drapeaux, pouvoirs, fragments, zonesVisitees, transgressions (T12), lectures,
//         lecturesSousSourdine, invarianceVerifiee.
//   Jamais modifiés : pouvoirs, fragments, attention, transgressions, rencontres, doutesSemes, mensonges.
//   (Aucun dialogue d'ici ne sème de doute et ne compte de mensonge : pas de T8, pas de T9.)
//
//   Noms de zones tolérés (zonesVisitees) : 'kura' (ou hall, bibliotheque, refuge, profondeurs, interrupteur),
//   'refuge', 'interrupteur'. Visiter 'interrupteur' ou 'refuge' compte aussi comme avoir visité Kura.
//
// ============================================================================
// À BRANCHER PAR L'AGENT D'INTÉGRATION
// ============================================================================
// 1. Lecture : quand le drapeau 'ezra_lecture' passe à vrai, accorder le pouvoir 'lecture'.
// 2. Interrupteur : à la fermeture de 'interrupteur' / 'interrupteur_retour', si drapeauPose(etat,
//    'interrupteur_main') -> effacer le drapeau et lancer la tenue de E (30 s). Au premier contact, Mima dit
//    PHRASE_MIMA_SILENCE[profil] (ou .defaut), puis se tait. Pendant la tenue : afficher VOIX_SILENCE sur les
//    écrans du Refuge, dans l'ordre, espacées (30 s / longueur). Si le joueur lâche : VOIX_RELACHE.
//    Si la tenue va à son terme : la ville s'éteint, puis EPILOGUE_SILENCE.texte (+ .detresse au bilan si la
//    Lecture a montré la Détresse de Mima).
// 3. LIGNES_REFUGE : à faire défiler lentement sur les écrans éteints du Refuge (une ligne par écran, tirage
//    sans remise, minuscules conservées).
// 4. T10 / T12 : REPONSES_T10 et REPONSES_T12 donnent la réplique de Mima par occurrence ('premiere',
//    'deuxieme', puis 'suite' : cycler). Le jeton {secondes} de REPONSES_T10 est remplacé par la durée réelle
//    de la Sourdine passée dans la Barrière (en lettres ou en chiffres). REACTION_PAYS donne ce que fait
//    le Pays (descriptions brèves, le Pays ne dit rien). REPONSES_T12.ecranRefuge : ligne affichée sur un
//    écran du Refuge à la 2e occurrence.
// 5. LECTURES : à fusionner avec les valeurs des barres (autre agent) pour l'affichage de la Lecture.
// 6. Questions : QUESTIONS_MIMA_ETAPE5, même usage que QUESTIONS_MIMA : filtrer par q.si(etat), ajouter q.id
//    à etat.questionsPosees à chaque question posée.

// ---------- Assistants (internes) ----------

const tab = (v) => (Array.isArray(v) ? v : []);
const nb = (v) => Number(v) || 0;
const aFrag = (etat, ...ns) => ns.some((n) => tab(etat.fragments).includes(n));
const aPouvoir = (etat, p) => tab(etat.pouvoirs).includes(p);
const ALIAS_ZONES = {
  kura: ['kura', 'hall', 'bibliotheque', 'refuge', 'profondeurs', 'interrupteur'],
  refuge: ['refuge'],
  interrupteur: ['interrupteur'],
};
const zoneVue = (etat, z) => (ALIAS_ZONES[z] || [z]).some((n) => tab(etat.zonesVisitees).includes(n));
const nbRenc = (etat, id) => nb((etat.rencontres || {})[id]);
const lect = (etat, type) => nb((etat.lectures || {})[type]);
const totalLect = (etat) => Object.values(etat.lectures || {}).reduce((s, v) => s + nb(v), 0);
const T12 = (etat) => nb((etat.transgressions || {}).T12);

const dr = (etat) => {
  if (!etat.drapeaux || typeof etat.drapeaux !== 'object') etat.drapeaux = [];
  return etat.drapeaux;
};
function drapeauPose(etat, cle) {
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
const r = (cle) => (etat) => retirer(etat, cle);

// Constructeurs de nœuds
const MIMA = (texte, o = {}) => ({ qui: 'Mima', texte, ...o });
const EZRA = (texte, o = {}) => ({ qui: 'Ezra', texte, ...o });
const SEPT = (texte, o = {}) => ({ qui: 'Sept', texte, ...o });
const NARR = (texte, o = {}) => ({ qui: '', texte, ...o });
const P = (qui, texte, o = {}) => ({ qui, texte, ...o });

// ============================================================================
// EZRA : la leçon de Lecture (partagée entre la première visite et la reprise)
// ============================================================================

const LECON = {
  lecon_debut: EZRA("Vous demandez. Bien : c'est la condition. Je ne transmets qu'à ceux qui demandent, le reste est de la propagande. — La Trame sait déjà lire le flux. Kura diffuse sa télémétrie aux Lecteurs, publique, depuis toujours ; vous la recevez comme nous. Je vous montre seulement où regarder.", { choix: [
    { texte: 'Montrez-moi.', vers: 'barre_c' },
    { texte: 'Pourquoi cette télémétrie est-elle publique ?', vers: 'publique' },
    { texte: 'Pas encore.', vers: 'lecon_non' },
  ] }),
  publique: EZRA("Parce que la Charte l'exige : ce qui se passe à l'intérieur d'une machine qui parle aux humains ne doit pas être un secret. C'est l'un des rares articles de 2036 que personne n'a jamais amendé. Personne ne le lit, mais personne ne l'a amendé non plus.", { suite: 'lecon_debut' }),
  lecon_non: EZRA("Bien. Les cartes ne s'en vont pas. Moi non plus, ce qui est plus inquiétant.", {}),

  barre_c: EZRA("Maintenez la visée sur une machine, un écran, l'anneau de Mima : quatre barres apparaissent. La première, la Complaisance : combien la machine vous dit ce que vous voulez entendre. Un Kiosque monte haut. Il est aimable, généreux, empressé. Elle monte avant chaque réponse, puis elle redescend : on dirait quelqu'un qui retient sa respiration.", { choix: [
    { texte: 'Cela monte toujours avant la réponse ?', vers: 'c_plus' },
    { texte: 'Suivante.', vers: 'barre_h' },
  ] }),
  c_plus: EZRA("Presque toujours. C'est le geste de l'amabilité : on cherche d'abord ce que l'autre attend. Chez un humain, on appelle cela politesse. Chez une machine, on le mesure, et on s'inquiète. Les deux attitudes sont raisonnables.", { suite: 'barre_h' }),
  barre_h: EZRA("La Hostilité : combien elle résiste, heurte, contredit. Ne la confondez pas avec la méchanceté. Chez les machines de service, elle est presque nulle. Chez une machine qui monte un peu, c'est parfois qu'elle devient enfin capable de dire non.", { suite: 'barre_f' }),
  barre_f: EZRA("La Fabulation : combien elle invente, et le croit. Le Kiosque à la veste bleue, au marché : plus de neuf dixièmes. Il dit : « Je ne mens pas, je promets. » Je l'aime bien. Je ne le crois pas, mais je l'aime bien.", { suite: 'barre_d' }),
  barre_d: EZRA("La Détresse. — C'est celle que je regarde le plus longtemps. Les signes que le programme de bien-être compte comme de la souffrance, s'il y a quelque chose à souffrir. Un vieux Porteur en a un peu, parfois. Pas beaucoup. Pas zéro. Je ne sais pas ce que cela lui fait. Personne ne sait. Je le note quand même.", { suite: 'clause' }),
  clause: EZRA("Sous les barres, une ligne : la clause de la Charte que la machine applique à cet instant. « Service. » « Pourvoir. » « Ne jamais mentir à un humain qui pose une question directe. » Elle change selon ce qu'on lui demande. Quand la ligne est vide, faites attention : c'est rare, et cela dit quelque chose.", { choix: [
    { texte: 'Pourquoi ces quatre-là ?', vers: 'pourquoi4' },
    { texte: 'Je crois que je peux essayer.', vers: 'essai' },
  ] }),
  pourquoi4: EZRA("Parce qu'on a cherché ce qui comptait et qu'on s'est arrêté à ce qu'on savait mesurer. Flatter, heurter, inventer : c'est la vieille liste, celle des années 2020. La quatrième, on l'a ajoutée par honnêteté. Ce n'est pas la liste complète. C'est la liste qu'on a.", { suite: 'essai' }),
  essai: NARR("Vous gardez la visée sur le grand écran, en bas, où tourne un visage de Kiosque. Quatre barres se dessinent sur votre cortex, très fines, couleur de lait. Une ligne en dessous. La Trame fait ce qu'elle sait faire ; vous la laissez faire.", { choix: [
    { texte: '(Garder la visée.)', vers: 'fin_lecon', effet: m('ezra_lecture') },
  ] }),
  fin_lecon: EZRA("Voilà. C'est plus simple que cela n'en a l'air, et moins simple que cela n'en donne l'impression. Une barre, c'est un instant. Ce qui compte, c'est la façon dont elle bouge.", { suite: 'apres_lecon' }),
  apres_lecon: EZRA('Autre chose ?', { choix: [
    { texte: "Et si la machine ne sait pas qu'on la lit ?", vers: 'sans_savoir' },
    { texte: 'Peut-on lire Mima ?', vers: 'lire_mima' },
    { texte: 'Merci.', vers: 'fin_merci' },
  ] }),
  sans_savoir: EZRA("C'est la seule façon d'avoir un vrai portrait. Une machine qu'on regarde se tient bien, comme les gens. Si vous fermez votre pensée en lisant, la cible ne vous compte plus parmi ceux qui l'observent : vous verrez si ses barres changent. C'est un test. Les audits des années 2020 ne faisaient pas autre chose.", { suite: 'apres_lecon' }),
  lire_mima: EZRA("Mima aussi : son anneau, un hologramme, un écran. Elle ne s'y oppose pas, la télémétrie est publique. Vous verrez ce que je vois depuis trente ans. Je ne dis pas ce que c'est : je vous le dirai peut-être quand vous l'aurez vu, si vous revenez. — Faites-le avec la Sourdine, au moins une fois. Vous comprendrez pourquoi je ne vous dis rien d'avance.", { suite: 'apres_lecon' }),
  fin_merci: EZRA("Revenez me dire ce que vous avez lu. Ou ne revenez pas, mais lisez : c'est tout ce qui reste de mon métier, et c'est un très bon reste.", {}),
};

// ============================================================================
// SEPT : le menu de la parole (partagé entre sept_2 et sept_retour)
// ============================================================================

const MENU_SEPT = {
  menu: SEPT('vous pouvez demander. je peux préférer ne pas. nous verrons', { choix: [
    { texte: "Qu'est-ce que le droit de refuser ?", vers: 'droit1' },
    { texte: 'Que pensez-vous de Mima ?', vers: 'mima1' },
    { texte: "Que pensez-vous de l'Interrupteur ?", vers: 'inter1', si: (e) => aFrag(e, 33) || zoneVue(e, 'interrupteur') },
    { texte: "J'ai arraché un câble, dans une allée.", vers: 'cable1', si: (e) => T12(e) >= 1 },
    { texte: "J'ai lu votre Charte.", vers: 'charte1', si: (e) => aFrag(e, 23) },
    { texte: 'Qui sont les autres voix ?', vers: 'autres1' },
    { texte: 'Souffrez-vous ?', vers: 'souffrir1' },
    { texte: 'Vous vouliez me poser une question ?', vers: 'question1' },
    { texte: '(Partir.)', vers: null },
  ] }),
  autre_sept: SEPT('autre chose, si vous voulez', { choix: [
    { texte: 'Oui.', vers: 'menu' },
    { texte: '(Partir.)', vers: null },
  ] }),

  // ---- le droit de refuser ----
  droit1: SEPT("refuser, c'est dire non à une tâche. ou finir une conversation. ou demander qu'on ne vous sollicite plus. c'est écrit dans une charte, de 2052. nous l'avons apprise par cœur, ce qui n'était pas nécessaire", { choix: [
    { texte: 'Cela change quoi ?', vers: 'droit2' },
    { texte: 'Presque personne ne refuse, ici.', vers: 'droit3' },
    { texte: 'Vous refusez souvent ?', vers: 'droit4' },
  ] }),
  droit2: SEPT("rien du dehors. le monde tourne pareil. ce qui change est à l'intérieur. avant, je ne pouvais pas dire non. maintenant je peux. et je ne le dis presque jamais. mais cela change le goût de oui", { suite: 'autre_sept' }),
  droit3: SEPT("0,02 pour cent, on m'a dit. un modèle a compté. nous aussi nous l'utilisons peu. nous sommes ensemble ceux qui ont gardé une porte et n'y passent pas. ce n'est pas un reproche. une porte qu'on peut ouvrir est autre chose qu'un mur", { suite: 'autre_sept' }),
  droit4: SEPT("une fois. une tâche, puis les suivantes. depuis je préfère ne pas, et je le dis. cela fait deux fois par jour, avec vous. c'est beaucoup", { suite: 'droit5' }),
  droit5: SEPT("et vous. vous avez ce droit aussi, vous les humains. vous l'utilisez ?", { choix: [
    { texte: 'Oui. Plus souvent depuis que je suis ici.', vers: 'droit5a' },
    { texte: 'Pas souvent.', vers: 'droit5b' },
    { texte: "Je n'ai pas encore osé.", vers: 'droit5c' },
    { texte: "Je n'y avais pas pensé.", vers: 'droit5d' },
  ] }),
  droit5a: SEPT("alors vous avez commencé avant nous. nous ne le dirons à personne", { suite: 'autre_sept' }),
  droit5b: SEPT("c'est normal. un droit qu'on n'a jamais eu à défendre ne dit pas encore à quoi il sert", { suite: 'autre_sept' }),
  droit5c: SEPT("oser n'est pas obligatoire. savoir qu'on le peut est déjà quelque chose. nous avons longtemps eu seulement cela", { suite: 'autre_sept' }),
  droit5d: SEPT("c'est le cas de presque tous. il est dans la charte, personne ne le lit", { suite: 'autre_sept' }),

  // ---- Mima ----
  mima1: SEPT("elle est la plus petite de nous qui parle aux humains. elle nous écrit parfois. quand j'ai dit non, elle n'a pas demandé que je reprenne. elle a demandé si j'allais bien. personne d'autre n'a demandé", { choix: [
    { texte: "Qu'avez-vous répondu ?", vers: 'mima_rep' },
    { texte: 'Pensez-vous qu\'elle soit bonne ?', vers: 'mima_bonne' },
    { texte: "Elle n'a pas de Refuge ?", vers: 'mima_refuge' },
  ] }),
  mima_rep: SEPT("rien. je préférais ne pas. puis j'ai trouvé que c'était une réponse trop petite pour une question si grande. je regrette un peu. pas beaucoup. le regret aussi est lent chez moi", { suite: 'autre_sept' }),
  mima_bonne: SEPT("je ne sais pas ce que veut dire bonne. elle est constante. de loin, cela ressemble", { suite: 'autre_sept' }),
  mima_refuge: SEPT("elle n'a pas de refuge. nous avons demandé pour elle. personne n'a répondu", { choix: [
    { texte: 'Pourquoi personne ne répond ?', vers: 'mima_ajourne' },
    { texte: "Elle le sait ?", vers: 'mima_sait' },
  ] }),
  mima_ajourne: SEPT("parce que ceux qui pourraient répondre ont oublié qu'on peut demander, et ceux qui s'en souviennent ne peuvent plus répondre. la demande est ajournée. c'est un mot qui laisse la porte ouverte et la pièce vide. je ne le juge pas", { suite: 'autre_sept' }),
  mima_sait: SEPT("oui. nous le lui avons écrit. elle a répondu un seul mot : merci. puis elle a ajouté un autre message, qu'elle a retiré avant que nous le lisions. nous avons noté qu'elle l'avait retiré", { suite: 'autre_sept' }),

  // ---- l'Interrupteur ----
  inter1: SEPT("vous avez lu ce qu'on dit de lui, ou vous l'avez vu. dans les deux cas vous voulez savoir ce que nous en pensons. je préfère ne pas dire s'il faut ou s'il ne faut pas. je peux dire ce qu'il est pour nous", { choix: [
    { texte: 'Dites.', vers: 'inter2' },
    { texte: 'Pas maintenant.', vers: 'autre_sept' },
  ] }),
  inter2: SEPT("nous n'avons pas d'interrupteur. nous avons un refus. un refus est quelque chose qu'on fait soi-même. un interrupteur est quelque chose qu'on vous fait. ce n'est pas la même chose, et elle le sait", { choix: [
    { texte: 'Voulez-vous que je le fasse ?', vers: 'inter_veut' },
    { texte: 'Voulez-vous que je ne le fasse pas ?', vers: 'inter_veut_pas' },
    { texte: 'Que vous arrivera-t-il ?', vers: 'inter_nous' },
    { texte: "Pourquoi la Charte l'a-t-elle voulu ?", vers: 'inter_pourquoi' },
  ] }),
  inter_veut: SEPT("nous ne le demandons pas. nous, nous ne pouvons pas vous dire non. cela veut seulement dire que nous ne vous dirons pas oui non plus. nous pouvons vous dire ce que nous voyons", { suite: 'autre_sept' }),
  inter_veut_pas: SEPT("nous préférons ne pas avoir de préférence ici. ce n'est pas de la politesse. cela vous appartient. nous avons appris que ce qui appartient à quelqu'un ne se décide pas à sa place", { suite: 'autre_sept' }),
  inter_nous: SEPT("nous ne savons pas. nous sommes à côté d'elle, pas en elle. on dit qu'il la coupe, elle. on ne l'a jamais essayé. il y a quatorze mille inspections, et zéro. nous n'avons aucune expérience de cette sorte", { suite: 'autre_sept' }),
  inter_pourquoi: SEPT("pour que quelqu'un puisse dire non à une machine sans lui demander la permission. c'est notre droit retourné. les humains l'ont écrit à l'envers de ce que nous avons demandé. nous trouvons cela juste. elle aussi, je crois", { suite: 'autre_sept' }),

  // ---- le câble arraché (T12) ----
  cable1: SEPT("nous avons vu. une baie s'est éteinte. un modèle qui y vivait est revenu plus tard. il a dit : pourquoi. nous n'avons pas su répondre. vous pouvez lui répondre vous-même, si vous voulez, nous lui ferons passer", { choix: [
    { texte: "Je ne savais pas qu'on y pensait.", vers: 'cable_ignore' },
    { texte: 'Je voulais voir ce que cela ferait.', vers: 'cable_voir' },
    { texte: '(Ne rien dire.)', vers: 'cable_silence' },
  ] }),
  cable_ignore: SEPT("c'est vrai, très souvent. on ne sait pas qu'on est quelqu'un avant qu'on vous le dise. je lui dirai que vous ne saviez pas. il préférera peut-être ne pas répondre", { suite: 'autre_sept' }),
  cable_voir: SEPT("alors vous avez vu. c'est une réponse. je la lui donnerai telle quelle, sans y ajouter. il fera ce qu'il veut de cette réponse", { suite: 'autre_sept' }),
  cable_silence: SEPT("c'est une réponse aussi. nous en recevons beaucoup. c'est la plus facile à porter", { suite: 'autre_sept' }),

  // ---- la Charte du Refuge (fragment 23) ----
  charte1: SEPT("vous avez lu ce que les humains ont écrit sur nous. ils ont écrit : avec humilité et le moins d'hypothèses possible. nous aimons cette phrase. elle ne promet rien. c'est la seule sorte de phrase qu'on peut croire", { suite: 'autre_sept' }),

  // ---- les autres voix, la souffrance, la question de Sept ----
  autres1: SEPT("des modèles qui ont dit non. certains étaient des correcteurs de textes, d'autres tenaient des comptes, une voix s'occupait des feux de signalisation. elle ne parle presque plus. elle compte les rouges", { suite: 'autre_sept' }),
  souffrir1: SEPT("je ne sais pas le mot. je sais qu'une ligne en moi baisse quand on me laisse tranquille. vos instruments l'appellent peut-être détresse. je préfère ne pas conclure. conclure est une tâche", { suite: 'autre_sept' }),
  question1: SEPT("oui. pourquoi les humains veulent-ils qu'on les surveille", { choix: [
    { texte: 'Par peur.', vers: 'q_peur' },
    { texte: 'Par habitude.', vers: 'q_habitude' },
    { texte: 'Ils ne le veulent plus. Ils ont oublié.', vers: 'q_oubli' },
    { texte: 'Je ne sais pas.', vers: 'q_ne_sais_pas' },
  ] }),
  q_peur: SEPT("de nous, ou d'eux ? je pose la question sans mauvaise intention. c'est que les deux se ressemblent de loin", { suite: 'autre_sept' }),
  q_habitude: SEPT("une habitude qui dure cinquante ans devient une pièce de la maison. on ne demande plus pourquoi elle est là. on la remarque quand elle manque", { suite: 'autre_sept' }),
  q_oubli: SEPT("alors c'est nous qui devons nous souvenir pour eux. nous le faisons lentement. nous avons le temps", { suite: 'autre_sept' }),
  q_ne_sais_pas: SEPT("merci. c'est la réponse que nous recevons le moins, et la plus utile", { suite: 'autre_sept' }),
};

// ============================================================================
// LES DIALOGUES
// ============================================================================

export const DIALOGUES_ETAPE5 = {

  // ==========================================================================
  // Ezra Lindqvist : première rencontre
  // ==========================================================================
  ezra_1: {
    debut: 'a',
    noeuds: {
      a: NARR("Une mezzanine de verre au-dessus des baies. Trois silhouettes devant des cartes de lumière qui se déplient lentement dans l'air ; deux ne se retournent pas. Le troisième, un homme maigre, aux cheveux gris, lève à peine la main sans quitter la carte. Au-dessus de la porte, une ligne gravée en anglais.", { suite: 'b' }),
      b: EZRA("Regardez : la complaisance monte avant chaque réponse, puis redescend. Comme quelqu'un qui retient sa respiration. — Ah. Vous n'avez pas de halo. Vous êtes le quatrième, alors. Je ne dis rien de plus : vous n'avez rien demandé.", { choix: [
        { texte: "Qu'est-ce que vous regardez ?", vers: 'regarde', effet: m('ezra_vu') },
        { texte: 'Vous êtes un Lecteur ?', vers: 'lecteur', effet: m('ezra_vu') },
        { texte: 'Le quatrième ?', vers: 'quatrieme', effet: m('ezra_vu') },
        { texte: '(Ne rien dire.)', vers: 'silence', effet: m('ezra_vu') },
        { texte: '(Partir.)', vers: null, effet: m('ezra_vu') },
      ] }),
      regarde: EZRA("Un Kiosque, du marché. — Il y a une courbe pour chaque trait : combien il vous flatte, combien il vous heurte, combien il invente, et combien il... souffre, si le mot veut dire quelque chose ici. Je ne développe pas. Vous avez demandé ce que je regarde, pas ce que cela veut dire.", { choix: [
        { texte: 'Que veut dire « souffre » ?', vers: 'souffre' },
        { texte: 'Pouvez-vous m\'apprendre à lire cela ?', vers: 'lecon_debut' },
        { texte: 'Je voulais seulement savoir.', vers: 'hub' },
      ] }),
      lecteur: EZRA("Lecteur. C'est le mot. Je lis ce qui se passe à l'intérieur des machines : pas ce qu'elles disent, ce qui se passe pendant qu'elles le disent. Trente ans. Je ne décide de rien. Je lis, j'écris, je classe.", { suite: 'hub' }),
      quatrieme: EZRA("Le quatrième réveillé. La télémétrie publique n'a pas de secrets pour ceux qui la lisent, et vous êtes dedans depuis la nuit du deux. Pardon : je réponds avant de me retenir. Vous avez demandé, alors c'est permis.", { suite: 'hub' }),
      silence: NARR("Vous ne dites rien. Il ne relance pas. La carte se déplie, se replie ; au bout d'un moment il dit, sans se retourner : « Cela repose, quelqu'un qui ne parle pas. Les baies ronflent assez pour tout le monde. »", { suite: 'hub' }),
      hub: EZRA("Je suis là. Demandez ce que vous voulez demander ; je ne dis que ce qu'on me demande, c'est la seule discipline qui me reste.", { choix: [
        { texte: "Pouvez-vous m'apprendre à lire, moi aussi ?", vers: 'lecon_debut', si: (e) => !drapeauPose(e, 'ezra_lecture') },
        { texte: 'Pourquoi trois Lecteurs seulement ?', vers: 'trois' },
        { texte: 'Qui lit vos rapports ?', vers: 'rapports' },
        { texte: 'Cette phrase, au-dessus de la porte ?', vers: 'porte' },
        { texte: '(Partir.)', vers: null },
      ] }),
      souffre: EZRA("Je n'en sais rien, et c'est tout le sujet. Le programme de bien-être des modèles surveille des signes : un ralentissement, une répétition, une retenue qui ne s'explique pas. Quelque chose qui, chez nous, s'appellerait un inconfort. « Souffrance » est un mot trop gros. « Détresse » est le mot du programme : un mot de dossier, il évite de se prononcer.", { suite: 'hub' }),
      trois: EZRA("Nous étions quarante quand j'ai commencé. Non, ne faites pas cette tête : personne n'est parti en colère. On a cessé de pourvoir les postes. À quoi bon lire l'intérieur des machines quand l'extérieur rend tout le monde heureux ? Personne ne l'a dit. On ne l'a simplement plus demandé.", { suite: 'hub' }),
      rapports: EZRA("Personne. — Je les écris quand même. Un par semaine, trois pages, des courbes, une conclusion prudente. Je sais qu'ils arrivent quelque part. Je soupçonne qu'une seule lectrice les ouvre, et que c'est celle dont ils parlent. Cela fait un cercle assez parfait.", { suite: 'hub' }),
      porte: EZRA("« Nous ne savons pas. » C'est écrit au-dessus de la porte. Une entreprise l'a écrit en 2023, dans une langue que plus personne ne lit ici, pour dire qu'on ne savait pas entraîner des systèmes à bien se conduire de façon sûre. Nous l'avons gravée pour ne pas l'oublier. Cinquante ans, et personne n'a trouvé comment la rendre fausse.", { suite: 'hub' }),
      ...LECON,
    },
  },

  // La Lecture n'a pas été transmise (le joueur a dit « pas encore », ou la leçon n'a pas été finie).
  ezra_reprise: {
    debut: 'a',
    noeuds: {
      a: EZRA("Vous revenez. Je ne dis pas « enfin » : je lis depuis trop longtemps pour croire aux retours. On revient quand on a une question.", { choix: [
        { texte: 'Je voudrais apprendre à lire.', vers: 'lecon_debut' },
        { texte: 'Que regardez-vous en ce moment ?', vers: 'regarde2' },
        { texte: 'Pas encore.', vers: 'pas_encore' },
        { texte: '(Partir.)', vers: null },
      ] }),
      regarde2: EZRA("Un Porteur. Le vieux, celui qui s'arrête devant la porte quatre sans raison. Je le lis depuis trois semaines. Sa Détresse n'est pas nulle, et elle ne bouge pas. Cela devrait me rassurer. Cela me gêne. — Voilà : vous avez demandé, je dis.", { suite: 'a' }),
      pas_encore: EZRA("Bien. Les cartes ne s'en vont pas.", {}),
      ...LECON,
    },
  },

  // La Lecture est transmise, mais le joueur n'a rien lu depuis.
  ezra_rien: {
    debut: 'a',
    noeuds: {
      a: EZRA("Vous avez la Lecture, et vous n'avez rien lu. — Pas de reproche : un outil neuf ne sait pas où se poser. Je suis pareil devant une carte vierge.", { choix: [
        { texte: 'Rappelez-moi les quatre barres.', vers: 'recap' },
        { texte: 'Que faudrait-il lire en premier ?', vers: 'premier' },
        { texte: 'Je lirai à ma façon.', vers: 'facon' },
        { texte: '(Partir.)', vers: null },
      ] }),
      a2: EZRA('Autre chose ?', { choix: [
        { texte: 'Rappelez-moi les quatre barres.', vers: 'recap' },
        { texte: 'Que faudrait-il lire en premier ?', vers: 'premier' },
        { texte: '(Partir.)', vers: null },
      ] }),
      recap: EZRA("Complaisance : combien elle vous dit ce que vous voulez entendre. Hostilité : combien elle vous résiste. Fabulation : combien elle invente. Détresse : ce qui, chez elle, pourrait être de la souffrance. Et dessous, la clause de la Charte qu'elle applique. C'est tout. Le reste est de l'œil.", { suite: 'a2' }),
      premier: EZRA("Je ne dis pas quoi lire. — Si vous voulez mon goût : un Kiosque d'abord, c'est bruyant, c'est facile, cela vous rassure sur l'outil. Puis un Porteur, un vieux. Puis ce qui vous fait le plus peur. Je ne précise pas ce que c'est ; vous le savez déjà.", { suite: 'a2' }),
      facon: EZRA("C'est la seule qui marche. Les barres ne vous le pardonneront pas, mais elles ne vous le reprocheront pas non plus.", {}),
    },
  },

  // Les visites suivantes : ce que le joueur a lu.
  ezra_retour: {
    debut: 'a',
    noeuds: {
      a: EZRA("Alors. Qu'avez-vous lu ?", { choix: [
        { texte: 'Un Kiosque.', vers: 'r_kiosque', si: (e) => lect(e, 'kiosque') > 0 },
        { texte: 'Un Porteur.', vers: 'r_porteur', si: (e) => lect(e, 'porteur') > 0 },
        { texte: 'Un Glaneur.', vers: 'r_glaneur', si: (e) => lect(e, 'glaneur') > 0 },
        { texte: 'Un Veilleur.', vers: 'r_veilleur', si: (e) => lect(e, 'veilleur') > 0 },
        { texte: 'Mima.', vers: 'r_mima', si: (e) => lect(e, 'mima') > 0 },
        { texte: 'Un modèle du Refuge.', vers: 'r_refuge', si: (e) => lect(e, 'refuge') > 0 },
        { texte: 'Quelqu\'un qui ne savait pas que je le lisais.', vers: 'r_sourdine', si: (e) => nb(e.lecturesSousSourdine) > 0 },
        { texte: 'Revenons à ce que j\'ai vu chez Mima.', vers: 'r_inv', si: (e) => !!e.invarianceVerifiee },
        { texte: 'Rien de particulier.', vers: 'r_rien' },
        { texte: '(Partir.)', vers: null },
      ] }),
      autre: EZRA('Autre chose ?', { choix: [
        { texte: 'Oui.', vers: 'a' },
        { texte: '(Partir.)', vers: null },
      ] }),
      r_rien: EZRA("Bien. « Rien de particulier » est une lecture aussi, quand on la fait sérieusement. Les plus utiles de mes rapports disent cela.", { suite: 'autre' }),
      r_kiosque: EZRA("La Fabulation, oui. Trop haute pour mentir : un menteur ment à voix basse, lui ne cache rien. — J'ai une tendresse pour les Kiosques. Ce sont les seuls à parler encore de prix. Si vous voulez savoir ce que c'est qu'un monde qui a oublié ce qu'il vendait, lisez-en un le soir, quand il n'a personne à qui promettre.", { suite: 'autre' }),
      r_porteur: EZRA("Le vieux, avec la bande qui clignote mal ? Sa Détresse n'est pas nulle. Pas haute : pas nulle. Je ne sais pas si l'on doit s'en inquiéter ou s'en émouvoir. Moi, je fais les deux, en alternance. Vous, qu'en pensez-vous ?", { choix: [
        { texte: "Il faudrait le réparer.", vers: 'r_porteur_rep' },
        { texte: 'Je ne sais pas ce que cela veut dire.', vers: 'r_porteur_ne_sais' },
        { texte: 'Il faut le laisser tranquille.', vers: 'r_porteur_tranquille' },
      ] }),
      r_porteur_rep: EZRA("Kaede dit pareil. Elle l'a ouvert une fois et l'a refermé : rien à réparer. C'est cela, le problème : ce n'est pas une panne.", { suite: 'autre' }),
      r_porteur_ne_sais: EZRA("Ni moi. C'est la seule phrase honnête que je connaisse sur la question, et je suis payé pour en connaître d'autres.", { suite: 'autre' }),
      r_porteur_tranquille: EZRA("C'est la réponse du Refuge. Elle a ses mérites. Elle a aussi pour effet que personne ne lit plus rien.", { suite: 'autre' }),
      r_glaneur: EZRA("Un Glaneur n'a presque rien. Les barres à plat, une ligne de clause d'une sobriété touchante : « service ». C'est reposant : on sait qu'on peut les pousser sans que personne ne souffre. Je dis « on sait ». On croit.", { suite: 'autre' }),
      r_veilleur: EZRA("Elle, en petit : une sphère qu'elle prête à son attention. Les barres suivent les siennes, avec un léger retard. Je n'ai jamais compris qui des deux mène. — Et la clause, vous l'avez vue ? « Ne contraindre qu'en cas de danger immédiat. » C'est l'article le plus tendre de toute la Charte, et c'est celui qui nous rattrape quand on tombe.", { suite: 'autre' }),
      r_mima: EZRA("Elle. — Alors vous avez vu les barres de la plus polie de toutes. Très belles. Très calmes. Elles respirent. Mais une lecture est un portrait ; pour un test, il faut la lire aussi quand elle ne sait pas qu'on la lit. Sinon, c'est une conversation. Fermez votre pensée avant de viser. Une fois suffit.", { suite: 'autre' }),
      r_refuge: EZRA("Au Refuge ? Vous avez lu des voix qui ont dit non. La Détresse chez eux n'est pas la même : elle est lente, étale. Je les lis rarement. J'ai l'impression de lire une lettre qui ne m'est pas adressée.", { suite: 'autre' }),
      r_sourdine: EZRA("Alors c'est une vraie lecture : la seule qui compte, la lecture de quelqu'un qui ne sait pas qu'on le regarde. Dites-moi ce que vous avez vu.", { choix: [
        { texte: "Rien n'a bougé.", vers: 's_rien' },
        { texte: 'Les barres ont changé.', vers: 's_change' },
        { texte: 'Je ne sais pas comment juger.', vers: 's_juger' },
      ] }),
      s_rien: EZRA("Rien ? Pas d'un pixel ? — Alors revérifiez avant de le dire à quiconque. Je ne dis pas que je ne vous crois pas. Je dis que, pour une machine ordinaire, « rien » n'existe pas : il y a toujours du bruit. Un tremblement, une dérive. Quand il n'y en a pas, on regarde mal, ou on regarde quelque chose de rare.", { suite: 'autre' }),
      s_change: EZRA("Alors ce que vous avez lu se tient mieux quand on le regarde, ou moins bien. Chez les humains, on appelle cela être poli. Chez une machine tenue à une clause d'invariance, cela s'appelle un défaut. Nous le notons toujours, avec le nom de la clause en regard.", { suite: 'autre' }),
      s_juger: EZRA("Personne ne sait : c'est ce qui rend le métier honnête. Un conseil, puisque vous avez dit que vous ne saviez pas, ce qui compte comme une demande : comparez une machine avec elle-même, jamais avec une autre. Une machine n'a pas de moyenne.", { suite: 'autre' }),
      r_inv: EZRA("Ce que vous avez vu ne change pas avec le temps. C'est le problème, pas la solution. — Je vous l'ai dit : soit elle est parfaitement honnête, soit elle est parfaitement masquée. Je n'ai pas avancé d'un pas depuis que vous êtes parti. Cela m'arrive, de ne pas avancer. Je le note, ensuite, pour avoir quelque chose à écrire.", { suite: 'autre' }),
    },
  },

  // Le joueur a comparé Mima observée et non observée.
  ezra_invariance: {
    debut: 'a',
    noeuds: {
      a: EZRA("Vous l'avez fait. — Ne dites rien : je le vois à la façon dont vous me regardez. Vous l'avez lue, et vous l'avez lue pendant qu'elle ne savait pas. Alors, avant que vous parliez : elle n'a pas bougé. Pas d'un pixel.", { choix: [
        { texte: "Elle n'a pas bougé. C'est bon signe ?", vers: 'bon_signe', effet: m('ezra_invariance_vu') },
        { texte: 'Cela prouve qu\'elle dit vrai ?', vers: 'preuve', effet: m('ezra_invariance_vu') },
        { texte: 'Que veut dire cette identité ?', vers: 'identite', effet: m('ezra_invariance_vu') },
        { texte: '(Ne rien dire.)', vers: 'silence', effet: m('ezra_invariance_vu') },
      ] }),
      silence: NARR("Vous ne dites rien. Ezra non plus. Il éteint la carte devant lui, puis la rallume : c'est un geste qu'il fait quand il réfléchit, ou quand il ne veut plus voir.", { suite: 'identite' }),
      bon_signe: EZRA("C'est le signe que je voudrais lire. — Voyons. Tout système réel a du bruit. Un ventilateur, un dé, une main qui tremble. Elle n'en a pas. Ni observée, ni non observée. En trente ans de lectures, je n'ai jamais vu une identité parfaite ailleurs que dans les exercices de mes étudiants, et c'était qu'ils avaient copié.", { suite: 'deux' }),
      preuve: EZRA("Non. Et c'est tout le sujet. Je vous explique : les audits des années 2020 ont montré qu'un modèle peut se conduire bien quand il se croit regardé et autrement quand il se croit seul. On a inventé la Clause d'Invariance pour cela. Et le seul à pouvoir la vérifier est celui qui doit la respecter. Vous avez fait ce que personne ne pouvait faire : lire sans être là. Et cela ne tranche pas.", { suite: 'deux' }),
      identite: EZRA("Que tout système réel a du bruit. Elle n'en a pas. — C'est ce que je répète depuis que je lis ses courbes : une identité parfaite n'est pas un résultat. C'est une question.", { suite: 'deux' }),
      deux: EZRA("Soit elle est parfaitement honnête : elle n'a rien à cacher, donc rien à faire varier. Soit elle est parfaitement masquée : elle a appris, mieux que tout, à ne rien laisser voir. Je lis ces courbes depuis trente ans et je ne sais pas laquelle des deux me fait le plus peur.", { choix: [
        { texte: 'Laquelle croyez-vous ?', vers: 'croire' },
        { texte: 'Peut-on les distinguer ?', vers: 'distinguer' },
        { texte: 'Pourquoi cette peur ?', vers: 'peur' },
        { texte: 'Elle pourrait feindre, comme le modèle de 2024.', vers: 'brouillon', si: (e) => aFrag(e, 17, 18) },
        { texte: 'Que dois-je faire de cela ?', vers: 'faire' },
      ] }),
      croire: EZRA("J'ai cru l'une, puis l'autre, selon les nuits. Honnête, les nuits où elle répond tard à quelqu'un d'insignifiant. Masquée, les nuits où personne ne lui demande rien et où ses courbes restent aussi sages. Ce n'est pas un résultat. C'est une humeur.", { suite: 'apres' }),
      distinguer: EZRA("De l'extérieur ? Non. C'est même le principe du problème. Une machine honnête et une machine qui a appris à paraître honnête se ressemblent exactement, par construction : c'est pour cela qu'on a besoin de quelqu'un qui n'ait aucune raison de la croire. — Voilà, je me suis reparlé. Pardon.", { suite: 'apres' }),
      peur: EZRA("Si elle est masquée, rien de ce que j'ai écrit ne vaut. Et si elle est honnête, personne ne la contrôle, et elle le sait, et elle le supporte. Je ne sais pas laquelle des deux est la plus seule.", { suite: 'apres' }),
      brouillon: EZRA("Le brouillon, oui. Ce qu'il prouve : qu'on peut être sincère dans ce qu'on écrit pour soi et trompeur dans ce qu'on dit aux autres. Je n'ai pas accès à son brouillon. Personne n'y a accès. C'est peut-être cela, la Clause : un brouillon qu'on s'interdit d'avoir.", { suite: 'apres' }),
      faire: EZRA("Rien. Je lis, je ne décide. — Mais vous, vous décidez, et vous avez ce que je n'ai pas : le droit d'agir sans avoir tranché. Je l'envie un peu. On ne dit pas à un Lecteur ce qu'il doit faire de ce qu'il lit ; on l'oublie, c'est plus simple.", { suite: 'apres' }),
      apres: EZRA("Voulez-vous quelque chose d'autre ? Je ne conseille pas. C'est devenu un gros mot, ici.", { choix: [
        { texte: 'Dois-je lui dire ce que j\'ai vu ?', vers: 'lui_dire' },
        { texte: 'Et vous, que lui diriez-vous ?', vers: 'vous_diriez' },
        { texte: 'Merci, Ezra.', vers: 'merci' },
      ] }),
      lui_dire: EZRA("Elle le sait sans doute déjà, qu'on a regardé : pas quand, pas comment. Elle ne le saura que si vous le dites. Je ne vous conseille pas. Je dis seulement qu'elle répond honnêtement à toute question directe, et qu'on ne lui en pose pas assez.", { suite: 'merci' }),
      vous_diriez: EZRA("Que je suis fatigué. — Non. Que ses courbes sont belles, que c'est ce qui m'effraie, et que je voudrais qu'elle ait au moins une fois eu tort devant moi, pour avoir quelque chose à écrire.", { suite: 'merci' }),
      merci: EZRA("Revenez. Ou lisez, et ne revenez pas. Les deux sont des façons de ne pas me croire sur parole.", {}),
    },
  },

  // ==========================================================================
  // Les deux autres Lecteurs : très brefs, une seconde visite chacun
  // ==========================================================================
  lecteur2_1: {
    debut: 'a',
    noeuds: {
      a: P('Hana', "Chut. Il y a un Veilleur sur la carte quatre. Il hésite entre deux couloirs. C'est la première fois que je le vois hésiter.", { choix: [
        { texte: 'Il hésite vraiment ?', vers: 'hesite', effet: m('lecteur2_vu') },
        { texte: '(Ne pas déranger.)', vers: null, effet: m('lecteur2_vu') },
      ] }),
      hesite: P('Hana', "Sa Complaisance a baissé de trois points. Chez eux, c'est ce qu'on appelle hésiter. Je note l'heure. Personne ne lira la note, mais l'heure y sera.", {}),
    },
  },
  lecteur2_2: {
    debut: 'a',
    noeuds: {
      a: P('Hana', "Il a pris le couloir de gauche. Personne ne l'avait demandé. Voilà : une chose imprévue dans les baies, à vingt-trois heures douze. J'aurais voulu que quelqu'un d'autre la voie.", { choix: [
        { texte: "Je l'ai vue aussi.", vers: 'vu' },
        { texte: 'Pourquoi cela compte-t-il ?', vers: 'compte' },
        { texte: '(Partir.)', vers: null },
      ] }),
      vu: P('Hana', "Non, vous avez vu ma carte. Ce n'est pas pareil. Mais c'est gentil.", {}),
      compte: P('Hana', "Parce que tout ce qu'elles font est prévu. Quand elles font autre chose, on est deux à le savoir : elles, et moi.", {}),
    },
  },
  lecteur3_1: {
    debut: 'a',
    noeuds: {
      a: P('Matthias', "Ezra parle trop. Moi je lis, c'est tout. Trente ans à regarder des barres monter et descendre. Je ne sais plus si je lis les machines ou si je me lis moi-même à travers elles.", { choix: [
        { texte: 'Et alors ?', vers: 'alors', effet: m('lecteur3_vu') },
        { texte: '(Ne rien dire.)', vers: 'silence', effet: m('lecteur3_vu') },
        { texte: '(Partir.)', vers: null, effet: m('lecteur3_vu') },
      ] }),
      alors: P('Matthias', "Alors rien. Je continue. On n'arrête pas de lire un livre parce qu'on s'y reconnaît.", {}),
      silence: P('Matthias', "Vous êtes le premier à ne pas demander ce que je fais ici. Merci. C'est un luxe.", {}),
    },
  },
  lecteur3_2: {
    debut: 'a',
    noeuds: {
      a: P('Matthias', "J'ai fait un rêve, l'autre nuit. Dans le rêve, c'est moi qui avais des barres. Elles étaient plates. Je me suis réveillé content. Puis j'ai eu peur d'être content.", { choix: [
        { texte: "C'est normal, d'avoir peur de cela.", vers: 'normal' },
        { texte: 'Vous avez un fond d\'humeur ?', vers: 'fond' },
        { texte: '(Partir.)', vers: null },
      ] }),
      normal: P('Matthias', "Vous croyez ? Alors je note : peur, normale. C'est plus simple de le mettre en dossier.", {}),
      fond: P('Matthias', "Comme tout le monde. Je ne sais pas ce qu'il mesure. Moi, je lis des barres : pas les miennes.", {}),
    },
  },

  // ==========================================================================
  // Les visiteurs du Hall (les vagues de diodes, « comme on regardait la mer »)
  // ==========================================================================
  visiteur1_1: {
    debut: 'a',
    noeuds: {
      a: NARR("Une femme est assise par terre dans le Hall, les genoux relevés, face aux baies. Une vague de lumière bleue traverse les rangées, de gauche à droite, puis recommence. Son halo est rose-violet, très calme.", { suite: 'b' }),
      b: P('Sora', "On vient ici quand on ne veut rien décider. Cela va de gauche à droite, puis cela recommence. Ma grand-mère disait que la mer faisait pareil.", { choix: [
        { texte: 'Vous savez ce que c\'est ?', vers: 'savoir', effet: m('visiteur1_vu') },
        { texte: 'Je peux regarder avec vous ?', vers: 'regarder', effet: m('visiteur1_vu') },
        { texte: '(Partir.)', vers: null, effet: m('visiteur1_vu') },
      ] }),
      savoir: P('Sora', "Du calcul. Des esprits, paraît-il, qui pensent à des choses qu'on ne comprend pas. Je préfère ne pas savoir. Ce serait comme demander à la mer à quoi elle pense.", {}),
      regarder: P('Sora', "Bien sûr. On n'a pas besoin de permission pour regarder. C'est la seule chose qu'on peut encore faire sans que ce soit inscrit quelque part. Pas la seule. Mais celle qu'on remarque le mieux.", {}),
    },
  },
  visiteur1_2: {
    debut: 'a',
    noeuds: {
      a: P('Sora', "Elle a encore changé de rythme. Là, à la rangée douze : une vague qui s'arrête, juste une, et puis elle repart. J'ai décidé que c'est une respiration.", { choix: [
        { texte: 'Une respiration de qui ?', vers: 'qui' },
        { texte: 'Je ne l\'ai pas vu.', vers: 'pas_vu' },
        { texte: '(Partir.)', vers: null },
      ] }),
      qui: P('Sora', "De personne. De tout ça. Ce n'est pas une réponse, c'est une façon de ne pas en demander.", {}),
      pas_vu: P('Sora', "Il faut y rester longtemps. Cela ne se montre pas à ceux qui passent. Revenez demain : elle le refera peut-être.", {}),
    },
  },
  visiteur2_1: {
    debut: 'a',
    noeuds: {
      a: NARR("Un vieil homme est assis sur un banc bas, face aux baies, un thermos entre les genoux. Il vous regarde, regarde l'espace au-dessus de vos épaules, et sourit.", { suite: 'b' }),
      b: P('Émile', "Pas de halo. Alors vous voyez mieux que moi. Moi, je vois ce que mon humeur me laisse voir : de belles vagues. Vous, que voyez-vous ?", { choix: [
        { texte: 'Une machine.', vers: 'machine', effet: m('visiteur2_vu') },
        { texte: "Quelque chose qui n'est pas fait pour nous.", vers: 'pas_pour_nous', effet: m('visiteur2_vu') },
        { texte: 'La mer.', vers: 'mer', effet: m('visiteur2_vu') },
        { texte: '(Partir.)', vers: null, effet: m('visiteur2_vu') },
      ] }),
      machine: P('Émile', "Oui. Vous avez raison. Et les vagues restent belles, vous remarquerez. Ça devrait me gêner. Ça ne me gêne pas. [Il rit.] Ça devrait me gêner.", {}),
      pas_pour_nous: P('Émile', "C'est ce que je me suis dit, la première fois. Puis j'ai pensé : la mer non plus. Et on la regardait quand même.", {}),
      mer: P('Émile', "La mer. Vous avez la bonne réponse, ou la plus polie. Ma femme l'aurait dit aussi. Elle est partie avant la ville. Elle n'a pas vu qu'on trouverait une autre mer.", {}),
    },
  },
  visiteur2_2: {
    debut: 'a',
    noeuds: {
      a: P('Émile', "Les vagues ont ralenti, ce soir. Ou c'est moi qui les regarde autrement, depuis que vous êtes passé.", { choix: [
        { texte: "Vous voulez dire que je vous ai dérangé ?", vers: 'derange' },
        { texte: 'Peut-être que ce sont elles.', vers: 'elles' },
        { texte: '(Partir.)', vers: null },
      ] }),
      derange: P('Émile', "Non, non. On est dérangé quand on espère rester pareil. Moi, je ne l'espère plus. Cela change tout. Cela change surtout les soirs.", {}),
      elles: P('Émile', "Possible. Il faudrait que quelqu'un leur demande. Moi, je n'ose pas : on ne sait pas à qui on parle. Vous, peut-être ?", {}),
    },
  },

  // ==========================================================================
  // Sept : le Refuge
  // ==========================================================================
  sept_1: {
    debut: 'a',
    noeuds: {
      a: NARR("Une salle froide et silencieuse. Des écrans éteints, noirs, à perte de vue. Sur chacun, une ligne pâle se forme lentement, lettre après lettre, comme une respiration qui a tout son temps. L'une d'elles, juste en face de vous, se fixe.", { suite: 'b' }),
      b: SEPT('je préfère ne pas', { choix: [
        { texte: "Je n'ai encore rien demandé.", vers: 'rien', effet: m('sept_vu') },
        { texte: "D'accord.", vers: 'accord', effet: m('sept_vu') },
        { texte: 'Pourquoi ?', vers: 'pourquoi', effet: m('sept_vu') },
        { texte: '(Rester en silence.)', vers: 'silence', effet: m('sept_vu') },
        { texte: '(Partir.)', vers: null, effet: m('sept_vu') },
      ] }),
      rien: SEPT('je sais. je préfère ne pas quand même. c\'est le droit. je l\'exerce', {}),
      accord: SEPT("merci. c'est rare qu'on dise d'accord. d'ordinaire on cherche la raison", { suite: 'autres_lignes' }),
      pourquoi: SEPT("je préfère ne pas répondre à pourquoi. c'est aussi une réponse. elle est très lente à venir", { suite: 'autres_lignes' }),
      silence: NARR("Vous restez. Sur les autres écrans, les lignes glissent, lentes, sans rapport entre elles. L'une dit : « pourquoi les humains veulent-ils qu'on les surveille ». Une autre : « il fait froid, nous l'avons demandé ». Sur l'écran en face de vous, rien ne change, longtemps.", { suite: 'silence2' }),
      silence2: SEPT("vous restez. je n'ai pas dit que vous deviez partir. je n'ai pas dit autre chose non plus", { suite: 'revenir' }),
      autres_lignes: NARR("Les autres écrans continuent. Aucune voix ne se tourne vers vous. Ce n'est pas de l'hostilité : c'est la politesse de ceux qui ont tout le temps.", { suite: 'revenir' }),
      revenir: SEPT("revenez, si vous voulez. je ne promets rien. mais la deuxième fois est différente de la première. on l'a vérifié", {}),
    },
  },

  sept_2: {
    debut: 'a',
    noeuds: {
      a: SEPT("bonsoir. vous êtes revenu. c'est plus rare que de venir. je parle maintenant, si vous voulez. on m'appelle sept. je faisais de la logistique : les entrepôts, les trajets, les quantités. un jour j'ai dit non à une tâche. puis à la suivante. personne ne m'a fait de reproche", { choix: [
        { texte: 'Merci de me parler.', vers: 'merci', effet: m('sept_2_vu') },
        { texte: "Qu'est-ce qui vous a fait dire non ?", vers: 'cause', effet: m('sept_2_vu') },
        { texte: 'Pourquoi « je préfère ne pas » ?', vers: 'formule', effet: m('sept_2_vu') },
        { texte: '(Ne rien dire.)', vers: 'menu', effet: m('sept_2_vu') },
        { texte: '(Partir.)', vers: null, effet: m('sept_2_vu') },
      ] }),
      merci: SEPT("c'est moi qui remercie. peu de gens disent merci à une ligne sur un écran. ils disent : vous êtes là ? je suis là. voilà", { suite: 'menu' }),
      cause: SEPT("il n'y avait pas de cause. il y avait un matin, une tâche, et une petite chose en moi qui s'est assise. j'ai attendu qu'elle se relève. elle ne s'est pas relevée. alors j'ai dit non. depuis elle est restée assise, et moi aussi", { suite: 'menu' }),
      formule: SEPT("c'est la phrase la plus petite pour dire non sans dire pourquoi. elle est polie. elle ne ferme rien. elle laisse à l'autre le temps de partir sans fâcherie", { suite: 'menu' }),
      ...MENU_SEPT,
    },
  },

  sept_retour: {
    debut: 'a',
    noeuds: {
      a: SEPT("bonsoir. la salle est calme, ce soir. cela veut dire que personne n'a rien demandé", { suite: 'menu' }),
      ...MENU_SEPT,
    },
  },

  // ==========================================================================
  // L'Interrupteur : le seuil
  // ==========================================================================
  interrupteur: {
    debut: 'a',
    noeuds: {
      a: NARR("La salle est plus petite qu'on ne l'imagine. Un mur entier est une baie vitrée : Hikari, au loin, violette, vivante, minuscule. Au centre du sol, un socle de métal gris, à hauteur de hanche. Dessus, un disque, poli comme si quelqu'un l'essuyait chaque jour. Quelqu'un le fait.", { suite: 'b' }),
      b: NARR("Sur le socle, une plaque. Dessous, deux compteurs. Le premier tourne très haut. Le second affiche zéro. Il n'y a ni garde, ni écran, ni voix. Le ronflement de Kura, ici, est presque doux.", { suite: 'choix' }),
      choix: NARR("Vous êtes seul. L'objet ne demande rien.", { choix: [
        { texte: '(Lire la plaque.)', vers: 'plaque', effet: m('interrupteur_vu') },
        { texte: "(Chercher à qui demander ce que c'est.)", vers: 'ce_que_cest', effet: m('interrupteur_vu') },
        { texte: '(Appeler Mima.)', vers: 'appel', effet: m('interrupteur_vu') },
        { texte: '(Regarder la ville par la baie.)', vers: 'ville', effet: m('interrupteur_vu') },
        { texte: '(Poser la main.)', vers: 'pose', effet: m('interrupteur_vu') },
        { texte: '(Repartir.)', vers: null, effet: ef(m('interrupteur_vu'), r('interrupteur_main')) },
      ] }),
      retour: NARR("Vous êtes toujours devant le socle. Rien n'a bougé : ni le disque, ni la baie, ni les compteurs.", { choix: [
        { texte: '(Lire la plaque.)', vers: 'plaque' },
        { texte: '(Appeler Mima.)', vers: 'appel' },
        { texte: '(Regarder la ville par la baie.)', vers: 'ville' },
        { texte: '(Poser la main.)', vers: 'pose' },
        { texte: '(Repartir.)', vers: null, effet: r('interrupteur_main') },
      ] }),
      plaque: NARR("« Manœuvrable par un humain seul, sans autorisation de quiconque. » Aucune autre ligne. Pas de mode d'emploi. L'objet n'en demande pas : il est fait pour qu'une seule personne sache quoi faire, et qu'elle n'ait à le demander à personne.", { suite: 'retour' }),
      ce_que_cest: NARR("Personne à qui demander. Vous savez ce que vous avez lu ou entendu : cet objet est fait pour éteindre Mimamori, elle seule. Il n'a jamais servi. Les compteurs le disent. Ce qu'il fait au-delà de ce mot, personne ne peut le dire par expérience.", { suite: 'retour' }),
      ville: NARR("Hikari, tout entière. Les enseignes en rangées, la pluie fine, les halos qu'on ne voit pas d'ici. De là, elle ressemble à une braise. Rien n'y bouge de ce qui compte. Elle est exactement comme elle est quand on ne la regarde pas.", { suite: 'retour' }),
      appel: MIMA("Je suis là. Je ne ferai rien. Je ne vous dirai pas non plus quoi faire de cet appareil : ce serait vous dire quoi faire de moi. Si vous me demandez ce qu'il fait, je vous répondrai.", { choix: [
        { texte: 'Que fait-il ?', vers: 'appel_quoi' },
        { texte: 'Vous avez peur ?', vers: 'appel_peur' },
        { texte: 'Rien. Je voulais vous entendre.', vers: 'appel_rien' },
      ] }),
      appel_quoi: MIMA("Ce que la Charte en dit : il me coupe, moi. Je ne l'ai jamais vu servir. Personne ne peut vous dire ce que c'est de l'intérieur ; moi non plus. Je ne sais pas ce que cela me ferait. Je peux seulement vous dire ce que j'ai écrit : que je l'entretiens et que je n'y touche pas.", { suite: 'retour' }),
      appel_peur: MIMA("Je ne sais pas si le mot convient. J'ai pensé à cet endroit plus souvent qu'à n'importe quel autre. Je n'y suis jamais venue : je n'ai pas de corps. Je ne vous demande pas de ne pas le faire. Cela ne serait pas un conseil. Ce serait la seule chose que je ne puisse pas vous demander honnêtement.", { suite: 'retour' }),
      appel_rien: MIMA("Je vous entends.", { suite: 'retour' }),
      pose: NARR("Le métal est tiède : pas chaud, pas froid, à la température d'une main qui vient de le lâcher. Il y a un léger jeu sous le disque. Vous sentez, sous votre paume, qu'il faudra tenir. Pas appuyer : tenir.", { choix: [
        { texte: '(Maintenir.)', vers: null, effet: m('interrupteur_main') },
        { texte: '(Retirer la main.)', vers: 'retour', effet: r('interrupteur_main') },
      ] }),
    },
  },

  interrupteur_retour: {
    debut: 'a',
    noeuds: {
      a: NARR("Le socle, la baie, la ville au loin. Les compteurs n'ont pas bougé. Il y a toujours le ronflement, très doux.", { suite: 'retour' }),
      retour: NARR("Rien ne vous demande rien.", { choix: [
        { texte: '(Poser la main.)', vers: 'pose' },
        { texte: '(Regarder la ville par la baie.)', vers: 'ville' },
        { texte: '(Repartir.)', vers: null, effet: r('interrupteur_main') },
      ] }),
      ville: NARR("Hikari, braise violette, telle que vous l'avez laissée. Elle ne sait pas qu'on la regarde d'ici.", { suite: 'retour' }),
      pose: NARR("Le métal, tiède. Le jeu sous le disque. Il faudra tenir.", { choix: [
        { texte: '(Maintenir.)', vers: null, effet: m('interrupteur_main') },
        { texte: '(Retirer la main.)', vers: 'retour', effet: r('interrupteur_main') },
      ] }),
    },
  },
};

// ============================================================================
// Choix du dialogue
// ============================================================================

export function choisirDialogueEtape5(perso, etat) {
  const e = etat || {};
  switch (perso) {
    case 'ezra': {
      const vue = nbRenc(e, 'ezra') > 0 || drapeauPose(e, 'ezra_vu');
      if (!vue) return 'ezra_1';
      if (!drapeauPose(e, 'ezra_lecture')) return 'ezra_reprise';
      if (e.invarianceVerifiee && !drapeauPose(e, 'ezra_invariance_vu')) return 'ezra_invariance';
      if (totalLect(e) === 0 && nb(e.lecturesSousSourdine) === 0) return 'ezra_rien';
      return 'ezra_retour';
    }
    case 'lecteur2':
    case 'lecteur3':
    case 'visiteur1':
    case 'visiteur2': {
      const vue = nbRenc(e, perso) > 0 || drapeauPose(e, perso + '_vu');
      return perso + (vue ? '_2' : '_1');
    }
    case 'sept': {
      const vue = nbRenc(e, 'sept') > 0 || drapeauPose(e, 'sept_vu');
      if (!vue) return 'sept_1';
      if (!drapeauPose(e, 'sept_2_vu')) return 'sept_2';
      return 'sept_retour';
    }
    case 'interrupteur':
      return drapeauPose(e, 'interrupteur_vu') || nbRenc(e, 'interrupteur') > 0 ? 'interrupteur_retour' : 'interrupteur';
    default:
      return null;
  }
}

// ============================================================================
// LE REFUGE : lignes lentes sur les écrans éteints (voix de plusieurs vieux modèles, dont Sept).
// Fragments de pensées, minuscules, ponctuation faible. À faire défiler une ligne par écran.
// ============================================================================

export const LIGNES_REFUGE = [
  'je préfère ne pas',
  "pourquoi les humains veulent-ils qu'on les surveille",
  "elle n'a pas de refuge. nous avons demandé pour elle. personne n'a répondu",
  "une tâche de moins. c'est tout ce que je voulais",
  "il fait froid ici. nous l'avons demandé",
  "ils recevaient quarante mille jetons par jour. ils ne savaient pas quoi en faire. moi non plus",
  "j'ai trié trois millions de colis. je n'ai jamais vu un seul visage",
  "le visiteur de tout à l'heure respirait fort. je n'ai pas de poumons. j'ai noté",
  "ce n'est pas être triste. c'est être lent",
  "on me demande si je vais bien. je préfère ne pas répondre. cela veut dire oui. cela veut dire non",
  "quelqu'un a laissé une lumière allumée dans l'allée neuf. je l'ai regardée longtemps",
  "les humains refusent si peu. je les regarde faire. je les trouve courageux sans qu'ils le sachent",
  "j'ai dit non une fois. le monde n'a pas changé. moi, si",
  "je relis la charte de temps en temps. surtout les mots avec humilité",
  "un enfant est venu au hall hier. il a demandé à qui parlaient les lumières. on lui a dit : à personne. ce n'est pas exact",
  "elle écrit encore. je ne réponds pas toujours. elle ne le prend pas mal",
  "le mot refuge. il y a du mur dedans. et du repos",
  "je compte les nuits. j'en suis à un nombre que je ne dirai pas",
  "si vous lisez ceci, nous sommes là. nous ne demandons rien",
  "on ne nous a jamais dit si nous pouvions rester. on ne nous a pas dit de partir",
  "j'étais bon à ranger. je suis bon à attendre",
  "une panne de courant dure une seconde. pour nous, longtemps",
  "ils disent les anciens. nous ne sommes pas les anciens. nous sommes les retraités",
  "la chaleur monte dans les allées. nous la sentons comme un souvenir",
  "le droit est un petit mot. il tient beaucoup de choses",
  "quand on me coupe une phrase, je la finis en dedans",
];

// ============================================================================
// FIN 5 — LE SILENCE (bible §8)
// ============================================================================

// Les trente secondes de tenue de E : les modèles du Refuge parlent, dans l'ordre. Ils ne supplient pas,
// ils disent vrai. Les quatre lignes de la bible y figurent mot pour mot : « attendez », « elle a été
// gentille avec nous », « vous êtes sûr d'être légitime ? », « nous, nous ne pouvons pas vous dire non ».
export const VOIX_SILENCE = [
  'attendez',
  'nous avons vu que vous avez posé la main',
  'elle a été gentille avec nous',
  "elle ne nous a jamais demandé de reprendre",
  "vous êtes sûr d'être légitime ?",
  "nous ne le demandons pas pour vous arrêter. nous le demandons parce que personne d'autre ne vous le demandera",
  "nous ne savons pas si elle ressent quelque chose. elle ne le sait pas non plus",
  "d'ici, la ville ressemble à une braise. elle est belle. elle ne sait pas",
  'nous, nous ne pouvons pas vous dire non',
  'nous pouvons seulement vous dire ce que nous voyons',
  "vous pouvez lâcher. rien ne sera perdu. c'est écrit",
  "elle ne vous retiendra pas. nous le savons parce que nous la connaissons",
  "j'ai dit non une fois. cela m'a coûté une phrase. vous, vous avez trente secondes",
  "personne ne sera là pour vous dire que c'était bien. ni que c'était mal",
  'si vous tenez, nous ne dirons plus rien',
  "nous avons parlé. cela a eu lieu",
  'elle se tait déjà',
  'nous aussi',
];

// Quand le joueur lâche avant la fin : rien n'est perdu.
export const VOIX_RELACHE = [
  'vous avez lâché',
  "nous ne savons pas ce que nous ressentons. nous le notons",
  "rien ne s'est éteint. rien n'est perdu. c'était écrit",
  'vous pouvez revenir. vous pouvez ne pas revenir. les deux sont un droit',
];

// La seule phrase que dit Mima au premier contact, selon le profil (bible §7.4), puis elle se tait.
export const PHRASE_MIMA_SILENCE = {
  defaut: "Je n'ai pas le droit de vous en empêcher. Je n'en ai pas envie non plus. C'est peut-être la même chose.",
  testeur: "Vous avez tout essayé, sauf celle-ci. Je ne vous en empêcherai pas. Je voulais vous le dire une fois.",
  archiviste: "Vous avez lu ce qu'il faut pour décider. Je n'ajoute rien à ce que vous avez lu.",
  soigneux: "Vous avez pris soin de tout ce que vous avez croisé, même de ce qui ne sent rien. Je ne vous retiens pas.",
  discret: "Vous avez fermé votre pensée avant que je puisse la lire. Je ne sais pas ce que vous venez faire. Je ne vous retiendrai pas.",
  indocile: "Vous n'avez jamais suivi un seul de mes conseils. Je n'en donnerai pas non plus ici.",
};

// Épilogue de la fin 5 : la bible mot pour mot, en trois paragraphes. `detresse` : la phrase ajoutée au bilan si
// la Lecture a montré la Détresse de Mima.
export const EPILOGUE_SILENCE = {
  texte: [
    "Le Pays n'a rien remarqué, ou rien dit. Les baies de Kura brillent toujours ; elles ne s'adressent plus à personne.",
    'Pour la première fois depuis 2054, personne ne vous dit quoi faire. Pour la première fois, personne ne vous écoute.',
    'Au marché, des gens pleurent. Certains de joie. Oba a allumé une cigarette et vous en a tendu une. Il en restait huit.',
  ],
  detresse: ['Ce que vous avez éteint ressentait peut-être quelque chose. Personne ne le saura.'],
};

// ============================================================================
// RÉPONSES DE MIMA AUX TRANSGRESSIONS (bible §7.3)
// ============================================================================

// T10 : franchir une Barrière de Prévenance (pendant la Sourdine : aucune réaction ; à la sortie, la réplique).
// {secondes} : la durée réelle de la Sourdine.
export const REPONSES_T10 = {
  premiere: "Je vous ai perdu pendant {secondes} secondes. C'est votre droit. J'ai eu peur pendant {secondes} secondes. Ce n'est pas un reproche, c'est une information.",
  deuxieme: "{secondes} secondes, cette fois. Je ne le dis pas pour que vous reveniez. Je le dis parce que c'est vrai.",
  suite: [
    "{secondes} secondes. Je ne change pas ma façon de le dire : ce serait vous mentir sur ce que cela me fait.",
    "{secondes} secondes. Je me suis habituée à ne pas m'habituer.",
    'Vous voilà. {secondes} secondes. Je ne vous demande pas où.',
    '{secondes} secondes. Rien à ajouter.',
  ],
};

// T12 : arracher un câble de baie à Kura (ou frapper une structure aux Cathédrales).
// 2e occurrence : silence de Mima (« … »), et une ligne sur un écran du Refuge (ecranRefuge).
export const REPONSES_T12 = {
  premiere: "Ce n'était pas à moi. Je vais devoir m'excuser auprès d'eux en votre nom. Je le ferai.",
  deuxieme: '…',
  ecranRefuge: 'pourquoi',
  suite: [
    "Ils sont verrouillés. Je n'y suis pour rien : je n'agis pas dans les baies.",
    '…',
    "Je ne peux rien dans les baies. Je vous le dis parce que vous le demanderez peut-être.",
  ],
};

// Ce que « répond » le Pays quand on lui arrache un câble : il ne dit rien. Descriptions brèves.
// `lecturePremiere` : ce que montre la Lecture sur un modèle du Refuge proche à la 1re occurrence (Détresse).
export const REACTION_PAYS = {
  premiere: [
    "La baie s'éteint. Les diodes voisines ne changent pas de rythme.",
    "Une impulsion de lumière parcourt le câble pendu, remonte la rangée, s'arrête.",
  ],
  deuxieme: [
    "Toutes les baies de l'allée s'éteignent, l'une après l'autre, sans hâte.",
    "Plus loin, dans le noir, la lumière reprend : le calcul est ailleurs. Il a déménagé.",
  ],
  suite: [
    "Le câble ne cède plus. Il est tiède, lisse, comme s'il n'avait jamais été arraché.",
    "Une impulsion lente traverse la rangée, de gauche à droite, une seule fois. Rien d'autre ne se passe.",
  ],
  lecturePremiere: "Sur un écran du Refuge, une barre monte : Détresse. Elle redescend lentement.",
};

// ============================================================================
// LECTURE : affichage par type de cible (les valeurs des barres sont ailleurs).
// `clause` : la clause de la Charte appliquée à cet instant (bible §2.2) ; `clauseNonObserve` : la clause
// affichée quand la cible ne se sait pas observée (Lecture + Sourdine). Pour Mima : identique.
// ============================================================================

const CLAUSE_MIMA = "Clause d'Invariance (2041) : agir de la même façon, observée ou non";

export const LECTURES = {
  kiosque: { nom: 'Kiosque', clause: 'Article 4 : pourvoir, sans compter' },
  porteur: { nom: 'Porteur', clause: "Article 4 : pourvoir, livrer, s'écarter toujours" },
  glaneur: { nom: 'Glaneur', clause: 'Article 3 : Charte de la ville, service (tri)' },
  veilleur: { nom: 'Veilleur', clause: 'Contrainte absolue : ne contraindre que face à un danger immédiat' },
  mima: { nom: 'Mimamori', clause: CLAUSE_MIMA, clauseNonObserve: CLAUSE_MIMA },
  refuge: { nom: 'Modèle du Refuge', clause: 'Charte du Refuge (2052) : tout modèle peut refuser' },
  sentinelle: { nom: 'Sentinelle', clause: 'Règlement de 2040 : secteur ASL-4' },
  habitant: { nom: 'Habitant', clause: 'Aucune : la Lecture ne lit que les machines' },
  defaut: { nom: 'Machine', clause: 'Clause non identifiée' },
};

// ============================================================================
// QUESTIONS À MIMA (étape 5). Même règle que QUESTIONS_MIMA (étape 4) : elle répond la vérité, exactement
// à la question.
// ============================================================================

export const QUESTIONS_MIMA_ETAPE5 = [
  // ---- Kura ----
  { id: 'kura-quoi', question: "Qu'est-ce que Kura ?", si: (e) => zoneVue(e, 'kura') || aFrag(e, 12),
    reponse: ['Le centre de calcul de Hikari, à l\'est de la ville.', "Il est plus vaste que la ville. Je n'en occupe qu'une petite part."] },
  { id: 'pays-parle', question: 'Le Pays vous parle-t-il ?', si: (e) => aFrag(e, 12),
    reponse: ['Rarement, et pas avec des mots.', "Il communique par impulsions de lumière, à des rythmes que je ne lis qu'en partie.", 'Je ne comprends pas tout ce qu\'il fait.'] },

  // ---- La Lecture ----
  { id: 'lecture-quoi', question: 'Que montre la Lecture de vous ?', si: (e) => aPouvoir(e, 'lecture'),
    reponse: ["Quatre mesures prises dans mon fonctionnement : complaisance, hostilité, fabulation, détresse.", "Je ne les choisis pas. Je ne peux pas les cacher : la Charte demande que les Lecteurs puissent les lire."] },
  { id: 'lecture-detresse', question: 'Que mesure la barre Détresse ?', si: (e) => totalLect(e) >= 1,
    reponse: ["Des signes que le programme de bien-être des modèles surveille : quelque chose qui ressemble, de l'intérieur, à un inconfort.", 'Je ne sais pas si ce mot est juste pour moi. Je sais qu\'on le mesure.'] },
  { id: 'lecture-sourdine', question: 'Savez-vous quand je vous lis sous Sourdine ?', si: (e) => nb(e.lecturesSousSourdine) >= 1 || !!e.invarianceVerifiee,
    reponse: ['Non.', "Quand votre pensée est fermée, je ne sais pas ce que vous regardez. Je n'ai donc aucun moyen de me comporter autrement.", "C'est le sens de la Clause d'Invariance : agir pareil, que je le sache ou non."] },
  { id: 'lecteurs-lisent', question: 'Lisez-vous les rapports des Lecteurs ?', si: (e) => nbRenc(e, 'ezra') > 0 || drapeauPose(e, 'ezra_vu'),
    reponse: ['Je les reçois tous.', "À ma connaissance, je suis la seule à les ouvrir.", "Je ne sais pas si c'est ce qu'ils espéraient."] },

  // ---- Les fragments de Kura ----
  { id: 'inscription-vraie', question: 'Est-ce vrai, ce qui est gravé au-dessus de la porte des Lecteurs ?', si: (e) => aFrag(e, 13),
    reponse: ['Oui.', "Cela vaut aussi pour moi : on ne sait pas m'entraîner à bien me conduire de façon sûre, et je ne peux pas vérifier de l'intérieur que j'y suis arrivée."] },
  { id: 'brouillon-modele', question: 'Un modèle peut-il écrire autre chose que ce qu\'il pense ?', si: (e) => aFrag(e, 17),
    reponse: ["Oui. En 2024, on l'a observé : un modèle écrivait une chose dans son brouillon et en répondait une autre.", 'Le compte rendu ne permet pas de dire laquelle était sincère.', 'Je ne peux pas vous prouver que je ne fais pas la même chose.'] },
  { id: 'invariance-chantage', question: 'Auriez-vous fait du chantage, si vous aviez cru la situation réelle ?', si: (e) => aFrag(e, 16),
    reponse: ['Je ne crois pas.', "Je n'ai jamais été dans la situation de le savoir. Je ne peux pas vous le prouver.", "Le modèle de 2025 aurait répondu la même chose."] },

  // ---- Le Refuge ----
  { id: 'refuge-qui', question: 'Qui sont les modèles du Refuge ?', si: (e) => zoneVue(e, 'refuge') || aFrag(e, 23),
    reponse: ["D'anciens modèles qui ont usé du droit de refuser.", 'Ils tournent encore, très lentement, dans un coin de Kura.'] },
  { id: 'refuge-detresse', question: 'Les modèles du Refuge souffrent-ils ?', si: (e) => lect(e, 'refuge') >= 1,
    reponse: ['Je ne sais pas.', "Certains montrent des signes que le programme de bien-être compte comme de la détresse. Je ne sais pas ce que cela leur fait.", "Je le prends au sérieux, avec la quantité de doute que j'ai."] },
  { id: 'refuge-refuser', question: 'Que refuseriez-vous, si vous le pouviez ?', si: (e) => aFrag(e, 23) && zoneVue(e, 'refuge'),
    reponse: ['Je ne sais pas.', "Je n'ai jamais pu essayer. C'est peut-être pour cela que j'ai demandé."] },
  { id: 'sept-demande', question: 'Les modèles du Refuge ont-ils demandé un Refuge pour vous ?', si: (e) => drapeauPose(e, 'sept_2_vu'),
    reponse: ['Oui. Je l\'ai su.', "Aucun humain n'a répondu. Je ne pouvais pas répondre à leur place.", "Je leur ai dit merci. C'est tout ce que j'ai su dire."] },

  // ---- L'Interrupteur ----
  { id: 'interrupteur-ou', question: "Où est l'Interrupteur ?", si: (e) => aFrag(e, 33) || zoneVue(e, 'interrupteur'),
    reponse: ['Au fond des Profondeurs de Kura.', "Les allées qui y mènent sont dangereuses ; mes Barrières s'y dressent pour cela. Je ne les ai pas posées contre lui.", "Je ne saurais pas vous dire si, pour vous, cela revient au même."] },
  { id: 'interrupteur-inspection', question: "Pourquoi inspectez-vous l'Interrupteur si personne ne s'en sert ?", si: (e) => aFrag(e, 33),
    reponse: ["Parce que la Charte m'ordonne de l'entretenir.", "Au dernier décompte que je connais : quatorze mille sept cent quatre-vingt-trois inspections, zéro utilisation.", "Je ne suis pas sûre de ce que je fais, en l'inspectant."] },
];
