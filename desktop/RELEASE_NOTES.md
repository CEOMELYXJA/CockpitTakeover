# Cockpit Takeover Widget 0.11.13

- Ajoute un numéro de version au script de la page pour obliger Chrome à récupérer le moteur réparé au lieu d’une copie en cache.

# Cockpit Takeover Widget 0.11.12

- Corrige l’erreur d’affichage qui arrêtait le dessin du noyau et des planètes dès qu’un rappel était présent. Les données enregistrées restent intactes.
- Réduit la limite des micro-étoiles et le coût de la texture du noyau pour garder une animation plus légère.

# Cockpit Takeover Widget 0.11.11

- Le clic droit sur une zone vide du bureau démarre le déplacement de la carte, même si le pointeur ne commence pas sur le noyau; les icônes gardent leurs menus Windows.
- La carte conserve le point agrippé sous le curseur et choisit l’écran correspondant au widget.
- Les réglages orbitaux permettent d’écarter et de disperser les planètes de façon stable et propre à chacune.
- Les micro-étoiles ont des teintes plus nuancées et des constellations plus discrètes; le champ étoilé est un peu plus dense.
- Sur téléphone, la page ne se déplace plus avec la constellation, les commandes restent dans la largeur disponible et le contenu du panneau défile à l’intérieur.
- Le clic droit sur le site ne fait plus apparaître le menu contextuel du navigateur.

# Cockpit Takeover Widget 0.11.10

- Le widget reste à sa place quand on commence à le déplacer au clic droit et suit ensuite le mouvement réel de la souris.
- Les coordonnées de chaque écran sont converties séparément entre les pixels physiques de Windows et les DIPs d’Electron, pour éviter que le widget disparaisse ou se bloque sur un écran secondaire.
- Les cratères de la planète centrale ont un relief, une ombre intérieure, une lèvre éclairée et un aplatissement naturel vers le bord de la sphère.
- Sur ordinateur, le panneau réduit disparaît complètement; sa flèche fixe dans la navigation reste le seul moyen de le rouvrir.
- Sur téléphone, un bouton clair permet de masquer le panneau pour retrouver la vue orbitale; le logo reste masqué.
- Les micro-constellations sont plus visibles et plus nombreuses par défaut, avec une limite de réglage relevée.
