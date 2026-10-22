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
//   • private mode ON  → only /dreamgirl/<slug>, /call/<slug> and
//     /persona/<slug> for the slug named by a valid share cookie, plus its
//     API calls, are served. Everything else (home, browse grid, other
//     profiles, sitemap, admin) answers a neutral 404 with no links.
//   • /s/<token>       → redeems a share link: sets the access cookie and
//     redirects to the profile. An expired link redirects to the owner's ad
//     URL instead.
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
 * Decode a path segment without throwing.
 * A malformed escape (`/dreamgirl/%E0%A4%A`) must answer 404, not a 500 with a
 * stack trace — and it must never be mistaken for a valid slug.
 */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
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

function apiForbidden(): Response {
  return new Response(JSON.stringify({ error: "Forbidden" }), {
    status: 403,
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
    const adUrl = await readAdUrl(context.env);
    if (adUrl) return redirect(adUrl);
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

  // 2) Assets and infrastructure endpoints are never gated.
  if (isPublicAsset(path) || isPublicApi(path)) return context.next();

  // 3) Public mode: the site behaves exactly as before.
  const mode = await readPrivateMode(env);
  if (!mode.enabled) return context.next();

  // 4) Private mode.
  const access = await resolveRequestAccess(env, request, mode);
  const allowedSlug = access.link ? access.link.slug.toLowerCase() : null;

  /**
   * Deny a request. With an expired cookie the visitor is forwarded to the ad
   * URL, because they arrived through a real link that simply ran out.
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
    // The catalog powers the home page and the browse grid: never served.
    if (path === "/api/personas" || path === "/api/personas/") return apiNotFound();

    const personaApi = path.match(PERSONA_API_RE);
    if (personaApi) {
      const slug = safeDecode(personaApi[1]).toLowerCase();
      if (allowedSlug && slug === allowedSlug) return context.next();
      return apiNotFound();
    }

    if (GATED_APIS.has(path) || path.startsWith("/api/media/")) {
      if (access.link) return context.next();
      return apiForbidden();
    }

    // Everything else (admin, unknown routes) is invisible in private mode.
    return apiNotFound();
  }

  // --- Pages -------------------------------------------------------------
  const page = path.match(PERSONA_PAGE_RE);
  if (page) {
    const slug = safeDecode(page[1]).toLowerCase();
    if (allowedSlug && slug === allowedSlug) return context.next();
    return deny();
  }

  // Home, browse grid, admin, sitemap and anything unknown: hidden.
  return deny();
}
