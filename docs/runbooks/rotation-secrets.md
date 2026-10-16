# Rotation des secrets

Principes : un secret **partagé** doit changer aux deux endroits dans l'ordre qui évite la coupure ; un secret
**exposé** (fuite) impose de changer la *valeur*, pas seulement la clé de chiffrement, car l'historique Git conserve
les anciens chiffrements. Voir [Secrets](../SECRETS.md) pour les mécanismes SOPS.

Après toute modification : `task secrets:check`, commiter les `*.sops.yaml`, puis déployer (`task ansible:services`
pour l'infra, push pour le cluster).

## Secret HMAC front et CTFd (`PAD_SSO_SHARED_SECRET`)

Rotation sans coupure (le plugin `sso_bridge` accepte l'ancienne et la nouvelle valeur pendant la transition) :

1. Générer une valeur aléatoire d'au moins 32 octets.
2. CTFd : `PAD_SSO_SHARED_SECRET_PREVIOUS` = ancienne valeur, `PAD_SSO_SHARED_SECRET` = nouvelle (Secret `ctfd-secrets`,
   fichier SOPS de `gitops/apps/ctfd`). Déployer, laisser CTFd redémarrer.
3. Front : `PAD_SSO_SHARED_SECRET` = nouvelle valeur (Secret `frontend-secrets`). Déployer.
4. Une fois les anciens pods remplacés, retirer `PAD_SSO_SHARED_SECRET_PREVIOUS` de CTFd.

Symptôme d'une rotation ratée : 401 sur `/api/v1/sso/session`, joueurs déconnectés ([Front](frontend.md)).

## Clé age du cluster

```bash
task secrets:rotate-cluster-key      # nouvelle clé, updatekeys + rotation des clés de données gitops/**
git add -A && git commit -m "chore(secrets): rotation de la clé du cluster"
task bootstrap:gitops                # recrée le Secret sops-age avec la nouvelle clé
# puis détruire l'ancienne clé (*.old)
```

Si l'ancienne clé a fuité, changer aussi les **valeurs** des secrets de `gitops/**`.

## Clé age de l'opérateur

1. Générer une nouvelle clé, ajouter sa clé publique sous `keys:` dans `.sops.yaml` et dans les règles.
2. `task secrets:update-keys`, commiter.
3. Retirer l'ancienne clé publique, `task secrets:update-keys` à nouveau, et rechiffrer les données (`sops rotate`).
4. Sauvegarder la nouvelle clé hors machine, détruire l'ancienne.

## Jetons d'infrastructure

| Secret | Où | Comment |
|---|---|---|
| Jeton API Proxmox | `secrets/proxmox.sops.yaml` | nouveau jeton dans Proxmox, `sops`, `task tofu:apply-stack` pour valider ; mettre à jour aussi le Secret de CAPMOX et de Proxmox CSI (`gitops/platform/proxmox-csi`) |
| Jeton DNS OVH | `secrets/ovh.sops.yaml`, `secrets/edge.sops.yaml`, `gitops/platform/{cert-manager,external-dns}` | nouveau jeton chez le fournisseur, remplacer partout où il est utilisé |
| Webhook Discord, SMTP | `secrets/monitoring.sops.yaml` | `sops`, `task ansible:services` |
| PAT NetBird (tofu) | `secrets/netbird-tofu.sops.yaml` | nouveau PAT dans le dashboard, `sops` |
| PAT NetBird de `netbird-sync` | `gitops/apps/netbird-sync` (`NETBIRD_API_TOKEN`) | nouveau PAT de l'utilisateur de service, `sops`, push |
| Secrets clients OIDC | sorties de la stack `30-authentik` | `tofu apply`, recopier les sorties dans les fichiers SOPS concernés (front, NetBird, Warpgate, Grafana, ArgoCD) |
| Mots de passe admin (Authentik, Warpgate, Zot) | `secrets/*.sops.yaml`, `secrets/credentials.sops.yaml` | `sops`, redéployer le service |

## Valeurs partagées en plusieurs endroits

`task secrets:init` génère une seule fois et recopie : mot de passe Valkey (Valkey, `REDIS_PASSWORD` de CTFd,
`VALKEY_URL` du front), secret `metrics` de Zot, compte `pad-pull` de Zot (= `chall-manager-oci`), `bootstrap_token`
d'Authentik (= `authentik-tofu`). Pour les changer, modifier **tous** les fichiers concernés dans le même commit, puis
redémarrer les consommateurs.

## Après une fuite

1. Considérer le secret comme public : le **révoquer** à la source (fournisseur, service) avant de le remplacer.
2. Remplacer la valeur (pas seulement rechiffrer).
3. Chercher d'autres occurrences : `bash scripts/check-sops.sh`, gitleaks (`.gitleaks.toml`).
4. Si le secret est dans l'historique Git d'un dépôt déjà public, la révocation reste la seule vraie protection.
