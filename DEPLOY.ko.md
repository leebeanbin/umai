# Umai — 프로덕션 배포 가이드

> 풀스택 AI 플랫폼을 위한 단일 호스트 Docker Compose 배포: Next.js 프론트엔드, FastAPI 백엔드, PostgreSQL + pgvector, Redis, Celery 워커 — 강화된 Nginx 리버스 프록시 뒤에 모두 배치.

[English](DEPLOY.md) | **한국어**

---

## 아키텍처 개요

```
인터넷
  │  (80/443만 허용 — 다른 모든 포트 차단)
  ▼
Nginx  ──────────── SSL 종료, 레이트 리밋, 정적 캐싱
  ├──→ umai-frontend   (Next.js 15, 내부 포트 3000)
  └──→ umai-backend    (FastAPI,   내부 포트 8000)
                             │
                    ┌────────┴────────┐
              PostgreSQL 16        Redis 7
              (+ pgvector)    (세션 / 캐시 / Celery)
                                       │
                               Celery 워커
                       (ai / image / knowledge / default 큐)
```

모든 서비스 간 트래픽은 내부 Docker 네트워크에서 유지됩니다. **데이터베이스나 API 포트는 인터넷에 노출되지 않습니다.**

---

## 인프라 옵션

| 대상 | 사양 | 비용 | 비고 |
|---|---|---|---|
| **Oracle Cloud 무료 티어** | VM.Standard.A1.Flex — 4 OCPU / 24 GB RAM (ARM) | 월 $0 | 권장 시작점 |
| **AWS EC2** | t3.xlarge — 4 vCPU / 16 GB RAM | 월 ~$120 | 미국 리전 레이턴시에 좋음 |
| **Hetzner Cloud** | CX31 — 2 vCPU / 8 GB RAM | 월 ~€8 | 유럽 최고 가격/성능비 |
| **로컬 / 베어메탈** | RAM 8 GB+ x86-64 또는 ARM64 | 하드웨어 비용 | 개발 또는 온프레미스 |

최소 사양: **RAM 4 GB** (Celery 워커 동시성을 1로 줄임).
권장: 프로덕션 AI 워크로드에는 **RAM 8 GB+**.

---

## 사전 요구사항

- Docker 24+ 및 Docker Compose v2
- 도메인 이름 (프로덕션의 HTTPS / OAuth에 필요)
- 서버의 공인 IP를 가리키는 DNS A 레코드

---

## 보안 체크리스트

인터넷에 서비스를 노출하기 전에 이 목록을 확인하세요.

- [ ] `SECRET_KEY`는 랜덤 32바이트 hex 문자열 (`openssl rand -hex 32`)
- [ ] `SESSION_SECRET_KEY`는 `SECRET_KEY`와 **다른** 랜덤 문자열
- [ ] `POSTGRES_PASSWORD`와 `REDIS_PASSWORD`가 강력한 값으로 설정됨
- [ ] `BACKEND_URL`과 `FRONTEND_URL` 모두 `https://` 사용 (앱이 그렇지 않으면 시작 거부)
- [ ] 방화벽이 **포트 22, 80, 443만** 허용 (모든 백엔드/DB 포트 차단)
- [ ] Google/GitHub 콘솔의 OAuth 리디렉션 URI가 HTTPS 도메인과 일치
- [ ] `/docs` (Swagger UI) 비활성화 — `DEBUG=False`로 자동 비활성화
- [ ] Nginx `server_tokens off;` 설정됨 (서버 버전 숨김)
- [ ] SSL 인증서 자동 갱신 설정됨 (Certbot 타이머 또는 cron)
- [ ] `docker compose logs`에서 트래픽 라우팅 전 시작 오류 없음 확인

---

## 1단계 — 서버 프로비저닝

### Oracle Cloud 무료 티어 (권장)

1. https://oracle.com/cloud/free 에서 가입 (신원 확인용 신용카드 필요; Always Free 티어는 청구 없음)
2. 컴퓨트 인스턴스 생성:
   ```
   Compute → Instances → Create Instance
   ├── Image:  Ubuntu 22.04
   ├── Shape:  VM.Standard.A1.Flex (ARM)
   │   ├── OCPU:   4
   │   └── Memory: 24 GB
   └── SSH Keys: 공개 키 업로드
   ```
3. VCN 보안 목록에서 방화벽 규칙 열기:
   ```
   Networking → Virtual Cloud Networks → [VCN 선택]
   → Security Lists → Default → Add Ingress Rules

   소스 CIDR    프로토콜   목적지 포트
   0.0.0.0/0    TCP        22     (SSH)
   0.0.0.0/0    TCP        80     (HTTP)
   0.0.0.0/0    TCP        443    (HTTPS)
   ```
   > 5432, 6379, 8000, 3000 또는 다른 내부 포트는 열지 마세요.

4. OS 방화벽에서도 이 포트들을 열기:
   ```bash
   sudo ufw allow 22 && sudo ufw allow 80 && sudo ufw allow 443
   sudo ufw enable
   ```

---

## 2단계 — 서버 설정

```bash
# 서버에 SSH 접속
ssh ubuntu@<SERVER_IP>

# Docker 및 Docker Compose 설치
curl -fsSL https://get.docker.com | bash
sudo usermod -aG docker $USER
newgrp docker        # 재로그인 없이 그룹 적용

# (선택 권장) 안정성을 위한 4 GB 스왑 추가
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# 저장소 클론
git clone https://github.com/<your-org>/umai.git ~/umai
cd ~/umai
```

---

## 3단계 — 환경 변수

```bash
cp backend/.env.example backend/.env
nano backend/.env
```

**필수 값 (프로덕션에서 없으면 앱이 시작되지 않음):**

```env
# ── 보안 ──────────────────────────────────────────────────────────────────────
# 생성 명령: openssl rand -hex 32
SECRET_KEY=<랜덤-32바이트-hex>
SESSION_SECRET_KEY=<다른-랜덤-32바이트-hex>

# ── URL (프로덕션에서는 반드시 HTTPS) ─────────────────────────────────────────
BACKEND_URL=https://yourdomain.com
FRONTEND_URL=https://yourdomain.com

# ── 데이터베이스 ──────────────────────────────────────────────────────────────
DATABASE_URL=postgresql+asyncpg://umai:<POSTGRES_PASSWORD>@postgres:5432/umai
POSTGRES_PASSWORD=<강력한-비밀번호>

# ── Redis ─────────────────────────────────────────────────────────────────────
REDIS_URL=redis://:<REDIS_PASSWORD>@redis:6379/0
REDIS_PASSWORD=<강력한-비밀번호>

# ── Celery (Redis를 브로커로 사용) ────────────────────────────────────────────
CELERY_BROKER_URL=redis://:<REDIS_PASSWORD>@redis:6379/1
CELERY_RESULT_BACKEND=redis://:<REDIS_PASSWORD>@redis:6379/2

# ── AI 프로바이더 (채팅 작동을 위해 최소 하나 필요) ──────────────────────────
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=AIza...

# ── OAuth (선택 — 이메일/비밀번호 인증은 없어도 작동) ─────────────────────────
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
```

---

## 4단계 — SSL 인증서

```bash
# Certbot 설치
sudo apt install certbot -y

# 인증서 발급 (먼저 포트 80을 사용하는 서비스 중지)
sudo certbot certonly --standalone -d yourdomain.com

# 인증서 위치:
#   /etc/letsencrypt/live/yourdomain.com/fullchain.pem
#   /etc/letsencrypt/live/yourdomain.com/privkey.pem

# Nginx 볼륨 경로에 인증서 복사
sudo cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem nginx/certs/
sudo cp /etc/letsencrypt/live/yourdomain.com/privkey.pem   nginx/certs/

# nginx/nginx.conf에서 HTTPS 블록 활성화 (ssl server block 주석 해제)
nano nginx/nginx.conf

# 자동 갱신 (Certbot이 설정한 systemd 타이머로 하루 두 번 실행)
sudo systemctl status certbot.timer
```

---

## 5단계 — OAuth 콜백 URL

첫 로그인 **전에** 각 프로바이더의 개발자 콘솔에 이 URI를 등록하세요.

**Google** — [Google Cloud Console](https://console.cloud.google.com/apis/credentials):
```
https://yourdomain.com/api/v1/auth/oauth/google/callback
```

**GitHub** — [GitHub Developer Settings](https://github.com/settings/applications/new):
```
https://yourdomain.com/api/v1/auth/oauth/github/callback
```

---

## 6단계 — 배포

```bash
cd ~/umai

# 이미지 빌드 및 모든 서비스 시작
docker compose up --build -d

# 시작 로그 확인 (Ctrl-C로 분리, 서비스는 계속 실행)
docker compose logs -f backend celery-worker

# 모든 컨테이너 정상 확인
docker compose ps

# 데이터베이스 마이그레이션 실행
docker compose exec umai-backend alembic upgrade head
```

앱이 `https://yourdomain.com`에서 라이브 상태입니다.

---

## 7단계 — 첫 관리자 계정 생성

```bash
# 데이터베이스에 연결
docker compose exec umai-postgres psql -U umai -d umai

-- 기존 등록 사용자를 관리자로 승격
UPDATE users SET role = 'admin' WHERE email = 'you@example.com';
\q
```

---

## 모니터링 & 운영

### 실시간 로그

```bash
docker compose logs -f backend          # FastAPI 요청 로그 + 오류
docker compose logs -f celery-worker    # 백그라운드 태스크 로그
docker compose logs -f nginx            # 액세스 / 오류 로그
docker compose logs -f postgres         # DB 로그
```

### 헬스 체크

```bash
# DB + Redis 연결 가능하면 {"status":"ok"} 반환
curl https://yourdomain.com/health
```

### 리소스 사용량

```bash
docker stats                            # 컨테이너별 실시간 CPU/메모리
docker compose exec umai-postgres psql -U umai -c "SELECT count(*) FROM users;"
docker compose exec umai-redis redis-cli -a $REDIS_PASSWORD info memory
```

### 재배포 (코드 업데이트)

```bash
cd ~/umai
git pull
docker compose up --build -d           # 서비스별 무중단 롤링 업데이트
docker compose exec umai-backend alembic upgrade head   # 마이그레이션 있을 때만
```

### 단일 서비스 재시작

```bash
docker compose restart backend
docker compose restart celery-worker
```

### 긴급 중지 / 전체 초기화

```bash
docker compose down              # 모든 서비스 중지, 볼륨 유지
docker compose down -v           # 경고: 모든 DB 데이터와 Redis 상태 삭제
```

---

## 리소스 예산 (Oracle 무료 티어 — 24 GB RAM)

| 서비스 | 메모리 제한 | 비고 |
|---|---|---|
| umai-frontend | 512 MB | Next.js SSR |
| umai-backend | 1 GB | FastAPI + 연결 풀 |
| celery-worker | 1.5 GB | 4큐 × 동시성 2 |
| umai-postgres | 2 GB | pgvector 확장 포함 |
| umai-redis | 512 MB | 세션 + Celery 브로커 + pub/sub |
| nginx | 128 MB | |
| **합계** | **~5.7 GB** | **24 GB의 ~24%** |

나머지 ~18 GB는 `celery-worker` 동시성 확장이나 지식 베이스 파이프라인을 위한 전용 임베딩 워커 추가에 사용할 수 있습니다.

---

## 레이트 리밋 참조

두 레이어의 레이트 리밋이 모든 엔드포인트를 보호합니다:

| 레이어 | 범위 | 제한 |
|---|---|---|
| Nginx | 모든 `/api/*` 트래픽 | 60 req/min/IP |
| Nginx | 인증 엔드포인트 | 5 req/min/IP |
| Nginx | 프론트엔드 자산 | 120 req/min/IP |
| Nginx | 동시 연결 | 20/IP |
| FastAPI (SlowAPI) | 전역 기본값 | 200 req/min/IP |
| FastAPI | `POST /auth/register` | 5 req/min/IP |
| FastAPI | `POST /auth/login` | 10 req/min/IP |
| FastAPI | `POST /auth/refresh` | 30 req/min/IP |
| FastAPI | `GET /rag/search` | 20 req/min/IP |

제한값은 `backend/app/core/constants.py`에 중앙 집중화되어 있습니다 — 조정하려면 거기서 수정하세요.

---

## 문제 해결

| 증상 | 가능한 원인 | 해결 방법 |
|---|---|---|
| `RuntimeError: SECRET_KEY must be set` | `.env`에 기본 키 사용 | `SECRET_KEY`를 32+ 자 랜덤 hex로 설정 |
| `RuntimeError: BACKEND_URL must use HTTPS` | URL이 `http://`로 시작 | `.env`에서 `https://`로 변경 |
| OAuth 리디렉션 실패 | 콜백 URI 미등록 | Google/GitHub 콘솔에 정확한 URI 추가 |
| Celery 태스크 중단 | Redis 연결 불가 | `REDIS_URL`/`CELERY_BROKER_URL` 확인 |
| `pgvector` 확장 없음 | DB 초기화 순서 문제 | `docker compose exec umai-postgres psql -U umai -d umai -c "CREATE EXTENSION IF NOT EXISTS vector;"` |
| 컨테이너 OOM 종료 | 메모리 제한 너무 낮음 | `docker-compose.yml`에서 제한 늘리거나 스왑 추가 |
| 502 Bad Gateway | 백엔드 미시작 | `docker compose logs backend` — 시작 오류 확인 |
