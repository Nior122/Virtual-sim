// ---------------------------------------------------------------------------
// Shared media proxying for Pages Functions.
// Files/dirs starting with "_" are not routed, so this is a private module.
// ---------------------------------------------------------------------------
import { isHlsUrl, unwrapProxyUrl } from "../../src/lib/video/playback";
import { resolveStreamUrl } from "../../src/lib/video/resolve";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range, Content-Type, Accept, Origin",
  "Access-Control-Expose-Headers":
    "Content-Length, Content-Range, Accept-Ranges, Content-Type",
};

const PRIVATE_HOST_RE =
  /^(localhost|127\.|0\.0\.0\.0$|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|.*\.internal$|.*\.local$)/i;

function isPrivateHost(hostname: string): boolean {
  return PRIVATE_HOST_RE.test(hostname);
}

/** Reject non-http(s) and obvious internal targets (basic SSRF guard). */
export function parseTarget(raw: string | null): URL | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(unwrapProxyUrl(raw.trim()));
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (isPrivateHost(url.hostname)) return null;
  return url;
}

function originOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}/`;
  } catch {
    return "";
  }
}

export function corsHeaders(extra: Record<string, string> = {}): Headers {
  const headers = new Headers(extra);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    headers.set(key, value);
  }
  return headers;
}

export function optionsResponse(): Response {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function proxyUrlFor(target: string, referer?: string): string {
  const params = new URLSearchParams({ url: target });
  if (referer) params.set("referer", referer);
  return `/api/video-proxy?${params.toString()}`;
}

/**
 * Rewrite an m3u8 playlist so every variant/segment request comes back
 * through this Function (CDNs commonly require the original Referer).
 */
export function rewritePlaylist(
  playlist: string,
  baseUrl: string,
  referer?: string
): string {
  return playlist
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#")) {
        return line.replace(/URI="([^"]+)"/gi, (_match, uri: string) => {
          try {
            return `URI="${proxyUrlFor(new URL(uri, baseUrl).toString(), referer)}"`;
          } catch {
            return `URI="${uri}"`;
          }
        });
      }
      try {
        return proxyUrlFor(new URL(trimmed, baseUrl).toString(), referer);
      } catch {
        return line;
      }
    })
    .join("\n");
}

async function fetchUpstream(
  target: URL,
  request: Request,
  referer?: string
): Promise<Response> {
  const headers = new Headers({
    "User-Agent": BROWSER_UA,
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
  });
  const range = request.headers.get("Range");
  if (range) headers.set("Range", range);
  const effectiveReferer = referer || originOf(target.toString());
  if (effectiveReferer) headers.set("Referer", effectiveReferer);

  return fetch(target.toString(), {
    headers,
    redirect: "follow",
    method: request.method === "HEAD" ? "HEAD" : "GET",
  });
}

/** Stream an upstream media response back with Range/CORS headers preserved. */
export async function relayMediaResponse(
  target: URL,
  request: Request,
  referer?: string
): Promise<Response> {
  const upstream = await fetchUpstream(target, request, referer);

  if (!upstream.ok && upstream.status !== 206) {
    return new Response(
      JSON.stringify({ error: `Upstream returned HTTP ${upstream.status}` }),
      {
        status: upstream.status === 404 ? 404 : 502,
        headers: corsHeaders({ "Content-Type": "application/json" }),
      }
    );
  }

  const contentType = (upstream.headers.get("content-type") || "").toLowerCase();
  const playlist =
    contentType.includes("mpegurl") ||
    isHlsUrl(target.toString()) ||
    isHlsUrl(upstream.url);

  if (playlist) {
    const text = await upstream.text();
    const rewritten = rewritePlaylist(text, upstream.url || target.toString(), referer);
    return new Response(rewritten, {
      status: 200,
      headers: corsHeaders({
        "Content-Type": "application/vnd.apple.mpegurl",
        "Cache-Control": "no-cache",
      }),
    });
  }

  const headers = corsHeaders({
    "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
    "Accept-Ranges": upstream.headers.get("accept-ranges") || "bytes",
    "Cache-Control": "public, max-age=3600",
  });
  for (const name of ["content-length", "content-range", "etag", "last-modified"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }

  return new Response(request.method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    headers,
  });
}

/**
 * Handle /api/video-proxy and /api/hls-proxy.
 * `embed` targets are resolved to a direct stream first; `url` targets are
 * proxied as-is (playlists are rewritten recursively).
 */
export async function proxyRequest(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: corsHeaders({ "Content-Type": "application/json" }),
    });
  }

  const params = new URL(request.url).searchParams;
  const referer = params.get("referer") || undefined;
  const embedRaw = params.get("embedUrl");
  const targetRaw = params.get("url") || embedRaw;

  let target = parseTarget(targetRaw);
  if (!target) {
    return new Response(
      JSON.stringify({ error: "Missing or invalid url parameter" }),
      {
        status: 400,
        headers: corsHeaders({ "Content-Type": "application/json" }),
      }
    );
  }

  // Embed pages: find the hidden stream before proxying anything.
  if (embedRaw) {
    const resolved = await resolveStreamUrl(target.toString());
    const resolvedUrl = parseTarget(resolved);
    if (!resolvedUrl) {
      return new Response(
        JSON.stringify({ error: "Could not resolve a playable stream" }),
        {
          status: 404,
          headers: corsHeaders({ "Content-Type": "application/json" }),
        }
      );
    }
    target = resolvedUrl;
  }

  try {
    return await relayMediaResponse(target, request, referer);
  } catch (err) {
    return new Response(
      JSON.stringify({ error: `Proxy failed: ${(err as Error).message}` }),
      {
        status: 502,
        headers: corsHeaders({ "Content-Type": "application/json" }),
      }
    );
  }
}
