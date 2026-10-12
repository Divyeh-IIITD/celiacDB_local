#!/bin/bash
# ==========================================================
# 🔁 CeliacDB Website Auto-Restart Script
# Author: Divyansh
# ==========================================================

cd /storage4tb-1/celiacDB || exit 1

echo "==============================="
echo "📺 screen -ls"
echo "==============================="
screen -ls || true

echo "==============================="
echo "🛑 Killing existing celiacDB screen"
echo "==============================="
screen -S celiacDB -X quit || true

echo "==============================="
echo "🖥️ Starting screen + detaching"
echo "==============================="

screen -dmS celiacDB bash -c '
    source ~/anaconda3/etc/profile.d/conda.sh
    conda activate celiacDB
    npx node app.js
'

echo "==============================="
echo "🌐 Restarting nginx"
echo "==============================="
sudo systemctl restart nginx

echo "==============================="
echo "🔎 nginx status"
echo "==============================="
sudo systemctl status nginx --no-pager

echo "==============================="
echo "✅ Screen detached and app running"
echo "Attach using: screen -r celiacDB"
echo "==============================="
