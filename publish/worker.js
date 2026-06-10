/* Ekantik trades publish proxy — Cloudflare Worker.
 *
 * Lets admin.html commit trades.json to the repo WITHOUT ever exposing the
 * GitHub token to the browser. The token and the publish password live only
 * as Worker secrets (server-side). Flow:
 *
 *   admin.html  --POST {password, content}-->  this Worker  --GitHub API-->  repo
 *   repo push   -->  GitHub Pages redeploys founding.ekantikcapital.com
 *
 * Secrets (set with `wrangler secret put`, never committed):
 *   GITHUB_TOKEN     fine-grained PAT, Contents: Read & Write, THIS repo only
 *   ADMIN_PASSWORD   shared publish password entered in admin.html
 *
 * Vars (wrangler.toml, safe to commit):
 *   GH_REPO          "EkantikCapitalAdvisors/founding-members-"
 *   GH_BRANCH        "main"
 *   GH_PATH          "trades.json"
 *   ALLOWED_ORIGIN   "https://founding.ekantikcapital.com" (CORS allowlist; optional)
 */

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowAny = !env.ALLOWED_ORIGIN || env.ALLOWED_ORIGIN === "*";
    const cors = {
      "Access-Control-Allow-Origin": allowAny ? "*" : env.ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    // Diagnostic: GET /diag?password=… reports the GitHub read status and the
    // STORED token length (not the token) so a bad/placeholder secret is obvious.
    // Never commits anything.
    if (request.method === "GET") {
      const url = new URL(request.url);
      if (url.pathname === "/diag") {
        if (!env.ADMIN_PASSWORD || url.searchParams.get("password") !== env.ADMIN_PASSWORD)
          return json({ error: "unauthorized (wrong ?password=)" }, 401, cors);
        const repo = env.GH_REPO, branch = env.GH_BRANCH || "main", path = env.GH_PATH || "trades.json";
        const tok = String(env.GITHUB_TOKEN || "");
        const r = await fetch(`https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`, {
          headers: { "Authorization": `Bearer ${tok.trim()}`, "Accept": "application/vnd.github+json",
                     "User-Agent": "ekantik-publish-worker", "X-GitHub-Api-Version": "2022-11-28" },
        });
        return json({ githubStatus: r.status, githubOk: r.ok, storedTokenLength: tok.length,
          tokenLooksLikePAT: tok.trim().startsWith("github_pat_") || tok.trim().startsWith("ghp_"),
          repo, branch, path, detail: (await r.text()).slice(0, 300) }, 200, cors);
      }
      return json({ error: "GET only supports /diag" }, 404, cors);
    }

    if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);

    // Defence-in-depth: the password is the real auth; origin is a secondary gate
    // (skipped entirely when ALLOWED_ORIGIN is "*" / unset).
    if (!allowAny && origin && origin !== env.ALLOWED_ORIGIN)
      return json({ error: "origin not allowed" }, 403, cors);

    let body;
    try { body = await request.json(); } catch { return json({ error: "bad JSON body" }, 400, cors); }

    if (!env.ADMIN_PASSWORD) return json({ error: "server missing ADMIN_PASSWORD" }, 500, cors);
    if (!constantTimeEqual(String(body.password || ""), env.ADMIN_PASSWORD))
      return json({ error: "unauthorized" }, 401, cors);

    // Validate the payload IS a sane trades.json before it can reach the repo.
    const content = String(body.content || "");
    let doc;
    try { doc = JSON.parse(content); } catch { return json({ error: "content is not valid JSON" }, 422, cors); }
    if (!doc || !Array.isArray(doc.trades) || doc.trades.length === 0)
      return json({ error: "content missing a non-empty trades[] array" }, 422, cors);
    if (typeof doc.point_value !== "number")
      return json({ error: "content missing numeric point_value" }, 422, cors);

    const repo = env.GH_REPO, branch = env.GH_BRANCH || "main", path = env.GH_PATH || "trades.json";
    if (!repo || !env.GITHUB_TOKEN) return json({ error: "server missing GH_REPO or GITHUB_TOKEN" }, 500, cors);
    const api = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}`;
    const gh = {
      // trim() guards against a trailing newline/space slipping into the secret
      "Authorization": `Bearer ${String(env.GITHUB_TOKEN).trim()}`,
      "Accept": "application/vnd.github+json",
      "User-Agent": "ekantik-publish-worker",
      "X-GitHub-Api-Version": "2022-11-28",
    };

    // Current file SHA (required by the Contents API to update an existing file).
    let sha;
    const cur = await fetch(`${api}?ref=${encodeURIComponent(branch)}`, { headers: gh });
    if (cur.status === 200) { sha = (await cur.json()).sha; }
    else if (cur.status !== 404) return json({ error: "github read failed", status: cur.status, detail: await cur.text() }, 502, cors);

    const put = await fetch(api, {
      method: "PUT",
      headers: gh,
      body: JSON.stringify({
        message: String(body.message || `Update trades.json (${doc.trades.length} records) via admin publish`),
        content: base64Utf8(content),
        branch,
        sha, // undefined on first create
      }),
    });
    if (!put.ok) return json({ error: "github write failed", status: put.status, detail: await put.text() }, 502, cors);
    const res = await put.json();
    return json({ ok: true, commit: res.commit && res.commit.html_url, sha: res.content && res.content.sha }, 200, cors);
  },
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...cors } });
}
// UTF-8-safe base64 (btoa alone mangles non-ASCII like the — in our notes).
function base64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
// Length-leaking but value-constant comparison to blunt timing attacks on the password.
function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
