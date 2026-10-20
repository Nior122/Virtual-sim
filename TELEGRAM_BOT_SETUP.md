# Telegram Bot Setup — Beginner Step-by-Step Guide (Cloudflare + Neon only)

Everything runs on **Cloudflare Pages** with a free **Neon** PostgreSQL
database. No Replit, no other server. No command line is required except the
optional git step in Part 2 — everything else is clicking through dashboards.
Budget about 45 minutes for the first run.

---

## Part 1 — The big picture (2 minutes)

```
Your Telegram app
      ↓ messages, photos, videos
Cloudflare Pages (runs the bot + your website, free plan)
      ├─ KV namespace  → stores half-finished profiles
      ├─ Groq API      → writes the profile text (OpenRouter as fallback)
      └─ Neon database → stores the finished profiles and their videos
```

Accounts you will need (all have free tiers):

| Service | What for | Sign up |
|---|---|---|
| GitHub | Holds the code Cloudflare deploys | github.com |
| Telegram | Your bot chat | telegram.org / the app |
| Groq | AI profile writing | console.groq.com |
| OpenRouter (optional) | Automatic fallback profile writer | openrouter.ai |
| Cloudflare | Runs the bot and website | dash.cloudflare.com |
| Neon | PostgreSQL database | neon.tech |

---

## Part 2 — Get the bot code onto GitHub

Cloudflare deploys code from GitHub, so the bot files must be merged to your
repository's default branch (`main`) first.

- **Easiest:** ask in Arena *"commit, push and open the pull request"*, then
  click **Merge pull request** on GitHub.
- Or from a terminal:
  ```bash
  git add .
  git commit -m "Add Telegram profile bot (Cloudflare + Neon)"
  git push origin HEAD
  ```
  then open the PR link GitHub prints and merge it.

Do not continue until the bot files (`functions/`, `src/lib/bot/`,
`src/lib/db/`, `prisma/neon-schema.sql`) are visible on your `main` branch.

---

## Part 3 — Create the Neon database (10 minutes)

1. Go to **https://neon.tech**, sign up, and click **New project**.
2. Name it `dream-babe`, pick the region closest to you, leave Postgres version
   as default, and click **Create**.
3. When the project opens you see a **Connection string** that looks like:
   ```
   postgresql://neondb_owner:xxxxxx@ep-cool-name-12345-pooler.aws.neon.tech/neondb?sslmode=require
   ```
   Copy it into your note as **DATABASE_URL**. (Use the **Pooled connection**
   string if Neon offers a choice.)
4. Create the tables:
   - In the Neon left menu click **SQL editor**.
   - Open the file `prisma/neon-schema.sql` from this repo, select all, copy.
   - Paste it into the Neon SQL editor and click **Run**.
   - You should see "Success". In the left menu **Tables** you now have
     `Persona` and `PersonaVideo`.
5. (Useful check) Click **Tables → Persona → Get SQL** — an empty table is
   fine; the bot fills it.

> The SQL file is idempotent: re-running it never damages existing data.

---

## Part 4 — Create the Telegram bot (3 minutes)

1. In Telegram, search **@BotFather** and press Start.
2. Send `/newbot`.
3. Choose a display **name** (anything, e.g. `Dream Babe Admin`).
4. Choose a **username** ending in `bot` (e.g. `dreambabe_profile_bot`).
5. BotFather replies with a token like `8123456789:AAH...`. Save it as
   **TELEGRAM_BOT_TOKEN**. Keep it private.

---

## Part 5 — Get your free Groq API key (2 minutes)

1. Go to **https://console.groq.com/keys** and sign up / log in.
2. Click **Create API Key**, name it `dream-babe-bot`.
3. Copy the key (starts with `gsk_`) as **GROQ_API_KEY** — it is shown once.

**Optional fallback:** create an **OpenRouter** account at
**https://openrouter.ai/keys**, make a key (starts with `sk-or-`) and save it
as **OPENROUTER_API_KEY**. If Groq is missing, rate-limited or fails, the bot
writes the profile through OpenRouter automatically — no other change needed.
You can use OpenRouter *instead* of Groq by leaving `GROQ_API_KEY` empty.

---

## Part 6 — Create (or open) the Cloudflare Pages project (10 minutes)

1. Go to **https://dash.cloudflare.com** and sign in.
2. Left menu → **Workers & Pages → Create → Pages tab → Connect to Git**.
3. Authorize GitHub if asked, then select your **Virtual-sim** repository.
   - If the project already exists (your `dreambabe.pages.dev` site), open it
     instead → **Settings → Builds & deployments**, verify the repo and
     production branch, then skip to Part 7.
4. **Begin setup** with these exact settings:

   | Setting | Value |
   |---|---|
   | Production branch | `main` |
   | Framework preset | None |
   | Build command | `npm run build` |
   | Build output directory | `dist` |
   | Root directory | leave empty |

5. Expand **Environment variables (advanced)** and add:
   - `NODE_VERSION` = `20`
6. Click **Save and Deploy** and wait for **Success** (1–3 minutes).
7. Copy your site URL (e.g. `https://dreambabe.pages.dev`) as
   **PUBLIC_BASE_URL**.

> From now on every push to `main` redeploys automatically.

---

## Part 7 — Create the KV namespace and bind it (5 minutes)

KV stores each chat's in-progress profile and the media allowlist.

1. Cloudflare left menu → **Storage & Databases → KV → Create a namespace**.
2. Name it `dreamgirl-bot-kv` and confirm.
3. Go to **Workers & Pages**, open your Pages project →
   **Settings → Bindings → Add binding → KV namespace**.
4. Enter **exactly**:
   - Variable name: `BOT_KV` (case-sensitive)
   - KV namespace: `dreamgirl-bot-kv`
5. Save for the **Production** environment.

---

## Part 8 — Add the secrets (5 minutes)

1. Pages project → **Settings → Environment variables**, select **Production**.
2. Add each variable with **Add variable** (choose **Secret/Encrypted** for
   token, key, webhook secret and database URL):

   | Variable name | Type | Value |
   |---|---|---|
   | `TELEGRAM_BOT_TOKEN` | Secret | token from Part 4 |
   | `TELEGRAM_WEBHOOK_SECRET` | Secret | invent a long random string, e.g. `whsec_9fK2xP7mQ4vL8nR1` |
   | `GROQ_API_KEY` | Secret | `gsk_...` key from Part 5 (or leave empty with OpenRouter) |
   | `DATABASE_URL` | Secret | Neon connection string from Part 3 |
   | `PUBLIC_BASE_URL` | Plaintext | your Pages URL, no trailing slash |
   | `GROQ_MODEL` | Plaintext | `llama-3.3-70b-versatile` |
   | `OPENROUTER_API_KEY` | Secret, optional | `sk-or-...` key from Part 5 |
   | `OPENROUTER_MODEL` | Plaintext, optional | `meta-llama/llama-3.3-70b-instruct` |

3. Save. Then open **Deployments**, click the **⋯ menu** on the latest
   deployment → **Retry deployment** so the variables take effect.

---

## Part 9 — Connect Telegram to Cloudflare (the webhook, 2 minutes)

1. Build this URL by replacing the three bold parts, all on one line:
   ```
   https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://<YOUR-PAGES-DOMAIN>/api/telegram-bot&secret_token=<TELEGRAM_WEBHOOK_SECRET>
   ```
   Real example:
   ```
   https://api.telegram.org/bot8123456789:AAHabc.../setWebhook?url=https://dreambabe.pages.dev/api/telegram-bot&secret_token=whsec_9fK2xP7mQ4vL8nR1
   ```
2. Paste it into your browser address bar and press Enter.
3. You should see `"ok":true` in the reply.
4. Verify with (replace the token):
   ```
   https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo
   ```
   Expect your webhook URL, `"pending_update_count":0`, and no
   `last_error_message`.

---

## Part 10 — Verify the database connection (1 minute)

Open this URL in your browser (use your real domain):

```
https://YOUR-PAGES-DOMAIN/api/personas
```

- You should see a **JSON array** (empty `[]` is normal before your first
  profile). That proves Pages can read Neon.
- If you instead see an HTML webpage or a 500 error message, check
  `DATABASE_URL` in Part 8 and redeploy.

This also fixes the site itself: profiles created by the bot now appear on
your live explore and profile pages, and the sitemap function picks them up.

---

## Part 11 — Create your first profile with the bot (5 minutes)

In your Telegram bot chat:

1. `/start` — the help text appears.
2. `/newprofile` — a fresh draft starts.
3. Send **photos in order**:
   1st = profile picture, 2nd = cover, next up to 5 = gallery (7 total max).
4. Send a **short video (under 20 MB)** or paste a direct video URL such as
   `https://cdn.example.com/clip.mp4`. Direct MP4/WebM and HLS links both play
   on Pages through the built-in playback proxy.
5. Send your **write-up** as ordinary messages, e.g.
   *"24-year-old barista in Toronto, warm and witty, loves jazz and hiking,
   flirty texting style."* Multiple messages combine automatically.
6. Optional: `/scrape https://example.com/some-profile` — or
   `/scrape https://example.com/some-profile 30 5` to ask for up to 30 videos
   while following up to 5 paginated pages. Only **JPEG** images are
   imported (PNG, SVG logos, webp/gif thumbnails, icons and sprites are
   dropped),
   and videos are also read out of the page's inline script data, so one call
   usually finds every clip on the listing.
   - Video count: **all it can find by default (maximum 50)**; pass a smaller
     number to limit it, e.g. `/scrape <url> 10`.
   - Pages: default 5, hard maximum 10 — each extra page costs another
     subrequest and CPU time inside one Function invocation, and Workers has
     limits on both.
   - Infinite-scroll or JavaScript-only pagination can't be followed. Paste
     the individual page links as normal messages instead — every link is
     scraped and **merged into the same draft** (duplicate images/videos are
     removed, page counts add up, the newest title/description wins). You can
     also use `/image <url>` or `/video <url>` to force a direct link in.
7. `/status` — review what's collected (it shows pages, images and videos
   from scrapes).
8. `/links` — optional: list every image and video URL the draft will use.
9. `/preview` — the AI writes the full profile (Groq, or OpenRouter if Groq
   is unavailable); use `/setname` or `/setslug` to adjust, then `/preview`
   again. The preview also lists the image URLs and video URLs it will use.
10. `/confirm` — the bot writes the persona and all videos into Neon and
    replies with the live link `https://YOUR-DOMAIN/dreamgirl/<slug>` plus the
    exact image/video URLs it stored. Embed players are resolved to their real
    stream first; anything with no playable stream is skipped and reported.
11. Open that link, and start a call to confirm the videos play.

### Changing a profile later (add / replace / delete media)

1. `/edit <slug>` — the bot replies with the current images and videos,
   numbered.
2. Add material: send photos or video files, paste direct links, or paste a
   profile page link to scrape it — everything is appended to that profile's
   draft.
3. Change or delete: `/replaceimage 1 <jpeg url>`, `/replacevideo 2 <url>`,
   `/removeimage 3`, `/removevideo 1`, `/clearvideos`.
4. `/save` — writes the changes to Neon and replies with the final lists.
   `/cancel` discards them instead. Text fields (bio, personality, etc.) are
   not changed by edit mode.

---

## Part 12 — Troubleshooting

| Symptom | Cause & fix |
|---|---|
| Bot never replies | Open the `getWebhookInfo` URL (Part 9). Its `last_error_message` names the problem — usually a wrong domain or webhook secret. |
| `Unauthorized` in webhook errors | The `secret_token` in Part 9 doesn't equal the `TELEGRAM_WEBHOOK_SECRET` variable. Make them identical and re-run Part 9. |
| Groq error on `/preview` | `GROQ_API_KEY` missing, mistyped or invalid. Fix the variable and redeploy (Part 8, step 3). If `OPENROUTER_API_KEY` is set the bot silently falls back to OpenRouter; "No AI provider configured" means **both** keys are missing. |
| `/confirm` says "Database rejected…" | Usually the Neon tables don't exist yet — re-run `prisma/neon-schema.sql` in the Neon SQL editor — or `DATABASE_URL` is wrong. |
| `/api/personas` returns HTML or 500 | Pages can't reach Neon. Verify `DATABASE_URL`, confirm the SQL schema ran, then redeploy. |
| New profile missing from the website | Hard-refresh the explore page; the read endpoint caches for 60 seconds. If still missing, check Functions logs (below). |
| Broken images/videos on the profile | Pages project → **Observability → Functions** logs while loading; a 404 on `/api/media/...` means the `BOT_KV` binding is missing (Part 7) or the media wasn't sent through the bot. |
| Video over 20 MB rejected | Telegram bots can't download bigger files — send it as a direct URL instead. |
| Embed/HLS video doesn't play on Pages | The Express-only `/api/hls-proxy` route doesn't exist on Pages. Use direct `.mp4`/`.webm` URLs or bot-uploaded files. |
| `/scrape` says blocked or no data | The page uses a browser/Cloudflare challenge or renders only in JavaScript, which a Worker can't load. Send the media and write-up manually. |
| `/scrape` returns few images | Only JPEG photos are imported; PNG, SVG logos, webp/gif thumbnails, icons and sprites are filtered out on purpose. |
| A copied image link is refused | The bot only accepts `.jpg/.jpeg`. Convert the file to JPEG and send it again. |
| `/edit` says "No active profile with slug …" | The slug must match the profile link (`/dreamgirl/<slug>`). Inactive/deleted profiles cannot be edited. |
| `/save` removed videos I wanted | `/save` deletes video rows you removed with `/removevideo`/`/clearvideos`. Nothing is changed until `/save`, so `/cancel` always restores the live profile. |
| Want to know why a profile's videos won't play | Send `/checkvideos <slug>` in the bot: it probes every stored URL and says whether a playable stream was found (read-only, changes nothing). |
| Video shows a black frame / never starts | The call screen plays remote videos through `/api/video-proxy` and `/api/hls-proxy`; check Pages → Observability → Functions logs for a 4xx/5xx from those routes. Sources that never expose a real stream (login-walled players) cannot be resolved. |
| `/scrape` stops after a few pages | Default is 5 pages, hard max 10 (Workers subrequest/CPU limits). Scrape more page URLs separately — they merge into the same draft. |
| `/scrape` misses an infinite-scroll gallery | A Worker can't scroll or run the page's JavaScript. Copy the individual page links and `/scrape` them one by one. |
| Variable changes seem ignored | Variables load only on a fresh deploy: **Deployments → ⋯ → Retry deployment**. |

### Live logs

Pages project → **Observability → Functions** (or **Functions → Logs**)
shows every Telegram message and database error in real time.

### Updating later

Push to `main` — Cloudflare rebuilds and redeploys automatically. Secrets and
the KV binding are configured once and survive redeploys.
