 # Seminar JS Runner (Remote)
 
 講師と受講者が同じURLにアクセスし、WebSocketでリアルタイムにコード/ログを共有するシンプルな講義用ツールです。  
 このリポジトリは **Node.js サーバー必須** の構成です（静的ホスティングのみでは動きません）。
 
 ## できること
 - 受講者のコードとログを講師側でリアルタイム閲覧
 - 講師が受講者のコードを選択して実行プレビュー
 - 受講者/講師向けのQRコード生成
 
 ## 重要: Railway の利用について
 - 本プロジェクトの公開運用は **Railway を各自で契約して利用** してください。
 - Railway のアカウント作成/課金/運用は **ご自身の責任** で行ってください。
 
 ## 必要環境
 - Node.js 18 以上
 
 ## ローカル起動
 ```bash
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
