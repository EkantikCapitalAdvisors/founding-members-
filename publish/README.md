# Publish proxy — one-time setup

This Cloudflare Worker lets `admin.html`'s **Publish to live** button commit
`trades.json` to the repo. The GitHub token lives only as a Worker secret, never
in the browser. Once `trades.json` is committed, GitHub Pages redeploys
`founding.ekantikcapital.com` automatically (~1 min).

## 1. Create a GitHub token (least privilege)

GitHub → Settings → Developer settings → **Fine-grained personal access tokens**.

- **Resource owner:** `EkantikCapitalAdvisors`
- **Repository access:** Only select repositories → `founding-members-`
- **Permissions:** Repository → **Contents: Read and write** (nothing else)
- **Expiration:** set a calendar reminder to rotate it.

Copy the token. You'll paste it into `wrangler secret put` below — **not** into
this chat, the repo, or any file.

## 2. Deploy the Worker

```bash
npm install -g wrangler        # if needed
cd publish
wrangler login                 # authorise your Cloudflare account
wrangler secret put GITHUB_TOKEN     # paste the fine-grained PAT
wrangler secret put ADMIN_PASSWORD   # choose a strong publish password
wrangler deploy
```

`wrangler deploy` prints the Worker URL, e.g.
`https://ekantik-publish.<your-subdomain>.workers.dev`.

## 3. Point admin.html at it

Open `admin.html` → section **4 · Publish to live** → paste the Worker URL into
the endpoint field (it's remembered in your browser). Enter the publish password
each time you publish.

## Editing config later

`GH_BRANCH`, `GH_PATH`, `ALLOWED_ORIGIN` live in `wrangler.toml` — edit and
re-run `wrangler deploy`. Secrets are updated by re-running `wrangler secret put`.

## Security notes

- The token never reaches the browser; only the Worker holds it.
- The Worker accepts writes only with the correct `ADMIN_PASSWORD` and (if set)
  from `ALLOWED_ORIGIN`, and only writes the single configured `GH_PATH`.
- It rejects payloads that aren't valid JSON with a non-empty `trades[]` and a
  numeric `point_value`, so a malformed file can't go live.
- If the password or token is ever exposed, rotate it: `wrangler secret put …`
  for the password, and regenerate the PAT on GitHub for the token.
- To test from a local `file://` copy of admin.html, temporarily blank
  `ALLOWED_ORIGIN` in `wrangler.toml` and redeploy (the password still guards it).
