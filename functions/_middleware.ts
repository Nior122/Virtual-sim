// ---------------------------------------------------------------------------
// Site-wide gate for private mode.
//
// Cloudflare Pages runs this middleware for every request, before `_redirects`
// and before the SPA. That matters: the app is a React Router SPA served from a
// single index.html, so "hide the home page" cannot be done in the client — a
// visitor would still receive the app shell and every route. The gate has to
// happen here, at the edge.
//
// Behaviour:
//   • private mode OFF → everything passes through untouched.
//   • private mode ON  → the site has no catalogue and no discovery, but every
//     profile is still reachable at its own URL. /dreamgirl/<slug>,
//     /persona/<slug>, /call/<slug>, /api/personas/<slug>, chat and media are
//     served to anyone who knows the link, so a visitor who is already on a
//     profile keeps watching when the switch is flipped. The home page, the
//     browse grid, /sitemap.xml and the persona *list* API answer a neutral
//     404, so nobody can browse to another profile from the site.
//   • /s/<token>       → redeems a share link: sets the access cookie and
//     redirects to the profile. An expired link redirects to the owner's ad
//     URL instead (that is what the cookie is still good for).
// ---------------------------------------------------------------------------
import type { Env } from "../src/lib/bot/types";
import {
  accessCookie,
  clearAccessCookie,
  readAccessLink,
  readAdUrl,
  readPrivateMode,
  resolveRequestAccess,
  touchAccessLink,
} from "../src/lib/access/mode";

interface EventContext {
  request: Request;
  env: Env;
  next: () => Promise<Response>;
  waitUntil?: (promise: Promise<unknown>) => void;
  params: Record<string, string>;
}

/** Page routes that can be opened with a valid share cookie. */
const PERSONA_PAGE_RE = /^\/(?:dreamgirl|persona|call)\/([^/]+)\/?$/i;
/** The one API shape that names a profile. */
const PERSONA_API_RE = /^\/api\/personas\/([^/]+)\/?$/i;
/** API routes that only an authorised visitor may use. */
const GATED_APIS = new Set([
  "/api/chat",
  "/api/video-proxy",
  "/api/hls-proxy",
  "/api/resolve-video-stream",
]);

const STATIC_EXTENSIONS =
  /\.(?:js|mjs|css|map|png|jpe?g|gif|webp|avif|svg|ico|bmp|woff2?|ttf|otf|eot|mp4|webm|m4v|mov|txt|webmanifest)$/i;

/** Site chrome that must load for the allowed profile to render. */
function isPublicAsset(path: string): boolean {
  if (path.startsWith("/assets/") || path.startsWith("/videos/")) return true;
  if (path === "/favicon.ico" || path === "/robots.txt") return true;
  return STATIC_EXTENSIONS.test(path);
}

/** Infrastructure endpoints that never expose profile data. */
function isPublicApi(path: string): boolean {
  return (
    path === "/api/health" ||
    path === "/api/site-mode" ||
    path === "/api/telegram-bot"
  );
}

/**
 * The owner's backend.
 *
 * It must stay reachable while private mode is ON — otherwise turning the site
 * private would also lock the owner out of the page that turns it back off.
 * Nothing is exposed by letting it through: every /api/admin route checks the
 * signed session cookie itself, and the page is just a login form until then.
 */
function isAdminPath(path: string): boolean {
  return (
    path === "/admin" ||
    path.startsWith("/admin/") ||
    path === "/api/admin" ||
    path.startsWith("/api/admin/")
  );
}

function noStore(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "Cache-Control": "no-store, max-age=0",
    "X-Robots-Tag": "noindex, nofollow",
    ...extra,
  };
}

/**
 * Neutral page with no links, no scripts and no site chrome — it must not
 * hint that profiles exist anywhere else on the site.
 */
function neutralPage(status: number, message: string): Response {
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>${status === 404 ? "Not found" : "Link unavailable"}</title>
    <style>
      :root { color-scheme: dark; }
      html, body { height: 100%; margin: 0; }
      body {
        background: #07080e; color: #e5e7eb;
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
        display: flex; align-items: center; justify-content: center;
        text-align: center; padding: 24px;
      }
      h1 { font-size: 44px; margin: 0 0 10px; letter-spacing: -0.03em; }
      p { margin: 0; color: #9ca3af; font-size: 15px; }
    </style>
  </head>
  <body>
    <main>
      <h1>${status === 404 ? "404" : "&#9203;"}</h1>
      <p>${message}</p>
    </main>
  </body>
</html>`;
  return new Response(html, {
    status,
    headers: noStore({ "Content-Type": "text/html; charset=utf-8" }),
  });
}

function notFound(): Response {
  return neutralPage(404, "This page is not available.");
}

/** JSON 404 for API calls — the SPA treats it as "no data", never as content. */
function apiNotFound(): Response {
  return new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: noStore({ "Content-Type": "application/json" }),
  });
}

function redirect(url: string, cookie?: string): Response {
  const headers = noStore({ Location: url });
  if (cookie) headers["Set-Cookie"] = cookie;
  return new Response(null, { status: 302, headers });
}

/**
 * Redeem `/s/<token>`.
 *
 * A valid token sets the cookie for exactly the remaining lifetime of the
 * link and forwards to that profile. An expired one forwards to the ad URL
 * (if configured) — the visitor never sees a second profile.
 */
async function redeemShareLink(
  context: EventContext,
  token: string,
  secure: boolean
): Promise<Response> {
  const link = await readAccessLink(context.env, token);
  if (!link) return notFound();

  const now = Date.now();
  if (link.expiresAt <= now) {
    // Drop the dead cookie on the way out, so the browser stops sending it.
    const adUrl = await readAdUrl(context.env);
    if (adUrl) return redirect(adUrl, clearAccessCookie(secure));
    return neutralPage(410, "This link has expired.");
  }

  const maxAge = Math.floor((link.expiresAt - now) / 1000);
  const counted = touchAccessLink(context.env, link).catch(() => undefined);
  if (typeof context.waitUntil === "function") context.waitUntil(counted);
  else await counted;

  return redirect(
    `/dreamgirl/${encodeURIComponent(link.slug)}`,
    accessCookie(token, maxAge, secure)
  );
}

export async function onRequest(context: EventContext): Promise<Response> {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  const secure = url.protocol === "https:";

  // 1) Share links always resolve, whether private mode is on or off.
  const share = path.match(/^\/s\/([A-Za-z0-9_-]{16,64})\/?$/);
  if (share) return redeemShareLink(context, share[1], secure);
  if (path === "/s" || path.startsWith("/s/")) return notFound();

  // 2) Assets, infrastructure and the owner's backend are never gated.
  if (isPublicAsset(path) || isPublicApi(path) || isAdminPath(path)) {
    return context.next();
  }

  // 3) Public mode: the site behaves exactly as before.
  const mode = await readPrivateMode(env);
  if (!mode.enabled) return context.next();

  // 4) Private mode: no catalogue, no discovery — but profiles stay open.
  const access = await resolveRequestAccess(env, request, mode);

  /**
   * Deny a request for a hidden surface. With an expired share cookie the
   * visitor is forwarded to the ad URL, because they arrived through a real
   * link that simply ran out.
   */
  const deny = async (): Promise<Response> => {
    if (access.expired) {
      const adUrl = await readAdUrl(env);
      if (adUrl) return redirect(adUrl, clearAccessCookie(secure));
    }
    return notFound();
  };

  // --- API ---------------------------------------------------------------
  if (path.startsWith("/api/")) {
    // The catalogue powers the home page and the browse grid: never served.
    // It is the one response that lists every profile.
    if (path === "/api/personas" || path === "/api/personas/") return apiNotFound();

    // A single profile, chat, video and media endpoints stay available: the
    // profile a visitor is already watching must keep working when the switch
    // is flipped, and a profile URL works in private mode by design.
    if (
      PERSONA_API_RE.test(path) ||
      GATED_APIS.has(path) ||
      path.startsWith("/api/media/")
    ) {
      return context.next();
    }

    // Everything else (admin, unknown routes) is invisible in private mode.
    return apiNotFound();
  }

  // --- Pages -------------------------------------------------------------
  // Profile pages are reachable at their own URL in both modes. Only the
  // catalogue (home, browse grid, explore, sitemap, anything unknown) is
  // hidden, so a visitor cannot discover another profile from the site.
  if (PERSONA_PAGE_RE.test(path)) return context.next();

  return deny();
}
