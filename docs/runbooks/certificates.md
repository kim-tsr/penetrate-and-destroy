# Certificats TLS

Deux sources de certificats : Traefik sur le LXC `edge` (ACME DNS-01, services publics) et cert-manager dans le cluster (ingress interne, ClusterIssuers ACME via webhook DNS).

## Symptômes

- `CertExpiry` (14 jours) et `CertExpiryCritical` (3 jours) : un certificat servi par Traefik approche de l'expiration.
- `CertManagerCertExpiry` / `CertManagerCertNotReady` : un `Certificate` du cluster n'est pas renouvelé ou pas prêt.
- Les navigateurs affichent une erreur de certificat sur un des sites.

## Alertes concernées

| Alerte | Sévérité | Durée | Résumé |
|---|---|---|---|
| `CertExpiry` | warning | 1h | Certificat TLS proche de l'expiration |
| `CertExpiryCritical` | critical | 10m | Certificat TLS expirant sous 3 jours |
| `CertManagerCertExpiry` | warning | 1h | Certificat cert-manager proche de l'expiration |
| `CertManagerCertNotReady` | warning | 15m | Certificat &lt;namespace&gt;/&lt;name&gt; non prêt |

??? info "Expressions PromQL"

    ```promql
    # CertExpiry
    (traefik_tls_certs_not_after - time()) < 14 * 24 * 3600
    # CertExpiryCritical
    (traefik_tls_certs_not_after - time()) < 3 * 24 * 3600
    # CertManagerCertExpiry
    (certmanager_certificate_expiration_timestamp_seconds - time()) < 14 * 24 * 3600
    # CertManagerCertNotReady
    certmanager_certificate_ready_status{condition="False"} == 1
    ```

## Diagnostic

```bash
# Edge (LXC vmid 210)
docker compose --project-directory /opt/pad/edge logs --since 24h traefik | grep -iE "acme|certificate|error"
echo | openssl s_client -connect ctf.example.net:443 -servername ctf.example.net 2>/dev/null | openssl x509 -noout -dates -subject

# Cluster
export KUBECONFIG="$PWD/.state/kubeconfig"
kubectl get certificate -A
kubectl get certificaterequest,order,challenge -A
kubectl describe certificate -n <ns> <nom> | sed -n '/Events/,$p'
kubectl -n cert-manager logs deploy/cert-manager --tail=50
```

## Remédiation

1. **DNS-01 en échec** : le jeton API DNS (OVH) a expiré ou perdu des droits. Créer un nouveau jeton, `sops` du secret concerné (`secrets/edge.sops.yaml` pour Traefik, `gitops/platform/cert-manager/...` pour cert-manager), redéployer (`task ansible:services` ou commit pour ArgoCD).
2. **Limite de débit de l'autorité ACME** : attendre, ne pas boucler sur des retentatives ; utiliser le ClusterIssuer de test pour valider.
3. **Propagation DNS lente** : les `Challenge` restent `pending` ; vérifier que la zone est bien celle du compte (`acme.ovh_endpoint` du contrat).
4. **Certificat `NotReady`** : `kubectl describe` indique la cause (issuer inconnu, webhook indisponible). Supprimer le `CertificateRequest` bloqué fait relancer l'émission.
5. Forcer un renouvellement cert-manager : `kubectl -n <ns> delete secret <nom-du-secret-tls>` (cert-manager le recrée).

## Escalade

Un certificat expiré sur `ctf` ou `auth` rend la plateforme inaccessible aux joueurs : traiter en urgence. Un certificat interne expiré (Grafana, ArgoCD) ne touche que le staff.

Retour à l'[index des runbooks](index.md).
