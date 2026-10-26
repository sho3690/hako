# 箱 HAKO

やること・頼まれごと・思いついたことを、**全部ひとつに集めておく箱**です。
このMacの Claude Code なら、どの会話からでも **「〇〇を『箱』に入れておいて」** と言えば届きます。

- 公開先: https://sho3690.github.io/hako/
- 開けるのは、合言葉か「開くためのリンク」を持っている人（＝自分）だけです。
- 画面と使い方は 土日 DONICHI と同じ作法（下のタブ・下から出るシート・取り消せるトースト）。

## 入れ方

| どこから | どうする |
|---|---|
| このMacの Claude Code（どのフォルダ・どの会話でも） | 「〇〇を『箱』に入れておいて」。やること・日付・メモ・タグは Claude が会話から決める（スキル `~/.claude/skills/hako`） |
| スマホ・PC の画面 | 「入れる」→ 1行に1つ書く。「明日」「金曜」「10/30」「月末」で日付、`#仕事` でタグ、URL はリンクとして付く |
| スマホの Claude アプリ・claude.ai | Claude に「箱に入れるリンクを作って」→ 出てきたリンクを押すと、箱の画面で入れる前の確認が開く |
| Android の「共有」 | 共有先に「箱」を選ぶ（ホーム画面に追加したとき） |

追加用リンクの形: `https://sho3690.github.io/hako/#/add?t=<やること>&n=<メモ>`（URL エンコード。複数は改行 `%0A` で区切る）。
リンクを押しても**勝手には入りません**。必ず画面で確かめてから「箱に入れる」を押します。

### claude.ai・スマホの Claude でも「箱に入れて」を通じるようにする（任意）

`claude-ai/hako-link/` が claude.ai 用のスキルです（リンクを作るだけで、どこにも書き込みません）。
claude.ai の「設定 → 機能（Capabilities）→ スキル」で `claude-ai/hako-link.zip`（`cd claude-ai && zip -r hako-link.zip hako-link` で作れます）をアップロードすると、
スマホの Claude アプリでも「〇〇を『箱』に入れておいて」で追加用リンクが返ってきます。

### このMacの Claude Code から使う道具

```
node ~/hako/scripts/hako.mjs add "明日 歯医者に電話する" "経費精算 #仕事" [--note …] [--due 金曜]
node ~/hako/scripts/hako.mjs add --json - <<'EOF'
[{"title":"…","due":"来週","note":"…","tags":["仕事"],"url":"https://…"}]
EOF
node ~/hako/scripts/hako.mjs list            # 日付ごとに一覧（[a1b2] が番号）
node ~/hako/scripts/hako.mjs list --done | --tags | --json
node ~/hako/scripts/hako.mjs done 歯医者      # 番号か題名の一部
node ~/hako/scripts/hako.mjs edit a1b2 --due 金曜 --note "…"
node ~/hako/scripts/hako.mjs reopen … / delete … / today
```

鍵は `.secrets/master.b64`（コミットしない）から読みます。中継に届かなかったものは `.secrets/sent.json` に控え、次に使ったとき自動で送り直します。

## 画面

- **今日**: 日付が今日のもの・過ぎたもの。丸を押すと済み（6秒以内なら取り消せる）。「箱から選ぶ」で今日やることを足せる。下に「これから（7日以内）」と「今日済ませたもの」
- **箱**: 残っている全部を「過ぎています / 今日 / 明日 / 7日以内 / それより先 / 日付なし」に分けて表示。「日付なし」「Claude から」「#タグ」で絞り込み。他の端末や Claude から届いた新着はタブに数字が出る
- **済み**: 済ませた日ごと。丸を押すと未完了に戻る。済んでから半年たったものは自動で片づける
- 1件を押すと、その場で題名・日付・メモ・タグ・リンクを直せる。「今日やる」「明日に回す」もここから
- 日付の区切りは**朝7時**（夜中の1時は、まだ前の日の「今日」）
- `n` キーで「箱に入れる」、入力欄では ⌘+Enter で入れる

## しくみ

```
[Claude Code（このMac） / スマホ・PC のブラウザ]
   │ 入れる・済み・直す（合言葉の鍵で暗号化してから送る）
   ▼
[中継 ntfy.sh]  ← 登録不要。暗号文だけを約12時間あずかる。他の端末の画面にもすぐ届く
   │ 15分ごとに取り込む
   ▼
[GitHub Actions  scripts/sync.mjs]  → 暗号化して data/state.json に保存 → GitHub Pages で配信
```

- **暗号化**: 合言葉 → PBKDF2(SHA-256, 21万回) → AES-256-GCM（DONICHI と同じしくみ・別の鍵）。
  リポジトリは公開ですが、`data/state.json` と中継のメッセージは暗号文なので、合言葉が無いと中身は読めません
  （GitHub の無料プランでは非公開リポジトリから Pages を出せないため、この形にしています）。
- **開くためのリンク**（`#k=…`）は鍵そのものを URL の `#` 以降に入れたものです。`#` 以降はサーバーに送られず、開いたらすぐ URL から消します。
  自分の端末にだけ送ってください。作り方: 画面の設定 →「別の端末で開く」に合言葉を入れる。
  開いたあと URL からは消しますが、ブラウザの閲覧履歴（iCloud・Chrome の同期を含む）や、送るのに使ったメッセージには元のリンクが残ることがあります。
  気になる場合は、開いたあとでその履歴・メッセージを消してください。
- **端末の中の鍵**: 開いたあとは「取り出せない形（non-extractable）」の鍵だけを IndexedDB に置き、親鍵そのものは保存しません。
  sho3690.github.io は他のアプリと同じ置き場なので、万一そちらに不正なスクリプトが入っても鍵を持ち出されないようにするためです
  （その場で使われることまでは防げません。気になる場合は独自ドメインへの移設が根本策です）。
- **Actions の守り**: 外部の Action はコミットの番号で固定、checkout に資格情報を残さず push の手順だけでトークンを使います。
  Actions のログは公開されるので、件数以外（題名・メモ・エラー文）は出力しません。
- **15分ごとに動かすしくみ**: 新しいリポジトリでは GitHub の定時実行が一度も起動しないことがあるため、
  各回が「15分待ってから次の回を予約する」ようにしています（環境 `interval` の待ち時間。待つ間はマシンを使いません）。定時実行は途切れたときの予備（1時間ごと）です。
  止めるとき: `gh workflow disable auto-sync.yml -R sho3690/hako`
  / 再開するとき: `gh workflow enable auto-sync.yml -R sho3690/hako && gh workflow run auto-sync.yml -R sho3690/hako`
- 同期が止まっていても、画面と道具は中継から直接読むので、約12時間は入れたものがすぐ見えます（それ以上止まると、送った端末が自動で送り直します）。

## 合言葉を変える（開くためのリンクが広まりすぎたとき）

```
node scripts/setup.mjs --keep-state       # データはそのまま、新しい合言葉で封し直す
gh secret set HAKO_KEY -R sho3690/hako < .secrets/master.b64
git add config.json data/state.json && git commit -m "合言葉を変更" && git push
```

新しい合言葉・開くためのリンクは `.secrets/owner.txt` に出ます（コミットされません）。古いリンクでは新しいデータを開けなくなります。
ただし、公開リポジトリの**過去のコミットに残っている古い `data/state.json`** は、古い合言葉・リンクを持つ人なら変更前までの中身を読めます（git の履歴からは消えないため）。
漏れた合言葉で過去の分まで守りたいときは、リポジトリを作り直す必要があります。
切り替える間は `gh workflow disable auto-sync.yml -R sho3690/hako` で同期を止めておき、push のあとで再開します。

## 開発

```
npm test                         # 日付の読み取り・データ更新・暗号のテスト（node --test）
python3 -m http.server 8792      # http://127.0.0.1:8792/ で画面を確認
```

ファイル: `index.html` / `style.css` / `app.js`（画面） · `logic.js`（日付の言葉・データ更新・並べ方の純粋関数）
· `crypto.js`（暗号） · `relay.js`（中継） · `scripts/sync.mjs`（Actions の同期） · `scripts/hako.mjs`（このMacの道具）
· `scripts/setup.mjs`（合言葉の作成・変更） · `claude-ai/hako-link/`（claude.ai 用スキル）
