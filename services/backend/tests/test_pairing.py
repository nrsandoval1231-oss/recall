"""Synthetic pairing input validation and disabled-by-default activation preflight."""

import pytest

from recall.config import Settings
from recall.pairing import digest, validate_secret


def test_pairing_secret_is_exactly_32_bytes_lowercase_hex_and_fingerprint_is_sha256() -> None:
    secret = "0a" * 32
    validate_secret(secret)
    assert len(digest(secret)) == 64
    for invalid in ("", "0a" * 31, "0A" * 32, "0a " * 21 + "0a", "g0" * 32):
        with pytest.raises(ValueError):
            validate_secret(invalid)


def test_server_pairing_activation_defaults_off() -> None:
    assert Settings.model_fields["device_pairing_enabled"].default is False
