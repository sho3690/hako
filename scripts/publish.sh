#!/usr/bin/env bash
# 箱 HAKO を GitHub に公開する（最初の1回だけ。もう一度動かしても壊れない）。
# リポジトリは「公開」で作る（無料プランで GitHub Pages を出すため。データと中継のメッセージは合言葉で暗号化済み）。
#
# することは次の5つだけ:
#   1) 公開リポジトリ sho3690/hako を作り、手元のコミットを push する（.secrets/ は .gitignore で除外済み）
#   2) GitHub の Secrets に HAKO_KEY（.secrets/master.b64 の中身＝データの鍵）を登録する
#   3) 15分の待ち時間を持つ環境 interval を作る（同期が自分で次の回を予約するのに使う）
#   4) GitHub Pages を main の直下から公開する → https://sho3690.github.io/hako/
#   5) 同期を1回動かす（以後15分ごとに自動）
set -euo pipefail
cd "$(dirname "$0")/.."
REPO=sho3690/hako

[ -f .secrets/master.b64 ] || { echo "鍵（.secrets/master.b64）がありません。先に node scripts/setup.mjs を実行してください"; exit 1; }
if ! git diff --quiet || ! git diff --staged --quiet; then echo "コミットしていない変更があります。先にコミットしてください"; exit 1; fi
if git ls-files | grep -q '^\.secrets/'; then echo ".secrets/ がコミットに入っています。中止します"; exit 1; fi

echo "1) リポジトリを作って push します"
if gh repo view "$REPO" >/dev/null 2>&1; then
  git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$REPO.git"
  git push -u origin main
else
  gh repo create "$REPO" --public --source . --remote origin --push \
    --description "箱 HAKO — やること・頼まれごとを全部ひとつに集める箱（データは合言葉で暗号化）"
fi

echo "2) Secrets に HAKO_KEY を登録します"
gh secret set HAKO_KEY -R "$REPO" < .secrets/master.b64

echo "3) 待ち時間15分の環境 interval を作ります"
echo '{"wait_timer":15,"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}' \
  | gh api -X PUT "repos/$REPO/environments/interval" --input - >/dev/null
gh api -X POST "repos/$REPO/environments/interval/deployment-branch-policies" -f name=main -f type=branch >/dev/null 2>&1 || true

echo "4) GitHub Pages を公開します"
gh api -X POST "repos/$REPO/pages" -f "source[branch]=main" -f "source[path]=/" >/dev/null 2>&1 || echo "   （Pages はすでに有効でした）"

echo "5) 同期を1回動かします"
for i in 1 2 3 4 5 6; do
  gh workflow run auto-sync.yml -R "$REPO" --ref main >/dev/null 2>&1 && { echo "   動かしました"; break; }
  sleep 5
done

echo "できました: https://sho3690.github.io/hako/ （最初の表示まで1〜2分かかります）"
