"""A01/A04: ordered capture, formats, invalid/corrupt/oversized content."""

from __future__ import annotations

import struct
import uuid

import pytest

from conftest import Env, create_capture, finalize, manifest_for, sha, stored_capture, synthetic_image, upload_all


def heic_bytes() -> bytes:
    # Synthetic ISO-BMFF header (not a decodable photo): ftyp box with the 'heic' brand.
    box = b"ftyp" + b"heic" + b"\x00\x00\x00\x00" + b"mif1heic"
    return struct.pack(">I", len(box) + 4) + box + b"synthetic-heic-payload" * 4


def test_one_page_capture_end_to_end(env: Env) -> None:
    user = env.user()
    data = synthetic_image(seed=1)
    capture = stored_capture(user, [data])
    assert capture["status"] == "stored" and capture["memory_id"] is None
    page = capture["pages"][0]
    assert page["upload_state"] == "verified" and page["server_sha256"] == sha(data)
    content = user.req("GET", f"/v1/sources/{page['source_id']}/content")
    assert content.status_code == 200 and content.content == data
    assert content.headers["content-type"] == "image/jpeg"
    assert content.headers["x-recall-source-sha256"] == sha(data)
    assert content.headers["x-content-type-options"] == "nosniff"
    assert "no-store" in content.headers["cache-control"]


def test_multi_picture_camera_jpeg_is_accepted(env: Env) -> None:
    """Phone cameras write MPF/MPO JPEGs; Pillow reports format 'MPO'. They are legitimate originals."""
    import io

    from PIL import Image

    frames = [Image.new("RGB", (32, 32), (200, 10, 10)), Image.new("RGB", (32, 32), (10, 10, 200))]
    buffer = io.BytesIO()
    frames[0].save(buffer, format="MPO", save_all=True, append_images=frames[1:])
    data = buffer.getvalue()
    assert data.startswith(b"\xff\xd8\xff") and Image.open(io.BytesIO(data)).format == "MPO"
    user = env.user()
    capture = stored_capture(user, [data])
    got = user.req("GET", f"/v1/sources/{capture['pages'][0]['source_id']}/content")
    assert got.content == data and got.headers["content-type"] == "image/jpeg"


def test_multipage_order_is_preserved_even_when_uploaded_out_of_order(env: Env) -> None:
    user = env.user()
    user.register_device()
    pages = [synthetic_image(seed=s) for s in (1, 2, 3, 4)]
    manifest = manifest_for(user, pages)
    manifest["pages"] = list(reversed(manifest["pages"]))  # type: ignore[arg-type]
    created = create_capture(user, manifest).json()
    assert [p["ordinal"] for p in created["pages"]] == [1, 2, 3, 4]
    assert [p["declared_sha256"] for p in created["pages"]] == [sha(d) for d in pages]
    auths = user.req("POST", f"/v1/captures/{created['capture_id']}/upload-authorizations").json()["authorizations"]
    by_source = {a["source_id"]: a for a in auths}
    for page, data in reversed(list(zip(created["pages"], pages, strict=True))):
        auth = by_source[page["source_id"]]
        assert user.req("PUT", auth["url"], content=data, headers=auth["required_headers"]).status_code == 200
    final = finalize(user, created).json()
    assert [p["ordinal"] for p in final["pages"]] == [1, 2, 3, 4]
    for page, data in zip(final["pages"], pages, strict=True):
        assert user.req("GET", f"/v1/sources/{page['source_id']}/content").content == data


@pytest.mark.parametrize(
    ("media_type", "data"),
    [
        ("image/jpeg", synthetic_image("JPEG")),
        ("image/png", synthetic_image("PNG")),
        ("image/heic", heic_bytes()),
        ("image/heif", heic_bytes()),
    ],
)
def test_supported_formats_are_stored_byte_for_byte(env: Env, media_type: str, data: bytes) -> None:
    user = env.user()
    user.register_device()
    created = create_capture(user, manifest_for(user, [data], media_type=media_type)).json()
    upload_all(user, created, [data])
    final = finalize(user, created).json()
    got = user.req("GET", f"/v1/sources/{final['pages'][0]['source_id']}/content")
    assert got.content == data and got.headers["content-type"] == media_type


def _bad_manifest_cases(user):  # type: ignore[no-untyped-def]
    good = manifest_for(user, [synthetic_image()])
    p = good["pages"][0]  # type: ignore[index]

    def mutate(**changes):  # type: ignore[no-untyped-def]
        m = manifest_for(user, [synthetic_image()])
        m["pages"][0].update(changes.pop("page", {}))  # type: ignore[index]
        m.update(changes)
        return m

    return {
        "gif": (mutate(page={"media_type": "image/gif"}), 415, "UNSUPPORTED_MEDIA"),
        "oversized": (mutate(page={"byte_size": 26214401}), 413, "PAYLOAD_TOO_LARGE"),
        "zero_bytes": (mutate(page={"byte_size": 0}), 422, "VALIDATION_ERROR"),
        "bad_hash": (mutate(page={"sha256": "XYZ"}), 422, "VALIDATION_ERROR"),
        "uppercase_hash": (mutate(page={"sha256": p["sha256"].upper()}), 422, "VALIDATION_ERROR"),
        "extra_field": (mutate(workspace_id=str(uuid.uuid4())), 422, "VALIDATION_ERROR"),
        "bad_version": (mutate(schema_version="2.0"), 422, "VALIDATION_ERROR"),
        "bad_kind": (mutate(source_kind="typed_text"), 422, "VALIDATION_ERROR"),
        "no_pages": (mutate(pages=[]), 422, "VALIDATION_ERROR"),
        "ordinal_gap": (mutate(page={"ordinal": 2}), 422, "VALIDATION_ERROR"),
        "bad_date": (mutate(captured_at="yesterday"), 422, "VALIDATION_ERROR"),
        "hint_too_long": (mutate(context_hint="x" * 2001), 422, "VALIDATION_ERROR"),
    }


def test_invalid_manifests_are_rejected_with_stable_codes(env: Env) -> None:
    user = env.user()
    user.register_device()
    for name, (manifest, status, code) in _bad_manifest_cases(user).items():
        resp = create_capture(user, manifest)
        assert (resp.status_code, resp.json()["error"]["code"]) == (status, code), name
        assert resp.json()["error"]["request_id"]
    assert user.req("GET", "/v1/captures").json()["items"] == []


def test_page_count_and_batch_limits(env: Env) -> None:
    user = env.user()
    user.register_device()
    ten = [synthetic_image(seed=i) for i in range(10)]
    assert create_capture(user, manifest_for(user, ten)).status_code == 201
    eleven = manifest_for(user, [synthetic_image(seed=i) for i in range(11)])
    assert create_capture(user, eleven).status_code == 422
    # 5 pages x 25 MiB declared = 125 MiB > 100 MiB batch limit
    big = manifest_for(user, [synthetic_image()] * 5)
    for page in big["pages"]:  # type: ignore[attr-defined]
        page["byte_size"] = 25 * 1024 * 1024
    assert create_capture(user, big).json()["error"]["code"] == "PAYLOAD_TOO_LARGE"


def test_duplicate_ordinals_and_page_ids_rejected(env: Env) -> None:
    user = env.user()
    user.register_device()
    m = manifest_for(user, [synthetic_image(seed=1), synthetic_image(seed=2)])
    m["pages"][1]["ordinal"] = 1  # type: ignore[index]
    assert create_capture(user, m).status_code == 422
    m = manifest_for(user, [synthetic_image(seed=1), synthetic_image(seed=2)])
    m["pages"][1]["client_page_id"] = m["pages"][0]["client_page_id"]  # type: ignore[index]
    assert create_capture(user, m).status_code == 422


def _upload_one(user, data: bytes, *, declared: bytes | None = None, media_type="image/jpeg"):  # type: ignore[no-untyped-def]
    user.register_device()
    declared = declared if declared is not None else data
    created = create_capture(user, manifest_for(user, [declared], media_type=media_type)).json()
    auth = user.req("POST", f"/v1/captures/{created['capture_id']}/upload-authorizations").json()["authorizations"][0]
    resp = user.req("PUT", auth["url"], content=data, headers=auth["required_headers"])
    return created, resp


def _object_count(env: Env) -> int:
    return sum(1 for p in env.store_dir.rglob("*") if p.is_file())


@pytest.mark.parametrize("label", ["truncated_jpeg", "random_bytes", "png_declared_as_jpeg", "empty_ish", "html"])
def test_corrupt_or_mislabeled_content_is_rejected_and_never_stored(env: Env, label: str) -> None:
    user = env.user()
    jpeg = synthetic_image("JPEG", seed=5)
    data = {
        "truncated_jpeg": jpeg[: len(jpeg) // 2],
        "random_bytes": bytes(range(256)) * 8,
        "png_declared_as_jpeg": synthetic_image("PNG"),
        "empty_ish": b"\xff",
        "html": b"<html><script>alert(1)</script></html>",
    }[label]
    before = _object_count(env)
    created, resp = _upload_one(user, data)
    assert resp.status_code == 415 and resp.json()["error"]["code"] == "UNSUPPORTED_MEDIA"
    assert _object_count(env) == before
    state = user.req("GET", f"/v1/captures/{created['capture_id']}").json()
    assert state["status"] == "awaiting_upload" and state["pages"][0]["upload_state"] == "pending"
    assert finalize(user, created).json()["error"]["code"] == "UPLOAD_INCOMPLETE"


def test_upload_larger_than_declared_is_rejected(env: Env) -> None:
    user = env.user()
    declared = synthetic_image(seed=1)
    _, resp = _upload_one(user, declared + b"\x00" * 10, declared=declared)
    assert resp.status_code == 413 and resp.json()["error"]["code"] == "PAYLOAD_TOO_LARGE"


def test_upload_shorter_than_declared_is_incomplete_and_retryable(env: Env) -> None:
    user = env.user()
    declared = synthetic_image(seed=1)
    created, resp = _upload_one(user, declared[:-5], declared=declared)
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "UPLOAD_INCOMPLETE"
    assert resp.json()["error"]["retryable"] is True
    # the retry with the real bytes succeeds
    upload_all(user, created, [declared])
    assert finalize(user, created).status_code == 200


def test_hash_mismatch_with_equal_size_is_rejected_and_not_stored(env: Env) -> None:
    user = env.user()
    good = synthetic_image(seed=1)
    flipped = bytearray(good)
    flipped[len(flipped) // 2] ^= 0xFF  # same size, valid-looking header, different bytes
    before = _object_count(env)
    created, resp = _upload_one(user, bytes(flipped), declared=good)
    assert resp.status_code == 422 and resp.json()["error"]["code"] == "HASH_MISMATCH"
    assert _object_count(env) == before
    assert user.req("GET", f"/v1/captures/{created['capture_id']}").json()["pages"][0]["server_sha256"] is None


def test_wrong_content_type_header_on_upload(env: Env) -> None:
    user = env.user()
    data = synthetic_image(seed=1)
    user.register_device()
    created = create_capture(user, manifest_for(user, [data])).json()
    auth = user.req("POST", f"/v1/captures/{created['capture_id']}/upload-authorizations").json()["authorizations"][0]
    resp = user.req("PUT", auth["url"], content=data, headers={"Content-Type": "image/png"})
    assert resp.status_code == 415


def test_listing_is_recent_first_and_paginates_with_opaque_cursors(env: Env) -> None:
    user = env.user()
    user.register_device()
    ids = []
    for i in range(5):
        ids.append(create_capture(user, manifest_for(user, [synthetic_image(seed=i)])).json()["capture_id"])
    first = user.req("GET", "/v1/captures", params={"limit": 2}).json()
    assert [c["capture_id"] for c in first["items"]] == ids[::-1][:2] and first["next_cursor"]
    second = user.req("GET", "/v1/captures", params={"limit": 2, "cursor": first["next_cursor"]}).json()
    third = user.req("GET", "/v1/captures", params={"limit": 2, "cursor": second["next_cursor"]}).json()
    assert [c["capture_id"] for c in second["items"] + third["items"]] == ids[::-1][2:]
    assert third["next_cursor"] is None
    tampered = first["next_cursor"][:-3] + "AAA"
    assert user.req("GET", "/v1/captures", params={"cursor": tampered}).status_code == 422


def test_capture_requires_registered_device(env: Env) -> None:
    user = env.user()
    resp = create_capture(user, manifest_for(user, [synthetic_image()]))
    assert resp.status_code == 422 and resp.json()["error"]["code"] == "DEVICE_NOT_REGISTERED"


def test_device_registration_is_idempotent_and_conflicts_on_mismatch(env: Env) -> None:
    user = env.user()
    assert user.register_device().status_code == 201
    assert user.register_device().status_code == 200
    other = user.req("POST", "/v1/devices", json={"device_id": str(user.device_id), "platform": "windows"})
    assert other.status_code == 409
    assert user.req("POST", "/v1/devices", json={"device_id": "nope", "platform": "ios"}).status_code == 422
    assert (
        user.req("POST", "/v1/devices", json={"device_id": str(uuid.uuid4()), "platform": "toaster"}).status_code == 422
    )


def test_no_processing_is_claimed_without_consent(env: Env) -> None:
    """Without AI configuration + consent, a capture ends at 'stored': no job, no transcript, no memory."""
    capture = stored_capture(env.user(), [synthetic_image()])
    assert capture["status"] == "stored"
    assert capture["processing"] is None and capture["memory_id"] is None
    for forbidden in ("transcript", "summary", "ocr"):
        assert forbidden not in capture
    me = env.user().req("GET", "/v1/me").json()
    assert me["capabilities"]["ai_processing"] is False
    assert me["config"] == {"ai_configured": False, "ai_enabled": False, "consent_required": False}
