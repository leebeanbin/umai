# Umai 배포 가이드 (Oracle Cloud Free Tier)

> 전체 스택(DB 포함)을 Oracle ARM VM 하나에 무료로 운영합니다.

---

## 인프라 구성

```
Oracle VM (ARM, 4 OCPU / 24GB RAM — 영구 무료)
└── docker compose up -d
    ├── nginx          ← 80/443 진입점, rate limit
    ├── umai-frontend  ← Next.js (포트 노출 안 함)
    ├── umai-backend   ← FastAPI  (포트 노출 안 함)
    ├── umai-postgres  ← PostgreSQL 16
    ├── umai-redis     ← Redis 7
    └── umai-kafka     ← Apache Kafka 3.9 (KRaft)
```

---

## Step 1 — Oracle Cloud 계정 & VM 생성

1. **가입**: https://oracle.com/cloud/free → "Start for free"
   - 신용카드 필요 (인증용, 과금 안 됨 — Always Free 범위 내)

2. **VM 인스턴스 생성**
   ```
   Compute → Instances → Create Instance
   ├── Name: umai-server
   ├── Image: Ubuntu 22.04
   ├── Shape: VM.Standard.A1.Flex  ← ARM (Always Free)
   │   └── OCPU: 4 / Memory: 24 GB
   ├── Networking: 기본 VCN 사용
   └── SSH Keys: 내 공개키 업로드 또는 새로 생성
   ```

3. **보안 규칙 추가** (꼭 해야 접속됨)
   ```
   Networking → Virtual Cloud Networks → [VCN 선택]
   → Security Lists → Default Security List
   → Add Ingress Rules:
     ┌─────────────┬──────────┬───────────┐
     │ Source CIDR │ Protocol │ Dest Port │
     ├─────────────┼──────────┼───────────┤
     │ 0.0.0.0/0   │ TCP      │ 80        │
     │ 0.0.0.0/0   │ TCP      │ 443       │
     └─────────────┴──────────┴───────────┘
   ```
   > 8001, 5434 등 DB/API 포트는 열지 않습니다 — nginx가 80/443만 사용

---

## Step 2 — VM 초기 설정

```bash
# VM에 SSH 접속
ssh ubuntu@<VM_PUBLIC_IP>

# 설치 스크립트 실행
curl -fsSL https://raw.githubusercontent.com/<your-repo>/main/scripts/oracle-setup.sh | bash
# 또는
git clone <repo-url> umai && bash umai/scripts/oracle-setup.sh

# 재접속 (docker 그룹 적용)
exit && ssh ubuntu@<VM_PUBLIC_IP>
```

스크립트가 자동으로 처리:
- Docker 설치
- UFW 방화벽 (80/443/SSH만 허용)
- Swap 4GB 추가

---

## Step 3 — 환경 변수 설정

```bash
cd ~/umai

# .env 복사 및 편집
cp backend/.env.example backend/.env
nano backend/.env
```

**반드시 입력해야 하는 값:**

```env
# 보안 (랜덤 문자열로 변경 필수)
SECRET_KEY=<openssl rand -hex 32 결과값>

# 서버 주소 (VM 공인 IP 또는 도메인)
BACKEND_URL=http://<VM_IP>         # 도메인 있으면 https://yourdomain.com
FRONTEND_URL=http://<VM_IP>

# DB 비밀번호 (기본값 변경 권장)
POSTGRES_PASSWORD=<강력한_비밀번호>
REDIS_PASSWORD=<강력한_비밀번호>

# OAuth (Google/GitHub 콘솔에서 발급)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...

# OAuth 콜백 URL (Google/GitHub 콘솔에 등록 필요)
# Google:  http://<VM_IP>/api/v1/auth/oauth/google/callback
# GitHub:  http://<VM_IP>/api/v1/auth/oauth/github/callback
```

**SECRET_KEY 생성 방법:**
```bash
openssl rand -hex 32
```

---

## Step 4 — OAuth 앱 설정

### Google
1. https://console.cloud.google.com/apis/credentials
2. "+ CREATE CREDENTIALS" → OAuth 2.0 Client ID
3. Application type: **Web application**
4. Authorized redirect URIs:
   ```
   http://<VM_IP>/api/v1/auth/oauth/google/callback
   # HTTPS 설정 후:
   https://yourdomain.com/api/v1/auth/oauth/google/callback
   ```

### GitHub
1. https://github.com/settings/applications/new
2. Authorization callback URL:
   ```
   http://<VM_IP>/api/v1/auth/oauth/github/callback
   ```

---

## Step 5 — 배포 실행

```bash
cd ~/umai

# 전체 빌드 & 실행
docker compose up --build -d

# 로그 확인
docker compose logs -f backend nginx

# 상태 확인
docker compose ps
```

정상 실행 시 http://\<VM_IP\> 접속됩니다.

---

## Step 6 — HTTPS 설정 (도메인 있는 경우)

```bash
# 도메인 DNS A레코드를 VM IP로 설정한 후
bash scripts/setup-ssl.sh yourdomain.com
```

그 다음 `nginx/nginx.conf` 수정:
```nginx
# HTTP → HTTPS 리다이렉트 블록 주석 해제
server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$host$request_uri;
}

# HTTPS 블록 추가
server {
    listen 443 ssl;
    server_name yourdomain.com;
    ssl_certificate     /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;
    # ... 나머지 동일
}
```

```bash
# backend/.env 도메인으로 업데이트
BACKEND_URL=https://yourdomain.com
FRONTEND_URL=https://yourdomain.com

docker compose up --build -d
```

---

## 운영 명령

```bash
# 재배포 (코드 업데이트 후)
git pull && docker compose up --build -d

# 특정 서비스만 재빌드
docker compose up --build -d backend

# 로그
docker compose logs -f backend      # 백엔드
docker compose logs -f nginx        # 트래픽

# DB 접속
docker compose exec postgres psql -U umai -d umai

# Redis 확인
docker compose exec redis redis-cli -a $REDIS_PASSWORD

# 컨테이너 리소스 사용량
docker stats

# 전체 재시작
docker compose restart
```

---

## 로컬 개발

```bash
# 전체 Docker (프론트 포함)
make dev      # http://localhost:3002 / API http://localhost:8001

# 정지
make down

# DB 초기화 (볼륨 삭제)
make clean
```

---

## 리소스 사용량 (Oracle Free Tier 기준)

| 서비스 | 메모리 한도 |
|---|---|
| nginx | 128 MB |
| postgres | 2 GB |
| redis | 512 MB |
| kafka | 1 GB |
| backend | 1 GB |
| frontend | 512 MB |
| **합계** | **~5.2 GB** (24GB 중) |

> 남은 ~19GB는 트래픽 증가 시 backend 워커 수 증가, 캐시 확장 등에 활용 가능

---

## Rate Limit 현황

| 위치 | 엔드포인트 | 제한 |
|---|---|---|
| Nginx | `/api/v1/auth/login,register,refresh` | 5 req/min/IP |
| Nginx | `/api/*` | 60 req/min/IP |
| Nginx | 프론트엔드 | 120 req/min/IP |
| Nginx | 동시 연결 | 20개/IP |
| FastAPI | `POST /auth/register` | 5 req/min/IP |
| FastAPI | `POST /auth/login` | 10 req/min/IP |
| FastAPI | `POST /auth/refresh` | 30 req/min/IP |
| FastAPI | 기본값 | 200 req/min/IP |
| Docker | 각 컨테이너 | 메모리 개별 제한 |
