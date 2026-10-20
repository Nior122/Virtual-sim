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
  ScrapedProfile,
} from "./types";
import { MAX_GALLERY, MAX_IMAGES } from "./types";
import { scrapeProfile } from "./scrape";
import { generatePersonaDraft } from "./groq";
import { addVideo, buildPersonaPayload, createPersona, uniqueSlug } from "./repo";
import { getPublicPersonaBySlug } from "../db/neon";
import { newPlaybackBudget, prepareVideoUrls } from "./videos";

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
  const hosts = new Set<string>();
  for (const candidate of [env.PUBLIC_BASE_URL, requestOrigin]) {
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
    sourceUrl: `${env.PUBLIC_BASE_URL || "https://site"}/dreamgirl/${slug}`,
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
    background: `A fictional companion profile built from ${sourceUrl}.`,
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
      `You are ${name}, a fictional AI companion. Stay in character, ` +
      `keep replies short and human-sounding, never mention being an AI.`,
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

async function scrapeSource(
  env: Env,
  requestOrigin: string,
  url: string,
  mode: { images: boolean; videos: boolean },
  options: BulkRunOptions
): Promise<{ scraped: ScrapedProfile; subrequests: number }> {
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
    maxImageChecks: 6,
  });
  const subrequests =
    1 +
    (scraped.pagesScanned || 1) +
    (scraped.detailPagesScanned || 0) +
    (scraped.imageChecks || 0);
  return { scraped, subrequests };
}

/**
 * Scrape one entry, create the persona with its images and attach its videos.
 * Every failure mode is reported in the result instead of throwing, so one bad
 * URL never stops a batch.
 */
export async function runBulkEntry(
  env: Env,
  requestOrigin: string,
  entry: BulkEntry,
  options: BulkRunOptions = {}
): Promise<BulkResult> {
  let spent = 0;
  const sameSource = entry.imageSource === entry.videoSource;

  let images: string[] = [];
  let videos: string[] = [];
  let title: string | undefined;
  let description: string | undefined;
  let textSnippet: string | undefined;
  let imageCandidates = 0;

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
    return {
      raw: entry.raw,
      ok: false,
      error: (err as Error).message,
      subrequests: spent + 1,
    };
  }

  if (images.length === 0) {
    return {
      raw: entry.raw,
      ok: false,
      error: imageCandidates > 0
        ? `${imageCandidates} image URL(s) found but none were served as JPEG`
        : "no JPEG images found",
      subrequests: spent,
    };
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

  const slug = await uniqueSlug(env, generated.slug || generated.name);
  const payload = buildPersonaPayload(generated, slug, {
    profileImage: images[0] ?? null,
    coverImage: images[1] ?? null,
    gallery: images.slice(2, 2 + MAX_GALLERY),
  });

  let persona: { id: string };
  try {
    persona = await createPersona(env, payload);
  } catch (err) {
    return {
      raw: entry.raw,
      ok: false,
      error: (err as Error).message,
      subrequests: spent,
    };
  }

  let attached = 0;
  for (const url of prepared.urls) {
    if (
      await addVideo(env, persona.id, {
        url,
        title: `Video ${attached + 1}`,
      })
    ) {
      attached += 1;
    }
  }

  const siteBase = (env.PUBLIC_BASE_URL || requestOrigin).replace(/\/+$/, "");
  return {
    raw: entry.raw,
    ok: true,
    name: generated.name,
    slug,
    link: `${siteBase}/dreamgirl/${slug}`,
    images: Math.min(images.length, MAX_IMAGES),
    videos: attached,
    skippedVideos: prepared.unresolved,
    usedFallbackText,
    subrequests: spent,
  };
}
