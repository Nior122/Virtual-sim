import type { ScrapedProfile } from "./types";
import { MAX_IMAGES } from "./types";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// ---------------------------------------------------------------------------
// Media URL classifiers
// ---------------------------------------------------------------------------
// Profile photos are JPEG/PNG only: webp/gif are often thumbnails, and SVG
// files are site chrome that would end up as broken persona images.
const PHOTO_RE = /\.(jpe?g|png)(\?|#|$)/i;
const PHOTO_QUERY_RE = /[?&](?:fm|format|f)=(?:jpe?g|png)(&|#|$)/i;
const SVG_RE = /\.svg(\?|#|$)/i;
const VIDEO_RE = /\.(mp4|webm|mov|m4v|m3u8)(\?|#|$)/i;
const EMBED_RE = /(embed|rubyvidhub|\.html|m3u8)/i;
const JUNK_IMG_RE =
  /favicon|logo|sprite|placeholder|loader|loading|spinner|\/icons?\/|emoji|1x1|pixel|blank|avatar-default|default-avatar/i;

// ---------------------------------------------------------------------------
// Scrape limits
// ---------------------------------------------------------------------------
export const DEFAULT_VIDEO_LIMIT = 20;
export const MAX_VIDEO_LIMIT = 50;
export const DEFAULT_MAX_PAGES = 5;
export const HARD_MAX_PAGES = 10;

const MAX_TEXT = 4000;
const FETCH_TIMEOUT_MS = 20000;

export interface ScrapeOptions {
  videoLimit?: number;
  imageLimit?: number;
  maxPages?: number;
}

/** True for JPEG/PNG URLs (including format= query params), never SVG. */
export function isPhotoUrl(url: string): boolean {
  if (!url) return false;
  if (SVG_RE.test(url)) return false;
  return PHOTO_RE.test(url) || PHOTO_QUERY_RE.test(url);
}

function clampInt(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

// ---------------------------------------------------------------------------
// Small HTML helpers
// ---------------------------------------------------------------------------
function absoluteUrl(candidate: string, base: string): string | null {
  try {
    return new URL(candidate, base).toString();
  } catch {
    return null;
  }
}

function stripHash(url: string): string {
  const index = url.indexOf("#");
  return index === -1 ? url : url.slice(0, index);
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
 * Pull video URLs out of inline script JSON (e.g. `window.__DATA__` state).
 * Sites frequently keep the real clip URLs there, which is why a plain tag
 * scan only ever found the single OpenGraph video.
 */
export function extractVideosFromScripts(
  html: string,
  base: string,
  cap: number
): string[] {
  const found: string[] = [];
  const scriptRe = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  const urlRe =
    /https?:\/\/[^"'\s<>()\\]+?\.(?:mp4|webm|mov|m4v|m3u8)(?:\?[^"'\s<>()\\]*)?/gi;
  let script: RegExpExecArray | null;
  while ((script = scriptRe.exec(html)) !== null) {
    if (found.length >= cap) break;
    // Script JSON escapes slashes ("https:\/\/cdn…"), so unescape first.
    const body = script[1].replace(/\\\//g, "/");
    urlRe.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = urlRe.exec(body)) !== null) {
      const abs = absoluteUrl(match[0], base);
      if (abs) uniquePush(found, abs, cap);
      if (found.length >= cap) break;
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Pagination detection
// ---------------------------------------------------------------------------
interface Anchor {
  attrs: string;
  href: string | null;
  text: string;
}

function parseAnchors(html: string): Anchor[] {
  const anchors: Anchor[] = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const hrefMatch = m[1].match(/\bhref\s*=\s*["']([^"']+)["']/i);
    const text = decodeHtml(
      m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
    );
    anchors.push({
      attrs: m[1],
      href: hrefMatch ? decodeHtml(hrefMatch[1].trim()) : null,
      text,
    });
  }
  return anchors;
}

/** Page number encoded in a URL, e.g. ?page=2, ?p=2, ?pg=2 or /page/2/. */
function pageNumber(url: string): number | null {
  const query = url.match(/[?&](?:page|p|pg)=(\d+)/i);
  if (query) return parseInt(query[1], 10);
  const path = url.match(/\/page\/(\d+)\/?/i);
  if (path) return parseInt(path[1], 10);
  return null;
}

/**
 * Resolve a pagination candidate against the current page, rejecting
 * off-site links, non-http(s) schemes, fragment-only links and pages that
 * were already scanned.
 */
function resolveNextCandidate(
  candidate: string,
  currentUrl: string,
  hostname: string,
  visited: Set<string>
): string | null {
  const abs = absoluteUrl(candidate, currentUrl);
  if (!abs) return null;
  let parsed: URL;
  try {
    parsed = new URL(abs);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.hostname !== hostname) return null;
  parsed.hash = "";
  const normalized = parsed.toString();
  if (normalized === stripHash(currentUrl)) return null;
  if (visited.has(normalized)) return null;
  return normalized;
}

/**
 * Find the next page of a paginated profile listing. Priority:
 *   1. <a rel="next"> (rel may contain other tokens)
 *   2. anchor text "Next"/"Older"/"More"/"›"/"»"/">>" or aria-label "next"
 *   3. numbered pagination (?page=N, ?p=N, ?pg=N, /page/N/) going forwards
 */
function findNextPage(
  html: string,
  currentUrl: string,
  visited: Set<string>
): string | null {
  const hostname = new URL(currentUrl).hostname;
  const anchors = parseAnchors(html);

  // 1) rel="next" (possibly "nofollow next").
  for (const anchor of anchors) {
    const rel = anchor.attrs.match(/\brel\s*=\s*["']([^"']*)["']/i);
    if (!rel || !anchor.href) continue;
    const tokens = decodeHtml(rel[1]).toLowerCase().split(/\s+/);
    if (!tokens.includes("next")) continue;
    const next = resolveNextCandidate(
      anchor.href,
      currentUrl,
      hostname,
      visited
    );
    if (next) return next;
  }

  // 2) Visible "next"-style link text, or aria-label="… next …".
  for (const anchor of anchors) {
    if (!anchor.href) continue;
    const aria = anchor.attrs.match(/\baria-label\s*=\s*["']([^"']*)["']/i);
    const ariaNext = aria ? /next/i.test(decodeHtml(aria[1])) : false;
    const textNext = /^(next|older|more|›|»|>>)$/i.test(anchor.text);
    if (!ariaNext && !textNext) continue;
    const next = resolveNextCandidate(
      anchor.href,
      currentUrl,
      hostname,
      visited
    );
    if (next) return next;
  }

  // 3) Numbered pagination: pick the smallest page number above the current.
  const currentNumber = pageNumber(currentUrl) ?? 0;
  let best: { number: number; url: string } | null = null;
  for (const anchor of anchors) {
    if (!anchor.href) continue;
    const number = pageNumber(anchor.href);
    if (number === null || number <= currentNumber) continue;
    const next = resolveNextCandidate(
      anchor.href,
      currentUrl,
      hostname,
      visited
    );
    if (!next) continue;
    if (!best || number < best.number) best = { number, url: next };
  }
  return best ? best.url : null;
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------
async function fetchHtml(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
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
    throw new Error(
      `That URL is not an HTML page (got ${contentType || "unknown type"}).`
    );
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

  return html;
}

// ---------------------------------------------------------------------------
// Profile scraper
// ---------------------------------------------------------------------------
/**
 * Best-effort generic profile scraper for Cloudflare Workers.
 * Uses plain fetch + regex parsing: works for static HTML and JSON-backed
 * pages, but cannot solve JS challenges or Cloudflare browser checks.
 *
 * Pagination: follows rel="next", "Next"-style links and numbered pagination
 * until maxPages or the video limit is reached. Images are taken from the
 * first page only (avatars repeat on later pages); videos are collected from
 * every page.
 */
export async function scrapeProfile(
  url: string,
  options: ScrapeOptions = {}
): Promise<ScrapedProfile> {
  const videoLimit = clampInt(
    options.videoLimit,
    DEFAULT_VIDEO_LIMIT,
    1,
    MAX_VIDEO_LIMIT
  );
  const imageLimit = clampInt(options.imageLimit, MAX_IMAGES, 1, MAX_IMAGES);
  const maxPages = clampInt(
    options.maxPages,
    DEFAULT_MAX_PAGES,
    1,
    HARD_MAX_PAGES
  );

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("That doesn't look like a valid URL.");
  }
  if (!/^https?:$/.test(parsedUrl.protocol)) {
    throw new Error("Only http and https links can be scraped.");
  }

  const startUrl = stripHash(parsedUrl.toString());
  const images: string[] = [];
  const videos: string[] = [];
  const sourceUrls: string[] = [];
  const visited = new Set<string>();
  let pagesScanned = 0;
  let title: string | null = null;
  let description: string | null = null;
  let textSnippet = "";

  let currentUrl: string | null = startUrl;
  while (currentUrl && pagesScanned < maxPages) {
    let html: string;
    try {
      html = await fetchHtml(currentUrl);
    } catch (err) {
      // A dead later page must not lose what was already collected.
      if (pagesScanned === 0) throw err;
      break;
    }

    visited.add(currentUrl);
    sourceUrls.push(currentUrl);
    pagesScanned += 1;
    const isFirstPage = pagesScanned === 1;
    const pageUrl = currentUrl;

    const jsonLd = collectJsonLd(html);

    if (isFirstPage) {
      const ld = jsonLd.find((b) =>
        /person|profile|creativework|website/i.test(String(b?.["@type"] ?? ""))
      );
      title =
        readMetaPair(html, "og:title") ||
        readMeta(html, /<title[^>]*>([\s\S]*?)<\/title>/i) ||
        (typeof ld?.name === "string" ? ld.name : null);
      description =
        readMetaPair(html, "og:description") ||
        readMetaPair(html, "description") ||
        (typeof ld?.description === "string" ? ld.description : null);
    }

    // 1) OpenGraph media (usually the highest-quality signals).
    if (isFirstPage) {
      const ogImage =
        readMetaPair(html, "og:image") ||
        readMetaPair(html, "og:image:secure_url");
      if (ogImage) {
        const abs = absoluteUrl(ogImage, pageUrl);
        if (abs && isPhotoUrl(abs)) uniquePush(images, abs, imageLimit);
      }
    }
    const ogVideo =
      readMetaPair(html, "og:video") || readMetaPair(html, "og:video:url");
    if (ogVideo) uniquePush(videos, absoluteUrl(ogVideo, pageUrl), videoLimit);

    // 2) JSON-LD image/contentUrl/video fields.
    for (const block of jsonLd) {
      const candidates: unknown[] = [
        block.image,
        block.contentUrl,
        block.thumbnail,
        block.video,
      ];
      for (const candidate of candidates) {
        const values = Array.isArray(candidate) ? candidate : [candidate];
        for (const value of values) {
          const raw =
            typeof value === "string" ? value : (value as any)?.url ?? null;
          if (!raw) continue;
          const abs = absoluteUrl(raw, pageUrl);
          if (!abs) continue;
          if (isFirstPage && isPhotoUrl(abs)) {
            uniquePush(images, abs, imageLimit);
          }
          if (VIDEO_RE.test(abs)) uniquePush(videos, abs, videoLimit);
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
      const abs = absoluteUrl(decodeHtml(srcMatch[1]), pageUrl);
      if (!abs || abs.startsWith("data:")) continue;
      if (isFirstPage && isPhotoUrl(abs) && !JUNK_IMG_RE.test(abs)) {
        uniquePush(images, abs, imageLimit);
      }
      if (VIDEO_RE.test(abs) || EMBED_RE.test(abs)) {
        uniquePush(videos, abs, videoLimit);
      }
    }

    // 4) Inline script JSON (window state) — where most clip URLs live.
    for (const scripted of extractVideosFromScripts(
      html,
      pageUrl,
      videoLimit
    )) {
      uniquePush(videos, scripted, videoLimit);
    }

    // 5) Plain text excerpt for the AI writer, with tags stripped (page 1).
    if (isFirstPage) {
      textSnippet = html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, MAX_TEXT);
    }

    if (videos.length >= videoLimit) break;

    // A later page without a usable "next" link already fills the results.
    currentUrl = findNextPage(html, pageUrl, visited);
  }

  if (!title && !description && images.length === 0 && videos.length === 0) {
    throw new Error(
      "No usable profile data found on that page (it may render entirely in JavaScript)."
    );
  }

  return {
    sourceUrl: startUrl,
    title,
    description,
    images: images.slice(0, imageLimit),
    videos: videos.slice(0, videoLimit),
    textSnippet: textSnippet || undefined,
    pagesScanned,
    sourceUrls,
  };
}
