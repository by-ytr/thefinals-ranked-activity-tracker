# THE FINALS – Ranked Points Tracker (Public) v3

## 一般ユーザー向けの使い方
- 名前（Embark ID推奨: `name#1234`）を貼る → Start
- Share link を押す → URLを共有（`?names=` で監視対象を渡します）

## 公開方法（静的サイト）
### Cloudflare Pages（おすすめ）
1) このフォルダを GitHub に push
2) Cloudflare Pages でリポジトリを接続して Deploy
3) 公開URLを共有

### GitHub Pages
1) GitHub に push
2) Settings → Pages を有効化

## CORS対策（推奨）
ブラウザから外部APIへ直叩きが CORS で失敗する場合があります。
その場合 `worker.js` を Cloudflare Workers にデプロイして Proxy Base URL を設定します。

### Workers deploy（最短）
```bash
npm i -g wrangler
wrangler login
wrangler init finals-tracker-proxy
# worker.js を src/index.js に貼り替え
wrangler deploy
```
出てきたURLを Advanced → Proxy Base URL に入れてください。

## ローカル起動
```bash
python -m http.server 8000
```
http://localhost:8000


## Debug option
- Match avg と ± jitter（分）を調整して、IN_MATCH がロビー判定になりすぎる問題を調整できます。
- 正式版ではこの jitter を Advanced に移す想定です。


## Update frequency estimator (Advanced)
This mode polls the *leaderboard once per interval* and detects batch updates by hashing a rank window (default ranks ~2000-2499). It then estimates update intervals (mean/median/p90).
- Enable: check **Update estimator (Advanced)**
- Requires proxyBase (Workers) because browser CORS is unreliable.
- Keep poll interval >= 30s and worker cache ~30s to reduce upstream load.
