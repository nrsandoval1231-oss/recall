"""uvicorn factory for the RCL-002 e2e: the real app with the SYNTHETIC fake provider (no live model)."""

from fake_provider import FakeProvider
from recall.api.app import create_app


def make():  # type: ignore[no-untyped-def]
    return create_app(provider=FakeProvider())
