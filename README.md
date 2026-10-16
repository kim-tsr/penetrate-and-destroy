# PenetrateAndDestroy

Plateforme CTF jetable et reconstructible de bout en bout (Proxmox + OPNsense + Talos/Cluster API + ArgoCD + CTFd headless + front Next.js), 100 % IaC.

- Documentation (MkDocs Material) : [docs/index.md](docs/index.md) ; `pip install -r docs/requirements.txt && mkdocs serve`
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
