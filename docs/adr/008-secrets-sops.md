# ADR 8 : Secrets : SOPS et age

**Statut** : acceptée.

## Contexte

Le dépôt est public. Les secrets doivent pourtant être versionnés pour que `task up` reconstruise tout, sans coffre externe à déployer avant la plateforme.

## Décision

Les secrets sont **commités chiffrés** (`*.sops.yaml`). Deux recipients age : l'**opérateur** (tout) et le **cluster** (`gitops/**` uniquement). ArgoCD déchiffre via ksops, Ansible via `community.sops`, OpenTofu via le provider `carlpett/sops`. Des garde-fous (`scripts/check-sops.sh`, gitleaks) empêchent toute fuite. Voir [Chaîne des secrets](../architecture/secrets.md).

## Alternatives écartées

- **Sealed Secrets** : lie les secrets à un cluster : incompatible avec une plateforme reconstruite à chaque fois.
- **External Secrets + Vault** : impose de déployer et d'amorcer un coffre avant le reste.
- **Secrets hors dépôt** : casse la reproductibilité de `task up`.

## Conséquences

- La perte de la clé opérateur est irrécupérable : la sauvegarder hors machine.
- L'historique Git conserve les anciens chiffrements : après une fuite de clé, il faut aussi changer les **valeurs**.
- La CI ne voit jamais une vraie clé : elle valide la forme avec une clé éphémère.
