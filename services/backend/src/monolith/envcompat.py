"""Legacy environment-variable names.

The product was renamed from Recall to Monolith, so configuration moved from ``RECALL_*`` to ``MONOLITH_*``.
Deployments that still set the old names keep working: a ``MONOLITH_*`` value always wins, and the legacy
``RECALL_*`` name is only consulted when the new one is unset. A variable that is set, even to the empty
string, counts as set (as it always did), so an empty ``MONOLITH_*`` value is not replaced by the legacy one.
This module knows the name mapping; every other module asks for the ``MONOLITH_*`` name.
"""

from __future__ import annotations

import os

PREFIX = "MONOLITH_"
LEGACY_PREFIX = "RECALL_"


def legacy_name(name: str) -> str | None:
    """Return the pre-rename spelling of a ``MONOLITH_*`` variable, or None for unprefixed names."""
    if name.startswith(PREFIX):
        return LEGACY_PREFIX + name[len(PREFIX) :]
    return None


def getenv(name: str, default: str | None = None) -> str | None:
    """Read ``name`` from the process environment, falling back to its legacy ``RECALL_*`` spelling."""
    value = os.environ.get(name)
    if value is not None:
        return value
    legacy = legacy_name(name)
    if legacy is not None:
        value = os.environ.get(legacy)
        if value is not None:
            return value
    return default


def require_env(name: str) -> str:
    """Like ``os.environ[name]`` (raises KeyError naming the new variable) with the legacy fallback."""
    value = getenv(name)
    if value is None:
        raise KeyError(name)
    return value
