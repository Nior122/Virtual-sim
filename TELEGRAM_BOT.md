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
- `/checkvideos <slug>` — probe an existing profile's stored video URLs and
  report which ones have a real playable stream (read-only)

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
| `GROQ_API_KEY` | Groq key (optional when OpenRouter is set) |
| `GROQ_MODEL` | Optional, defaults to `llama-3.3-70b-versatile` |
| `OPENROUTER_API_KEY` | Optional OpenRouter key — automatic fallback writer |
| `OPENROUTER_MODEL` | Optional, defaults to `meta-llama/llama-3.3-70b-instruct` |
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
