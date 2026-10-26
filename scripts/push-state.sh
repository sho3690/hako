#!/usr/bin/env bash
# data/state.json に変更があればコミットして push する（書き込み用のトークンはこの手順だけで使う）
set -euo pipefail
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add data/state.json
if git diff --staged --quiet; then echo "変更はありません"; exit 0; fi
git commit -q -m "$1 $(TZ=Asia/Tokyo date '+%m/%d %H:%M')"
git pull -q --rebase origin main
git push -q "https://x-access-token:${PUSH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" HEAD:main
echo "保存しました"
