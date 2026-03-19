# ──────────────────────────────────────────────────────────────────────────────
# Umai — 개발 통합 실행 Makefile
#
# 로컬 포트 현황:
#   프론트:  http://localhost:3002
#   백엔드:  http://localhost:8001  (docs: http://localhost:8001/docs)
#   PG:     localhost:5434
#   Redis:  localhost:6380
#   Kafka:  localhost:9095
# ──────────────────────────────────────────────────────────────────────────────

.PHONY: dev up down migrate logs ps clean help

# ── 통합 실행 (전체 Docker) ───────────────────────────────────────────────────
dev:
	@echo "→ 전체 서비스 빌드 & 실행..."
	docker compose -f docker-compose.dev.yml up --build -d
	@echo ""
	@echo "✓ 실행 완료"
	@echo "  프론트엔드: http://localhost:3002"
	@echo "  백엔드 API: http://localhost:8001"
	@echo "  API 문서:   http://localhost:8001/docs"
	@echo ""

# ── 동일 (alias) ──────────────────────────────────────────────────────────────
up: dev

# ── 정지 ─────────────────────────────────────────────────────────────────────
down:
	docker compose -f docker-compose.dev.yml down

# ── 마이그레이션만 실행 ───────────────────────────────────────────────────────
migrate:
	docker compose -f docker-compose.dev.yml exec umai-backend alembic upgrade head

# ── 로그 확인 ─────────────────────────────────────────────────────────────────
logs:
	docker compose -f docker-compose.dev.yml logs -f umai-backend umai-postgres

logs-all:
	docker compose -f docker-compose.dev.yml logs -f

# ── 컨테이너 상태 ─────────────────────────────────────────────────────────────
ps:
	docker compose -f docker-compose.dev.yml ps

# ── 볼륨 포함 전체 삭제 (데이터 초기화) ──────────────────────────────────────
clean:
	docker compose -f docker-compose.dev.yml down -v
	@echo "✓ 볼륨 포함 전체 삭제 완료"

# ── 백엔드만 재빌드 ───────────────────────────────────────────────────────────
rebuild-backend:
	docker compose -f docker-compose.dev.yml up -d --build umai-backend

# ── DB 접속 ───────────────────────────────────────────────────────────────────
psql:
	docker compose -f docker-compose.dev.yml exec umai-postgres psql -U umai -d umai

redis-cli:
	docker compose -f docker-compose.dev.yml exec umai-redis redis-cli

# ── 프로덕션 배포 (Oracle Cloud) ─────────────────────────────────────────────
prod-up:
	docker compose up --build -d

prod-down:
	docker compose down

prod-logs:
	docker compose logs -f backend nginx

# ── 도움말 ───────────────────────────────────────────────────────────────────
help:
	@echo ""
	@echo "  make dev           통합 실행 (Docker 인프라+백엔드 + 프론트 hot-reload)"
	@echo "  make up            Docker 서비스만 실행"
	@echo "  make down          Docker 서비스 정지"
	@echo "  make migrate       Alembic 마이그레이션 실행"
	@echo "  make logs          백엔드 + DB 로그"
	@echo "  make logs-all      전체 로그"
	@echo "  make ps            컨테이너 상태"
	@echo "  make clean         볼륨 포함 전체 삭제"
	@echo "  make psql          PostgreSQL 접속"
	@echo "  make redis-cli     Redis CLI 접속"
	@echo ""
