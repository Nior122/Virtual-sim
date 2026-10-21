// ---------------------------------------------------------------------------
// Bulk profile generation.
//
// A bulk list is one or more entries separated by a comma, semicolon, pipe or
// newline. Each entry is either
//
//     https://site.com/profile
//
// (images AND videos come from that page) or
//
//     https://site.com/profile & https://site.com/videos
//
// (images from the first URL, videos from the second). `images:` / `videos:`
// labels are accepted too.
// ---------------------------------------------------------------------------
import type {
  BulkEntry,
  Env,
  PersonaDraft,
  PreparedBulkEntry,
  ScrapedProfile,
} from "./types";
import { MAX_GALLERY, MAX_IMAGES } from "./types";
import { isPhotoUrl, scrapeProfile } from "./scrape";
import { generatePersonaDraft } from "./groq";
import { addVideo, buildPersonaPayload, createPersona, uniqueSlug } from "./repo";
import { getPublicPersonaBySlug } from "../db/neon";
import { newPlaybackBudget, prepareVideoUrls } from "./videos";
import { profileLink, publicBaseUrl } from "./public-url";

export const MAX_BULK_ENTRIES = 25;
/** Entries processed per invocation (keeps wall time and subrequests sane) */
export const MAX_BULK_PER_CALL = 6;

const URL_TOKEN_RE = /https?:\/\/[^\s,;|<>]+/i;

function trimUrl(value: string): string {
  return value.trim().replace(/[).,'";]+$/, "");
}

/** Extract the URLs of one entry, in order, ignoring duplicates. */
function entryUrls(raw: string): string[] {
  const urls: string[] = [];
  const matches = raw.match(new RegExp(URL_TOKEN_RE.source, "gi")) || [];
  for (const match of matches) {
    const url = trimUrl(match);
    if (url && !urls.includes(url)) urls.push(url);
  }
  return urls;
}

/** Turn one raw entry into an image source and a video source. */
function parseEntry(raw: string): BulkEntry | null {
  const labeledImages = raw.match(
    /(?:images?|img)\s*[:=]\s*(https?:\/\/[^\s,;|<>]+)/i
  );
  const labeledVideos = raw.match(
    /(?:videos?|vids?)\s*[:=]\s*(https?:\/\/[^\s,;|<>]+)/i
  );
  if (labeledImages || labeledVideos) {
    const imageSource = trimUrl(
      labeledImages?.[1] || labeledVideos?.[1] || ""
    );
    const videoSource = trimUrl(labeledVideos?.[1] || imageSource);
    if (!imageSource) return null;
    return { raw, imageSource, videoSource };
  }

  const urls = entryUrls(raw);
  if (urls.length === 0) return null;
  // One URL: scrape images and videos from it. Two: images then videos.
  return {
    raw,
    imageSource: urls[0],
    videoSource: urls[1] || urls[0],
  };
}

/**
 * Parse a bulk list. Entries are separated by a newline, comma, semicolon or
 * pipe — but only when a URL follows, so query strings and comma-containing
 * paths are not split.
 */
export function parseBulkList(input: string): {
  entries: BulkEntry[];
  skipped: string[];
  overflow: number;
} {
  const skipped: string[] = [];
  const entries: BulkEntry[] = [];
  let overflow = 0;

  const chunks = input
    .split(/\s*(?:\r?\n|,|;|\|)+\s*(?=https?:\/\/)/i)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  for (const chunk of chunks) {
    // One chunk can still contain several entries when they were written on
    // separate lines without a trailing separator.
    for (const piece of chunk.split(/\s*(?:\r?\n)+\s*/)) {
      const entry = parseEntry(piece.trim());
      if (!entry) {
        if (piece.trim()) skipped.push(piece.trim());
        continue;
      }
      if (entries.length >= MAX_BULK_ENTRIES) {
        overflow += 1;
        continue;
      }
      entries.push(entry);
    }
  }

  return { entries, skipped, overflow };
}

// ---------------------------------------------------------------------------
// Own-site profile links are read from Neon instead of being scraped: the
// site is a single-page app, so its HTML has no media in it.
// ---------------------------------------------------------------------------
export function ownSiteSlug(
  url: string,
  env: Env,
  requestOrigin: string
): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  // Normalise both bases first: a PUBLIC_BASE_URL without a scheme used to
  // make every own-site link look external (and un-scrapable).
  const hosts = new Set<string>();
  for (const candidate of [publicBaseUrl(env, requestOrigin), requestOrigin]) {
    if (!candidate) continue;
    try {
      hosts.add(new URL(candidate).host.toLowerCase());
    } catch {
      // ignore malformed base URLs
    }
  }
  if (!hosts.has(parsed.host.toLowerCase())) return null;

  const segments = parsed.pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1] || "";
  if (!/^[a-z0-9][a-z0-9-]{1,79}$/i.test(last)) return null;
  return last.toLowerCase();
}

/** Build a ScrapedProfile from one of our own personas. */
async function loadOwnProfile(
  env: Env,
  slug: string
): Promise<ScrapedProfile | null> {
  const persona = await getPublicPersonaBySlug(env, slug);
  if (!persona) return null;

  const gallery = String(persona.gallery || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const images = [
    persona.profileImage as string | null,
    persona.coverImage as string | null,
    ...gallery,
  ].filter((url): url is string => Boolean(url));

  const videos = ((persona.videos as Array<{ url?: string }>) || [])
    .map((video) => video.url || "")
    .filter(Boolean);

  return {
    sourceUrl: profileLink(env, "", slug),
    title: (persona.name as string) || slug,
    description: (persona.description as string) || undefined,
    images: images.slice(0, MAX_IMAGES),
    videos,
    textSnippet: [
      persona.shortBio,
      persona.longBio,
      persona.personality,
      persona.interests,
      persona.background,
    ]
      .filter(Boolean)
      .join(" ")
      .slice(0, 2000) || undefined,
    pagesScanned: 1,
    sourceUrls: [`/dreamgirl/${slug}`],
    imageCandidates: images.length,
    imagesRejected: 0,
    detailPagesScanned: 0,
    imageChecks: 0,
  };
}

// ---------------------------------------------------------------------------
// Fallback persona when the AI provider is unavailable
// ---------------------------------------------------------------------------
function cleanName(title: string | undefined, sourceUrl: string): string {
  const fromTitle = (title || "")
    .split(/\s+[|\-–—]\s+/)[0]
    .replace(/\s+/g, " ")
    .trim();
  if (fromTitle.length >= 2 && fromTitle.length <= 60) return fromTitle;
  try {
    const segments = new URL(sourceUrl).pathname.split("/").filter(Boolean);
    const slug = segments[segments.length - 1] || "profile";
    return slug
      .replace(/[-_]+/g, " ")
      .replace(/\d+$/g, "")
      .trim()
      .replace(/\b\w/g, (character) => character.toUpperCase())
      .slice(0, 60) || "New Profile";
  } catch {
    return "New Profile";
  }
}

export function fallbackPersona(
  scraped: ScrapedProfile,
  sourceUrl: string
): PersonaDraft {
  const name = cleanName(scraped.title, sourceUrl);
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "profile";
  const description = (
    scraped.description ||
    (scraped.textSnippet || "").split(/(?<=\.)\s/)[0] ||
    `Meet ${name}.`
  )
    .replace(/\s+/g, " ")
    .slice(0, 155);

  return {
    name,
    slug,
    description,
    age: null,
    city: null,
    country: null,
    occupation: null,
    languages: null,
    shortBio: null,
    longBio: null,
    personality: "warm, playful, curious",
    background: `Grew up with a camera in hand and a soft spot for late-night conversations.`,
    interests: "music, travel, good conversation",
    hobbies: null,
    likes: null,
    dislikes: null,
    speakingStyle: "short, casual, friendly messages",
    communicationTone: "Playful and friendly",
    flirtLevel: 3,
    emojiFrequency: "Medium",
    bodyType: null,
    height: null,
    eyeColor: null,
    hairColor: null,
    turnOns: null,
    turnOffs: null,
    fantasies: null,
    intimacyStyle: null,
    preferredVibe: null,
    kinksAndFetishes: null,
    eroticInterests: null,
    systemPrompt:
      `You are ${name}: warm, playful and curious. You text like a real ` +
      `person on your phone — short replies, natural slang, never scripted.`,
  };
}

// ---------------------------------------------------------------------------
// One bulk entry → one published profile
// ---------------------------------------------------------------------------
export interface BulkResult {
  raw: string;
  ok: boolean;
  name?: string;
  slug?: string;
  link?: string;
  images?: number;
  videos?: number;
  skippedVideos?: number;
  usedFallbackText?: boolean;
  error?: string;
  /** Approximate subrequests spent, for the per-call budget */
  subrequests: number;
}

export interface BulkRunOptions {
  /** Pages followed per source (default 2 — bulk stays lean) */
  maxPages?: number;
  /** Post pages opened per source (default 2) */
  detailPages?: number;
  /** Videos collected per entry (default 50) */
  videoLimit?: number;
}

const DIRECT_VIDEO_RE = /\.(?:mp4|webm|mov|m4v|m3u8)(?:\?|#|$)/i;

/**
 * Name a profile from a direct file URL, e.g. `/models/ava-01.jpg` → "Ava".
 * Used when an entry points straight at a JPEG instead of a page.
 */
function nameFromFileUrl(url: string): string {
  try {
    const last = decodeURIComponent(
      new URL(url).pathname.split("/").filter(Boolean).pop() || ""
    );
    const cleaned = last
      .replace(/\.[a-z0-9]{2,5}$/i, "")
      .replace(/[-_+]+/g, " ")
      .replace(/\b\d{2,}\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned.length >= 2) {
      return cleaned
        .split(" ")
        .slice(0, 3)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
    }
  } catch {
    // fall through
  }
  return "New Profile";
}

/**
 * A direct `.jpg` is already the image — no page to scrape. Same for a direct
 * video file. This is the "I have the image URL and the video URL separately"
 * case, where neither link is an HTML page.
 */
function directSourceProfile(
  url: string,
  kind: "image" | "video"
): ScrapedProfile {
  return {
    sourceUrl: url,
    title: kind === "image" ? nameFromFileUrl(url) : undefined,
    images: kind === "image" ? [url] : [],
    videos: kind === "video" ? [url] : [],
    pagesScanned: 0,
    sourceUrls: [url],
    imageCandidates: kind === "image" ? 1 : 0,
    imagesRejected: 0,
    detailPagesScanned: 0,
    imageChecks: 0,
  };
}

async function scrapeSource(
  env: Env,
  requestOrigin: string,
  url: string,
  mode: { images: boolean; videos: boolean },
  options: BulkRunOptions
): Promise<{ scraped: ScrapedProfile; subrequests: number }> {
  // Direct media links need no fetch at all.
  if (mode.images && isPhotoUrl(url)) {
    return { scraped: directSourceProfile(url, "image"), subrequests: 0 };
  }
  if (mode.videos && DIRECT_VIDEO_RE.test(url)) {
    return { scraped: directSourceProfile(url, "video"), subrequests: 0 };
  }

  const ownSlug = ownSiteSlug(url, env, requestOrigin);
  if (ownSlug) {
    const own = await loadOwnProfile(env, ownSlug);
    if (own) return { scraped: own, subrequests: 1 };
  }

  const scraped = await scrapeProfile(url, {
    images: mode.images,
    videos: mode.videos,
    imageLimit: MAX_IMAGES,
    maxPages: options.maxPages ?? 2,
    detailPages: options.detailPages ?? 2,
    videoLimit: options.videoLimit ?? 50,
    maxImageChecks: 10,
  });
  const subrequests =
    1 +
    (scraped.pagesScanned || 1) +
    (scraped.detailPagesScanned || 0) +
    (scraped.imageChecks || 0);
  return { scraped, subrequests };
}

/**
 * Scrape one entry and generate its profile text — **no database writes**.
 * This is the preview stage: /confirm commits it later.
 *
 * Throws with a human-readable message when the entry cannot be used; the
 * caller reports that line and keeps going.
 */
export async function prepareBulkEntry(
  env: Env,
  requestOrigin: string,
  entry: BulkEntry,
  id: number,
  options: BulkRunOptions = {}
): Promise<PreparedBulkEntry> {
  let spent = 0;
  const sameSource = entry.imageSource === entry.videoSource;

  let images: string[] = [];
  let videos: string[] = [];
  let title: string | undefined;
  let description: string | undefined;
  let textSnippet: string | undefined;
  let imageCandidates = 0;
  let imagesRejected = 0;

  try {
    const imageRun = await scrapeSource(
      env,
      requestOrigin,
      entry.imageSource,
      { images: true, videos: sameSource },
      options
    );
    spent += imageRun.subrequests;
    images = imageRun.scraped.images;
    if (sameSource) videos = imageRun.scraped.videos;
    title = imageRun.scraped.title;
    description = imageRun.scraped.description;
    textSnippet = imageRun.scraped.textSnippet;
    imageCandidates = imageRun.scraped.imageCandidates || images.length;
    imagesRejected = imageRun.scraped.imagesRejected || 0;

    if (!sameSource) {
      const videoRun = await scrapeSource(
        env,
        requestOrigin,
        entry.videoSource,
        { images: false, videos: true },
        options
      );
      spent += videoRun.subrequests;
      videos = videoRun.scraped.videos;
      title = title || videoRun.scraped.title;
      description = description || videoRun.scraped.description;
      textSnippet = textSnippet || videoRun.scraped.textSnippet;
    }
  } catch (err) {
    throw new Error((err as Error).message);
  }

  if (images.length === 0) {
    throw new Error(
      imagesRejected > 0
        ? `${imagesRejected} image URL(s) found but none are JPEG (WebP/PNG/GIF are rejected) — pick a page that serves .jpg photos`
        : imageCandidates > 0
          ? `${imageCandidates} image URL(s) found but none were served as image/jpeg`
          : "no JPEG images found"
    );
  }

  const scraped: ScrapedProfile = {
    sourceUrl: entry.imageSource,
    title,
    description,
    images,
    videos,
    textSnippet,
    pagesScanned: 1,
    sourceUrls: [entry.imageSource],
    imageCandidates,
  };

  let generated: PersonaDraft;
  let usedFallbackText = false;
  try {
    generated = await generatePersonaDraft(env, "", scraped);
    spent += 1;
  } catch {
    generated = fallbackPersona(scraped, entry.imageSource);
    usedFallbackText = true;
    spent += 1;
  }

  const prepared = await prepareVideoUrls(
    videos,
    newPlaybackBudget(options.videoLimit ? 6 : 8)
  );
  spent += prepared.attempts;

  const slug = generated.slug || generated.name;
  return {
    id,
    raw: entry.raw,
    imageSource: entry.imageSource,
    videoSource: entry.videoSource,
    slug,
    name: generated.name,
    draft: generated,
    images: images.slice(0, MAX_IMAGES),
    videos: prepared.urls,
    skippedVideos: prepared.unresolved,
    usedFallbackText,
    subrequests: spent,
  };
}

/**
 * Write a prepared entry into the database: create the persona with its
 * images and attach the videos that were already resolved during preview.
 */
export async function commitBulkEntry(
  env: Env,
  requestOrigin: string,
  prepared: PreparedBulkEntry
): Promise<BulkResult> {
  let slug: string;
  try {
    // Re-checked here because preview does not reserve slugs.
    slug = await uniqueSlug(env, prepared.slug || prepared.name);
  } catch (err) {
    return {
      raw: prepared.raw,
      ok: false,
      error: (err as Error).message,
      subrequests: 1,
    };
  }

  const images = prepared.images;
  const payload = buildPersonaPayload(prepared.draft, slug, {
    profileImage: images[0] ?? null,
    coverImage: images[1] ?? null,
    gallery: images.slice(2, 2 + MAX_GALLERY),
  });

  let persona: { id: string };
  try {
    persona = await createPersona(env, payload);
  } catch (err) {
    return {
      raw: prepared.raw,
      ok: false,
      error: (err as Error).message,
      subrequests: 2,
    };
  }

  let attached = 0;
  for (const url of prepared.videos) {
    if (
      await addVideo(env, persona.id, {
        url,
        title: `Video ${attached + 1}`,
      })
    ) {
      attached += 1;
    }
  }

  return {
    raw: prepared.raw,
    ok: true,
    name: prepared.draft.name,
    slug,
    link: profileLink(env, requestOrigin, slug),
    images: Math.min(images.length, MAX_IMAGES),
    videos: attached,
    skippedVideos: prepared.skippedVideos,
    usedFallbackText: prepared.usedFallbackText,
    subrequests: 2 + prepared.videos.length,
  };
}

/**
 * Prepare + commit in one step. Kept for one-shot callers; the bot now uses
 * prepareBulkEntry + commitBulkEntry so the user can preview first.
 */
export async function runBulkEntry(
  env: Env,
  requestOrigin: string,
  entry: BulkEntry,
  options: BulkRunOptions = {}
): Promise<BulkResult> {
  try {
    const prepared = await prepareBulkEntry(
      env,
      requestOrigin,
      entry,
      1,
      options
    );
    return await commitBulkEntry(env, requestOrigin, prepared);
  } catch (err) {
    return {
      raw: entry.raw,
      ok: false,
      error: (err as Error).message,
      subrequests: 1,
    };
  }
}
