#!/usr/bin/env python3
"""
DeepContext Engine — Benchmarking Script
==========================================
Generates real, defensible performance metrics from your live system so you
never have to guess a number for your resume/portfolio:

  1. Corpus size          -> exact vector/chunk count, pulled directly from Pinecone
  2. Query latency         -> time-to-first-token & total response time (mean/median/p95)
  3. Cache effectiveness   -> cold vs warm query speedup (Redis)
  4. Redis global stats    -> hit/miss ratio if Redis has been running a while

Run this against your LOCAL running stack (FastAPI + Pinecone + Redis all up).

Setup:
    pip install requests pinecone redis python-dotenv

Usage:
    python benchmark.py
    python benchmark.py --runs 5 --output results.json

BEFORE RUNNING: edit the CONFIG block below (or set env vars / .env) so
CHAT_ENDPOINT and CHAT_PAYLOAD_KEY match your actual FastAPI route and
request body shape.
"""

import os
import time
import json
import statistics
import argparse
from datetime import datetime

import requests

try:
    from dotenv import load_dotenv
    from pathlib import Path

    # This script lives at <repo_root>/scripts/benchmark.py, and the .env
    # with your Pinecone/Redis credentials lives at <repo_root>/backend/.env.
    # Load that one explicitly so this works no matter which directory
    # you run the script from.
    _repo_root = Path(__file__).resolve().parent.parent
    _backend_env = _repo_root / "backend" / ".env"
    if _backend_env.exists():
        load_dotenv(_backend_env)
    else:
        load_dotenv()  # fallback: look in current working directory
except ImportError:
    pass


# ============================================================
# CONFIG — adjust these to match your actual setup
# ============================================================

API_BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000")

# query_router mounted at /api/v1 with internal prefix /query, chat route at /chat
# -> full path: /api/v1/query/chat  (ConversationalQueryRequest, multi-turn RAG)
# Swap to "/api/v1/query" if you want to benchmark the single-turn QueryRequest route instead.
CHAT_ENDPOINT = "/api/v1/query/chat"

CHAT_PAYLOAD_KEY = "question"          # QueryRequest.question
USE_STREAMING = True                    # ConversationalQueryRequest.stream defaults to False server-side;
                                         # set True here so we measure real time-to-first-token, not a blocking JSON call

# QueryRequest.namespace — set to a real document's namespace (e.g. via env var
# TEST_NAMESPACE) to benchmark scoped retrieval. Leave None to use whatever the
# backend does when namespace is unset (check this doesn't silently return empty results).
TEST_NAMESPACE = os.getenv("TEST_NAMESPACE", None)

PINECONE_API_KEY = os.getenv("PINECONE_API_KEY")
PINECONE_INDEX_NAME = os.getenv("PINECONE_INDEX_NAME", "rag-index")

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")

TEST_QUERIES = [
    "What is the main topic of this document?",
    "Summarize the key findings in two sentences.",
    "What numbers or statistics are mentioned?",
    "Who are the main people or entities discussed?",
    "What conclusions does the document draw?",
]

# ============================================================


def get_corpus_stats():
    """Pull exact vector/chunk count directly from Pinecone."""
    if not PINECONE_API_KEY:
        print("  [skip] PINECONE_API_KEY not set — set it in .env or export it.")
        return None
    try:
        from pinecone import Pinecone
        pc = Pinecone(api_key=PINECONE_API_KEY)
        index = pc.Index(PINECONE_INDEX_NAME)
        stats = index.describe_index_stats()
        return {
            "total_vector_count": stats.get("total_vector_count"),
            "dimension": stats.get("dimension"),
            "namespaces": {k: v.get("vector_count") for k, v in stats.get("namespaces", {}).items()},
        }
    except Exception as e:
        print(f"  [error] Could not fetch Pinecone stats: {e}")
        return None


def send_query(query_text, extra_payload=None):
    """
    Send one query to your chat/query endpoint and measure timing.
    Handles streaming responses so it can capture time-to-first-token,
    then drains the rest of the stream to get true total response time.
    """
    payload = {
        CHAT_PAYLOAD_KEY: query_text,
        "history": [],          # fresh single-turn call each time; ConversationalQueryRequest requires this field
        "stream": USE_STREAMING,
    }
    if TEST_NAMESPACE:
        payload["namespace"] = TEST_NAMESPACE
    if extra_payload:
        payload.update(extra_payload)

    url = f"{API_BASE_URL}{CHAT_ENDPOINT}"
    start = time.perf_counter()
    first_byte_time = None

    try:
        with requests.post(url, json=payload, stream=True, timeout=60) as resp:
            resp.raise_for_status()
            for chunk in resp.iter_content(chunk_size=1):
                if chunk and first_byte_time is None:
                    first_byte_time = time.perf_counter()
                    break
            for _ in resp.iter_content(chunk_size=8192):
                pass
    except requests.exceptions.RequestException as e:
        return {"error": str(e)}

    end = time.perf_counter()
    return {
        "ttft_s": round((first_byte_time - start), 3) if first_byte_time else None,
        "total_s": round((end - start), 3),
    }


def benchmark_latency(queries, runs_per_query=3):
    """Run each query multiple times, return raw + aggregate stats."""
    all_totals, all_ttft = [], []
    per_query_results = []

    for q in queries:
        run_results = []
        for _ in range(runs_per_query):
            r = send_query(q)
            if "error" in r:
                print(f"  [error] query failed: {r['error']}")
                continue
            run_results.append(r)
            all_totals.append(r["total_s"])
            if r["ttft_s"]:
                all_ttft.append(r["ttft_s"])
            time.sleep(0.5)  # be polite to your own server between runs
        per_query_results.append({"query": q, "runs": run_results})

    def pct(data, p):
        if not data:
            return None
        data_sorted = sorted(data)
        idx = min(int(len(data_sorted) * p), len(data_sorted) - 1)
        return data_sorted[idx]

    summary = {
        "total_latency_s": {
            "mean": round(statistics.mean(all_totals), 3) if all_totals else None,
            "median": round(statistics.median(all_totals), 3) if all_totals else None,
            "p95": round(pct(all_totals, 0.95), 3) if all_totals else None,
            "min": round(min(all_totals), 3) if all_totals else None,
            "max": round(max(all_totals), 3) if all_totals else None,
        },
        "time_to_first_token_s": {
            "mean": round(statistics.mean(all_ttft), 3) if all_ttft else None,
            "median": round(statistics.median(all_ttft), 3) if all_ttft else None,
        },
        "sample_size": len(all_totals),
    }
    return summary, per_query_results


def benchmark_cache_effect(query_text, cold_wait_s=2):
    """
    Send the same query twice: the first is a cold (uncached) run, the second
    should hit Redis if your backend caches by query text/hash. Gives you a
    real, measured cache speedup number instead of a guess.
    """
    cold = send_query(query_text)
    time.sleep(cold_wait_s)
    warm = send_query(query_text)

    if "error" in cold or "error" in warm:
        return None

    speedup_pct = None
    if cold.get("total_s") and warm.get("total_s"):
        speedup_pct = round((1 - warm["total_s"] / cold["total_s"]) * 100, 1)

    return {"cold_s": cold["total_s"], "warm_s": warm["total_s"], "speedup_pct": speedup_pct}


def get_redis_stats():
    """Best-effort global cache hit ratio, if redis-py is installed and Redis is reachable."""
    try:
        import redis
        r = redis.from_url(REDIS_URL)
        info = r.info("stats")
        hits = info.get("keyspace_hits", 0)
        misses = info.get("keyspace_misses", 0)
        total = hits + misses
        hit_rate = round((hits / total) * 100, 1) if total else None
        return {"keyspace_hits": hits, "keyspace_misses": misses, "hit_rate_pct": hit_rate}
    except Exception as e:
        print(f"  [skip] Could not fetch Redis stats: {e}")
        return None


def main():
    parser = argparse.ArgumentParser(description="Benchmark DeepContext Engine for real resume metrics.")
    parser.add_argument("--runs", type=int, default=3, help="Runs per test query (default: 3)")
    parser.add_argument("--output", type=str, default="benchmark_results.json")
    args = parser.parse_args()

    print("=" * 60)
    print("DeepContext Engine — Benchmark")
    print("=" * 60)

    print("\n[1/4] Corpus stats (Pinecone)...")
    corpus_stats = get_corpus_stats()
    if corpus_stats:
        print(f"  Total vectors: {corpus_stats['total_vector_count']}")

    print(f"\n[2/4] Query latency ({args.runs} runs x {len(TEST_QUERIES)} queries)...")
    latency_summary, per_query = benchmark_latency(TEST_QUERIES, runs_per_query=args.runs)
    print(f"  Mean total latency: {latency_summary['total_latency_s']['mean']}s")
    print(f"  P95 total latency:  {latency_summary['total_latency_s']['p95']}s")
    if latency_summary["time_to_first_token_s"]["mean"]:
        print(f"  Mean time-to-first-token: {latency_summary['time_to_first_token_s']['mean']}s")

    print("\n[3/4] Cache effect (cold vs warm, same query)...")
    cache_effect = benchmark_cache_effect(TEST_QUERIES[0])
    if cache_effect:
        print(f"  Cold: {cache_effect['cold_s']}s | Warm: {cache_effect['warm_s']}s | Speedup: {cache_effect['speedup_pct']}%")

    print("\n[4/4] Redis global cache stats...")
    redis_stats = get_redis_stats()
    if redis_stats:
        print(f"  Hit rate: {redis_stats['hit_rate_pct']}% ({redis_stats['keyspace_hits']} hits / {redis_stats['keyspace_misses']} misses)")

    results = {
        "timestamp": datetime.now().isoformat(),
        "corpus_stats": corpus_stats,
        "latency_summary": latency_summary,
        "per_query_latency": per_query,
        "cache_effect": cache_effect,
        "redis_global_stats": redis_stats,
    }

    with open(args.output, "w") as f:
        json.dump(results, f, indent=2)

    print(f"\nFull results saved to {args.output}")
    print("=" * 60)


if __name__ == "__main__":
    main()