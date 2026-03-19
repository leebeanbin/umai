#!/bin/bash
# ──────────────────────────────────────────────────────────────────────────────
# Let's Encrypt SSL 인증서 발급 (Certbot)
# 사용법: bash setup-ssl.sh yourdomain.com
# ──────────────────────────────────────────────────────────────────────────────
set -e

DOMAIN=${1:?사용법: bash setup-ssl.sh yourdomain.com}

echo "▶ Certbot 설치..."
sudo apt-get install -y certbot

echo "▶ 인증서 발급 (standalone 모드 — nginx 먼저 중지)..."
docker compose stop nginx 2>/dev/null || true
sudo certbot certonly --standalone -d "$DOMAIN" --non-interactive --agree-tos -m "admin@${DOMAIN}"

echo "▶ 인증서를 nginx/certs/ 에 복사..."
mkdir -p nginx/certs
sudo cp /etc/letsencrypt/live/"$DOMAIN"/fullchain.pem nginx/certs/
sudo cp /etc/letsencrypt/live/"$DOMAIN"/privkey.pem   nginx/certs/
sudo chown ubuntu:ubuntu nginx/certs/*.pem

echo "▶ nginx.conf의 SSL 블록 활성화 방법:"
echo "  nginx/nginx.conf 에서 HTTPS server 블록 주석 해제 후"
echo "  ssl_certificate     /etc/nginx/certs/fullchain.pem;"
echo "  ssl_certificate_key /etc/nginx/certs/privkey.pem;"
echo "  추가하고 docker compose restart nginx"

echo "▶ 자동 갱신 크론 등록..."
(crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet && cp /etc/letsencrypt/live/${DOMAIN}/fullchain.pem $(pwd)/nginx/certs/ && cp /etc/letsencrypt/live/${DOMAIN}/privkey.pem $(pwd)/nginx/certs/ && docker compose restart nginx") | crontab -

echo "✅ SSL 설정 완료: https://$DOMAIN"
