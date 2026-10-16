# Contrat d'API des plugins CTFd (PenetrateAndDestroy)

Référence pour le front Next.js (BFF), netbird-sync et le monitoring. Rédigé
d'après le code des plugins `sso_bridge`, `chall_manager_bridge`, `pad_teams`,
`pad_public`, `manager_api`, `metrics_exporter` et `pad_common` (CTFd 3.8.8).
Source de vérité du contrat : un changement d'endpoint, de format ou de
variable d'environnement se fait dans le même commit que cette page. Les tests
`apps/ctfd/tests/` (pytest, harnais CTFd) et `apps/frontend/tests/` (vitest +
msw, CTFd simulé `src/mocks/ctfd-fake.ts`) vérifient les formats décrits ici.

## 1. Conventions générales

### 1.1 Authentification

| Schéma | Où | Usage |
|---|---|---|
| HMAC BFF | `POST /api/v1/sso/session` | le BFF échange une identité OIDC contre un token API court |
| Token API CTFd | `Authorization: Token ctfd_...` | tous les endpoints joueur et manager |
| Bearer interne | `Authorization: Bearer <PAD_INTERNAL_TOKEN>` | `GET /api/v1/pad/internal/...` (netbird-sync) |
| Bearer métriques | `Authorization: Bearer <PAD_METRICS_TOKEN>` | `GET /metrics` (VictoriaMetrics) |

Le token API s'obtient via `/api/v1/sso/session` (TTL 300 s par défaut,
`PAD_SSO_TOKEN_TTL_SECONDS`). Un header `Authorization` dispense la requête du
contrôle CSRF de CTFd. Une session par cookie fonctionne aussi, mais les
requêtes mutantes sans header `Authorization` sont alors soumises au jeton
CSRF (`CSRF-Token`) : le BFF doit toujours utiliser le token.

Attention : un cookie de session présent prime sur le header `Authorization`.
Le BFF ne doit pas relayer de cookies CTFd.

**`Content-Type: application/json` obligatoire sur l'API native.** CTFd 3.8 ne
connecte le porteur d'un `Authorization: Token` que si la requête est en JSON
(`request.is_json`), **même pour un GET sans corps**. Sans ce `Content-Type`,
`/api/v1/users/me`, `/api/v1/challenges`, `/api/v1/teams/me`... traitent la
requête comme anonyme (302 vers `/login`, ou 403). Les endpoints des plugins
`pad_*` (`/api/v1/pad/*`, `/api/v1/manager/*`, `/api/v1/instances*`) complètent
ce comportement (`ensure_token_login`) et acceptent le token sans `Content-Type`.
Le BFF envoie donc toujours `Content-Type: application/json` avec un token
(`apps/frontend/src/lib/ctfd/http.ts`) ; test : `tests/test_auth_contract.py`.

Un token d'un compte banni, ou d'une équipe bannie, est refusé (403). Bannir un
compte via `manager_api` supprime aussi tous ses tokens.

### 1.2 Renouvellement du token par le BFF

Les tokens `sso_bridge` vivent 900 s alors que la session Auth.js du navigateur
dure 12 h. Le BFF conserve les claims OIDC dans le cookie de session chiffré et
réémet un token (`POST /api/v1/sso/session`, un nouveau token à chaque appel)
quand celui en main expire dans moins de 30 s. Pour éviter qu'un pic de
requêtes à l'échéance (ou N replicas) ne déclenche N appels :

1. dans un processus, les renouvellements concurrents d'une même identité
   partagent une seule promesse ;
2. entre replicas, le token est partagé dans Valkey (`ctfdtok:<sha256(sub)>`,
   TTL = durée de vie restante - 30 s) et un verrou `SET NX EX 15`
   (`ctfdtok:<sha256(sub)>:lock`) désigne le seul replica qui appelle CTFd ; les
   autres relisent le cache toutes les 100 ms (6 s au plus) ;
3. fail-open : verrou orphelin (replica mort), attente dépassée ou Valkey
   indisponible => le replica émet son propre token. Un verrou ne bloque jamais
   une connexion. Le verrou se libère par compare-and-delete.

Une identité refusée par CTFd (400/401/403/409) déconnecte l'utilisateur ; une
indisponibilité (502...) est propagée sans déconnecter. Tests :
`apps/frontend/tests/services.test.ts` (« singleflight entre replicas »).

### 1.3 Fichiers de challenge : dépendance au `?token=`

`GET /api/v1/challenges/<id>` (token API du joueur) renvoie `files` : des URLs
`/files/<hash>/<nom>?token=<jeton signé>`. Ce jeton (itsdangerous, `max_age`
3600 s) encode joueur, équipe et fichier ; c'est lui, et non `Authorization`,
qui autorise `GET /files/...` quand les challenges ne sont pas publics
(`challenge_visibility` privé) ; sans lui ou falsifié : 403. Conséquences :

- l'URL est un secret au même titre qu'un token : le BFF ne la renvoie jamais
  au navigateur ; il sert `/api/files/<challenge>/<index>`, résout l'URL
  fraîche côté serveur à chaque téléchargement et relaie le flux (en
  `attachment`) ;
- le téléchargement n'envoie pas `Authorization` ;
- une URL gardée plus d'une heure expire : toujours redemander le détail du
  challenge. Tests : `tests/test_auth_contract.py`, `tests/ctfd-client.test.ts`.

Rôles (`pad_roles`, calculés depuis les groupes OIDC par `sso_bridge`) :
`admin` (type CTFd `admin`), `manager`, joueur (aucun rôle). Les endpoints
« manager » acceptent `manager` ou `admin`.

### 1.2 Formats de réponse et d'erreur

- Succès : `{"success": true, "data": ...}` (+ `meta` pour les listes manager).
- Erreur JSON explicite (400/403/404/409/... renvoyées par le code du plugin) :
  `{"success": false, "errors": {"_": ["message"]}}`.
- Erreurs levées par `abort()` selon la route :
  - routes `/api/v1/instances*` (API REST CTFd) : `{"message": "..."}` ;
  - `sso_bridge`, `pad_teams`, `metrics_exporter` : pour 401/403/404/500/502,
    CTFd rend une page HTML. Le front doit se fier au **code HTTP** seul ;
    le corps n'est exploitable que pour les erreurs JSON explicites ;
  - `manager_api` : toujours JSON `{"success": false, "errors": {...}}`, y
    compris 401/403 (handlers de blueprint).
- Dates : ISO 8601 UTC avec suffixe `Z`, sauf mention (epoch en secondes).

---

## 2. sso_bridge

### `POST /api/v1/sso/session`

Provisionne (ou met à jour) l'utilisateur CTFd depuis les claims OIDC et émet
un token API. Appelé uniquement par le BFF (NetworkPolicy + HMAC + option
`PAD_SSO_ALLOWED_CIDRS` sur l'IP source directe).

**Signature HMAC** (en-têtes obligatoires) :

| En-tête | Valeur |
|---|---|
| `X-PAD-Timestamp` | epoch en secondes (entier décimal) |
| `X-PAD-Nonce` | 16 à 128 caractères ASCII, à usage unique |
| `X-PAD-Signature` | hexadécimal (minuscules ou majuscules) de HMAC-SHA256 |

Chaîne signée (séparateur `\n`, pas de `\n` final) :

```
<timestamp>\n<nonce>\n<METHOD en majuscules>\n<path>\n<sha256 hex du corps brut>
```

- `path` = chemin de la requête **sans query string ni hôte** (`/api/v1/sso/session`) ;
- le hash porte sur les **octets exacts** envoyés (signer la chaîne JSON
  sérialisée une seule fois, ne pas la re-sérialiser) ; corps vide = sha256 de
  la chaîne vide ;
- clé = secret partagé `PAD_SSO_SHARED_SECRET` (UTF-8) ; pendant une rotation,
  CTFd accepte aussi `PAD_SSO_SHARED_SECRET_PREVIOUS` ;
- fenêtre : `|now - timestamp| <= PAD_SSO_MAX_SKEW_SECONDS` (60 s) ;
- anti-rejeu : le nonce est mémorisé `2 x fenêtre + 1` s, un nonce rejoué donne 401.

Exemple Node :

```js
const body = JSON.stringify(claims);
const ts = Math.floor(Date.now() / 1000), nonce = crypto.randomUUID().replaceAll("-", "");
const msg = [ts, nonce, "POST", "/api/v1/sso/session",
  crypto.createHash("sha256").update(body).digest("hex")].join("\n");
const sig = crypto.createHmac("sha256", SECRET).update(msg).digest("hex");
// headers: Content-Type: application/json, X-PAD-Timestamp: ts, X-PAD-Nonce, X-PAD-Signature: sig
```

**Corps JSON** :

| Champ | Type | Règle |
|---|---|---|
| `sub` | string | obligatoire, 1 à 255 caractères, identifiant OIDC stable |
| `email` | string | obligatoire, e-mail valide, 128 max (normalisé en minuscules) |
| `preferred_username` | string | optionnel (défaut : partie locale de l'e-mail) ; caractères hors `A-Za-z0-9._- ` retirés, 100 max, suffixe aléatoire si le nom existe |
| `groups` | string[] | défaut `[]` ; au moins un des groupes `PAD_GROUP_ADMINS` (`ctf-admins`), `PAD_GROUP_MANAGERS` (`ctf-managers`), `PAD_GROUP_PLAYERS` (`ctf-players`) |

**200** :

```json
{"success": true, "data": {
  "token": "ctfd_...", "token_id": 1,
  "expires_at": "2026-10-16T12:15:00Z", "ttl": 900, "created": true,
  "user": {"id": 2, "name": "alice", "email": "alice@example.org",
           "type": "user", "roles": ["manager"], "team_id": null, "team_name": null}}}
```

`type` : `user` ou `admin`. `roles` : sous-ensemble de `manager`, `admin`
(vide pour un joueur). Les managers sont masqués du scoreboard
(`PAD_HIDE_MANAGERS`, défaut vrai). Les rôles sont resynchronisés à chaque appel.

| Code | Cas |
|---|---|
| 400 | JSON invalide, `sub`/`email`/`groups` invalides (JSON `errors`) |
| 401 | en-têtes absents, nonce invalide, timestamp invalide ou hors fenêtre, signature fausse, nonce rejoué (HTML) |
| 403 | IP source hors `PAD_SSO_ALLOWED_CIDRS` ; aucun groupe CTF dans `groups` ; compte banni |
| 409 | e-mail déjà utilisé par un compte non lié à ce `sub` (aucune liaison automatique par e-mail) |
| 503 | aucun secret HMAC configuré (fail closed) |

Effets de bord : l'authentification locale de CTFd (`/login`, `/register`,
`/reset_password`, `/confirm`, OAuth MLC) répond 404. Break-glass admin :
`PAD_LOCAL_LOGIN_BREAKGLASS=true` rouvre `/login` aux admins (hôtes limités par
`PAD_LOCAL_LOGIN_HOSTS`).

---

## 3. chall_manager_bridge

Auth : token API (ou session). Identité « source » envoyée à chall-manager :
`team-<id>` en mode équipes (403 « You must join a team first » sans équipe),
`user-<id>` en mode individuel. Les flags d'instance ne sont jamais renvoyés.

Objet **Instance** :

```json
{"challenge_id": 12, "source_id": "team-3", "connection_info": "nc 10.20.70.100 1337",
 "since": "2026-10-16T10:00:00Z", "last_renew": "...", "until": "2026-10-16T10:30:00.123456789Z",
 "expires_in": 1750, "renewals": 0, "max_renewals": 3, "renewals_left": 3,
 "per_instance_flag": false}
```

(`until`/`since`/`last_renew` sont repassés tels que fournis par chall-manager,
nanosecondes possibles ; `expires_in` en secondes, `null` sans échéance.)

| Méthode et chemin | Effet | Succès |
|---|---|---|
| `GET /api/v1/instances` | instances de la source courante | 200 `data: Instance[]` |
| `GET /api/v1/instances/<challenge_id>` | état d'une instance | 200 `data: Instance` |
| `POST /api/v1/instances/<challenge_id>` | démarre l'instance (corps ignoré) | **201** `data: Instance` |
| `PATCH /api/v1/instances/<challenge_id>` | prolonge (TTL renouvelé) | 200 `data: Instance` |
| `DELETE /api/v1/instances/<challenge_id>` | arrête l'instance | 200 `data: {}` |

Erreurs (corps `{"message": "..."}`) :

| Code | Cas |
|---|---|
| 401 | non authentifié |
| 403 | pas d'équipe (mode équipes) ; prérequis non satisfaits ; CTF en pause ou hors période (POST/PATCH, hors manager/admin) |
| 404 | challenge inexistant, non `dynamic_instance`, ou non visible (hors manager/admin) ; instance inexistante (GET/PATCH) |
| 409 | `POST` alors qu'une instance existe déjà |
| 429 | quota `PAD_INSTANCES_MAX_PER_SOURCE` (3) d'instances simultanées ; cooldown `PAD_INSTANCES_COOLDOWN_SECONDS` (30 s) entre deux créations ; plus de renouvellement (`max_renewals`) |
| 502 | chall-manager injoignable ou en erreur |
| 503 | limite globale `PAD_INSTANCES_MAX_TOTAL` (90) d'instances de la plateforme atteinte (message joueur ; managers/admins exemptés) |

`DELETE` est idempotent (404 chall-manager ignoré). Les managers/admins
contournent quota, cooldown, renouvellements, pause et visibilité.

Type de challenge `dynamic_instance` : créé via l'API admin native
(`POST /api/v1/challenges`, champs `scenario`, `instance_config`, `timeout`,
`until`, `max_renewals`, `per_instance_flag`, `destroy_on_solve`, `pool_min`,
`pool_max`) ou via l'import manager (section 5). `GET /api/v1/challenges/<id>`
expose un bloc `instance` (`timeout`, `until`, `max_renewals`,
`per_instance_flag`), plus la configuration complète pour les admins.

---

## 4. pad_teams

Disponibles uniquement en mode équipes (sinon 400 « The CTF is not in teams
mode »). Auth : token API. Corps JSON, `Content-Type: application/json`.

### `POST /api/v1/pad/teams`

Corps `{"name": string (1..128), "password": string}`. Crée l'équipe, le
joueur en devient capitaine. **201** :

```json
{"success": true, "data": {"id": 3, "name": "blue", "captain_id": 2,
                           "members": [{"id": 2, "name": "alice"}]}}
```

| Code | Cas |
|---|---|
| 400 | nom/mot de passe manquant ou nom trop long ; CTF pas en mode équipes |
| 401 | non authentifié |
| 403 | création désactivée ; nombre maximum d'équipes atteint |
| 409 | déjà dans une équipe ; nom déjà pris |

### `POST /api/v1/pad/teams/join`

Corps `{"name", "password"}`. **200** `data` = objet équipe (idem ci-dessus).
403 : informations incorrectes (message volontairement générique), équipe
bannie, taille d'équipe atteinte. 409 : déjà dans une équipe. 400/401 idem.
429 (avec `Retry-After`) : trop d'échecs de mot de passe, par utilisateur ou par équipe cible (verrouillage progressif).

### `POST /api/v1/pad/teams/leave`

Corps `{}`. **200** `data: {}`. L'équipe est supprimée si elle devient vide.
404 : pas dans une équipe. 409 : a déjà marqué des points ; capitaine avec
d'autres membres (« Transfer captaincy before leaving »). 400/401 idem.

### `GET /api/v1/pad/internal/sources/<kind>/<id>` (netbird-sync)

`kind` = `team` ou `user`, `id` entier. Auth : `Authorization: Bearer
<PAD_INTERNAL_TOKEN>` (un token joueur est refusé). **200** :

```json
{"success": true, "data": {"kind": "team", "id": 3, "name": "blue", "banned": false,
                           "members": [{"id": 2, "email": "alice@example.org"}]}}
```

Les membres bannis sont exclus. 401 : bearer absent ou faux ; 404 : source
inconnue ou `kind` invalide ; 503 : `PAD_INTERNAL_TOKEN` non configuré.

---

## 4 bis. pad_public

Lecture pour tout joueur authentifié (token API, section 1.1). Erreurs : 401
non authentifié, 403 compte ou équipe banni (pages HTML : se fier au code HTTP).

### `GET /api/v1/pad/event`

État de l'événement, au même format que `GET /api/v1/manager/event` (section 5)
plus l'heure du serveur :

```json
{"success": true, "data": {"start": 1760600000, "end": 1760700000, "freeze": 1760690000,
  "paused": false, "state": "running", "server_time": 1760650000}}
```

Dates et `server_time` en epoch (secondes), `null` si non définies. `state` :
`not_started`, `running`, `paused`, `frozen`, `ended`, évalué dans cet ordre
(`not_started` si `now < start`, puis `ended` si `now > end`, puis `paused`,
puis `frozen` si `now > freeze`). Le front lit cet endpoint (managers :
`/manager/event`) et en garde la dernière valeur dans Valkey pour les pages
publiques sans session et pour une indisponibilité passagère de CTFd ; sans
copie, repli sur `PAD_EVENT_START` / `PAD_EVENT_END` (variables du front).

### `GET /api/v1/pad/first-bloods[?challenge_id=<id>]`

Premier solve de chaque challenge résolu :

```json
{"success": true, "data": [
  {"challenge_id": 12, "account_id": 5, "account_name": "blue", "user_id": 2,
   "user_name": "alice", "date": "2026-10-16T08:00:00Z"}]}
```

`account_*` = équipe en mode équipes, joueur sinon ; `user_*` = le joueur qui a
soumis. Seuls les comptes visibles comptent (ni bannis ni cachés, donc pas les
managers) : bannir, masquer ou invalider un solve fait remonter le suivant.
Pour un joueur : uniquement les challenges `visible` et les solves antérieurs
au gel du scoreboard (`freeze`) ; les managers voient tout. Un challenge sans
solve est absent. 400 si `challenge_id` n'est pas un entier. Le front fusionne
cette liste dans les listes/détails de challenges (`first_blood` n'existe pas
dans l'API native) et affiche la grille sans first blood si l'appel échoue.

---

## 5. manager_api

Rôle `manager` ou `admin`. Tous les corps d'erreur sont JSON
`{"success": false, "errors": {...}}`. Codes communs : **401** non authentifié
(token invalide ou expiré), **403** rôle manager requis.

### `POST /api/v1/manager/challenges/import`

`multipart/form-data`, champ `file` = archive ZIP contenant `challenge.yml` à
la racine (ou dans l'unique dossier racine) et les fichiers qu'il référence.
Création ou mise à jour **idempotente**, clé = `name`. Flags, indices et tags
sont remplacés par ceux du fichier ; les fichiers sont téléversés via le
provider d'upload de CTFd (S3 Garage en production), un fichier inchangé (sha1)
n'est pas renvoyé ; les fichiers retirés du YAML sont supprimés.

Format `challenge.yml` (ctfcli + `instance`), validé par jsonschema
(`challenges/schema/challenge.schema.json`, source unique copiée dans l'image ; aucun schéma de secours) :

| Champ | Type | Notes |
|---|---|---|
| `name` | string | obligatoire, 80 max, clé d'idempotence |
| `category`, `description` | string | obligatoires |
| `author`, `connection_info` | string | optionnels (`author` -> attribution CTFd) |
| `value` | int >= 0 | obligatoire sauf `type: dynamic` |
| `type` | `standard` \| `dynamic` | `dynamic` = décroissance (`extra`). Un bloc `instance` donne le type CTFd `dynamic_instance` (décroissance conservée si `type: dynamic`) |
| `extra` | `{initial, minimum, decay, function?}` | requis pour `dynamic` (`function` : `linear` ou `logarithmic`, défaut `logarithmic`) ; ignoré sinon |
| `attempts` | int >= 0 | 0 = illimité |
| `state` | `visible` \| `hidden` | défaut `hidden` |
| `flags` | (string \| `{type: static\|regex, content, data: case_sensitive\|case_insensitive}`)[] | au moins un |
| `hints` | (string \| `{content, cost}`)[] | |
| `tags` | string[] | |
| `files` | string[] | chemins relatifs dans le ZIP (nom de base unique) |
| `requirements` | (string \| nombre)[] | noms (ou ids) de challenges existants (prérequis) |
| `topics`, `version` | | acceptés, ignorés |
| `instance` | objet | voir ci-dessous |

`instance` (aucun autre champ accepté) : `image` (requis, référence de
registry), `ports` (requis, entiers 1-65535 ou `{port, protocol: tcp|udp, name?}`),
`ttl` (60 à 21600 s ou durée `90s`/`30m`/`2h`, défaut 1 h), `limits`
(`{cpu: "500m", memory: "256Mi"}`). Scénario (`PAD_GENERIC_SCENARIO`),
renouvellements et flag par instance : défauts du modèle, réglables via l'API
admin. Le challenge devient `dynamic_instance`, son
scénario est enregistré dans chall-manager (création ou mise à jour). Les
paramètres vont dans `instance_config` : `image`, `ports` (`80/tcp,22/tcp`),
`limits_cpu`, `limits_memory`.

**201** (créé) ou **200** (mis à jour) :

```json
{"success": true, "data": {"id": 12, "name": "web-sqli", "action": "created",
  "type": "dynamic_instance", "state": "hidden", "value": 200, "instance": true,
  "flags": 1, "hints": 0, "tags": 2, "files": ["a.bin"], "files_uploaded": ["a.bin"]}}
```

| Code | Cas |
|---|---|
| 400 | champ `file` absent ; ZIP illisible |
| 409 | changement de type d'un challenge existant (supprimer d'abord) ; plusieurs challenges homonymes |
| 413 | archive trop grosse, trop d'entrées, fichier ou total décompressé trop grand, ratio de compression suspect (zip bomb) |
| 422 | `challenge.yml` absent, YAML invalide, non conforme au schéma (`errors["challenge.yml"]` = liste `chemin: message`), chemin dangereux (zip-slip : absolu, `..`, antislash, lecteur), lien symbolique, entrée chiffrée ou dupliquée, fichier listé absent, prérequis inconnu, scoring dynamique incomplet, refus de chall-manager (scénario invalide) |
| 502 | chall-manager injoignable (rien n'est créé côté CTFd) |

Limites (configurables) : `PAD_IMPORT_MAX_ZIP_BYTES` 50 Mio,
`PAD_IMPORT_MAX_ENTRIES` 200, `PAD_IMPORT_MAX_FILE_BYTES` 100 Mio,
`PAD_IMPORT_MAX_TOTAL_BYTES` 200 Mio, `PAD_IMPORT_MAX_YAML_BYTES` 256 Kio,
`PAD_IMPORT_MAX_RATIO` 200. L'archive est lue en mémoire (jamais extraite sur
disque) et les tailles sont mesurées sur les octets réellement décompressés.
L'ingress doit autoriser un corps d'au moins la taille de
`PAD_IMPORT_MAX_ZIP_BYTES` sur ce chemin.

### `GET /api/v1/manager/challenges`

Tous les challenges (tous états). Statistiques calculées sur les comptes
visibles (hors bannis/cachés, donc hors managers). **200** :

```json
{"success": true,
 "data": [{"id": 1, "name": "c1", "category": "web", "type": "standard",
           "state": "visible", "value": 100, "function": "static", "instance": false,
           "tags": ["easy"], "solves": 2, "attempts": 4, "success_rate": 0.5}],
 "meta": {"count": 1, "solves": 2, "attempts": 4, "success_rate": 0.5}}
```

`attempts` = soumissions correctes + incorrectes ; `success_rate` = solves /
attempts (0 sans tentative, 4 décimales).

### `GET /api/v1/manager/challenges/<id>/stats?bucket=hour|day`

**200** `data` = objet de la liste, plus :

```json
{"incorrect_attempts": 2,
 "first_blood": {"account_id": 5, "account_name": "blue", "user_id": 2,
                 "user_name": "alice", "date": "2026-10-16T08:00:00Z"},
 "bucket": "hour",
 "solves_over_time": [{"t": "2026-10-16T08:00:00Z", "solves": 1, "cumulative": 1}]}
```

`first_blood` est `null` sans solve ; `account_*` = équipe en mode équipes,
joueur sinon. `solves_over_time` ne contient que les tranches non vides
(`bucket` défaut `hour`). Erreurs : 400 `bucket` invalide ; 404 challenge inconnu.

### `GET /api/v1/manager/event` et `PATCH /api/v1/manager/event`

Objet événement :

```json
{"start": 1760600000, "end": 1760700000, "freeze": 1760690000,
 "paused": false, "state": "running"}
```

Dates en epoch (secondes), `null` si non définies. `state` :
`not_started`, `running`, `paused`, `frozen`, `ended`.

`PATCH` : corps JSON partiel avec `start`, `end`, `freeze` (epoch entier,
chaîne ISO 8601 ou `null` pour effacer) et/ou `paused` (booléen). Retourne
**200** l'objet événement à jour. Erreurs : 400 corps vide/non JSON, champ
inconnu, date illisible ou négative, `paused` non booléen ; 422 incohérence
(`start >= end`, `freeze` hors de `[start, end]`, vérifiée sur les valeurs
fusionnées avec l'existant).

### Modération

Remplace l'API admin native (réservée au type CTFd `admin`) : un manager
modère sans être admin. Les listes sont paginées :
`?page=1&per_page=50` (`per_page` 1 à 200, sinon 400) et renvoient

```json
{"success": true, "data": [ ... ],
 "meta": {"page": 1, "per_page": 50, "total": 120, "count": 50}}
```

| Méthode et chemin | Effet |
|---|---|
| `GET /api/v1/manager/users[?q=&banned=&hidden=]` | comptes ; `q` = sous-chaîne du nom ou de l'e-mail (insensible à la casse), `banned`/`hidden` = `true`/`false` (400 sinon) |
| `PATCH /api/v1/manager/users/<id>` | corps `{"banned"?: bool, "hidden"?: bool}` ; renvoie l'utilisateur à jour |
| `GET /api/v1/manager/teams[?q=&banned=&hidden=]` | équipes |
| `PATCH /api/v1/manager/teams/<id>` | idem users |
| `GET /api/v1/manager/submissions[?type=&challenge_id=&user_id=&team_id=]` | soumissions, plus récentes d'abord ; `type` : `correct`, `incorrect`, `partial`, `discard`, `ratelimited` |
| `DELETE /api/v1/manager/submissions/<id>` | invalide une soumission (un solve est supprimé : score, scoreboard et first blood recalculés) ; **200** `data: {"id": n}` |
| `GET /api/v1/manager/awards` | awards, plus récents d'abord |
| `DELETE /api/v1/manager/awards/<id>` | invalide un award ; **200** `data: {"id": n}` |

Objets (champs exacts) :

```json
// users[] : roles = sous-ensemble de manager, admin ; type = user | admin
{"id": 2, "name": "alice", "email": "alice@example.org", "type": "user", "roles": [],
 "team_id": 3, "team_name": "blue", "banned": false, "hidden": false,
 "created": "2026-10-16T08:00:00Z"}
// teams[]
{"id": 3, "name": "blue", "captain_id": 2, "member_count": 4, "banned": false,
 "hidden": false, "created": "2026-10-16T08:00:00Z"}
// submissions[] : provided tronqué à 200 caractères
{"id": 7, "type": "correct", "challenge_id": 1, "challenge_name": "c1", "user_id": 2,
 "user_name": "alice", "team_id": 3, "team_name": "blue", "provided": "...",
 "date": "2026-10-16T08:00:00Z"}
// awards[]
{"id": 1, "name": "bonus", "description": null, "category": null, "value": 50,
 "user_id": 2, "user_name": "alice", "team_id": null, "team_name": null,
 "date": "2026-10-16T08:00:00Z"}
```

Règles et erreurs (JSON `errors`) :

| Code | Cas |
|---|---|
| 400 | corps vide ou non JSON, champ inconnu, valeur non booléenne, `page`/`per_page`/filtre invalide |
| 403 | auto-modération ; un manager (non admin) vise un manager ou un admin, ou une équipe qui en contient, ou sa propre équipe |
| 404 | utilisateur, équipe, soumission ou award inconnu |

Effets : bannir un joueur supprime ses tokens API (ses prochains échanges
`/api/v1/sso/session` sont refusés avec 403) ; bannir ou masquer vide les caches
CTFd (sessions, scoreboard, challenges). `PATCH` est idempotent : les champs déjà
à la valeur demandée ne changent rien.

**Journal d'audit.** Chaque action, y compris refusée (`*.denied`), écrit une
ligne JSON sur stderr (logger `pad.audit`, niveau INFO) :

```json
{"event": "pad.audit", "action": "user.moderate", "actor_id": 9, "actor_name": "mgr",
 "target_kind": "user", "target_id": 2, "target_name": "alice",
 "requested": {"banned": true}, "applied": {"banned": true}, "ip": "10.0.0.1"}
```

`action` : `user.moderate`, `team.moderate`, `submission.invalidate`
(champ `submission` : id, type, challenge, comptes, date), `award.invalidate`
(champ `award`), `user.moderate.denied`, `team.moderate.denied` (champ
`reason`). Jamais d'e-mail, de token, ni du flag soumis. `ip` est l'adresse du
pair direct (le BFF), pas celle du joueur : le BFF journalise de son côté
l'identité de l'acteur (`by`).

---

## 6. metrics_exporter

### `GET /metrics`

Auth : `Authorization: Bearer <PAD_METRICS_TOKEN>`. 401 si absent ou faux (HTML),
503 si `PAD_METRICS_TOKEN` n'est pas configuré. Réponse **200**
`text/plain; version=0.0.4` (format d'exposition Prometheus), mise en cache
`PAD_METRICS_CACHE_SECONDS` (15 s) dans le cache partagé : les valeurs sont
identiques sur tous les pods (agréger avec `max without (pod, instance)`).

| Métrique | Type | Labels |
|---|---|---|
| `ctfd_users` | gauge | `kind` = all, banned, hidden, admin |
| `ctfd_teams` | gauge | `kind` = all, banned |
| `ctfd_active_users` | gauge | `window` = 1m, 5m, 15m (alimente KEDA) |
| `ctfd_challenges` | gauge | `state`, `type`, `category` |
| `ctfd_challenge_solves` | gauge | `challenge_id`, `challenge`, `category` |
| `ctfd_challenge_value` | gauge | idem |
| `ctfd_challenge_submissions_total` | counter | `challenge_id`, `challenge`, `result` = correct, incorrect |
| `ctfd_submissions_total` | counter | `result` |
| `ctfd_challenge_first_blood_timestamp_seconds` | gauge | `challenge_id`, `challenge`, `category`, `account` |
| `ctfd_first_bloods` | gauge | nombre de challenges ayant un first blood |
| `ctfd_event_state` | gauge | `state` = not_started, running, paused, frozen, ended (1 = actif) |
| `ctfd_event_start_timestamp_seconds`, `..._end_...`, `..._freeze_...` | gauge | 0 si non défini |
| `pad_instances_active` | gauge | instances actives selon CTFd |
| `ctfd_metrics_generated_timestamp_seconds` | gauge | date de calcul |

---

## 7. Endpoints CTFd natifs utiles au front

Utilisables avec le même token API, **avec `Content-Type: application/json`**
(section 1.1) et non modifiés par les plugins :
`GET /api/v1/users/me`, `GET /api/v1/users/<id>`, `GET /api/v1/challenges`,
`GET /api/v1/challenges/<id>`, `POST /api/v1/challenges/attempt`
(`{"challenge_id", "submission"}`), `POST /api/v1/unlocks`,
`GET /api/v1/hints/<id>`, `GET /api/v1/scoreboard`, `GET /api/v1/scoreboard/top/<n>`,
`GET /api/v1/teams/me`, `GET /api/v1/{users,teams}/me/{solves,fails}`,
`GET /api/v1/notifications`. Les créations/éditions admin natives
(`POST/PATCH /api/v1/challenges`, `/api/v1/users`, `/api/v1/teams`) restent
réservées au type CTFd `admin` et **ne sont plus utilisées par le front** : les
managers passent par l'import et la modération (section 5).

## 8. Variables de configuration

Résolues dans `app.config` puis l'environnement (`pad_common.settings`), lues à
chaque requête (un nouveau Secret Kubernetes est pris en compte au redémarrage
du pod). Une valeur vide équivaut à absente.

| Variable | Défaut | Plugin |
|---|---|---|
| `PAD_SSO_SHARED_SECRET` | - (obligatoire) | sso_bridge |
| `PAD_SSO_SHARED_SECRET_PREVIOUS` | - | sso_bridge |
| `PAD_SSO_MAX_SKEW_SECONDS` | 60 | sso_bridge |
| `PAD_SSO_TOKEN_TTL_SECONDS` | 300 | sso_bridge |
| `PAD_SSO_ALLOWED_CIDRS` | vide | sso_bridge |
| `PAD_GROUP_ADMINS` / `_MANAGERS` / `_PLAYERS` | ctf-admins / ctf-managers / ctf-players | sso_bridge |
| `PAD_HIDE_MANAGERS` | true | sso_bridge |
| `PAD_LOCAL_LOGIN_BREAKGLASS`, `PAD_LOCAL_LOGIN_HOSTS` | false, vide | sso_bridge |
| `PAD_CHALL_MANAGER_URL`, `PAD_CHALL_MANAGER_TIMEOUT_SECONDS` (300), `PAD_CHALL_MANAGER_UPDATE_STRATEGY` (update_in_place), `PAD_GENERIC_SCENARIO` | - | chall_manager_bridge, manager_api |
| `PAD_INSTANCES_MAX_PER_SOURCE`, `PAD_INSTANCES_COOLDOWN_SECONDS`, `PAD_INSTANCES_MAX_TOTAL` | 3, 30, 90 | chall_manager_bridge |
| `PAD_INTERNAL_TOKEN` | - | pad_teams |
| `PAD_TEAM_JOIN_USER_MAX_FAILURES` / `_WINDOW_SECONDS` / `_LOCK_SECONDS` | 5 / 300 / 60 | pad_teams (verrou de base, doublé à chaque récidive, plafond 1 h) |
| `PAD_TEAM_JOIN_TEAM_MAX_FAILURES` / `_WINDOW_SECONDS` / `_LOCK_SECONDS` | 10 / 900 / 300 | pad_teams (échecs cumulés sur l'équipe cible, tous utilisateurs confondus) |
| `PAD_METRICS_TOKEN`, `PAD_METRICS_CACHE_SECONDS` | -, 15 | metrics_exporter |
| `PAD_CHALLENGE_SCHEMA`, `PAD_IMPORT_MAX_*` | voir section 5 | manager_api |

### 8.1 `PAD_SSO_SHARED_SECRET`

Secret HMAC partagé entre le BFF et `sso_bridge` : **la même valeur** dans le
Secret `ctfd-secrets` (clé lue ici) et dans `frontend-secrets` (variable du
front, qui refuse de démarrer sous 32 caractères). Générer une valeur aléatoire
d'au moins 32 octets. Sans secret (ni courant ni précédent), `POST
/api/v1/sso/session` répond 503 (fail closed). Rotation sans coupure :

1. CTFd : `PAD_SSO_SHARED_SECRET_PREVIOUS` = ancienne valeur, `PAD_SSO_SHARED_SECRET`
   = nouvelle valeur (les deux sont acceptés), redémarrer CTFd ;
2. front : `PAD_SSO_SHARED_SECRET` = nouvelle valeur, redémarrer ;
3. une fois les anciens pods remplacés, retirer `PAD_SSO_SHARED_SECRET_PREVIOUS`.

### 8.2 Variables du front (BFF) qui touchent ce contrat

| Variable | Défaut | Rôle |
|---|---|---|
| `CTFD_URL` | `http://ctfd.ctfd.svc.cluster.local:8000` | base des appels du BFF |
| `PAD_SSO_SHARED_SECRET` | - (obligatoire, >= 32 car.) | signature HMAC (8.1) |
| `VALKEY_URL` | vide (repli mémoire, mono-processus) | cache de tokens, verrou de renouvellement, dernière copie de l'événement |
| `PAD_EVENT_NAME` | `PenetrateAndDestroy` | nom affiché |
| `PAD_EVENT_START`, `PAD_EVENT_END` | vide | repli ultime de l'événement (ISO 8601), seulement si CTFd est indisponible et qu'aucune copie n'existe |
