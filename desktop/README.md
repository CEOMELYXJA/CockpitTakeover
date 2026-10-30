# Widget Windows Cockpit Takeover

## Installer

1. Téléchargez l’installateur depuis les [versions Windows Cockpit Takeover](https://github.com/CEOMELYXJA/CockpitTakeover/releases/latest) et enregistrez-le dans **Téléchargements**.
2. Double-cliquez sur l’installateur. Il crée le raccourci **DumbFuckCockpit Widget** sur le Bureau et ouvre le widget transparent.
3. Le widget apparaît derrière les icônes Windows. Il garde sa dernière carte synchronisée même lorsque le site est fermé.

## Utiliser la carte

Le site [Cockpit Takeover](https://ceomelyxja.github.io/CockpitTakeover/) sert à créer les planètes et à ajuster les réglages orbitaux. Une planète peut représenter un appel, une commission, une rencontre, un problème, une activité, un projet, un objectif ou toute autre chose. Son échéance comprend une date et une heure; couleur, taille et anneaux sont réglables planète par planète.

Après vos changements, cliquez sur **Synchroniser le widget**. Si le widget est ouvert, il récupère automatiquement la copie depuis **Téléchargements**; aucune importation manuelle n’est nécessaire. Les données personnelles demeurent sur votre ordinateur.

Sur le Bureau, maintenez le clic droit sur le noyau central et déplacez-le. La carte entière suit avec fluidité. Les autres planètes ne prennent pas les clics; les icônes restent au premier plan.

Les options Windows d’opacité, de mouvement et de démarrage restent enregistrées après fermeture. Une mise à jour du widget s’installe en téléchargeant la nouvelle version; la carte déjà synchronisée est conservée.

## Réutiliser la couche transparente

Le moteur de fenêtre réutilisable est séparé du rendu Cockpit dans le code de l’application. Son module natif Windows est construit depuis `native`; les adaptations Cockpit restent dans `src/ambient.cjs`, `src/scene-preload.cjs` et les fichiers du widget orbital.
