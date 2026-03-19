# Umai — Chat-based AI Image Editor

> 채팅 인터페이스로 이미지를 생성·편집하는 AI 플랫폼.
> Open WebUI 수준의 어드민 패널과 OAuth 기반 인증을 포함합니다.

---

## 목차

1. [기능 개요](#기능-개요)
2. [기술 스택](#기술-스택)
3. [아키텍처](#아키텍처)
4. [로컬 개발](#로컬-개발)
5. [환경 변수](#환경-변수)
6. [어드민 패널](#어드민-패널)
7. [알려진 기술 부채](#알려진-기술-부채)
8. [배포](#배포)

---

## 기능 개요

| 영역 | 기능 |
|---|---|
| **채팅** | 스트리밍 AI 응답, 이미지 첨부, 마스크 에디터, 채팅 공유 |
| **이미지 편집** | 인페인팅(DALL·E 2), img2img(ComfyUI), 아웃페인팅(A1111) |
| **인증** | 이메일/비밀번호 + Google/GitHub OAuth, JWT + Refresh Token |
| **어드민** | 사용자 관리, Analytics, 평가(Ratings/Arena), 시스템 설정 |
| **설정 분리** | 유저 설정(개인 취향) vs 어드민 설정(서버 레벨 설정) 완전 분리 |
| **다국어** | 한국어/영어(i18n), 입력/출력 언어 오버라이드 |

---

## 기술 스택

### Frontend
| 항목 | 버전 |
|---|---|
| Next.js (App Router) | 16.1.6 |
| React | 19.2.3 |
| TypeScript | ^5 |
| Tailwind CSS | ^4 |
| Lucide React | ^0.577 |
| clsx | ^2.1 |

### Backend
| 항목 |
|---|
| FastAPI ≥ 0.115 |
| SQLAlchemy 2.0 (async) + asyncpg |
| Pydantic v2 |
| Alembic (migrations) |
| Redis 7 (hiredis) |
| Apache Kafka 3.9 (KRaft) |
| httpx ≥ 0.27 (OAuth HTTP client) |

### 인프라
```
nginx (rate limit, SSL termination)
PostgreSQL 16
Redis 7
Apache Kafka 3.9 (KRaft mode — ZooKeeper 불필요)
Docker Compose
```

---

## 아키텍처

### 전체 구성
```
┌─ Browser ─────────────────────────────────────────────┐
│  Next.js 16  App Router                               │
│  ├── Providers: Auth / Theme / Language / Sidebar     │
│  ├── Pages:    /chat  /editor  /workspace  /admin     │
│  ├── API Layer: backendClient.ts (JWT refresh 포함)   │
│  └── Stores:   Zustand (appStore, workspaceStore)     │
└───────────────────────────┬───────────────────────────┘
                            │ HTTPS / REST
┌─ nginx ───────────────────▼───────────────────────────┐
│  rate limit · SSL termination · proxy_pass             │
└───────────────────────────┬───────────────────────────┘
                            │
┌─ FastAPI ─────────────────▼───────────────────────────┐
│  routers/  auth · chats · folders · admin             │
│  core/     database · redis · kafka · security        │
│  models/   User · Chat (SQLAlchemy)                   │
│  schemas/  Pydantic v2 (request / response)           │
└──────┬────────────────┬────────────────────┬──────────┘
       │                │                    │
  PostgreSQL 16     Redis 7            Kafka (KRaft)
  (주 데이터)      (유저 캐시·         (이벤트 스트림)
                    세션)
```

### 설정 분리 원칙 (Open WebUI 기준)

| 영역 | 어드민 설정 | 유저 설정 |
|---|---|---|
| **API 키** | 서버 레벨 키 (OpenAI/Anthropic/Google) | — |
| **모델** | 공급자별 활성화·비활성화 | 기본 모델 선택 |
| **Audio** | STT/TTS 엔진 및 서버 API 키 | 음성·속도 개인화 |
| **OAuth** | Client ID/Secret 관리 | — |
| **RAG** | 임베딩 엔진, 청크 크기, 벡터 DB | — |
| **UI** | 시스템 기능 플래그 | 테마, 언어, 채팅 UI 취향 |

---

## 로컬 개발

### 사전 요구사항
- Docker Desktop (PostgreSQL, Redis, Kafka 실행용)
- Node.js 20+
- Python 3.11+

### 1. Docker 인프라 기동
```bash
# 백엔드 + DB + Redis + Kafka (프론트는 포함하지 않음)
docker compose -f docker-compose.dev.yml up -d postgres redis kafka backend

# 로그 확인
docker compose -f docker-compose.dev.yml logs -f backend
```

### 2. 프론트엔드 개발 서버
```bash
cd frontend
npm install
npm run dev        # http://localhost:3001
```

### 3. 포트 정리

| 포트 | 서비스 |
|---|---|
| 3001 | Next.js 개발 서버 (핫 리로드) |
| 3002 | Docker 프론트엔드 (프로덕션 빌드, 스테이징용) |
| 8001 | FastAPI 백엔드 |
| 5434 | PostgreSQL (호스트) |
| 6380 | Redis (호스트) |
| 9095 | Kafka (호스트) |

### 빌드 검증
```bash
cd frontend
npm run build      # TypeScript 에러 0개 확인
```

---

## 환경 변수

`backend/.env.example` → `backend/.env` 로 복사 후 편집:

```env
# App
SECRET_KEY=<openssl rand -hex 32>
BACKEND_URL=http://localhost:8001
FRONTEND_URL=http://localhost:3001    # 개발: 3001 (dev server)

# DB / Cache / MQ
DATABASE_URL=postgresql+asyncpg://umai:umai@localhost:5434/umai
REDIS_URL=redis://localhost:6380/0
KAFKA_BOOTSTRAP_SERVERS=localhost:9095

# OAuth
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...

# LLM (서버 레벨)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=AIza...

# Ollama (로컬 LLM)
OLLAMA_URL=http://localhost:11434     # 기본값, 없어도 무관
```

> **중요:** `FRONTEND_URL`은 OAuth 콜백 리다이렉트 목적지입니다.
> 개발 서버 포트(3001)와 Docker 프론트 포트(3002)가 다르므로
> 개발 시에는 반드시 3001로 설정하세요.

---

## 어드민 패널

`/admin` 경로, `role == "admin"` 계정만 접근 가능.

### 탭 구성

| 탭 | 경로 | 내용 |
|---|---|---|
| Users | `/admin` | 사용자 목록, 역할 변경, 활성화/비활성화 |
| Analytics | `/admin/analytics` | 사용자/채팅 통계, 모델 사용 분포 |
| Evaluations | `/admin/evaluations` | 메시지 평점(👍/👎), Arena 모드 |
| Settings | `/admin/settings` | General · Connections · Models · OAuth · Features · Documents · Audio · Images · Evaluations · Database |

### Settings 탭 상세

```
General       — 인스턴스 이름, 회원가입 허용, JWT 만료
Connections   — Ollama / OpenAI / Anthropic / Google AI 연결 테스트
Models        — 공급자별 모델 활성화 (Ollama 동적 목록 포함)
OAuth         — Google / GitHub Client ID·Secret
Features      — 웹 검색, 파일 업로드, 메모리, 커뮤니티 공유
Documents     — 임베딩 엔진, 청크 크기, Top-K, 하이브리드 검색
Audio         — STT(Whisper), TTS(OpenAI), 음성 선택
Images        — DALL·E / ComfyUI / A1111 설정
Evaluations   — 평점 토글, Arena 모드, CSV 내보내기
Database      — 전체 데이터 내보내기, 고아 세션 정리
```

---

## 알려진 기술 부채

> 코드 분석(중복 탐지·아키텍처 검증·성능 분석)을 통해 도출한 항목입니다.
> 우선순위 순서로 정렬됩니다.

### CRITICAL — 즉시 수정 필요

| # | 위치 | 문제 | 해결책 |
|---|---|---|---|
| C1 | `auth/callback/page.tsx:28` | `backendClient.ts` 우회 — 직접 `fetch()` 사용 | `apiTokenExchange(code)` 함수 추가 |
| C2 | `components/auth/OnboardingModal.tsx:31` | 직접 `fetch()` + 수동 토큰 주입 | `apiOnboard()` 함수 추가 |
| C3 | `lib/appStore.ts:22` | API 키를 localStorage에 평문 저장 | 클라이언트에서 제거, 백엔드 환경변수만 사용 |
| C4 | `lib/apis/chat.ts:122` | `clientApiKey`를 요청 본문에 노출 | 백엔드가 서버 키만 사용하도록 변경 |

### HIGH — 단기 수정

| # | 위치 | 문제 | 해결책 |
|---|---|---|---|
| H1 | `app/admin/settings/page.tsx` | 시스템 설정에 개인 Audio 취향 혼입 | Audio 개인 설정 → SettingsModal 이동 |
| H2 | `backend/app/routers/admin.py:59` | Stats 조회 시 3개 개별 SQL | CASE/WHEN 단일 쿼리로 통합 |
| H3 | `app/admin/analytics/page.tsx:57` | 7일 신규 유저 카운트를 위해 200명 전체 fetch | `/admin/stats/users-this-week` 전용 엔드포인트 |
| H4 | `app/admin/page.tsx` | 페이지네이션 UI 없음 | prev/next 버튼 + 가상 스크롤(100명↑) |

### MEDIUM — 중기 개선

| # | 위치 | 문제 | 해결책 |
|---|---|---|---|
| M1 | `lib/api/backendClient.ts:74` | 토큰 만료 시 동시 요청 중복 refresh | `refreshPromise` 플래그로 중복 방지 |
| M2 | `lib/hooks/useChat.ts:46` | 메시지 저장 실패를 `.catch(() => {})` 로 무시 | 배치 POST 또는 `Promise.allSettled` |
| M3 | `backend/app/routers/admin.py:129` | `flush()` 후 `commit()` 누락 | `await db.commit()` 추가 |
| M4 | `app/admin/**/*.tsx` | `AdminNav` 컴포넌트 3곳에 복붙 | `/components/admin/AdminNav.tsx` 추출 |
| M5 | `backend/app/routers/*.py` | 엔티티 404 조회 패턴 15회 반복 | `get_entity_or_404()` 유틸리티 추출 |
| M6 | `SettingsModal.tsx`, `admin/settings/page.tsx` | `Toggle`/`Section` 컴포넌트 중복 | `/components/common/Toggle.tsx` 공통화 |

### LOW — 장기 개선

| # | 위치 | 문제 | 해결책 |
|---|---|---|---|
| L1 | `backend/app/schemas/` | Pydantic v1 `class Config` 혼용 | v2 `model_config` + 베이스 클래스 통일 |
| L2 | `backend/app/routers/` | `chats.py`, `folders.py`에 동일 소유권 검증 함수 | `common.py`에 `assert_owner()` 추출 |
| L3 | `lib/api/backendClient.ts` | 토큰 관리 로직이 단일 파일에 집중 | `/lib/auth/tokenManager.ts` 분리 |
| L4 | 전체 타입 | `UserOut`이 프론트/백 각각 정의됨 | OpenAPI 스키마 자동 생성 고려 |
| L5 | `lib/apis/chat.ts:66` | 숨겨진 탭에서 스트리밍 버퍼 1s 간격 | 200-300ms로 단축 |
| L6 | `auth/callback/page.tsx:26` | 코드 교환 요청에 타임아웃 없음 | `AbortController` 5초 타임아웃 추가 |

---

## 배포

Oracle Cloud Free Tier (ARM VM, 4 OCPU / 24GB RAM) 기준 전체 스택을 무료로 운영할 수 있습니다.

자세한 내용은 [DEPLOY.md](./DEPLOY.md) 참고.

```bash
# 프로덕션 빌드 & 실행
docker compose up --build -d

# 재배포
git pull && docker compose up --build -d
```

---

## 라이선스

MIT
