import type {
  Draft,
  Env,
  PersonaDraft,
  ScrapedProfile,
  StoredMedia,
  TelegramMessage,
  TelegramUpdate,
} from "./types";
import { MAX_GALLERY, MAX_IMAGES, TELEGRAM_DOWNLOAD_LIMIT_MB } from "./types";
import { sendMessage } from "./telegram";
import {
  appendMedia,
  deleteDraft,
  ensureDraft,
  getDraft,
  registerMedia,
  saveDraft,
} from "./store";
import { generatePersonaDraft } from "./groq";
import {
  isDirectVideoUrl,
  isEmbedUrl,
  isHlsUrl,
  isPlayableVideoUrl,
} from "../video/playback";
import { resolveStreamUrl } from "../video/resolve";
import {
  DEFAULT_MAX_PAGES,
  DEFAULT_VIDEO_LIMIT,
  HARD_MAX_PAGES,
  MAX_VIDEO_LIMIT,
  scrapeProfile,
} from "./scrape";
import {
  addVideo,
  buildPersonaPayload,
  createPersona,
  uniqueSlug,
} from "./repo";
import { buildPublicMediaUrl } from "./media";
import { getPublicPersonaBySlug } from "../db/neon";

// Only JPEG images are accepted: PNG/WebP/GIF/SVG links are rejected with a
// clear message instead of silently entering the draft.
const IMAGE_URL_RE = /\.jpe?g(\?|#|$)/i;
const NON_JPEG_IMAGE_RE =
  /\.(png|webp|gif|svg|bmp|avif|heic|heif|tiff?)(\?|#|$)/i;
const PLAYER_URL_RE =
  /(rubyvidhub|morencius|leakgallery|\/embed|\/e\/|player\.php|[?&]v=)/i;
const URL_RE = /https?:\/\/[^\s]+/gi;
// File-name checks for Telegram documents.
const VIDEO_URL_RE = /\.(mp4|webm|mov|m4v|m3u8)(\?|#|$)/i;
const EMBED_URL_RE = /(embed|rubyvidhub|\.html)/i;
const MAX_VIDEOS = MAX_VIDEO_LIMIT;
const MAX_LISTED_URLS = 10;

type UrlKind = "image" | "other-image" | "video" | "page";

function classifyUrl(url: string): UrlKind {
  const value = url.trim();
  if (IMAGE_URL_RE.test(value)) return "image";
  if (NON_JPEG_IMAGE_RE.test(value)) return "other-image";
  if (isDirectVideoUrl(value) || isHlsUrl(value)) return "video";
  if (PLAYER_URL_RE.test(value)) return "video";
  return "page";
}

/** Annotate a video URL with whether the call screen can play it. */
function videoLabel(url: string): string {
  if (isPlayableVideoUrl(url)) return url;
  if (isEmbedUrl(url)) return `${url}  [embed – resolved on /confirm]`;
  return `${url}  [not playable]`;
}

/** Short, Telegram-safe list of URLs the bot is about to use. */
function formatUrlList(
  label: string,
  urls: string[],
  max = MAX_LISTED_URLS
): string {
  if (urls.length === 0) return "";
  const shown = urls.slice(0, max);
  const lines = shown.map((url, index) => {
    const trimmed = url.length > 140 ? `${url.slice(0, 137)}…` : url;
    return `${index + 1}. ${trimmed}`;
  });
  const hidden = urls.length - shown.length;
  return (
    `${label} (${urls.length}):\n${lines.join("\n")}` +
    (hidden > 0 ? `\n…and ${hidden} more` : "")
  );
}

const HELP_TEXT = `Dream Babe profile bot

/newprofile — start a fresh profile draft
Then send, in any order:
 • Photos (1st = profile picture, 2nd = cover, next up to ${MAX_GALLERY} go to the gallery, ${MAX_IMAGES} total)
 • Videos as files (under ${TELEGRAM_DOWNLOAD_LIMIT_MB}MB) or paste direct video/embed URLs
 • Any write-up text — bios, traits, background. Multiple messages are combined
/scrape <url> [video count] [max pages] — pull JPEG images and videos across paginated profile pages; no count = all (max 50), pages default 5 (e.g. /scrape https://x.com/p 30 5)
Any link you paste is scraped and merged into your draft automatically
/image <url> and /video <url> — force-add a direct JPEG or video link
/links — list every image and video URL currently in the draft
/checkvideos <slug> — test an existing profile's video URLs for playback
/preview — the AI writes the full profile from your material (OpenRouter fallback)
/setname <name> and /setslug <slug> — override the generated values
/status — show what the draft currently contains
/confirm — create the profile and attach all videos
/cancel — discard the draft`;

// ---------------------------------------------------------------------------
// Media extraction from incoming Telegram messages
// ---------------------------------------------------------------------------
function extractMedia(msg: TelegramMessage): StoredMedia[] {
  const out: StoredMedia[] = [];

  // message.photo is an array of sizes; the last entry is the largest.
  if (Array.isArray(msg.photo) && msg.photo.length > 0) {
    const largest = msg.photo[msg.photo.length - 1];
    out.push({
      kind: "photo",
      fileId: largest.file_id,
      mime: "image/jpeg",
      messageId: msg.message_id,
    });
  }

  if (msg.video) {
    out.push({
      kind: "video",
      fileId: msg.video.file_id,
      mime: msg.video.mime_type || "video/mp4",
      messageId: msg.message_id,
    });
  }

  if (msg.video_note) {
    out.push({
      kind: "video",
      fileId: msg.video_note.file_id,
      mime: "video/mp4",
      messageId: msg.message_id,
    });
  }

  if (msg.document) {
    const mime = msg.document.mime_type || "";
    if (mime.startsWith("image/") || IMAGE_URL_RE.test(msg.document.file_name || "")) {
      out.push({
        kind: "photo",
        fileId: msg.document.file_id,
        mime: mime || "image/jpeg",
        messageId: msg.message_id,
      });
    } else if (
      mime.startsWith("video/") ||
      VIDEO_URL_RE.test(msg.document.file_name || "")
    ) {
      out.push({
        kind: "video",
        fileId: msg.document.file_id,
        mime: mime || "video/mp4",
        messageId: msg.message_id,
      });
    }
  }

  return out;
}

function photoCount(draft: Draft): number {
  return draft.media.filter((m) => m.kind === "photo").length;
}
function tgVideoCount(draft: Draft): number {
  return draft.media.filter((m) => m.kind === "video").length;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

/**
 * Repeated /scrape runs accumulate into one draft: union images, videos and
 * source URLs (deduped by exact URL), sum pages, and let the newest title,
 * description and text excerpt win.
 */
function mergeScraped(
  existing: ScrapedProfile | null | undefined,
  incoming: ScrapedProfile
): ScrapedProfile {
  if (!existing) return incoming;

  const images: string[] = [];
  for (const url of [...(existing.images || []), ...incoming.images]) {
    if (images.length >= MAX_IMAGES) break;
    if (!images.includes(url)) images.push(url);
  }

  const videos: string[] = [];
  for (const url of [...(existing.videos || []), ...incoming.videos]) {
    if (videos.length >= MAX_VIDEOS) break;
    if (!videos.includes(url)) videos.push(url);
  }

  const sourceUrls: string[] = [];
  for (const url of [
    ...(existing.sourceUrls || []),
    ...(incoming.sourceUrls || []),
  ]) {
    if (!sourceUrls.includes(url)) sourceUrls.push(url);
  }

  return {
    sourceUrl: incoming.sourceUrl,
    title: incoming.title || existing.title,
    description: incoming.description || existing.description,
    textSnippet: incoming.textSnippet || existing.textSnippet,
    images,
    videos,
    sourceUrls,
    pagesScanned: (existing.pagesScanned ?? 0) + (incoming.pagesScanned ?? 0),
    blocked: incoming.blocked ?? existing.blocked,
  };
}

function statusLine(draft: Draft): string {
  const photos = photoCount(draft);
  const videos = tgVideoCount(draft) + draft.videoLinks.length +
    (draft.scraped?.videos.length || 0);
  const lines = [
    `Draft status:`,
    `• Photos: ${photos} Telegram + ${draft.imageLinks.length} links + ${draft.scraped?.images.length || 0} scraped`,
    `• Videos: ${videos}`,
    `• Write-up: ${draft.writeUp ? draft.writeUp.length + " chars" : "empty"}`,
    draft.scraped
      ? `• Scraped: ${draft.scraped.pagesScanned ?? 0} page(s), ${
          draft.scraped.images.length
        } images, ${draft.scraped.videos.length} videos (run /links to list them)`
      : null,
    draft.scraped ? `• Scraped source: ${draft.scraped.sourceUrl}` : null,
    draft.generated ? `• Preview: ready (${draft.generated.name} / ${draft.generated.slug})` : "• Preview: not generated yet",
  ].filter(Boolean);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
async function handleCommand(
  env: Env,
  origin: string,
  msg: TelegramMessage,
  text: string
): Promise<void> {
  const chatId = msg.chat.id;
  const [command, ...rest] = text.split(/\s+/);
  const arg = text.slice(command.length).trim();

  switch (command.replace(/@\w+$/, "").toLowerCase()) {
    case "/start":
    case "/help":
      await sendMessage(env, chatId, HELP_TEXT);
      return;

    case "/newprofile": {
      const draft = await ensureDraft(env, chatId);
      draft.writeUp = "";
      draft.media = [];
      draft.videoLinks = [];
      draft.imageLinks = [];
      draft.scraped = null;
      draft.generated = null;
      draft.nameOverride = null;
      draft.slugOverride = null;
      await saveDraft(env, draft);
      await sendMessage(
        env,
        chatId,
        "New draft started. Send photos, videos/URLs, and your write-up, then /preview."
      );
      return;
    }

    case "/cancel":
      await deleteDraft(env, chatId);
      await sendMessage(env, chatId, "Draft discarded.");
      return;

    case "/status": {
      const draft = await getExistingDraft(env, chatId);
      if (!draft) return;
      await sendMessage(env, chatId, statusLine(draft));
      return;
    }

    case "/scrape": {
      if (!arg) {
        await sendMessage(
          env,
          chatId,
          `Usage: /scrape https://example.com/profile [number of videos] [max pages]\n` +
            `e.g. /scrape https://example.com/p 10 5 (videos max ${MAX_VIDEO_LIMIT}, ` +
            `pages default ${DEFAULT_MAX_PAGES}, hard max ${HARD_MAX_PAGES})`
        );
        return;
      }

      // "<url> [video count] [max pages]" — bare integers after the URL.
      const tokens = arg.split(/\s+/).filter(Boolean);
      const targetUrl = tokens[0];
      const numbers: number[] = [];
      for (const token of tokens.slice(1)) {
        if (/^\d+$/.test(token)) numbers.push(parseInt(token, 10));
      }
      // No number = take everything the pages expose (max 50).
      const explicitCount = numbers.length > 0;
      const requested = clampNumber(
        explicitCount ? numbers[0] : DEFAULT_VIDEO_LIMIT,
        1,
        MAX_VIDEO_LIMIT
      );
      const maxPages = clampNumber(
        numbers.length > 1 ? numbers[1] : DEFAULT_MAX_PAGES,
        1,
        HARD_MAX_PAGES
      );

      const draft = await ensureDraft(env, chatId);
      await sendMessage(
        env,
        chatId,
        `Scraping that page for up to ${requested} video(s) across up to ` +
          `${maxPages} page(s), one moment…\n` +
          `(Want fewer? Send /scrape <url> <videos> <pages>.)`
      );
      try {
        const scraped = await scrapeProfile(targetUrl, {
          videoLimit: requested,
          maxPages,
        });
        draft.scraped = mergeScraped(draft.scraped, scraped);
        draft.generated = null;
        await saveDraft(env, draft);

        const found = scraped.videos.length;
        const pages = scraped.pagesScanned;
        const videoLine =
          found === 0
            ? `0 videos found across ${pages} page(s)`
            : found < requested
              ? explicitCount
                ? `you asked for ${requested} but only ${found} exist across ` +
                  `${pages} page(s) — all available ones were added`
                : `${found} videos added across ${pages} page(s) — that is ` +
                  `everything available`
              : `${found} videos added (requested ${requested}) across ` +
                `${pages} page(s)`;

        const merged = draft.scraped;
        await sendMessage(
          env,
          chatId,
          `Scraped: ${scraped.title || "untitled"}\n` +
            `• ${scraped.images.length} JPEG image(s)\n` +
            `• Videos: ${videoLine}\n` +
            (scraped.description ? `• ${scraped.description.slice(0, 200)}\n` : "") +
            `\n` +
            (formatUrlList("Images it will use", merged.images) ||
              "Images it will use: none") +
            `\n\n` +
            (formatUrlList("Videos it will use", merged.videos.map(videoLabel)) ||
              "Videos it will use: none") +
            `\n\nSend more material or run /preview.`
        );
      } catch (err) {
        await sendMessage(env, chatId, `Scrape failed: ${(err as Error).message}`);
      }
      return;
    }

    case "/image": {
      const draft = await ensureDraft(env, chatId);
      if (!arg) {
        await sendMessage(env, chatId, "Usage: /image https://example.com/photo.jpg");
        return;
      }
      if (!IMAGE_URL_RE.test(arg)) {
        await sendMessage(
          env,
          chatId,
          "Only JPEG images are accepted (.jpg/.jpeg). Convert the image to JPEG and try again."
        );
        return;
      }
      if (!draft.imageLinks.includes(arg)) draft.imageLinks.push(arg);
      draft.generated = null;
      await saveDraft(env, draft);
      await sendMessage(env, chatId, `Added as JPEG image:\n${arg}`);
      return;
    }

    case "/video": {
      const draft = await ensureDraft(env, chatId);
      if (!arg) {
        await sendMessage(env, chatId, "Usage: /video https://example.com/clip.mp4");
        return;
      }
      if (!draft.videoLinks.some((v) => v.url === arg)) {
        draft.videoLinks.push({ kind: "url", url: arg, messageId: msg.message_id });
      }
      draft.generated = null;
      await saveDraft(env, draft);
      await sendMessage(
        env,
        chatId,
        isPlayableVideoUrl(arg)
          ? `Added as video (playable):\n${arg}`
          : `Added as video (embed page — I will resolve the real stream on /confirm):\n${arg}`
      );
      return;
    }

    case "/links": {
      const draft = await getExistingDraft(env, chatId);
      if (!draft) return;
      const images = resolveImageSources(env, origin, draft);
      const videos = collectVideoCandidates(env, origin, draft).map((v) =>
        videoLabel(v.url)
      );
      await sendMessage(
        env,
        chatId,
        `${formatUrlList("Images (JPEG)", images) || "Images (JPEG): none"}\n\n` +
          `${formatUrlList("Videos", videos) || "Videos: none"}\n\n` +
          `Send more material or run /preview.`
      );
      return;
    }

    case "/checkvideos": {
      if (!arg) {
        await sendMessage(env, chatId, "Usage: /checkvideos <profile slug>");
        return;
      }
      const slug = arg.trim().toLowerCase();
      let persona: Record<string, unknown> | null = null;
      try {
        persona = await getPublicPersonaBySlug(env, slug);
      } catch (err) {
        await sendMessage(env, chatId, `Lookup failed: ${(err as Error).message}`);
        return;
      }
      if (!persona) {
        await sendMessage(env, chatId, `No active profile with slug "${slug}".`);
        return;
      }
      const videos = (persona.videos as Array<{ url?: string; title?: string }>) || [];
      if (videos.length === 0) {
        await sendMessage(env, chatId, `"${slug}" has no videos stored.`);
        return;
      }

      const lines: string[] = [`Video check for ${slug} (${videos.length}):`];
      let ok = 0;
      for (const [index, video] of videos.slice(0, 12).entries()) {
        const raw = video.url || "";
        const usable = isPlayableVideoUrl(raw)
          ? raw
          : await resolveStreamUrl(raw, 6000);
        if (usable) ok += 1;
        lines.push(
          `${index + 1}. ${usable ? "playable" : "NO STREAM"} — ${raw}` +
            (usable && usable !== raw ? `\n   -> ${usable}` : "")
        );
      }
      if (videos.length > 12) lines.push(`…and ${videos.length - 12} more`);
      lines.push(
        "",
        `${ok}/${Math.min(videos.length, 12)} checked URLs are playable. ` +
          `The call screen proxies every video, so playable ones start even when the source blocks hotlinking.`
      );
      await sendMessage(env, chatId, lines.join("\n"));
      return;
    }

    case "/setname":
    case "/setslug": {
      if (!arg) {
        await sendMessage(env, chatId, `Usage: ${command} <value>`);
        return;
      }
      const draft = await ensureDraft(env, chatId);
      if (command.toLowerCase().startsWith("/setname")) draft.nameOverride = arg;
      else {
        draft.slugOverride = arg
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 60);
      }
      draft.generated = null;
      await saveDraft(env, draft);
      await sendMessage(env, chatId, "Saved. Run /preview to regenerate with the override.");
      return;
    }

    case "/preview":
      await runPreview(env, origin, chatId);
      return;

    case "/confirm":
      await runConfirm(env, origin, chatId);
      return;

    default:
      await sendMessage(
        env,
        chatId,
        "Unknown command. Send /help to see what I can do."
      );
  }
}

async function getExistingDraft(
  env: Env,
  chatId: number
): Promise<Draft | null> {
  const draft = await getDraft(env, chatId);
  if (!draft) {
    await sendMessage(
      env,
      chatId,
      "No active draft. Send /newprofile to start one."
    );
  }
  return draft;
}

async function runPreview(
  env: Env,
  origin: string,
  chatId: number
): Promise<void> {
  const draft = await getExistingDraft(env, chatId);
  if (!draft) return;
  if (!draft.writeUp.trim() && !draft.scraped) {
    await sendMessage(
      env,
      chatId,
      "I need material first — send a write-up or use /scrape <url>."
    );
    return;
  }

  await sendMessage(env, chatId, "Writing the profile…");
  try {
    const generated = await generatePersonaDraft(
      env,
      draft.writeUp,
      draft.scraped
    );
    if (draft.nameOverride) generated.name = draft.nameOverride;
    if (draft.slugOverride) generated.slug = draft.slugOverride;
    draft.generated = generated;
    await saveDraft(env, draft);

    await sendMessage(
      env,
      chatId,
      `Preview ready:\n\n` +
        `Name: ${generated.name}\nSlug: ${generated.slug}\n` +
        `Age/Location: ${generated.age ?? "?"} / ${[generated.city, generated.country]
          .filter(Boolean)
          .join(", ") || "unknown"}\n` +
        `Occupation: ${generated.occupation || "unknown"}\n\n` +
        `Description: ${generated.description}\n\n` +
        `Personality: ${generated.personality}\n` +
        `Speaking: ${generated.speakingStyle}\n` +
        `Flirt level: ${generated.flirtLevel}/4 · Emojis: ${generated.emojiFrequency || "n/a"}\n\n` +
        `${statusLine(draft)}\n\n` +
        `${formatUrlList("Images it will use", resolveImageSources(env, origin, draft)) || "Images it will use: none"}\n\n` +
        `${formatUrlList("Videos it will use", collectVideoCandidates(env, origin, draft).map((v) => videoLabel(v.url))) || "Videos it will use: none"}\n\n` +
        `Reply /confirm to create it, or send edits and /preview again.`
    );
  } catch (err) {
    await sendMessage(env, chatId, `Preview failed: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Confirm: resolve media, create persona, attach videos
// ---------------------------------------------------------------------------
function resolveImageSources(env: Env, origin: string, draft: Draft): string[] {
  const urls: string[] = [];
  // Telegram re-encodes uploaded photos as JPEG, and the media proxy serves
  // them as image/jpeg, so those always qualify.
  for (const media of draft.media.filter((m) => m.kind === "photo")) {
    urls.push(buildPublicMediaUrl(env, origin, media.fileId));
  }
  // Link/scraped images must be real JPEGs — everything else is dropped.
  for (const link of draft.imageLinks) {
    if (IMAGE_URL_RE.test(link)) urls.push(link);
  }
  if (draft.scraped) {
    for (const link of draft.scraped.images) {
      if (IMAGE_URL_RE.test(link)) urls.push(link);
    }
  }
  return [...new Set(urls)].slice(0, MAX_IMAGES);
}

interface ResolvedVideo {
  url: string;
  title: string;
}

/** Every video the draft would like to use, before embed resolution. */
function collectVideoCandidates(
  env: Env,
  origin: string,
  draft: Draft
): ResolvedVideo[] {
  const videos: ResolvedVideo[] = [];
  draft.media
    .filter((m) => m.kind === "video")
    .forEach((m, i) =>
      videos.push({
        url: buildPublicMediaUrl(env, origin, m.fileId),
        title: `Clip ${i + 1}`,
      })
    );
  draft.videoLinks.forEach((v, i) =>
    videos.push({ url: v.url, title: v.title || `Video ${i + 1}` })
  );
  draft.scraped?.videos.forEach((url, i) =>
    videos.push({ url, title: `Scraped video ${i + 1}` })
  );
  const seen = new Set<string>();
  return videos
    .filter((v) => {
      if (seen.has(v.url)) return false;
      seen.add(v.url);
      return true;
    })
    .slice(0, MAX_VIDEOS);
}

/**
 * Turn draft video candidates into something the call screen can actually
 * play: direct files and HLS are kept, HTML embed pages are resolved to their
 * hidden stream, and anything unresolvable is dropped and reported.
 */
async function resolveVideos(
  env: Env,
  origin: string,
  draft: Draft
): Promise<{ videos: ResolvedVideo[]; unresolved: number }> {
  const candidates = collectVideoCandidates(env, origin, draft);
  const playable: ResolvedVideo[] = [];
  let unresolved = 0;
  let embedAttempts = 0;

  for (const candidate of candidates) {
    if (isPlayableVideoUrl(candidate.url)) {
      playable.push(candidate);
      continue;
    }
    // Bound the extra network work inside one webhook call.
    if (isEmbedUrl(candidate.url) && embedAttempts < 8) {
      embedAttempts += 1;
      const resolved = await resolveStreamUrl(candidate.url, 6000);
      if (resolved && (isPlayableVideoUrl(resolved) || isDirectVideoUrl(resolved))) {
        playable.push({ ...candidate, url: resolved });
        continue;
      }
    }
    unresolved += 1;
  }

  return { videos: playable, unresolved };
}

async function runConfirm(
  env: Env,
  origin: string,
  chatId: number
): Promise<void> {
  const draft = await getExistingDraft(env, chatId);
  if (!draft) return;

  const images = resolveImageSources(env, origin, draft);
  if (images.length === 0) {
    await sendMessage(
      env,
      chatId,
      "Add at least one photo first — the first image becomes the profile picture."
    );
    return;
  }

  let generated: PersonaDraft | null = draft.generated;
  if (!generated) {
    await sendMessage(env, chatId, "No preview yet — generating one first…");
    try {
      generated = await generatePersonaDraft(env, draft.writeUp, draft.scraped);
      if (draft.nameOverride) generated.name = draft.nameOverride;
      if (draft.slugOverride) generated.slug = draft.slugOverride;
      draft.generated = generated;
      await saveDraft(env, draft);
    } catch (err) {
      await sendMessage(env, chatId, `Generation failed: ${(err as Error).message}`);
      return;
    }
  }

  const slug = await uniqueSlug(env, generated.slug);
  const payload = buildPersonaPayload(generated, slug, {
    profileImage: images[0] ?? null,
    coverImage: images[1] ?? null,
    gallery: images.slice(2, 2 + MAX_GALLERY),
  });

  let persona: { id: string };
  try {
    persona = await createPersona(env, payload);
  } catch (err) {
    await sendMessage(env, chatId, `Profile creation failed: ${(err as Error).message}`);
    return;
  }

  const { videos, unresolved } = await resolveVideos(env, origin, draft);
  let attached = 0;
  for (const video of videos) {
    if (await addVideo(env, persona.id, video)) attached += 1;
  }

  const galleryCount = Math.max(0, Math.min(images.length - 2, MAX_GALLERY));
  const siteBase = (env.PUBLIC_BASE_URL || origin).replace(/\/+$/, "");
  await sendMessage(
    env,
    chatId,
    `Profile created: ${generated.name}\n` +
      `Link: ${siteBase}/dreamgirl/${slug}\n` +
      `Images: ${images.length} (profile + cover + ${galleryCount} gallery)\n` +
      `Videos attached: ${attached}/${videos.length}` +
      (unresolved > 0
        ? ` (${unresolved} embed link(s) had no playable stream and were skipped)`
        : "") +
      `\n\n` +
      (formatUrlList("Images used", images) || "Images used: none") +
      `\n\n` +
      (formatUrlList("Video URLs used", videos.map((v) => videoLabel(v.url))) ||
        "Video URLs used: none") +
      `\n\nThe draft is cleared. Start another with /newprofile.`
  );
  await deleteDraft(env, chatId);
}

// ---------------------------------------------------------------------------
// Plain (non-command) intake: media and write-up text
// ---------------------------------------------------------------------------
async function handleIntake(
  env: Env,
  msg: TelegramMessage,
  text: string
): Promise<void> {
  const chatId = msg.chat.id;
  const draft = await ensureDraft(env, chatId);
  let replies: string[] = [];

  // 1) Media attached to the message (photos / videos / documents).
  const media = extractMedia(msg);
  for (const item of media) {
    if (item.kind === "photo" && photoCount(draft) >= MAX_IMAGES) {
      replies.push(`Image limit is ${MAX_IMAGES} total — extra photo ignored.`);
      continue;
    }
    if (
      item.kind === "video" &&
      tgVideoCount(draft) + draft.videoLinks.length >= MAX_VIDEOS
    ) {
      replies.push(`Video limit is ${MAX_VIDEOS} — extra video ignored.`);
      continue;
    }
    await registerMedia(env, item.fileId, item.kind, item.mime);
    appendMedia(draft, item);
    replies.push(
      item.kind === "photo"
        ? `Added to the draft: photo #${photoCount(draft)}${photoCount(draft) === 1 ? " (profile picture)" : photoCount(draft) === 2 ? " (cover)" : " (gallery)"} (JPEG).`
        : `Added to the draft: video (${tgVideoCount(draft)} so far). Files over ${TELEGRAM_DOWNLOAD_LIMIT_MB}MB cannot be downloaded by bots — send a URL instead.`
    );
  }

  // 2) URLs inside text/caption. Everything is added to the SAME draft:
  //    JPEG links become images, video/embed links become videos, and any
  //    other link is scraped and merged instead of being parked as "context".
  const urls = text.match(URL_RE) || [];
  const prose = text.replace(URL_RE, " ").trim();
  let pageScrapes = 0;

  for (const raw of urls) {
    const url = raw.replace(/[).,]+$/, "");
    const kind = classifyUrl(url);

    if (kind === "video") {
      if (draft.videoLinks.length + tgVideoCount(draft) + (draft.scraped?.videos.length || 0) >= MAX_VIDEOS) {
        replies.push(`Video limit is ${MAX_VIDEOS} — ${url} ignored.`);
        continue;
      }
      if (!draft.videoLinks.some((v) => v.url === url)) {
        draft.videoLinks.push({ kind: "url", url, messageId: msg.message_id });
        draft.generated = null;
      }
      replies.push(
        isPlayableVideoUrl(url)
          ? `Added to the draft as a video:\n${url}`
          : `Added to the draft as a video embed (the real stream is resolved when you /confirm):\n${url}`
      );
      continue;
    }

    if (kind === "image") {
      if (
        draft.imageLinks.length +
          photoCount(draft) +
          (draft.scraped?.images.length || 0) >=
        MAX_IMAGES
      ) {
        replies.push(`Image limit is ${MAX_IMAGES} — ${url} ignored.`);
        continue;
      }
      if (!draft.imageLinks.includes(url)) {
        draft.imageLinks.push(url);
        draft.generated = null;
      }
      replies.push(`Added to the draft as a JPEG image:\n${url}`);
      continue;
    }

    if (kind === "other-image") {
      replies.push(
        `Only JPEG images are accepted, so this was NOT added:\n${url}\n` +
          `Convert it to .jpg and resend, or use /image <jpeg url>.`
      );
      continue;
    }

    // Plain page link: scrape it and merge into the draft we already have.
    if (pageScrapes >= 3) {
      replies.push(`Only 3 pages are scraped per message — send ${url} separately.`);
      continue;
    }
    pageScrapes += 1;
    try {
      const beforeImages = draft.scraped?.images.length ?? 0;
      const beforeVideos = draft.scraped?.videos.length ?? 0;
      const scraped = await scrapeProfile(url, {
        videoLimit: MAX_VIDEOS,
        maxPages: DEFAULT_MAX_PAGES,
      });
      draft.scraped = mergeScraped(draft.scraped, scraped);
      draft.generated = null;
      const addedImages = draft.scraped.images.length - beforeImages;
      const addedVideos = draft.scraped.videos.length - beforeVideos;

      if (draft.scraped.images.length === 0 && draft.scraped.videos.length === 0) {
        replies.push(
          `Scraped ${url} but found no JPEG images or videos.\n` +
            `If it is a direct file, send /image <url> or /video <url>.`
        );
      } else {
        replies.push(
          `Scraped ${scraped.title || url} and merged it into your draft.\n` +
            `• +${Math.max(0, addedImages)} image(s) (now ${draft.scraped.images.length} total)\n` +
            `• +${Math.max(0, addedVideos)} video(s) (now ${draft.scraped.videos.length} total)\n` +
            `Pages scanned: ${scraped.pagesScanned}\n\n` +
            formatUrlList("Images in the draft", draft.scraped.images) +
            `\n\n` +
            formatUrlList("Videos in the draft", draft.scraped.videos.map(videoLabel))
        );
      }
    } catch (err) {
      replies.push(
        `Could not scrape ${url}: ${(err as Error).message}\n` +
          `If it is a direct file, use /image <url> or /video <url>.`
      );
    }
  }

  // 3) Remaining prose accumulates into the write-up.
  if (prose) {
    draft.writeUp = draft.writeUp ? `${draft.writeUp}\n${prose}` : prose;
    draft.generated = null;
    replies.push("Write-up updated.");
  }

  await saveDraft(env, draft);
  if (replies.length === 0) {
    replies.push("Got it. Use /status to review the draft or /preview to generate.");
  }
  await sendMessage(env, chatId, replies.join("\n"));
}

// ---------------------------------------------------------------------------
// Entry point used by the Pages Function webhook
// ---------------------------------------------------------------------------
export async function handleUpdate(
  env: Env,
  update: TelegramUpdate,
  requestOrigin: string
): Promise<void> {
  const msg = update.message || update.edited_message;
  if (!msg || !msg.chat) return;

  const text = (msg.text || msg.caption || "").trim();
  if (text.startsWith("/")) {
    await handleCommand(env, requestOrigin, msg, text);
    return;
  }
  await handleIntake(env, msg, text);
}
