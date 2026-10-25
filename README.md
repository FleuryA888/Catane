# Catane — L’île vous attend

Une adaptation indépendante et jouable du **jeu de base de Catane**, en français. Jouez seul contre deux ou trois automates, ou partagez un écran entre trois ou quatre personnes. Le dépôt ne contenait aucun code applicatif au départ.

## Lancer le jeu

Avec **Node.js 22 ou ultérieur**, sans installation de dépendances :

```sh
npm start
```

Ouvrir **http://127.0.0.1:4173**. `node scripts/serve.mjs` fonctionne également si npm n’est pas disponible. La variable `PORT` permet de choisir un autre port.

Choisir le mode, trois ou quatre explorateurs et leurs noms, puis cliquer sur **Embarquer pour l’île**. Une graine facultative permet de retrouver la même île. Les emplacements légaux s’illuminent sur le plateau. En solo, les autres joueurs jouent automatiquement ; entre amis, un écran de passage masque les mains.

## Ce qui est jouable

- Plateau hexagonal reproductible : 19 terrains, 54 intersections, 72 arêtes et 9 ports. Répartition classique des terrains et des jetons ; aucun 6 ou 8 adjacent.
- Installation en aller-retour, deux colonies et leurs routes par joueur ; ressources de la seconde colonie.
- Dés indépendants, production de tous les joueurs, villes à production double, blocage du voleur et pénuries de la banque.
- Routes, colonies et villes avec coûts, distance minimale, réseau, blocages adverses et réserves physiques (15 routes, 5 colonies et 4 villes).
- Banque de 19 cartes par ressource, commerce à 4:1, ports généraux à 3:1, ports spécialisés à 2:1.
- Échanges entre le joueur actif et un autre joueur, avec plusieurs ressources et acceptation/refus. Les contre-offres se négocient oralement puis se soumettent dans une nouvelle offre.
- Sur un 7 : défausse choisie de la moitié des ressources au-delà de 7 cartes, déplacement obligatoire et vol pondéré d’une carte au hasard à un adversaire voisin.
- Les 25 cartes développement : 14 Chevaliers, 2 Constructions de routes, 2 Inventions, 2 Monopoles, 5 Points de victoire. Une carte jouable par tour, jamais au tour d’achat, avant ou après le lancer. Les points de victoire constituent l’exception et comptent immédiatement.
- Route la plus longue calculée sur les chemins sans réutiliser d’arête, y compris cycles, branches et interruptions. Armée la plus puissante ; conservation et transfert des distinctions, seuils et égalités.
- Victoire à 10 points pendant son propre tour, points secrets et résultats finaux.
- Automates : placements, production, construction, commerce maritime, cartes, voleur et défausse. Ils n’inspectent pas les ressources cachées de leurs adversaires.
- Interface responsive, commandes de plateau accessibles au clavier (Tab puis Entrée/Espace), focus visible, dialogues, guide des règles et journal public.
- Sauvegarde automatique locale, reprise après rechargement, export/import JSON validé. Une seule partie est sauvegardée par origine du navigateur ; exporter avant de commencer une autre partie.

## Vérifier et compiler

```sh
npm test
npm run build
node scripts/serve.mjs --dist
```

Sans npm, utiliser `node --test` et `node scripts/build.mjs`.

Le build vérifie la syntaxe et produit **dist/**, publiable sur n’importe quel hébergement statique. Aucun serveur de jeu, compte, secret ou paquet tiers n’est requis. Les polices Google sont un enrichissement facultatif : les polices système prennent le relais hors connexion. Les règles et le plateau fonctionnent sans service distant une fois les fichiers servis. Ouvrir directement index.html en `file://` ne convient pas aux modules JavaScript.

Le workflow GitHub Actions exécute les tests, le build et fournit l’archive statique à chaque push/pull request. Les tests comprennent des cas unitaires et douze parties complètes, sur différentes graines, à trois et quatre joueurs. Chaque action simulée vérifie la conservation des ressources et les limites de pions.

## Organisation

```text
src/board.js         Géométrie, ports, terrains et hasard reproductible
src/engine.js        Règles, transitions immuables, scores, sauvegardes
src/bot.js           Décisions des automates via les mêmes actions publiques
src/board-view.js    Plateau SVG et cibles accessibles
src/app.js           Interface, passage des mains, sauvegarde et import/export
src/styles.css       Présentation et adaptations aux tailles d’écran
test/engine.test.js  Cas de règles et simulations de parties entières
scripts/            Serveur local et build statique sans dépendances
```

## Périmètre et limites

- **Jeu local uniquement**, sans salons réseau, comptes ni synchronisation entre appareils. Le mode entre amis suppose un écran partagé et une coopération pour respecter les mains cachées.
- Les sauvegardes et les outils du navigateur contiennent tout l’état, y compris les cartes secrètes. Le rideau de passage est une aide à la discrétion, pas une protection contre un joueur qui inspecte les données locales. Le générateur est reproductible, pas cryptographique.
- Les automates utilisent des heuristiques simples et n’initient pas de négociations entre joueurs ; ils acceptent/refusent les offres reçues. Aucun niveau de difficulté ni promesse de force stratégique.
- Seul le **jeu de base à 3–4 joueurs** est implémenté : pas d’extension 5–6 joueurs, de Marins, de Villes & Chevaliers, de scénarios ni de variantes maison.
- Le plateau propose une distribution aléatoire des jetons sans 6/8 adjacents, plutôt que la procédure physique de pose alphabétique en spirale. Le premier joueur est le premier nom saisi.
- Pas d’annulation après révélation d’informations aléatoires, ni de sauvegardes multiples intégrées. Exporter permet de conserver plusieurs parties.
- L’interface a fait l’objet de vérifications manuelles dans le navigateur ; les tests automatisés ciblent le moteur et le rendu SVG, pas l’ensemble des parcours visuels.

Les illustrations du plateau sont réalisées en SVG dans le projet ; aucune illustration officielle n’est copiée. Catane/CATAN et les règles originales appartiennent à leurs titulaires respectifs. Ce projet n’est pas affilié à l’éditeur.

Références de règles : [règles et almanach du jeu de base](https://www.catan.com/sites/default/files/2021-07/catan-25th-rules_eng-200313.pdf), [FAQ officielle](https://www.catan.com/faq/basegame), [collection des règles officielles](https://www.catan.com/understand-catan/game-rules).
