# Cockpit Takeover

Le site [Cockpit Takeover](https://ceomelyxja.github.io/CockpitTakeover/) transforme vos rappels en planètes orbitant autour d’un centre. Le visuel reste sobre, sans chiffres ni noms sur les planètes.

## Le site et le widget

- **Le site** sert à écrire et classer vos rappels, choisir ce que chaque sujet signifie et régler les couleurs, tailles et mouvements.
- **Le widget Windows** montre cette carte en transparence derrière les icônes. Il continue de bouger même lorsqu’une autre fenêtre est devant lui.
- Dans le site, cliquez sur **Synchroniser le widget** après vos changements. Le navigateur télécharge un petit fichier dans **Téléchargements**; l’application Windows le lit automatiquement en quelques secondes. Les rappels restent locaux à votre ordinateur et ne sont pas envoyés sur GitHub.
- Une fois synchronisé, vous pouvez fermer le site. Le widget conserve la dernière carte reçue même après sa fermeture.

## La carte des rappels

Chaque rappel a un titre concret, un détail, un sujet, une durée et un état. Un rappel démarré devient une planète; plus son délai s’écoule, plus son orbite rejoint le centre. La pulsation s’accentue doucement à l’approche de l’échéance. Une fois le temps écoulé, la planète rejoint le centre puis disparaît du widget, mais le rappel reste ouvert dans le site. Le clic gauche sur le centre dans le site affiche l’état et les détails des rappels.

Les éléments importés d’un fichier texte restent **À classer** si leur sujet n’est pas clair; rien n’est attribué au hasard. L’aperçu vous permet de confirmer l’importation avant d’ajouter quoi que ce soit.

## Personnaliser l’apparence

Dans **Sujets**, définissez le sens de chaque couleur, sa taille, sa description et son délai proposé. Dans **Apparence**, choisissez le nombre maximal de rappels en orbite, l’échelle des planètes, leur vitesse, la visibilité des orbites et la quantité de petites étoiles blanches. Le site garde vos choix dans le navigateur.

Sur le bureau, seule la planète centrale est interactive : maintenez le clic droit dessus et déplacez-la. Toute la carte suit avec fluidité. Le widget couvre chaque écran en transparence pour que le centre puisse aller partout; les icônes et les autres fenêtres restent devant lui. Les planètes autour ne captent pas les clics.

## Widget Windows

Téléchargez l’application depuis les [versions Windows](https://github.com/CEOMELYXJA/CockpitTakeover/releases/latest). Elle installe un seul raccourci **DumbFuckCockpit Widget** sur le Bureau et ne crée pas de dossier **Trinity**. Ses réglages d’opacité, de mouvement, d’affichage et de démarrage avec Windows restent enregistrés après fermeture.

Le widget est fourni sous forme de paquet Windows généré par GitHub Actions. Une nouvelle version de l’application est publiée à chaque mise à jour du paquet; les mises à jour visuelles du site sont synchronisées avec le widget par le bouton du site.
