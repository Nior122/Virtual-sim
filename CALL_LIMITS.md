# Call limits — one call per profile every 2 hours, five calls every 5 hours

The call screen is not unlimited any more. Two rules run together, and both
windows **roll**: a call stops counting exactly N hours after it happened, so
nobody waits for midnight.

| Rule | Limit | What the client sees |
|---|---|---|
| Per profile | **1 call every 2 hours** | **User Busy** screen with a countdown and only a **Message** button |
| Per client | **5 calls every 5 hours**, across every profile | **Call limit reached** screen with a countdown and only a **Message** button |

Calling a *different* profile still rings — the per-profile rule only blocks the
one profile that was already called. When all five calls are spent, nothing
rings until a slot frees, because each call frees five hours after it happened.

Chat is never limited. Both screens keep a Message button and the client can
carry on chatting with the persona.

## What the client actually sees

**After a call — the video finishes and the call hangs up by itself**

```
Call Ended
Your conversation with Emarrb has ended.
⏱ 2h before you can call Emarrb again · 4 of 5 calls left in the next 5h
[ Message ]  [ Call Again ]  [ View Profile ]
```

Pressing **Call Again** asks the server, which answers "busy":

```
🚫 User Busy
Emarrb is busy right now. You can call again once the wait is over, or keep
chatting in the meantime.
⏱ You can call again in 1h 32m
[ Message ]
One call per profile every 2 hours.
```

Only a Message button — no Call Again, no View Profile action row (the top
navigation still works so the client is never stuck). When the countdown hits
zero a **Call Now** button appears, and the same screen re-checks with the
server on press.

**Five calls used**

```
🚫 Call limit reached
You have used all 5 calls for now. Calling is paused for the next 5 hours from
your first call — you can still chat with Emarrb.
⏱ Calls unlock in 4h 12m
[ Message ]
One call per profile every 2 hours, 5 calls every 5 hours.
```

`Try Again` appears once a slot is free. The countdown uses the **server's
clock** (`now` in the API answer), so a device with the wrong time cannot show
a misleading wait.

## When a call counts

A call is counted **when the persona's video actually starts playing**, not when
the screen opens and not while it rings. A call that never connects — a network
error, a dead stream, the 30-second ringing timeout — costs nothing, so a bad
connection cannot burn a client's allowance.

A call is counted once. Re-rendering, seeking, or the next clip in the same call
never charges twice.

Answering an incoming call made by the persona counts too: it is a real video
call with that profile.

## How it is enforced

| Piece | Where |
|---|---|
| The rules (pure arithmetic) | `src/lib/calls/limits.ts` |
| Storage, cookie, decisions | `src/lib/calls/access.ts` |
| HTTP endpoint | `functions/api/call-access.ts` |
| Browser helpers | `src/lib/calls/client.ts` |
| The two blocked screens | `src/components/CallBlockedScreen.tsx` |
| Wiring in the call screen | `src/components/CallSession.tsx` |

```
GET  /api/call-access?profile=<slug>    → may this visitor call this profile?
POST /api/call-access {"profile": …}    → yes, and count it
```

The visitor is identified by an **HttpOnly cookie** (`dg_client`, 32 random hex
characters, one year) set on first contact. Behind it, KV holds
`calls:<id>` → `{ calls: [{ slug, at }], updatedAt }`, pruned to the 5-hour
window and expiring on its own.

Things worth knowing:

- **Clearing cookies resets the limit** for that browser. So does a private
  window and a different device. This is a product limit, not a security
  boundary — there are no visitor accounts to tie it to.
- The limit is stored in KV, so it follows the browser across tabs and survives
  a refresh or a cleared localStorage.
- KV is eventually consistent: two requests in the same edge location see their
  own writes immediately, but a visitor hopping across regions could briefly
  see a stale count. The worst case is one extra call.
- **If KV is unbound, the limit fails open** — every call is allowed and the API
  reports `"enforced": false`. A missing binding must not lock every visitor out
  of the product.

## Changing the numbers

Edit one object — nothing else reads a constant:

```ts
// src/lib/calls/limits.ts
export const CALL_RULES = {
  cooldownMs: 2 * HOUR_MS,  // per-profile wait
  windowMs: 5 * HOUR_MS,    // length of the global window
  maxCalls: 5,              // calls inside that window
} as const;
```

The API sends these numbers to the browser (`limits`), so the countdown copy
and the rule text on screen update by themselves.

## Private mode

`/api/call-access` is served in both modes: private mode hides the catalogue,
and the call screen is one of the pages it still serves. A visitor on a profile
can always call — subject to the limits above.

## Resetting a client (for testing)

The limit belongs to the browser cookie, not to an account:

1. In the browser, clear the site's cookies (or open a private window) — that
   starts a fresh allowance.
2. Or trim the KV record directly: `calls:<the 32-character cookie value>`.

To find the value, look at the `dg_client` cookie in DevTools →
Application → Cookies. It contains no personal data.

## Trying it locally

```bash
npm run build
npx wrangler pages dev dist --port 8798 --ip 127.0.0.1 --kv BOT_KV \
  --persist-to /tmp/wr-calls --binding ADMIN_PASSWORD=supersecret \
  --binding OWNER_CHAT_ID=42 --binding TELEGRAM_WEBHOOK_SECRET=secret \
  --binding TELEGRAM_BOT_TOKEN=123:fake --compatibility-date=2025-01-01

# first check: allowed, 5 remaining, sets the dg_client cookie
curl -s -c /tmp/cj.txt 'http://127.0.0.1:8798/api/call-access?profile=emarrb'

# count a connected call
curl -s -b /tmp/cj.txt -X POST 'http://127.0.0.1:8798/api/call-access' \
  -H 'content-type: application/json' -d '{"profile":"emarrb"}'

# same profile again: allowed=false, reason=profile-cooldown, retryAt ≈ +2h
curl -s -b /tmp/cj.txt 'http://127.0.0.1:8798/api/call-access?profile=emarrb'

# a different profile: still allowed
curl -s -b /tmp/cj.txt 'http://127.0.0.1:8798/api/call-access?profile=leximarvel'
```
