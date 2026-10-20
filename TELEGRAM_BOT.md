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
| `/scrape <url> [video count] [max pages]` | Best-effort extraction of title, description, JPEG/PNG images and videos (including paginated pages) from a public profile |

## Chat commands

- `/newprofile` — start a fresh draft
- send photos, videos, video URLs, and write-up text in any order
- `/scrape https://example.com/profile` — pull reference data from a page
- `/scrape https://example.com/profile 30 5` — ask for up to 30 videos across
  up to 5 paginated pages (video count max 50, pages default 5, hard max 10)
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
- **Only JPEG/PNG images are imported.** WebP/GIF thumbnails, SVG logos and
  icons, sprites, favicons and placeholder graphics are discarded, so a
  scrape returns the real profile photos and nothing else.
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
- **Slug uniqueness** is checked against Neon; collisions get an automatic
  `-2`, `-3` suffix.
- Drafts are per Telegram chat and expire after 24 hours. Only file IDs the
  bot itself registered are served by the media proxy.
- The Express `createPersonaSchema` in `server.ts` was also extended with the
  full field set, so the same payloads remain valid if the Express server is
  ever hosted again.
- On Pages-only deployments the Express `/api/video-proxy` and
  `/api/hls-proxy` routes do not exist; prefer direct MP4/WebM URLs and the
  bot's own `/api/media` links over embed/HLS URLs.
