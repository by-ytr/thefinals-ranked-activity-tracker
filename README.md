
This mode polls the *leaderboard once per interval* and detects batch updates by hashing a rank window (default ranks ~2000-2499). It then estimates update intervals (mean/median/p90).
- Enable: check **Update estimator (Advanced)**
- Requires proxyBase (Workers) because browser CORS is unreliable.
- Keep poll interval >= 30s and worker cache ~30s to reduce upstream load.
