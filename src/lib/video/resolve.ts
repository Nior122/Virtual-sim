// ---------------------------------------------------------------------------
// Resolve HTML "embed" player pages into real video stream URLs.
// Workers-compatible (fetch/URL/RegExp only). Used by the bot when saving
// videos and by /api/resolve-video-stream + /api/hls-proxy at playback time.
// ---------------------------------------------------------------------------
import { isDirectVideoUrl, isHlsUrl, unwrapProxyUrl } from "./playback";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const MAX_HTML_BYTES = 600_000;
const FETCH_TIMEOUT_MS = 8000;

const STREAM_URL_RE =
  /(?:https?:\/\/|\/)[^"'\s<>()\\]+?\.(?:m3u8|mp4|webm|mov|m4v)(?:\?[^"'\s<>()\\]*)?/gi;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSlashes(text: string): string {
  return text
    .replace(/\\\//g, "/")
    .replace(/\\u002f/gi, "/")
    .replace(/\\u002e/gi, ".");
}

/**
 * Decode a Dean Edwards "packer" payload
 * (eval(function(p,a,c,k,e,d){…}('…',62,40,'word|word'.split('|'),0,{})))
 * without using eval — inline player scripts hide the .m3u8 URL in there.
 */
export function unpackPackedScript(source: string): string | null {
  if (!/eval\(function\(p,a,c,k,e,[a-z]\)/.test(source)) return null;
  const args = source.match(
    /'([\s\S]*?)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([\s\S]*?)'\.split\('\|'\)/
  );
  if (!args) return null;

  const [, payload, baseRaw, countRaw, dictionary] = args;
  const base = parseInt(baseRaw, 10);
  const count = parseInt(countRaw, 10);
  const words = dictionary.split("|");
  if (!base || !count) return null;

  const encode = (value: number): string => {
    let out = "";
    let n = value;
    do {
      const digit = n % base;
      out =
        (digit > 35 ? String.fromCharCode(digit + 29) : digit.toString(36)) +
        out;
      n = Math.floor(n / base);
    } while (n > 0);
    return out;
  };

  let decoded = payload;
  for (let i = count - 1; i >= 0; i -= 1) {
    if (!words[i]) continue;
    decoded = decoded.replace(
      new RegExp(`\\b${escapeRegExp(encode(i))}\\b`, "g"),
      words[i]
    );
  }
  return decoded;
}

/** All absolute stream candidates in a chunk of HTML/JS, HLS first. */
export function extractStreamUrls(text: string, base?: string): string[] {
  const normalized = normalizeSlashes(text);
  const found: string[] = [];
  STREAM_URL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = STREAM_URL_RE.exec(normalized)) !== null) {
    let candidate = match[0];
    if (!/^https?:\/\//i.test(candidate)) {
      if (!base) continue;
      try {
        candidate = new URL(candidate, base).toString();
      } catch {
        continue;
      }
    }
    if (!found.includes(candidate)) found.push(candidate);
  }
  // Prefer HLS (highest quality, most common for embeds) then direct files.
  return found.sort((a, b) => Number(isHlsUrl(b)) - Number(isHlsUrl(a)));
}

/** Best stream URL hidden in a page body, if any. */
export function findStreamInBody(body: string, base?: string): string | null {
  const direct = extractStreamUrls(body, base);
  if (direct.length > 0) return direct[0];

  const unpacked = unpackPackedScript(body);
  if (unpacked) {
    const fromUnpacked = extractStreamUrls(unpacked, base);
    if (fromUnpacked.length > 0) return fromUnpacked[0];
  }
  return null;
}

function refererFor(target: string): string {
  try {
    const url = new URL(target);
    return `${url.protocol}//${url.host}/`;
  } catch {
    return "";
  }
}

/**
 * Resolve an embed/player page to a direct stream URL.
 * Returns the URL unchanged when it is already direct or HLS.
 */
export async function resolveStreamUrl(
  rawUrl: string,
  timeoutMs = FETCH_TIMEOUT_MS
): Promise<string | null> {
  if (!rawUrl) return null;
  const url = unwrapProxyUrl(rawUrl.trim());
  if (!/^https?:\/\//i.test(url)) return null;
  if (isDirectVideoUrl(url) || isHlsUrl(url)) return url;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: refererFor(url) || "https://www.google.com/",
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;

    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    if (
      contentType.startsWith("video/") ||
      contentType.includes("mpegurl") ||
      contentType.includes("octet-stream")
    ) {
      return res.url || url;
    }

    const body = (await res.text()).slice(0, MAX_HTML_BYTES);
    return findStreamInBody(body, res.url || url);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
