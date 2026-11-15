// Registre des systèmes. Chaque système vit dans son propre fichier de src/systems/
// et s'ajoute ici par une ligne d'import et une ligne d'enregistrement.
// main.js importe ce fichier une fois ; il n'y a rien d'autre à modifier dans main.js.
//
// Ordre d'appel : celui des enregistrements ci-dessous.

import { jeu } from '../game.js';
import { exemple } from './exemple.js';

jeu.enregistrer(exemple);

// Systèmes prévus (étape 1), un fichier chacun :
// import { calque } from './calque.js';           jeu.enregistrer(calque);
// import { fragments } from './fragments.js';     jeu.enregistrer(fragments);
// import { paquet } from './paquet.js';           jeu.enregistrer(paquet);
// import { hashira } from './hashira.js';         jeu.enregistrer(hashira);
// import { conseils } from './conseils.js';       jeu.enregistrer(conseils);
