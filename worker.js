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


// ── Durable Object: strongly-consistent shared snapshots ───────────────────
export class SnapshotStateDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders("GET, POST, OPTIONS") });
    }

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

    // ── /community ─────────────────────────────────────────────────────────
    if (path === "/community") {
      if (request.method === "GET") {
        const list = await kvGet(env, "community", []);
        // 後方互換 + 自動マイグレーション: /names にあって /community にないエントリを補完し
        // 差分があれば非同期で /community KV へ書き戻す（初回アクセス時のみ実質書き込みが走る）
        const names = await kvGet(env, "names", []);
        let migrated = false;
        for (const name of names) {
          if (!list.find(e => e.name.toLowerCase() === name.toLowerCase())) {
            list.push({ name, region: "", category: "notable", note: "", addedAt: 0 });
            migrated = true;
          }
        }
        if (migrated) ctx.waitUntil(kvPut(env, "community", list));
        return jsonRes(list);
      }
      if (request.method === "POST") {
        // TODO: 認証システム構築後に verifyWriteKey を有効化
        // if (!await verifyWriteKey(request, env)) return jsonRes({ error: "unauthorized" }, 403);
        let body;
        try { body = await request.json(); } catch { return jsonRes({ error: "invalid json" }, 400); }
        if (!body.name) return jsonRes({ error: "missing name" }, 400);

        const list = await kvGet(env, "community", []);
        const key  = (body.name || "").toLowerCase();
        const idx  = list.findIndex(e => e.name.toLowerCase() === key);
        const now  = Date.now();
        const entry = {
          name:       body.name,
          region:     body.region     || "",
          category:   body.category   || "notable",
          note:       body.note       || "",
          addedAt:    body.addedAt    || now,
          updatedAt:  body.updatedAt  || now,     // エントリ更新時刻（merge 判定用）
          sourceUser: body.sourceUser || "",      // 追加/更新したユーザーID
          // status / lastSeen は /submit (snapshots) で管理 → community には含めない
        };
        if (idx >= 0) {
          // updatedAt が新しいときだけ上書き（古いデータで巻き戻さない）
          const existing = list[idx];
          if (!existing.updatedAt || entry.updatedAt >= existing.updatedAt) {
            list[idx] = entry;
          }
        } else {
          list.push(entry);
        }
        const prev = await kvGet(env, "community", []);
        if (JSON.stringify(prev) !== JSON.stringify(list)) {
          await kvPut(env, "community", list);
        }
        return jsonRes({ ok: true });
      }
      if (request.method === "DELETE") {
        // TODO: 認証システム構築後に verifyWriteKey を有効化
        // if (!await verifyWriteKey(request, env)) return jsonRes({ error: "unauthorized" }, 403);
        const name = url.searchParams.get("name");
        if (!name) return jsonRes({ error: "missing name" }, 400);
        const list = await kvGet(env, "community", []);
        const next = list.filter(e => e.name.toLowerCase() !== name.toLowerCase());
        if (next.length !== list.length) {
          await kvPut(env, "community", next);
        }
        return jsonRes({ ok: true });
      }
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
