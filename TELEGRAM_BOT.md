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
- `/preview` — the AI writes the profile and the reply carries the media list
  with ✅ Create profile plus per-photo/per-video delete buttons (see
  [reviewing the preview](#reviewing-the-preview-preview-buttons))
- `/restore` — undo the last media you deleted from the preview
- `/remove 1-7` — delete videos in bulk from the loaded draft (see
  [bulk removal](#bulk-removal-remove-17-189-14628)); `/remove ava 1-7` loads
  that profile first
- `/profiles [page]` — every profile with its slug plus image and video counts
  (20 per page), e.g. `Ava — slug: ava · 5 image(s) · 12 video(s)`
- `/bulk <list>` — scrape many pages at once and prepare one profile per entry
  (see below); `/bulknext` prepares the rest of the queue, `/confirm` creates
  them, `/bulkcancel` drops the batch
- `/diag <url>` — what the scraper sees on a page: HTTP status, `<img>` count,
  candidate image URLs and whether each is really served as JPEG
- `/aicheck` — test every provider key live (no completion spent): key
  fingerprint, auth result and the exact variable to fix
- `/chatcheck <slug> [question]` — ask a stored profile a question outside the
  call screen and see which engine answered (Groq, OpenRouter or the offline
  fallback) plus the raw reply
- `/health` in a browser: `https://<your-site>/api/health` lists the deployed
  features, so you can confirm the live site runs the latest code

Owner-only site controls (see [Private mode](#private-mode-no-home-page-no-browse-grid)):

- `/private` — status plus **ON / OFF** buttons for private mode
- `/link <slug> [6h|3d]` — create a temporary link to one profile
- `/sharelinks` — active links with the time left and open count
- `/revoke <token|slug|all>` — kill links early
- `/adlink <url|off>` — where expired links redirect
- `/id` — the chat id, for setting `OWNER_CHAT_ID`


### Private mode (no home page, no browse grid)

> Prefer a browser? Everything in this section — plus profile editing, imports,
> chat testing and diagnostics — is also available in the password-protected web
> backend at `/admin`. See **[ADMIN_PANEL.md](ADMIN_PANEL.md)**.

Hides the catalogue, not the profiles. The site looks like a set of individual
pages with no home page and no way to browse between them.

**What the visitor sees when it is ON**

| Request | Result |
|---|---|
| `/dreamgirl/<slug>` | the full profile: photos, videos, chat — in **both** modes |
| `/call/<slug>` | the call screen and chat work normally |
| `/persona/<slug>`, `/api/personas/<slug>` | served |
| `/`, `/dreamgirls`, `/explore`, `/personas` | neutral **404** page, no links |
| `/api/personas` (the list) | **404** — the catalogue is never served |
| `/sitemap.xml` | **404** while private mode is ON (it lists every profile) |
| `/s/<expired token>` | redirect to the ad URL set with `/adlink` |

A visitor who is already on a profile when you flip the switch **stays there**:
the page and its data keep loading. What they lose is the home page, the browse
grid and every in-page link to another profile (footer, "back to dreamgirls",
the online pop-up).

**Creating a link**

```
/link ava 6h     → valid for 6 hours
/link ava 3d     → valid for 3 days (max 30 days)
/link ava        → buttons: 2h · 6h · 12h · 24h · 3d · 7d
```

The bot answers with the URL `https://<your-site>/s/<token>` and its exact
expiry time. The token is 24 characters of random data — it cannot be guessed
or enumerated. Opening it sets an access cookie valid for exactly the
remaining lifetime of the link and forwards to that profile.

**Ending access**

- `/revoke <token|slug|all>` deletes links immediately (the cookie stops
  working on the next request).
- When a link expires, the visitor is forwarded to the ad URL from
  `/adlink https://…`. Without an ad URL they get a neutral "link expired"
  page instead.
- `/private` → **OFF** restores the normal public site instantly; links stay
  valid but are no longer needed.

**Notes**

- Only the chat named by `OWNER_CHAT_ID` can use these commands. Without that
  variable they stay locked (send `/id` to the bot to read your chat id).
- **Setting `OWNER_CHAT_ID` also makes the whole bot owner-only.** Any other
  chat gets "This bot is private" instead of `/profiles`, `/links` or
  `/chatcheck` — otherwise a stranger could read every profile straight from
  the bot and private mode would be pointless. `/id` is still answered so the
  owner can set the variable. Leave `OWNER_CHAT_ID` empty to keep the bot open
  to everyone (the site controls then stay locked).
- KV is eventually consistent (about 60 seconds worldwide), so a toggle can
  take up to a minute to apply at every edge location.
- Private mode is enforced by `functions/_middleware.ts`, which runs before the
  SPA is served. The client also hides the footer, the "back to dreamgirls"
  link and the online pop-up, and renders a 404 for any other route.
- It is a **Pages** feature. `npm run dev` (the Express server) does not run
  Pages Functions, so local development always behaves like the public site.
- The JavaScript bundle still contains the bundled default personas as
  fallback data. The gate hides every route and every API that serves them,
  but someone who downloads and inspects the bundle could read those built-in
  sample records. Profiles stored in Neon are not in the bundle.


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

### Checking the AI keys (`/aicheck`)

`/aicheck` answers one question: **why did `/preview` fail?** It reports every
provider the environment resolves to, what the key looks like (a fingerprint,
never the key) and the result of a real authenticated call
(`GET /key` on OpenRouter, `GET /models` on Groq and OpenAI-compatible
gateways) so a dead key is separated from a wrong model, an empty balance or an
unreachable host:

```
AI providers (read from the environment only)

1. Groq — primary ❌ 401
   model: your-groq-model
   host:  https://api.groq.com/openai/v1
   key:   gsk_abcd…wxyz (56 chars)
   said:  {"error":{"message":"Missing Authentication header","code":401}}
   → Groq did not receive a usable "Authorization: Bearer …" header, which
     almost always means GROQ_API_KEY was saved with quotes, spaces, a
     newline or a pasted "Bearer " in front. Key in use: gsk_abcd…wxyz (56
     chars). Delete the variable in Cloudflare, paste the key again and
     redeploy.

2. OpenRouter — fallback ✅ working (200)
   model: your-openrouter-model
   host:  https://openrouter.ai/api/v1
   key:   sk-or-v1-ab…9f2c (73 chars)

The first working provider is the one that writes your profiles.
```

Common verdicts:

| The provider says | What it means |
|---|---|
| "`…_API_KEY` is wrong: it holds the model name …" | The model id was pasted into the key variable. Put the key in `…_API_KEY` and the model id in `…_MODEL` |
| `401 Missing Authentication header` | The key arrived without a usable `Bearer` token — quotes, spaces, a newline or a pasted `Bearer ` in the variable. The bot strips all of those on read; if it still fails, delete and re-paste the variable |
| `401 User not found` / `invalid api key` | The key really is dead (deleted, revoked or from another account). Create a new one |
| `402` | The account is out of credits |
| `404` | `…_MODEL` is not an exact model ID from that provider |
| `429` | Rate limited — wait, or put another provider first in `AI_PROVIDER_ORDER` |

`/preview` prints the same hint inline, and `/chatcheck` now lists what every
provider said when the offline engine answered.

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
/remove 1-7                   # or: /remove 1,8,9 · /remove 1-4,6,28
/clearvideos
/save                         # write the changes to Neon
```

- `/remove <list>`, `/removeimage <list>`, `/replaceimage <n> <url>`,
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

#### Bulk removal (`/remove 1-7`, `/remove 1,8,9`, `/remove 1-4,6,28`)

Deleting 20 videos one `/removevideo` at a time is how a profile ends up with
the wrong ones left. `/remove` takes a list instead:

```
/remove 1-7          # a range
/remove 1,8,9        # individual numbers
/remove 1-4,6,28     # both, in one line
/remove 1-4 6 28     # spaces work too
/remove all          # everything
/remove ava 1-7      # load that profile first, then remove
```

What the bot does:

- Numbers are read exactly as `/links` shows them. Ranges typed backwards
  (`7-3`), autocorrected en dashes (`1–7`), `#3` and `;` separators are all
  accepted; repeats are collapsed and mentioned.
- **Out-of-range numbers remove nothing.** `/remove 1-7` on a five-video
  profile answers `There is no #7 — this draft has 5 videos (1-5)` instead of
  silently deleting three and looking successful.
- The reply names every removed number (plus the URLs when you removed three
  or fewer, so the right clips are obvious), then lists what is left with its
  **new** numbering — so the next command is typed against the list you can
  actually see.
- Nothing reaches Neon until `/save` — so a wrong range costs one `/cancel`,
  not a rebuild. `/save` then deletes exactly those `PersonaVideo` rows.
- `/removevideo` is the same command; `/removeimage` and `/removeimages` take
  the same lists for photos.
- While a profile is loaded for editing, `remove 1-7` without the slash works
  too — in edit mode text has no other meaning.
- Removing everything is the same as `/clearvideos`.
- In edit mode nothing is thrown away: `/remove` rewrites the working list and
  `/save` deletes exactly the missing rows.

## Reviewing the preview (`/preview` buttons)

`/preview` writes no data. It sends one message with the profile summary, every
image and video URL the profile will use, and the buttons to fix that list on
the spot:

```
[✅ Create profile]
[🖼 1] [🖼 2] [🖼 3] [🖼 4]
[🖼 5] [🖼 6]
[🎬 1] [🎬 2] [🎬 3] [🎬 4] [🎬 5]
[🎬 6] [🎬 7] [🎬 8] [🎬 9] [🎬 10]
[↩️ Undo last removal]   [✖️ Cancel draft]
```

- **Tap 🖼 / 🎬 to delete that photo or video from the draft.** The preview
  message is edited in place: the numbered lists, the counts and the buttons
  all shrink. Nothing is regenerated, so you never have to run `/preview` a
  second time, and the AI text you already approved stays as it is.
- **Numbers always match what is on screen.** Deleting `🖼 1` promotes the old
  photo 2 to photo 1 — and to the profile's thumbnail — because `/confirm`
  reads the same filtered list the preview shows.
- **`✅ Create profile` is always there** and writes the profile with the list
  exactly as displayed, so an untouched preview is a single tap (it does the
  same thing as `/confirm`).
- **`↩️ Undo last removal`** (or `/restore`) puts the last deleted item back
  where it was, one step at a time, including deletions made with `/remove`.
  The footer only shows the undo button while there is something to undo.
- **`✖️ Cancel draft`** is `/cancel`: the draft is dropped and nothing is
  written.
- Photos get one button each. Videos get buttons up to 15 (5 per row); longer
  lists keep the `/remove <numbers>` hint and numbers there are the same as on
  screen.
- Sending more photos/videos/links after the preview refreshes that same
  message. Running `/preview` again replaces it — the previous message is
  deleted so an old button can never act on numbers that have shifted.
- Re-adding a URL you deleted from the preview un-deletes it.
- A tap that belongs to a draft which no longer exists (created, cancelled or
  replaced) answers **"That draft is gone — start with /newprofile"** and
  creates nothing. Taps are also limited to `OWNER_CHAT_ID` when that is set.

The same removals work by text when you prefer typing: `/remove 1-4` for
videos, `/removeimage 2,5` for photos, `/remove 1-3` in a new-profile draft for
either kind. Both paths share one exclusion list, so `/restore` and ↩️ undo
whatever was deleted last, whichever way it was deleted.

Other draft commands:

- `/setname <name>`, `/setslug <slug>` — override generated values
- `/status` — inspect the current draft (including how many items are
  excluded from the preview)
- `/confirm` (or `/confirm 1,3` on a bulk preview) — write the profile and
  every video into Neon
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
| `OWNER_CHAT_ID` | **Required for site controls.** Telegram chat id allowed to run `/private`, `/link`, `/sharelinks`, `/revoke`, `/adlink` |
| `ADMIN_PASSWORD` | Optional. Password for the `/admin` web backend (min 6 chars). Unset = the backend is disabled. See [ADMIN_PANEL.md](ADMIN_PANEL.md) |
| `ADMIN_SESSION_HOURS` | Optional. Admin login lifetime in hours (default 12, max 168) |
| `ADMIN_SESSION_SECRET` | Optional. Extra signing entropy for the admin session cookie |
| `MANAGER_TELEGRAM` | Optional. The manager's Telegram handle guests are sent to (`KasiQueenbot`, `@KasiQueenbot` or a full `https://t.me/…` URL). Unset = the default in `src/lib/manager.ts`. Guests never see this handle: the chat shows a clickable **@manager** and links to `/manager`, which redirects to Telegram |

> No model ID is hardcoded anywhere. A provider is skipped (and reported in
> `/chatcheck`) when its key or its model variable is missing.
>
> Keys are cleaned when they are read: surrounding quotes, spaces, newlines,
> zero-width characters and an accidentally pasted `Bearer ` are removed, so a
> sloppy copy-paste into the Cloudflare dashboard no longer produces
> `401 Missing Authentication header`.
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
