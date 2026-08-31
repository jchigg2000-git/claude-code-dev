---
description: Collect and analyze the current repo's production network/access logs, attribute where traffic comes from (client IP, org, geo proxy, bot vs human vs scanner), and write one cited artifact with concrete suggestions. Read-only against infra — pulls logs, never deploys. Handles Railway (CLI JSON deploy logs), Caddy/nginx access logs, and other access-log sources. Fire on `/get-network-logs`.
argument-hint: "[--since 7d] [--lines 5000] [--platform railway|caddy|nginx|auto]"
allowed-tools: Bash(railway:*), Bash(git:*), Bash(ls:*), Bash(cat:*), Bash(grep:*), Bash(rg:*), Bash(python3:*), Bash(host:*), Bash(dig:*), Bash(curl:*), Bash(wc:*), Bash(date:*), Bash(find:*), Read, Glob, Grep, Write
---

# get-network-logs

Pull this repo's production access logs, work out **where the traffic actually comes from**, classify it, and produce **one artifact** with data-grounded suggestions. Read-only against infrastructure — never deploy or push.

`$ARGUMENTS`: `--since` (default `7d` or the platform's full retained buffer if shorter), `--lines` (default `5000`), `--platform` (default `auto`).

## Step 1 — find the log source

Detect the deploy platform and the **richest** available access log (one that carries client IP + User-Agent + Referer, not just path/status):

- **Railway** (a `railway.json`/`railway.toml`, or `railway status` resolves): use the **CLI**, not the MCP tools. The Railway MCP `get_logs http` view returns only `method/path/status/latency` (no IP/UA), and its deploy-log view collapses structured JSON to `"handled request"`. The real per-request data is in the JSON access log: `railway logs -d --json -n <lines>`. (If the MCP returns `Unauthorized`, the CLI is usually still authenticated — prefer it.)
- **Caddy**: JSON access log (`log { format json }`). Find the log file/stream from the Caddyfile.
- **nginx/Apache**: combined/JSON access log on disk.
- **Vercel/Netlify/Cloudflare**: their log drain / analytics export if reachable; otherwise say so and stop with what's available.

**Critical IP detail:** behind a proxy/edge (Railway, Cloudflare, a load balancer), the connection `remote_ip` is the *proxy* (e.g. Railway's `100.64.0.0/10`, Cloudflare ranges). The real client IP is in `X-Forwarded-For` / `X-Real-IP` (first hop). Always extract the forwarded IP, not the socket peer. Note any edge-region header (e.g. `X-Railway-Edge`) — it's a coarse geo proxy.

If no access-log source carries IP/UA, say exactly that, report whatever IS available (status/path mix), and recommend wiring a richer log (e.g. enable JSON access logging) before deep attribution.

## Step 2 — parse into structured records

Per request: timestamp, client IP (forwarded), method, path, status, latency, response size, User-Agent, Referer, edge region. Parse with `python3`. Note the actual time window and total count — and whether it's the *complete* retained buffer or a sample (platforms like Railway keep only a short rolling buffer; say so).

## Step 3 — classify every request

- **By intent (path):** legitimate vs scanner. Scanner families: WordPress (`/wp-admin`, `/wp-login`, `xmlrpc.php`, `wlwmanifest.xml`), PHP/webshell (`*.php` sprays), secret/dotfile (`/.env`, `/.git`, `credentials.json`, `/actuator/env`, `/api/config`), config probes, recon (`robots.txt`, `sitemap.xml`, `/old/`, `/wordpress/`).
- **By visitor (User-Agent):** browser (human), search bot (Googlebot/bingbot/etc.), AI bot (GPTBot, ClaudeBot, Google-Extended, xAI, PerplexityBot), SEO/scan bot (Ahrefs, Semrush, Censys, Shodan), social/unfurl, HTTP tool (curl/python-requests/okhttp), no-UA/URL-in-UA (headless scanners).

## Step 4 — attribute sources (where from)

For the top IPs (by request count) plus all human-classified IPs:

- **Reverse DNS (PTR):** `host -W 2 <ip>` in parallel — instantly reveals Googlebot (`*.googlebot.com`), Starlink/Cox/etc. residential ISPs, AWS/GCP/Azure, hosting/VPS, scanner orgs (`*.censys-scanner.com`).
- **ASN-by-prefix** for no-PTR IPs: `20.*` = Azure/MSFT, Cloudflare ranges (`104.16–31.*`, `172.64–71.*`, `162.158.*`), AWS, GCP (`*.bc.googleusercontent.com`).
- **RDAP** for org + country: `curl -sL https://rdap.org/ip/<ip>` → `name`, `country`. **Rate-limited** — do the top ~10–15 sequentially and accept partial results; don't hammer it. Prefer RDAP/PTR over third-party geo APIs (privacy: avoid shipping IPs to trackers).
- Use the **edge region** distribution as a coarse geographic signal for the whole population.

## Step 5 — write ONE artifact

`docs/network-log-<YYYY-MM-DD>.md` (respect the repo's gitignore conventions — if `docs/` is gitignored, that's the right local-only sink). Include: source + window + sample-size caveat; headline; intent breakdown; visitor-type breakdown; top source IPs table (IP, count, verdict, org, role, rDNS); legitimate/human traffic + referrers; geographic signal (edge regions); scanner campaigns; status/method mix; daily volume. Cite counts from the parsed data, not vibes. Note anything you capped or skipped (e.g. RDAP partial).

## Step 6 — suggest things (the point of the command)

Concrete, data-grounded recommendations, e.g.:

- **Scanner hardening:** probe paths that returned **200** (often an SPA-shell fallback) — give the exact server-config rule to 404 them (Caddyfile `respond @matcher 404`, nginx `location`, etc.).
- **SEO gaps:** `/robots.txt` or `/sitemap.xml` 404ing while real bots ask for them → point to `/apply-seo`.
- **Analytics gap:** if logs are the only traffic signal and the buffer is short, recommend a privacy-friendly counter or a log drain for retention.
- **Performance:** slow paths (high p95/p99), large responses, missing caching headers.
- **Abuse:** a single IP dominating with hostile paths → rate-limit / block suggestion.

Offer to apply the safe config patches (e.g. the scanner-404 rule) but **do not deploy** — leave that to `/shipit`.
