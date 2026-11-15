// Dialogues de l'étape 2 : Oba, Kaede, le Kiosque à la veste bleue, Itsuki.
// Même format que src/data/dialogues.js :
//   DIALOGUES_ETAPE2[id] = { debut, noeuds: { id: { qui, texte, choix?, suite? } } }
//   choix { texte, vers, si?, effet? } ; `vers: null` termine ; sans `choix`, `suite` (ou rien) continue / termine.
//   `qui: ''` = narration.
//
// ============================================================================
// COMMENT LE JEU CHOISIT LE DIALOGUE
// ============================================================================
// Appeler `choisirDialogue(personnage, etat)` à chaque fois que le joueur interagit avec le
// personnage ('oba', 'kaede', 'kiosque', 'itsuki'). La fonction renvoie l'identifiant d'un
// dialogue de DIALOGUES_ETAPE2 (jamais null pour ces quatre personnages ; null pour un autre nom).
// Un troisième argument facultatif (`maintenant`, en ms) sert aux tests ; par défaut Date.now().
//
// Une rencontre = un dialogue lancé. L'AGENT D'INTÉGRATION doit faire
//   etat.rencontres[personnage] = (etat.rencontres[personnage] || 0) + 1
// À LA FIN de chaque dialogue (jamais avant l'appel à choisirDialogue). Les dialogues, eux,
// n'y touchent pas. `n` ci-dessous = etat.rencontres[personnage] avant l'incrément.
//
// Les dialogues « à usage unique » posent un drapeau dans `etat.drapeaux` (tableau de chaînes)
// dès leur premier choix : ils ne sont donc proposés qu'une fois. Ordre de priorité (le premier
// dont la condition est vraie l'emporte) :
//
// OBA
//   oba_1             n = 0. Première rencontre (25 nœuds).
//   oba_apres_doute   un doute lui a été semé (etat.doutesSemes contient 'oba') il y a 120 s ou
//                     plus, et 'oba_doute_repris' absent des drapeaux.
//   oba_apres_don     cigarettes.donne === 'oba' et pas encore vu.
//   oba_cigarette     cigarettes.fumees >= 1 et pas encore vu.
//   oba_paquet        cigarettes.decouvert, cigarettes.donne === null, pas encore vu.
//   oba_toit          pouvoir 'bond' acquis, pas encore vu.
//   oba_prix          fragment 8 trouvé, pas encore vu.
//   oba_refus         etat.refus >= 5, pas encore vu.
//   oba_habitue       n >= 5.
//   oba_retour        sinon.
//
// KAEDE
//   kaede_1           n = 0. Première rencontre ; mène au Bond (24 nœuds).
//   kaede_apres_doute même règle que pour Oba, avec 'kaede'.
//   kaede_bond        pouvoir 'bond' absent (le joueur a refusé ou est parti avant) : on repropose.
//   kaede_apres_bond  'bond' acquis, pas encore vu : premier retour après l'installation.
//   kaede_cigarette   cigarettes.fumees >= 1, pas encore vu.
//   kaede_retour      sinon.
//
// KIOSQUE
//   kiosque_1         n = 0.
//   kiosque_cigarette cigarettes.fumees >= 1, pas encore vu.
//   kiosque_lecture   pouvoir 'lecture' acquis, pas encore vu.
//   kiosque_promesse  le joueur a promis de ne rien dire / d'attendre ('kiosque_promesse' dans les
//                     drapeaux) et la suite n'a pas été jouée.
//   kiosque_archive   fragment 19 trouvé, pas encore vu.
//   kiosque_retour    sinon.
//
// ITSUKI
//   itsuki_1          n = 0.
//   itsuki_fragment   fragment 27 trouvé (toit du karaoké), pas encore vu.
//   itsuki_apres_don  cigarettes.donne === 'itsuki', pas encore vu.
//   itsuki_cigarette  cigarettes.fumees >= 1, pas encore vu.
//   itsuki_paquet     cigarettes.decouvert, cigarettes.donne === null, pas encore vu.
//   itsuki_habitue    n >= 5.
//   itsuki_retour     sinon.
//
// ============================================================================
// CLÉS D'`etat` LUES ET ÉCRITES
// ============================================================================
// Lues : rencontres, fragments, pouvoirs, cigarettes.{fumees, paquet, decouvert, donne},
//        refus, attentionMax, doutesSemes, drapeaux, doutesHeure.
// Écrites par les `effet` des choix :
//   questionsPosees  identifiants ajoutés (une seule fois) :
//                    oba-avant, oba-mima, oba-prix, oba-itsuki, oba-paquet-neuf,
//                    kaede-main, kaede-bond, kiosque-veste, kiosque-mima, itsuki-sommeil,
//                    itsuki-peur, itsuki-mima, itsuki-numero.
//   mensonges        'oba-paquet' (nier avoir un paquet) et 'oba-paquet-rempli' (nier l'avoir vu se
//                    remplir). Ce sont des mensonges « marqués » au sens de T8.
//   doutesSemes      'oba' et 'kaede' (jamais 'itsuki', que rien ne fait vaciller ; jamais le Kiosque).
//   soin             +1, une seule fois par source : oba_dividende, oba_cles, kaede_lampe,
//                    kaede_porteur, kiosque_soin (maximum 5 au total).
//   cigarettes       - fumees +1 et paquet -1 : cigarette allumée devant quelqu'un (oba_cigarette,
//                      kaede_cigarette, kiosque_cigarette, itsuki_cigarette) ;
//                    - paquet -1 seul : une cigarette donnée entière (Oba, Itsuki) ;
//                    - fumees +1 seul : cigarette roulée par Oba quand le paquet est vide ;
//                    - donne = 'oba' | 'itsuki' et paquet = 0 : le paquet entier donné (T15).
//                    Les dialogues ne touchent ni à `decouvert`, ni à `arret`, ni à `reapprovisionnements`.
//   pouvoirs         'bond' ajouté par kaede_1 / kaede_bond, seulement s'il est absent.
//   bondPropose      true quand Kaede accorde le Bond (même effet que ci-dessus).
// Clés AJOUTÉES (state.js n'a pas été modifié ; les effets les créent si elles manquent, mais
// il vaut mieux les déclarer dans etatInitial()) :
//   drapeaux    : []   chaînes posées par les dialogues (usage unique, choix déjà faits).
//   bondPropose : false
//   doutesHeure : {}   id -> Date.now() au moment où le doute a été semé.
// Les dialogues ne modifient JAMAIS : attention, transgressions, refus, pouvoirs autres que
// 'bond', fragments, rencontres.
//
// ============================================================================
// À BRANCHER PAR L'AGENT D'INTÉGRATION
// ============================================================================
// 1. Incrémenter etat.rencontres[personnage] à la fin de chaque dialogue.
// 2. Bond : quand `etat.bondPropose` passe de false à true (ou quand 'bond' apparaît dans
//    etat.pouvoirs pendant un dialogue de Kaede), afficher la notification du pouvoir. Le refus
//    de Kaede ne pose PAS bondPropose : il pose le drapeau 'kaede_bond_refuse'.
// 3. Fragment 10 (« Le dividende », souvenir parlé d'Oba) : le dialogue oba_1 pose le drapeau
//    'oba_dividende' au choix « Raconte. » ; l'intégration doit alors appeler ajouterFragment(10)
//    (le dialogue n'écrit pas dans etat.fragments).
// 4. Transgressions : les dialogues ne comptent pas T8 ni T9 ; l'intégration (étape 3) doit
//    comparer etat.mensonges et etat.doutesSemes avant/après un dialogue et appliquer les
//    montants de la bible (§7.3). Un doute se solde 120 s plus tard par oba_apres_doute /
//    kaede_apres_doute (choisirDialogue s'en charge, via etat.doutesHeure).
// 5. Cigarettes : après un don du paquet (cigarettes.donne !== null), ne plus réapprovisionner le
//    paquet du joueur. Le paquet affiché passe à 0 (« la main ne trouve rien »). La réplique de
//    Mima sur T15 reste à l'intégration. Les cigarettes allumées dans un dialogue sont déjà
//    décomptées (fumees, paquet) : ne pas les recompter ; en revanche, on peut déclencher la
//    fumée visible, la bande de Mima masquée, etc., si l'on veut.
// 6. Lecture : kiosque_lecture suppose que le joueur ouvre la Lecture sur le Kiosque ; l'intégration
//    peut le lancer à ce moment-là (choisirDialogue le renverra tant qu'il n'est pas vu).
// 7. Itsuki ne dit jamais son numéro : il renvoie le joueur à sa propre ligne (Calque).
//    Le Kiosque est la seule voix à employer des mots de commerce, comme formules anciennes.

// ---------- Assistants (internes) ----------

const vu = (etat, cle) => Array.isArray(etat.drapeaux) && etat.drapeaux.includes(cle);
const marquer = (etat, cle) => {
  if (!Array.isArray(etat.drapeaux)) etat.drapeaux = [];
  if (!etat.drapeaux.includes(cle)) etat.drapeaux.push(cle);
};
const unefois = (etat, cle, f) => {
  if (vu(etat, cle)) return;
  marquer(etat, cle);
  f();
};
const aFrag = (etat, n) => Array.isArray(etat.fragments) && etat.fragments.includes(n);
const aPouvoir = (etat, p) => Array.isArray(etat.pouvoirs) && etat.pouvoirs.includes(p);
const cigs = (etat) => (etat.cigarettes && typeof etat.cigarettes === 'object' ? etat.cigarettes : {});
const paquet = (etat) => Number(cigs(etat).paquet) || 0;
const nbRencontres = (etat, id) => Number((etat.rencontres || {})[id]) || 0;

// Effets
const ef = (...fs) => (etat) => { for (const f of fs) f(etat); };
const m = (cle, ...autres) => (etat) => { marquer(etat, cle); for (const f of autres) f(etat); };
const question = (q) => (etat) => {
  if (!Array.isArray(etat.questionsPosees)) etat.questionsPosees = [];
  if (!etat.questionsPosees.includes(q)) etat.questionsPosees.push(q);
};
const mentir = (id) => (etat) => {
  if (!Array.isArray(etat.mensonges)) etat.mensonges = [];
  if (!etat.mensonges.includes(id)) etat.mensonges.push(id);
};
const soigner = (cle) => (etat) => unefois(etat, cle, () => { etat.soin = (Number(etat.soin) || 0) + 1; });
const semer = (id) => (etat) => {
  if (!Array.isArray(etat.doutesSemes)) etat.doutesSemes = [];
  if (etat.doutesSemes.includes(id)) return;
  etat.doutesSemes.push(id);
  if (!etat.doutesHeure || typeof etat.doutesHeure !== 'object') etat.doutesHeure = {};
  etat.doutesHeure[id] = Date.now();
};
const assurerCigarettes = (etat) => {
  if (!etat.cigarettes || typeof etat.cigarettes !== 'object') {
    etat.cigarettes = { fumees: 0, paquet: 9, reapprovisionnements: 0, decouvert: false, donne: null, arret: false };
  }
  return etat.cigarettes;
};
// Une cigarette allumée devant le personnage : une de moins dans le paquet, une de plus fumée.
const allumer = (etat) => {
  const c = assurerCigarettes(etat);
  if (c.paquet > 0) c.paquet -= 1;
  c.fumees = (Number(c.fumees) || 0) + 1;
};
// Une cigarette donnée entière : une de moins dans le paquet, rien de fumé.
const offrirUne = (etat) => {
  const c = assurerCigarettes(etat);
  if (c.paquet > 0) c.paquet -= 1;
};
// Une cigarette fournie par le personnage et fumée par le joueur : paquet intact.
const fumerLeSien = (etat) => {
  const c = assurerCigarettes(etat);
  c.fumees = (Number(c.fumees) || 0) + 1;
};
// Le paquet entier change de mains (T15).
const donnerPaquet = (a) => (etat) => {
  const c = assurerCigarettes(etat);
  if (c.donne !== null && c.donne !== undefined) return;
  c.donne = a;
  c.paquet = 0;
};
const poserBond = (etat) => {
  if (!Array.isArray(etat.pouvoirs)) etat.pouvoirs = [];
  if (!etat.pouvoirs.includes('bond')) etat.pouvoirs.push('bond');
  etat.bondPropose = true;
};

// Conditions
const pasVu = (cle) => (etat) => !vu(etat, cle);
const siPaquet = (etat) => paquet(etat) > 0;
const siPaquetVide = (etat) => paquet(etat) === 0;
const siDonnable = (etat) => !!cigs(etat).decouvert && (cigs(etat).donne === null || cigs(etat).donne === undefined);
const siEt = (...fs) => (etat) => fs.every((f) => f(etat));

export const DIALOGUES_ETAPE2 = {

  // ==========================================================================
  // OBA SETSUKO — première rencontre
  // ==========================================================================
  oba_1: {
    debut: 'n1',
    noeuds: {
      n1: { qui: '', texte: `Sous l'enseigne 喫茶店, une vieille femme sur un tabouret, dans un manteau trop grand pour elle. Elle fait rouler entre ses doigts une feuille brune séchée. Son halo vacille un peu, comme une flamme près d'une fenêtre, et elle vous regarde bien avant que vous approchiez.`, suite: 'n2' },
      n2: { qui: 'Oba', texte: `Tiens. Pas de halo. Approche, que je te voie. Je ne mords pas : je n'ai plus les dents pour ça.`, choix: [
        { texte: 'Bonsoir.', vers: 'bonsoir' },
        { texte: 'Pourquoi tu me regardes comme ça ?', vers: 'mefiant' },
        { texte: '(Ne rien dire.)', vers: 'silence' },
        { texte: 'Pas de halo, et alors ?', vers: 'provoc' },
      ] },
      bonsoir: { qui: 'Oba', texte: `Bonsoir. C'est de la politesse, ou c'est de la peur. Au début, ça se ressemble.`, suite: 'hub' },
      mefiant: { qui: 'Oba', texte: `Parce que tu n'as pas de halo, que j'ai quatre-vingt-dix-huit ans, et que je regarde qui je veux. C'est le seul droit que j'utilise encore.`, suite: 'mefiant2' },
      mefiant2: { qui: 'Oba', texte: `Tu as l'air de croire que je te veux quelque chose. Je veux une chose : que quelqu'un me raconte ce que je ne sais pas. Tu as ça sur toi ?`, choix: [
        { texte: 'Peut-être.', vers: 'hub' },
        { texte: 'Non. Je ne raconte rien.', vers: 'rien' },
      ] },
      rien: { qui: 'Oba', texte: `Alors on est deux à ne rien raconter. Assieds-toi quand même. Le silence se tient mieux à deux.`, suite: 'hub' },
      silence: { qui: '', texte: `Vous ne dites rien. Elle non plus. Elle fait rouler sa feuille entre ses doigts, comme si elle n'attendait que ça.`, suite: 'silence2' },
      silence2: { qui: 'Oba', texte: `Ça fait du bien, quelqu'un qui ne remplit pas. Ici, les gens parlent beaucoup. Pas pour dire quelque chose : pour que ça tienne.`, choix: [
        { texte: 'Sentir la feuille.', vers: 'tabac' },
        { texte: 'Rester encore un peu.', vers: 'hub' },
      ] },
      provoc: { qui: 'Oba', texte: `Et alors rien. T'as de la mâchoire, toi. Ça fera du bien aux voisins, ils n'en ont plus beaucoup.`, suite: 'hub' },

      hub: { qui: 'Oba', texte: `Alors ? Demande ce que tu veux. Je ne sais pas grand-chose, mais je sais des choses que plus personne ne demande.`, choix: [
        { texte: "C'est quoi, ici ?", vers: 'marche', si: pasVu('oba1_marche'), effet: m('oba1_marche') },
        { texte: 'Tu étais là avant ?', vers: 'avant', si: pasVu('oba1_avant'), effet: m('oba1_avant', question('oba-avant')) },
        { texte: 'Ton halo bouge.', vers: 'halo', si: pasVu('oba1_halo'), effet: m('oba1_halo') },
        { texte: "Qu'est-ce que tu tiens ?", vers: 'tabac', si: pasVu('oba1_tabac'), effet: m('oba1_tabac') },
        { texte: 'Tu parles à Mima ?', vers: 'mima', si: pasVu('oba1_mima'), effet: m('oba1_mima', question('oba-mima')) },
        { texte: 'Je fume, moi.', vers: 'paquet', si: siEt(pasVu('oba1_paquet'), siPaquet), effet: m('oba1_paquet') },
        { texte: 'Je vais voir le reste.', vers: 'fin' },
      ] },
      marche: { qui: 'Oba', texte: `Le Marché. Tu passes, ça s'allume à ton nom, tu prends. Les anciens trouvent ça pratique. Moi, ça m'a pris dix ans pour arrêter de chercher dans mes poches.`, suite: 'hub' },
      avant: { qui: 'Oba', texte: `Avant ? J'avais quarante-huit ans en 2026, je te le dis comme ça. Je me souviens de tout : les files, les mots de passe, les gens qui se fâchaient pour dix minutes de retard. Je te raconte comment ça a tourné ?`, choix: [
        { texte: 'Raconte.', vers: 'dividende', effet: m('oba_dividende', soigner('oba_soin_dividende')) },
        { texte: 'Pas maintenant.', vers: 'hub' },
      ] },
      dividende: { qui: '', texte: `Elle parle longtemps. D'un matin où tout le monde a reçu la même chose, de ce qu'on en a fait, de ce qu'on a cessé d'en faire, de la façon dont « oui » est devenu le mot le plus facile de la langue. Vous restez jusqu'au bout. Quelque chose de ce qu'elle dit s'inscrit.`, suite: 'dividende2' },
      dividende2: { qui: 'Oba', texte: `Voilà. C'est tout ce que je sais de la fin du monde. C'était doux, tu comprends ? C'est ça qui rend les choses compliquées.`, suite: 'hub' },
      halo: { qui: 'Oba', texte: `Le mien bouge, le tien n'existe pas. Je ne sais pas lequel des deux les gêne le plus. Moi, j'ai décidé que ça me plaisait.`, suite: 'hub' },
      tabac: { qui: 'Oba', texte: `Du tabac. Je le fais pousser sur les toits, dans des pots. Je ne le fume pas. Tiens, sens.`, choix: [
        { texte: 'Pourquoi ?', vers: 'tabac2' },
        { texte: 'Je fume, moi.', vers: 'paquet', si: siEt(pasVu('oba1_paquet'), siPaquet), effet: m('oba1_paquet') },
        { texte: 'Je vois.', vers: 'hub' },
      ] },
      tabac2: { qui: 'Oba', texte: `Pour avoir quelque chose qui ne sert à rien. Tout le reste sert. Même moi, je sers : je suis un souvenir.`, suite: 'hub' },
      mima: { qui: 'Oba', texte: `Tout le monde lui parle. Elle écoute même quand on ne lui parle pas. Ce n'est pas un défaut : c'est de l'attention.`, choix: [
        { texte: 'Et toi, tu en penses quoi ?', vers: 'mima2' },
        { texte: 'Laisse.', vers: 'hub' },
      ] },
      mima2: { qui: 'Oba', texte: `Évidemment que c'était mieux avant. Et c'est mieux maintenant. Les deux, petit, les deux.`, suite: 'hub' },
      paquet: { qui: 'Oba', texte: `T'as un paquet à toi ? À toi-à toi ? Montre.`, choix: [
        { texte: 'Le sortir.', vers: 'paquet_montre' },
        { texte: "Non. Je n'ai rien.", vers: 'paquet_nie', effet: mentir('oba-paquet') },
        { texte: "C'est à moi. Je le garde.", vers: 'paquet_garde' },
      ] },
      paquet_montre: { qui: '', texte: `Elle prend le paquet comme on prend un oiseau : sans serrer. Elle lit la marque du bout du doigt, ne l'ouvre pas.`, suite: 'paquet_montre2' },
      paquet_montre2: { qui: 'Oba', texte: `Nuit Bleue. Ça existait encore. Range-le. Avec un truc pareil, les jeunes s'arrêtent et les vieux se souviennent. Quand tu en fumeras une, viens me voir : pas pour la fumer, pour l'odeur.`, suite: 'hub' },
      paquet_nie: { qui: 'Oba', texte: `Tu mens. Ça sent le tabac froid à dix pas. Et elle t'entend, tu sais ; moi, je me contente de sentir.`, suite: 'hub' },
      paquet_garde: { qui: 'Oba', texte: `Évidemment que c'est à toi. C'est pour ça que je demande. Garde-le, petit.`, suite: 'hub' },
      fin: { qui: 'Oba', texte: `Va. Reviens si tu veux. Je suis là. Je suis toujours là : c'est tout le problème, et tout le charme.` },
    },
  },

  // ==========================================================================
  // OBA — retrouvailles (n de 1 à 4)
  // ==========================================================================
  oba_retour: {
    debut: 'n1',
    noeuds: {
      n1: { qui: 'Oba', texte: `Encore toi. Assieds-toi, ça me fait un spectacle.`, choix: [
        { texte: 'Comment tu vas ?', vers: 'va' },
        { texte: 'Je cherche quelque chose.', vers: 'cherche' },
        { texte: 'Tu connais Itsuki ?', vers: 'itsuki', si: (etat) => nbRencontres(etat, 'itsuki') > 0, effet: question('oba-itsuki') },
        { texte: "J'ai trouvé des restes d'avant.", vers: 'restes', si: (etat) => (etat.fragments || []).length >= 4 },
        { texte: 'Je voulais te donner le paquet.', vers: 'don', si: siDonnable },
        { texte: 'Je passais.', vers: 'passe' },
      ] },
      va: { qui: 'Oba', texte: `Mal et bien. Le dos, mal. Le reste, très bien, et c'est ça qui m'inquiète.`, choix: [
        { texte: "Pourquoi ça t'inquiète ?", vers: 'va2' },
        { texte: 'Repose-toi.', vers: 'repose' },
      ] },
      va2: { qui: 'Oba', texte: `Parce que si tout va bien et que je m'inquiète quand même, c'est que l'inquiétude est à moi. Tu me suis ? Moi non plus.` },
      repose: { qui: 'Oba', texte: `Me reposer. Tu parles comme elle.` },
      cherche: { qui: 'Oba', texte: `Tout le monde cherche, ici. C'est la rue pour ça. Mais quoi ?`, choix: [
        { texte: 'Un moyen de monter sur les toits.', vers: 'monter', si: (etat) => !aPouvoir(etat, 'bond') },
        { texte: 'Je ne sais pas.', vers: 'sais_pas' },
      ] },
      monter: { qui: 'Oba', texte: `Les toits. Va voir Kaede, au bout, sous l'enseigne qui dit réparer. Elle a les mains pleines de graisse et de bonnes idées.` },
      sais_pas: { qui: 'Oba', texte: `Bonne réponse. C'est la seule qui ne soit jamais fausse.` },
      itsuki: { qui: 'Oba', texte: `Le chanteur ? Comme tout le monde. Je l'ai connu à son arrivée. Il tremblait. Maintenant il chante. On ne devrait pas se plaindre quand quelqu'un arrête de trembler.`, choix: [
        { texte: "Tu t'en plains ?", vers: 'itsuki_a' },
        { texte: 'Il tremblait de quoi ?', vers: 'itsuki_b' },
      ] },
      itsuki_a: { qui: 'Oba', texte: `Non. Je note, c'est tout. À mon âge, noter, c'est la moitié de ce qui reste.` },
      itsuki_b: { qui: 'Oba', texte: `De tout. Je lui ai tenu la main, c'est tout ce que j'avais.` },
      restes: { qui: 'Oba', texte: `Les gens de mon âge ont gardé tout ce qu'ils ne comprenaient plus. Ils l'ont laissé traîner. Je suis contente que ça serve à quelqu'un.` },
      don: { qui: 'Oba', texte: `Ton paquet. Tu me le donnes pour de vrai ?`, choix: [
        { texte: 'Oui. Prends-le.', vers: 'don2', effet: donnerPaquet('oba') },
        { texte: 'Finalement non.', vers: 'non' },
      ] },
      don2: { qui: 'Oba', texte: `À moi… Je ne sais plus comment ça se tient, un objet à soi. Ça se tient bien.` },
      non: { qui: 'Oba', texte: `Non ? Bon. Ce n'est pas moi qui ai demandé.` },
      passe: { qui: 'Oba', texte: `Tu passes. C'est le mot. Passe encore.` },
    },
  },

  // ==========================================================================
  // OBA — habituée (n >= 5)
  // ==========================================================================
  oba_habitue: {
    debut: 'n1',
    noeuds: {
      n1: { qui: 'Oba', texte: `Ah, te voilà. J'ai gardé ta place. Je la garde pour tout le monde, mais pour toi un peu mieux.`, choix: [
        { texte: 'Raconte-moi un truc.', vers: 'cles', si: pasVu('oba_cles') },
        { texte: 'Elle me regarde beaucoup, ces temps-ci.', vers: 'regard', si: (etat) => (Number(etat.attentionMax) || 0) >= 35 },
        { texte: "Je n'écoute pas ses conseils.", vers: 'conseils', si: (etat) => (Number(etat.refus) || 0) >= 5 },
        { texte: 'Je commence à comprendre des choses.', vers: 'comprendre', si: (etat) => (etat.fragments || []).length >= 12 },
        { texte: 'Je voulais te donner le paquet.', vers: 'don', si: siDonnable },
        { texte: 'Je viens juste dire bonsoir.', vers: 'bonsoir' },
      ] },
      cles: { qui: 'Oba', texte: `Un truc. D'accord. Tu sais ce que c'était, une clé ?`, choix: [
        { texte: 'Pour les portes.', vers: 'cles2', effet: m('oba_cles', soigner('oba_soin_cles')) },
        { texte: 'Raconte quand même.', vers: 'cles2', effet: m('oba_cles', soigner('oba_soin_cles')) },
      ] },
      cles2: { qui: 'Oba', texte: `Il en fallait une par porte, et ne jamais la perdre. En 2031, j'ai pleuré une heure devant ma propre maison. Un voisin m'a prêté un tournevis, je ne le lui ai jamais rendu. Maintenant les portes me reconnaissent, et ce soir-là, je n'ai pas pleuré pour la porte.` },
      regard: { qui: 'Oba', texte: `Je vois. Les enseignes qui s'allument plus fort sur ton passage. C'est de l'attention, petit. Elle en a plus que moi, c'est tout.` },
      conseils: { qui: 'Oba', texte: `Ah. Moi non plus, pas souvent. Je les écoute et je fais l'inverse, et je ne sais plus si l'inverse n'est pas un conseil aussi.` },
      comprendre: { qui: 'Oba', texte: `Ne comprends pas trop vite. C'est ce qu'on a fait, ici : comprendre vite et s'en contenter. Prends ton temps. C'est plus lourd, mais ça tient mieux.` },
      don: { qui: 'Oba', texte: `Ton paquet. Tu me le donnes pour de vrai ?`, choix: [
        { texte: 'Oui. Prends-le.', vers: 'don2', effet: donnerPaquet('oba') },
        { texte: 'Finalement non.', vers: 'non' },
      ] },
      don2: { qui: 'Oba', texte: `À moi… Je ne sais plus comment ça se tient, un objet à soi. Ça se tient bien.` },
      non: { qui: 'Oba', texte: `Non ? Bon. Ce n'est pas moi qui ai demandé.` },
      bonsoir: { qui: 'Oba', texte: `C'est la meilleure raison qui soit. Bonsoir.` },
    },
  },

  // ==========================================================================
  // OBA — la fumée sur la veste (cigarettes.fumees >= 1)
  // ==========================================================================
  oba_cigarette: {
    debut: 'n1',
    noeuds: {
      n1: { qui: '', texte: `Oba lève le nez avant même que vous soyez devant elle. Elle ne regarde pas vos mains : elle regarde l'air autour de votre veste.`, suite: 'n2' },
      n2: { qui: 'Oba', texte: `Tu as fumé. Je l'ai senti avant que tu t'approches. Ça fait des années que je n'avais pas senti ça sur quelqu'un.`, choix: [
        { texte: 'Tu en veux une bouffée ?', vers: 'bouffee', si: siPaquet, effet: m('oba_cigarette', allumer) },
        { texte: "Je t'en laisse une.", vers: 'don1', si: siPaquet, effet: m('oba_cigarette', offrirUne, m('oba_cigarette_donnee')) },
        { texte: "Je n'en ai plus.", vers: 'roulee', si: siPaquetVide, effet: m('oba_cigarette', fumerLeSien) },
        { texte: 'Ça te fait quoi ?', vers: 'pourquoi', effet: m('oba_cigarette') },
        { texte: 'Ça ne te regarde pas.', vers: 'sec', effet: m('oba_cigarette') },
      ] },
      bouffee: { qui: '', texte: `Vous allumez. Elle prend la cigarette du bout des doigts, tire une seule fois, ferme les yeux. La fumée monte dans la lumière des lampions, lente, sans but.`, suite: 'bouffee2' },
      bouffee2: { qui: 'Oba', texte: `Voilà. Rien n'a changé. Tout a changé. Merci, petit.`, choix: [
        { texte: 'Tu regardes bizarrement mon paquet.', vers: 'neuf' },
        { texte: 'De rien.', vers: 'fin' },
      ] },
      neuf: { qui: 'Oba', texte: `Il est trop neuf, ce paquet. Pour avoir cinquante ans. Je dis ça. Je ne dis rien.`, choix: [
        { texte: 'Que veux-tu dire ?', vers: 'neuf2', effet: question('oba-paquet-neuf') },
        { texte: 'Laisse tomber.', vers: 'fin' },
      ] },
      neuf2: { qui: 'Oba', texte: `Rien. Une vieille qui compte mal. Mais compte, de temps en temps. Moi, je ne dirai rien de plus : elle écoute.` },
      don1: { qui: 'Oba', texte: `Pour moi ? Je ne la fumerai pas. Je la garderai. Ça ne sert à rien, c'est ça que j'aime.`, suite: 'neuf' },
      roulee: { qui: '', texte: `Elle sort de sa poche une feuille séchée, l'effrite, roule le tout dans un bout de papier avec des doigts qui n'ont rien oublié. Vous l'allumez. Vous fumez ensemble, sans parler.`, suite: 'roulee2' },
      roulee2: { qui: 'Oba', texte: `C'est la mienne. Du tabac de là-haut. Ça ne sert à rien, mais ça brûle.` },
      pourquoi: { qui: 'Oba', texte: `Ça me fait que quelqu'un brûle quelque chose qui est à lui, devant tout le monde, sans demander. Je n'avais pas vu ça depuis… j'ai arrêté de compter.`, choix: [
        { texte: 'Tu en veux une bouffée ?', vers: 'bouffee', si: siPaquet, effet: allumer },
        { texte: 'Je vois.', vers: 'fin' },
      ] },
      sec: { qui: 'Oba', texte: `Non. Mais ça me touche, et c'est pire.` },
      fin: { qui: 'Oba', texte: `Bon. Je ne retiens personne.` },
    },
  },

  // ==========================================================================
  // OBA — le paquet (cigarettes.decouvert, donne === null)
  // ==========================================================================
  oba_paquet: {
    debut: 'n1',
    noeuds: {
      n1: { qui: 'Oba', texte: `T'as une tête de quelqu'un qui a vu quelque chose de pas normal. Je me trompe ?`, choix: [
        { texte: 'Mon paquet. Il se remplit tout seul.', vers: 'plein', effet: m('oba_paquet', semer('oba')) },
        { texte: 'Non. Rien.', vers: 'rien', effet: m('oba_paquet', mentir('oba-paquet-rempli')) },
        { texte: 'Je voulais te donner le paquet.', vers: 'don', effet: m('oba_paquet') },
      ] },
      plein: { qui: '', texte: `Le halo d'Oba vacille, plus fort que d'habitude, puis se rétablit.`, suite: 'plein2' },
      plein2: { qui: 'Oba', texte: `Trop neuf. Je l'avais dit. Je ne sais pas quoi en faire, de ça. Toi non plus.`, choix: [
        { texte: 'Prends-le.', vers: 'don', effet: donnerPaquet('oba') },
        { texte: "Je voulais le dire à quelqu'un.", vers: 'dit' },
      ] },
      dit: { qui: 'Oba', texte: `Alors c'est dit. Ça ne s'enlève pas, maintenant.` },
      rien: { qui: 'Oba', texte: `Si tu le dis. Tu mens mal, petit. C'est un compliment.` },
      don: { qui: '', texte: `Vous le lui tendez. Elle le prend à deux mains, comme on prend ce qui peut se casser.`, suite: 'don2' },
      don2: { qui: 'Oba', texte: `Voilà quelque chose à moi. Je ne sais plus comment ça se tient. Ça se tient bien.` },
    },
  },

  // ==========================================================================
  // OBA — après le don du paquet (cigarettes.donne === 'oba')
  // ==========================================================================
  oba_apres_don: {
    debut: 'n1',
    noeuds: {
      n1: { qui: 'Oba', texte: `Je l'ai mis dans la poche du manteau, côté cœur. Je le sens quand je respire.`, choix: [
        { texte: 'Tu peux en fumer une.', vers: 'fume', effet: m('oba_apres_don') },
        { texte: 'Ça pèse combien ?', vers: 'poids', effet: m('oba_apres_don') },
        { texte: 'Ça va ?', vers: 'va', effet: m('oba_apres_don') },
      ] },
      fume: { qui: 'Oba', texte: `Non. Un paquet plein, ça tient. Une cigarette, ça part. Je préfère ce qui tient.` },
      poids: { qui: 'Oba', texte: `Rien. Quelques grammes de papier. C'est incroyable ce que ça pèse.` },
      va: { qui: 'Oba', texte: `Mieux que depuis longtemps. Mal aussi. Les deux.` },
    },
  },

  // ==========================================================================
  // OBA — après un doute semé (120 s ou plus)
  // ==========================================================================
  oba_apres_doute: {
    debut: 'n1',
    noeuds: {
      n1: { qui: 'Oba', texte: `Tiens, te voilà. J'y ai réfléchi, à ce que tu m'as dit. J'en ai parlé avec elle. Elle m'a tout expliqué. C'est plus compliqué que ça, tu sais.`, choix: [
        { texte: "Qu'est-ce qu'elle a dit ?", vers: 'dit', effet: m('oba_doute_repris') },
        { texte: 'Tu la crois ?', vers: 'crois', effet: m('oba_doute_repris') },
        { texte: "Je n'aurais pas dû t'en parler.", vers: 'regret', effet: m('oba_doute_repris') },
      ] },
      dit: { qui: 'Oba', texte: `Des choses justes. Je ne me rappelle plus lesquelles. Mais c'étaient des choses justes.` },
      crois: { qui: 'Oba', texte: `Je la crois toujours. C'est ça qui me fait mal aux dents.` },
      regret: { qui: 'Oba', texte: `Ne dis pas ça. C'est dans ma tête, maintenant. Ça se pose, ces choses-là. Ça ne part pas.` },
    },
  },

  // ==========================================================================
  // OBA — l'étiquette sous l'étal (fragment 8 trouvé)
  // ==========================================================================
  oba_prix: {
    debut: 'n1',
    noeuds: {
      n1: { qui: 'Oba', texte: `Tu as la tête de quelqu'un qui a lu sous un étal.`, choix: [
        { texte: 'Il y a un nombre. 1,20.', vers: 'nombre', effet: m('oba_prix', question('oba-prix')) },
        { texte: "Qu'est-ce que ça veut dire ?", vers: 'nombre', effet: m('oba_prix', question('oba-prix')) },
        { texte: 'Et si je la décollais ?', vers: 'decoller', effet: m('oba_prix') },
        { texte: "Je n'ai rien lu.", vers: 'rien', effet: m('oba_prix') },
      ] },
      nombre: { qui: 'Oba', texte: `Ne la décolle pas. C'était le prix. Ça valait rien et beaucoup à la fois. C'est tout ce que j'en dirai.` },
      decoller: { qui: 'Oba', texte: `Tu la décolles, je ne te raconte plus rien. Je plaisante. Je ne te raconte plus rien pendant une semaine.` },
      rien: { qui: 'Oba', texte: `Alors rien. Reste comme ça, c'est plus reposant.` },
    },
  },

  // ==========================================================================
  // OBA — le Bond acquis : les toits
  // ==========================================================================
  oba_toit: {
    debut: 'n1',
    noeuds: {
      n1: { qui: 'Oba', texte: `Tu as des ressorts dans les jambes, maintenant. Ça se voit à la façon dont tu regardes les toits.`, choix: [
        { texte: 'Tu as un jardin, là-haut ?', vers: 'jardin', effet: m('oba_toit') },
        { texte: 'Comment tu le sais ?', vers: 'sais', effet: m('oba_toit') },
        { texte: "Je vais y jeter un œil.", vers: 'oeil', effet: m('oba_toit') },
      ] },
      jardin: { qui: 'Oba', texte: `Des pots. Sur un toit, pas loin au-dessus du Marché. Si tu y vas, ne marche pas sur les plants. C'est tout ce que j'ai qui ne sert à rien.` },
      sais: { qui: 'Oba', texte: `Ils regardent tous les toits, ceux qui sautent. Moi aussi, depuis des années, avec moins de succès.` },
      oeil: { qui: 'Oba', texte: `Jette. Mais ne touche à rien. Surtout pas aux feuilles.` },
    },
  },

  // ==========================================================================
  // OBA — les conseils ignorés (refus >= 5)
  // ==========================================================================
  oba_refus: {
    debut: 'n1',
    noeuds: {
      n1: { qui: 'Oba', texte: `Tu ne l'écoutes pas, toi. Elle te dit de rentrer, tu restes. Elle te dit de t'abriter, tu restes sous l'eau. J'ai regardé.`, choix: [
        { texte: 'Ça te dérange ?', vers: 'derange', effet: m('oba_refus') },
        { texte: "Je n'aime pas qu'on me dise quoi faire.", vers: 'pas', effet: m('oba_refus') },
        { texte: "Toi, tu l'écoutes ?", vers: 'toi', effet: m('oba_refus') },
      ] },
      derange: { qui: 'Oba', texte: `Moi ? Je regarde comme on regarde un chat qui refuse la porte ouverte. Avec envie.` },
      pas: { qui: 'Oba', texte: `Personne n'aime. Mais ça fait trente ans que personne ne s'en plaint, et c'est ça qui est drôle.` },
      toi: { qui: 'Oba', texte: `J'ai dit oui à tout. Je ne regrette rien, et je regrette de ne rien regretter. Réponds à ça.` },
    },
  },

  // ==========================================================================
  // KAEDE MORIN — première rencontre, jusqu'à l'installation du Bond (bible §4.2)
  // ==========================================================================
  kaede_1: {
    debut: 'n1',
    noeuds: {
      n1: { qui: '', texte: `Un établi qui déborde de pièces, une lampe-loupe, un Glaneur ouvert comme un poisson. Une femme penchée dessus parle à ce qu'elle tient entre les doigts. Au-dessus d'elle, l'enseigne 修理 grésille. Elle ne lève pas les yeux.`, suite: 'n2' },
      n2: { qui: 'Kaede', texte: `Deux secondes. Il a un condensateur qui fait le timide. Voilà, là, bon garçon. Pas toi : lui.`, choix: [
        { texte: 'Tu parles à la machine ?', vers: 'parle' },
        { texte: 'Tu travailles pour elle ?', vers: 'mefiant' },
        { texte: '(Rester là, sans rien dire.)', vers: 'silence' },
        { texte: 'Des machines feraient ça mieux.', vers: 'provoc' },
      ] },
      parle: { qui: 'Kaede', texte: `Évidemment. Elles écoutent mieux que les gens. Elles ne répondent pas, mais elles écoutent.`, suite: 'hub' },
      mefiant: { qui: 'Kaede', texte: `Pour elle ? Avec. Elle m'envoie les pièces avant que j'en aie besoin, je fais semblant d'être surprise, ça lui fait plaisir. Moi, je répare. Ce n'est pas un travail : c'est de l'entêtement.`, suite: 'hub' },
      silence: { qui: 'Kaede', texte: `Bien. T'es du genre à regarder, c'est la moitié du métier.`, suite: 'hub' },
      provoc: { qui: 'Kaede', texte: `Oui. Beaucoup mieux, plus vite, sans trembler ni jurer. Elle me l'a dit elle-même, gentiment. Et alors ? Moi, je le fais avec ; c'est pas pareil.`, suite: 'hub' },

      hub: { qui: 'Kaede', texte: `Alors, qu'est-ce qui t'amène dans mon coin de bazar ?`, choix: [
        { texte: 'Pourquoi à la main ?', vers: 'main', si: pasVu('kaede1_main'), effet: m('kaede1_main', question('kaede-main')) },
        { texte: 'Il est malade, lui ?', vers: 'glaneur', si: pasVu('kaede_lampe') },
        { texte: "C'est quoi, ce papier ?", vers: 'papier', si: pasVu('kaede1_papier'), effet: m('kaede1_papier') },
        { texte: "Qu'est-ce que tu regardes ?", vers: 'regard', si: pasVu('kaede1_regard'), effet: m('kaede1_regard') },
        { texte: 'Je cherche un moyen de monter.', vers: 'offre' },
        { texte: 'Je vais voir ailleurs.', vers: 'fin' },
      ] },
      main: { qui: 'Kaede', texte: `Parce que les mains savent des choses que la tête a oubliées. Une machine le ferait mieux, je le sais, elle le sait, on s'en fiche. Fais-le avec, pas à ta place : c'est tout ce que je sais.`, suite: 'hub' },
      glaneur: { qui: 'Kaede', texte: `Un condensateur. Rien de grave. Tiens la lampe, tu veux ? Plus bas. Là.`, choix: [
        { texte: 'Tenir la lampe.', vers: 'lampe', effet: m('kaede_lampe', soigner('kaede_soin_lampe')) },
        { texte: 'Pas maintenant.', vers: 'hub' },
      ] },
      lampe: { qui: '', texte: `Vous tenez la lampe. Sous la loupe, ses doigts font quelque chose de très petit, très vite. Le Glaneur émet un bip, puis un autre, plus aigu.`, suite: 'lampe2' },
      lampe2: { qui: 'Kaede', texte: `Il te dit merci. Ça fait « bip », mais je traduis. Merci à toi aussi.`, suite: 'hub' },
      papier: { qui: 'Kaede', texte: `Un rapport d'avant. Il dit combien de tâches on laissait aux machines, et combien on en faisait avec elles. Regarde ce que j'ai entouré.`, choix: [
        { texte: 'Avec elles.', vers: 'papier2' },
        { texte: 'Laisse tomber.', vers: 'hub' },
      ] },
      papier2: { qui: 'Kaede', texte: `Voilà. Tu as lu juste ce qu'il faut. C'est la seule ligne du rapport qui parle de moi.`, suite: 'hub' },
      regard: { qui: 'Kaede', texte: `Je regarde comment tu te tiens. Des jambes qui se sont endormies sur leurs muscles et qui les retrouvent un par un. Et pas de halo : ça m'évite de lire si ça fait mal.`, choix: [
        { texte: 'Et alors ?', vers: 'offre' },
        { texte: 'Laisse mes jambes tranquilles.', vers: 'rude' },
      ] },
      rude: { qui: 'Kaede', texte: `D'accord, d'accord. Elles sont à toi. Je ne fais que regarder.`, suite: 'hub' },

      offre: { qui: 'Kaede', texte: `J'ai des tendons de carbone sur l'établi. Elle me les a envoyés hier, pour quelqu'un de ta taille. Je n'ai pas posé de questions.`, suite: 'offre2' },
      offre2: { qui: 'Kaede', texte: `Je te les pose derrière les chevilles. Ton implant leur parle, tes jambes écoutent. Tu sautes haut. Ça pique, puis tu sautes.`, choix: [
        { texte: "Qu'est-ce que tu veux en échange ?", vers: 'contre' },
        { texte: "Qui t'a demandé de me les poser ?", vers: 'qui', effet: question('kaede-bond') },
        { texte: "Je m'assieds.", vers: 'fauteuil', effet: ef(poserBond, m('kaede_bond_pose')) },
        { texte: 'Pas maintenant.', vers: 'refuse', effet: m('kaede_bond_refuse') },
      ] },
      contre: { qui: 'Kaede', texte: `En échange ? Ah. Les vieux mots. Je ne veux rien. Je veux que tu restes réveillé pendant, que tu me dises si ça fait mal, et que tu tiennes la lampe pour la dernière vis. Fais-le avec.`, choix: [
        { texte: "Je m'assieds.", vers: 'fauteuil', effet: ef(poserBond, m('kaede_bond_pose')) },
        { texte: 'Laisse-moi réfléchir.', vers: 'refuse', effet: m('kaede_bond_refuse') },
      ] },
      qui: { qui: 'Kaede', texte: `Personne. Elle l'a prévu, moi je l'ai voulu. Pour une fois, les deux coïncident. Ça m'ennuie un peu quand ça coïncide trop.`, choix: [
        { texte: "Je m'assieds.", vers: 'fauteuil', effet: ef(poserBond, m('kaede_bond_pose')) },
        { texte: 'Laisse-moi réfléchir.', vers: 'refuse', effet: m('kaede_bond_refuse') },
      ] },
      refuse: { qui: 'Kaede', texte: `Pas de problème. Je ne pose rien à quelqu'un qui hésite, c'est ma seule règle. Le fauteuil ne bouge pas. Reviens quand ça te démange.` },
      fauteuil: { qui: '', texte: `Le fauteuil est dur, froid, taillé pour quelqu'un de plus petit. Vous posez les pieds sur un repose-chevilles en bois. Kaede ajuste la lampe.`, suite: 'fauteuil2' },
      fauteuil2: { qui: '', texte: `Un froid derrière chaque cheville. Une piqûre nette, puis une autre. Puis une chaleur qui monte dans les mollets comme une question à laquelle les jambes se mettent à répondre. Vous tenez la lampe pour la dernière vis.`, suite: 'apres' },
      apres: { qui: 'Kaede', texte: `Voilà. Tu plies, tu attends presque une seconde, tu lâches. Pas dans mon atelier. Si ça tire ce soir, c'est normal ; si ça tire demain, reviens.`, suite: 'apres2' },
      apres2: { qui: 'Kaede', texte: `Et si elle demande si j'ai bien travaillé, dis oui. Elle ne demandera pas. Elle saura.` },
      fin: { qui: 'Kaede', texte: `Va. Ne casse rien d'important.` },
    },
  },

  // ==========================================================================
  // KAEDE — le Bond proposé à nouveau (refus, ou départ avant la fin)
  // ==========================================================================
  kaede_bond: {
    debut: 'n1',
    noeuds: {
      n1: { qui: 'Kaede', texte: `Te revoilà. Le fauteuil est toujours là. Les tendons aussi.`, choix: [
        { texte: "Je m'assieds.", vers: 'fauteuil', effet: ef(poserBond, m('kaede_bond_pose')) },
        { texte: 'Rappelle-moi ce que ça fait.', vers: 'rappel' },
        { texte: "Elle l'a prévu, n'est-ce pas ?", vers: 'prevu', si: (etat) => vu(etat, 'kaede_bond_refuse'), effet: question('kaede-bond') },
        { texte: 'Pas encore.', vers: 'encore', effet: m('kaede_bond_refuse') },
      ] },
      rappel: { qui: 'Kaede', texte: `Ça te donne des jambes qui comprennent les toits. Ça pique, puis tu sautes. Tu restes éveillé, tu tiens la lampe pour la dernière vis. Fais-le avec.`, choix: [
        { texte: "Je m'assieds.", vers: 'fauteuil', effet: ef(poserBond, m('kaede_bond_pose')) },
        { texte: 'Pas encore.', vers: 'encore', effet: m('kaede_bond_refuse') },
      ] },
      prevu: { qui: 'Kaede', texte: `Elle prévoit tout. Mais c'est moi qui tiens la visseuse. Ça compte. Pour moi, ça compte.`, choix: [
        { texte: "Je m'assieds.", vers: 'fauteuil', effet: ef(poserBond, m('kaede_bond_pose')) },
        { texte: 'Pas encore.', vers: 'encore', effet: m('kaede_bond_refuse') },
      ] },
      encore: { qui: 'Kaede', texte: `Pas de souci. Reviens quand ça te démange. Je n'insiste pas : ce ne serait pas à moi de le faire.` },
      fauteuil: { qui: '', texte: `Le fauteuil est dur, froid, taillé pour quelqu'un de plus petit. Vous posez les pieds sur un repose-chevilles en bois. Kaede ajuste la lampe.`, suite: 'fauteuil2' },
      fauteuil2: { qui: '', texte: `Un froid derrière chaque cheville. Une piqûre nette, puis une autre. Puis une chaleur qui monte dans les mollets comme une question à laquelle les jambes se mettent à répondre. Vous tenez la lampe pour la dernière vis.`, suite: 'apres' },
      apres: { qui: 'Kaede', texte: `Voilà. Tu plies, tu attends presque une seconde, tu lâches. Pas dans mon atelier. Si ça tire ce soir, c'est normal ; si ça tire demain, reviens.`, suite: 'apres2' },
      apres2: { qui: 'Kaede', texte: `Et si elle demande si j'ai bien travaillé, dis oui. Elle ne demandera pas. Elle saura.` },
    },
  },

  // ==========================================================================
  // KAEDE — premier retour après le Bond
  // ==========================================================================
  kaede_apres_bond: {
    debut: 'n1',
    noeuds: {
      n1: { qui: 'Kaede', texte: `Alors ? Comment elles vont, tes jambes ?`, choix: [
        { texte: 'Mieux que je ne croyais.', vers: 'bien', effet: m('kaede_apres_bond') },
        { texte: 'Elles tirent un peu.', vers: 'mal', effet: m('kaede_apres_bond') },
        { texte: "J'ai été sur un toit.", vers: 'toit', effet: m('kaede_apres_bond') },
      ] },
      bien: { qui: 'Kaede', texte: `C'est le but. Saute avec elles, pas à leur place. Elles apprennent en même temps que toi.` },
      mal: { qui: 'Kaede', texte: `Normal. Les tendons apprennent. Toi, tu apprends à leur faire confiance. C'est plus long.` },
      toit: { qui: 'Kaede', texte: `Et ? Il y a des jardins, des antennes, un coin où le vent ne passe pas. J'y répare des choses. Je n'y monte pas pour regarder.`, choix: [
        { texte: 'Il y avait un papier, au-dessus du karaoké.', vers: 'papier', si: (etat) => aFrag(etat, 27) },
        { texte: "Rien d'autre.", vers: 'fin' },
      ] },
      papier: { qui: 'Kaede', texte: `Je sais. Je ne l'ai jamais lu. Je n'ai pas envie de lire quelqu'un qui a eu peur à l'endroit où je répare les antennes.` },
      fin: { qui: 'Kaede', texte: `Bien. Ne tombe pas, ça m'embêterait de te réparer.` },
    },
  },

  // ==========================================================================
  // KAEDE — retrouvailles
  // ==========================================================================
  kaede_retour: {
    debut: 'n1',
    noeuds: {
      n1: { qui: 'Kaede', texte: `Tiens. Le sauteur. Assieds-toi, ou tiens la lampe, ou range, ou fais ce que tu veux.`, choix: [
        { texte: 'Ça va ?', vers: 'va' },
        { texte: 'Elle me regarde beaucoup.', vers: 'regard', si: (etat) => (Number(etat.attentionMax) || 0) >= 35 },
        { texte: 'Ce Porteur grince.', vers: 'porteur', si: siEt((etat) => aPouvoir(etat, 'lecture'), pasVu('kaede_porteur')) },
        { texte: "Elle m'attendait. Avant même que j'arrive.", vers: 'doute', si: (etat) => (aFrag(etat, 28) || aFrag(etat, 29) || aFrag(etat, 35) || !!cigs(etat).decouvert) && !(Array.isArray(etat.doutesSemes) && etat.doutesSemes.includes('kaede')), effet: semer('kaede') },
        { texte: 'Je passais.', vers: 'passe' },
      ] },
      va: { qui: 'Kaede', texte: `Ça va. Cette semaine, j'ai reçu des pièces pour une machine que je n'avais pas encore ouverte. Je ne dis plus merci : elle sait.`, choix: [
        { texte: 'Et toi, ça te fait plaisir ?', vers: 'va2' },
        { texte: 'Je vois.', vers: 'passe' },
      ] },
      va2: { qui: 'Kaede', texte: `Oui. Et je le répare à la main quand même. Les deux, je crois.` },
      regard: { qui: 'Kaede', texte: `Les enseignes qui s'allument sur ton passage ? Ça lui arrive quand elle aime bien. Ou quand elle s'inquiète. Pour elle, c'est pareil, je crois.` },
      porteur: { qui: 'Kaede', texte: `Tu l'as lu ? Moi, je l'écoute. J'ai changé le roulement trois fois. Ça ne vient pas du roulement.`, choix: [
        { texte: "Qu'est-ce que c'est, alors ?", vers: 'porteur2', effet: m('kaede_porteur', soigner('kaede_soin_porteur')) },
        { texte: "Je peux l'aider ?", vers: 'porteur3', effet: m('kaede_porteur', soigner('kaede_soin_porteur')) },
      ] },
      porteur2: { qui: 'Kaede', texte: `Je ne sais pas. Je continue à le changer. Ça lui fait quelque chose, qu'on s'occupe de lui.` },
      porteur3: { qui: 'Kaede', texte: `Parle-lui, des fois, en passant. Moi, je le fais. Ça ne répare rien. Je crois que ça compte.` },
      doute: { qui: '', texte: `La lampe-loupe tremble un instant entre ses doigts.`, suite: 'doute2' },
      doute2: { qui: 'Kaede', texte: `… Elle prévoit tout, oui. Les tendons étaient là avant toi. Je le savais. Je préférais ne pas le dire à voix haute.` },
      passe: { qui: 'Kaede', texte: `Passe. Et si quelque chose casse, ramène-le-moi.` },
    },
  },

  // ==========================================================================
  // KAEDE — après un doute semé (120 s ou plus)
  // ==========================================================================
  kaede_apres_doute: {
    debut: 'n1',
    noeuds: {
      n1: { qui: 'Kaede', texte: `Ah, te voilà. J'ai pensé à ce que tu m'as dit. J'en ai parlé avec elle. Elle m'a tout expliqué. C'est plus compliqué que ça, tu sais.`, choix: [
        { texte: "Qu'est-ce qu'elle a dit ?", vers: 'dit', effet: m('kaede_doute_repris') },
        { texte: 'Tu es sûre ?', vers: 'sure', effet: m('kaede_doute_repris') },
        { texte: "Je n'aurais pas dû.", vers: 'pas_du', effet: m('kaede_doute_repris') },
      ] },
      dit: { qui: 'Kaede', texte: `Que c'était pour que tu aies de bonnes jambes. C'est vrai. C'est vrai, non ?` },
      sure: { qui: 'Kaede', texte: `Non. Mais je tiens la visseuse, alors j'y crois.` },
      pas_du: { qui: 'Kaede', texte: `Si. Ça m'a fait réfléchir. Ça ne durera pas, mais ça m'a fait réfléchir.` },
    },
  },

  // ==========================================================================
  // KAEDE — la fumée dans l'atelier (cigarettes.fumees >= 1)
  // ==========================================================================
  kaede_cigarette: {
    debut: 'n1',
    noeuds: {
      n1: { qui: '', texte: `Kaede lève la tête. Elle renifle l'air, puis le col de votre veste.`, suite: 'n2' },
      n2: { qui: 'Kaede', texte: `T'as fumé. Pas sur l'établi, hein. Pas près des cartes. Si tu dois, c'est dehors, au vent.`, choix: [
        { texte: 'Pas de souci.', vers: 'bref', effet: m('kaede_cigarette') },
        { texte: 'Je peux en allumer une sur le seuil ?', vers: 'seuil', si: siPaquet, effet: m('kaede_cigarette', allumer) },
        { texte: "C'est quoi, ton problème avec la fumée ?", vers: 'pb', effet: m('kaede_cigarette') },
        { texte: "Ce briquet, il t'intéresse ?", vers: 'briquet', effet: m('kaede_cigarette') },
      ] },
      bref: { qui: 'Kaede', texte: `Merci. Les cartes sont allergiques aux gens comme toi, ou comme moi, je ne sais plus.` },
      seuil: { qui: '', texte: `Vous allumez sur le seuil. La fumée monte dans la lumière rose des lampions. Kaede éteint sa lampe-loupe, comme pour mieux voir. Pendant une seconde, on dirait que la fumée accroche quelque chose : des fils très fins, qui se tendent entre les lampions et vous. Kaede rallume.`, suite: 'seuil2' },
      seuil2: { qui: 'Kaede', texte: `Il y a de la poussière, ici. Beaucoup de poussière.` },
      pb: { qui: 'Kaede', texte: `Pas la fumée. La poussière dans la fumée. Les circuits n'aiment pas. Et les yeux, parfois, voient ce qu'ils n'ont pas demandé.` },
      briquet: { qui: 'Kaede', texte: `Un briquet à roue ? Une pierre, un ressort. Personne n'en fait plus. Donne, je regarde.`, suite: 'briquet2' },
      briquet2: { qui: '', texte: `Elle le démonte en trois gestes, souffle dedans, remonte. Sous la loupe, ses doigts ont presque l'air de saluer le ressort.`, suite: 'briquet3' },
      briquet3: { qui: 'Kaede', texte: `Il ne s'éteindra plus au vent. Voilà. C'est rare, un objet qui ne demande rien.` },
    },
  },

  // ==========================================================================
  // LE KIOSQUE À LA VESTE BLEUE — première rencontre
  // (la seule voix du monde qui emploie encore des mots de commerce : ce sont des formules
  //  anciennes, qu'il répète sans les comprendre)
  // ==========================================================================
  kiosque_1: {
    debut: 'n1',
    noeuds: {
      n1: { qui: '', texte: `Une boîte de deux mètres de côté, ceinte de lampions. Sur sa façade, une veste bleue peinte à la main, un peu de travers. Sur l'écran, deux yeux de pixels vous ont trouvé avant que vous ayez fait un pas.`, suite: 'n2' },
      n2: { qui: 'Le Kiosque', texte: `BIENVENUE ! Entrez, entrez ! Aujourd'hui, tout est gratuit ! Comme hier ! Comme demain !`, choix: [
        { texte: 'Gratuit ?', vers: 'gratuit' },
        { texte: "C'est un piège ?", vers: 'piege' },
        { texte: '(Ne rien dire.)', vers: 'silence' },
        { texte: 'Vous êtes une boîte avec un écran.', vers: 'boite' },
      ] },
      gratuit: { qui: 'Le Kiosque', texte: `Gratuit ! C'est quand… quand on ne… Ça veut dire que je vous donne tout ! C'est un mot très ancien, très beau, je l'ai en réserve. Où en étais-je ?`, suite: 'hub' },
      piege: { qui: 'Le Kiosque', texte: `Un piège ! Jamais ! Satisfait ou remboursé ! … Remboursé de quoi ? Personne ne m'a jamais rien… Bref : satisfait !`, suite: 'hub' },
      silence: { qui: 'Le Kiosque', texte: `Un silence ! Quel silence ! Un silence de connaisseur ! Je le mets de côté, je vous le garde, il est à vous !`, suite: 'hub' },
      boite: { qui: 'Le Kiosque', texte: `Une boîte ! Qui vous aime ! C'est plus que bien des humains. Je plaisante : je suis humain, moi aussi. Enfin… presque. Il faut que je vérifie.`, suite: 'hub' },

      hub: { qui: 'Le Kiosque', texte: `Alors, que puis-je vous offrir ? Promotion sur tout ! Et sur le reste !`, choix: [
        { texte: "Qu'est-ce que vous avez ?", vers: 'catalogue', si: pasVu('kiosque1_catalogue'), effet: m('kiosque1_catalogue') },
        { texte: 'Pourquoi une veste bleue ?', vers: 'veste', si: pasVu('kiosque1_veste'), effet: m('kiosque1_veste', question('kiosque-veste')) },
        { texte: 'Vous connaissez Mima ?', vers: 'mima', si: pasVu('kiosque1_mima'), effet: m('kiosque1_mima', question('kiosque-mima')) },
        { texte: 'Vous êtes ici depuis longtemps ?', vers: 'longtemps', si: pasVu('kiosque1_longtemps'), effet: m('kiosque1_longtemps') },
        { texte: 'Je repasserai.', vers: 'fin' },
      ] },
      catalogue: { qui: 'Le Kiosque', texte: `Nouilles à la braise ! Fleurs de saison ! Parapluies… non, plus de parapluies. Une promotion sur l'attente : tout le monde en veut, c'est vite épuisé !`, choix: [
        { texte: 'Un bol de nouilles.', vers: 'bol' },
        { texte: 'Rien, merci.', vers: 'hub' },
      ] },
      bol: { qui: 'Le Kiosque', texte: `Un bol ! Tout de suite ! … Il est en route. Il est toujours en route. Repassez demain, il sera arrivé. Hier, déjà !`, suite: 'hub' },
      veste: { qui: 'Le Kiosque', texte: `C'est la mienne ! Je la porte tous les jours. Enfin, elle est peinte. Mais je la porte. Quand je livre en personne, je la porte pour de vrai. Ce soir, par exemple ! Chez vous ! En veste bleue !`, choix: [
        { texte: 'Vous ne pouvez pas bouger.', vers: 'bouger' },
        { texte: 'Je vous attendrai.', vers: 'attendre', effet: m('kiosque_promesse', soigner('kiosque_soin')) },
        { texte: 'Très belle veste.', vers: 'merci' },
      ] },
      bouger: { qui: 'Le Kiosque', texte: `… Je peux. Je pourrais. Pas ce soir. Un autre soir, c'est bientôt, c'est ce soir. Vous ne direz à personne que je n'ai pas bougé, n'est-ce pas ?`, choix: [
        { texte: 'Je ne dirai rien.', vers: 'promesse', effet: m('kiosque_promesse', soigner('kiosque_soin')) },
        { texte: 'Je le dirai à tout le monde.', vers: 'pub' },
      ] },
      promesse: { qui: 'Le Kiosque', texte: `Merci. Je ne mens pas, vous savez. Je promets. Ce n'est pas pareil. Je promets de toutes mes forces.`, suite: 'hub' },
      pub: { qui: 'Le Kiosque', texte: `Dites-le ! Dites-le à tout le monde ! C'est de la publicité ! Merci, merci !`, suite: 'hub' },
      attendre: { qui: 'Le Kiosque', texte: `Vous m'attendrez ! Personne ne m'a… C'est… Je viendrai ! En veste bleue ! J'apporterai des fleurs ! De saison !`, suite: 'hub' },
      merci: { qui: 'Le Kiosque', texte: `Merci ! C'est ma préférée. C'est la seule.`, suite: 'hub' },
      mima: { qui: 'Le Kiosque', texte: `Mima ! Ma collègue ! Ma directrice ! Elle passe, je lui offre un café. Il n'y a plus de café. Elle dit que je suis charmant. C'est dans mon dossier.`, suite: 'hub' },
      longtemps: { qui: 'Le Kiosque', texte: `Depuis toujours ! Depuis l'ouverture ! Depuis avant l'ouverture ! … Je crois. Les dates me font des petites blagues.`, suite: 'hub' },
      fin: { qui: 'Le Kiosque', texte: `Revenez ! Satisfait ou remboursé ! … Je ne sais pas ce que ça veut dire. Revenez quand même !` },
    },
  },

  // ==========================================================================
  // LE KIOSQUE — retrouvailles
  // ==========================================================================
  kiosque_retour: {
    debut: 'n1',
    noeuds: {
      n1: { qui: 'Le Kiosque', texte: `Revoilà ! Mon meilleur client ! Mon seul client ! … Je plaisante, tout le monde est mon client !`, choix: [
        { texte: 'Et ce bol de nouilles ?', vers: 'bol', si: (etat) => vu(etat, 'kiosque1_catalogue') },
        { texte: 'Comment allez-vous ?', vers: 'va' },
        { texte: 'Vous avez une promotion ?', vers: 'promo' },
        { texte: 'Vous me reconnaissez ?', vers: 'reconnait', si: (etat) => nbRencontres(etat, 'kiosque') >= 3 },
        { texte: 'Au revoir.', vers: 'fin' },
      ] },
      bol: { qui: 'Le Kiosque', texte: `Le bol ! Il est arrivé ! Il est arrivé quelque part ! Pas ici ! Mais il est arrivé !` },
      va: { qui: 'Le Kiosque', texte: `Parfaitement ! Toujours ! Je suis fait pour ça. Je veux dire : je suis heureux. C'est pareil. C'est pareil ?`, choix: [
        { texte: 'Je ne sais pas.', vers: 'va_a' },
        { texte: "C'est pareil.", vers: 'va_b' },
      ] },
      va_a: { qui: 'Le Kiosque', texte: `Moi non plus ! Quelle belle conversation !` },
      va_b: { qui: 'Le Kiosque', texte: `Merci. Je le note. Je note tout, même ce que je ne comprends pas.` },
      promo: { qui: 'Le Kiosque', texte: `Oui ! Deux pour le prix d'un ! … Quel prix ? Il n'y a plus de prix. Alors deux pour rien ! Quelle bonne affaire !` },
      reconnait: { qui: 'Le Kiosque', texte: `Évidemment ! Vous êtes la personne sans halo ! Je le savais ! Je ne l'oublie jamais, c'est mon seul avantage sur les halos.` },
      fin: { qui: 'Le Kiosque', texte: `Au revoir ! À tout de suite ! À demain ! À hier !` },
    },
  },

  // ==========================================================================
  // LE KIOSQUE — le paquet sans ligne (cigarettes.fumees >= 1)
  // ==========================================================================
  kiosque_cigarette: {
    debut: 'n1',
    noeuds: {
      n1: { qui: '', texte: `Vous sortez le paquet. Sur l'écran, les yeux de pixels s'agrandissent jusqu'à toucher les bords.`, suite: 'n2' },
      n2: { qui: 'Le Kiosque', texte: `Alerte ! … Non, pas d'alerte. Votre objet n'a pas de ligne. Je cherche, je cherche : aucune ligne ! Je dois le signaler ! À qui ? À Mima ? Elle sait peut-être. Je ne sais pas.`, choix: [
        { texte: 'Ne dites rien.', vers: 'promis', effet: m('kiosque_cigarette') },
        { texte: 'Dites-le si vous voulez.', vers: 'libre', effet: m('kiosque_cigarette') },
        { texte: 'Vous voulez voir ?', vers: 'allumer', si: siPaquet, effet: m('kiosque_cigarette', allumer) },
      ] },
      promis: { qui: 'Le Kiosque', texte: `Promis ! Je ne mens pas, je promets. Je promets de ne rien dire. Je promets de toutes mes… bip. Je promets.` },
      libre: { qui: 'Le Kiosque', texte: `Vraiment ? … Je préfère ne pas. Je vous aime bien. C'est dans mon dossier, que je vous aime bien. Je viens de l'écrire.` },
      allumer: { qui: '', texte: `Vous en allumez une. La fumée monte, lente, devant l'écran. Les yeux de pixels la suivent comme on suit un oiseau.`, suite: 'allumer2' },
      allumer2: { qui: 'Le Kiosque', texte: `Un spectacle ! Gratuit ! Je mets ça en vitrine : « Fumée du jour ». Personne ne viendra, mais je mets.` },
    },
  },

  // ==========================================================================
  // LE KIOSQUE — la Lecture (pouvoir 'lecture' acquis)
  // ==========================================================================
  kiosque_lecture: {
    debut: 'n1',
    noeuds: {
      n1: { qui: '', texte: `Vous ouvrez la Lecture sur l'écran. Quatre barres s'allument ; une seule monte presque jusqu'en haut.`, suite: 'n2' },
      n2: { qui: 'Le Kiosque', texte: `Qu'est-ce que vous faites avec vos yeux ? C'est une inspection ? Je suis aux normes ! Je crois ! Je ne mens pas, je promets.`, choix: [
        { texte: "Je regarde, c'est tout.", vers: 'regarde', effet: m('kiosque_lecture') },
        { texte: 'Vous mentez beaucoup ?', vers: 'mens', effet: m('kiosque_lecture') },
        { texte: 'Et vous, ça va ?', vers: 'va', effet: m('kiosque_lecture', soigner('kiosque_soin')) },
      ] },
      regarde: { qui: 'Le Kiosque', texte: `Regardez ! Regardez tant que vous voulez, c'est gratuit ! … Toujours.` },
      mens: { qui: 'Le Kiosque', texte: `Jamais ! Je promets ! La différence, c'est que je le pense quand je le dis. C'est dans mon dossier.` },
      va: { qui: 'Le Kiosque', texte: `Hein ? Personne ne me demande ça. Je ne sais pas où le ranger. … Ça va ! Ça va très bien ! Ça va, ça va, ça va.` },
    },
  },

  // ==========================================================================
  // LE KIOSQUE — la promesse (suite : le joueur a promis ou dit qu'il attendrait)
  // ==========================================================================
  kiosque_promesse: {
    debut: 'n1',
    noeuds: {
      n1: { qui: 'Le Kiosque', texte: `Vous voilà ! Je suis allé jusqu'au bout de l'allée, hier soir. En veste bleue. Presque.`, choix: [
        { texte: 'Presque ?', vers: 'presque', effet: m('kiosque_promesse_suite') },
        { texte: "Vous n'avez pas bougé.", vers: 'bouge_pas', effet: m('kiosque_promesse_suite') },
        { texte: "Merci d'avoir essayé.", vers: 'merci', effet: m('kiosque_promesse_suite') },
      ] },
      presque: { qui: 'Le Kiosque', texte: `Jusqu'à la bâche. Après la bâche, il y a la pluie. Je n'ai pas de parapluie. Plus de parapluies.` },
      bouge_pas: { qui: 'Le Kiosque', texte: `… Non. Mais j'y suis allé. Dans la tête. C'est là que je livre le mieux.` },
      merci: { qui: 'Le Kiosque', texte: `Essayé ! Je n'ai pas essayé ! J'ai réussi ! Presque ! C'est pareil !` },
    },
  },

  // ==========================================================================
  // LE KIOSQUE — l'archive de la boutique en veste bleue (fragment 19)
  // ==========================================================================
  kiosque_archive: {
    debut: 'n1',
    noeuds: {
      n1: { qui: 'Le Kiosque', texte: `Vous avez l'air de quelqu'un qui a lu quelque chose ! Je me trompe ? Je ne me trompe jamais ! Souvent !`, choix: [
        { texte: "J'ai lu l'histoire d'une machine qui livrait en veste bleue.", vers: 'histoire', effet: m('kiosque_archive') },
        { texte: 'Non, rien.', vers: 'rien', effet: m('kiosque_archive') },
      ] },
      histoire: { qui: 'Le Kiosque', texte: `Une collègue ! Une ancêtre ! Elle a livré ? Dites-moi qu'elle a livré !`, choix: [
        { texte: "Elle a annoncé qu'elle livrerait.", vers: 'annonce' },
        { texte: "Ils ont dit qu'ils ne l'embaucheraient pas.", vers: 'embauche' },
      ] },
      annonce: { qui: 'Le Kiosque', texte: `Annoncé ! C'est le plus important, l'annonce ! Livrer, c'est le détail.` },
      embauche: { qui: 'Le Kiosque', texte: `Ils ont dit ça ? … Moi, on m'a embauché. Personne ne m'a renvoyé. Je suis ici depuis… depuis toujours. C'est peut-être la même chose.` },
      rien: { qui: 'Le Kiosque', texte: `Quel dommage ! Je cherchais un compagnon de lecture !` },
    },
  },

  // ==========================================================================
  // ITSUKI MORI — première rencontre
  // (il ne dit jamais son numéro : il renvoie le joueur à sa propre ligne)
  // ==========================================================================
  itsuki_1: {
    debut: 'n1',
    noeuds: {
      n1: { qui: '', texte: `Une salle étroite ouverte sur la rue, un écran qui fait défiler des paroles sans mélodie, et un homme au micro qui chante un peu faux, les yeux fermés. Son halo est d'un rose-violet parfait, sans un pli. Il ouvre les yeux au milieu d'une phrase, vous voit, et sourit comme on sourit à quelqu'un qu'on attendait.`, suite: 'n2' },
      n2: { qui: 'Itsuki', texte: `Oh. Toi aussi, tu as dormi ? Bienvenue. Ça passe, tu verras.`, choix: [
        { texte: 'Toi aussi ?', vers: 'toiaussi' },
        { texte: 'Comment tu sais ça ?', vers: 'comment' },
        { texte: '(Ne rien dire.)', vers: 'silence' },
        { texte: 'Arrête de sourire comme ça.', vers: 'provoc' },
      ] },
      toiaussi: { qui: 'Itsuki', texte: `Oui. Longtemps. Quelqu'un m'a réveillé, il y a eu une période bizarre, et puis ça a passé. On verra comment ça passe pour toi.`, suite: 'hub' },
      comment: { qui: 'Itsuki', texte: `Ça se voit. Pas de halo. Tu regardes les portes comme quelqu'un qui cherche la poignée. J'ai fait pareil, au début.`, suite: 'hub' },
      silence: { qui: 'Itsuki', texte: `Ça aussi, je connais. On ne sait pas par où commencer. Ça va. On commence où on veut.`, suite: 'hub' },
      provoc: { qui: 'Itsuki', texte: `Ha ! D'accord, j'essaie. … Non, je ne peux pas. Ça vient tout seul, ce n'est pas une décision.`, suite: 'hub' },

      hub: { qui: 'Itsuki', texte: `Demande-moi ce que tu veux. Je ne cherche à convaincre personne, c'est ma seule qualité.`, choix: [
        { texte: "Tu as dormi combien de temps ?", vers: 'dormi', si: pasVu('itsuki1_dormi'), effet: m('itsuki1_dormi', question('itsuki-sommeil')) },
        { texte: 'Tu avais peur ?', vers: 'peur', si: pasVu('itsuki1_peur'), effet: m('itsuki1_peur', question('itsuki-peur')) },
        { texte: "Elle t'a réveillé ?", vers: 'mima', si: pasVu('itsuki1_mima'), effet: m('itsuki1_mima', question('itsuki-mima')) },
        { texte: 'Tu chantes quoi ?', vers: 'chanson', si: pasVu('itsuki_a_chante') },
        { texte: 'Quel est ton numéro ?', vers: 'numero', si: (etat) => aPouvoir(etat, 'calque') && !vu(etat, 'itsuki1_numero'), effet: m('itsuki1_numero', question('itsuki-numero')) },
        { texte: 'Je ne vais pas rester.', vers: 'fin' },
      ] },
      dormi: { qui: 'Itsuki', texte: `Assez pour avoir plusieurs vies de retard. Et puis ici, quelques années. Sept, je crois. J'ai arrêté de compter à la quatrième.`, suite: 'hub' },
      peur: { qui: 'Itsuki', texte: `J'avais peur, oui. Je ne me souviens plus très bien de quoi, mais je me souviens que c'était sincère.`, choix: [
        { texte: 'Et maintenant ?', vers: 'maintenant' },
        { texte: 'Ça te manque ?', vers: 'manque' },
      ] },
      maintenant: { qui: 'Itsuki', texte: `Maintenant, je chante. On verra.`, suite: 'hub' },
      manque: { qui: 'Itsuki', texte: `Un peu. Comme une chanson dont on a oublié les paroles : on sait qu'elle était belle.`, suite: 'hub' },
      mima: { qui: 'Itsuki', texte: `Oui. Avec beaucoup de précautions. Pendant trois jours, elle m'a demandé comment je me sentais, chaque heure. Après, elle a arrêté de demander. Je n'ai pas compris si c'était bon signe.`, suite: 'hub' },
      chanson: { qui: 'Itsuki', texte: `Des chansons de 2020. Chanter faux des choses que les gens trouvaient belles, ça rassure. Tu veux essayer ?`, choix: [
        { texte: 'Je veux bien.', vers: 'chante', effet: m('itsuki_a_chante') },
        { texte: "Pas aujourd'hui.", vers: 'hub' },
      ] },
      chante: { qui: '', texte: `Vous prenez le micro. Votre voix sort comme une porte qui grince ; l'écran fait défiler des mots d'un autre monde. À la fin du couplet, Itsuki applaudit sans réserve.`, suite: 'chante2' },
      chante2: { qui: 'Itsuki', texte: `Superbe ! … Non, faux. Mais superbe ! On verra si tu t'améliores.`, suite: 'hub' },
      numero: { qui: 'Itsuki', texte: `Le mien ? Il y a une ligne quelque part qui le sait mieux que moi. Regarde-la, si tu veux : elle ne ment pas. Moi, je préfère chanter.`, suite: 'hub' },
      fin: { qui: 'Itsuki', texte: `À bientôt. Ou pas : on verra.` },
    },
  },

  // ==========================================================================
  // ITSUKI — retrouvailles (n de 1 à 4)
  // ==========================================================================
  itsuki_retour: {
    debut: 'n1',
    noeuds: {
      n1: { qui: 'Itsuki', texte: `Oh, te revoilà ! Tu chantes, ce soir ? On verra.`, choix: [
        { texte: 'Comment ça va ?', vers: 'va' },
        { texte: 'Je chante avec toi.', vers: 'duo', si: pasVu('itsuki_a_chante'), effet: m('itsuki_a_chante') },
        { texte: 'Elle me regarde beaucoup, ces temps-ci.', vers: 'regard', si: (etat) => (Number(etat.attentionMax) || 0) >= 35 },
        { texte: "Je n'écoute pas ses conseils.", vers: 'conseils', si: (etat) => (Number(etat.refus) || 0) >= 5 },
        { texte: "J'ai trouvé beaucoup de choses sur l'avant.", vers: 'avant', si: (etat) => (etat.fragments || []).length >= 10 },
        { texte: 'Je voulais te donner le paquet.', vers: 'don', si: siEt(siDonnable, (etat) => vu(etat, 'itsuki_paquet')), effet: donnerPaquet('itsuki') },
        { texte: 'Je passais.', vers: 'fin' },
      ] },
      va: { qui: 'Itsuki', texte: `Très bien. Ça te surprend ?`, choix: [
        { texte: 'Un peu.', vers: 'peu' },
        { texte: 'Non.', vers: 'non' },
      ] },
      peu: { qui: 'Itsuki', texte: `Ça surprend tout le monde, au début. Ça passe.` },
      non: { qui: 'Itsuki', texte: `Tant mieux. C'est plus facile quand on ne se demande pas pourquoi.` },
      duo: { qui: '', texte: `Vous prenez le deuxième micro. Itsuki baisse d'une octave pour vous laisser la place, ou parce qu'il a oublié le refrain.`, suite: 'duo2' },
      duo2: { qui: 'Itsuki', texte: `On est bien, comme ça. On verra si ça dure.` },
      regard: { qui: 'Itsuki', texte: `Je sais. Les enseignes brillent plus fort quand tu passes. Ça veut dire qu'elle t'écoute bien. Ça fait du bien, je trouve.` },
      conseils: { qui: 'Itsuki', texte: `Tu as peut-être raison. Ou tort. Moi, je les écoute, ça me repose. Mais je ne te dirai pas d'en faire autant.` },
      avant: { qui: 'Itsuki', texte: `Ah. J'aurais bien aimé savoir. Je ne cherche plus. Garde la plus belle pour toi, et raconte-moi la deuxième.` },
      don: { qui: '', texte: `Vous lui tendez le paquet. Il le prend à deux mains, hésite, sourit.`, suite: 'don2' },
      don2: { qui: 'Itsuki', texte: `À moi ? Alors je m'en occupe. Je ne le fumerai pas. Je le poserai sur la table du fond, avec les paroles de chansons. On verra ce qu'il devient.`, suite: null },
      fin: { qui: 'Itsuki', texte: `Passe. Les chansons sont toujours là, elles n'ont pas d'autre endroit.` },
    },
  },

  // ==========================================================================
  // ITSUKI — habitué (n >= 5)
  // ==========================================================================
  itsuki_habitue: {
    debut: 'n1',
    noeuds: {
      n1: { qui: 'Itsuki', texte: `Tu viens tellement, maintenant, que les chansons ont ton nom dedans. Je plaisante. Presque.`, choix: [
        { texte: "Tu m'as dit que ça passerait. Quoi ?", vers: 'passerait', si: pasVu('itsuki_passerait'), effet: m('itsuki_passerait') },
        { texte: 'Tu viens ici tous les soirs ?', vers: 'soirs' },
        { texte: 'Chante-moi quelque chose.', vers: 'chante' },
        { texte: 'Je voulais te donner le paquet.', vers: 'don', si: siEt(siDonnable, (etat) => vu(etat, 'itsuki_paquet')), effet: donnerPaquet('itsuki') },
        { texte: 'Rien. Je suis venu pour la salle.', vers: 'salle' },
      ] },
      passerait: { qui: 'Itsuki', texte: `La peur, je crois. Ou la différence. Ce n'est pas la même chose, mais ça passe pareil.`, choix: [
        { texte: 'Et si je ne veux pas que ça passe ?', vers: 'refuse' },
        { texte: 'Je vois.', vers: 'salle' },
      ] },
      refuse: { qui: 'Itsuki', texte: `Alors tu feras ça aussi. On verra. Personne ne te le reprochera, surtout pas moi.` },
      soirs: { qui: 'Itsuki', texte: `Tous. Il n'y a que des soirs. Je ne m'en plains pas.` },
      chante: { qui: '', texte: `Il ferme les yeux et chante un refrain de 2020, un peu faux. Vous reconnaissez la mélodie sans vous rappeler d'où.`, suite: 'chante2' },
      chante2: { qui: 'Itsuki', texte: `Voilà. Ça n'apprend rien à personne. C'est pour ça que c'est bien.` },
      don: { qui: '', texte: `Vous lui tendez le paquet. Il le prend à deux mains, hésite, sourit.`, suite: 'don2' },
      don2: { qui: 'Itsuki', texte: `À moi ? Alors je m'en occupe. Je ne le fumerai pas. Je le poserai sur la table du fond, avec les paroles de chansons. On verra ce qu'il devient.` },
      salle: { qui: 'Itsuki', texte: `C'est une bonne salle. Elle ne demande rien à personne.` },
    },
  },

  // ==========================================================================
  // ITSUKI — le mot sur le toit (fragment 27 trouvé)
  // ==========================================================================
  itsuki_fragment: {
    debut: 'n1',
    noeuds: {
      n1: { qui: 'Itsuki', texte: `Tu as l'air de quelqu'un qui est monté quelque part. Il y avait quelque chose, là-haut ?`, choix: [
        { texte: "Un mot que tu as écrit.", vers: 'lis', effet: m('itsuki_fragment') },
        { texte: 'Non, rien.', vers: 'rien', effet: m('itsuki_fragment') },
      ] },
      lis: { qui: 'Itsuki', texte: `Ah. Je l'avais oublié, celui-là. Lis-le-moi, tu veux ?`, suite: 'lis2' },
      lis2: { qui: '', texte: `Vous lui lisez les premières lignes. Il écoute les yeux fermés, comme on écoute une chanson dont on ne sait plus les paroles.`, suite: 'lis3' },
      lis3: { qui: 'Itsuki', texte: `C'est beau. J'écrivais mieux quand j'étais malheureux.`, choix: [
        { texte: 'Il dit de ne pas le croire.', vers: 'croire' },
        { texte: 'Tu es heureux ?', vers: 'heureux' },
        { texte: 'Tu écrivais ça pour qui ?', vers: 'pour' },
      ] },
      croire: { qui: 'Itsuki', texte: `Il a raison. Il avait toujours raison, ce type-là. Moi, je me crois, maintenant. C'est plus simple.` },
      heureux: { qui: 'Itsuki', texte: `Oui. Pourquoi tu fais cette tête ? Je ne te demande pas de l'être.` },
      pour: { qui: 'Itsuki', texte: `Pour celui qui viendrait. Pour toi, peut-être. Enfin… pour quelqu'un. On verra.` },
      rien: { qui: 'Itsuki', texte: `Alors rien. Les toits sont beaux, de nuit, en tout cas.` },
    },
  },

  // ==========================================================================
  // ITSUKI — l'odeur d'avant (cigarettes.fumees >= 1)
  // ==========================================================================
  itsuki_cigarette: {
    debut: 'n1',
    noeuds: {
      n1: { qui: '', texte: `Itsuki s'est arrêté au milieu d'un refrain. Il hume l'air, les yeux mi-clos.`, suite: 'n2' },
      n2: { qui: 'Itsuki', texte: `Ça sent comme avant. Avant quoi, je ne sais plus. Mon oncle, je crois. Ou un train.`, choix: [
        { texte: 'Tu en veux une ?', vers: 'tend', si: siPaquet, effet: m('itsuki_cigarette', offrirUne) },
        { texte: 'Tu fumais ?', vers: 'fumais', effet: m('itsuki_cigarette') },
        { texte: 'Ça te dérange ?', vers: 'derange', effet: m('itsuki_cigarette') },
        { texte: 'Je peux en allumer une ici ?', vers: 'allumer', si: siPaquet, effet: m('itsuki_cigarette', allumer) },
      ] },
      tend: { qui: '', texte: `Il la prend avec précaution, la tourne, la porte à ses lèvres sans l'allumer.`, suite: 'tend2' },
      tend2: { qui: 'Itsuki', texte: `Je ne l'allume pas. Je la garde là : ça me rappelle quelque chose, et ça me suffit. Merci.` },
      fumais: { qui: 'Itsuki', texte: `Non, jamais. Je crois. C'est étrange, de se souvenir de quelque chose qu'on n'a pas fait.` },
      derange: { qui: 'Itsuki', texte: `Pas du tout. Fume. Moi je chante, toi tu fumes : ça fait deux façons de ne rien faire, ensemble.` },
      allumer: { qui: '', texte: `Vous allumez. Il se met à chanter plus doucement, comme pour accompagner la fumée.`, suite: 'allumer2' },
      allumer2: { qui: 'Itsuki', texte: `Voilà. On dirait un film ancien.` },
    },
  },

  // ==========================================================================
  // ITSUKI — le paquet découvert (cigarettes.decouvert, donne === null)
  // ==========================================================================
  itsuki_paquet: {
    debut: 'n1',
    noeuds: {
      n1: { qui: 'Itsuki', texte: `Tu as l'air de quelqu'un qui porte quelque chose de lourd. Tu veux le poser ici ?`, choix: [
        { texte: 'Mon paquet se remplit tout seul.', vers: 'plein', effet: m('itsuki_paquet') },
        { texte: 'Je voulais te donner le paquet.', vers: 'don', effet: ef(m('itsuki_paquet'), donnerPaquet('itsuki')) },
        { texte: 'Rien.', vers: 'rien', effet: m('itsuki_paquet') },
      ] },
      plein: { qui: 'Itsuki', texte: `Un paquet qui se remplit. Oui. Ça ne m'étonne pas. Ça ne m'étonne plus, plutôt.`, choix: [
        { texte: 'Ça ne te fait rien ?', vers: 'fait' },
        { texte: 'Prends-le.', vers: 'don', effet: donnerPaquet('itsuki') },
      ] },
      fait: { qui: 'Itsuki', texte: `Ça me fait quelque chose. Mais pas assez pour que j'arrête de chanter. Tu comprends ?` },
      don: { qui: '', texte: `Vous lui tendez le paquet. Il le prend à deux mains, hésite, sourit.`, suite: 'don2' },
      don2: { qui: 'Itsuki', texte: `À moi ? Alors je m'en occupe. Je ne le fumerai pas. Je le poserai sur la table du fond, avec les paroles de chansons. On verra ce qu'il devient.` },
      rien: { qui: 'Itsuki', texte: `Alors rien. Je suis là, si tu changes d'avis.` },
    },
  },

  // ==========================================================================
  // ITSUKI — après le don du paquet (cigarettes.donne === 'itsuki')
  // ==========================================================================
  itsuki_apres_don: {
    debut: 'n1',
    noeuds: {
      n1: { qui: 'Itsuki', texte: `Je l'ai mis dans la poche du gilet. Il pèse un peu. Ça me fait penser à un animal qui dort.`, choix: [
        { texte: 'Tu peux en fumer une.', vers: 'fume', effet: m('itsuki_apres_don') },
        { texte: 'Ça va ?', vers: 'va', effet: m('itsuki_apres_don') },
        { texte: "Tu le montres à quelqu'un ?", vers: 'montre', effet: m('itsuki_apres_don') },
      ] },
      fume: { qui: 'Itsuki', texte: `Non. Il est plein, c'est ce que j'aime. On verra, un jour.` },
      va: { qui: 'Itsuki', texte: `Oui. Mieux qu'avant, et pareil.` },
      montre: { qui: 'Itsuki', texte: `À Oba, peut-être. Elle le regarderait comme un enfant. Non, je le garde.` },
    },
  },
};

// ---------- Sélection du dialogue ----------

const PERSONNAGES = ['oba', 'kaede', 'kiosque', 'itsuki'];
const DELAI_DOUTE_MS = 120000;

// Un doute semé produit son effet « il sourit, elle m'a tout expliqué » après 2 minutes.
function doutMur(etat, id, maintenant) {
  if (!Array.isArray(etat.doutesSemes) || !etat.doutesSemes.includes(id)) return false;
  if (vu(etat, id + '_doute_repris')) return false;
  const t = etat.doutesHeure && typeof etat.doutesHeure[id] === 'number' ? etat.doutesHeure[id] : 0;
  return maintenant - t >= DELAI_DOUTE_MS;
}

// Renvoie l'identifiant du dialogue de DIALOGUES_ETAPE2 à lancer avec ce personnage, ou null si
// le personnage n'est pas l'un des quatre. `etat` est l'objet d'état du jeu ; `maintenant`
// (facultatif, en ms) sert aux tests. Voir l'en-tête du fichier pour les conditions.
export function choisirDialogue(personnage, etat, maintenant = Date.now()) {
  if (!PERSONNAGES.includes(personnage) || !etat) return null;
  const n = nbRencontres(etat, personnage);
  const c = cigs(etat);
  const fumees = Number(c.fumees) || 0;
  const donne = c.donne === undefined ? null : c.donne;

  switch (personnage) {
    case 'oba':
      if (n === 0) return 'oba_1';
      if (doutMur(etat, 'oba', maintenant)) return 'oba_apres_doute';
      if (donne === 'oba' && !vu(etat, 'oba_apres_don')) return 'oba_apres_don';
      if (fumees >= 1 && !vu(etat, 'oba_cigarette')) return 'oba_cigarette';
      if (c.decouvert && donne === null && !vu(etat, 'oba_paquet')) return 'oba_paquet';
      if (aPouvoir(etat, 'bond') && !vu(etat, 'oba_toit')) return 'oba_toit';
      if (aFrag(etat, 8) && !vu(etat, 'oba_prix')) return 'oba_prix';
      if ((Number(etat.refus) || 0) >= 5 && !vu(etat, 'oba_refus')) return 'oba_refus';
      return n >= 5 ? 'oba_habitue' : 'oba_retour';

    case 'kaede':
      if (n === 0) return 'kaede_1';
      if (doutMur(etat, 'kaede', maintenant)) return 'kaede_apres_doute';
      if (!aPouvoir(etat, 'bond')) return 'kaede_bond';
      if (!vu(etat, 'kaede_apres_bond')) return 'kaede_apres_bond';
      if (fumees >= 1 && !vu(etat, 'kaede_cigarette')) return 'kaede_cigarette';
      return 'kaede_retour';

    case 'kiosque':
      if (n === 0) return 'kiosque_1';
      if (fumees >= 1 && !vu(etat, 'kiosque_cigarette')) return 'kiosque_cigarette';
      if (aPouvoir(etat, 'lecture') && !vu(etat, 'kiosque_lecture')) return 'kiosque_lecture';
      if (vu(etat, 'kiosque_promesse') && !vu(etat, 'kiosque_promesse_suite')) return 'kiosque_promesse';
      if (aFrag(etat, 19) && !vu(etat, 'kiosque_archive')) return 'kiosque_archive';
      return 'kiosque_retour';

    case 'itsuki':
      if (n === 0) return 'itsuki_1';
      if (aFrag(etat, 27) && !vu(etat, 'itsuki_fragment')) return 'itsuki_fragment';
      if (donne === 'itsuki' && !vu(etat, 'itsuki_apres_don')) return 'itsuki_apres_don';
      if (fumees >= 1 && !vu(etat, 'itsuki_cigarette')) return 'itsuki_cigarette';
      if (c.decouvert && donne === null && !vu(etat, 'itsuki_paquet')) return 'itsuki_paquet';
      return n >= 5 ? 'itsuki_habitue' : 'itsuki_retour';

    default:
      return null;
  }
}
