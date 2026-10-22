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

The big switch at the top. ON:

- `/`, `/dreamgirls`, `/explore`, `/admin` (for visitors), `/sitemap.xml` and
  every profile except the one in a visitor's share link answer **404**.
- The linked profile keeps working completely: photos, videos, `/call/<slug>`,
  chat.
- Any other profile also answers 404 — the visitor cannot discover it.

OFF restores the public site. KV propagation is about a minute, so one edge
location may still serve the old state briefly.

### Share links

Pick a profile, pick a lifetime (1 hour … 30 days), press **Create**. The panel
shows the `/s/<token>` URL, the time left and how many opens it has had. Copy it
with one click. **Revoke** kills a link immediately (the next request with its
cookie is refused); **Revoke every link** does all of them.

Expired or revoked links send the visitor to the **ads URL** below. If no ads
URL is set they see a neutral "link expired" page instead.

### Expired-link destination

Paste an `https://` URL and **Save**. **Clear** removes it. The bot's `/adlink`
sets the same value — the two always agree because both read the same KV key.

### Deployment card

Shows whether KV, the database, the Telegram bot and `OWNER_CHAT_ID` are
configured, plus the AI provider order (never the keys).

---

## 3. Profiles tab

The full list, newest first, with an image count, a video count and an active
badge. Search by name or slug.

- **New profile** opens a blank editor.
- **Edit** loads the profile with its text fields, images and videos.
- **Copy link / Open** go to the public page.
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
- **Videos** — URL + optional title. Direct files (`.mp4`, `.webm`, `.m3u8`)
  are stored as-is; embed players are resolved to a playable stream on save.
  Links with no playable stream are skipped and reported.
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
4. **Create profile** per card, or **Create all ready**.

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
