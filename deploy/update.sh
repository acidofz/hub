#!/usr/bin/env bash
# Обновление после git pull:  bash deploy/update.sh
set -euo pipefail
sudo rsync -a --delete --exclude node_modules --exclude data --exclude .git ./ /opt/waree-hub/
cd /opt/waree-hub && npm ci --omit=dev --no-audit --no-fund
sudo systemctl restart waree-hub
echo "Обновлено."
