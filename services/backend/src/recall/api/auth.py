"""Validate provider-issued JWTs. We never mint or accept unsigned tokens."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any, Protocol

import jwt
from jwt import PyJWKClient

from ..config import Settings
from ..errors import unauthenticated


@dataclass(frozen=True)
class Principal:
    user_id: uuid.UUID
    email: str | None


class KeyResolver(Protocol):
    algorithms: list[str]

    def key_for(self, token: str) -> Any: ...


class JwksKeyResolver:
    algorithms = ["RS256", "ES256", "EdDSA"]

    def __init__(self, url: str) -> None:
        self._client = PyJWKClient(url, cache_keys=True, lifespan=600, timeout=10)

    def key_for(self, token: str) -> Any:
        return self._client.get_signing_key_from_jwt(token).key


class StaticKeyResolver:
    """Fixed key; used for HS256 projects and for tests with a locally generated JWKS key."""

    def __init__(self, key: Any, algorithms: list[str]) -> None:
        self._key = key
        self.algorithms = algorithms

    def key_for(self, token: str) -> Any:
        return self._key


class TokenVerifier:
    def __init__(self, resolver: KeyResolver, issuer: str, audience: str) -> None:
        self._resolver = resolver
        self._issuer = issuer
        self._audience = audience

    @classmethod
    def from_settings(cls, settings: Settings) -> TokenVerifier:
        resolver: KeyResolver
        if settings.auth_jwks_url:
            resolver = JwksKeyResolver(settings.auth_jwks_url)
        else:
            assert settings.auth_jwt_secret
            resolver = StaticKeyResolver(settings.auth_jwt_secret, ["HS256"])
        return cls(resolver, settings.auth_issuer, settings.auth_audience)

    def verify(self, token: str) -> Principal:
        try:
            header = jwt.get_unverified_header(token)
            if header.get("alg") not in self._resolver.algorithms:
                raise unauthenticated()
            claims = jwt.decode(
                token,
                self._resolver.key_for(token),
                algorithms=self._resolver.algorithms,
                audience=self._audience,
                issuer=self._issuer,
                options={"require": ["exp", "sub", "iss", "aud"]},
                leeway=30,
            )
            user_id = uuid.UUID(str(claims["sub"]))
        except (jwt.PyJWTError, ValueError, KeyError):
            raise unauthenticated() from None
        email = claims.get("email")
        return Principal(user_id=user_id, email=email if isinstance(email, str) else None)
