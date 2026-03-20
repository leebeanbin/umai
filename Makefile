# ──────────────────────────────────────────────────────────────────────────────
# Umai — 개발 통합 실행 Makefile
#
# 권장 개발 워크플로우:
#   1) make infra      → postgres + redis + backend (Docker)
#   2) npm run dev     → Next.js 핫리로드  http://localhost:3000
#
# 전체 Docker 확인용 (빌드 검증, 핫리로드 없음):
#   make dev           → 모든 서비스 Docker 빌드  http://localhost:3002
#
# 포트 정리:
#   3000  npm run dev (네이티브 Next.js, 주 개발용)
#   3002  Docker 빌드 프론트엔드 (make dev 빌드 검증용)
#   8001  백엔드 API  (docs: /docs)
#   5434  PostgreSQL
#   6380  Redis
# ──────────────────────────────────────────────────────────────────────────────

.PHONY: dev infra up down migrate logs ps clean help

# ── 권장: 인프라+백엔드만 Docker, 프론트는 npm run dev ───────────────────────
infra:
	@echo "→ 인프라 + 백엔드 실행..."
	docker compose -f docker-compose.dev.yml up --build -d umai-postgres umai-redis umai-backend
	@echo ""
	@echo "✓ 인프라 준비 완료"
	@echo "  백엔드 API: http://localhost:8001"
	@echo "  API 문서:   http://localhost:8001/docs"
	@echo ""
	@echo "  → 프론트엔드 핫리로드 시작: cd frontend && npm run dev"
	@echo "    접속 주소:                http://localhost:3000"
	@echo ""

# ── 전체 Docker 빌드 (빌드 검증 / 프론트 핫리로드 불필요 시) ─────────────────
dev:
	@echo "→ 전체 서비스 빌드 & 실행..."
	docker compose -f docker-compose.dev.yml up --build -d
	@echo ""
	@echo "✓ 실행 완료 (Docker 빌드 — 핫리로드 없음)"
	@echo "  프론트엔드: http://localhost:3002  ← Docker 빌드본 (빌드 검증용)"
	@echo "  백엔드 API: http://localhost:8001"
	@echo "  API 문서:   http://localhost:8001/docs"
	@echo ""
	@echo "  핫리로드가 필요하면: cd frontend && npm run dev  (→ :3000)"
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

# ── 프로덕션 배포 ─────────────────────────────────────────────────────────────
prod-up:
	docker compose up --build -d

prod-down:
	docker compose down

prod-logs:
	docker compose logs -f backend nginx

# ── 도움말 ───────────────────────────────────────────────────────────────────
help:
	@echo ""
	@echo "  make infra         인프라+백엔드만 Docker 실행 (프론트는 npm run dev)"
	@echo "  make dev           전체 서비스 Docker 빌드 (빌드 검증용, 핫리로드 없음)"
	@echo "  make down          Docker 서비스 정지"
	@echo "  make migrate       Alembic 마이그레이션 실행"
	@echo "  make logs          백엔드 + DB 로그"
	@echo "  make logs-all      전체 로그"
	@echo "  make ps            컨테이너 상태"
	@echo "  make clean         볼륨 포함 전체 삭제"
	@echo "  make psql          PostgreSQL 접속"
	@echo "  make redis-cli     Redis CLI 접속"
	@echo "  make prod-up       프로덕션 배포"
	@echo ""
