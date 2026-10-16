# Instances de challenges

Certains challenges démarrent un environnement **dédié à votre équipe** : un site web vulnérable, un service réseau à
exploiter. Vous le lancez à la demande, il dure un temps limité, puis il est détruit.

## Lancer

1. Être **connecté à NetBird** ([guide](index.md#3-installer-netbird-une-seule-fois)).
2. Appartenir à une équipe (page **Équipe**).
3. Ouvrir le challenge et cliquer sur **Lancer l'instance**. Le démarrage prend quelques secondes (jusqu'à quelques
   minutes si la plateforme ajoute de la capacité).
4. Copier l'adresse affichée (par exemple `10.20.70.101` et le port) : c'est votre cible.

```bash
nc 10.20.70.101 1337          # service réseau
curl http://10.20.70.101:8080 # service web
```

L'instance est partagée par toute votre équipe : ce que fait un coéquipier est visible pour les autres.

## Durée, prolongation, arrêt

- Un **compte à rebours** indique le temps restant. À l'expiration, l'instance est détruite et son état est perdu.
- **Prolonger** renouvelle la durée, un nombre limité de fois par challenge.
- **Arrêter** libère vos quotas immédiatement.

## Limites

| Limite | Valeur par défaut |
|---|---|
| instances simultanées par équipe | 3 |
| délai entre deux lancements | 30 secondes |
| durée d'une instance | définie par le challenge (de 1 minute à 6 heures, souvent 30 minutes à 1 heure) |

Si vous dépassez une limite, l'interface l'indique (code 429) : arrêtez une instance ou patientez.

## Instance injoignable

1. `netbird status` : *Connected* ? Sinon `netbird up --management-url ...`.
2. L'instance est-elle toujours active (compte à rebours) ? Sinon relancez-la.
3. Votre équipe est-elle bien constituée ? Les règles d'accès sont créées pour le groupe de **votre équipe**.
4. Patientez 10 à 30 secondes après le lancement, le temps que les règles d'accès se propagent.
5. Essayez l'adresse exacte affichée dans la console, pas une IP voisine : seules les adresses de votre équipe sont
   joignables.
6. Toujours rien : signalez-le aux organisateurs avec le nom du challenge et l'heure.

## Bon usage

L'instance est un bac à sable : vous pouvez l'exploiter à fond, mais pas la dépasser pour atteindre le reste du réseau.
Une instance n'a accès ni à Internet (sauf mention du challenge), ni aux autres instances, ni à la plateforme. Toute
tentative d'évasion vers l'infrastructure est une exclusion.
