#!/bin/bash
# 使い方: ./push-to-github.sh あなたのGitHubユーザー名 [リポジトリ名]
# 事前に GitHub で空のリポジトリ（README無し）を作っておいてください
set -e
USER_NAME="${1:?GitHubユーザー名を指定してください}"
REPO="${2:-word-battle}"
cd "$(dirname "$0")"
git init -b main >/dev/null 2>&1 || true
git config user.name  "$USER_NAME"
git config user.email "$USER_NAME@users.noreply.github.com"
git add -A
git diff --cached --quiet || git commit -m "英単語バトル（鉄壁 改訂版 2,175語・PeerJS P2Pルーム対戦）"
git remote remove origin 2>/dev/null || true
git remote add origin "https://github.com/$USER_NAME/$REPO.git"
echo "プッシュ中 → https://github.com/$USER_NAME/$REPO"
git push -u origin main
cat <<MSG

完了！次にブラウザで:
  1. https://github.com/$USER_NAME/$REPO/settings/pages
  2. Source: 「Deploy from a branch」/ Branch: main / (root) → Save
  3. 1〜2分後に公開 →  https://$USER_NAME.github.io/$REPO/
MSG
