# API des plugins CTFd

Cette page inclut telle quelle la référence `apps/ctfd/API.md`, qui est la **source de vérité** du contrat entre CTFd,
le front (BFF), `netbird-sync` et la supervision. Un changement d'endpoint, de format ou de variable
d'environnement se fait dans le même commit que ce fichier.

Plugins décrits : `sso_bridge`, `chall_manager_bridge`, `pad_teams`, `pad_public`, `manager_api`,
`metrics_exporter`, `pad_common`.

---

{% include-markdown "../../apps/ctfd/API.md" heading-offset=1 %}
