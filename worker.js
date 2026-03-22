// Cloudflare Worker — Finals Tracker backend
// ─────────────────────────────────────────────────────────────────────────────
// KV binding required (in wrangler.toml):
//   [[kv_namespaces]]
//   binding = "DATA"
//   id = "<YOUR_KV_NAMESPACE_ID>"
//
// Routes:
//   Proxy API  : GET  /api/player?name=...&season=s9&platform=crossplay
//                GET  /api/leaderboard?season=s9&platform=crossplay
//   Global list: GET  /community         → all community entries
//                POST /community         → add/update entry  { name, region, category, note }
//                GET  /names             → array of tracked names
//                POST /names             → add name  { name }
//                GET  /snapshots         → all snapshots
//                POST /submit            → upsert snapshot  { name, snapshot }
//   Auth       : GET  /auth              → { allowedUsers:[{id,passwordHash}] }
//                POST /auth              → set/update auth config
//                                          body: { adminPasswordHash, allowedUsers }
//                                          First call sets the admin hash (initial setup).
//                                          Subsequent calls require matching adminPasswordHash.
// ─────────────────────────────────────────────────────────────────────────────

const UPSTREAM_BASE = "https://api.the-finals-leaderboard.com/v1";

const OFFICIAL_LB_BASE = "https://id.embark.games/the-finals/leaderboards";
function textRes(text, status=200, contentType="text/plain; charset=utf-8"){
  return new Response(text, {status, headers: {"Content-Type": contentType, ...corsHeaders("GET, OPTIONS")}});
}
async function fetchOfficialLastUpdated(season){
  const target = `${OFFICIAL_LB_BASE}/${encodeURIComponent(season||"s9")}`;
  const resp = await fetch(target, { headers: { "User-Agent": "finals-proxy" }});
  const html = await resp.text();
  const m = html.match(/Last updated:\s*([^<\n]+)/i);
  return { token: m ? m[1].trim() : "", source: target };
}

// ── CORS ─────────────────────────────────────────────────────────────────────
function corsHeaders(method = "GET, POST, DELETE, OPTIONS") {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": method,
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Write-Key",
  };
}

function jsonRes(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders() },
  });
}

// ── KV helpers ───────────────────────────────────────────────────────────────
async function kvGet(env, key, fallback) {
  try {
    const raw = await env.DATA.get(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
async function kvPut(env, key, val) {
  await env.DATA.put(key, JSON.stringify(val));
}
// 書き込みキー検証: adminPasswordHash または allowedUser の passwordHash と一致すれば OK
// auth 未設定の場合は誰でも書き込み可（後方互換）
async function verifyWriteKey(request, env) {
  const auth = await kvGet(env, "auth", { adminPasswordHash: "", allowedUsers: [] });
  if (!auth.adminPasswordHash) return true;
  const key = request.headers.get("X-Write-Key") || "";
  if (key === auth.adminPasswordHash) return true;
  if (auth.allowedUsers && auth.allowedUsers.some(u => u.passwordHash === key)) return true;
  return false;
}


// ── Durable Object: strongly-consistent shared state ────────────────────────
// snapshots + community list を強整合性で管理
// KV (結果整合性) から DO に移行することで、他ユーザーへの即時反映を実現
export class SnapshotStateDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  // KV → DO 初回マイグレーション（community が DO に無ければ KV から読み込む）
  async _ensureCommunity() {
    let list = await this.state.storage.get("community");
    if (list == null) {
      // KV からマイグレーション
      try {
        const raw = await this.env.DATA.get("community");
        list = raw ? JSON.parse(raw) : [];
      } catch { list = []; }
      // /names の後方互換補完
      try {
        const rawN = await this.env.DATA.get("names");
        const names = rawN ? JSON.parse(rawN) : [];
        for (const name of names) {
          if (!list.find(e => e.name.toLowerCase() === name.toLowerCase())) {
            list.push({ name, region: "", category: "notable", note: "", addedAt: 0 });
          }
        }
      } catch {}
      await this.state.storage.put("community", list);
    }
    return list;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders("GET, POST, DELETE, OPTIONS") });
    }

    // ── /snapshots ──────────────────────────────────────────────
    if (path === "/snapshots" && request.method === "GET") {
      const snaps = await this.state.storage.get("snapshots") || {};
      return jsonRes(snaps);
    }

    if (path === "/submit" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return jsonRes({ error: "invalid json" }, 400); }
      if (!body.name) return jsonRes({ error: "missing name" }, 400);
      const snaps = await this.state.storage.get("snapshots") || {};
      const key = body.name.toLowerCase();
      const incoming = body.snapshot || {};
      const existing = snaps[key] || null;
      const same = existing && JSON.stringify(existing) === JSON.stringify(incoming);
      if (!same) {
        snaps[key] = incoming;
        await this.state.storage.put("snapshots", snaps);
      }
      return jsonRes({ ok: true, skipped: !!same });
    }

    // ── /community (強整合性) ───────────────────────────────────
    if (path === "/community") {
      if (request.method === "GET") {
        const list = await this._ensureCommunity();
        return jsonRes(list);
      }

      if (request.method === "POST") {
        let body;
        try { body = await request.json(); } catch { return jsonRes({ error: "invalid json" }, 400); }
        if (!body.name) return jsonRes({ error: "missing name" }, 400);

        const list = await this._ensureCommunity();
        const key = (body.name || "").toLowerCase();
        const idx = list.findIndex(e => e.name.toLowerCase() === key);
        const now = Date.now();
        const entry = {
          name:       body.name,
          region:     body.region     || "",
          category:   body.category   || "notable",
          note:       body.note       || "",
          addedAt:    body.addedAt    || now,
          updatedAt:  body.updatedAt  || now,
          sourceUser: body.sourceUser || "",
        };
        if (idx >= 0) {
          const existing = list[idx];
          if (!existing.updatedAt || entry.updatedAt >= existing.updatedAt) {
            list[idx] = entry;
          }
        } else {
          list.push(entry);
        }
        await this.state.storage.put("community", list);
        return jsonRes({ ok: true });
      }

      if (request.method === "DELETE") {
        const name = url.searchParams.get("name");
        if (!name) return jsonRes({ error: "missing name" }, 400);
        const list = await this._ensureCommunity();
        const next = list.filter(e => e.name.toLowerCase() !== name.toLowerCase());
        if (next.length !== list.length) {
          await this.state.storage.put("community", next);
        }
        return jsonRes({ ok: true });
      }
    }

    return jsonRes({ error: "not found" }, 404);
  }
}

function snapshotStub(env) {
  const id = env.SNAPSHOT_STATE.idFromName("global-snapshots");
  return env.SNAPSHOT_STATE.get(id);
}

// ── Worker entry ─────────────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }


    // ── static assets (Workers Assets) ────────────────────────────────────
    const isStatic = request.method === "GET" && (
      path === "/" ||
      path === "/index.html" ||
      path === "/app.js" ||
      path === "/i18n.js" ||
      path === "/style.css" ||
      path === "/sw.js" ||
      path === "/manifest.json" ||
      path === "/robots.txt" ||
      path === "/icon.svg" ||
      /\.(js|css|html|svg|png|jpg|jpeg|webp|ico|txt|json|map)$/i.test(path)
    );
    if (isStatic && env.ASSETS) {
      const assetRequest = path === "/"
        ? new Request(new URL("/index.html", url), request)
        : request;
      return env.ASSETS.fetch(assetRequest);
    }

    // ── /api/official-last-updated — official HTML token proxy ────────────
    if (path === "/api/official-last-updated") {
      const season = url.searchParams.get("season") || "s9";
      try {
        const data = await fetchOfficialLastUpdated(season);
        return jsonRes({ ok: true, ...data });
      } catch (e) {
        return jsonRes({ ok: false, error: String(e && e.message ? e.message : e) }, 500);
      }
    }

    // ── /api/* — leaderboard proxy ─────────────────────────────────────────
    if (path === "/api/player") {
      const name     = url.searchParams.get("name");
      const season   = url.searchParams.get("season")   || "s9";
      const platform = url.searchParams.get("platform") || "crossplay";
      if (!name) return jsonRes({ error: "missing name" }, 400);

      const upstream = `${UPSTREAM_BASE}/leaderboard/${season}/${platform}?name=${encodeURIComponent(name)}`;
      const cacheTtl = parseInt(url.searchParams.get("cache") || "30", 10);
      const cacheKey = new Request(upstream, request);
      const cache    = caches.default;

      let resp = await cache.match(cacheKey);
      if (!resp) {
        const r = await fetch(upstream, { headers: { "User-Agent": "finals-proxy" } });
        resp = new Response(await r.text(), r);
        resp.headers.set("Access-Control-Allow-Origin", "*");
        resp.headers.set("Cache-Control", `public, max-age=${cacheTtl}`);
        ctx.waitUntil(cache.put(cacheKey, resp.clone()));
      } else {
        resp = new Response(resp.body, resp);
        resp.headers.set("Access-Control-Allow-Origin", "*");
      }
      return resp;
    }

    if (path === "/api/leaderboard") {
      const season   = url.searchParams.get("season")   || "s9";
      const platform = url.searchParams.get("platform") || "crossplay";
      const cacheTtl = parseInt(url.searchParams.get("cache") || "30", 10);

      const upstream = `${UPSTREAM_BASE}/leaderboard/${season}/${platform}`;
      const cacheKey = new Request(upstream, request);
      const cache    = caches.default;

      let resp = await cache.match(cacheKey);
      if (!resp) {
        const r = await fetch(upstream, { headers: { "User-Agent": "finals-proxy" } });
        resp = new Response(await r.text(), r);
        resp.headers.set("Access-Control-Allow-Origin", "*");
        resp.headers.set("Cache-Control", `public, max-age=${cacheTtl}`);
        ctx.waitUntil(cache.put(cacheKey, resp.clone()));
      } else {
        resp = new Response(resp.body, resp);
        resp.headers.set("Access-Control-Allow-Origin", "*");
      }
      return resp;
    }

    // ── /community → Durable Object (強整合性) ────────────────────────────
    // KV の結果整合性では他ユーザーへの反映が遅延するため、DO にルーティング
    if (path === "/community") {
      const stub = snapshotStub(env);
      return stub.fetch(request);
    }

    // ── /names ─────────────────────────────────────────────────────────────
    if (path === "/names") {
      if (request.method === "GET") {
        const names = await kvGet(env, "names", []);
        return jsonRes(names);
      }
      if (request.method === "POST") {
        let body;
        try { body = await request.json(); } catch { return jsonRes({ error: "invalid json" }, 400); }
        if (!body.name) return jsonRes({ error: "missing name" }, 400);

        const names = await kvGet(env, "names", []);
        const lc    = body.name.toLowerCase();
        if (!names.find(n => n.toLowerCase() === lc)) {
          names.push(body.name);
          await kvPut(env, "names", names);
        }
        return jsonRes({ ok: true });
      }
    }

    // ── /snapshots ─────────────────────────────────────────────────────────
    if (path === "/snapshots") {
      if (request.method === "GET") {
        return snapshotStub(env).fetch(new Request("https://snapshot.local/snapshots", { method: "GET" }));
      }
    }

    // ── /submit ────────────────────────────────────────────────────────────
    if (path === "/submit" && request.method === "POST") {
      // TODO: 認証システム構築後に verifyWriteKey を有効化
      // if (!await verifyWriteKey(request, env)) return jsonRes({ error: "unauthorized" }, 403);
      const bodyText = await request.text();
      return snapshotStub(env).fetch(new Request("https://snapshot.local/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: bodyText,
      }));
    }

    // ── /auth ──────────────────────────────────────────────────────────────
    if (path === "/auth") {
      if (request.method === "GET") {
        // Return allowed users (with password hashes) for client-side verification
        // Admin hash is NOT returned
        const auth = await kvGet(env, "auth", { adminPasswordHash: "", allowedUsers: [] });
        return jsonRes({ allowedUsers: auth.allowedUsers || [] });
      }

      if (request.method === "POST") {
        let body;
        try { body = await request.json(); } catch { return jsonRes({ error: "invalid json" }, 400); }

        const stored = await kvGet(env, "auth", { adminPasswordHash: "", allowedUsers: [] });

        // First-time setup: if no admin hash stored yet, accept any hash as the new admin hash
        if (!stored.adminPasswordHash) {
          if (!body.adminPasswordHash) return jsonRes({ error: "adminPasswordHash required for initial setup" }, 400);
          await kvPut(env, "auth", {
            adminPasswordHash: body.adminPasswordHash,
            allowedUsers: Array.isArray(body.allowedUsers) ? body.allowedUsers : [],
          });
          return jsonRes({ ok: true, setup: true });
        }

        // Subsequent calls: verify admin password hash
        if (body.adminPasswordHash !== stored.adminPasswordHash) {
          return jsonRes({ error: "unauthorized" }, 403);
        }

        // Update allowed users (and optionally change admin hash)
        await kvPut(env, "auth", {
          adminPasswordHash: body.newAdminPasswordHash || stored.adminPasswordHash,
          allowedUsers: Array.isArray(body.allowedUsers) ? body.allowedUsers : stored.allowedUsers,
        });
        return jsonRes({ ok: true });
      }
    }

    // ── fallback ───────────────────────────────────────────────────────────
    return jsonRes({
      ok: true,
      routes: [
        "GET  /api/player",
        "GET  /api/leaderboard",
        "GET  /community",   "POST /community",  "DELETE /community",
        "GET  /names",       "POST /names",
        "GET  /snapshots",   "POST /submit",
        "GET  /auth",        "POST /auth",
      ],
    });
  },
};
