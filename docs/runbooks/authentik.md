# Authentik

Authentik est le fournisseur d'identité de toute la plateforme. Ses erreurs 5xx se traduisent par des connexions impossibles (front, NetBird, Warpgate, Grafana, ArgoCD).

## Symptômes

- `AuthentikServerErrors` : plus de 10 réponses 5xx en 10 minutes.
- Les joueurs voient une erreur à la connexion ou à l'inscription ; les redirections OIDC échouent.
- Les API de configuration (stack `30-authentik`) répondent 5xx.

## Alertes concernées

| Alerte | Sévérité | Durée | Résumé |
|---|---|---|---|
| `AuthentikServerErrors` | warning | immédiat | Authentik renvoie des erreurs 5xx |

??? info "Expressions PromQL"

    ```promql
    # AuthentikServerErrors
    sum(increase(django_http_responses_total_by_status_total{job="authentik", status=~"5.."}[10m])) > 10
    ```

## Diagnostic

```bash
# LXC authentik (vmid 240)
docker compose --project-directory /opt/pad/authentik ps
docker compose --project-directory /opt/pad/authentik logs --since 30m server | tail -50
docker compose --project-directory /opt/pad/authentik logs --since 30m worker | tail -20
docker compose --project-directory /opt/pad/authentik exec postgresql pg_isready

df -h /            # disque plein : cause fréquente de blocage PostgreSQL
free -h
```

## Remédiation

1. PostgreSQL arrêté ou non prêt : `docker compose --project-directory /opt/pad/authentik up -d postgresql`, puis redémarrer `server` et `worker`.
2. Disque plein : voir [Disque saturé](host-disk.md) (journaux Docker, anciennes sauvegardes dans `/var/backups/authentik`).
3. Mémoire insuffisante (OOM) : voir [CPU, mémoire, horloge](host-resources.md) ; le LXC dispose de 1,5 Go.
4. Régression après une mise à jour d'image : revenir au digest précédent dans la configuration Ansible et rejouer `task ansible:services`.
5. **Base corrompue** : restaurer la dernière sauvegarde logique quotidienne (timer `authentik-backup`) : `zcat /var/backups/authentik/authentik-<horodatage>.sql.gz | docker compose --project-directory /opt/pad/authentik exec -T postgresql psql -U <utilisateur> <base>` après arrêt de `server` et `worker`.

## Escalade

**Mode dégradé** pendant la panne : le compte local `admin` de Warpgate (mot de passe SOPS) donne accès au bastion ; CTFd offre un accès local de secours (`PAD_LOCAL_LOGIN_BREAKGLASS`) pour les administrateurs. Les joueurs déjà connectés gardent leur session jusqu'à son expiration. Prévenir les participants si l'événement est en cours.

Retour à l'[index des runbooks](index.md).
