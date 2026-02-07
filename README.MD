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
