# Motionblinds

## Présentation

Cette intégration pilote depuis Gladys les stores, volets et rideaux **Motionblinds** (Coulisse) et les marques
sœurs vendues en Europe sur la même plateforme (Brel Home, Bloc Blinds, Dooya, Acmeda Automate Pulse 2…), **en
local**, par le **pont Wi-Fi Motion** (CM-20, CM-32…) ou un moteur Wi-Fi Motion. Ni cloud ni compte : Gladys parle
au pont sur votre réseau, avec le même protocole que l'application Motion.

Chaque store devient un appareil Gladys : ouvrir / fermer / arrêter, sa position, l'inclinaison des lamelles des
stores vénitiens, la batterie des moteurs sur batterie et le signal radio.

> **Développée sans le matériel : vos retours sont les bienvenus.** L'intégration a été écrite d'après le protocole
> tel que l'utilisent la bibliothèque libre motionblinds et Home Assistant, et testée contre un pont simulé. Si
> quelque chose se comporte bizarrement avec vos stores, ouvrez un ticket sur
> [github.com/guim31/gladys-motionblinds/issues](https://github.com/guim31/gladys-motionblinds/issues).

Cette intégration n'est pas affiliée à Coulisse / Motionblinds.

## Prérequis

- Gladys Assistant 5.1 ou plus récent.
- Un pont Wi-Fi Motion (ou des moteurs Wi-Fi Motion), configuré dans l'application Motion, sur le même réseau que
  Gladys.
- La **clé** de l'application Motion (voir ci-dessous).
- Mieux : une adresse IP fixe pour le pont (une réservation DHCP dans votre box).

## Configuration

Installez l'intégration depuis le store de Gladys, puis ouvrez son onglet **Configuration**.

### La clé de l'application Motion

Le pont n'obéit qu'aux demandes signées avec la clé de votre compte Motion :

1. ouvrez l'application Motion sur votre téléphone ;
2. touchez **⋮** (en haut à droite), puis **Réglages** ;
3. ouvrez la page **À propos** (« Motion APP About ») et touchez-la **cinq fois rapidement** ;
4. une fenêtre affiche la clé : **16 caractères avec des tirets**, comme `12ab345c-d67e-8f`.

Recopiez-la telle quelle, tirets compris, dans **Clé de l'application Motion**. Gladys la garde comme un secret et
elle n'apparaît jamais dans les journaux de l'intégration. Si vos stores utilisent l'application d'une autre marque
bâtie sur la plateforme Motion, la clé se cache en général de la même façon dans sa page À propos.

### L'adresse du pont

**Adresse IP du pont Motion** : l'adresse que votre box a donnée au pont. Pour plusieurs ponts, ou des moteurs Wi-Fi
Motion (chacun est son propre pont), séparez les adresses par des virgules.

Laissée vide, Gladys cherche toute seule les ponts Motion sur le réseau (une demande de découverte sur le port UDP
32100, émise par Gladys pour l'intégration). Certains ponts ne répondent qu'au groupe multicast de l'application
Motion : si rien n'est trouvé, saisissez l'adresse.

### Les autres réglages

- **Intervalle d'actualisation** : fréquence de lecture de l'état des stores (10 à 60 secondes, 30 par défaut).
  Voir « Comment l'état est rafraîchi ».
- **Autoriser la commande des portes de garage** : désactivé par défaut (voir plus bas).
- **Langue des noms des appareils** : noms donnés aux nouveaux appareils et à leurs fonctionnalités.

Lancez ensuite **Rechercher les ponts et les stores** : l'action liste les ponts trouvés, leurs stores, et vérifie
la clé par une demande d'état (rien ne bouge). Ouvrez l'onglet **Découverte** et ajoutez vos stores.

## Appareils

Un appareil par store, nommé d'après son type dans l'application Motion (« Store enrouleur 0001 », « Store vénitien
0002 »…) : renommez-le dans Gladys. Les rideaux sont dans la catégorie rideau, tout le reste dans la catégorie volet.

### Fonctionnalités

| Fonctionnalité               | Ce qu'elle fait                                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Ouvrir / fermer**          | Ouvrir, arrêter, fermer. Indique ouvert ou fermé aux extrémités, arrêté entre les deux, le sens.      |
| **Position**                 | 0 % = fermé, 100 % = ouvert, comme tous les volets de Gladys.                                         |
| **Inclinaison des lamelles** | Stores vénitiens, Shangri-La, à bandes verticales, doubles : 100 % = lamelles ouvertes, 0 % = closes. |
| **Position du rail haut**    | Stores haut-bas : le rail du haut (la position est celle du rail du bas).                             |
| **Batterie**                 | Moteurs sur batterie : le niveau, calculé d'après la tension du pack.                                 |
| **En charge**                | Moteurs sur batterie qui l'indiquent (panneau solaire, chargeur).                                     |
| **Signal radio**             | Moteurs bidirectionnels : le signal radio entre le moteur et le pont, en dBm.                         |

Ce qu'un moteur ne sait pas dire n'est pas publié : un moteur unidirectionnel n'a que **Ouvrir / fermer** (il affiche
la dernière commande envoyée), un moteur qui ne connaît que ses fins de course n'a pas de position. Une fois
l'inclinaison réglée, une nouvelle position la conserve, comme le fait l'application Motion.

L'inclinaison des lamelles est un second curseur, car Gladys n'a pas de fonctionnalité d'inclinaison : dans HomeKit,
elle apparaît comme un second volet portant son nom.

### Portes de garage et portes roulantes

Un moteur Wi-Fi Motion de porte de garage et un store de type « Porte roulante » ouvrent la maison. Par défaut ils
sont publiés **en lecture seule** : leur état s'affiche, mais ni Gladys, ni une scène, ni un assistant vocal ne
peuvent les bouger. Activez **Autoriser la commande des portes de garage** pour les piloter, puis acceptez la mise à
jour que Gladys propose dans l'onglet Découverte. Les boutons du widget ne les bougent jamais, même alors.

## Widget

**Stores Motion** : tous les stores Motion ajoutés à Gladys sur une seule carte, triés par nom, avec la position de
chacun, une batterie sous 20 % et les stores qui ne répondent plus. Ses boutons agissent sur tous à la fois :

- **Tout ouvrir** et **Tout fermer** (avec une confirmation) ;
- **Tout arrêter**.

Les portes de garage et portes roulantes sont listées mais jamais bougées par ces boutons.

## Déclencheur de scène

**Store bougé hors de Gladys** : un store a changé de position sans commande de Gladys : depuis sa télécommande,
l'application Motion, une programmation Motion ou un capteur solaire. Filtres : le store, et le sens (Ouvert, Fermé ;
vide pour les deux). La scène reçoit le sens (`opening`, `closing`) et la nouvelle position en %.

Un changement est vu à la lecture suivante (30 s par défaut). Les changements dans les 3 minutes qui suivent une
commande de Gladys comptent comme venant de Gladys.

## Action de scène

**Aller à la position favorite** : le store va à la position favorite enregistrée dans son moteur (réglée au
préalable avec la télécommande Motion). Ouvrir, fermer, une position et une inclinaison sont les actions habituelles
« Contrôler un appareil » de Gladys.

## Exemples de scènes

- **Au coucher du soleil, fermer la chambre** : déclencheur « Coucher du soleil », action « Contrôler un appareil »
  → **Ouvrir / fermer** du store de la chambre sur « Fermer ».
- **Canicule** : si la température extérieure dépasse 28 °C entre midi et 17 h, régler la **Position** des stores
  plein sud sur 20 % et leur **Inclinaison des lamelles** sur 30 %.
- **Reprise en main** : déclencheur **Store bougé hors de Gladys** sur le salon, sens « Ouvert » → envoyer un message
  « Store du salon ouvert à la main », et laisser vos scènes automatiques le vérifier avant de le refermer.
- **Réveil** : à 7 h 30 en semaine, **Aller à la position favorite** pour le store de la chambre.
- **Batterie** : quand une **Batterie** passe sous 15 %, envoyer un message.

## Comment l'état est rafraîchi

Le pont diffuse chaque changement en multicast, qui n'atteint jamais le conteneur de l'intégration (Gladys le fait
tourner sur un réseau Docker privé). L'intégration lit donc les stores elle-même :

- à chaque **intervalle d'actualisation** (30 s par défaut), elle lit l'état que le pont garde pour chaque store
  ajouté à Gladys. Cela ne coûte rien aux moteurs : aucun trafic radio, le pont répond de mémoire, et sa mémoire suit
  les rapports des moteurs eux-mêmes ;
- toutes les **15 minutes**, elle demande son état par radio à chaque moteur bidirectionnel (Home Assistant le fait
  toutes les 10). Un moteur sur batterie se réveille brièvement pour cela ;
- après une commande, elle interroge le moteur toutes les 5 secondes (10 pour un moteur Wi-Fi) jusqu'à son arrêt,
  2 minutes au plus.

Ni cloud ni quota : tout reste entre Gladys et le pont, une demande à la fois, comme le pont l'attend. Gladys peut
aussi interroger les stores ; un store lu moins d'un demi-intervalle avant est alors sauté.

## Dépannage

- **« Aucun pont Motion trouvé »** : saisissez l'adresse du pont dans la configuration. Vérifiez que Gladys et le pont
  sont sur le même réseau, et que le pont répond dans l'application Motion.
- **« Le pont Motion a refusé la clé »** : recopiez la clé depuis l'application Motion, tirets compris
  (16 caractères). Un nouveau compte Motion change la clé.
- **« Aucun pont Motion ne répond »** : le pont est éteint, ou a changé d'adresse : donnez-lui une adresse fixe dans
  votre box.
- **Un store manque** : appairez-le avec le pont dans l'application Motion, puis lancez **Rechercher les ponts et les
  stores**.
- **La position est en retard** : un changement fait à la télécommande s'affiche à la lecture suivante ; réduisez
  l'intervalle d'actualisation.
- **Plus de détails** : réglez `LOG_LEVEL=debug` sur l'intégration (les journaux ne montrent jamais la clé).

## Limites

- Développée sans le matériel : le détail du protocole vient de la bibliothèque libre motionblinds et de Home
  Assistant ; les types de stores non testés (haut-bas, triangulaires, doubles, portes de garage Wi-Fi) peuvent
  demander des corrections.
- Les changements faits hors de Gladys apparaissent à la lecture suivante, pas instantanément (pas de multicast dans
  le conteneur).
- La découverte automatique peut ne pas trouver tous les ponts : l'adresse peut toujours être saisie.
- Un moteur unidirectionnel ne dit rien : Gladys affiche la dernière commande envoyée, pas ce que le store a fait.
- Un store haut-bas : ouvrir / fermer déplace les deux rails ; les deux curseurs déplacent chacun un rail.
- Le signal Wi-Fi du pont et les réglages des fins de course ne sont pas exposés : réglez-les dans l'application
  Motion.

## Assistance

Questions et signalements : [github.com/guim31/gladys-motionblinds/issues](https://github.com/guim31/gladys-motionblinds/issues),
ou le forum de la communauté Gladys. Indiquez le modèle de votre pont, les types de stores et les journaux de
l'intégration (ils ne contiennent jamais la clé).
