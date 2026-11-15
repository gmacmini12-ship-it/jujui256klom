// Registre des systèmes. Chaque système vit dans son propre fichier de src/systems/
// et s'ajoute ici par une ligne d'import et une ligne d'enregistrement.
// main.js importe ce fichier une fois ; il n'y a rien d'autre à modifier dans main.js.
//
// Ordre d'appel : celui des enregistrements ci-dessous.

import { jeu } from '../game.js';
import { exemple } from './exemple.js';

jeu.enregistrer(exemple);

// Étape 1
import { calque } from './calque.js';
import { fragments } from './fragments.js';
import { paquet } from './paquet.js';
import { hashira } from './hashira.js';
import { conseils } from './conseils.js';

jeu.enregistrer(calque);
jeu.enregistrer(fragments);
jeu.enregistrer(paquet);
jeu.enregistrer(hashira);
jeu.enregistrer(conseils);

// Étape 2
import { bond } from './bond.js';
import { marche } from './marche.js';
import { npc } from './npc.js';
import { robots } from './robots.js';

jeu.enregistrer(bond);
jeu.enregistrer(marche);
jeu.enregistrer(npc);
jeu.enregistrer(robots);
