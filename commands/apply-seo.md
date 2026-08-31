---
description: Audit and add SEO to the current repo — robots.txt, build-time sitemap.xml, per-page title/description/canonical, Open Graph/Twitter cards, crawlable content for SPAs (prerendered bodies), JSON-LD, and an IndexNow key for post-deploy crawler pings. Stack-aware. Audits read-only first, then applies only what's missing on your approval. If SEO is absent it reminds you and lets you defer 2 weeks or indefinitely (a SessionStart hook re-surfaces the reminder). Fire on `/apply-seo`.
argument-hint: "[--apply | --defer 2w | --defer never | --status]"
allowed-tools: Bash(git:*), Bash(ls:*), Bash(find:*), Bash(grep:*), Bash(rg:*), Bash(cat:*), Bash(python3:*), Bash(node:*), Bash(npm:*), Bash(jq:*), Bash(date:*), Bash(mkdir:*), Read, Glob, Grep, Write, Edit, AskUserQuestion
---

# apply-seo

Add (or audit) SEO for the **current repository**. Stack-aware, audit-first, applies only on approval. Never pushes or deploys — that's `/shipit`'s job.

`$ARGUMENTS` may contain a mode flag (see **Modes**). Default (no flag) = audit + interactive choice.

## State registry

A shared JSON file tracks per-repo SEO status so the SessionStart reminder hook knows when to nudge and when to stay quiet:

- Path: `~/.claude/seo-watch.json`
- Key: the repo root absolute path (`git rev-parse --show-toplevel`).
- Value shapes:
  - `{"state": "done", "updated": "<YYYY-MM-DD>"}` — SEO applied; never nag.
  - `{"state": "deferred", "until": "<YYYY-MM-DD>", "updated": "<YYYY-MM-DD>"}` — nag again once `until` passes.
  - `{"state": "never", "updated": "<YYYY-MM-DD>"}` — indefinitely silenced.
- A top-level `{"_disabled": true}` key globally mutes the hook.

Read/write it with a small `python3` snippet (load-or-`{}`, update the one key, dump with `indent=2`). Always use today's date from `date +%F`. Create the file if missing.

## Modes

- `--status` — print this repo's registry entry + a one-line audit summary. No changes, no prompts.
- `--defer 2w` — write `deferred` with `until` = today + 14 days. Confirm and stop.
- `--defer never` — write `never`. Confirm and stop.
- `--apply` — run the audit, then apply every missing item without asking (still show what you're doing). Set `done` when finished.
- no flag — audit, report, then if gaps remain ask via **AskUserQuestion**: `Apply now` / `Defer 2 weeks` / `Defer indefinitely`. Route to the matching mode.

## Step 1 — detect stack (read-only)

Determine repo root and what kind of site this is, because the fixes differ:

- **Static / SPA** (Vite, plain HTML, CRA): crawlers may get an empty shell — content must be prerendered.
- **SSG** (Astro, Eleventy, Hugo, Jekyll, Gatsby, Next export): pages are already static HTML; focus on metadata + sitemap plugin.
- **SSR** (Next app/pages, Nuxt, Remix, SvelteKit): content is server-rendered; focus on metadata APIs + framework sitemap/robots routes.

Look at `package.json` deps, config files (`vite.config.*`, `astro.config.*`, `next.config.*`, etc.), and the build output dir. Also identify how the site is served (Caddyfile, nginx, vercel.json, framework default) — this is where robots/sitemap must actually be reachable.

## Step 2 — audit (read-only). Report present/missing for each:

1. **robots.txt** — reachable at `/robots.txt`. Should allow crawling (incl. AI bots, unless the user wants otherwise) and point to the sitemap.
2. **sitemap.xml** — reachable at `/sitemap.xml`; lists every public route with `<loc>` (+ `<lastmod>` when known). Prefer **build-time generation** so it stays current.
3. **`<title>` + `<meta name="description">`** — present and meaningful per page/route (not just the homepage).
4. **Canonical** — `<link rel="canonical">` per page.
5. **Open Graph + Twitter Card** — `og:title/description/type/url/image` (1200×630) + `twitter:card`. Per-page for content pages.
6. **Crawlable content (SPA only)** — does the served HTML contain the actual page text, or just `<div id="root"></div>`? If empty, crawlers/unfurlers see nothing. Fix by prerendering page bodies into the static HTML (the client framework overwrites the node on boot — legitimate prerendering, not cloaking, as long as the prerendered text matches what the app renders).
7. **Structured data (JSON-LD)** — `Article` for posts, `Person`/`Organization`/`WebSite` for a profile/landing. Add where it adds value; don't over-mark.
8. **Favicons / theme-color** — usually present; note if absent.
9. **IndexNow key** — a `<key>.txt` at the site root enables programmatic crawler pings (Bing/Yandex/Seznam/Naver) post-deploy. Generate with `openssl rand -hex 16`; the file content is exactly the key.

## Step 3 — apply (only `--apply` or after `Apply now`)

Show the concrete plan (files to add/change) before editing. Then implement the **missing** items, matching the repo's existing conventions and stack:

- **robots.txt** → static file in the served root (`public/`, `static/`, or repo root depending on tooling). Allow-all + `Sitemap:` line, unless the user asked to restrict.
- **sitemap.xml** → prefer the framework plugin (`@astrojs/sitemap`, `next-sitemap`, `gatsby-plugin-sitemap`, `@nuxtjs/sitemap`); else extend the build to emit it from the route/content list. Include `<lastmod>`.
- **metadata (title/description/canonical/OG/Twitter)** → use the framework's head/metadata API (Next Metadata, Astro `<head>`, `react-helmet`, Nuxt `useHead`) or, for hand-rolled builds, a post-build injector.
- **SPA crawlable content** → prerender each route's body into its static HTML at build time (per-route file + a homepage variant). Verify the client still boots and overwrites the node; keep injected text equal to rendered text.
- **JSON-LD** → inline `<script type="application/ld+json">` with the right schema.org type.
- **IndexNow key** → drop `public/<key>.txt`; note that the actual ping happens *after deploy* (the key file must be live first). `/get-network-logs` and a manual Bing/Search-Console step handle pinging.

After applying: run the build if one exists (`npm run build` or equivalent) and verify the new artifacts (robots/sitemap/prerendered HTML) exist and look right. Then set registry `state: done`.

**Boundaries:** never `git push`, deploy, or ping a live crawler from this command (the site isn't live yet). Hand deploy off to `/shipit`. After it's live, pinging IndexNow + submitting to Google Search Console (manual, auth-gated) are the follow-ups.

## Step 4 — close out

Short summary: what was already present, what you added, what you deferred, and the registry state written. If you applied changes, remind the user to deploy (so the sitemap/robots go live) and then ping crawlers.
