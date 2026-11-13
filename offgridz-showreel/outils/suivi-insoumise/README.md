# suivi-insoumise

Bande de suivi affichée au-dessus de la barre de chat pendant la production du showreel OFFGRIDZ « INSOUMISE ».

Elle montre, en un coup d'œil :

- la phase en cours parmi les cinq (Questions, Concept, Préproduction, Production, Contrôle qualité) ;
- ce qui est en train d'être fait ;
- les crédits Higgsfield dépensés, le budget visé et le plafond autorisé ;
- ce qui attend une décision du client, mis en évidence quand une action est requise.

La bande lit le fichier `offgridz-showreel/suivi.json` du dépôt. Pour la mettre à jour, il suffit de modifier ce fichier :
la bande se redessine après chaque action et à chaque fin de tour. Si le fichier est absent ou illisible, la bande ne s'affiche pas.
