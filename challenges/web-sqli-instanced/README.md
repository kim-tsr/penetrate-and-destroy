# Portail Admin (solution orgas)

SQLi sur `POST /` (champ `user`) : `admin'--` suffit, le login admin affiche le secret, donc le flag.
Le flag est injecté à l'instanciation via la variable d'env `FLAG` (valeur factice par défaut dans l'image).

Note : le schéma front n'a pas de champ `instance.env` ; l'injection de `FLAG` est faite côté scénario/plugin
(`per_instance_flag`), pas par `challenge.yml`.
Build : `docker build -t web-sqli-instanced .`
