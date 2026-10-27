# 箱 HAKO

やること・頼まれごと・思いついたことを、**何でも放り込んでおく箱**です。
画面は「上の欄に書いて入れる」「丸を押して取り出す」だけ。日付・期限・タグ・分類は持ちません（必要なら文に書く）。
このMacの Claude Code なら、どの会話からでも **「〇〇を『箱』に入れておいて」** と言えば届きます。

- 公開先: https://sho3690.github.io/hako/
- 開けるのは、合言葉か「開くためのリンク」を持っている人（＝自分）だけです。
- 見た目は 土日 DONICHI と同じ作法（下から出るシート・取り消せるトースト・中立の地に青1色）。

## 入れ方

| どこから | どうする |
|---|---|
| このMacの Claude Code（どのフォルダ・どの会話でも） | 「〇〇を『箱』に入れておいて」。何をどう書くか・メモは Claude が会話から決める（スキル `~/.claude/skills/hako`） |
| スマホ・PC の画面 | 上の欄に書いて Enter（または「入れる」）。改行で区切ればまとめて入る。URL はリンクとして付く |
| スマホの Claude アプリ・claude.ai | Claude に「箱に入れるリンクを作って」→ 出てきたリンクを押すと、箱の画面で入れる前の確認が開く |
| ChatGPT の dots など、自分のブラウザを持つ AI（**Mac がオフラインでも**） | 「入れるだけのリンク」を渡しておく → AI がそのリンクを開いて書き、「箱に入れる」を押す（下の節） |
| Android の「共有」 | 共有先に「箱」を選ぶ（ホーム画面に追加したとき） |

追加用リンクの形: `https://sho3690.github.io/hako/#/add?t=<やること>&n=<メモ>`（URL エンコード。複数は改行 `%0A` で区切る）。
リンクを押しても**勝手には入りません**。必ず画面で確かめてから「箱に入れる」を押します。

### claude.ai・スマホの Claude でも「箱に入れて」を通じるようにする（任意）

`claude-ai/hako-link/` が claude.ai 用のスキルです（リンクを作るだけで、どこにも書き込みません）。
claude.ai の「設定 → 機能（Capabilities）→ スキル」で `claude-ai/hako-link.zip`（`cd claude-ai && zip -r hako-link.zip hako-link` で作れます）をアップロードすると、
スマホの Claude アプリでも「〇〇を『箱』に入れておいて」で追加用リンクが返ってきます。

### Mac を通さずに入れる（入れるだけのリンク・ChatGPT の dots など）

`drop.html#w=…` は、合言葉なしで**入れることだけ**ができるページです（箱の中は見えません）。Mac を使わないので、Mac が閉じていても動きます。
画面の「設定 → Mac を通さずに入れる」の「ChatGPT に渡す文をコピー」を押し、dots にそのまま貼り付けて覚えてもらいます。

- しくみ: ページは `drop.json` の**公開鍵**で封をして（ECDH P-256 → HKDF → AES-GCM）、受け口（ntfy.sh の別の宛先）に置きます。
  開ける秘密鍵と受け口の宛先は `drop.json` の中で合言葉の封をしてあり、箱の鍵を持つ側（画面・同期・このMacの道具）だけが開けます。
  リンクを知っている人は入れられますが、箱の中も、他の人がこのリンクで入れたものも読めません。入れる以外（直す・取り出す・消す）はできません。
- 同じ中身を1時間以内に二度送っても、箱には1つだけ入ります（AI の押し直し対策）。届いたものには「ChatGPT」など、どこから入ったかが付きます。
- **リンクが知らない人に渡ったとき**（作り直すと古いリンクは使えなくなり、古いリンクで開くと「使えなくなっています」と出ます）:
  ```
  node scripts/drop-setup.mjs --rotate
  git add drop.json && git commit -m "入れるだけのリンクを作り直す" && git push
  ```
  そのあと画面の設定から新しい文をコピーして、dots に渡し直します。

### このMacの Claude Code から使う道具

```
node ~/hako/scripts/hako.mjs add "歯医者に電話する" "経費精算（月末まで）" [--note …]
node ~/hako/scripts/hako.mjs add --json - <<'EOF'
[{"title":"…","note":"…","url":"https://…"}]
EOF
node ~/hako/scripts/hako.mjs list            # 箱の中（新しく入れた順。[a1b2] が番号）
node ~/hako/scripts/hako.mjs list --done | --json
node ~/hako/scripts/hako.mjs done 歯医者      # 取り出す（番号か題名の一部）
node ~/hako/scripts/hako.mjs edit a1b2 --note "…"
node ~/hako/scripts/hako.mjs reopen … / delete …
```

鍵は `.secrets/master.b64`（コミットしない）から読みます。中継に届かなかったものは `.secrets/sent.json` に控え、次に使ったとき自動で送り直します。

## 画面

- **上の欄**: 書いて Enter で入る（Shift+Enter で改行、改行で区切ればまとめて入る）。書きかけはその端末に残る。スクロールしても上に貼りつく
- **箱の中**: 新しく入れたものが上。丸を押すと取り出す（6秒以内なら元に戻せる。あとからでも Claude に「戻して」で戻せる）
- 1つを押すと、その場で中身・メモ・リンクを直せる。そこからも取り出せる
- 取り出してから半年たったものは自動で片づける
- `n` か `/` キーで入力欄へ

## しくみ

```
[Claude Code（このMac） / スマホ・PC のブラウザ]        [ChatGPT の dots など（drop.html）]
   │ 入れる・取り出す・直す（合言葉の鍵で暗号化して送る）    │ 入れるだけ（公開鍵で暗号化して送る）
   ▼                                                          ▼
[中継 ntfy.sh]  ← 登録不要。暗号文だけを約12時間あずかる。他の端末の画面にもすぐ届く（入れるだけのリンクは別の宛先）
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
node scripts/setup.mjs --keep-state       # データはそのまま、新しい合言葉で封し直す（入れるだけのリンクもそのまま使える）
gh secret set HAKO_KEY -R sho3690/hako < .secrets/master.b64
git add config.json data/state.json drop.json && git commit -m "合言葉を変更" && git push
```

新しい合言葉・開くためのリンクは `.secrets/owner.txt` に出ます（コミットされません）。古いリンクでは新しいデータを開けなくなります。
ただし、公開リポジトリの**過去のコミットに残っている古い `data/state.json`** は、古い合言葉・リンクを持つ人なら変更前までの中身を読めます（git の履歴からは消えないため）。
漏れた合言葉で過去の分まで守りたいときは、リポジトリを作り直す必要があります。
切り替える間は `gh workflow disable auto-sync.yml -R sho3690/hako` で同期を止めておき、push のあとで再開します。

## 開発

```
npm test                         # 読み取り・データ更新・暗号のテスト（node --test）
python3 -m http.server 8792      # http://127.0.0.1:8792/ で画面を確認
```

ファイル: `index.html` / `style.css` / `app.js`（画面） · `logic.js`（入れたものの読み取り・データ更新の純粋関数）
· `crypto.js`（暗号） · `relay.js`（中継） · `scripts/sync.mjs`（Actions の同期） · `scripts/hako.mjs`（このMacの道具）
· `scripts/setup.mjs`（合言葉の作成・変更） · `claude-ai/hako-link/`（claude.ai 用スキル）
