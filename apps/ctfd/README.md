# CTFd (PenetrateAndDestroy)

Image CTFd officielle épinglée + plugins `pad_*` (`plugins/`). Contrat d'API : `API.md`.

## Build

Contexte = `apps/ctfd` ; le schéma `challenges/schema/challenge.schema.json`
(source unique du format `challenge.yml`, validé par `manager_api`) est apporté
par un contexte nommé, depuis `apps/ctfd` :

```sh
docker buildx build \
  --build-context schema=../../challenges/schema \
  --build-arg SOURCE_DATE_EPOCH=$(git log -1 --format=%ct) .
```

Sans `--build-context schema=...` le build échoue (pas de schéma de secours).

## Tests

`scripts/test.sh` : harnais CTFd officiel, `PAD_CHALLENGE_SCHEMA` pointe sur le
fichier du repo ; les 3 exemples de `challenges/` sont importés par les tests.
