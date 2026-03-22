 # Seminar JS Runner (Remote)
 
 © 2026 by Satoshi Endo / ZEN University / https://x.com/hortense667

 講師と受講者が同じURLにアクセスし、リアルタイムにコード/ログを共有するシンプルな講義用ツールです。  
 このリポジトリは **Node.js サーバー必須** の構成です（静的ホスティングのみでは動きません）。Railwayやfly.io、renderでの利用を想定していますが、ローカル起動でも使えます。同じ無線環境が使えるローカル環境で使う場合は、サービスの契約等を気にせず使えます。
 
 ## できること
- 受講者がなにをやっているか（コードとログ）を講師側でリアルタイムで見れます
- 講師が受講者のコードを選択して実行することもできます（評価、大画面などで説明用）
- 受講者向けのQRコード生成、みんなの作品一覧ページのQRコード
- 受講者→講師へ「できました」「質問あり」通知
- 講師が受講者ごとにメモ入力（講師のみ：講師画面を大画面でプレゼン中は全員に見えるので注意）
- 講師が席（受講者）ごとに **URL1・URL2** を設定し、受講者はヘッダの「URL1」「URL2」ボタンでそのURLを別タブで開ける（講師はCSV一括登録・クリアも可能）
- 講師→受講者全員へヘッダメッセージ配信（「3時まで休憩」など）
- 講師が関係資料リンク集を編集（受講者は閲覧：関係資料には関係するあらゆる情報を入れるとよいでしょう）
 
## 想定ユースケース（ターゲット）
- 小学校高学年向けの親子教室（「まず動く体験」を優先）
- 非エンジニア向け体験セミナー（環境構築の壁を排除）
- 社内勉強会 / 研修のハンズオン（同一roomで進捗・質問を可視化）
- ChatGPTなどのAIで生成したコードを、その場で貼り付けて試したい場面

## 内容安全性（安全性について）
このツールは「受講者が持ち込むコード」を実行します。そのため、ブラウザ側での隔離を前提にしています。

- **sandbox iframeで実行**: 受講者の実行プレビューは、`iframe sandbox="allow-scripts"` の中で動かします。
- **講師の別タブ実行もsandbox**: 講師の「別タブで実行」も、別タブ内の `iframe sandbox="allow-scripts"` で実行します。
- **Cookie等へのアクセスを抑制**: sandbox iframeは通常、**ユニークオリジン**として扱われ、アプリ本体（受講者画面）のCookieやLocalStorage等に直接アクセスできません。これにより、悪意のあるスクリプトが「Cookieを盗む」等のリスクを軽減します。
- **限界もあります**: 無限ループや重い処理は、ブラウザ（タブ）を固める可能性があります。その場合は、受講者はリロード、講師は別タブを閉じる運用で復旧してください。

## なぜ作ったか（コンセプト）
いざツールを探してみると、私の想定しているセミナー用の「ちょうどいい」が見つかりませんでした。アカウント作成、環境構築、複雑なUIといった **本質ではない壁**なしでやりたいと思いました。

- **インストール不要・ログイン不要**: URLを開くだけで繋がるシンプルさで、限られた授業時間内で行えることを重視しています。
- **「コードの共有」ではなく「体験の共有」**: 単なるテキスト共有ではなく、**「先生が手元で直して、生徒の画面で動く」**という体験（コード書き戻し）は、学習者の心理的安全性を高めると考えています。

## 拡張性
- ChatGPTなどのAIで生成したコードを貼り付けて試すのに最適です。htmlで生成されたものから自動的にJavaScriptを抽出して実行する機能も提供しています。
- このツールでの利用を想定したChatGPTのGPTとして「JsCodePon」を別途提供しています（ChatGPTの「GPTを検索」から“JsCodePon”またはhttps://chatgpt.com/g/g-6985dfaf570481918cd3fdf8e38390d9-jscodepon）。
- HTMLでダウンロードして「成果物として持ち帰る」運用にも向きます。
- 関係資料リンク集や講師メッセージなど、講義運用に寄せた機能を追加しやすい構造です。

## 重要: Railway の利用について
- 本プロジェクトの公開運用は **Railway、Fly.io、Render を各自で契約して利用** してください。
- Railway、Fly.io、Renderのアカウント作成/課金/運用は **ご自身の責任** で行ってください。
- Fly.ioは、未使用時は限りなく課金されないので費用を懸念される場合はお勧めです。
- Renderは、無料で使えますが若干運用にコツが必要です。
- 冒頭で述べたとおり、同じ無線環境に講師、受講者ともいる場合は、ローカルで使うことができます。

 ## 必要環境
 - Node.js 18 以上
 
## 作品公開（Cloudflare Pages / 1〜2アクション）
講師PCに保存されたHTML作品を、**月/ルームごとの一覧ページ**として自動生成し、**1コマンドでCloudflare Pagesへ公開**できます。

### しくみ
- 入力フォルダ: `exports/`
- 出力フォルダ: `showcase/`
- `index.html`（一覧）と `index.json` を自動生成
- ファイル名 `プログラム名(なまえ)(ルーム名)日時分秒.html` を解析して一覧化

### 使い方
1. 作品HTMLを `exports/` に入れる  
2. 一覧を生成:

```bash
npm run showcase:build
```

3. 公開（Cloudflare Pages）:

```bash
SET SHOWCASE_PROJECT=<Cloudflareのプロジェクト名>
npm run showcase:deploy
```

※ `SHOWCASE_PROJECT` は Cloudflare Pages のプロジェクト名です。  
※ 1回目は `npx wrangler` が初回セットアップを促す場合があります。

### 1クリック公開（Windows）
`tools/showcase-deploy.bat` を編集して `SHOWCASE_PROJECT` を自分のプロジェクト名に変更してください。  
その後、**このバッチをダブルクリック**すれば、ビルド＋公開が1回で完了します。

### 初回ログイン手順（Cloudflare）
初回だけ Cloudflare の認証が必要です。以下を1回実行してください。

```bash
npx wrangler login
```

※ `showcase-deploy.bat` 内でも `whoami → login` を自動で試みます（初回はブラウザが開きます）。

### URLの限定公開（パスワード無し）
Cloudflare Pages は標準で「**URLを知っている人だけが見られる**」形の公開に向きます。  
パスワードはかけず、**共有した相手だけがアクセスできる運用**で十分な場合におすすめです。  
（完全な秘匿にはならないため、公開範囲は自己責任で調整してください）

## ローカル起動
このリポジトリの `package.json` は **Railway、fly.io、render用（デフォルト）** です。ローカルで使う場合は、必要に応じて `package.local.json` と入れ替えて使えます。

- `package.railway.json`: Railway、fly.io、render用（デフォルトと同内容のサンプル）
- `package.local.json`: ローカル用（`npm run dev` を追加）

### ローカル起動（そのままでもOK）

```bash
npm install
npm start
```

### ローカル起動（入れ替えて使う場合）

PowerShell 例:

```powershell
Copy-Item .\package.local.json .\package.json
npm install
npm run dev
```

Railway 用に戻す（PowerShell 例）:

```powershell
Copy-Item .\package.railway.json .\package.json
npm install
npm start
```
 
ブラウザで以下へアクセス:
- 受講者: `http://localhost:8787/?room=demo`
- 講師: `http://localhost:8787/?role=teacher&room=demo`
- QR: `http://localhost:8787/qr.html?room=demo`
 
## Railway へのデプロイ（最小手順）
1. GitHub にこのリポジトリを push
2. Railway で「New Project → Deploy from GitHub repo」
3. デプロイ完了後、`Settings → Networking → Generate Domain` でURL取得

一度やったらGitHub を更新だけでよい。

取得したURLの例:
- 受講者: `https://<your-domain>/?room=demo`
- 講師: `https://<your-domain>/?role=teacher&room=demo`
- QR: `https://<your-domain>/qr.html?room=demo`（受講者/作品一覧のQR）
 
詳しい操作は `USERS_GUIDE.MD` を参照してください。

## 環境変数（受講者データの保持・状態ファイル）
サーバー（`server.js`）では、ルームごとの状態を `data/state.json` に保存します（`STATE_FILE` でパス変更可）。

| 変数 | 既定 | 意味 |
|------|------|------|
| `STATE_FILE` | リポジトリ内 `data/state.json` | 永続化ファイルのパス |
| `STUDENT_TTL_MS` | `2592000000`（30日 ≒ 1ヶ月） | この時間より `lastSeen` が古い受講者をサーバーから削除 |
| `CLEANUP_INTERVAL_MS` | `60000`（60秒） | 上記のチェックと、座席の無効な割り当ての整理の間隔 |

**受講者一覧リセット**・ゴースト席の整理・表示名まわりの挙動の説明は、`USERS_GUIDE.MD` の **「6. サーバー側の受講者データと席」** を参照してください。
