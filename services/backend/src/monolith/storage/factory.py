from __future__ import annotations

from ..config import Settings
from . import ObjectStore
from .local import LocalObjectStore
from .supabase import SupabaseObjectStore


def build_object_store(settings: Settings) -> ObjectStore:
    if settings.storage_backend == "supabase":
        assert settings.supabase_url and settings.supabase_service_role_key
        return SupabaseObjectStore(settings.supabase_url, settings.supabase_service_role_key, settings.storage_bucket)
    return LocalObjectStore(settings.local_storage_dir)
