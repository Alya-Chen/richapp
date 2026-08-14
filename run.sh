#!/bin/bash
# run.sh — 停止執行中的 app.js（若有）並重新啟動
# 注意：需在 richapp 專案目錄內執行（路徑含空格與中括號，請勿用絕對路徑 cd）
PID_FILE="app.pid"
OLD_PID=""

if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE" 2>/dev/null)
    if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
        echo "偵測到執行中的 app.js (PID=$OLD_PID)，停止中..."
        kill "$OLD_PID"
        for i in $(seq 1 10); do
            kill -0 "$OLD_PID" 2>/dev/null || break
            sleep 1
        done
        if kill -0 "$OLD_PID" 2>/dev/null; then
            echo "逾時未結束，強制終止 (PID=$OLD_PID)"
            kill -9 "$OLD_PID"
        fi
        echo "已停止。"
    else
        echo "app.pid 存在但 process 未在執行（殘留 PID 檔），跳過停止。"
    fi
else
    echo "無 app.pid，app.js 未在執行，直接啟動。"
fi

echo "啟動 app.js..."
nohup env TZ="Asia/Taipei" node app.js > log.txt 2>&1 &
echo "已啟動，新 PID=$!"
