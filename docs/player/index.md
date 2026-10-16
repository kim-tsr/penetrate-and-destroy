# Guide joueur

Ce guide explique comment participer. Il décrit l'interface telle qu'elle est conçue ; les captures d'écran seront
ajoutées après le premier déploiement.

!!! note "Captures à venir"
    Connexion, tableau de bord, liste des challenges, scoreboard, page d'équipe, onboarding NetBird.

## 1. Créer son compte et se connecter

La connexion passe par le SSO de l'événement (Authentik). À la première visite, l'inscription est libre : adresse
e-mail vérifiée, captcha. Un seul compte par personne.

## 2. Rejoindre ou créer une équipe

Page **Équipe**. Deux options :

- **Créer une équipe** : nom et mot de passe ; vous en devenez le capitaine.
- **Rejoindre une équipe** : nom exact et mot de passe, communiqués par le capitaine.

Règles utiles :

- Une personne ne peut appartenir qu'à une équipe.
- Un joueur qui a déjà marqué des points ne peut plus quitter son équipe.
- Un capitaine qui veut partir doit d'abord transférer la capitainerie.
- La taille maximale des équipes est fixée par les organisateurs.

## 3. Installer NetBird (une seule fois)

Les challenges instanciés **ne sont pas exposés sur Internet** : ils ne répondent qu'aux machines connectées au VPN
NetBird de l'événement. La page **Onboarding NetBird** de la console reprend ces étapes avec l'adresse exacte du
serveur.

1. Installer le client (Linux, macOS, Windows) : sous Linux, `curl -fsSL https://pkgs.netbird.io/install.sh | sh`.
2. Se connecter : `netbird up --management-url https://vpn.example.net` ; une fenêtre du navigateur s'ouvre, utiliser le
   **même compte** que sur le site.
3. Vérifier : `netbird status` doit afficher *Connected*. La page d'onboarding dispose aussi d'un test intégré.

Les challenges purement statiques (fichiers à télécharger, flags à trouver hors ligne) ne demandent pas NetBird.

## 4. Jouer

- **Challenges** : liste par catégorie, avec le statut résolu ou non et les points restants (les valeurs de certains
  challenges diminuent à mesure que des équipes les résolvent).
- **Fichiers** : le téléchargement passe par le site ; ne partagez pas les liens, ils expirent.
- **Indices** : certains coûtent des points, la confirmation est demandée.
- **Soumission d'un flag** : format `PAD{...}`, la casse compte sauf indication contraire. Le nombre de tentatives peut
  être limité et les soumissions sont ralenties au-delà d'un certain débit.
- **Scoreboard** : classement en direct. Il peut être gelé avant la fin ; vos soumissions restent comptées.
- **Notifications** : annonces des organisateurs.

## 5. Les instances

Voir [Instances de challenges](instances.md) pour lancer, prolonger et arrêter votre environnement.

## Règles à retenir

- Les cibles sont **uniquement** les adresses d'instances affichées dans votre console.
- Pas d'attaque contre la plateforme (site, SSO, VPN, cluster) : exclusion immédiate.
- Pas de déni de service, de scan massif, ni de force brute des flags.
- Ne partagez ni flags, ni solutions, ni accès à votre instance avec une autre équipe.

Le règlement complet est sur la page **Règles** du site.

## En cas de problème

| Problème | Que faire |
|---|---|
| connexion impossible | réessayer, vider les cookies ; prévenir les organisateurs si l'erreur persiste |
| `netbird status` déconnecté | `netbird up --management-url ...` ; vérifier votre pare-feu local |
| instance injoignable | voir [Instances de challenges](instances.md#instance-injoignable) |
| flag correct refusé | vérifier la casse et les espaces ; challenge à tentatives limitées ? |
| équipe pleine ou mot de passe refusé | demander le bon mot de passe au capitaine |
