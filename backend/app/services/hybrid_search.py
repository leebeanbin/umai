"""Reciprocal Rank Fusion (RRF) — vector + keyword 결과 블렌딩."""


def reciprocal_rank_fusion(
    vector_results: list[dict],
    keyword_results: list[dict],
    k: int = 60,
    vector_weight: float = 0.7,
) -> list[dict]:
    """두 순위 리스트를 RRF 점수로 융합한다.

    Args:
        vector_results: cosine/HNSW 결과 (id 키 포함 dict 목록)
        keyword_results: 키워드 결과 (id 키 포함 dict 목록)
        k: RRF smoothing 상수 (기본 60)
        vector_weight: 벡터 결과에 부여할 가중치 (0~1)
    """
    scores: dict[str, float] = {}
    id_to_doc: dict[str, dict] = {}

    for rank, doc in enumerate(vector_results):
        doc_id = str(doc.get("id", rank))
        scores[doc_id] = scores.get(doc_id, 0.0) + vector_weight / (k + rank + 1)
        id_to_doc[doc_id] = doc

    for rank, doc in enumerate(keyword_results):
        doc_id = str(doc.get("id", f"kw_{rank}"))
        scores[doc_id] = scores.get(doc_id, 0.0) + (1 - vector_weight) / (k + rank + 1)
        id_to_doc[doc_id] = doc

    return [id_to_doc[did] for did in sorted(scores, key=scores.__getitem__, reverse=True)]
