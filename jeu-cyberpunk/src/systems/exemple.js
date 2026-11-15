// Système d'exemple, minimal : il mesure le temps passé dans la zone courante.
// Copier ce fichier pour écrire un nouveau système (voir docs/architecture.md).
//
// Toutes les méthodes sont facultatives et reçoivent `jeu` en dernier argument :
//   preparer(jeu)            avant la construction des zones (régler jeu.config)
//   init(jeu)                tout est construit (hud, interact, zones…), avant la première zone
//   update(dt, t, jeu)       à chaque image, même en pause ou pendant un dialogue
//                            (tester jeu.jouable si le système ne doit agir qu'en jeu)
//   surZone(nom, zone, jeu)  à chaque entrée dans une zone (y compris la première)
//   apresRendu(jeu)          après composer.render() (pour un rendu en surimpression)

export const exemple = {
  nom: 'exemple',
  tempsDansZone: 0,

  init(jeu) {
    // s'abonner à un évènement : jeu.on(nom, (donnees, jeu) => …)
    jeu.on('partie:nouvelle', () => (this.tempsDansZone = 0));
  },

  surZone() {
    this.tempsDansZone = 0;
  },

  update(dt, t, jeu) {
    if (jeu.jouable) this.tempsDansZone += dt;
  },
};
