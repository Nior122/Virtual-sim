import type { ScrapedProfile } from "./types";
import { MAX_IMAGES } from "./types";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// ---------------------------------------------------------------------------
// Media URL classifiers
// ---------------------------------------------------------------------------
// Profile photos are JPEG only: PNG/WebP/GIF are often thumbnails, SVG files
// are site chrome, and the persona pipeline wants one predictable format.
const PHOTO_RE = /\.jpe?g(\?|#|$)/i;
const PHOTO_QUERY_RE = /[?&](?:fm|format|f)=jpe?g(&|#|$)/i;
const SVG_RE = /\.svg(\?|#|$)/i;
// Explicitly non-JPEG image files. CDN transform URLs that ask for JPEG
// (?fm=jpg) still count as JPEG.
const NON_JPEG_IMAGE_RE =
  /\.(png|webp|gif|bmp|avif|heic|heif|tiff?)(\?|#|$)/i;
// Things that are definitely not an image regardless of extension.
const NOT_IMAGE_RE =
  /\.(mp4|webm|mov|m4v|m3u8|html?|xhtml|pdf|zip|rar|js|mjs|css|json|xml|txt)($|[?#])/i;
const VIDEO_RE = /\.(mp4|webm|mov|m4v|m3u8)(\?|#|$)/i;
const EMBED_RE = /(embed|rubyvidhub|\.html|m3u8)/i;
const JUNK_IMG_RE =
  /favicon|logo|sprite|placeholder|loader|loading|spinner|\/icons?\/|emoji|1x1|pixel|blank|avatar-default|default-avatar/i;

// ---------------------------------------------------------------------------
// Scrape limits
// ---------------------------------------------------------------------------
/** How many videos a scrape collects when the caller does not ask for a count. */
export const DEFAULT_VIDEO_LIMIT = 50;
export const MAX_VIDEO_LIMIT = 50;
export const DEFAULT_MAX_PAGES = 5;
export const HARD_MAX_PAGES = 10;

const MAX_TEXT = 4000;
const FETCH_TIMEOUT_MS = 20000;

export interface ScrapeOptions {
  videoLimit?: number;
  imageLimit?: number;
  maxPages?: number;
  /** Set false to skip image work (video-only scrapes in bulk mode) */
  images?: boolean;
  /** Set false to skip video work (image-only scrapes in bulk mode) */
  videos?: boolean;
  /** Cap on image content-type probes (Workers subrequest budget) */
  maxImageChecks?: number;
  /**
   * How many post/detail pages to open because many sites only expose the
   * real image after clicking a thumbnail. 0 disables detail crawling.
   */
  detailPages?: number;
}

/** Detail pages opened per scrape when the caller does not ask for a count. */
export const DEFAULT_DETAIL_PAGES = 4;
export const HARD_MAX_DETAIL_PAGES = 6;

/** Content-type probes allowed per scrape (Workers subrequest budget). */
const MAX_IMAGE_CHECKS = 12;

/** True for URLs that are JPEG by their name/query, no network call needed. */
export function isPhotoUrl(url: string): boolean {
  if (!url) return false;
  if (SVG_RE.test(url)) return false;
  if (NON_JPEG_IMAGE_RE.test(url) && !PHOTO_QUERY_RE.test(url)) return false;
  return PHOTO_RE.test(url) || PHOTO_QUERY_RE.test(url);
}

/**
 * Could this URL still be a JPEG even without a .jpg suffix?
 * CDNs often serve photos from extensionless paths (`/media/8f3a…/1280`), so
 * these are verified with a content-type probe instead of being dropped.
 */
export function isImageCandidate(url: string): boolean {
  if (!url) return false;
  const value = url.trim();
  if (!value || value.startsWith("data:")) return false;
  if (SVG_RE.test(value)) return false;
  if (JUNK_IMG_RE.test(value)) return false;
  if (isPhotoUrl(value)) return true;
  if (NON_JPEG_IMAGE_RE.test(value) && !PHOTO_QUERY_RE.test(value)) return false;
  if (NOT_IMAGE_RE.test(value)) return false;
  return true;
}

/** Best (largest) candidate in a `srcset` / `data-srcset` attribute. */
export function largestFromSrcset(value: string | null): string | null {
  if (!value) return null;
  let best: { url: string; weight: number } | null = null;
  for (const part of value.split(",")) {
    const pieces = part.trim().split(/\s+/).filter(Boolean);
    if (pieces.length === 0) continue;
    const url = pieces[0];
    let weight = 0;
    for (const descriptor of pieces.slice(1)) {
      const width = descriptor.match(/^(\d+)(w|h)?$/i);
      if (width) weight = Math.max(weight, parseInt(width[1], 10));
      const density = descriptor.match(/^(\d+(?:\.\d+)?)x$/i);
      if (density) weight = Math.max(weight, Math.round(parseFloat(density[1]) * 1000));
    }
    if (!best || weight > best.weight) best = { url, weight };
  }
  return best ? best.url : null;
}

/** Read one HTML attribute, tolerating single/double/unquoted values. */
function readAttr(tag: string, name: string): string | null {
  const re = new RegExp(
    `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i"
  );
  const match = tag.match(re);
  if (!match) return null;
  const raw = (match[1] ?? match[2] ?? match[3] ?? "").trim();
  return raw ? decodeHtml(raw) : null;
}

const IMAGE_ATTRS = [
  "src",
  "data-src",
  "data-original",
  "data-lazy-src",
  "data-image",
  "data-full",
  "data-large",
  "data-zoom-image",
  "data-original-src",
];

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
// Image collection (thumbnails, srcset, lazyload attributes) + verification
// ---------------------------------------------------------------------------
export interface ImageGroups {
  /** The page's declared main image(s): OpenGraph, Twitter, JSON-LD. */
  primary: string[];
  /** Thumbnails and gallery images from the markup. */
  secondary: string[];
}

/** Flat, ordered list of every image candidate on a page. */
export function collectImageCandidates(html: string, pageUrl: string): string[] {
  const groups = collectImageGroups(html, pageUrl);
  return [
    ...groups.primary,
    ...groups.secondary.filter((url) => !groups.primary.includes(url)),
  ];
}

/**
 * Split a page's image candidates into the declared main image(s) and the
 * thumbnails/lazy backgrounds. The scraper ranks post-page images above
 * listing thumbnails, which is what makes "the real photo is inside the post"
 * sites work.
 */
export function collectImageGroups(html: string, pageUrl: string): ImageGroups {
  const primary: string[] = [];
  const secondary: string[] = [];
  const makePush = (target: string[]) => (raw: string | null) => {
    if (!raw || target.length >= 40) return;
    const abs = absoluteUrl(raw, pageUrl);
    if (!abs) return;
    if (!isImageCandidate(abs)) return;
    if (!target.includes(abs)) target.push(abs);
  };
  const pushPrimary = makePush(primary);
  const push = makePush(secondary);

  pushPrimary(readMetaPair(html, "og:image"));
  pushPrimary(readMetaPair(html, "og:image:secure_url"));
  pushPrimary(readMetaPair(html, "og:image:url"));
  pushPrimary(readMetaPair(html, "twitter:image"));
  pushPrimary(readMetaPair(html, "twitter:image:src"));

  for (const block of collectJsonLd(html)) {
    for (const value of [block.image, block.thumbnail, block.contentUrl]) {
      const values = Array.isArray(value) ? value : [value];
      for (const entry of values) {
        const raw =
          typeof entry === "string" ? entry : (entry as any)?.url ?? null;
        pushPrimary(raw);
      }
    }
  }

  const tagRe = /<(?:img|source)\b[^>]*>/gi;
  let tag: RegExpExecArray | null;
  while ((tag = tagRe.exec(html)) !== null && secondary.length < 40) {
    // Prefer the largest responsive candidate, then the plain attributes.
    push(largestFromSrcset(readAttr(tag[0], "srcset")));
    push(largestFromSrcset(readAttr(tag[0], "data-srcset")));
    for (const attribute of IMAGE_ATTRS) push(readAttr(tag[0], attribute));
  }

  // <video poster="…"> thumbnails.
  const posterRe = /<video\b[^>]*>/gi;
  while ((tag = posterRe.exec(html)) !== null && secondary.length < 40) {
    push(readAttr(tag[0], "poster"));
  }

  // Full-size image links wrapped around thumbnails.
  const anchorRe = /<a\b[^>]*>/gi;
  while ((tag = anchorRe.exec(html)) !== null && secondary.length < 40) {
    const href = readAttr(tag[0], "href");
    if (href) {
      const abs = absoluteUrl(href, pageUrl) || "";
      if (/^https?:\/\//i.test(abs) && isPhotoUrl(abs)) push(href);
    }
  }

  // Lazy-background thumbnails and inline CSS background images.
  const backgroundAttrRe =
    /\b(?:data-bg|data-background|data-bg-src|data-bgset|data-thumb|data-image-src|data-poster|data-thumbnail)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  while ((tag = backgroundAttrRe.exec(html)) !== null && secondary.length < 40) {
    push(largestFromSrcset(tag[1] ?? tag[2] ?? null) ?? (tag[1] ?? tag[2] ?? null));
  }
  const cssUrlRe = /background(?:-image)?\s*:\s*[^;"'}]*url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;
  while ((tag = cssUrlRe.exec(html)) !== null && secondary.length < 40) {
    push(tag[1]);
  }

  // <meta itemprop="image" content="…">
  const itempropRe =
    /<meta[^>]+itemprop=["']image["'][^>]*>/gi;
  while ((tag = itempropRe.exec(html)) !== null && primary.length < 40) {
    push(readAttr(tag[0], "content"));
  }

  return { primary, secondary };
}

/** Probe a URL and report whether the server actually returns a JPEG. */
export async function isJpegResponse(
  url: string,
  referer: string
): Promise<boolean> {
  const headers: Record<string, string> = {
    "User-Agent": BROWSER_UA,
    Accept: "image/jpeg,image/*;q=0.8,*/*;q=0.5",
    Referer: referer,
  };
  const isJpeg = (res: Response) => {
    const type = (res.headers.get("content-type") || "").toLowerCase();
    return type.startsWith("image/jpeg") || type.startsWith("image/jpg");
  };

  const attempt = async (
    method: "HEAD" | "GET",
    extra: Record<string, string> = {}
  ): Promise<boolean | null> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch(url, {
        method,
        headers: { ...headers, ...extra },
        redirect: "follow",
        signal: controller.signal,
      });
      if (!res.ok && res.status !== 206) {
        res.body?.cancel().catch(() => {});
        return null;
      }
      const result = isJpeg(res);
      // Do not download the image body: only the headers matter here.
      res.body?.cancel().catch(() => {});
      return result;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  };

  const head = await attempt("HEAD");
  if (head !== null && head) return true;
  // Many CDNs reject HEAD or omit the type there: retry with a 1-byte GET.
  const ranged = await attempt("GET", { Range: "bytes=0-0" });
  return ranged === true;
}

/**
 * Turn ordered candidates into a JPEG image list. Explicit .jpg URLs are
 * accepted immediately; everything else (extensionless CDN paths, unknown
 * extensions) needs a JPEG content-type probe, bounded for the Workers
 * subrequest budget.
 */
export async function resolveImageCandidates(
  candidates: string[],
  limit: number,
  referer: string,
  maxChecks = MAX_IMAGE_CHECKS
): Promise<{ images: string[]; checked: number; rejected: number }> {
  const images: string[] = [];
  let checked = 0;
  let rejected = 0;
  const checkBudget = Math.max(0, Math.min(maxChecks, MAX_IMAGE_CHECKS));
  for (const url of candidates) {
    if (images.length >= limit) break;
    if (isPhotoUrl(url)) {
      images.push(url);
      continue;
    }
    if (checked >= checkBudget) break;
    checked += 1;
    if (await isJpegResponse(url, referer)) images.push(url);
    else rejected += 1;
  }
  return { images, checked, rejected };
}

// ---------------------------------------------------------------------------
// Detail ("post") pages — where sites hide the main image behind a thumbnail
// ---------------------------------------------------------------------------
const DETAIL_PATH_RE =
  /\/(?:post|posts|photo|photos|pic|pics|media|video|videos|clip|clips|gallery|galleries|watch|view|item|items|content|detail|details|album|albums|p|e)\/|\/\d{3,}(?:\/|$)/i;
const NON_DETAIL_PATH_RE =
  /(?:login|logout|signin|signup|sign-up|register|account|cart|checkout|contact|about|terms|privacy|faq|dmca|help|support|search|tag\/|tags\/|category\/|categories\/|page\/|sort=|filter=|\/feed|\/rss)/i;

/**
 * Links that look like individual posts/galleries on the same site, in page
 * order. Off-site links, pagination, navigation and media files are skipped.
 */
export function collectDetailLinks(
  html: string,
  pageUrl: string,
  visited: Set<string>
): string[] {
  const current = new URL(pageUrl);
  const links: string[] = [];
  const anchorRe = /<a\b[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = anchorRe.exec(html)) !== null) {
    const href = readAttr(match[0], "href");
    if (!href) continue;
    const abs = absoluteUrl(href, pageUrl);
    if (!abs) continue;

    let parsed: URL;
    try {
      parsed = new URL(abs);
    } catch {
      continue;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
    if (parsed.hostname !== current.hostname) continue;
    parsed.hash = "";
    const normalized = parsed.toString();
    if (normalized === stripHash(pageUrl) || visited.has(normalized)) continue;
    if (links.includes(normalized)) continue;

    const path = parsed.pathname;
    if (NOT_IMAGE_RE.test(path) || isPhotoUrl(path)) continue;
    if (NON_DETAIL_PATH_RE.test(`${path}?${parsed.search}`)) continue;
    if (pageNumber(normalized) !== null) continue;

    // A post link either sits on a post-like path, or wraps a thumbnail.
    const wrapsImage = /<img\b/i.test(match[1]);
    if (!DETAIL_PATH_RE.test(path) && !wrapsImage) continue;
    links.push(normalized);
    if (links.length >= 24) break;
  }

  return links;
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
  const detailPages = clampInt(
    options.detailPages,
    DEFAULT_DETAIL_PAGES,
    0,
    HARD_MAX_DETAIL_PAGES
  );
  // Bulk mode scrapes images from one URL and videos from another, so each
  // half can be switched off to save subrequests.
  const wantImages = options.images !== false;
  const wantVideos = options.videos !== false;

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
  // Ranked image candidates: the page's own og/twitter/JSON-LD image first,
  // then images pulled from individual post pages (where the real photo often
  // lives), then listing thumbnails/lazy backgrounds.
  const primaryCandidates: string[] = [];
  const detailCandidates: string[] = [];
  const listingCandidates: string[] = [];
  const videos: string[] = [];
  const sourceUrls: string[] = [];
  const visited = new Set<string>();
  let pagesScanned = 0;
  let detailPagesScanned = 0;
  let detailLinksTried = new Set<string>();
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

    // 1 + 2 + 3) Images: OpenGraph, JSON-LD, <img>/<source> (incl. srcset and
    // lazy-load attributes) and full-size image links. Candidates are only
    // resolved to JPEGs after the crawl, with content-type probes.
    if (wantImages) {
      const pageImages = collectImageGroups(html, pageUrl);
      for (const candidate of pageImages.primary) {
        uniquePush(primaryCandidates, candidate, 40);
      }
      for (const candidate of pageImages.secondary) {
        uniquePush(listingCandidates, candidate, 40);
      }
    }

    // Videos: OpenGraph, JSON-LD, tags and inline script JSON.
    if (wantVideos) {
    const ogVideo =
      readMetaPair(html, "og:video") || readMetaPair(html, "og:video:url");
    if (ogVideo) uniquePush(videos, absoluteUrl(ogVideo, pageUrl), videoLimit);

    for (const block of jsonLd) {
      for (const candidate of [block.contentUrl, block.video]) {
        const values = Array.isArray(candidate) ? candidate : [candidate];
        for (const value of values) {
          const raw =
            typeof value === "string" ? value : (value as any)?.url ?? null;
          if (!raw) continue;
          const abs = absoluteUrl(raw, pageUrl);
          if (abs && VIDEO_RE.test(abs)) uniquePush(videos, abs, videoLimit);
        }
      }
    }

    const tagRe = /<(?:source|video|a)\b[^>]*>/gi;
    let tag: RegExpExecArray | null;
    while ((tag = tagRe.exec(html)) !== null) {
      const srcMatch = tag[0].match(
        /(?:src|href|data-src|data-video-url)=["']([^"']+)["']/i
      );
      if (!srcMatch) continue;
      const abs = absoluteUrl(decodeHtml(srcMatch[1]), pageUrl);
      if (!abs || abs.startsWith("data:")) continue;
      if (VIDEO_RE.test(abs) || EMBED_RE.test(abs)) {
        uniquePush(videos, abs, videoLimit);
      }
    }

    for (const scripted of extractVideosFromScripts(html, pageUrl, videoLimit)) {
      uniquePush(videos, scripted, videoLimit);
    }
    }

    // 4) Open the individual post pages: many sites keep the real image (and
    //    extra clips) behind a thumbnail that only appears on the detail page.
    const wantMoreImages =
      wantImages && primaryCandidates.length + detailCandidates.length < 40;
    const wantMoreVideos = wantVideos && videos.length < videoLimit;
    if (detailPagesScanned < detailPages && (wantMoreImages || wantMoreVideos)) {
      const detailLinks = collectDetailLinks(html, pageUrl, visited).filter(
        (link) => !detailLinksTried.has(link)
      );
      for (const link of detailLinks) {
        if (detailPagesScanned >= detailPages) break;
        if (videos.length >= videoLimit && detailCandidates.length >= 40) break;
        detailLinksTried.add(link);
        let detailHtml: string;
        try {
          detailHtml = await fetchHtml(link);
        } catch {
          continue; // a dead post must not lose the rest of the scrape
        }
        detailPagesScanned += 1;
        visited.add(link);
        sourceUrls.push(link);
        if (wantMoreImages) {
          const detailImages = collectImageGroups(detailHtml, link);
          for (const candidate of detailImages.primary) {
            uniquePush(detailCandidates, candidate, 40);
          }
          for (const candidate of detailImages.secondary) {
            uniquePush(detailCandidates, candidate, 40);
          }
        }
        if (wantMoreVideos) {
          for (const scripted of extractVideosFromScripts(
            detailHtml,
            link,
            videoLimit
          )) {
            uniquePush(videos, scripted, videoLimit);
          }
          const detailVideo =
            readMetaPair(detailHtml, "og:video") ||
            readMetaPair(detailHtml, "og:video:url");
          const detailVideoUrl = detailVideo
            ? absoluteUrl(detailVideo, link)
            : null;
          if (detailVideoUrl) uniquePush(videos, detailVideoUrl, videoLimit);
        }
      }
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

  const orderedCandidates: string[] = [];
  if (wantImages) {
    for (const candidate of [
      ...primaryCandidates,
      ...detailCandidates,
      ...listingCandidates,
    ]) {
      if (orderedCandidates.length >= 40) break;
      if (!orderedCandidates.includes(candidate)) orderedCandidates.push(candidate);
    }
  }

  const { images, rejected, checked } = await resolveImageCandidates(
    orderedCandidates,
    imageLimit,
    startUrl,
    options.maxImageChecks
  );

  if (!title && !description && images.length === 0 && videos.length === 0) {
    throw new Error(
      "No usable profile data found on that page (it may render entirely in JavaScript)."
    );
  }

  return {
    sourceUrl: startUrl,
    title,
    description,
    images,
    videos: videos.slice(0, videoLimit),
    textSnippet: textSnippet || undefined,
    pagesScanned,
    sourceUrls,
    imageCandidates: orderedCandidates.length,
    imageChecks: checked,
    imagesRejected: rejected,
    detailPagesScanned,
  };
}
