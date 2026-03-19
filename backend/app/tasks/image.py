"""
이미지 처리 태스크 (image queue)

- resize_image     : 이미지 리사이즈 + 포맷 변환
- ocr_image        : Ollama vision 모델로 텍스트 추출
- generate_image   : DALL-E / ComfyUI / Automatic1111로 이미지 생성
- analyze_image    : vision 모델로 이미지 설명 / 분석
"""
import base64
import io
import os
from typing import Literal

import httpx
from celery import shared_task
from celery.utils.log import get_task_logger
from PIL import Image

logger = get_task_logger(__name__)

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")


# ── 헬퍼 ─────────────────────────────────────────────────────────────────────

def _load_image_bytes(source: str) -> bytes:
    """URL 또는 base64 data URI에서 이미지 바이트 로드"""
    if source.startswith("data:"):
        # data:image/jpeg;base64,....
        header, b64 = source.split(",", 1)
        return base64.b64decode(b64)
    with httpx.Client(timeout=30) as client:
        r = client.get(source)
        r.raise_for_status()
        return r.content


def _image_to_b64(img: Image.Image, fmt: str = "JPEG") -> str:
    buf = io.BytesIO()
    img.save(buf, format=fmt, quality=85)
    return base64.b64encode(buf.getvalue()).decode()


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

        return {
            "b64": b64,
            "width": img.width,
            "height": img.height,
            "format": output_format,
            "original_size": len(raw),
            "compressed_size": len(buf.getvalue()),
        }
    except Exception as exc:
        logger.error("resize_image failed: %s", exc)
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

        return {"text": data.get("response", ""), "model": model}
    except Exception as exc:
        logger.error("ocr_image failed: %s", exc)
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
                r = client.post(
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
                r.raise_for_status()
                response_text = r.json()["choices"][0]["message"]["content"]

        return {"response": response_text, "model": model, "provider": provider}
    except Exception as exc:
        logger.error("analyze_image failed: %s", exc)
        raise self.retry(exc=exc, countdown=10)


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
                r = client.post(
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
                r.raise_for_status()
                b64 = r.json()["data"][0]["b64_json"]
            return {"b64": b64, "url": None, "provider": "openai"}

        elif provider == "comfyui":
            base = comfyui_url or os.getenv("COMFYUI_URL", "http://localhost:8188")
            with httpx.Client(timeout=300) as client:
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
            return {"b64": None, "url": None, "provider": "comfyui", "prompt_id": r.json().get("prompt_id")}

        elif provider == "automatic1111":
            base = a1111_url or os.getenv("A1111_URL", "http://localhost:7860")
            with httpx.Client(timeout=300) as client:
                r = client.post(f"{base}/sdapi/v1/txt2img", json={
                    "prompt": prompt,
                    "negative_prompt": negative_prompt,
                    "steps": 20,
                    "width": int(size.split("x")[0]),
                    "height": int(size.split("x")[1]),
                })
                r.raise_for_status()
                b64 = r.json()["images"][0]
            return {"b64": b64, "url": None, "provider": "automatic1111"}

        else:
            raise ValueError(f"Unknown provider: {provider}")

    except Exception as exc:
        logger.error("generate_image failed: %s", exc)
        raise self.retry(exc=exc, countdown=15)
