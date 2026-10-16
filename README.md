# PenetrateAndDestroy

Plateforme CTF jetable et reconstructible de bout en bout (Proxmox + OPNsense + Talos/Cluster API + ArgoCD + CTFd headless + front Next.js), 100 % IaC.

- Documentation (MkDocs Material) : [docs/index.md](docs/index.md)
  - Comprendre le tout : [Comment tout fonctionne](docs/fonctionnement.md), puis [une page par brique technologique](docs/composants/index.md).
  - Lire en local : `task docs:serve` (aperçu sur http://127.0.0.1:8000, rechargement automatique) ; `task docs:build` (`mkdocs build --strict`, comme la CI).
    Les deux créent le venv `.venv-docs` et y installent `docs/requirements.txt` (versions exactes) s'il est absent. Sans `task` :
    `python3 -m venv .venv-docs && .venv-docs/bin/pip install -r docs/requirements.txt && .venv-docs/bin/mkdocs serve`.
- Plan et décisions : [docs/PLAN.md](docs/PLAN.md)
- Conventions : [CONVENTIONS.md](CONVENTIONS.md)
- Contrats réseau/identité : [infra/contracts.yaml](infra/contracts.yaml)
- Valeurs propres à votre hôte Proxmox (accès, IP publique) : [secrets/site.example.yaml](secrets/site.example.yaml), fournies chiffrées dans `secrets/site.sops.yaml` ([docs](docs/reference/site.md))

```bash
nix develop
task up       # reconstruit tout
task destroy  # supprime tout sauf l'hôte
```

## Licence

MIT, voir [LICENSE](LICENSE). Copyright (c) 2026 Kim Tessier.
