# ADR 1 : Routeur et pare-feu : OPNsense en VM

**Statut** : acceptée.

## Contexte

Avant cette plateforme, l'hôte se contentait de NATer le trafic des VM. Il n'y avait aucune segmentation entre services : une VM compromise voyait toutes les autres. Le projet exige sept zones, une matrice de flux « deny all par défaut » et un IDS.

## Décision

Un routeur **OPNsense** en VM route toutes les zones du bridge `vmbr2` (sans uplink). Son premier boot est amorcé par l'import d'un `config.xml` templaté (ISO de configuration générée par tofu, voir `infra/opnsense/`). Ensuite, **toutes** les règles sont gérées par le provider OpenTofu `browningluke/opnsense` (stack `60-opnsense-rules`) : aucune règle n'est saisie dans l'interface.

## Alternatives écartées

- **pfSense** : fork historique, mais provider OpenTofu moins actif et cycle de plugins moins ouvert.
- **VyOS ou routeur Linux (nftables)** : très scriptable, mais on perd l'IDS intégré (Suricata), l'exporter Prometheus clé en main et l'interface de diagnostic.
- **Pare-feu de l'hôte Proxmox seul** : ne segmente pas finement entre VM et ne journalise pas de façon exploitable.

## Conséquences

- Une VM de plus à sauvegarder et à superviser : voir le runbook [OPNsense indisponible](../runbooks/opnsense-down.md).
- Le bootstrap par import clavier de l'importer OPNsense est du best-effort : une procédure manuelle de secours existe dans `infra/opnsense/README.md`.
- Les règles sont relues et rejouables : la matrice de flux de la documentation est la traduction directe du code.
