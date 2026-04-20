"""Cross-Encoder reranking — lazy-loaded singleton.

cross-encoder/ms-marco-MiniLM-L-6-v2 패키지가 없으면 rerank()가 원본 순서를 반환한다.
"""
import logging

logger = logging.getLogger(__name__)

_reranker = None  # False = import 실패, CrossEncoder = 로드 완료


def _get_reranker():
    global _reranker
    if _reranker is False:
        return None
    if _reranker is not None:
        return _reranker
    try:
        from sentence_transformers import CrossEncoder
        _reranker = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")
        logger.info("Cross-encoder reranker loaded")
    except Exception as exc:
        logger.warning("Reranker unavailable (%s); falling back to cosine order", exc)
        _reranker = False
    return _reranker if _reranker is not False else None


def rerank(query: str, docs: list[str], top_k: int = 5) -> list[int]:
    """cosine-similar 후보를 cross-encoder로 rerank, 상위 top_k 인덱스 반환."""
    model = _get_reranker()
    if model is None or not docs:
        return list(range(min(top_k, len(docs))))

    pairs = [[query, doc] for doc in docs]
    scores = model.predict(pairs)
    ranked = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)
    return ranked[:top_k]
