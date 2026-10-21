# Telegram Profile Bot

A Cloudflare Pages Function that turns a Telegram bot into a profile-creation
agent for Dream Babe personas. You send photos, videos (or video URLs) and
write-ups; the bot uses **Groq** to draft every persona field, then writes the
finished profile straight into **Neon PostgreSQL** — no Express server is
involved in the bot's path.

```
Telegram chat ──webhook──▶ Pages Function (/api/telegram-bot)
                                │
                ┌───────────────┼────────────────────┐
                ▼               ▼                    ▼
            KV (drafts)     Groq (writing)     Neon Postgres (persisted
                │                               personas + videos)
                ▼
        Telegram getFile ◀── /api/media/<fileId> proxy (token stays
                                server-side; Range requests supported)
```

## Components

| Path | Role |
|---|---|
| `functions/api/telegram-bot.ts` | Webhook entry point, Telegram secret-token check |
| `functions/api/media/[fileId].ts` | Public media proxy for bot-registered Telegram files |
| `functions/api/personas.ts` | Public catalog read from Neon (replaces Express route) |
| `functions/api/personas/[slug].ts` | Public single-profile read with videos from Neon |
| `src/lib/bot/` | Bot engine: handler, Groq writer, scraper, KV store, repo |
| `src/lib/db/neon.ts` | Shared Neon serverless data layer (reads + writes) |
| `prisma/neon-schema.sql` | Idempotent DDL matching `prisma/schema.prisma` |

## What it does with your material

| Input | Result in the created persona |
|---|---|
| 1st photo | `profileImage` |
| 2nd photo | `coverImage` |
| 3rd–7th photo (up to 5) | `gallery` (comma-separated URLs) |
| Video files / video URLs / scraped videos | `PersonaVideo` rows → the call screen |
| Write-up text (+ scraped text) | Groq-generated `description`, bios, `personality`, `background`, `interests`, `speakingStyle`, `flirtLevel`, `systemPrompt`, etc. |
| `/scrape <url> [video count] [max pages]` | Best-effort extraction of title, description, JPEG images and videos (including paginated pages) from a public profile |

## Chat commands

- `/newprofile` — start a fresh draft
- send photos, videos, video URLs, and write-up text in any order
- `/scrape https://example.com/profile` — pull reference data from a page
  (all videos it can find, up to 50)
- `/scrape https://example.com/profile 30 5` — only 30 videos, across at most
  5 paginated pages (video count max 50, pages default 5, hard max 10)
- `/scrape https://example.com/profile 30 5 4` — the third number is how many
  individual post pages to open (default 4, max 6), which is where many sites
  keep the real image behind a thumbnail
- paste any profile link as a normal message — it is scraped and **merged**
  into the draft that is already open (no `/scrape` needed, no `/newprofile`)
- `/image <url>` and `/video <url>` — force-add a direct JPEG or video link
  when a URL is ambiguous
- `/links` — list every image and video URL currently in the draft
- `/profiles [page]` — every profile with its slug plus image and video counts
  (20 per page), e.g. `Ava — slug: ava · 5 image(s) · 12 video(s)`
- `/bulk <list>` — scrape many pages at once and prepare one profile per entry
  (see below); `/bulknext` prepares the rest of the queue, `/confirm` creates
  them, `/bulkcancel` drops the batch
- `/diag <url>` — what the scraper sees on a page: HTTP status, `<img>` count,
  candidate image URLs and whether each is really served as JPEG
- `/chatcheck <slug> [question]` — ask a stored profile a question outside the
  call screen and see which engine answered (Groq, OpenRouter or the offline
  fallback) plus the raw reply
- `/health` in a browser: `https://<your-site>/api/health` lists the deployed
  features, so you can confirm the live site runs the latest code


### Bulk generation

```
/bulk
https://site.com/ava
https://site.com/mia & https://site.com/mia/videos
images: https://site.com/zoe  videos: https://site.com/zoe/clips
```

- `/bulk` on its own waits for the next message, so a long list can be pasted
  as-is. `/bulk <list>` works in one message too.
- **Separators:** newline, comma, semicolon or `|` between entries. A separator
  only splits when a URL follows it, so `?a=1&b=2` query strings are safe.
- **One URL per entry** → images *and* videos are scraped from that page.
- **`A & B`** (or `images: A videos: B`) → images from A, videos from B.
- Either half can be a **direct file**: `https://cdn/ava-01.jpg` and
  `https://cdn/clip.mp4` are used as-is, no page fetch needed — so an entry can
  be exactly "the image URL & the video URL".
- Up to **25 entries** per batch; 6 are prepared per call within a subrequest
  budget. Send `/bulknext` to prepare the rest.
- Links to **your own site** (`/dreamgirl/<slug>`, `/call/<slug>`) are read
  straight from Neon instead of being scraped, because the site renders in the
  browser.

#### Nothing is created until you confirm

`/bulk` stops at a preview — no database writes happen while scraping:

```
Bulk preview (3 ready, 1 failed)

1. Ava — slug: ava
   6 image(s) · 4 video(s)
2. Mia — slug: mia
   3 image(s) · 2 video(s) · 1 video(s) skipped
3. Zoe — slug: zoe
   5 image(s) · 0 video(s) · text fallback

4. ✗ https://site.com/x
   no JPEG images found

Send /confirm to create all 3, /confirm 1,3 to pick, /previewall for full
write-ups and URLs, /skip <n> to drop one, /cancelbulk to discard.
```

| Command | What it does |
| --- | --- |
| `/confirm` | Create **every** prepared profile (up to 6 per call) |
| `/confirm 1,3` | Create only those positions |
| `/confirmall` | Same as `/confirm` |
| `/previewall` | Full write-up plus every image and video URL for the batch |
| `/preview <n>` | Same, for one prepared profile |
| `/bulknext` | Prepare the next 6 queued entries into the same preview |
| `/skip <n>` | Drop a prepared profile without creating it (`/skip all` clears them) |
| `/bulkcancel` | Discard the queue and the preview — nothing is created |
| `/status` | Shows the prepared batch as well as the single draft |

- Slugs shown in the preview are **not reserved**; at confirm time a taken slug
  gets a numeric suffix (`ava-2`), exactly like the single-profile flow.
- `/newprofile` discards a pending bulk preview, so `/confirm` can never create
  the wrong thing.
- A prepared batch is kept in KV (`bulkreview:<chatId>`) for the same TTL as a
  draft, so you can review and confirm later.
- If the AI provider is unavailable, the profile is still prepared from the
  scraped title/description and marked `text fallback`.
- `/checkvideos <slug>` — probe an existing profile's stored video URLs and
  report which ones have a real playable stream (read-only)

### When a scrape finds no images

The reply distinguishes the causes:

| Reply | Meaning | Fix |
|---|---|---|
| `N image URL(s) were rejected…` | the page only offers WebP/PNG, or the JPEG links are dead | the bot already retries `x.webp` → `x.jpg` and `?fm=jpg`, and drops every URL that does not answer as a real JPEG; only working images are stored |
| `no JPEG images found` with 0 candidates | no image markup at all | the page is built by JavaScript — copy a post/gallery link, or run `/diag <url>` |
| `The site blocked the request (HTTP 403)` | bot protection | not scrapable from a Worker |
| `Creator "x" does not exist on coomer.st … Check the spelling` | the link has a typo, or trailing dots were pasted | trailing punctuation is stripped automatically; compare the user name with the site |

### Coomer and Kemono links

`coomer.st` / `kemono.cr` (and their mirrors) render their listings in the
browser, so scanning the HTML finds nothing. Those links are read through the
site's own JSON API instead — one of every post's photo, every attachment and
every video:

```
/scrape https://coomer.st/onlyfans/user/lanzii
→ full-size https://n1.coomer.st/data/1e/ea/1e…jpg first,
  the site's own thumbnail https://img.coomer.st/thumbnail/data/1e/ea/1e…jpg
  as the fallback when the full-size mirror does not answer
```

Each candidate is verified before it is stored, so a dead mirror falls back to
the thumbnail instead of producing a broken image. A trailing-dots paste
(`…/user/lanzii.......`) is cleaned before it is parsed.

`/diag <url>` prints what the scraper sees, so an empty scrape can be explained
instead of guessed:

```
Diagnostics for https://site.com/models/ava
HTTP 200 · text/html; charset=utf-8 · 184 KB
Title: Ava — Model
<img> tags: 24 · <source> tags: 3
Image candidates: 12 usable · 8 WebP/PNG

Candidates found:
1. https://cdn.site.com/media/9f2a…/1280
   served as JPEG ✓

WebP/PNG only (rejected, JPEG variant will be tried):
• https://cdn.site.com/media/aa11….webp
```

For a coomer/kemono link it also reports the API answer:

```
Archive API: onlyfans/lanzii
  50 post(s) · 100 image URL(s) · 12 video URL(s) · full-size first, thumbnail fallback
1. https://n1.coomer.st/data/1e/ea/1e…jpg
2. https://img.coomer.st/thumbnail/data/1e/ea/1e…jpg
```

### Checking the chat engine

`/chatcheck ava what's your name?` asks the stored profile a question exactly
as the call screen would, and reports the engine:

```
Chat check for Ava (/ava)
Question: what's your name?

Engine reply: Ava, nice to meet you 😊
Call screen shows: Ava, nice to meet you 😊

Engine: Groq (your-configured-model) · 640 ms

Providers (from env, no model IDs hardcoded):
  • Groq — your-configured-model (primary)
  • OpenRouter skipped: OPENROUTER_MODEL is not set (model IDs come from the environment only)
```

If it says `Engine: Dreamgirl Engine`, **no AI provider answered** — every chat
is falling back to canned lines. The provider list above the engine line names
the missing variable, usually `GROQ_MODEL`/`OPENROUTER_MODEL`: model IDs are
read from the environment only and have no built-in defaults, so both the key
**and** the model must be set on the Pages project, then redeploy.

### Editing an existing profile

```
/edit ava                     # or /edit https://<site>/dreamgirl/ava
send photos / videos / links  # new material is appended to the profile
/replaceimage 2 https://…/cover.jpg
/removevideo 3
/clearvideos
/save                         # write the changes to Neon
```

- `/removeimage <n>`, `/replaceimage <n> <url>`, `/removevideo <n>`,
  `/replacevideo <n> <url>` work on the same 1-based numbering that `/links`
  shows, so you can always see exactly what you are changing.
- Anything you send while editing (`/scrape`, a pasted profile link, a direct
  video/JPEG URL, an uploaded photo or video file) is appended to the loaded
  profile instead of starting a new draft.
- `/save` rewrites `profileImage`/`coverImage`/`gallery` and diffs the
  `PersonaVideo` rows: kept rows are updated in place, missing ones deleted,
  new ones inserted. Embed players are resolved to their real stream first.
- `/preview` in edit mode only lists what `/save` would write (text fields are
  not touched); `/cancel` throws the edit away without changing the profile.
- `/preview` — Groq writes the full profile; shows the summary
- `/setname <name>`, `/setslug <slug>` — override generated values
- `/status` — inspect the current draft
- `/confirm` — write the profile and every video into Neon
- `/cancel` — discard the draft

## Environment variables / secrets

Set in Pages → project → Settings → Environment variables (Production):

| Variable | Purpose |
|---|---|
| `TELEGRAM_BOT_TOKEN` | BotFather token |
| `TELEGRAM_WEBHOOK_SECRET` | Random string, also passed to `setWebhook` |
| `GROQ_API_KEY` | Groq key (optional when another provider is set) |
| `GROQ_MODEL` | **Required for Groq** — model ID from the Groq console |
| `OPENROUTER_API_KEY` | Optional OpenRouter key — automatic fallback |
| `OPENROUTER_MODEL` | **Required for OpenRouter** — model ID from OpenRouter |
| `OPENAI_API_KEY` + `OPENAI_MODEL` | Optional any OpenAI-compatible gateway (`AI_*` aliases) |
| `AI_PROVIDER_ORDER` | Optional attempt order, default `groq,openrouter,openai` |

> No model ID is hardcoded anywhere. A provider is skipped (and reported in
> `/chatcheck`) when its key or its model variable is missing.
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `PUBLIC_BASE_URL` | Public Pages URL (optional; falls back to request origin) |

KV binding: namespace `BOT_KV` bound under Settings → Bindings.

## Database

- Tables are created by running `prisma/neon-schema.sql` in the Neon SQL
  editor (idempotent). Column/table names match Prisma exactly.
- Raw inserts supply an explicit UUID (`crypto.randomUUID()`) and both
  timestamps, because Prisma's `uuid()` / `@updatedAt` are application-side.
- Public reads never select `systemPrompt`.

## Constraints & design notes

- **Telegram's Bot API can only download files up to 20 MB.** Send larger
  videos as direct URLs (`.mp4`, `.webm`, HLS/embed links).
- **Media is proxied, not hotlinked.** Persona records store
  `https://<pages-domain>/api/media/<file_id>`; the Function resolves the real
  Telegram file server-side with the bot token and forwards `Range` requests.
  Telegram file IDs remain valid for the bot's lifetime.
- **Scraping is best-effort.** Workers cannot run a headless browser, so pages
  behind Cloudflare browser checks or pure-JavaScript SPAs return a clear
  error. Static HTML, OpenGraph tags and JSON-LD work well.
- **Images are found even without a `.jpg` in the URL.** OpenGraph,
  JSON-LD, `<img>`, `<source srcset>` (largest size), lazy-load attributes
  (`data-src`, `data-original`, `data-srcset`, …), `poster`, CSS
  `background-image` and `data-bg*` thumbnails are all collected, and
  extensionless CDN URLs are verified with a content-type probe (max 12 probes
  per scrape). Only URLs the server actually serves as `image/jpeg` are kept.
- **Post pages are opened for hidden main images.** Scrapes follow up to
  `detailPages` (default 4, max 6) same-site post/gallery links and pull the
  images and clips from those pages too — that is what fixes sites where the
  main photo only appears after clicking a thumbnail.
- **Only JPEG images are imported.** PNG/WebP/GIF thumbnails, SVG logos and
  icons, sprites, favicons and placeholder graphics are discarded (and a
  non-JPEG link pasted in chat is refused with a message), so a scrape
  returns the real profile photos and nothing else.
- **Video URLs are also read from inline script JSON** (`window.__DATA__` and
  similar state blobs), which is where most sites keep their clip URLs. That
  is why one scrape can now find many videos instead of only the OpenGraph
  one.
- **Pagination is followed up to a hard cap.** `/scrape <url> <videos> <pages>`
  follows `rel="next"`, "Next/Older/More" links and numbered pagination.
  Pages default to 5 and the hard maximum is 10: every extra page is another
  subrequest and more CPU time in a single invocation, and the free Workers
  plan has strict limits on both.
- **Some pagination cannot be followed.** Infinite scroll and pagination that
  only exists after JavaScript runs cannot be crawled by a Worker. Scrape the
  individual page URLs instead — repeated `/scrape` calls merge into the same
  draft (images, videos and source URLs are deduplicated, page counts add up)
  and the latest title/description wins.
- **Bot profile writing falls back to OpenRouter.** With both keys set, Groq is
  tried first and OpenRouter is used automatically if it is missing, errors,
  or returns unusable JSON.
- **Existing profiles are edited in place.** `/edit <slug>` loads a published
  profile's media into a draft; `/save` applies the diff (images rewritten,
  video rows updated/deleted/inserted) without touching text fields, the slug
  or the persona's id.
- **Everything lands in one draft until `/confirm`.** Photos, videos, video
  URLs and pasted links all accumulate in the same per-chat draft; adding
  material after `/preview` simply invalidates the preview so you can
  regenerate it. `/newprofile` is what starts over.
- **Video playback is proxied.** The call screen loads remote media through
  the Pages Functions `/api/video-proxy` (Range-aware, adds a Referer for
  hotlink-protected CDNs) and `/api/hls-proxy` (resolves HTML embed players
  to their real stream and rewrites m3u8 playlists). That is why videos play
  even when the origin blocks direct hotlinking. Telegram uploads stay on
  `/api/media/<file_id>`.
- **Slug uniqueness** is checked against Neon; collisions get an automatic
  `-2`, `-3` suffix.
- Drafts are per Telegram chat and expire after 24 hours. Only file IDs the
  bot itself registered are served by the media proxy.
- The Express `createPersonaSchema` in `server.ts` was also extended with the
  full field set, so the same payloads remain valid if the Express server is
  ever hosted again.
- The playback proxies now exist on Pages too (`functions/api/video-proxy.ts`,
  `functions/api/hls-proxy.ts`, `functions/api/resolve-video-stream.ts`), so
  embed and HLS URLs work on the static deployment exactly like they used to
  on Express. Keep `PUBLIC_BASE_URL` pointed at the production domain.
