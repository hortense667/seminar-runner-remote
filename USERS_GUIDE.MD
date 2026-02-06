 # USERS GUIDE
 
 ## 1. 使い方の全体像
 - 講師と受講者が **同じURL** にアクセス
 - `room` を揃えることで同じ部屋に参加
 - 受講者はコードを貼り付けて **Run** を押したときだけ実行
 - 講師は受講者一覧から選択し、コードやログを確認
 
 ## 2. 画面の開き方
 **受講者**
 - `https://<your-domain>/?room=demo`
 
 **講師**
 - `https://<your-domain>/?role=teacher&room=demo`
 
 **QR ページ**
 - `https://<your-domain>/qr.html?room=demo`
 
 ※ `room` は任意の名前に変更できます（例: `g1` / `g2`）。
 
 ## 3. 受講者の操作
 1. 受講者URLにアクセス
 2. `Room` と `Name` を入力（任意）
 3. コードを貼り付け
 4. **Run** を押すと実行（自動実行はされません）
 5. 実行ログが右側に表示され、講師にも共有されます
 
 よく使うボタン:
 - `Run` : 実行
 - `Clear logs` : ログ消去
 - `Clear code` : コード消去
 - `HTML→JS抽出` : HTML内の`<script>`だけ取り出してJS化
 
 ## 4. 講師の操作
 1. 講師URLにアクセス
 2. 受講者一覧から対象をクリック
 3. コード/ログを確認
 4. `Run selected` で講師側プレビュー
 
 講師の注意点:
 - 重いコードや無限ループは **講師PCが固まる可能性** があります
 - `Logs: 全員（OFFで選択者のみ）` を切り替えるとログの表示範囲を調整できます
 - `コードをコピー` / `HTMLでDL` で配布用に取得できます
 
 ## 5. QR ページの使い方
 - `Room` を設定して **更新**
 - 受講者用/講師用のQRとURLが表示されます
 - 教室の投影やスマホ配布に便利です
 
 ## 6. Railway に関する注意
 - Railway は **各自で契約して利用** してください
 - アカウント作成・課金・運用は **自己責任** です

## 7. ローカルで動かす場合（講師向け）
このリポジトリは Node.js サーバが必要です。`package.json` は **Railway 用（デフォルト）** ですが、ローカル利用向けに `package.local.json` のサンプルも同梱しています。

PowerShell 例（ローカル用に入れ替え）:

```powershell
Copy-Item .\package.local.json .\package.json
npm install
npm run dev
```

ブラウザで以下へアクセス:
- 受講者: `http://localhost:8787/?room=demo`
- 講師: `http://localhost:8787/?role=teacher&room=demo`
- QR: `http://localhost:8787/qr.html?room=demo`

Railway 用に戻す（PowerShell 例）:

```powershell
Copy-Item .\package.railway.json .\package.json
```
