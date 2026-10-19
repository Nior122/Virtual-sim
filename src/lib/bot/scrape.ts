import type { ScrapedProfile } from "./types";
import { MAX_IMAGES } from "./types";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const IMAGE_RE = /\.(jpe?g|png|webp|gif)(\?|#|$)/i;
const VIDEO_RE = /\.(mp4|webm|mov|m4v|m3u8)(\?|#|$)/i;
const EMBED_RE = /(embed|rubyvidhub|\.html|m3u8)/i;
const MAX_VIDEOS = 20;
const MAX_TEXT = 4000;

function absoluteUrl(candidate: string, base: string): string | null {
  try {
    return new URL(candidate, base).toString();
  } catch {
    return null;
  }
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

function readMeta(html: string, selector: RegExp): string | null {
  const match = html.match(selector);
  return match && match[1] ? decodeHtml(match[1].trim()) : null;
}

/** Matches a meta tag by name/property regardless of attribute order. */
function readMetaPair(html: string, key: string): string | null {
  const tagRe = new RegExp(
    `<meta[^>]+(?:property|name)=["']${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*>`,
    "i"
  );
  const tag = html.match(tagRe);
  if (!tag) return null;
  const content = tag[0].match(/content=["']([^"']+)["']/i);
  return content ? decodeHtml(content[1].trim()) : null;
}

/** Collect JSON-LD blocks (Person, ProfilePage, CreativeWork, etc.). */
function collectJsonLd(html: string): Record<string, any>[] {
  const blocks: Record<string, any>[] = [];
  const re =
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim());
      if (Array.isArray(parsed)) blocks.push(...parsed);
      else if (parsed?.["@graph"]) blocks.push(...parsed["@graph"]);
      else blocks.push(parsed);
    } catch {
      // ignore malformed blocks
    }
  }
  return blocks;
}

function uniquePush(list: string[], value: string | null, cap: number): void {
  if (!value || list.length >= cap) return;
  if (!list.includes(value)) list.push(value);
}

/**
 * Best-effort generic profile scraper for Cloudflare Workers.
 * Uses plain fetch + regex parsing: works for static HTML and JSON-backed
 * pages, but cannot solve JS challenges or Cloudflare browser checks.
 */
export async function scrapeProfile(url: string): Promise<ScrapedProfile> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("That doesn't look like a valid URL.");
  }
  if (!/^https?:$/.test(parsedUrl.protocol)) {
    throw new Error("Only http and https links can be scraped.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  let res: Response;
  try {
    res = await fetch(parsedUrl.toString(), {
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: controller.signal,
    });
  } catch (err) {
    throw new Error(`Fetch failed: ${(err as Error).message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (res.status === 401 || res.status === 403 || res.status === 429) {
    throw new Error(
      `The site blocked the request (HTTP ${res.status}). It likely requires a real browser or has bot protection — try another link or build the profile manually.`
    );
  }
  if (!res.ok) {
    throw new Error(`The site returned HTTP ${res.status}.`);
  }

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("text/html") && !contentType.includes("xml")) {
    throw new Error(`That URL is not an HTML page (got ${contentType || "unknown type"}).`);
  }

  const html = await res.text();

  // Detect bot-wall / challenge pages that still return 200.
  if (
    /just a moment|cf-challenge|challenge-platform|checking your browser|enable javascript and cookies/i.test(
      html
    )
  ) {
    throw new Error(
      "This page is behind a browser/Cloudflare challenge and cannot be scraped from a Worker. Send the media and write-up manually instead."
    );
  }

  const jsonLd = collectJsonLd(html);
  const ld = jsonLd.find((b) =>
    /person|profile|creativework|website/i.test(String(b?.["@type"] ?? ""))
  );

  const title =
    readMetaPair(html, "og:title") ||
    readMeta(html, /<title[^>]*>([\s\S]*?)<\/title>/i) ||
    (typeof ld?.name === "string" ? ld.name : null);

  const description =
    readMetaPair(html, "og:description") ||
    readMetaPair(html, "description") ||
    (typeof ld?.description === "string" ? ld.description : null);

  const images: string[] = [];
  const videos: string[] = [];

  // 1) OpenGraph media (usually the highest-quality signals).
  const ogImage =
    readMetaPair(html, "og:image") || readMetaPair(html, "og:image:secure_url");
  uniquePush(images, absoluteUrl(ogImage || "", url), MAX_IMAGES);
  const ogVideo =
    readMetaPair(html, "og:video") || readMetaPair(html, "og:video:url");
  uniquePush(videos, absoluteUrl(ogVideo || "", url), MAX_VIDEOS);

  // 2) JSON-LD image/contentUrl fields.
  for (const block of jsonLd) {
    const candidates: unknown[] = [block.image, block.contentUrl, block.thumbnail];
    for (const candidate of candidates) {
      const values = Array.isArray(candidate) ? candidate : [candidate];
      for (const value of values) {
        const raw =
          typeof value === "string" ? value : (value as any)?.url ?? null;
        if (!raw) continue;
        const abs = absoluteUrl(raw, url);
        if (!abs) continue;
        if (IMAGE_RE.test(abs)) uniquePush(images, abs, MAX_IMAGES);
        if (VIDEO_RE.test(abs)) uniquePush(videos, abs, MAX_VIDEOS);
      }
    }
  }

  // 3) Generic img/source/video/a href scan.
  const tagRe = /<(?:img|source|video|a)\b[^>]*>/gi;
  let tag: RegExpExecArray | null;
  while ((tag = tagRe.exec(html)) !== null) {
    const srcMatch = tag[0].match(
      /(?:src|href|data-src|data-video-url)=["']([^"']+)["']/i
    );
    if (!srcMatch) continue;
    const abs = absoluteUrl(decodeHtml(srcMatch[1]), url);
    if (!abs || abs.startsWith("data:")) continue;
    if (IMAGE_RE.test(abs)) uniquePush(images, abs, MAX_IMAGES);
    if (VIDEO_RE.test(abs) || EMBED_RE.test(abs)) uniquePush(videos, abs, MAX_VIDEOS);
  }

  // 4) Plain text excerpt for Groq context, with tags stripped.
  const textSnippet = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT);

  if (!title && !description && images.length === 0 && videos.length === 0) {
    throw new Error(
      "No usable profile data found on that page (it may render entirely in JavaScript)."
    );
  }

  return {
    sourceUrl: parsedUrl.toString(),
    title,
    description,
    images: images.slice(0, MAX_IMAGES),
    videos: videos.slice(0, MAX_VIDEOS),
    textSnippet: textSnippet || undefined,
  };
}
