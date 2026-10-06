"""Validate received bytes are really the declared image type. Never modifies the bytes."""

from __future__ import annotations

import warnings
from pathlib import Path

from PIL import Image, UnidentifiedImageError

from ..errors import unsupported_media

_PIL_FORMAT = {"image/jpeg": "JPEG", "image/png": "PNG"}
# ISO-BMFF brands that identify HEIC/HEIF still images.
_HEIF_BRANDS = {b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis", b"hevm", b"hevs", b"mif1", b"msf1"}


def sniff_media_type(head: bytes) -> str | None:
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if len(head) >= 12 and head[4:8] == b"ftyp":
        brand = head[8:12]
        if brand in _HEIF_BRANDS:
            return "image/heic" if brand.startswith(b"hei") or brand.startswith(b"hev") else "image/heif"
    return None


def validate_content(path: Path, declared: str, *, max_pixels: int) -> None:
    """Raise UNSUPPORTED_MEDIA unless the bytes match `declared` and (for JPEG/PNG) fully decode."""
    with path.open("rb") as handle:
        head = handle.read(32)
    sniffed = sniff_media_type(head)
    heif = {"image/heic", "image/heif"}
    if sniffed is None or not (sniffed == declared or (sniffed in heif and declared in heif)):
        raise unsupported_media("The file content does not match its declared image type.")
    if declared in heif:
        # No portable decoder is bundled; the container signature is validated, the bytes preserved.
        return
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            Image.MAX_IMAGE_PIXELS = max_pixels
            with Image.open(path) as image:
                if image.format != _PIL_FORMAT[declared]:
                    raise unsupported_media("The file content does not match its declared image type.")
                image.load()  # full decode: catches truncated/corrupt data
    except (
        UnidentifiedImageError,
        OSError,
        SyntaxError,
        ValueError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ):
        raise unsupported_media("The image is corrupt, truncated, or too large to decode.") from None
