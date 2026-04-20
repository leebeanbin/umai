# Umai — Production Deployment Guide

> Single-host Docker Compose deployment for a full-stack AI platform: Next.js frontend, FastAPI backend, PostgreSQL + pgvector, Redis, and Celery workers — all behind a hardened Nginx reverse proxy.

**English** | [한국어](DEPLOY.ko.md)

---

## Architecture Overview

```
Internet
  │  (80/443 only — all other ports blocked)
  ▼
Nginx  ──────────── SSL termination, rate limiting, static caching
  ├──→ umai-frontend   (Next.js 15, port 3000 internal)
  └──→ umai-backend    (FastAPI,   port 8000 internal)
                             │
                    ┌────────┴────────┐
              PostgreSQL 16        Redis 7
              (+ pgvector)    (sessions / cache / Celery)
                                       │
                               Celery Workers
                       (ai / image / knowledge / default queues)
```

All inter-service traffic stays on the internal Docker network. **No database or API ports are exposed to the internet.**

---

## Infrastructure Options

| Target | Spec | Cost | Notes |
|---|---|---|---|
| **Oracle Cloud Free Tier** | VM.Standard.A1.Flex — 4 OCPU / 24 GB RAM (ARM) | $0/month | Recommended starting point |
| **AWS EC2** | t3.xlarge — 4 vCPU / 16 GB RAM | ~$120/month | Good for US-region latency |
| **Hetzner Cloud** | CX31 — 2 vCPU / 8 GB RAM | ~€8/month | Best price/perf in Europe |
| **Local / Bare Metal** | Any x86-64 or ARM64 with 8 GB+ RAM | hardware cost | Dev or on-prem |

Minimum viable: **4 GB RAM** (reduces Celery worker concurrency to 1).  
Recommended: **8 GB+ RAM** for production AI workloads.

---

## Prerequisites

- Docker 24+ and Docker Compose v2
- A domain name (required for HTTPS / OAuth in production)
- DNS A record pointing to your server's public IP

---

## Security Checklist

Run through this list before exposing the service to the internet.

- [ ] `SECRET_KEY` is a random 32-byte hex string (`openssl rand -hex 32`)
- [ ] `SESSION_SECRET_KEY` is a **different** random string from `SECRET_KEY`
- [ ] `POSTGRES_PASSWORD` and `REDIS_PASSWORD` are set to strong values
- [ ] `BACKEND_URL` and `FRONTEND_URL` both use `https://` (app will refuse to start otherwise)
- [ ] Firewall allows **only ports 22, 80, and 443** (all backend/DB ports blocked)
- [ ] OAuth redirect URIs in Google/GitHub console match your HTTPS domain
- [ ] `/docs` (Swagger UI) is disabled — `DEBUG=False` disables it automatically
- [ ] Nginx `server_tokens off;` is set (hides server version)
- [ ] SSL certificate auto-renewal is configured (Certbot timer or cron)
- [ ] `docker compose logs` shows no startup errors before routing traffic

---

## Step 1 — Provision the Server

### Oracle Cloud Free Tier (recommended)

1. Sign up at https://oracle.com/cloud/free (credit card required for identity; Always Free tier is not charged)
2. Create a Compute Instance:
   ```
   Compute → Instances → Create Instance
   ├── Image:  Ubuntu 22.04
   ├── Shape:  VM.Standard.A1.Flex (ARM)
   │   ├── OCPU:   4
   │   └── Memory: 24 GB
   └── SSH Keys: upload your public key
   ```
3. Open firewall rules in the VCN Security List:
   ```
   Networking → Virtual Cloud Networks → [your VCN]
   → Security Lists → Default → Add Ingress Rules

   Source CIDR   Protocol   Dest Port
   0.0.0.0/0     TCP        22     (SSH)
   0.0.0.0/0     TCP        80     (HTTP)
   0.0.0.0/0     TCP        443    (HTTPS)
   ```
   > Do NOT open 5432, 6379, 8000, 3000, or any other internal port.

4. Also open these ports in the OS firewall:
   ```bash
   sudo ufw allow 22 && sudo ufw allow 80 && sudo ufw allow 443
   sudo ufw enable
   ```

---

## Step 2 — Server Setup

```bash
# SSH into the server
ssh ubuntu@<SERVER_IP>

# Install Docker and Docker Compose
curl -fsSL https://get.docker.com | bash
sudo usermod -aG docker $USER
newgrp docker        # apply group without re-login

# (Optional but recommended) Add 4 GB swap for stability
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Clone the repository
git clone https://github.com/<your-org>/umai.git ~/umai
cd ~/umai
```

---

## Step 3 — Environment Variables

```bash
cp backend/.env.example backend/.env
nano backend/.env
```

**Required values (app will fail to start without these in production):**

```env
# ── Security ─────────────────────────────────────────────────────────────────
# Generate with: openssl rand -hex 32
SECRET_KEY=<random-32-byte-hex>
SESSION_SECRET_KEY=<different-random-32-byte-hex>

# ── URLs (must be HTTPS in production) ───────────────────────────────────────
BACKEND_URL=https://yourdomain.com
FRONTEND_URL=https://yourdomain.com

# ── Database ─────────────────────────────────────────────────────────────────
DATABASE_URL=postgresql+asyncpg://umai:<POSTGRES_PASSWORD>@postgres:5432/umai
POSTGRES_PASSWORD=<strong-password>

# ── Redis ────────────────────────────────────────────────────────────────────
REDIS_URL=redis://:<REDIS_PASSWORD>@redis:6379/0
REDIS_PASSWORD=<strong-password>

# ── Celery (uses Redis as broker) ─────────────────────────────────────────────
CELERY_BROKER_URL=redis://:<REDIS_PASSWORD>@redis:6379/1
CELERY_RESULT_BACKEND=redis://:<REDIS_PASSWORD>@redis:6379/2

# ── AI Providers (at least one required for chat to work) ────────────────────
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=AIza...

# ── OAuth (optional — email/password auth works without these) ───────────────
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
```

---

## Step 4 — SSL Certificate

```bash
# Install Certbot
sudo apt install certbot -y

# Obtain certificate (stop any service using port 80 first)
sudo certbot certonly --standalone -d yourdomain.com

# Certificates will be at:
#   /etc/letsencrypt/live/yourdomain.com/fullchain.pem
#   /etc/letsencrypt/live/yourdomain.com/privkey.pem

# Copy certs to the Nginx volume path
sudo cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem nginx/certs/
sudo cp /etc/letsencrypt/live/yourdomain.com/privkey.pem   nginx/certs/

# Enable HTTPS block in nginx/nginx.conf (uncomment the ssl server block)
nano nginx/nginx.conf

# Auto-renewal (runs twice daily via systemd timer — already set up by Certbot)
sudo systemctl status certbot.timer
```

---

## Step 5 — OAuth Callback URLs

Register these URIs in each provider's developer console **before** first login.

**Google** — [Google Cloud Console](https://console.cloud.google.com/apis/credentials):
```
https://yourdomain.com/api/v1/auth/oauth/google/callback
```

**GitHub** — [GitHub Developer Settings](https://github.com/settings/applications/new):
```
https://yourdomain.com/api/v1/auth/oauth/github/callback
```

---

## Step 6 — Deploy

```bash
cd ~/umai

# Build images and start all services
docker compose up --build -d

# Watch startup logs (Ctrl-C to detach, services keep running)
docker compose logs -f backend celery-worker

# Verify all containers are healthy
docker compose ps

# Run database migrations
docker compose exec umai-backend alembic upgrade head
```

The app is live at `https://yourdomain.com`.

---

## Step 7 — Create the First Admin User

```bash
# Connect to the database
docker compose exec umai-postgres psql -U umai -d umai

-- Promote an existing registered user to admin
UPDATE users SET role = 'admin' WHERE email = 'you@example.com';
\q
```

---

## Monitoring & Operations

### Live Logs

```bash
docker compose logs -f backend          # FastAPI request logs + errors
docker compose logs -f celery-worker    # background task logs
docker compose logs -f nginx            # access / error logs
docker compose logs -f postgres         # DB logs
```

### Health Check

```bash
# Returns {"status":"ok"} if DB + Redis are reachable
curl https://yourdomain.com/health
```

### Resource Usage

```bash
docker stats                            # live CPU/memory per container
docker compose exec umai-postgres psql -U umai -c "SELECT count(*) FROM users;"
docker compose exec umai-redis redis-cli -a $REDIS_PASSWORD info memory
```

### Redeployment (code update)

```bash
cd ~/umai
git pull
docker compose up --build -d           # zero-downtime rolling update per service
docker compose exec umai-backend alembic upgrade head   # run only if migrations exist
```

### Restart a Single Service

```bash
docker compose restart backend
docker compose restart celery-worker
```

### Emergency Stop / Full Reset

```bash
docker compose down              # stop all services, keep volumes
docker compose down -v           # WARNING: deletes all DB data and Redis state
```

---

## Resource Budget (Oracle Free Tier — 24 GB RAM)

| Service | Memory Limit | Notes |
|---|---|---|
| umai-frontend | 512 MB | Next.js SSR |
| umai-backend | 1 GB | FastAPI + connection pool |
| celery-worker | 1.5 GB | 4 queues × concurrency 2 |
| umai-postgres | 2 GB | pgvector extension included |
| umai-redis | 512 MB | sessions + Celery broker + pub/sub |
| nginx | 128 MB | |
| **Total** | **~5.7 GB** | **~24% of 24 GB** |

The remaining ~18 GB can be used to scale `celery-worker` concurrency or add a dedicated embedding worker for the knowledge-base pipeline.

---

## Rate Limiting Reference

Two layers of rate limiting protect every endpoint:

| Layer | Scope | Limit |
|---|---|---|
| Nginx | All `/api/*` traffic | 60 req/min/IP |
| Nginx | Auth endpoints | 5 req/min/IP |
| Nginx | Frontend assets | 120 req/min/IP |
| Nginx | Concurrent connections | 20/IP |
| FastAPI (SlowAPI) | Global default | 200 req/min/IP |
| FastAPI | `POST /auth/register` | 5 req/min/IP |
| FastAPI | `POST /auth/login` | 10 req/min/IP |
| FastAPI | `POST /auth/refresh` | 30 req/min/IP |
| FastAPI | `GET /rag/search` | 20 req/min/IP |

Limits are centralized in `backend/app/core/constants.py` — edit there to adjust.

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| `RuntimeError: SECRET_KEY must be set` | `.env` has default key | Set `SECRET_KEY` to 32+ char random hex |
| `RuntimeError: BACKEND_URL must use HTTPS` | URL starts with `http://` | Change to `https://` in `.env` |
| OAuth redirect fails | Callback URI not registered | Add exact URI to Google/GitHub console |
| Celery tasks stuck | Redis unreachable | Check `REDIS_URL`/`CELERY_BROKER_URL` |
| `pgvector` extension missing | DB init order | `docker compose exec umai-postgres psql -U umai -d umai -c "CREATE EXTENSION IF NOT EXISTS vector;"` |
| Container OOM-killed | Memory limit too low | Increase limit in `docker-compose.yml` or add swap |
| 502 Bad Gateway | Backend not started | `docker compose logs backend` — check for startup error |
