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

**If you only ever see "Preview" deployments**, the project's *Production
branch* is not `main` — that is a dashboard setting, not a code problem, and a
merge will build a preview instead of the live site. Fix it in
**Settings → Builds & deployments → Production branch → `main`**, then retry
the deployment. Part 6b makes this automatic.

---

## Part 6b — Deploy from GitHub Actions (optional, makes production reliable)

The repository ships `.github/workflows/deploy-pages.yml`. On every push to
`main` it type-checks, builds and uploads `dist/` **plus the `functions/`
directory** straight to your Pages project, and it pins the project's
production branch to `main` first. It removes the dashboard setting as a
failure mode: a merge can no longer silently build a *preview* while the live
site keeps running old code.

1. Create a Cloudflare API token: **My Profile → API Tokens → Create Token →
   Custom token**, permission **Account → Cloudflare Pages → Edit**.
2. Add repository secrets (**Settings → Secrets and variables → Actions**):

   | Secret | Value |
   |---|---|
   | `CLOUDFLARE_API_TOKEN` | the token from step 1 |
   | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → account ID (right sidebar, or any zone's overview) |

3. Optional: add a repository **variable** `CLOUDFLARE_PROJECT_NAME` if your
   Pages project is not called `dreambabe`.
4. Merge anything to `main` (or run the workflow manually from the **Actions**
   tab) and check the run. The deployment should appear in Pages with a
   **Production** badge.

Until both secrets exist the workflow logs a warning naming the missing one and
skips the deploy (the run stays green), so the dashboard integration keeps
working and `main` is not left with a red check. Secrets and the KV binding on
the Pages project are untouched by this workflow.

> You can keep or remove the dashboard Git integration; if both are connected,
> the last deploy of the same commit wins — the content is identical.

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
   | `GROQ_API_KEY` | Secret | `gsk_...` key from Part 5 (or leave empty with another provider) |
   | `GROQ_MODEL` | Plaintext | the model ID exactly as Groq lists it (console.groq.com/docs/models) |
   | `DATABASE_URL` | Secret | Neon connection string from Part 3 |
   | `PUBLIC_BASE_URL` | Plaintext | your Pages URL, no trailing slash |
   | `OPENROUTER_API_KEY` | Secret, optional | `sk-or-...` key from Part 5 |
   | `OPENROUTER_MODEL` | Plaintext, optional | the model ID exactly as OpenRouter lists it |
   | `OPENAI_API_KEY` + `OPENAI_MODEL` | Optional | any other OpenAI-compatible gateway; `AI_API_KEY`/`AI_MODEL`/`AI_BASE_URL` aliases work |
   | `AI_PROVIDER_ORDER` | Plaintext, optional | attempt order, default `groq,openrouter,openai` |

   > **Model IDs are never hardcoded.** A provider is used only when **both**
   > its key and its model variable are set; otherwise it is skipped and
   > `/chatcheck` says which variable is missing. Set `GROQ_MODEL` and
   > `OPENROUTER_MODEL` explicitly — they no longer have built-in defaults.

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
   `/scrape https://example.com/some-profile 30 5 4` to ask for up to 30
   videos across 5 paginated pages while opening up to 4 individual post
   pages. Post pages matter because many sites only show the real image
   after you click a thumbnail, so the scraper opens them and takes the
   image from there. Only **JPEG** images are imported (PNG, SVG logos,
   webp/gif thumbnails, icons and sprites are dropped), and URLs without a
   `.jpg` suffix are still accepted when the server returns `image/jpeg`.
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
   from scrapes). `/profiles` lists every profile with its slug, image count
   and video count.
8. `/links` — optional: list every image and video URL the draft will use.
9. `/preview` — the AI writes the full profile (Groq, or OpenRouter if Groq
   is unavailable); use `/setname` or `/setslug` to adjust, then `/preview`
   again. The preview also lists the image URLs and video URLs it will use.
10. `/confirm` — the bot writes the persona and all videos into Neon and
    replies with the live link `https://YOUR-DOMAIN/dreamgirl/<slug>` plus the
    exact image/video URLs it stored. Embed players are resolved to their real
    stream first; anything with no playable stream is skipped and reported.
11. Open that link, and start a call to confirm the videos play.

### Creating several profiles at once (bulk)

1. Send `/bulk` (the bot waits for your list) — or `/bulk <list>` directly.
2. Paste one entry per line, or separate entries with commas:
   ```
   https://site.com/ava
   https://site.com/mia & https://site.com/mia/videos
   ```
   One URL per entry means images **and** videos come from it. `A & B` means
   images from A and videos from B (`images: … videos: …` also works).
   Direct files are accepted too:
   `https://cdn.site/ava-01.jpg & https://cdn.site/ava-clip.mp4`.
3. The bot scrapes each entry and replies with a **preview** — nothing is created
   yet. Check the names, slugs and counts, and send `/previewall` to read the
   full write-ups plus every image and video URL it will use.
4. Send `/confirm` to create all of them, `/confirm 1,3` to create only some,
   `/skip <n>` to drop one, or `/bulkcancel` to throw the batch away.
5. Up to 25 entries per batch, prepared 6 at a time — `/bulknext` prepares the
   rest into the same preview. `/confirm` also creates up to 6 per call and
   tells you how many are still pending. `/profiles` lists everything;
   `/edit <slug>` fixes any of them.

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
| Scrape finds no images (again) | Run `/diag <that url>`: it shows the HTTP status, `<img>` count, the candidate URLs and whether each is served as JPEG. If candidates say `NOT a JPEG ✗`, the site only has WebP/PNG; if there are 0 candidates, the page is JavaScript-built. Paste the report to get an exact fix. |
| Chat gives generic / unrelated answers | Run `/chatcheck <slug> what's your name?`. It lists the configured providers and their model IDs, then the engine that answered. `Engine: Dreamgirl Engine` means nothing answered — usually a missing `GROQ_MODEL`/`OPENROUTER_MODEL` (no model defaults exist any more) or an invalid key. |
| `/chatcheck` says "«PROVIDER»_MODEL is not set" | Model IDs come only from the environment. Add `GROQ_MODEL` / `OPENROUTER_MODEL` (or `OPENAI_MODEL`) with the exact model ID from the provider, then redeploy. |
| Is the live site running the new code? | Open `https://<your-site>/api/health`. The `features` list is served by the deployed Functions; if it is missing or short, production is still on an older build (see the preview-only deployment row below). |
| `/scrape` says blocked or no data | The page uses a browser/Cloudflare challenge or renders only in JavaScript, which a Worker can't load. Send the media and write-up manually. Coomer/Kemono are the exception: those links are read through their JSON API, so they work even though the listing is JavaScript-built. |
| Coomer/Kemono link returns `Creator "x" does not exist` | The user name in the link is misspelled (a trailing `.......` is stripped automatically). The API answered 404 for every endpoint shape, so the creator really is not on that site. |
| A scraped image used to show as broken | Scraped URLs are now verified before they are stored: a `.jpg` URL that answers 404/HTML is dropped, and coomer/kemono fall back from the full-size mirror to the site's own JPEG thumbnail. |
| `/scrape` returns few images | Only JPEG photos are imported; PNG, SVG logos, webp/gif thumbnails, icons and sprites are filtered out on purpose. The reply says how many image URLs were seen and rejected. Raise the post-page count (`/scrape <url> 50 5 6`) if the images sit inside posts. |
| `/scrape` finds no images at all | The page may serve only WebP/PNG (convert or use `/image <jpeg url>`), or the main image is behind JavaScript. Try increasing post pages. |
| A copied image link is refused | The bot only accepts `.jpg/.jpeg`. Convert the file to JPEG and send it again. |
| `/bulk` skips an entry | That page had no usable images. The preview line says whether URLs were rejected as WebP/PNG or none were served as `image/jpeg`. Point that entry at a page with `.jpg` photos, or add `& <video page>` for the video half. |
| Bulk stopped halfway | Only a few entries are prepared per webhook call — send `/bulknext` to prepare the rest, then `/confirm` again. |
| `/confirm` after a bulk preview creates nothing | The preview must still be pending: `/status` lists it. `/newprofile` or `/bulkcancel` discards a preview on purpose. |
| Long bot replies arrive in pieces | Replies over 4096 characters are split automatically (Telegram's limit); a missing final message was previously a silent `message is too long` error. |
| Every profile chats the same / says "Dream Babe" | Fixed: `/api/chat` now loads the persona (name, personality, speaking style, `systemPrompt`) from Neon by id. Redeploy so the new Function is live. |
| Confirmation link does nothing when tapped | `PUBLIC_BASE_URL` must include `https://`. The bot now adds the scheme automatically if it is missing — set the variable to `https://<project>.pages.dev` and redeploy. |
| `/edit` says "No active profile with slug …" | The slug must match the profile link (`/dreamgirl/<slug>`). Inactive/deleted profiles cannot be edited. |
| `/save` removed videos I wanted | `/save` deletes video rows you removed with `/removevideo`/`/clearvideos`. Nothing is changed until `/save`, so `/cancel` always restores the live profile. |
| Want to know why a profile's videos won't play | Send `/checkvideos <slug>` in the bot: it probes every stored URL and says whether a playable stream was found (read-only, changes nothing). |
| Video shows a black frame / never starts | The call screen plays remote videos through `/api/video-proxy` and `/api/hls-proxy`; check Pages → Observability → Functions logs for a 4xx/5xx from those routes. Sources that never expose a real stream (login-walled players) cannot be resolved. |
| `/scrape` stops after a few pages | Default is 5 pages, hard max 10 (Workers subrequest/CPU limits). Scrape more page URLs separately — they merge into the same draft. |
| `/scrape` misses an infinite-scroll gallery | A Worker can't scroll or run the page's JavaScript. Copy the individual page links and `/scrape` them one by one. |
| Variable changes seem ignored | Variables load only on a fresh deploy: **Deployments → ⋯ → Retry deployment**. |
| Only **Preview** deployments appear after a merge | The Pages project's *Production branch* is not `main`. Settings → Builds & deployments → Production branch → `main`, then retry the deployment. Part 6b automates this. |
| Deploy workflow says "Skipping the Pages deploy — missing secret(s)" | Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` under Settings → Secrets and variables → Actions (Part 6b, step 2), then re-run the workflow. |
| Deploy workflow fails: authentication error | The token lacks **Cloudflare Pages: Edit**, or it belongs to a different account than `CLOUDFLARE_ACCOUNT_ID`. |
| Live site runs old code after a merge | Check Pages → Deployments for a **Production** deployment of that commit. A preview-only deploy means the production branch is wrong (row above). |

### Live logs

Pages project → **Observability → Functions** (or **Functions → Logs**)
shows every Telegram message and database error in real time.

### Updating later

Push to `main` — Cloudflare rebuilds and redeploys automatically (or the GitHub
Actions workflow from Part 6b does, if you set it up). Secrets and the KV
binding are configured once and survive redeploys.

After a deploy, check that the newest deployment has a **Production** badge and
the right commit. If it says **Preview**, Part 6b / the Production branch
setting is the reason.
