# 데이터 모델 & 스키마

## 개요

Umai의 PostgreSQL 스키마는 14개 테이블로 구성됩니다.
모든 기본 키는 UUID v4입니다. 외래 키는 CASCADE 삭제 또는 SET NULL을 사용해 데이터 정합성을 유지합니다.
벡터 검색(pgvector)과 전체 텍스트 검색(tsvector)을 위한 특수 컬럼도 포함됩니다.

---

## 전체 ER 다이어그램

```
┌────────────────────────────────────────────────────────────────────────────┐
│                               users                                        │
│  id(PK) · email(UQ) · name · hashed_password · oauth_provider · role      │
│  is_active · is_onboarded · notification_email · created_at · last_seen_at │
└───┬──────────────────────┬────────────┬────────────┬──────────┬────────────┘
    │                      │            │            │          │
  1:N                    1:N          1:N          1:N        1:N
    │                      │            │            │          │
    ▼                      ▼            ▼            ▼          ▼
┌──────────┐   ┌─────────────────┐  ┌──────────┐  ┌──────────────────┐  ┌─────────────────┐
│  chats   │   │  workspace_     │  │ folders  │  │ knowledge_items  │  │   workflows     │
│          │   │  items          │  │          │  │                  │  │                 │
└───┬──────┘   └─────────────────┘  └──────────┘  └────────┬─────────┘  └────────┬────────┘
    │ 1:N (folder_id, nullable)                             │ 1:N                 │ 1:N
    │                                                       ▼                     ▼
    ├──────────────────┐                        ┌─────────────────────┐  ┌────────────────┐
    │                  │                        │  knowledge_chunks   │  │ workflow_runs  │
  1:N                1:N                        │  embedding(vector)  │  │                │
    ▼                  ▼                        │  tsv(tsvector)      │  └───────┬────────┘
┌──────────┐  ┌────────────────┐               └─────────────────────┘          │ 1:N
│ messages │  │  chat_members  │                                                 ▼
│          │  │ role:owner/    │                                     ┌─────────────────────┐
└──────────┘  │  editor/viewer │                                     │ workflow_run_steps  │
              └────────────────┘                                     └─────────────────────┘

┌────────────────────┐         ┌──────────────────┐
│ training_datasets  │◄────────│  fine_tune_jobs  │
│                    │   N:1   │  (dataset_id FK) │
└────────────────────┘         └──────────────────┘

┌─────────────────────────────┐
│  system_settings (싱글톤)   │
│  id=1 고정, data(JSONB)     │
└─────────────────────────────┘
```

---

## 도메인별 테이블 상세

### 인증 & 사용자

#### `users`

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | UUID | PK | uuid4 자동 생성 |
| `email` | VARCHAR(255) | UNIQUE, NOT NULL, INDEX | 로그인 식별자 |
| `name` | VARCHAR(255) | NOT NULL | 표시 이름 |
| `avatar_url` | TEXT | NULL | 프로필 이미지 URL |
| `hashed_password` | VARCHAR(255) | NULL | bcrypt 해시; 소셜 전용 사용자는 NULL |
| `oauth_provider` | ENUM | NULL | `'google'` \| `'github'` |
| `oauth_sub` | VARCHAR(255) | NULL, INDEX | 프로바이더 고유 ID |
| `role` | ENUM | NOT NULL, default=`'user'` | `'admin'` \| `'user'` \| `'pending'` |
| `is_active` | BOOLEAN | NOT NULL, default=`true` | 비활성화 시 로그인 차단 |
| `is_onboarded` | BOOLEAN | NOT NULL, default=`false` | 첫 소셜 로그인 후 닉네임 설정 완료 여부 |
| `notification_email` | VARCHAR(255) | NULL | 온보딩 시 설정; 기본값은 email |
| `created_at` | TIMESTAMPTZ | NOT NULL | |
| `last_seen_at` | TIMESTAMPTZ | NULL | 최근 활동 시간 |

**설계 이유:**
- `hashed_password` NULL 허용 — 소셜 전용 계정과 혼합 계정을 같은 테이블에서 관리
- `oauth_sub` 인덱스 — OAuth 콜백에서 `WHERE oauth_provider=X AND oauth_sub=Y`로 사용자 조회
- `role='pending'` — 관리자 수동 승인이 필요한 가입 플로우 지원

---

### 채팅

#### `chats`

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | UUID | PK | |
| `user_id` | UUID | FK → users(CASCADE), INDEX | 채팅 소유자 |
| `title` | VARCHAR(500) | NOT NULL, default=`'New Chat'` | AI가 자동 생성 또는 수동 설정 |
| `folder_id` | UUID | FK → folders(SET NULL), NULL | 폴더 분류 (삭제 시 채팅은 보존) |
| `is_pinned` | BOOLEAN | NOT NULL, default=`false` | 목록 상단 고정 |
| `is_archived` | BOOLEAN | NOT NULL, default=`false` | 보관; 기본 목록에서 숨김 |
| `is_temporary` | BOOLEAN | NOT NULL, default=`false` | 임시 채팅; 세션 종료 시 삭제 대상 |
| `model` | VARCHAR(100) | NULL | 이 채팅에서 사용한 마지막 모델 |
| `created_at` | TIMESTAMPTZ | NOT NULL | |
| `updated_at` | TIMESTAMPTZ | NOT NULL | 마지막 메시지 시각으로 갱신 |

**복합 인덱스:** `ix_chats_user_list (user_id, is_archived, is_temporary, updated_at)`
→ `list_chats` 쿼리(`WHERE user_id=X AND is_archived=false AND is_temporary=false ORDER BY updated_at DESC`) 최적화

#### `messages`

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | UUID | PK | |
| `chat_id` | UUID | FK → chats(CASCADE), INDEX | |
| `role` | VARCHAR(20) | NOT NULL | `'user'` \| `'assistant'` \| `'system'` |
| `content` | TEXT | NOT NULL, default=`''` | 메시지 본문 |
| `images` | JSONB | NULL | `[url, ...]` 형식의 첨부 이미지 목록 |
| `meta` | JSONB | NULL | `{model, tokens, finish_reason, ...}` |
| `rating` | VARCHAR(20) | NULL | `'positive'` \| `'negative'` \| NULL |
| `created_at` | TIMESTAMPTZ | NOT NULL | |

**복합 인덱스:** `ix_messages_chat_created (chat_id, created_at)`
→ `WHERE chat_id=X ORDER BY created_at [DESC] LIMIT N` 페이지네이션 쿼리 최적화
→ B-tree 인덱스로 정렬 단계 제거 (content 컬럼이 포함되지 않아 index-only scan은 불가하지만 sequential scan과 별도 filesort는 방지)

#### `chat_members`

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | UUID | PK | |
| `chat_id` | UUID | FK → chats(CASCADE) | |
| `user_id` | UUID | FK → users(CASCADE) | |
| `role` | ENUM | NOT NULL, default=`'editor'` | `'owner'` \| `'editor'` \| `'viewer'` |
| `created_at` | TIMESTAMPTZ | NOT NULL | |

**제약:** `UNIQUE(chat_id, user_id)` — 동일 사용자의 중복 멤버십 방지
**인덱스:** `ix_chat_members_user (user_id)` — 내가 속한 채팅 목록 조회용

#### `folders`

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | UUID | PK | |
| `user_id` | UUID | FK → users(CASCADE), INDEX | |
| `name` | VARCHAR(255) | NOT NULL | |
| `description` | TEXT | NULL | |
| `system_prompt` | TEXT | NULL | 폴더 내 모든 채팅에 적용되는 시스템 프롬프트 |
| `is_open` | BOOLEAN | NOT NULL, default=`true` | 사이드바 접힘 상태 |
| `created_at` | TIMESTAMPTZ | NOT NULL | |

---

### 워크스페이스

#### `workspace_items`

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | UUID | PK | |
| `user_id` | UUID | NOT NULL, INDEX | |
| `item_type` | VARCHAR(20) | NOT NULL, INDEX | `'model'` \| `'prompt'` \| `'tool'` \| `'skill'` |
| `name` | VARCHAR(255) | NOT NULL | |
| `data` | JSONB | NOT NULL | 타입별 설정 페이로드 |
| `is_enabled` | BOOLEAN | NOT NULL, default=`true` | |
| `created_at` | TIMESTAMPTZ | NOT NULL | |
| `updated_at` | TIMESTAMPTZ | NOT NULL | |

**설계 이유:** `item_type` 컬럼으로 4가지 워크스페이스 아이템을 단일 테이블에 관리. `data` JSONB는 타입별로 스키마가 달라 정규화보다 유연성 우선.

---

### 지식 베이스 (RAG)

#### `knowledge_items`

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | UUID | PK | |
| `user_id` | UUID | NOT NULL, INDEX | |
| `name` | VARCHAR(255) | NOT NULL | 원본 파일명 |
| `content_type` | VARCHAR(50) | NOT NULL | MIME 타입 (`application/pdf` 등) |
| `file_size` | INTEGER | NOT NULL | 바이트 단위 |
| `content` | TEXT | NULL | 파싱된 전체 텍스트 |
| `embeddings_json` | JSONB | NULL | **Deprecated** — 0014 마이그레이션 전 임시 저장. KnowledgeChunk로 대체됨 |
| `created_at` | TIMESTAMPTZ | NOT NULL | |

#### `knowledge_chunks`

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | UUID | PK | |
| `knowledge_item_id` | UUID | FK → knowledge_items(CASCADE), INDEX | |
| `chunk_index` | INTEGER | NOT NULL | 원본 문서 내 청크 순서 |
| `content` | TEXT | NOT NULL | 청크 텍스트 (500자, 100자 오버랩) |
| `token_count` | INTEGER | NULL | 토큰 수 추정값 |
| `section_path` | VARCHAR(1000) | NULL | PDF 섹션 경로 (예: `Introduction/Background`) |
| `page_no` | INTEGER | NULL | PDF 페이지 번호 |
| `meta` | JSONB | NULL | 추가 메타데이터 |
| `tsv` | TSVECTOR | NULL | 전체 텍스트 검색 인덱스; 트리거로 자동 갱신 |
| `embedding` | TEXT* | NULL | pgvector `vector(dim)` — ORM은 Text 플레이스홀더로 매핑 |
| `embedding_model` | VARCHAR(100) | NULL | 임베딩 생성 모델 (예: `qwen3-embedding:8b`) |
| `embedding_dim` | INTEGER | NULL | 벡터 차원 (768, 1024, 1536 등) |
| `created_at` | TIMESTAMPTZ | NOT NULL | |

> *ORM은 `Text`로 선언하지만 DB 컬럼 타입은 `vector(dim)`. pgvector SQLAlchemy 통합 라이브러리 없이 최소 의존성을 유지하기 위해 raw SQL(`text()`)로 벡터 검색 수행.

**인덱스:**
```sql
-- 0014_pgvector_chunks 마이그레이션에서 생성
CREATE INDEX ix_knowledge_embedding_hnsw
  ON knowledge_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m=16, ef_construction=64);

-- 전체 텍스트 검색 인덱스 (GIN)
CREATE INDEX ix_knowledge_chunks_tsv ON knowledge_chunks USING gin(tsv);
```

---

### 워크플로우 엔진

#### `workflows`

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | UUID | PK | |
| `owner_id` | UUID | FK → users(CASCADE), INDEX | |
| `name` | VARCHAR(200) | NOT NULL | |
| `description` | TEXT | NOT NULL, default=`''` | |
| `graph` | JSONB | NOT NULL | ReactFlow 직렬화: `{nodes: [...], edges: [...]}` |
| `created_at` | TIMESTAMPTZ | NOT NULL | |
| `updated_at` | TIMESTAMPTZ | NOT NULL | |

**`graph` JSONB 구조:**
```json
{
  "nodes": [
    {"id": "node1", "type": "LLMNode", "position": {"x": 100, "y": 200},
     "data": {"model": "gpt-4o", "prompt": "...", "provider": "openai"}}
  ],
  "edges": [
    {"id": "e1", "source": "node1", "target": "node2",
     "sourceHandle": "true"}
  ]
}
```

#### `workflow_runs`

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | UUID | PK | |
| `workflow_id` | UUID | FK → workflows(CASCADE), INDEX | |
| `owner_id` | UUID | FK → users(CASCADE), INDEX | |
| `status` | VARCHAR(20) | NOT NULL, default=`'running'` | `running` \| `suspended` \| `done` \| `failed` |
| `inputs` | JSONB | NOT NULL | 실행 시 사용자가 제공한 InputNode 값 |
| `outputs` | JSONB | NOT NULL | 최종 OutputNode 결과 |
| `context` | JSONB | NOT NULL | 노드 간 데이터 버스 (`{node_id: result}`) |
| `started_at` | TIMESTAMPTZ | NOT NULL | |
| `finished_at` | TIMESTAMPTZ | NULL | |

**복합 인덱스:** `ix_workflow_runs_owner_status (owner_id, status)`
→ `WHERE owner_id=X AND status='running'` 실행 중 목록 조회 최적화

#### `workflow_run_steps`

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | UUID | PK | |
| `run_id` | UUID | FK → workflow_runs(CASCADE), INDEX | |
| `node_id` | VARCHAR(100) | NOT NULL | ReactFlow 노드 ID |
| `node_type` | VARCHAR(50) | NOT NULL | `LLMNode` \| `ToolNode` \| `BranchNode` \| `HumanNode` \| `OutputNode` |
| `status` | VARCHAR(20) | NOT NULL, default=`'pending'` | `pending` \| `running` \| `done` \| `failed` \| `suspended` |
| `input_data` | JSONB | NOT NULL | 이 노드에 주입된 컨텍스트 스냅샷 |
| `output_data` | JSONB | NOT NULL | 이 노드의 실행 결과 |
| `started_at` | TIMESTAMPTZ | NULL | |
| `finished_at` | TIMESTAMPTZ | NULL | |

---

### 파인튜닝

#### `training_datasets`

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | UUID | PK | |
| `owner_id` | UUID | FK → users(CASCADE), INDEX | |
| `name` | VARCHAR(255) | NOT NULL | |
| `description` | TEXT | NOT NULL, default=`''` | |
| `format` | VARCHAR(20) | NOT NULL, default=`'chat'` | `'chat'` \| `'instruction'` \| `'completion'` |
| `examples` | JSONB | NOT NULL | 파싱된 JSONL 예제 목록 |
| `example_count` | INTEGER | NOT NULL | `len(examples)` 캐시 |
| `created_at` | TIMESTAMPTZ | NOT NULL | |

#### `fine_tune_jobs`

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | UUID | PK | |
| `owner_id` | UUID | FK → users(CASCADE), INDEX | |
| `name` | VARCHAR(255) | NOT NULL | |
| `dataset_id` | UUID | FK → training_datasets(SET NULL), NULL | 데이터셋 삭제 시 작업은 보존 |
| `base_model` | VARCHAR(200) | NOT NULL | HuggingFace 모델 ID |
| `method` | VARCHAR(20) | NOT NULL, default=`'lora'` | `'lora'` \| `'qlora'` \| `'full'` |
| `config` | JSONB | NOT NULL | 하이퍼파라미터 (`learning_rate`, `lora_r`, `epochs` 등) |
| `status` | VARCHAR(20) | NOT NULL, default=`'pending'` | `pending` \| `running` \| `done` \| `failed` \| `cancelled` |
| `progress` | FLOAT | NOT NULL, default=`0.0` | 0.0 ~ 1.0 |
| `current_step` | INTEGER | NOT NULL | |
| `total_steps` | INTEGER | NOT NULL | |
| `metrics` | JSONB | NOT NULL | `{steps, train_loss, val_loss, learning_rate}` 시계열 |
| `output_model_name` | VARCHAR(255) | NULL | Together AI 출력 모델명 |
| `error_message` | TEXT | NULL | 실패 시 오류 내용 |
| `logs` | JSONB | NOT NULL | 학습 로그 목록 |
| `started_at` | TIMESTAMPTZ | NULL | |
| `finished_at` | TIMESTAMPTZ | NULL | |
| `created_at` | TIMESTAMPTZ | NOT NULL | |

**복합 인덱스:** `ix_fine_tune_jobs_owner_status (owner_id, status)`

---

### 시스템 설정

#### `system_settings` (싱글톤)

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | INTEGER | PK, default=`1` | 항상 1개 행만 존재 |
| `data` | JSONB | NOT NULL | 전체 설정 트리 (최상위 섹션별 중첩 구조) |
| `updated_at` | TIMESTAMPTZ | NOT NULL | |

**`data` JSONB 최상위 섹션:**
```
general      — 인스턴스 이름, 가입 허용, 최대 사용자 수
connections  — AI 프로바이더 API 키, 커스텀 엔드포인트
models       — 활성화된 모델 목록 (OpenAI/Anthropic/Google/xAI/Ollama)
oauth        — Google/GitHub OAuth 클라이언트 ID/Secret
features     — 기능 플래그 (웹 검색, 파일 업로드, 임시 채팅 등)
documents    — 임베딩 엔진, 청크 크기, top-k
audio        — STT/TTS 프로바이더 설정
images       — 이미지 생성 엔진 (DALL·E/ComfyUI/A1111)
evaluations  — 아레나 모드, 메시지 평가 플래그
```

**설계 이유:** 설정 항목이 자주 추가/삭제되므로 컬럼 기반 테이블 대신 JSONB 싱글톤 사용.
라우터에서 Pydantic `extra="forbid"` 스키마로 검증하므로 DB 레벨 스키마 강제 없이도 임의 키 주입이 차단됨.

---

## 전체 인덱스 요약

| 테이블 | 인덱스명 | 컬럼 | 타입 | 용도 |
|---|---|---|---|---|
| users | _(email UQ)_ | email | B-tree | 로그인 조회 |
| users | _(oauth_sub)_ | oauth_sub | B-tree | OAuth 콜백 |
| chats | `ix_chats_user_list` | (user_id, is_archived, is_temporary, updated_at) | B-tree | 채팅 목록 API |
| messages | `ix_messages_chat_created` | (chat_id, created_at) | B-tree | 메시지 페이지네이션 |
| chat_members | _(uq constraint)_ | (chat_id, user_id) | B-tree | 중복 멤버십 방지 |
| chat_members | `ix_chat_members_user` | user_id | B-tree | 내가 속한 채팅 |
| knowledge_chunks | `ix_knowledge_embedding_hnsw` | embedding | HNSW | 벡터 유사도 검색 O(log n) |
| knowledge_chunks | `ix_knowledge_chunks_tsv` | tsv | GIN | 전체 텍스트 검색 |
| workflow_runs | `ix_workflow_runs_owner_status` | (owner_id, status) | B-tree | 실행 중 목록 |
| fine_tune_jobs | `ix_fine_tune_jobs_owner_status` | (owner_id, status) | B-tree | 작업 목록 |

---

## CASCADE 삭제 정책

```
users 삭제
  → chats 삭제 (CASCADE)
    → messages 삭제 (CASCADE)
    → chat_members 삭제 (CASCADE)
  → folders 삭제 (CASCADE)
    → chats의 folder_id = NULL (SET NULL)  ← 채팅은 보존
  → workspace_items 삭제 (CASCADE)
  → knowledge_items 삭제 (CASCADE)
    → knowledge_chunks 삭제 (CASCADE)
  → workflows 삭제 (CASCADE)
    → workflow_runs 삭제 (CASCADE)
      → workflow_run_steps 삭제 (CASCADE)
  → training_datasets 삭제 (CASCADE)
  → fine_tune_jobs 삭제 (CASCADE)
    → dataset_id = NULL (SET NULL)  ← 작업은 보존

training_datasets 삭제
  → fine_tune_jobs.dataset_id = NULL (SET NULL)  ← 작업 기록 보존
```

---

## Alembic 마이그레이션 히스토리

| 버전 | 파일 | 주요 변경 |
|---|---|---|
| 0001 | `0001_initial.py` | users, chats, messages, folders 생성 |
| ... | ... | 점진적 스키마 확장 |
| 0013 | `0013_*.py` | workflow_run_steps 추가 |
| 0014 | `0014_pgvector_chunks.py` | knowledge_chunks + HNSW 인덱스 + tsv 트리거. 파괴적 downgrade → `RuntimeError` |
| 0015 | `0015_*.py` | 기능 플래그 확장 |
| 0016 | `0016_*.py` | fine_tune_jobs 확장 (together_job_id 등) |
| 0017 | `0017_message_composite_index.py` | `ix_messages_chat_created` 복합 인덱스 추가 |

```bash
# 현재 버전 확인
alembic current

# 최신으로 업그레이드
alembic upgrade head

# 특정 버전으로
alembic upgrade 0014

# 하나 롤백 (0014 이전으로는 RuntimeError 발생 — 의도적 보호)
alembic downgrade -1
```

---

## 관련 파일

| 파일 | 역할 |
|---|---|
| `backend/app/models/user.py` | User |
| `backend/app/models/chat.py` | Chat, Message, ChatMember, Folder |
| `backend/app/models/workspace.py` | WorkspaceItem, KnowledgeItem, KnowledgeChunk |
| `backend/app/models/workflow.py` | Workflow, WorkflowRun, WorkflowRunStep |
| `backend/app/models/fine_tune.py` | TrainingDataset, FineTuneJob |
| `backend/app/models/settings.py` | SystemSettings |
| `backend/alembic/versions/` | 마이그레이션 파일 전체 |
