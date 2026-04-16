"""
vectorstore/pinecone_client.py
------------------------------
Production-ready Pinecone v4 client wrapper.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from pinecone import Pinecone, ServerlessSpec

# ── Resilient exception imports for Pinecone v4 ──────────────────────────────
try:
    from pinecone.exceptions import NotFoundException
except ImportError:
    # Some Pinecone v4 builds don't export NotFoundException — define a fallback
    class NotFoundException(Exception):  # type: ignore[no-redef]
        pass

try:
    from pinecone.exceptions import PineconeException as PineconeApiException
except ImportError:
    class PineconeApiException(Exception):  # type: ignore[no-redef]
        pass
# ─────────────────────────────────────────────────────────────────────────────

from app.core.config import PineconeMetric, Settings, get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)


@dataclass
class VectorRecord:
    vector_id:  str                      = field(default_factory=lambda: str(uuid.uuid4()))
    values:     list[float]              = field(default_factory=list)
    sparse_values: dict[str, Any] | None = None
    metadata:   dict[str, Any]           = field(default_factory=dict)


@dataclass
class QueryResult:
    vector_id: str
    score:     float
    metadata:  dict[str, Any]

    @property
    def text(self) -> str:
        return self.metadata.get("text", "")

    @property
    def source(self) -> str:
        return self.metadata.get("source", "")

    @property
    def chunk_index(self) -> int:
        return int(self.metadata.get("chunk_index", -1))


@dataclass
class IndexStats:
    total_vectors:  int
    dimension:      int
    namespaces:     dict[str, int]
    index_fullness: float


class PineconeClient:
    def __init__(self, settings: Settings | None = None) -> None:
        self._settings   = settings or get_settings()
        self._pc         = Pinecone(api_key=self._settings.pinecone_api_key)
        self._index_name = self._settings.pinecone_index_name
        self._index      = None
        self._ready      = False

    async def initialise(self) -> None:
        await asyncio.to_thread(self._ensure_index_exists)
        await asyncio.to_thread(self._wait_for_ready)
        self._ready = True
        stats = await self.get_stats()
        logger.info(
            "pinecone_initialised",
            index=self._index_name,
            total_vectors=stats.total_vectors,
            dimension=stats.dimension,
            namespaces=list(stats.namespaces.keys()),
        )

    def _ensure_index_exists(self) -> None:
        try:
            existing = [idx.name for idx in self._pc.list_indexes()]
        except Exception:
            existing = []

        if self._index_name in existing:
            logger.debug("pinecone_index_exists", index=self._index_name)
            return

        s = self._settings
        logger.info(
            "pinecone_creating_index",
            index=self._index_name,
            dimension=s.pinecone_dimension,
            metric=s.pinecone_metric.value,
        )
        # Parse "us-east-1-aws" → cloud="aws", region="us-east-1"
        parts  = s.pinecone_environment.rsplit("-", 1)
        cloud  = parts[-1] if len(parts) > 1 else "aws"
        region = parts[0]  if len(parts) > 1 else s.pinecone_environment

        self._pc.create_index(
            name=self._index_name,
            dimension=s.pinecone_dimension,
            metric=s.pinecone_metric.value,
            spec=ServerlessSpec(cloud=cloud, region=region),
        )
        logger.info("pinecone_index_created", index=self._index_name)

    def _wait_for_ready(self, timeout: int = 120, poll_interval: int = 3) -> None:
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                desc = self._pc.describe_index(self._index_name)
                if desc.status.ready:
                    return
            except Exception:
                pass  # still being created or transient error
            logger.debug("pinecone_waiting_for_ready", index=self._index_name)
            time.sleep(poll_interval)
        raise TimeoutError(
            f"Pinecone index '{self._index_name}' was not ready after {timeout}s."
        )

    def _get_index(self):
        if self._index is None:
            self._index = self._pc.Index(self._index_name)
        return self._index

    async def upsert(
        self,
        records: list[VectorRecord],
        namespace: str | None = None,
    ) -> int:
        ns         = namespace or self._settings.pinecone_namespace
        batch_size = self._settings.pinecone_batch_size
        total      = 0

        for i in range(0, len(records), batch_size):
            batch = records[i : i + batch_size]
            vectors = []
            for r in batch:
                v: dict[str, Any] = {
                    "id":       r.vector_id,
                    "values":   r.values,
                    "metadata": r.metadata,
                }
                if r.sparse_values:
                    v["sparse_values"] = r.sparse_values
                vectors.append(v)

            try:
                result = await asyncio.to_thread(
                    self._get_index().upsert,
                    vectors=vectors,
                    namespace=ns,
                )
                total += result.upserted_count
                logger.debug(
                    "pinecone_batch_upserted",
                    batch=i // batch_size + 1,
                    count=result.upserted_count,
                    namespace=ns,
                )
            except Exception as exc:
                logger.error("pinecone_upsert_failed", error=str(exc), namespace=ns)
                raise

        logger.info("pinecone_upsert_complete", total_upserted=total, namespace=ns)
        return total

    async def query(
        self,
        dense_vector: list[float],
        top_k: int | None = None,
        namespace: str | None = None,
        filter: dict[str, Any] | None = None,
        sparse_vector: dict[str, Any] | None = None,
        alpha: float | None = None,
        score_threshold: float | None = None,
        include_metadata: bool = True,
    ) -> list[QueryResult]:
        ns        = namespace or self._settings.pinecone_namespace
        k         = top_k or self._settings.retrieval_top_k
        threshold = score_threshold if score_threshold is not None \
                    else self._settings.similarity_score_threshold

        query_kwargs: dict[str, Any] = {
            "vector":           dense_vector,
            "top_k":            k,
            "namespace":        ns,
            "include_metadata": include_metadata,
            "include_values":   False,
        }
        if filter:
            query_kwargs["filter"] = filter

        if sparse_vector:
            a = alpha if alpha is not None else self._settings.hybrid_alpha
            query_kwargs["vector"]        = _scale_dense(dense_vector, a)
            query_kwargs["sparse_vector"] = _scale_sparse(sparse_vector, 1.0 - a)

        try:
            raw = await asyncio.to_thread(
                self._get_index().query, **query_kwargs
            )
        except Exception as exc:
            logger.error("pinecone_query_failed", error=str(exc), namespace=ns)
            raise

        results: list[QueryResult] = []
        for match in raw.matches:
            if match.score < threshold:
                continue
            results.append(
                QueryResult(
                    vector_id=match.id,
                    score=match.score,
                    metadata=match.metadata or {},
                )
            )

        logger.debug(
            "pinecone_query_complete",
            requested=k,
            returned=len(results),
            threshold=threshold,
            namespace=ns,
        )
        return results

    async def delete_by_ids(self, vector_ids: list[str], namespace: str | None = None) -> None:
        ns = namespace or self._settings.pinecone_namespace
        await asyncio.to_thread(self._get_index().delete, ids=vector_ids, namespace=ns)
        logger.info("pinecone_deleted_by_ids", count=len(vector_ids), namespace=ns)

    async def delete_by_filter(self, filter: dict[str, Any], namespace: str | None = None) -> None:
        ns = namespace or self._settings.pinecone_namespace
        try:
            await asyncio.to_thread(self._get_index().delete, filter=filter, namespace=ns)
            logger.info("pinecone_deleted_by_filter", filter=filter, namespace=ns)
        except Exception as exc:
            # filter-based delete requires a paid plan — log and continue
            logger.warning("pinecone_delete_by_filter_failed", error=str(exc))

    async def delete_namespace(self, namespace: str) -> None:
        await asyncio.to_thread(self._get_index().delete, delete_all=True, namespace=namespace)
        logger.info("pinecone_namespace_deleted", namespace=namespace)

    async def fetch(self, vector_ids: list[str], namespace: str | None = None) -> dict[str, Any]:
        ns = namespace or self._settings.pinecone_namespace
        return await asyncio.to_thread(self._get_index().fetch, ids=vector_ids, namespace=ns)

    async def get_stats(self) -> IndexStats:
        raw = await asyncio.to_thread(self._get_index().describe_index_stats)
        ns_counts = {
            ns: info.vector_count
            for ns, info in (raw.namespaces or {}).items()
        }
        return IndexStats(
            total_vectors=raw.total_vector_count,
            dimension=raw.dimension,
            namespaces=ns_counts,
            index_fullness=raw.index_fullness,
        )

    async def health_check(self) -> dict[str, Any]:
        try:
            stats = await self.get_stats()
            return {
                "status":         "ok",
                "index":          self._index_name,
                "total_vectors":  stats.total_vectors,
                "index_fullness": round(stats.index_fullness, 4),
                "namespaces":     list(stats.namespaces.keys()),
            }
        except Exception as exc:
            logger.error("pinecone_health_check_failed", error=str(exc))
            return {"status": "error", "detail": str(exc)}

    @property
    def is_ready(self) -> bool:
        return self._ready


def _scale_dense(vector: list[float], alpha: float) -> list[float]:
    return [v * alpha for v in vector]


def _scale_sparse(sparse: dict[str, Any], weight: float) -> dict[str, Any]:
    return {
        "indices": sparse["indices"],
        "values":  [v * weight for v in sparse["values"]],
    }


_client_instance: PineconeClient | None = None


def get_pinecone_client() -> PineconeClient:
    global _client_instance
    if _client_instance is None:
        _client_instance = PineconeClient()
    return _client_instance
