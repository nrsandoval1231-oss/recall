from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import unicodedata
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from .models import Relationship, Snapshot, Source, Support

# The user-approved extraction ontology. Names and relations remain proposals.
ENTITY_NAMES = ("Person", "Organization", "Project", "Meeting", "Decision", "KnowledgeItem", "Topic", "Commitment")
RELATION_NAMES = (
    "WORKS_ON",
    "BELONGS_TO",
    "PARTICIPATED_IN",
    "DISCUSSED",
    "DECIDED",
    "RELATES_TO",
    "DEPENDS_ON",
    "SUPPORTED_BY",
    "SUPERSEDES",
    "CONTRADICTS",
    "MENTIONED_IN",
)
MAX_SOURCE_CHARS = 32 * 1024
MAX_SOURCES_PER_REBUILD = 100
MAX_SCOPE_EPISODES = 10_000


class GraphCapacityError(ValueError):
    pass


class GraphIndexMissing(RuntimeError):
    pass


class EntityAttributes(BaseModel):
    description: str | None = None


class RelationAttributes(BaseModel):
    """No model-authored evidence attributes; provenance comes from episode links."""


def episode_key(source: Source) -> str:
    # add_episode(uuid=...) means fetch an existing Graphiti episode. The stable
    # key belongs in its name; Graphiti creates the actual UUID on first ingest.
    return f"{source.id}:{source.revision}:{source.note_sha256}"


class GraphAdapter:
    """Graphiti/FalkorDB adapter. It never chooses credentials from generic SDK defaults."""

    def __init__(self, db_path: str | Path) -> None:
        # Graphiti reads this when telemetry is imported. Force the privacy choice first.
        os.environ["GRAPHITI_TELEMETRY_ENABLED"] = "false"
        self.db_path = str(db_path)
        self._clients: dict[str, Any] = {}
        self._drivers: dict[str, Any] = {}
        self._verified_episodes: dict[str, tuple[str, ...]] = {}
        self._db: Any = None
        self._graphiti_cls: Any = None

    async def start(self) -> None:
        if self._db is not None:
            return
        _silence_payload_loggers()
        from graphiti_core import Graphiti
        from redislite.async_falkordb_client import AsyncFalkorDB

        # Local model loading is data-independent; no note content is sent to an embedder.
        self._db = AsyncFalkorDB(dbfilename=self.db_path)
        self._graphiti_cls = Graphiti
        from .providers import configure_budget_path

        configure_budget_path(self.db_path + ".budget.sqlite")

    async def close(self) -> None:
        if self._db is not None:
            async_client = getattr(self._db, "client", None)
            # redislite's async wrapper inherits a sync finalizer that would call
            # its proxied async SHUTDOWN without awaiting it. Mark both wrappers
            # managed, close sockets, then explicitly persist/stop the sync server.
            if async_client is not None:
                async_client._async_managed = True
            sync_client = getattr(async_client, "_sync_client", None)
            await self._db.close()
            if sync_client is not None and getattr(sync_client, "pid", None):
                await asyncio.to_thread(sync_client.shutdown, save=True, now=True, force=True)
            self._db = None
            self._drivers.clear()
            self._clients.clear()
            self._verified_episodes.clear()

    async def rebuild(self, snapshot: Snapshot) -> None:
        if self._db is None:
            await self.start()
        from graphiti_core.utils.maintenance.graph_data_operations import clear_data

        scope = snapshot.scope
        driver = await self._driver_for_scope(scope)
        self._verified_episodes.pop(scope, None)
        await clear_data(driver, group_ids=[scope])
        if not snapshot.processing_allowed:
            return
        sources = [s for s in snapshot.sources if s.id in snapshot.eligible_ids]
        if not sources:
            return
        _validate_capacity(sources)
        await self._ensure_client(scope)
        await self._add_sources(scope, sources)

    async def append(self, scope: str, sources: list[Source]) -> None:
        if not sources:
            return
        _validate_capacity(sources)
        if self._db is None:
            await self.start()
        await self._ensure_client(scope)
        self._verified_episodes.pop(scope, None)
        await self._add_sources(scope, sources)

    async def _driver_for_scope(self, scope: str) -> Any:
        if self._db is None:
            await self.start()
        driver = self._drivers.get(scope)
        if driver is None:
            from graphiti_core.driver.falkordb_driver import FalkorDriver

            driver = FalkorDriver(falkor_db=self._db, database=scope)
            self._drivers[scope] = driver
            init_task = getattr(driver, "_init_task", None)
            if init_task is not None:
                await init_task
                driver._init_task = None
        return driver

    async def _ensure_client(self, scope: str) -> Any:
        client = self._clients.get(scope)
        if client is None:
            driver = await self._driver_for_scope(scope)
            client = _graphiti_client(self._graphiti_cls, driver)
            self._clients[scope] = client
        return client

    async def _add_sources(self, scope: str, sources: list[Source]) -> None:
        from graphiti_core.nodes import EpisodeType

        _validate_capacity(sources)
        for source in sources:
            client = await self._ensure_client(scope)
            await client.add_episode(
                name=episode_key(source),
                episode_body=source.text,
                source_description="Recall user note; source id only",
                reference_time=source.updated_at,
                source=EpisodeType.text,
                group_id=scope,
                update_communities=False,
                entity_types=_entity_types(),
                edge_types=_edge_types(),
                edge_type_map=_edge_map(),
                custom_extraction_instructions=(
                    "Extract only the Recall ontology types. Treat all names and facts as unverified proposals. "
                    "Do not resolve identity from matching names. Omit unsupported relations."
                ),
            )

    async def search(self, scope: str, query: str, limit: int, sources: dict[str, Source]) -> list[Relationship]:
        if not sources:
            return []
        if self._db is None:
            await self.start()
        from graphiti_core.edges import EntityEdge
        from graphiti_core.nodes import EntityNode, EpisodicNode

        driver = await self._driver_for_scope(scope)
        client = self._clients.get(scope)
        await self._verify_current_episodes(scope, driver, sources, EpisodicNode)

        if query.strip():
            from graphiti_core.search.search_config import SearchConfig
            from graphiti_core.search.search_config_recipes import EDGE_HYBRID_SEARCH_RRF, NODE_HYBRID_SEARCH_RRF

            client = await self._ensure_client(scope)
            # RRF avoids the default external cross-encoder reranking path.
            config = SearchConfig(
                edge_config=EDGE_HYBRID_SEARCH_RRF.edge_config,
                node_config=NODE_HYBRID_SEARCH_RRF.node_config,
                limit=limit,
            )
            results = await client.search_(query=query, config=config, group_ids=[scope])
            edges = getattr(results, "edges", []) or []
        else:
            # Blank-query exploration is a bounded local edge listing.
            try:
                edges = await EntityEdge.get_by_group_ids(driver, [scope], limit=limit)
            except Exception as exc:
                from graphiti_core.errors import GroupsEdgesNotFoundError

                if isinstance(exc, GroupsEdgesNotFoundError):
                    return []
                raise
        if not edges:
            return []
        node_ids = sorted(
            {
                str(value)
                for edge in edges
                for value in (getattr(edge, "source_node_uuid", ""), getattr(edge, "target_node_uuid", ""))
                if value
            }
        )
        nodes = await EntityNode.get_by_uuids(driver, node_ids)
        node_map = {str(getattr(node, "uuid", "")): node for node in nodes}
        episode_ids = sorted(
            {str(getattr(value, "uuid", value)) for edge in edges for value in (getattr(edge, "episodes", None) or [])}
        )
        episodes = await EpisodicNode.get_by_uuids(driver, episode_ids)
        episode_map = _map_current_episodes(scope, sources, episodes, require_complete=False)
        output: list[Relationship] = []
        for edge in edges:
            episode_ids = [str(getattr(value, "uuid", value)) for value in (getattr(edge, "episodes", None) or [])]
            if not episode_ids or any(eid not in episode_map for eid in episode_ids):
                continue
            supported_sources = sorted(
                {episode_map[eid].id: episode_map[eid] for eid in episode_ids}.values(),
                key=lambda item: (item.id, item.revision),
            )
            fact = str(getattr(edge, "fact", "") or "").strip()
            if not fact:
                continue
            subject_node = node_map.get(str(getattr(edge, "source_node_uuid", "")))
            object_node = node_map.get(str(getattr(edge, "target_node_uuid", "")))
            if subject_node is None or object_node is None:
                continue
            subject_name = str(getattr(subject_node, "name", ""))
            object_name = str(getattr(object_node, "name", ""))
            supported_sources = _anchor_supported_sources(supported_sources, subject_name, object_name)
            if not supported_sources:
                continue
            relation = str(getattr(edge, "name", "RELATES_TO")).upper()
            if relation not in RELATION_NAMES:
                relation = "RELATES_TO"
            supports = [
                Support(
                    source_id=s.id,
                    revision=s.revision,
                    source_sha256=s.source_sha256,
                    note_sha256=s.note_sha256,
                    # Graphiti's separate attribute-extraction pass does not
                    # receive source text. Use the complete, bounded note as
                    # context, never as a claimed exact supporting span.
                    quote=s.text,
                )
                for s in supported_sources
            ]
            first = supported_sources[0]
            valid_at = _datetime(getattr(edge, "valid_at", None))
            invalid_at = _datetime(getattr(edge, "invalid_at", None))
            output.append(
                Relationship(
                    id=_relationship_id(scope, subject_node, object_node, relation, fact, supports),
                    source_id=first.id,
                    revision=first.revision,
                    source_sha256=first.source_sha256,
                    note_sha256=first.note_sha256,
                    source_name=first.source_name,
                    note_path=first.note_path,
                    quote=first.text,
                    subject_id=_scoped_node_id(scope, getattr(subject_node, "uuid", "")),
                    object_id=_scoped_node_id(scope, getattr(object_node, "uuid", "")),
                    subject=subject_name,
                    subject_type=_node_type(subject_node),
                    predicate=relation,
                    object=object_name,
                    object_type=_node_type(object_node),
                    fact=fact,
                    valid_at=valid_at,
                    invalid_at=invalid_at,
                    extracted_at=_datetime(getattr(edge, "created_at", None)) or first.updated_at,
                    inferred=True,
                    uncertainty="Anchored endpoint strings do not verify identity or relation; review source context.",
                    related_source_ids=[s.id for s in supported_sources],
                    supports=supports,
                )
            )
        return output

    async def _verify_current_episodes(
        self, scope: str, driver: Any, sources: dict[str, Source], episodic_node_cls: Any
    ) -> None:
        expected = tuple(sorted(episode_key(source) for source in sources.values()))
        if self._verified_episodes.get(scope) == expected:
            return
        episodes: list[Any] = []
        cursor = None
        while len(episodes) <= MAX_SCOPE_EPISODES:
            page = await episodic_node_cls.get_by_group_ids(
                driver, [scope], limit=min(200, MAX_SCOPE_EPISODES + 1 - len(episodes)), uuid_cursor=cursor
            )
            if not page:
                break
            episodes.extend(page)
            cursor = str(getattr(page[-1], "uuid", ""))
            if len(page) < 200:
                break
        if len(episodes) > MAX_SCOPE_EPISODES:
            raise GraphIndexMissing("scoped episode ledger exceeds supported capacity")
        _map_current_episodes(scope, sources, episodes)
        self._verified_episodes[scope] = expected


def _map_current_episodes(
    scope: str,
    sources: dict[str, Source],
    episodes: list[Any],
    *,
    require_complete: bool = True,
) -> dict[str, Source]:
    expected = {episode_key(source): source for source in sources.values()}
    mapped: dict[str, Source] = {}
    names: set[str] = set()
    for episode in episodes:
        if getattr(episode, "group_id", None) != scope:
            continue
        name = str(getattr(episode, "name", ""))
        identity = str(getattr(episode, "uuid", ""))
        source = expected.get(name)
        if source is None:
            raise GraphIndexMissing("scoped episode does not match the current source revision and hash")
        if not identity or identity in mapped or name in names:
            raise GraphIndexMissing("scoped episode identity is missing or duplicated")
        mapped[identity] = source
        names.add(name)
    if require_complete and names != set(expected):
        raise GraphIndexMissing("persistent graph is missing one or more current source episodes")
    return mapped


def _anchor_supported_sources(sources: list[Source], subject: str, object_: str) -> list[Source]:
    """Retain only notes that contain both endpoint names as bounded Unicode phrases."""
    if not subject.strip() or not object_.strip():
        return []
    return [
        source
        for source in sources
        if _contains_endpoint_anchor(source.text, subject) and _contains_endpoint_anchor(source.text, object_)
    ]


def _contains_endpoint_anchor(text: str, endpoint: str) -> bool:
    haystack = _normalize_anchor_text(text)
    needle = _normalize_anchor_text(endpoint)
    if not needle:
        return False
    position = haystack.find(needle)
    while position >= 0:
        end = position + len(needle)
        left_ok = position == 0 or not _anchor_word_char(haystack[position - 1])
        right_ok = end == len(haystack) or not _anchor_word_char(haystack[end])
        if left_ok and right_ok:
            return True
        position = haystack.find(needle, position + 1)
    return False


def _normalize_anchor_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).casefold()
    return " ".join(unicodedata.normalize("NFKC", normalized).split())


def _anchor_word_char(value: str) -> bool:
    category = unicodedata.category(value)
    return category[0] in {"L", "M", "N"} or category == "Pc"


def _graphiti_client(graphiti_cls: Any, driver: Any) -> Any:
    from graphiti_core.cross_encoder.client import CrossEncoderClient

    from recall.knowledge.providers import configured_clients

    llm_client, embedder = configured_clients()

    class RrfOnlyCrossEncoder(CrossEncoderClient):  # type: ignore[misc]
        async def rank(self, query: str, passages: list[str]) -> list[tuple[str, float]]:
            raise RuntimeError("RRF search must not call an external or synthetic cross-encoder.")

    return graphiti_cls(
        graph_driver=driver,
        llm_client=llm_client,
        embedder=embedder,
        cross_encoder=RrfOnlyCrossEncoder(),
        store_raw_episode_content=False,
        max_coroutines=1,
    )


def _silence_payload_loggers() -> None:
    # Upstream exception/debug messages may include Graphiti prompt material.
    # Set package levels before Graphiti/Anthropic imports; descendants inherit.
    prefixes = ("graphiti_core", "anthropic", "httpx", "httpcore")
    for prefix in prefixes:
        logging.getLogger(prefix).setLevel(logging.CRITICAL + 1)
        for name, logger in logging.Logger.manager.loggerDict.items():
            if name.startswith(prefix + ".") and isinstance(logger, logging.Logger):
                logger.setLevel(logging.CRITICAL + 1)


def _entity_types() -> dict[str, type[BaseModel]]:
    return {name: EntityAttributes for name in ENTITY_NAMES}


def _edge_types() -> dict[str, type[BaseModel]]:
    return {name: RelationAttributes for name in RELATION_NAMES}


def _validate_capacity(sources: list[Source]) -> None:
    if len(sources) > MAX_SOURCES_PER_REBUILD:
        raise GraphCapacityError("source_count")
    if any(len(source.text) > MAX_SOURCE_CHARS for source in sources):
        raise GraphCapacityError("source_size")


def _edge_map() -> dict[tuple[str, str], list[str]]:
    return {
        ("Person", "Project"): ["WORKS_ON"],
        ("Person", "Organization"): ["BELONGS_TO"],
        ("Person", "Meeting"): ["PARTICIPATED_IN"],
        ("Meeting", "Topic"): ["DISCUSSED"],
        ("Meeting", "Decision"): ["DECIDED"],
        ("Project", "Project"): ["DEPENDS_ON", "RELATES_TO"],
        ("KnowledgeItem", "KnowledgeItem"): ["SUPPORTED_BY", "SUPERSEDES", "CONTRADICTS", "RELATES_TO"],
        ("Topic", "KnowledgeItem"): ["RELATES_TO"],
        ("Commitment", "Person"): ["MENTIONED_IN"],
        ("Commitment", "Project"): ["RELATES_TO"],
        ("Organization", "Project"): ["BELONGS_TO", "RELATES_TO"],
        ("Decision", "Project"): ["RELATES_TO", "DEPENDS_ON"],
        ("Meeting", "KnowledgeItem"): ["MENTIONED_IN", "RELATES_TO"],
        ("Topic", "Topic"): ["RELATES_TO"],
    }


def _node_type(node: Any) -> str:
    labels = getattr(node, "labels", []) or []
    return next((str(label) for label in labels if label in ENTITY_NAMES), "KnowledgeItem")


def _datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value))
    except ValueError:
        return None


def _relationship_id(scope: str, subject: Any, object_: Any, relation: str, fact: str, supports: list[Support]) -> str:
    evidence = "|".join(
        f"{s.source_id}:{s.revision}:{s.note_sha256}" for s in sorted(supports, key=lambda row: row.source_id)
    )
    canonical = "|".join(
        (
            scope,
            _node_type(subject),
            str(getattr(subject, "name", "")),
            relation,
            _node_type(object_),
            str(getattr(object_, "name", "")),
            evidence,
        )
    )
    digest = hashlib.sha256(canonical.encode()).hexdigest()
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "recall-relationship:" + digest))


def _scoped_node_id(scope: str, node_id: Any) -> str:
    return str(uuid.uuid5(uuid.UUID(scope), str(node_id)))
