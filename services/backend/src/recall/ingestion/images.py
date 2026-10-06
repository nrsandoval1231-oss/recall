"""Model-input derivatives. The original is never modified; derivatives are transient, metadata-free,
orientation-corrected JPEGs bounded for provider limits, and identified by their own hash."""

from __future__ import annotations

import hashlib
import io

from PIL import Image, ImageOps
from pillow_heif import register_heif_opener

register_heif_opener()

TRANSFORM_VERSION = "jpeg-rgb-exif-orient-v1"
REQUEST_IMAGE_BUDGET = 22 * 1024 * 1024  # raw bytes across all pages, leaving headroom for base64 + text


class DerivativeError(Exception):
    pass


def make_derivative(original: bytes, *, max_edge: int, max_bytes: int) -> tuple[bytes, str]:
    """Return (jpeg_bytes, sha256). Raises DerivativeError if the original cannot be decoded."""
    try:
        with Image.open(io.BytesIO(original)) as opened:
            # apply orientation, then drop all metadata
            image: Image.Image = ImageOps.exif_transpose(opened).convert("RGB")
            image.thumbnail((max_edge, max_edge))
            for quality in (90, 82, 74, 66, 58):
                buffer = io.BytesIO()
                image.save(buffer, format="JPEG", quality=quality, optimize=True)  # no exif= -> stripped
                data = buffer.getvalue()
                if len(data) <= max_bytes:
                    return data, hashlib.sha256(data).hexdigest()
            # still too large: shrink further once
            image.thumbnail((max_edge * 3 // 4, max_edge * 3 // 4))
            buffer = io.BytesIO()
            image.save(buffer, format="JPEG", quality=70, optimize=True)
            data = buffer.getvalue()
    except (OSError, ValueError, SyntaxError) as exc:
        raise DerivativeError("page could not be decoded for reading") from exc
    if len(data) > max_bytes:
        raise DerivativeError("page is too large to send for reading")
    return data, hashlib.sha256(data).hexdigest()
