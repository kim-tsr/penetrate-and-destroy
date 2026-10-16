# Test de charge k6

Un seul script, `pad.js`, quatre scénarios exécutés en parallèle (`ramping-vus` : montée, palier, descente) :

| Scénario | Cible | Ce qui est fait |
|---|---|---|
| `browse` | front (`PAD_BASE_URL`) + API CTFd | pages (`PAD_BROWSE_PATHS`), puis `GET /api/v1/challenges` et `/api/v1/scoreboard` avec un token joueur |
| `flags` | CTFd | `POST /api/v1/challenges/attempt` avec des flags faux (et le bon, si `PAD_FLAG` + `PAD_FLAG_CORRECT_EVERY`) |
| `sse` | front (`PAD_SSE_PATH`) | ouvre le flux SSE du scoreboard et le garde `PAD_SSE_HOLD_SECONDS` |
| `instances` | CTFd (`chall_manager_bridge`) | `POST` (démarrer), `PATCH` (prolonger), `DELETE` (arrêter) sur `/api/v1/instances/<id>` |

`flags` n'est actif que si `PAD_FLAG_CHALLENGE_ID` est défini, `instances` que si `PAD_INSTANCE_CHALLENGE_IDS` l'est.

## Lancement

```sh
# Local, contre la pile tests/e2e (task e2e -- up && task e2e -- seed)
set -a; . .state/e2e.env; set +a
task load                      # profil smoke par défaut
PAD_PROFILE=load task load     # ou : k6 run tests/load/pad.js

# Serveur (depuis un poste NetBird), avec des tokens existants ou le secret SSO partagé
PAD_BASE_URL=https://<front> PAD_CTFD_URL=https://<ctfd> PAD_TOKENS=tok1,tok2 PAD_PROFILE=load k6 run tests/load/pad.js
```

Les joueurs de test sont créés dans `setup()` par `POST /api/v1/sso/session` (HMAC avec `PAD_SSO_SECRET`) : l'appelant doit
être dans `PAD_SSO_ALLOWED_CIDRS` côté CTFd. Sinon, fournir `PAD_TOKENS` (tokens API valides pendant toute la campagne : le
TTL par défaut est de 900 s, `PAD_SSO_TOKEN_TTL_SECONDS` côté CTFd). Ne jamais committer de token ni de secret.

## Variables

| Variable | Défaut | Rôle |
|---|---|---|
| `PAD_PROFILE` | `smoke` | `smoke` (2 VUs, 20 s), `load` (50 VUs, 5 min), `stress` (200 VUs, 10 min) |
| `PAD_VUS`, `PAD_DURATION` | selon le profil | VUs de référence et durée du palier (`browse` = VUs, `flags` = VUs/2, `sse` = 2 x VUs, `instances` = VUs/5) |
| `PAD_SCENARIOS` | `browse,flags,sse,instances` | sous-ensemble à exécuter |
| `PAD_BASE_URL`, `PAD_CTFD_URL` | `http://127.0.0.1:3000`, `http://127.0.0.1:8000` | front et CTFd |
| `PAD_TOKENS` / `PAD_SSO_SECRET`, `PAD_TOKEN_USERS` (20) | - | tokens joueurs existants, ou secret pour en créer |
| `PAD_BROWSE_PATHS` | `/,/api/health` | pages du front, séparées par des virgules |
| `PAD_SSE_PATH`, `PAD_SSE_HOLD_SECONDS` | `/api/scoreboard/stream`, `20` | flux SSE (à aligner sur le front) et durée de la connexion |
| `PAD_FLAG_CHALLENGE_ID`, `PAD_FLAG`, `PAD_FLAG_CORRECT_EVERY` | - | challenge ciblé, bon flag et fréquence (1 sur N) |
| `PAD_INSTANCE_CHALLENGE_IDS`, `PAD_INSTANCE_HOLD_SECONDS` | -, `2` | challenges `dynamic_instance` (séparés par des virgules) et pause avant la prolongation |
| `PAD_SUMMARY_JSON` | - | chemin d'un export JSON complet du résumé |

## Seuils (le test échoue, code de sortie 99, s'ils sont dépassés)

- global : `checks` > 95 %, `http_req_failed` < 2 % ;
- `browse` : p95 < 800 ms, p99 < 2 s, erreurs < 1 % ;
- `flags` : p95 < 1 s, p99 < 2,5 s, erreurs < 1 % (les 429 de limitation de CTFd sont attendus et suivis par `pad_flag_throttled`) ;
- `sse` : connexion tenue pour 98 % des essais (`pad_sse_ok`), délai avant les premiers octets p95 < 1,5 s ;
- `instances` : lancement p95 < 15 s (`pad_instance_launch_duration`), erreurs < 5 % (429 de quota/cooldown suivis par `pad_instance_throttled`).

Pour valider le scale (cf. docs/PLAN.md, section Scaling), lancer `PAD_PROFILE=stress` en observant le HPA et KEDA de CTFd
et du front, puis le cluster-autoscaler du pool `challenges` (les instances en attente de nœud allongent
`pad_instance_launch_duration`). Côté CTFd, relever `PAD_INSTANCES_MAX_PER_SOURCE` et `PAD_INSTANCES_COOLDOWN_SECONDS`
pour la durée du test, sinon la plupart des lancements seront refusés en 429.

## Limites connues

- k6 n'a pas d'`EventSource` natif : `sse` mesure l'ouverture et la tenue de la connexion, pas le nombre d'évènements reçus
  (extension xk6-sse si nécessaire). Les timeouts de requête de ce scénario sont attendus ; k6 les affiche en avertissements.
- Le chemin SSE et les pages du front sont des valeurs par défaut à aligner sur `apps/frontend` une fois celui-ci stabilisé.
