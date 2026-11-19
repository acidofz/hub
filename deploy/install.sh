#!/usr/bin/env bash
# Установка центра на VPS (Ubuntu). Запуск из папки репозитория:  bash deploy/install.sh
set -euo pipefail
APP=/opt/waree-hub
DATA=/var/lib/waree-hub

command -v node >/dev/null || { echo "Нужен Node.js 18+ (он уже стоит для WAREE)"; exit 1; }
sudo mkdir -p "$APP" "$DATA"
sudo rsync -a --delete --exclude node_modules --exclude data --exclude .git ./ "$APP"/
sudo chown -R ubuntu:ubuntu "$APP" "$DATA"
sudo chmod 700 "$DATA"
cd "$APP" && npm ci --omit=dev --no-audit --no-fund

sudo cp deploy/waree-hub.service /etc/systemd/system/waree-hub.service
sudo systemctl daemon-reload
sudo systemctl enable waree-hub

if ! grep -q "hub.waree.uz" /etc/caddy/Caddyfile; then
  echo "" | sudo tee -a /etc/caddy/Caddyfile >/dev/null
  sudo tee -a /etc/caddy/Caddyfile < deploy/Caddyfile.snippet >/dev/null
  sudo systemctl reload caddy
fi

echo
echo "Теперь задай пароль и 2FA:"
echo "  cd $APP && HUB_DATA=$DATA npm run setup"
echo "  sudo systemctl restart waree-hub"
echo "Потом открой https://hub.waree.uz"
