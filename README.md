# Umai — Chat-based AI Platform

> 채팅·이미지 편집·Knowledge Base·AI 에이전트를 통합한 오픈소스 AI 플랫폼.
> Ollama / OpenAI / Anthropic / Google 멀티 프로바이더 지원.

---

## 기능 개요

| 영역 | 기능 |
|---|---|
| **채팅** | 스트리밍 AI 응답, 이미지 첨부, 마스크 에디터, 채팅 공유 |
| **AI 에이전트** | Tool-use 루프 (웹 검색 · Python 실행 · Knowledge 검색), Celery 병렬 처리 |
| **이미지 처리** | 리사이즈, OCR(vision 모델), 이미지 분석, 생성(DALL·E / ComfyUI / A1111) |
| **Knowledge Base** | PDF·DOCX·TXT·MD 업로드 → 자동 파싱·청킹·임베딩 (Celery 백그라운드) |
| **인증** | 이메일/비밀번호 + Google/GitHub OAuth, JWT + Refresh Token |
| **어드민** | 사용자 관리, 통계, 시스템 설정 (Connections · Models · RAG · Audio · Images) |
| **다국어** | 한국어 / 영어 (i18n) |

---

## 아키텍처

```
브라우저
  └─ Next.js (포트 3000)
       └─ rewrite proxy (/api/*) ──→ FastAPI (포트 8000/8001)
                                        ├─ PostgreSQL 16   (주 데이터)
                                        ├─ Redis 7         (세션·캐시·Celery 브로커)
                                        └─ Celery Worker   (image / ai / knowledge / default 큐)
```

**핵심 설계 원칙:**
- 브라우저는 프론트엔드 포트만 알면 됨 — `/api/*` 상대경로 → Next.js가 백엔드로 프록시
- Celery + Redis로 이미지·AI·임베딩 태스크 비동기 병렬 처리
- Redis db0=세션캐시, db1=Celery 브로커, db2=Celery 결과

---

## 기술 스택

| 영역 | 기술 |
|---|---|
| Frontend | Next.js 16 (App Router), TypeScript, Tailwind CSS 4 |
| Backend | FastAPI, SQLAlchemy 2.0 async, Alembic, Pydantic v2 |
| Database | PostgreSQL 16 |
| Cache / Session | Redis 7 (hiredis) |
| Task Queue | Celery 5 + Redis broker |
| AI | Ollama, OpenAI, Anthropic, Google AI |
| Auth | JWT (access 15분 / refresh 30일), Google·GitHub OAuth |
| Infra | Docker Compose, Nginx (프로덕션) |

---

## 로컬 개발

### 권장 방식: Docker 인프라 + 네이티브 Next.js

```
Docker:  postgres · redis · backend · (celery worker)
Native:  npm run dev  →  http://localhost:3000
```

Next.js `.env.local`의 `INTERNAL_API_URL`이 `/api/*` 요청을 Docker 백엔드로 자동 프록시합니다.
브라우저는 포트 3000만 알면 됩니다.

### 1단계: 환경 변수 설정

```bash
# 백엔드
cp backend/.env.example backend/.env
# 최소 필수: SECRET_KEY, BACKEND_URL, FRONTEND_URL

# 프론트엔드 (기본값으로 즉시 동작)
cp frontend/.env.local.example frontend/.env.local
```

### 2단계: Docker 인프라 실행

```bash
docker compose -f docker-compose.dev.yml up --build -d
```

| 컨테이너 | 접근 URL |
|---|---|
| Backend API | http://localhost:8001 |
| API 문서 (Swagger) | http://localhost:8001/docs |
| Frontend (Docker 빌드) | http://localhost:3002 |
| PostgreSQL | localhost:5434 |
| Redis | localhost:6380 |

### 3단계: 프론트엔드 네이티브 실행 (핫 리로드)

```bash
cd frontend
npm install
npm run dev
# → http://localhost:3000
```

### 4단계: Celery Worker (AI·이미지·임베딩 태스크 필요 시)

```bash
cd backend
pip install -r requirements.txt
celery -A app.core.celery_app worker \
  -Q image,ai,knowledge,default \
  -c 2 --loglevel=info
```

---

## 소셜 로그인 (OAuth) 설정

> OAuth는 **브라우저 → Next.js → 백엔드 → Google/GitHub** 순서로 동작합니다.
> Google/GitHub이 콜백할 URL은 **백엔드 직접 주소**여야 합니다.

### Google

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → OAuth 2.0 클라이언트 생성
2. **승인된 리디렉션 URI** 추가:
   ```
   http://localhost:8001/api/v1/auth/oauth/google/callback
   ```
3. `backend/.env`에 입력:
   ```env
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   BACKEND_URL=http://localhost:8001   # Google이 콜백할 주소
   FRONTEND_URL=http://localhost:3000  # OAuth 완료 후 리다이렉트 (npm run dev 포트)
   ```

### GitHub

1. [GitHub → Settings → Developer applications](https://github.com/settings/applications/new)
2. **Authorization callback URL**:
   ```
   http://localhost:8001/api/v1/auth/oauth/github/callback
   ```
3. `backend/.env`에 입력:
   ```env
   GITHUB_CLIENT_ID=...
   GITHUB_CLIENT_SECRET=...
   ```

> **`FRONTEND_URL` 포트 주의:**
> `npm run dev` 사용 시 → `http://localhost:3000`
> Docker 프론트엔드 사용 시 → `http://localhost:3002`

---

## 환경 변수 참조

### `backend/.env`

| 변수 | 로컬 기본값 | 설명 |
|---|---|---|
| `SECRET_KEY` | (필수 변경) | JWT 서명 키 — `openssl rand -hex 32` |
| `DATABASE_URL` | `postgresql+asyncpg://umai:umai@localhost:5434/umai` | 비동기 DB |
| `REDIS_URL` | `redis://localhost:6380/0` | 세션·캐시 |
| `CELERY_BROKER_URL` | `redis://localhost:6380/1` | Celery 브로커 |
| `CELERY_RESULT_BACKEND` | `redis://localhost:6380/2` | Celery 결과 저장 |
| `BACKEND_URL` | `http://localhost:8001` | OAuth 콜백 URI 생성에 사용 |
| `FRONTEND_URL` | `http://localhost:3000` | OAuth 완료 후 리다이렉트 대상 |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama 서버 주소 |
| `OPENAI_API_KEY` | — | GPT-4o 등 |
| `ANTHROPIC_API_KEY` | — | Claude 등 |

### `frontend/.env.local`

| 변수 | 설명 |
|---|---|
| `INTERNAL_API_URL` | 백엔드 URL (서버사이드 전용). `next.config.ts` rewrite 대상. 기본값: `http://localhost:8001` |

---

## 자주 쓰는 명령어

```bash
# 컨테이너 상태 확인
docker compose -f docker-compose.dev.yml ps

# 백엔드 로그 실시간
docker logs umai-backend -f

# DB 마이그레이션
docker compose -f docker-compose.dev.yml exec umai-backend alembic upgrade head

# 재시작 (orphan 컨테이너 제거 포함)
docker compose -f docker-compose.dev.yml up --remove-orphans -d

# 백엔드 이미지 강제 재빌드 (requirements.txt 변경 후 필수)
docker compose -f docker-compose.dev.yml build --no-cache umai-backend
docker compose -f docker-compose.dev.yml up -d

# 전체 종료
docker compose -f docker-compose.dev.yml down

# 볼륨 포함 완전 초기화 (DB 데이터 삭제)
docker compose -f docker-compose.dev.yml down -v

# TypeScript 타입 검사
cd frontend && npx tsc --noEmit
```

---

## 프로덕션 배포

```bash
cp backend/.env.example backend/.env
# SECRET_KEY, POSTGRES_PASSWORD, BACKEND_URL, FRONTEND_URL 설정

docker compose up --build -d

# 재배포
git pull && docker compose up --build -d
```

**필수 변경 항목:**

| 변수 | 예시 |
|---|---|
| `SECRET_KEY` | `openssl rand -hex 32` |
| `POSTGRES_PASSWORD` | 강한 패스워드 |
| `BACKEND_URL` | `https://api.yourdomain.com` |
| `FRONTEND_URL` | `https://yourdomain.com` |

---

## 라이선스

MIT
