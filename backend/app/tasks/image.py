"""
이미지 처리 태스크 (image queue)

- resize_image     : 이미지 리사이즈 + 포맷 변환
- ocr_image        : Ollama vision 모델로 텍스트 추출
- generate_image   : DALL-E / ComfyUI / Automatic1111로 이미지 생성
- analyze_image    : vision 모델로 이미지 설명 / 분석
"""
import base64
import io
import ipaddress
import socket
import time
from typing import Literal
from urllib.parse import urlparse

import httpx
import redis as _sync_redis
from celery import shared_task
from celery.utils.log import get_task_logger
from PIL import Image

from app.core.config import settings
from app.tasks._utils import publish_task_done

logger = get_task_logger(__name__)

OLLAMA_URL     = settings.OLLAMA_URL
OPENAI_API_KEY = settings.OPENAI_API_KEY

# 이미지 태스크 전용 Redis 풀 (DALL-E 결과 캐시 용)
_redis_pool: _sync_redis.ConnectionPool | None = None


def _get_task_redis() -> _sync_redis.Redis:
    global _redis_pool
    if _redis_pool is None:
        _redis_pool = _sync_redis.ConnectionPool.from_url(
            settings.REDIS_URL, decode_responses=True, max_connections=5
        )
    return _sync_redis.Redis(connection_pool=_redis_pool)


# ── 헬퍼 ─────────────────────────────────────────────────────────────────────

_PRIVATE_NETS = [
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("169.254.0.0/16"),  # link-local / AWS IMDS
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
]


def _validate_external_url(url: str) -> None:
    """SSRF 방어: private/내부 IP 범위 및 비http(s) 스킴 차단 (사전 검증)."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError(f"Unsupported URL scheme: {parsed.scheme!r}")
    hostname = parsed.hostname or ""
    try:
        ip = ipaddress.ip_address(socket.gethostbyname(hostname))
    except socket.gaierror:
        raise ValueError(f"URL hostname could not be resolved: {hostname!r}")
    if any(ip in net for net in _PRIVATE_NETS):
        raise ValueError("URL resolves to a private/internal address")


class _SSRFSafeTransport(httpx.HTTPTransport):
    """연결 직전 DNS 재검증 — DNS rebinding 공격 방지.

    단순 사전 검증(validate_external_url)은 DNS resolve → 실제 연결 사이 IP 스왑을
    막지 못한다. 이 transport는 httpx가 실제 소켓을 열기 직전 다시 resolve 하여
    리바인딩 window를 최소화한다.
    """

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        host = request.url.host.strip("[]")  # IPv6 리터럴 [::1] → ::1
        try:
            ip = ipaddress.ip_address(socket.gethostbyname(host))
        except (socket.gaierror, ValueError) as exc:
            raise ValueError(f"Cannot resolve hostname {host!r}") from exc
        if any(ip in net for net in _PRIVATE_NETS):
            raise ValueError(f"SSRF: {host!r} resolves to a private address")
        return super().handle_request(request)


class _RateLimitError(Exception):
    """OpenAI 429 — Retry-After 헤더 값 보존."""
    def __init__(self, retry_after: int = 60):
        self.retry_after = retry_after
        super().__init__(f"Rate limited. Retry after {retry_after}s")


def _openai_post(client: httpx.Client, url: str, **kwargs) -> httpx.Response:
    """OpenAI POST. 429 응답 시 Retry-After 헤더를 파싱해 _RateLimitError 발생."""
    r = client.post(url, **kwargs)
    if r.status_code == 429:
        retry_after = max(int(r.headers.get("retry-after", 60)), 10)
        raise _RateLimitError(retry_after)
    r.raise_for_status()
    return r


def _poll_comfyui_result(base: str, prompt_id: str, timeout_s: int = 300) -> str:
    """
    ComfyUI /history/{prompt_id} 폴링 → 완료 시 첫 번째 이미지 base64 반환.
    timeout_s 내 완료 안 되면 TimeoutError.
    """
    interval = 5
    attempts = max(1, timeout_s // interval)
    for _ in range(attempts):
        time.sleep(interval)
        with httpx.Client(timeout=30) as client:
            hist = client.get(f"{base}/history/{prompt_id}")
        if hist.status_code != 200:
            continue
        hist_data = hist.json()
        if prompt_id not in hist_data:
            continue
        for node_out in hist_data[prompt_id].get("outputs", {}).values():
            for img_info in node_out.get("images", []):
                with httpx.Client(timeout=60) as client:
                    img_r = client.get(
                        f"{base}/view",
                        params={
                            "filename": img_info["filename"],
                            "type": img_info.get("type", "output"),
                        },
                    )
                if img_r.status_code == 200:
                    return base64.b64encode(img_r.content).decode()
    raise TimeoutError(f"ComfyUI prompt {prompt_id!r} did not complete within {timeout_s}s")


def _load_image_bytes(source: str) -> bytes:
    """URL 또는 base64 data URI에서 이미지 바이트 로드.
    URL은 _SSRFSafeTransport를 통해 DNS rebinding까지 방어.
    """
    if source.startswith("data:"):
        _header, b64 = source.split(",", 1)
        return base64.b64decode(b64)
    _validate_external_url(source)  # 스킴 + 사전 IP 검증
    with httpx.Client(timeout=30, transport=_SSRFSafeTransport()) as client:
        r = client.get(source)
        r.raise_for_status()
        return r.content


def _image_to_b64(img: Image.Image, fmt: str = "JPEG") -> str:
    buf = io.BytesIO()
    img.save(buf, format=fmt, quality=85)
    return base64.b64encode(buf.getvalue()).decode()


def _encode_mask_png(mask_arr) -> dict:
    """uint8 numpy 배열 → base64 PNG 마스크 dict."""
    mask_img = Image.fromarray(mask_arr, mode="L")
    buf = io.BytesIO()
    mask_img.save(buf, format="PNG")
    return {"mask_b64": base64.b64encode(buf.getvalue()).decode(), "format": "PNG"}


# ── 태스크 ────────────────────────────────────────────────────────────────────

@shared_task(bind=True, name="app.tasks.image.resize_image", max_retries=2)
def resize_image(
    self,
    source: str,
    max_size: int = 2048,
    output_format: Literal["JPEG", "PNG", "WEBP"] = "JPEG",
    quality: int = 85,
) -> dict:
    """
    이미지를 max_size × max_size 안으로 리사이즈.
    Returns: {"b64": "...", "width": int, "height": int, "format": str}
    """
    try:
        raw = _load_image_bytes(source)
        img = Image.open(io.BytesIO(raw)).convert("RGB")

        w, h = img.size
        scale = min(max_size / w, max_size / h, 1.0)
        if scale < 1.0:
            img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)

        buf = io.BytesIO()
        img.save(buf, format=output_format, quality=quality)
        b64 = base64.b64encode(buf.getvalue()).decode()

        result = {
            "b64": b64,
            "width": img.width,
            "height": img.height,
            "format": output_format,
            "original_size": len(raw),
            "compressed_size": len(buf.getvalue()),
        }
        publish_task_done(self.request.id, "resize_image")
        return result
    except Exception as exc:
        logger.error("resize_image failed: %s", exc)
        if self.request.retries >= self.max_retries:
            publish_task_done(self.request.id, "resize_image")
        raise self.retry(exc=exc, countdown=5)


@shared_task(bind=True, name="app.tasks.image.ocr_image", max_retries=2)
def ocr_image(
    self,
    source: str,
    model: str = "llava",
    prompt: str = "이 이미지에서 텍스트를 모두 추출해줘. 원본 레이아웃을 최대한 유지해.",
) -> dict:
    """
    Ollama vision 모델로 OCR.
    Returns: {"text": str, "model": str}
    """
    try:
        raw = _load_image_bytes(source)
        img = Image.open(io.BytesIO(raw))
        b64 = _image_to_b64(img)

        with httpx.Client(timeout=120) as client:
            r = client.post(
                f"{OLLAMA_URL}/api/generate",
                json={
                    "model": model,
                    "prompt": prompt,
                    "images": [b64],
                    "stream": False,
                },
            )
            r.raise_for_status()
            data = r.json()

        result = {"text": data.get("response", ""), "model": model}
        publish_task_done(self.request.id, "ocr_image")
        return result
    except Exception as exc:
        logger.error("ocr_image failed: %s", exc)
        if self.request.retries >= self.max_retries:
            publish_task_done(self.request.id, "ocr_image")
        raise self.retry(exc=exc, countdown=10)


@shared_task(bind=True, name="app.tasks.image.analyze_image", max_retries=2)
def analyze_image(
    self,
    source: str,
    prompt: str,
    model: str = "llava",
    provider: Literal["ollama", "openai"] = "ollama",
) -> dict:
    """
    vision 모델로 이미지 분석 / 설명 / 편집 지시 생성.
    Returns: {"response": str, "model": str, "provider": str}
    """
    try:
        raw = _load_image_bytes(source)
        img = Image.open(io.BytesIO(raw))
        b64 = _image_to_b64(img)

        if provider == "ollama":
            with httpx.Client(timeout=120) as client:
                r = client.post(
                    f"{OLLAMA_URL}/api/generate",
                    json={"model": model, "prompt": prompt, "images": [b64], "stream": False},
                )
                r.raise_for_status()
                response_text = r.json().get("response", "")

        else:  # openai
            if not OPENAI_API_KEY:
                raise ValueError("OPENAI_API_KEY not configured")
            with httpx.Client(timeout=120) as client:
                resp = _openai_post(
                    client,
                    "https://api.openai.com/v1/chat/completions",
                    headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
                    json={
                        "model": model or "gpt-4o",
                        "messages": [{
                            "role": "user",
                            "content": [
                                {"type": "text", "text": prompt},
                                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
                            ],
                        }],
                        "max_tokens": 2048,
                    },
                )
            response_text = resp.json()["choices"][0]["message"]["content"]

        result = {"response": response_text, "model": model, "provider": provider}
        publish_task_done(self.request.id, "analyze_image")
        return result
    except _RateLimitError as rate_err:
        logger.warning("analyze_image rate limited: retry after %ds", rate_err.retry_after)
        raise self.retry(exc=rate_err, countdown=rate_err.retry_after)
    except Exception as exc:
        logger.error("analyze_image failed: %s", exc)
        if self.request.retries >= self.max_retries:
            publish_task_done(self.request.id, "analyze_image")
        raise self.retry(exc=exc, countdown=10)


@shared_task(bind=True, name="app.tasks.image.remove_background", max_retries=2)
def remove_background(
    self,
    source: str,
    model: str = "birefnet-general",
    alpha_matting: bool = True,
) -> dict:
    """
    rembg + BiRefNet으로 배경 제거. alpha_matting=True 시 hair/edge 정밀 보정.
    model: "birefnet-general" (SOTA범용) | "birefnet-portrait" (인물 최적화) | "u2net"
    Returns: {"b64": str, "format": "PNG", "width": int, "height": int}  (RGBA PNG, 투명 배경)
    """
    try:
        from rembg import remove as rembg_remove, new_session
        raw = _load_image_bytes(source)
        session = new_session(model)
        kwargs: dict = {"session": session}
        if alpha_matting:
            kwargs.update({
                "alpha_matting": True,
                "alpha_matting_foreground_threshold": 240,
                "alpha_matting_background_threshold": 10,
                "alpha_matting_erode_size": 10,
            })
        output = rembg_remove(raw, **kwargs)
        img = Image.open(io.BytesIO(output))
        b64 = base64.b64encode(output).decode()
        result = {"b64": b64, "format": "PNG", "width": img.width, "height": img.height}
        publish_task_done(self.request.id, "remove_background")
        return result
    except Exception as exc:
        logger.error("remove_background failed: %s", exc)
        if self.request.retries >= self.max_retries:
            publish_task_done(self.request.id, "remove_background")
        raise self.retry(exc=exc, countdown=5)


@shared_task(bind=True, name="app.tasks.image.compose_studio", max_retries=1)
def compose_studio(
    self,
    foreground_b64: str,
    background_prompt: str,
    bg_type: Literal["solid", "gradient", "ai"] = "ai",
    bg_color: str = "#ffffff",
    bg_color2: str = "#e0e0e0",
    size: int = 1024,
) -> dict:
    """
    RGBA 누끼 위에 배경을 합성.
    bg_type:
      "solid"    — 단색 배경 (PIL, API 비용 없음, 즉시)
      "gradient" — 선형 그라디언트 (PIL, API 비용 없음, 즉시)
      "ai"       — DALL-E 3으로 배경 생성 후 PIL 합성

    Returns: {"b64": str, "format": "PNG"}
    """
    try:
        # 누끼 이미지 로드 (RGBA)
        fg_bytes = base64.b64decode(
            foreground_b64.split(",", 1)[1] if foreground_b64.startswith("data:") else foreground_b64
        )
        fg = Image.open(io.BytesIO(fg_bytes)).convert("RGBA")

        # 출력 크기에 맞게 리사이즈 (비율 유지, 가운데 배치)
        fg.thumbnail((size, size), Image.LANCZOS)
        canvas_fg = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        ox = (size - fg.width)  // 2
        oy = (size - fg.height) // 2
        canvas_fg.paste(fg, (ox, oy), fg)

        if bg_type == "solid":
            # hex → RGBA
            c = bg_color.lstrip("#")
            r, g, b = int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)
            bg = Image.new("RGBA", (size, size), (r, g, b, 255))

        elif bg_type == "gradient":
            c1 = bg_color.lstrip("#");  r1,g1,b1 = int(c1[0:2],16),int(c1[2:4],16),int(c1[4:6],16)
            c2 = bg_color2.lstrip("#"); r2,g2,b2 = int(c2[0:2],16),int(c2[2:4],16),int(c2[4:6],16)
            import numpy as _np
            arr = _np.zeros((size, size, 4), dtype=_np.uint8)
            for y in range(size):
                t = y / (size - 1)
                arr[y, :] = [
                    int(r1 + (r2 - r1) * t),
                    int(g1 + (g2 - g1) * t),
                    int(b1 + (b2 - b1) * t),
                    255,
                ]
            bg = Image.fromarray(arr, "RGBA")

        else:  # ai
            if not OPENAI_API_KEY:
                raise ValueError("OPENAI_API_KEY not configured")
            # Retry 시 이중 과금 방지: DALL-E 결과를 Redis에 캐시 (2시간)
            _r = _get_task_redis()
            _cache_key = f"task_dalle:{self.request.id}"
            bg_b64 = _r.get(_cache_key)
            if bg_b64 is None:
                enhanced_prompt = (
                    f"{background_prompt}, background only, no people, no subjects, "
                    "wide scene, professional photography"
                )
                with httpx.Client(timeout=120) as client:
                    resp = _openai_post(
                        client,
                        "https://api.openai.com/v1/images/generations",
                        headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
                        json={
                            "model": "dall-e-3",
                            "prompt": enhanced_prompt,
                            "n": 1,
                            "size": "1024x1024",
                            "response_format": "b64_json",
                        },
                    )
                bg_b64 = resp.json()["data"][0]["b64_json"]
                _r.setex(_cache_key, 7200, bg_b64)
            bg = Image.open(io.BytesIO(base64.b64decode(bg_b64))).convert("RGBA")
            if bg.size != (size, size):
                bg = bg.resize((size, size), Image.LANCZOS)

        # alpha_composite: bg 위에 fg 합성
        result_img = Image.alpha_composite(bg, canvas_fg)

        buf = io.BytesIO()
        result_img.save(buf, format="PNG")
        result = {"b64": base64.b64encode(buf.getvalue()).decode(), "format": "PNG"}
        publish_task_done(self.request.id, "compose_studio")
        return result
    except _RateLimitError as rate_err:
        logger.warning("compose_studio rate limited: retry after %ds", rate_err.retry_after)
        raise self.retry(exc=rate_err, countdown=rate_err.retry_after)
    except Exception as exc:
        logger.error("compose_studio failed: %s", exc)
        if self.request.retries >= self.max_retries:
            publish_task_done(self.request.id, "compose_studio")
        raise self.retry(exc=exc, countdown=10)


@shared_task(bind=True, name="app.tasks.image.segment_click", max_retries=1)
def segment_click(self, source: str, x: float, y: float) -> dict:
    """
    SAM2 tiny로 클릭 좌표(정규화 0~1) → 바이너리 마스크.
    Returns: {"mask_b64": str, "format": "PNG"}  (L모드 PNG, 흰색=선택 영역)
    """
    import numpy as np
    try:
        from sam2.build_sam import build_sam2
        from sam2.sam2_image_predictor import SAM2ImagePredictor
    except ImportError:
        from ultralytics import SAM
        raw = _load_image_bytes(source)
        img = Image.open(io.BytesIO(raw)).convert("RGB")
        w, h = img.size
        model = SAM("sam2_t.pt")
        results = model(img, points=[[x * w, y * h]], labels=[1])
        mask_arr = (results[0].masks.data[0].numpy() * 255).astype("uint8")
        result = _encode_mask_png(mask_arr)
        publish_task_done(self.request.id, "segment_click")
        return result

    try:
        raw = _load_image_bytes(source)
        img = Image.open(io.BytesIO(raw)).convert("RGB")
        w, h = img.size
        predictor = SAM2ImagePredictor(build_sam2("sam2_hiera_tiny.pt", device="cpu"))
        predictor.set_image(np.array(img))
        masks, _, _ = predictor.predict(
            point_coords=np.array([[x * w, y * h]]),
            point_labels=np.array([1]),
            multimask_output=False,
        )
        mask_arr = (masks[0] * 255).astype("uint8")
        result = _encode_mask_png(mask_arr)
        publish_task_done(self.request.id, "segment_click")
        return result
    except Exception as exc:
        logger.error("segment_click failed: %s", exc)
        if self.request.retries >= self.max_retries:
            publish_task_done(self.request.id, "segment_click")
        raise self.retry(exc=exc, countdown=10)


@shared_task(bind=True, name="app.tasks.image.edit_image", max_retries=1)
def edit_image(
    self,
    source: str,
    mask: str,
    prompt: str,
    provider: Literal["gpt-image-1", "comfyui"] = "gpt-image-1",
    size: str = "1024x1024",
    comfyui_url: str = "",
) -> dict:
    """
    인페인팅 (gpt-image-1 or ComfyUI FLUX.1 Fill).
    Returns: {"b64": str | None, "url": str | None, "provider": str}
    """
    try:
        if provider == "gpt-image-1":
            if not OPENAI_API_KEY:
                raise ValueError("OPENAI_API_KEY not configured")
            img_bytes  = _load_image_bytes(source)
            mask_bytes = _load_image_bytes(mask)
            with httpx.Client(timeout=120) as client:
                resp = _openai_post(
                    client,
                    "https://api.openai.com/v1/images/edits",
                    headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
                    files={
                        "image": ("image.png", img_bytes, "image/png"),
                        "mask":  ("mask.png",  mask_bytes, "image/png"),
                    },
                    data={
                        "model": "gpt-image-1",
                        "prompt": prompt,
                        "n": "1",
                        "size": size,
                        "response_format": "b64_json",
                    },
                )
            b64 = resp.json()["data"][0]["b64_json"]
            result = {"b64": b64, "url": None, "provider": "gpt-image-1"}

        elif provider == "comfyui":
            base = comfyui_url or settings.COMFYUI_URL
            _validate_external_url(base)  # SSRF: comfyui_url 파라미터 검증
            workflow = _build_flux_fill_workflow(source, mask, prompt)
            with httpx.Client(timeout=30) as client:
                r = client.post(f"{base}/prompt", json={"prompt": workflow})
                r.raise_for_status()
            prompt_id = r.json()["prompt_id"]
            # 결과 폴링 (fire-and-forget 제거 — 이전에는 prompt_id만 반환)
            b64 = _poll_comfyui_result(base, prompt_id, timeout_s=300)
            result = {"b64": b64, "url": None, "provider": "comfyui"}
        else:
            raise ValueError(f"Unknown provider: {provider}")

        publish_task_done(self.request.id, "edit_image")
        return result
    except _RateLimitError as rate_err:
        logger.warning("edit_image rate limited: retry after %ds", rate_err.retry_after)
        raise self.retry(exc=rate_err, countdown=rate_err.retry_after)
    except Exception as exc:
        logger.error("edit_image failed: %s", exc)
        if self.request.retries >= self.max_retries:
            publish_task_done(self.request.id, "edit_image")
        raise self.retry(exc=exc, countdown=15)


def _build_flux_fill_workflow(img_b64: str, mask_b64: str, prompt: str) -> dict:
    """ComfyUI FLUX.1 Fill inpainting workflow 스켈레톤."""
    # img_b64 / mask_b64: data URI or raw base64 — ComfyUI LoadImageBase64 노드로 전달
    def _strip_data_uri(s: str) -> str:
        return s.split(",", 1)[1] if s.startswith("data:") else s

    return {
        "1": {"class_type": "LoadImageBase64", "inputs": {"image": _strip_data_uri(img_b64)}},
        "2": {"class_type": "LoadImageBase64", "inputs": {"image": _strip_data_uri(mask_b64)}},
        "3": {"class_type": "CLIPTextEncode",  "inputs": {"text": prompt, "clip": ["4", 1]}},
        "4": {"class_type": "FluxFillLoader",  "inputs": {"ckpt_name": "flux1-fill-dev.safetensors"}},
        "5": {
            "class_type": "FluxFillSampler",
            "inputs": {
                "model": ["4", 0], "positive": ["3", 0],
                "image": ["1", 0], "mask": ["2", 0],
                "steps": 28, "guidance": 30.0, "seed": 42,
            },
        },
        "6": {"class_type": "VAEDecode",       "inputs": {"samples": ["5", 0], "vae": ["4", 2]}},
        "7": {"class_type": "SaveImageWebsocket", "inputs": {"images": ["6", 0]}},
    }


@shared_task(bind=True, name="app.tasks.image.generate_image", max_retries=1)
def generate_image(
    self,
    prompt: str,
    negative_prompt: str = "",
    provider: Literal["openai", "comfyui", "automatic1111"] = "openai",
    model: str = "dall-e-3",
    size: str = "1024x1024",
    quality: str = "standard",
    comfyui_url: str = "",
    a1111_url: str = "",
) -> dict:
    """
    이미지 생성.
    Returns: {"url": str | None, "b64": str | None, "provider": str}
    """
    try:
        if provider == "openai":
            if not OPENAI_API_KEY:
                raise ValueError("OPENAI_API_KEY not configured")
            with httpx.Client(timeout=120) as client:
                resp = _openai_post(
                    client,
                    "https://api.openai.com/v1/images/generations",
                    headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
                    json={
                        "model": model,
                        "prompt": prompt,
                        "n": 1,
                        "size": size,
                        "quality": quality,
                        "response_format": "b64_json",
                    },
                )
            b64 = resp.json()["data"][0]["b64_json"]
            result = {"b64": b64, "url": None, "provider": "openai"}
            publish_task_done(self.request.id, "generate_image")
            return result

        elif provider == "comfyui":
            base = comfyui_url or settings.COMFYUI_URL
            _validate_external_url(base)  # SSRF: comfyui_url 파라미터 검증
            with httpx.Client(timeout=30) as client:
                r = client.post(f"{base}/prompt", json={
                    "prompt": {
                        "3": {"class_type": "KSampler", "inputs": {
                            "seed": 42, "steps": 20, "cfg": 7,
                            "sampler_name": "euler", "scheduler": "normal",
                            "positive": {"node_id": "6", "output": 0},
                            "negative": {"node_id": "7", "output": 0},
                        }},
                        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt}},
                        "7": {"class_type": "CLIPTextEncode", "inputs": {"text": negative_prompt}},
                    }
                })
                r.raise_for_status()
            prompt_id = r.json()["prompt_id"]
            b64 = _poll_comfyui_result(base, prompt_id, timeout_s=300)
            result = {"b64": b64, "url": None, "provider": "comfyui"}
            publish_task_done(self.request.id, "generate_image")
            return result

        elif provider == "automatic1111":
            try:
                img_w, img_h = (int(v) for v in size.split("x", 1))
            except (ValueError, IndexError):
                img_w, img_h = 1024, 1024
            base = a1111_url or settings.A1111_URL
            _validate_external_url(base)  # SSRF: a1111_url 파라미터 검증
            with httpx.Client(timeout=300) as client:
                r = client.post(f"{base}/sdapi/v1/txt2img", json={
                    "prompt": prompt,
                    "negative_prompt": negative_prompt,
                    "steps": 20,
                    "width": img_w,
                    "height": img_h,
                })
                r.raise_for_status()
                b64 = r.json()["images"][0]
            result = {"b64": b64, "url": None, "provider": "automatic1111"}
            publish_task_done(self.request.id, "generate_image")
            return result

        else:
            raise ValueError(f"Unknown provider: {provider}")

    except _RateLimitError as rate_err:
        logger.warning("generate_image rate limited: retry after %ds", rate_err.retry_after)
        raise self.retry(exc=rate_err, countdown=rate_err.retry_after)
    except Exception as exc:
        logger.error("generate_image failed: %s", exc)
        if self.request.retries >= self.max_retries:
            publish_task_done(self.request.id, "generate_image")
        raise self.retry(exc=exc, countdown=15)
