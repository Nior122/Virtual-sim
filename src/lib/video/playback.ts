// ---------------------------------------------------------------------------
// Video URL classification + playback mapping.
// Workers-compatible: plain Web APIs only (no node: imports), so it is shared
// by the bot, the Pages Functions and the browser bundle.
// ---------------------------------------------------------------------------

/** Direct, progressively downloadable media files. */
export const DIRECT_VIDEO_RE = /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i;
/** HLS playlists (browser needs hls.js or native Safari support). */
export const HLS_RE = /\.m3u8(\?|#|$)/i;
/** HTML player pages that hide the real stream behind an embed. */
export const EMBED_VIDEO_RE =
  /(rubyvidhub|morencius|leakgallery|\/embed|\/e\/|player\.php|[?&]v=|\.html?(\?|#|$))/i;

/** True for .m3u8 (optionally wrapped in our own proxy URLs). */
export function isHlsUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  if (url.includes("/api/hls-proxy")) return true;
  const inner = unwrapProxyUrl(url);
  return HLS_RE.test(inner);
}

/** True for a direct media file (.mp4/.webm/...). */
export function isDirectVideoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return DIRECT_VIDEO_RE.test(unwrapProxyUrl(url));
}

/** True for an HTML player page that must be resolved first. */
export function isEmbedUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const inner = unwrapProxyUrl(url);
  if (DIRECT_VIDEO_RE.test(inner) || HLS_RE.test(inner)) return false;
  if (inner.startsWith("/api/media/")) return false;
  return EMBED_VIDEO_RE.test(inner);
}

/** True for our own Telegram media proxy URLs (relative or absolute). */
export function isLocalMediaUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  if (url.startsWith("/api/media/")) return true;
  try {
    return new URL(url).pathname.startsWith("/api/media/");
  } catch {
    return false;
  }
}

/** Anything we can hand to a <video> element (directly or via our proxy). */
export function isPlayableVideoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  if (isLocalMediaUrl(url)) return true;
  return isDirectVideoUrl(url) || isHlsUrl(url);
}

/** Extract the target URL from our own /api/video-proxy or /api/hls-proxy URLs. */
export function unwrapProxyUrl(url: string): string {
  if (!url.includes("/api/")) return url;
  try {
    const parsed = new URL(url, "https://placeholder.invalid");
    const inner =
      parsed.searchParams.get("url") || parsed.searchParams.get("embedUrl");
    if (inner && inner !== url) return inner;
  } catch {
    // fall through
  }
  return url;
}

/**
 * Map a stored video URL to the URL the browser should load.
 * Remote media goes through our own proxy so hotlink protection, missing CORS
 * headers and Range quirks cannot break playback; embeds go through the HLS
 * proxy, which resolves the hidden stream first.
 */
export function toPlaybackUrl(url: string | null | undefined): string {
  if (!url) return "";
  const raw = url.trim();
  if (!raw) return "";
  if (raw.startsWith("/api/")) return raw;
  if (raw.startsWith("data:")) return raw;
  if (!/^https?:\/\//i.test(raw)) return raw;

  // Telegram media is served by this same deployment: keep it relative so a
  // custom domain or preview deployment still works.
  if (isLocalMediaUrl(raw)) {
    try {
      const parsed = new URL(raw);
      return `${parsed.pathname}${parsed.search}`;
    } catch {
      return raw;
    }
  }

  if (isEmbedUrl(raw) && !isDirectVideoUrl(raw) && !isHlsUrl(raw)) {
    return `/api/hls-proxy?embedUrl=${encodeURIComponent(raw)}`;
  }
  if (isHlsUrl(raw)) {
    return `/api/hls-proxy?url=${encodeURIComponent(raw)}`;
  }
  return `/api/video-proxy?url=${encodeURIComponent(raw)}`;
}
