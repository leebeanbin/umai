FROM python:3.12-slim

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

# 시스템 의존성
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev curl python3-dev \
    libjpeg-dev libpng-dev libwebp-dev \
    && rm -rf /var/lib/apt/lists/*

# Lock 파일 먼저 복사 → 의존성 레이어 캐시 분리
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY . .

EXPOSE 8000

CMD ["uv", "run", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
