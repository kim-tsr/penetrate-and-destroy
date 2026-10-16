# Scénario Pulumi Go (instance générique)

**Couche** : Applications CTF · **Où** : binaire exécuté par chall-manager ; publié en OCI dans Zot · **Version** : scénario `0.1.0` ; Go 1.27.2, Pulumi SDK v3.219.0, SDK chall-manager v0.6.6

## À quoi elle sert ici et pourquoi ce choix

Un seul scénario générique, paramétré par le challenge (image, ports, limites, TTL), suffit pour les challenges « un conteneur ». Il crée tout ce qu'il faut pour une instance **isolée** et
renvoie la `connection_info` (IP:port) au joueur.

## Où elle tourne et comment elle est déployée

`apps/chall-manager-scenario/build.sh` compile un binaire statique et pousse `Pulumi.yaml` et `main` en artefact OCI (`oras`) dans Zot. chall-manager le récupère au moment de créer l'instance ;
aucune toolchain Go n'est nécessaire dans le cluster.

## Version épinglée

`apps/chall-manager-scenario/go.mod` (Go 1.27.2 ; `pulumi-kubernetes/sdk/v4` v4.25.0 ; `pulumi/sdk/v3` v3.219.0) ; référence OCI : `apps.chall_manager.generic_scenario` du contrat, tag `0.1.0`
(`PAD_GENERIC_SCENARIO` dans `gitops/apps/ctfd/deployment.yaml`).

## Fichiers de configuration dans le dépôt

`apps/chall-manager-scenario/` : `main.go`, `scenario.go` (ressources), `config.go` (validation des clés `additional`), `Pulumi.yaml`, `build.sh`, tests `*_test.go`.

## Interactions avec les autres briques

Exécuté par [chall-manager](chall-manager.md) ; l'IP est allouée par [Cilium](cilium-hubble.md) (pool `instances`) ; les pods sont admis par [Kyverno](kyverno.md) ; l'accès est ouvert par [netbird-sync](netbird-sync.md).

## Sécurité

- Namespace `inst-<identité>` en PSS `restricted` ; pod `runAsNonRoot`, `seccomp: RuntimeDefault`, `allowPrivilegeEscalation: false`, `drop: ALL`, sans jeton de ServiceAccount ni variables de service.
- Placement sur le pool `challenges` (nodeSelector et toleration du taint).
- `NetworkPolicy` default-deny : entrée uniquement depuis le routing peer NetBird (`10.20.70.10/32`) et l'overlay (`100.64.0.0/10`) sur les ports déclarés ; sortie limitée au DNS.
- `externalTrafficPolicy: Local` pour préserver l'IP source de la policy.

## Supervision

Erreurs de création : `ChallManagerErrorRate` ([Instances](../runbooks/instances.md)) ; pool d'IP épuisé : message « aucune IP LoadBalancer allouée (pool épuisé ?) ».

## Opérations courantes

```bash
cd apps/chall-manager-scenario && go test ./...
./build.sh 0.1.0            # binaire dans dist/
./build.sh 0.1.0 --push     # publie dans Zot (oras login requis)
```

## Pièges connus

- L'identité (`team-<id>`) devient un nom de namespace DNS-1123 de 63 caractères au plus ; les caractères invalides sont remplacés.
- Les labels `pad.io/team` et `pad.io/challenge` sont posés sur les ressources : [netbird-sync](netbird-sync.md) en dépend.
- Un pool `instances` de 100 adresses borne le nombre d'instances simultanées.

## Documentation officielle

[www.pulumi.com/docs](https://www.pulumi.com/docs/) · [ctfer.io/docs/chall-manager](https://ctfer.io/docs/chall-manager/)

[Retour à l'index des composants](index.md){ .md-button }
