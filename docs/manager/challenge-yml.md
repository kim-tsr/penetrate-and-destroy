# Format `challenge.yml`

Le format est celui de **ctfcli**, étendu d'un bloc `instance` pour les challenges instanciés. Il est validé en trois
endroits avec la même source (`challenges/schema/challenge.schema.json`) : le front à l'envoi, CTFd à l'import, et
`challenges/validate.py` hors ligne.

## Champs

| Champ | Type | Obligatoire | Notes |
|---|---|---|---|
| `name` | texte (80 max) | oui | **clé d'idempotence** : renommer crée un nouveau challenge |
| `category` | texte (40 max) | oui | regroupe les challenges dans l'interface |
| `description` | texte (Markdown) | oui | |
| `author` | texte | non | attribution |
| `value` | entier >= 0 | oui, sauf `type: dynamic` | points |
| `type` | `standard` ou `dynamic` | non (défaut `standard`) | `dynamic` : les points diminuent avec les solves |
| `extra` | `{initial, decay, minimum, function?}` | si `dynamic` | `minimum <= initial` ; `function` : `linear` ou `logarithmic` |
| `connection_info` | texte | non | affiché au joueur |
| `attempts` | entier >= 0 | non | `0` = illimité |
| `flags` | liste | oui (au moins un) | texte, ou `{type: static ou regex, content, data: case_sensitive ou case_insensitive}` |
| `hints` | liste | non | texte, ou `{content, cost}` |
| `tags` | liste de textes | non | |
| `files` | liste de chemins | non | relatifs au ZIP, sans `..`, noms de base uniques |
| `requirements` | liste de noms ou d'ids | non | challenges à résoudre avant celui-ci |
| `state` | `visible` ou `hidden` | non (défaut `hidden`) | un challenge est **masqué par défaut** |
| `version`, `topics` | | non | acceptés, ignorés |
| `instance` | objet | non | rend le challenge instancié, voir ci-dessous |

## Bloc `instance`

Aucun autre champ n'est accepté dans ce bloc.

| Champ | Type | Notes |
|---|---|---|
| `image` | référence de registry | obligatoire ; image déjà présente dans Zot, **sous `registry.pad.internal/ctf/`** et **épinglée par empreinte**, par exemple `registry.pad.internal/ctf/web-sqli:0.1.0@sha256:<64 hex>`. Toute autre référence est refusée (schéma, scénario et Kyverno). |
| `ports` | liste | obligatoire ; entiers 1-65535 ou `{port, protocol: tcp ou udp, name?}` |
| `ttl` | `60` à `21600` secondes, ou `90s`, `30m`, `2h` | défaut 1 h |
| `limits` | `{cpu, memory}` | défaut `500m` / `256Mi` ; plafonds **2 CPU** et **1Gi** (unités `Mi` ou `Gi`). Le disque éphémère est limité à `256Mi` par la plateforme (plafond `1Gi`), les PIDs à 256 par pod. |

Le challenge devient du type CTFd `dynamic_instance`. La décroissance de points est conservée si `type: dynamic`. Le
scénario générique de chall-manager (namespace, Deployment, Service, NetworkPolicy) est enregistré automatiquement.
Renouvellements et flag par instance prennent les valeurs par défaut du modèle et se règlent via l'API admin.

## Exemples

### Statique avec fichier (décroissance logarithmique)

```yaml
name: XOR Warmup
author: orgas
category: crypto
description: |
  Un message a été chiffré avec une clé très courte. Le flag commence par `PAD{`.
type: dynamic
extra:
  initial: 300
  decay: 20
  minimum: 100
  function: logarithmic
flags:
  - type: static
    content: "PAD{CHANGEME}"
    data: case_sensitive
files:
  - cipher.bin
hints:
  - content: "Le début du flag est connu : récupérez la clé."
    cost: 20
tags: [xor, warmup]
state: hidden
version: "0.1"
```

### Instancié web (HTTP)

```yaml
name: Portail Admin
author: orgas
category: web
description: |
  Le portail interne protège un secret derrière un login. Retrouvez-le.
value: 200
connection_info: "Instance dédiée par équipe (HTTP)."
flags:
  - type: static
    content: "PAD{CHANGEME}"
hints:
  - content: "Le formulaire concatène vos entrées dans la requête SQL."
    cost: 25
tags: [sqli, flask]
state: hidden
instance:
  image: registry.pad.internal/ctf/web-sqli-instanced:0.1.0@sha256:0000000000000000000000000000000000000000000000000000000000000000
  ports:
    - port: 8080
      protocol: tcp
      name: http
  ttl: 30m
  limits:
    cpu: 500m
    memory: 256Mi
```

### Instancié réseau (TCP), flag regex et prérequis

```yaml
name: Ret2Win
category: pwn
description: Faites appeler la bonne fonction.
value: 250
connection_info: "nc <hôte> <port> (instance dédiée par équipe)"
flags:
  - type: regex
    content: "PAD\\{ret2win_[a-z0-9_]+\\}"
    data: case_insensitive
requirements:
  - XOR Warmup
attempts: 20
state: hidden
instance:
  image: registry.pad.internal/ctf/pwn-ret2win-instanced:0.1.0@sha256:0000000000000000000000000000000000000000000000000000000000000000
  ports: [1337]
  ttl: 1h
  limits: { cpu: 500m, memory: 128Mi }
```

Les trois exemples complets sont dans `challenges/` du dépôt (`crypto-xor-static`, `web-sqli-instanced`,
`pwn-ret2win-instanced`), avec leurs sources et un `README.md` donnant la solution.

## Contraintes sur les images d'instance

Les instances tournent sous la politique Kyverno PSS `restricted` (voir [Kyverno](../runbooks/kyverno.md)) :

- utilisateur **non-root** (UID numérique), sans élévation de privilèges, `capabilities: drop ALL` ;
- image sous `registry.pad.internal/ctf/` **avec empreinte `@sha256:`** (pas de tag mutable) ; `requests/limits` fournis par le bloc `limits` ;
- système de fichiers : le disque inscriptible est plafonné (`ephemeral-storage` 256Mi par défaut, 1Gi maximum) ;
- au plus 256 processus par pod (fork bomb) ;
- **aucun accès réseau sortant**, DNS compris : l'instance ne résout rien et ne joint rien. Seule l'entrée depuis le routing
  peer NetBird est ouverte ; un challenge qui doit résoudre des noms du cluster est une exception à demander à un admin
  (clé `dns=cluster`, limitée à `cluster.local`) ;
- le conteneur tourne dans un user namespace (`hostUsers: false`) : root dans le conteneur n'est pas root sur l'hôte, mais
  l'image doit de toute façon tourner en non-root.

Une image qui ne les respecte pas est refusée à l'admission et l'instance échoue à démarrer.

## Erreurs fréquentes de validation

| Message | Cause |
|---|---|
| `flags: ...` | aucun flag, ou flag vide |
| `extra: ...` | `type: dynamic` sans `extra`, ou `minimum > initial` |
| `instance.ttl: ...` | durée hors de 60 s à 6 h |
| chemin dangereux | `..`, chemin absolu ou antislash dans `files` |
| fichier listé absent | `files` mentionne un fichier non présent dans le ZIP |
| prérequis inconnu | `requirements` désigne un challenge qui n'existe pas encore (l'importer d'abord) |
| 409 | tentative de changer le **type** d'un challenge existant : le supprimer d'abord |
