# Import par ZIP

## Préparer l'archive

Un dossier par challenge, avec `challenge.yml` à la **racine** (ou dans l'unique dossier racine de l'archive) et les
fichiers qu'il référence :

```text
web-sqli.zip
  challenge.yml
  assets/
    sujet.pdf
```

```bash
# archive reproductible
cd mon-challenge && zip -X -r ../mon-challenge.zip .
```

### Limites

| Limite | Valeur par défaut | Variable côté CTFd |
|---|---|---|
| taille du ZIP | 50 Mio | `PAD_IMPORT_MAX_ZIP_BYTES` |
| nombre d'entrées | 200 | `PAD_IMPORT_MAX_ENTRIES` |
| taille d'un fichier décompressé | 100 Mio | `PAD_IMPORT_MAX_FILE_BYTES` |
| total décompressé | 200 Mio | `PAD_IMPORT_MAX_TOTAL_BYTES` |
| taille de `challenge.yml` | 256 Kio | `PAD_IMPORT_MAX_YAML_BYTES` |
| ratio de compression | 200 | `PAD_IMPORT_MAX_RATIO` (garde-fou anti zip bomb) |

L'archive est lue en mémoire, jamais extraite sur disque. Sont refusés : chemins absolus ou avec `..`, liens
symboliques, entrées chiffrées ou dupliquées.

## Envoyer

1. Portail manager, **Import**.
2. Déposer le ZIP. Le front valide la forme et le schéma ; CTFd valide une seconde fois.
3. Lire le résultat : action (`created` ou `updated`), type, état, nombre de flags, indices, tags, fichiers envoyés.

## Ce qui se passe

1. Création ou mise à jour **idempotente**, clé = `name`. Flags, indices et tags sont **remplacés** par ceux du fichier.
2. Les fichiers sont téléversés dans Garage (S3) via CTFd ; un fichier inchangé (même sha1) n'est pas renvoyé ; un
   fichier retiré du YAML est supprimé.
3. Avec un bloc `instance`, le scénario est enregistré dans chall-manager. Si celui-ci est injoignable (502), **rien**
   n'est créé côté CTFd.
4. Le challenge reste **masqué** tant que `state: visible` n'est pas demandé.

## Images de conteneurs

Le ZIP ne transporte **pas** d'image. Pour un challenge instancié, l'image doit être déjà dans le registry interne
(`registry.pad.internal`), idéalement signée :

```bash
docker build -t registry.pad.internal/ctf/web-sqli:0.1.0 mon-challenge/app
docker push registry.pad.internal/ctf/web-sqli:0.1.0
cosign sign registry.pad.internal/ctf/web-sqli:0.1.0@sha256:...
```

Le registry est interne : s'y connecter depuis un poste staff NetBird ou depuis le runner de la CI. En mode Git, la CI
s'en charge ([Mode Git](depot-prive.md)).

## Erreurs

| Code | Cause | Que faire |
|---|---|---|
| 400 | champ `file` absent, ZIP illisible | régénérer l'archive |
| 401 / 403 | session expirée / rôle manager manquant | se reconnecter ; vérifier le groupe `ctf-managers` |
| 409 | changement de type, ou plusieurs challenges homonymes | supprimer l'ancien, renommer |
| 413 | archive trop grosse, trop d'entrées, ratio suspect | alléger ; ou relever les `PAD_IMPORT_MAX_*` |
| 422 | `challenge.yml` absent ou non conforme (la liste `chemin: message` est affichée) | corriger, voir [Format](challenge-yml.md) |
| 502 | chall-manager injoignable | voir [Instances](../runbooks/instances.md) |

Un 413 immédiat, avant même la lecture du ZIP, vient souvent de l'ingress : il doit accepter au moins
`PAD_IMPORT_MAX_ZIP_BYTES` sur le chemin d'import.
