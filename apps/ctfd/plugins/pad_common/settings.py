"""Lecture de la configuration des plugins.

Ordre de résolution : `app.config[NAME]` (pratique pour les tests) puis
variable d'environnement `NAME`, puis valeur par défaut. Aucune valeur n'est
mise en cache : un changement de Secret Kubernetes est pris en compte au
redémarrage du pod sans code supplémentaire.
"""

import os

from flask import current_app

_TRUE = {"1", "true", "yes", "on"}


def setting(name, default=None):
    try:
        value = current_app.config.get(name)
    except RuntimeError:  # hors contexte applicatif
        value = None
    if value is None:
        value = os.environ.get(name)
    if value is None or value == "":
        return default
    return value


def setting_bool(name, default=False):
    value = setting(name)
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in _TRUE


def setting_int(name, default):
    value = setting(name)
    if value is None:
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def setting_list(name, default=None):
    value = setting(name)
    if value is None:
        return list(default or [])
    if isinstance(value, (list, tuple)):
        return [str(v).strip() for v in value if str(v).strip()]
    return [v.strip() for v in str(value).split(",") if v.strip()]
