# Web backend (`/admin`)

A password-protected panel that does the same jobs as the Telegram bot, from a
browser: private mode, share links, the ads redirect, every profile and its
media, page imports, chat testing and diagnostics.

```
https://<your-site>/admin
```

The panel is a normal page of the site, so it also works while **private mode
is ON** — otherwise turning the site private would lock you out of the page
that turns it back off. Nothing leaks by allowing it: the page is a login form
until a valid session exists, and every `/api/admin/*` route checks the signed
cookie itself.

---

## 0. Start here — the 15-minute setup, step by step

Nothing below needs a terminal, an account, or any code. You need two browser
tabs: **GitHub** (your repository) and **Cloudflare** (your site's dashboard).
Do the steps in this order — each one depends on the one before it.

> Already comfortable with Cloudflare? The short version is: merge the pull
> request, add `ADMIN_PASSWORD`, redeploy, open `/admin`. The long version
> below explains what you should see at every step so you can tell whether it
> worked.

### Step 1 — Put the new code on your site (2 minutes)

The code for private mode, share links and `/admin` lives on a branch, not on
your live site yet.

1. Open your repository on GitHub: **`Nior122/Virtual-sim`**.
2. Click the **Pull requests** tab → the PR titled **"Private mode + expiring
   share links + the /admin web backend"** (number **#10**).
3. Scroll to the bottom, click the green **Merge pull request** button, then
   **Confirm merge**.
4. Wait ~2 minutes. Cloudflare rebuilds the site automatically.

**You should see:** the PR page turns purple with "Merged", and Cloudflare's
Deployments list (Step 2, point 2) shows a new build at the top with a green
**Success** badge.

> If your project's *Production branch* is not `main`, the merge only creates a
> preview. Fix once: Cloudflare → Workers & Pages → **dreambabe** → **Settings**
> → **Builds & deployments** → **Production branch** → `main`.
>
> If nothing deploys after five minutes, open Cloudflare → your project →
> **Deployments**. No new row at all? The GitHub Action may have skipped the
> deploy for missing `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` secrets —
> in that case the dashboard's own Git integration still deploys on merge, so
> check whether a build is already running.

### Step 2 — Give yourself a password (3 minutes)

This is the only credential the backend has. Use something long that you do not
use anywhere else — a passphrase like `copper-Lantern-42-jigsaw` is easy to type
on a phone and hard to guess.

1. Open **https://dash.cloudflare.com** and log in.
2. Left sidebar → **Workers & Pages** → click your project **`dreambabe`**.
3. Open the **Settings** tab → **Variables and Secrets**.
   (Older dashboards call this **Environment variables**; both look the same.)
4. Make sure you are editing **Production** (there is a dropdown; Preview is a
   separate list).
5. Click **Add** (or **Add variable**) three times and fill in:

   | Name | Type | Value |
   |---|---|---|
   | `ADMIN_PASSWORD` | **Secret / Encrypt** | the password you chose (6+ characters) |
   | `ADMIN_SESSION_HOURS` | Plain text | `12` — or `24`, or `168` for a week |
   | `ADMIN_SESSION_SECRET` | **Secret / Encrypt** | any long random string, e.g. `k3Jx9pQ2mV7sL4nB8tR1wY6` |

6. Click **Save** / **Deploy**.

**You should see:** the three names listed under Production. The passwords are
hidden behind dots — that is normal.

> You do **not** need to add `BOT_KV`, `DATABASE_URL` or the Telegram variables
> again. They already exist (the bot uses them). Leave them alone.

### Step 3 — Redeploy so the variables take effect (2 minutes)

Cloudflare reads variables when a deployment is created, not while it runs.
Saving them is not enough.

1. Still in your Pages project → **Deployments** tab.
2. Find the top deployment → click the **⋯** (three dots) menu next to it →
   **Retry deployment**.
3. Wait for the badge to turn **Success**.

**You should see:** a *new* row at the top of the Deployments list. If the old
deployment is still at the top, the retry has not finished yet.

### Step 4 — Check the deployment (1 minute)

Open this in a browser:

```
https://dreambabe.pages.dev/api/health
```

**You should see** `"private-mode"`, `"share-links"` and `"admin-backend"` in
the `features` list. If they are missing, the new code is not live yet — go
back to Step 1 and check that the merge actually deployed.

### Step 5 — Log in (1 minute)

Open **`https://dreambabe.pages.dev/admin`**.

- If it says **"Backend disabled"**, `ADMIN_PASSWORD` did not reach this
  deployment → repeat Step 3.
- Otherwise type the password from Step 2 and press **Sign in**.

**You should see** five tabs: Overview, Profiles, Import, Chat test, Tools.

### Step 6 — Check the boxes on the Overview tab (1 minute)

Look at the **Deployment** card, bottom right. All four should have a green
check:

| Row | Green means |
|---|---|
| KV binding | `BOT_KV` is bound — private mode and links can be saved |
| Database | `DATABASE_URL` works — profiles can be listed |
| Telegram bot | the bot token exists |
| Owner chat | `OWNER_CHAT_ID` is set (see Step 7) |

Not all green? Fix the missing one first; the tabs that need it will not work
without it.

### Step 7 — Unlock the Telegram controls (2 minutes, if not done already)

`/private`, `/link` and `/adlink` only answer the **owner's** chat.

1. In Telegram, send `/id` to your bot.
2. Copy the number it replies with.
3. Cloudflare → your project → **Settings → Variables and Secrets** →
   **Add** → name `OWNER_CHAT_ID`, type **Plain text**, value that number →
   save → **Deployments → ⋯ → Retry deployment**.

**Be aware:** setting `OWNER_CHAT_ID` makes the *whole* bot owner-only. Anyone
else who messages it gets "This bot is private" instead of `/profiles` or
`/links`. That is deliberate — otherwise a stranger could read every profile
through the bot and private mode would be pointless. `/id` still answers, so
you can never lock yourself out of finding your own number.

### Step 8 — Your first real test (3 minutes)

Do this in a **private/incognito window** so you are a stranger, not you.

1. Open a profile in the incognito window: `https://<your-site>/dreamgirl/<slug>`.
   **You should see** its photos, videos and a working chat.
2. Switch **Private mode** ON in `/admin`.
3. In the same incognito window:
   - **reload** the profile page → still opens ✓ (this is the "nobody gets
     thrown out when I flip the switch" promise)
   - its videos and chat still work ✓
   - type the site's home address → **404** ✓
   - type `/dreamgirls` → **404** ✓
   - type another profile's address → it opens (profiles are not secret; only
     the catalogue is) ✓
4. Switch **Private mode** OFF. The home page and the browse grid come back.

If step 3 behaves like that, everything is wired correctly.

### Step 9 — Hand a link to a customer

1. `/admin` → **Overview → Share links** → pick the profile and the lifetime.
2. Press **Copy** next to the new link and send it however you normally would.
3. Watch the **opens** count on that row to see whether they used it.
4. To cut access early, press **Revoke**. To cut everything, **Revoke every
   link**.

When a link runs out, the visitor is sent to the **ads URL** you set on the same
tab. Set it once and forget it.

---

## Common beginner mistakes

| What happened | Why | What to do |
|---|---|---|
| `/admin` shows "Backend disabled" | the variable was saved but no new deployment was made | Deployments → ⋯ → **Retry deployment** |
| Login says "Backend disabled" but you *did* set a password | the password is shorter than 6 characters, or you edited **Preview** instead of **Production** | check the length and the environment dropdown |
| "Wrong password", but you copied it correctly | the browser or password manager added a space | retype it; the server trims surrounding spaces |
| "Too many wrong passwords" | 8 failures from your IP in 15 minutes | wait 15 minutes, then try once more |
| `/api/health` does not list `admin-backend` | the merge deployed a preview, not production | make `main` the Production branch (Step 1 note) |
| The switch says ON but the home page still loads | KV has about a minute of propagation, or `BOT_KV` is not bound | wait 60 s, refresh; if it persists, check the Deployment card |
| "BOT_KV is not bound to this deployment" | the KV binding was removed or renamed | Settings → **Bindings** → add KV namespace with name `BOT_KV` → redeploy |
| The profile list is empty or red | `DATABASE_URL` is missing/suspended | the public site would show the same problem; check Neon |
| A profile says "not available" while private mode is ON | the slug in the URL does not exist, or the profile is marked inactive | check the exact slug in Profiles; private mode no longer blocks profile URLs |
| Someone sent a profile URL and the visitor says the site looks empty | private mode hides the home page and the browse grid | that is expected — the profile itself, its videos and its chat all work |
| Everything works, but `npm run dev` does not have `/admin` | the dev server is Express; the backend is a Pages Function | use `npm run build` then `npx wrangler pages dev dist` |

### Undoing it

- **Make the site public again:** `/admin` → Overview → switch Private mode OFF.
  The feature ships switched off, so a fresh deployment is public by default.
- **Turn the backend off:** delete `ADMIN_PASSWORD` in Cloudflare and redeploy.
  `/admin` then shows the setup card and every API answers 503. Nothing else on
  the site changes.
- **Kill every share link:** `/admin` → Overview → **Revoke every link**.

---

## 1. Setup

Add these in Cloudflare → Pages → your project → **Settings → Environment
variables** (Production), then redeploy (a new deployment is required; variables
are not read by an existing one):

| Variable | Required | What it does |
|---|---|---|
| `ADMIN_PASSWORD` | **Yes** | The login password. At least 6 characters. Without it the backend answers 503 and the login page shows setup instructions. |
| `ADMIN_SESSION_HOURS` | No | How long a login lasts. Default `12`, clamped to 1–168. |
| `ADMIN_SESSION_SECRET` | No | Extra entropy for the cookie signature. Recommended: a long random string. |

The same password unlocks every device. There is no user table and no email
step — one owner, one password.

### How the login works

- A correct password returns a `dg_admin` cookie: `HttpOnly`, `SameSite=Strict`,
  `Secure` on https, expiring after `ADMIN_SESSION_HOURS`.
- The cookie is an HMAC-SHA256 signature over its own expiry. The signing key is
  derived from `ADMIN_PASSWORD` + `ADMIN_SESSION_SECRET`, so **changing the
  password invalidates every existing session** — that is the "log out
  everywhere" button.
- Eight wrong passwords from one IP lock that IP for 15 minutes (KV-backed;
  counted per Cloudflare client IP).
- No password, no session, no API data: unauthenticated `/api/admin/*` calls
  answer `401`.

### Security notes

- The panel is at a guessable URL. That is intentional: the password is the
  control, not the address. Use a long one (a passphrase or a password-manager
  value), and set `ADMIN_SESSION_HOURS` to something short on a shared computer.
- The admin APIs are same-origin only (`SameSite=Strict` cookie), and every
  write is validated server-side — the browser can never inject SQL, only the
  allow-listed columns are written.
- Image URLs are fetched and must answer `image/jpeg` before they are stored,
  the same rule the bot uses. A broken or WebP URL is refused with the list of
  offenders.
- `systemPrompt` is editable here but the public persona endpoint never returns
  it; only the chat route reads it.

---

## 2. Overview tab

### Private mode

The big switch at the top. **It hides the catalogue, never the profiles.** ON:

- `/`, `/dreamgirls`, `/explore`, `/sitemap.xml` and the persona *list* API
  answer **404** — there is nothing to browse.
- Every profile keeps working at its own URL: `/dreamgirl/<slug>`,
  `/call/<slug>`, photos, videos, chat. A visitor who is already watching one
  when you flip the switch is **not** thrown out.
- Nothing on a profile links to another profile (the footer, "back to
  dreamgirls" and the pop-up are hidden), so a visitor can only reach another
  profile if they already know its address.

OFF restores the home page and the browse grid. KV propagation is about a
minute, so one edge location may still serve the old state briefly.

### Share links

Pick a profile, pick a lifetime (1 hour … 30 days), press **Create**. The panel
shows the `/s/<token>` URL, the time left and how many opens it has had. Copy it
with one click. **Revoke** kills a link immediately (the next request with its
cookie is refused); **Revoke every link** does all of them.

Expired or revoked links send the visitor to the **ads URL** below. If no ads
URL is set they see a neutral "link expired" page instead.

A share link is a **timed entry point**, not a lock: the profile page itself
stays reachable at `/dreamgirl/<slug>` in either mode. What expires is the
`/s/…` URL — after that it becomes the ad redirect, and the opens counter tells
you how many people came through it.

### Expired-link destination

Paste an `https://` URL and **Save**. **Clear** removes it. The bot's `/adlink`
sets the same value — the two always agree because both read the same KV key.

### Call limits

Every client can call **one profile every 2 hours** and **five calls every
5 hours** in total; after that they get a *User Busy* / *Call limit reached*
screen with only a Message button. Nothing to switch on — it is always active,
and a call only counts once the persona's video really starts playing.

The numbers live in `src/lib/calls/limits.ts` (`CALL_RULES`) and the full
behaviour is described in **[CALL_LIMITS.md](CALL_LIMITS.md)**.

### Deployment card

Shows whether KV, the database, the Telegram bot and `OWNER_CHAT_ID` are
configured, plus the AI provider order (never the keys).

If `BOT_KV` is missing, switching private mode on answers
**"BOT_KV is not bound to this deployment"** instead of pretending it worked —
a switch that silently does nothing is worse than an error.

---

## 3. Profiles tab

The full list, newest first, with an image count, a video count and an active
badge. Search by name or slug.

- **New profile** opens a blank editor.
- **Edit** loads the profile with its text fields, images and videos.
- **Copy link / Open** go to the public page. They work in both modes: private
  mode hides the catalogue, not the profiles. A short banner reminds you when
  private mode is ON. Temporary `/s/…` links (with the timer and the ad
  redirect) live on the Overview tab.
- **Delete** removes the persona and all of its video rows (asks first).

### The editor

- **Basics** — name, slug, age, flirt level, city, country, active flag.
  Leaving the slug blank generates one from the name; duplicates get `-2`,
  `-3`, … automatically.
- **Images** — up to 7 slots. **Slot 1 is the profile picture, slot 2 the
  cover**, the rest the gallery. Use the arrows to reorder and × to remove.
  Every URL is probed; anything that is not a JPEG response is rejected with
  the offending URLs listed, so a card can never show a blank image.
- **Profile copy** — description, personality, background, interests, speaking
  style, short/long bio and the smaller fields.
- **Videos** — one row per clip: a **thumbnail on the left, the link and title
  on the right**, numbered in the order the call screen plays them. The
  thumbnail is a real frame pulled from the video itself, so you can see which
  clip you are about to remove instead of comparing bare URLs. It keeps the
  clip's own shape — a portrait video gets a tall preview, a landscape video a
  wide one — and shows a film icon plus “no preview” when a link cannot be
  read (a dead URL, an embed with no direct stream, or a slow CDN). The frame
  loads through the same proxy the call screen uses and only when the row is
  near the screen, so opening a profile with 20 videos does not fetch 20
  videos. Direct files (`.mp4`, `.webm`, `.m3u8`) are stored as-is; embed
  players are resolved to a playable stream on save. Links with no playable
  stream are skipped and reported. The trash button on the right removes just
  that row; nothing is deleted until you save.
- **Advanced** — body details, intimate fields and the **system prompt**. The
  prompt is never sent to a browser by any public endpoint.

Saving with no changes is harmless. Text-only edits do not re-check the images.

---

## 4. Import tab

The web version of `/scrape` → `/preview` → `/confirm`.

1. Paste one profile URL per line (up to 25).
2. **Scrape & prepare** — for each line: open the page, find candidate images,
   verify each one is really a JPEG, collect playable videos, then ask your AI
   provider for the profile text. **Nothing is written to the database.**
3. Review the cards: thumbnails, image/video counts, skipped embeds, name, slug,
   description and personality. A failed page shows why and does not stop the
   others.
4. **Create profile** per card, or **Create all ready**. The card then offers
   the same **Copy link / Open** actions as the Profiles tab — the profile URL
   works in both modes.

Notes:

- Use `images: <url> videos: <url>` on a line to take the photos from one page
  and the videos from another, exactly like `/bulk`.
- A page with no verified JPEG cannot be imported; the card explains whether it
  found none, or found some that were not served as JPEG.
- When the AI provider fails, the import still prepares with fallback text and
  marks the card `AI failed — fallback text used`. You can edit it afterwards in
  the Profiles tab.
- Preparing is one request per line, so a slow page only delays its own card.
- Scraping cannot run JavaScript or solve a Cloudflare challenge. If a page
  comes back empty, use the Tools tab to see why.

---

## 5. Chat test tab

Pick an active profile, type a question, press **Send** (or Ctrl/⌘ + Enter).
The answer is the real one — the same prompt, provider and fallback chain the
public chat uses — and the provider that produced it is shown under each reply.
Nothing is published.

Use it after editing a system prompt, or when a customer says the chat answered
something odd, to see exactly what the profile says.

---

## 6. Tools tab

- **Diagnose a page** — the same report as `/diag`: HTTP status, content type,
  `<img>`/`<source>` counts, bot-challenge detection, the Coomer/Kemono archive
  API summary, and every candidate image with a green/red mark for "really
  image/jpeg". Use this when an import says "no JPEG images found".
- **Check a profile's videos** — HEADs every stream URL of a profile (falling
  back to a one-byte GET when the CDN refuses HEAD) and reports status and
  content type. A red row explains a black video on the call screen.
- **Health** — link to `/api/health`, which lists the deployed features.

---

## 7. Bot vs backend

| Job | Telegram | Web backend |
|---|---|---|
| Private mode | `/private` (ON/OFF buttons) | Overview switch |
| Share links | `/link <slug> 6h`, `/sharelinks`, `/revoke` | Overview: create, copy, revoke |
| Ads URL | `/adlink <url>` | Overview: destination card |
| List profiles | `/profiles` | Profiles tab |
| Create from scraping | `/scrape` → `/preview` → `/confirm` | Import tab |
| Bulk import | `/bulk` → `/previewall` → `/confirm` | Import tab (one card per URL) |
| Edit media | `/edit <slug>` then add/replace | Profiles → Edit |
| Delete profile | — | Profiles → Delete |
| Chat test | `/chatcheck <slug> [question]` | Chat test tab |
| Diagnose | `/diag <url>`, `/checkvideos` | Tools tab |
| Upload a photo | send a photo to the bot | paste an image URL (the bot is still the way to upload files) |

The two use the same KV keys and the same Neon tables, so a change made in one
is visible in the other immediately.

---

## 8. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Login page says "Backend disabled" | `ADMIN_PASSWORD` is unset or shorter than 6 characters. Set it and **redeploy** — environment changes are not applied to an existing deployment. |
| "Wrong password" with the right password | Trailing whitespace in the variable, or you edited the variable without redeploying. The value is trimmed automatically. |
| Locked out after several attempts | Eight failures per IP in 15 minutes. Wait, or clear the `admin:login:<ip>` key in the KV namespace. |
| Profile list shows a red database error | `DATABASE_URL` is missing/bad or the Neon project is suspended. The site's public pages show the same failure. |
| "N image URL(s) are not served as JPEG" | The URL returns WebP/PNG, a redirect to HTML, or a 403. Open the URL in a browser; if it downloads rather than displays, find the `.jpg` variant. |
| Import says "no JPEG images found" | Run Tools → Diagnose on the same URL. It shows whether images exist, whether they were rejected, or whether the site is serving a bot challenge. |
| Video saves but does not play | Tools → Check videos. Embeds with no extractable stream are skipped on save; use the direct `.mp4`/`.m3u8` URL instead. |
| `/admin` answers 404 | Private mode hides it only for people without a session? No — `/admin` is always served. A 404 means the deployment has no `functions/api/admin` (old build) or a proxy is stripping the route. |
| Session ends too early | `ADMIN_SESSION_HOURS` is short, or `ADMIN_PASSWORD`/`ADMIN_SESSION_SECRET` changed (which invalidates every cookie). |
| A client says the site is "busy" and will not call | they used their allowance: one call per profile every 2h, five calls every 5h | the screen shows a countdown; chat still works. Reset by clearing that browser's cookies — see [CALL_LIMITS.md](CALL_LIMITS.md) |
| The panel works on the live site but not with `npm run dev` | `npm run dev` starts the Express server, which does not run Pages Functions. Use `npx wrangler pages dev dist` (after `npm run build`) to exercise `/api/admin/*` locally. |

---

## 9. What is not here

- **File uploads.** The bot can accept a photo/video sent to Telegram; the web
  panel accepts URLs only, because Pages Functions have no storage bucket. Use
  the bot for uploads, or host the file and paste its URL.
- **Bulk confirm in one request.** Import commits one profile per request so a
  failure cannot leave half a list half-written.
- **Multiple accounts or roles.** One password, one owner.
- **A public signup.** No accounts exist to sign up with.
