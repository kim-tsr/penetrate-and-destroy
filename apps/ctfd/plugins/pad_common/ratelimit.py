"""Limiteur d'échecs avec verrouillage progressif (cache CTFd : Valkey en prod).

Sert à freiner le brute-force d'un secret (mot de passe d'équipe) côté CTFd,
indépendamment du front : le BFF n'est pas la seule porte d'entrée possible.

Principe : chaque clé (utilisateur, équipe cible...) cumule des échecs dans une
fenêtre fixe. Au-delà du seuil, la clé est verrouillée ; la durée du verrou
double à chaque verrouillage successif (backoff), plafonnée, tant que les
« strikes » n'ont pas expiré. Les verrous et compteurs portent un TTL : ils
ne dépendent pas de l'éviction du cache (voir gitops/platform/valkey).
"""

import hashlib
import time

from CTFd.cache import cache

MAX_LOCK_SECONDS = 3600
STRIKE_TTL_SECONDS = 24 * 3600


def _k(scope, ident):
    digest = hashlib.sha256(str(ident).lower().encode()).hexdigest()[:32]
    return f"pad:rl:{scope}:{digest}"


def _incr(key, window):
    cache.cache.add(key, 0, timeout=window)  # crée avec TTL si absente (atomique)
    try:
        return int(cache.cache.inc(key, 1))
    except Exception:  # backend sans inc : repli non atomique
        value = int(cache.get(key) or 0) + 1
        cache.set(key, value, timeout=window)
        return value


def retry_after(scope, ident):
    """Secondes restantes de verrouillage (0 si libre)."""
    until = cache.get(_k(scope + ":lock", ident))
    if not until:
        return 0
    remaining = int(float(until) - time.time())
    return max(0, remaining + 1) if remaining >= 0 else 0


def record_failure(scope, ident, max_failures, window, base_lock):
    """Compte un échec ; verrouille (backoff exponentiel) au-delà du seuil."""
    count = _incr(_k(scope + ":fail", ident), window)
    if count < max_failures:
        return
    strikes = _incr(_k(scope + ":strikes", ident), STRIKE_TTL_SECONDS)
    lock = min(base_lock * (2 ** (strikes - 1)), MAX_LOCK_SECONDS)
    cache.set(
        _k(scope + ":lock", ident), time.time() + lock, timeout=int(lock) + 1
    )
    cache.delete(_k(scope + ":fail", ident))


def reset(scope, ident):
    """Succès : efface les échecs courants (pas les strikes ni les verrous)."""
    cache.delete(_k(scope + ":fail", ident))
