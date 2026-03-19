#!/bin/bash
# ──────────────────────────────────────────────────────────────────────────────
# Oracle Cloud ARM VM 초기 설정 스크립트
# OS: Ubuntu 22.04 (Oracle에서 기본 제공)
# 실행: ssh ubuntu@<VM_IP> 후 bash oracle-setup.sh
# ──────────────────────────────────────────────────────────────────────────────
set -e

echo "▶ 시스템 업데이트..."
sudo apt-get update -y && sudo apt-get upgrade -y

echo "▶ Docker 설치..."
sudo apt-get install -y ca-certificates curl gnupg lsb-release
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update -y
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

sudo usermod -aG docker ubuntu
echo "▶ Docker 설치 완료"

echo "▶ 방화벽 설정 (80/443만 열기)..."
sudo apt-get install -y ufw
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
echo "▶ 방화벽 설정 완료"

echo "▶ Oracle Cloud 보안 규칙 주의:"
echo "  콘솔 → Networking → VCN → Security Lists에서도 80/443 허용 필요"

echo "▶ Swap 설정 (ARM 메모리 보호)..."
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
echo "▶ Swap 4GB 추가 완료"

echo "▶ Git 설치..."
sudo apt-get install -y git

echo ""
echo "✅ 초기 설정 완료!"
echo ""
echo "다음 단계:"
echo "  1. 새 터미널로 재접속 (docker 그룹 적용)"
echo "  2. git clone <your-repo-url> umai"
echo "  3. cd umai && cp backend/.env.example backend/.env"
echo "  4. backend/.env 에 실제 값 입력"
echo "  5. docker compose up --build -d"
