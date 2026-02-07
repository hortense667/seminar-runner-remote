 # Seminar JS Runner (Remote)
 
 © 2026 by Satoshi Endo / ZEN University / https://x.com/hortense667

 講師と受講者が同じURLにアクセスし、WebSocketでリアルタイムにコード/ログを共有するシンプルな講義用ツールです。  
 このリポジトリは **Node.js サーバー必須** の構成です（静的ホスティングのみでは動きません）。Railwayでの利用を想定していますが、ローカル起動でも使えます。
 
 ## できること
 - 受講者のコードとログを講師側でリアルタイム閲覧
- 講師が受講者のコードを選択して参照（実行は別タブで実行）
 - 受講者/講師向けのQRコード生成
- 受講者→講師へ「できました」「質問あり」通知
- 講師が受講者ごとにメモ入力（講師のみ）
- 講師→受講者へヘッダメッセージ配信
- 講師が関係資料リンク集を編集（受講者は閲覧）
 
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
- **限界もあります**: 無限ループや重い処理は、ブラウザ（タブ）を固める可能性があります。その場合は、（特に講師は）別タブを閉じる運用で復旧してください。

## なぜ作ったか（コンセプト）
いざツールを探してみると、「ちょうどいい」が見つかりませんでした。アカウント作成、環境構築、複雑なUIといった **本質ではない壁**が立ちはだかります。

- **インストール不要・ログイン不要**: URLを開くだけで繋がるシンプルさは、限られた授業時間内で行えることを重視しています。
- **「コードの共有」ではなく「体験の共有」**: 単なるテキスト共有ではなく、**「先生が手元で直して、生徒の画面で動く」**という体験は、学習者の心理的安全性を高めると考えています。

## 拡張性
- ChatGPTなどのAIで生成したコードを貼り付けて試すのに最適です。htmlで生成されたものから自動的にJavaScriptを抽出して実行する機能も提供しています。
- HTMLでダウンロードして「成果物として持ち帰る」運用にも向きます
- 関係資料リンク集や講師メッセージなど、講義運用に寄せた機能を追加しやすい構造です

 ## 重要: Railway の利用について
 - 本プロジェクトの公開運用は **Railway を各自で契約して利用** してください。
 - Railway のアカウント作成/課金/運用は **ご自身の責任** で行ってください。
 
 ## 必要環境
 - Node.js 18 以上
 
 ## ローカル起動
このリポジトリの `package.json` は **Railway 用（デフォルト）** です。ローカルで使う場合は、必要に応じて `package.local.json` と入れ替えて使えます。

- `package.railway.json`: Railway 用（デフォルトと同内容のサンプル）
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
 
 取得したURLの例:
 - 受講者: `https://<your-domain>/?room=demo`
 - 講師: `https://<your-domain>/?role=teacher&room=demo`
 - QR: `https://<your-domain>/qr.html?room=demo`
 
 詳しい操作は `USERS_GUIDE.MD` を参照してください。
