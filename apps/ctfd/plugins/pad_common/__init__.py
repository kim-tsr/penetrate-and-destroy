"""Briques partagées par les plugins PenetrateAndDestroy (pad_*).

Ce module n'enregistre aucune route : CTFd charge chaque dossier de
`CTFd/plugins/` et appelle `load(app)`, d'où la fonction vide ci-dessous.
Les autres plugins importent `CTFd.plugins.pad_common.*`.
"""


def load(app):  # noqa: D401 - signature imposée par CTFd
    """Aucun enregistrement : bibliothèque partagée."""
    app.logger.info("pad_common chargé")
