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
import { profileLink } from "./public-url";
import {
  clearBulkQueue,
  clearBulkReview,
  deleteDraft,
  ensureDraft,
  getBulkQueue,
  getBulkReview,
  getDraft,
  registerMedia,
  saveBulkQueue,
  saveBulkReview,
  saveDraft,
} from "./store";
import type { BulkQueue, BulkReview } from "./store";
import {
  commitBulkEntry,
  MAX_BULK_ENTRIES,
  MAX_BULK_PER_CALL,
  parseBulkList,
  prepareBulkEntry,
  type BulkResult,
} from "./bulk";
import type { BulkEntry, PreparedBulkEntry } from "./types";
import { generatePersonaDraft } from "./groq";
import {
  isDirectVideoUrl,
  isEmbedUrl,
  isHlsUrl,
  isLocalMediaUrl,
  isPlayableVideoUrl,
} from "../video/playback";
import { resolveStreamUrl } from "../video/resolve";
import { newPlaybackBudget, toPlayableVideoUrl } from "./videos";
import {
  DEFAULT_DETAIL_PAGES,
  DEFAULT_MAX_PAGES,
  DEFAULT_VIDEO_LIMIT,
  HARD_MAX_DETAIL_PAGES,
  HARD_MAX_PAGES,
  MAX_VIDEO_LIMIT,
  scrapeProfile,
} from "./scrape";
import {
  addVideo,
  buildPersonaPayload,
  createPersona,
  listProfileSummaries,
  loadProfileForEdit,
  loadProfileVideos,
  removeProfileVideo,
  saveProfileMedia,
  uniqueSlug,
  updateProfileVideo,
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
  if (isEmbedUrl(url)) return `${url}  [embed – resolved when saved]`;
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
/scrape <url> [videos] [pages] [post pages] — pull JPEG images and videos across paginated pages and open individual post pages for hidden main images; no count = all (max 50), pages default 5, post pages default 4 (e.g. /scrape https://x.com/p 30 5 4)
Any link you paste is scraped and merged into your draft automatically
/image <url> and /video <url> — force-add a direct JPEG or video link
/links — list every image and video URL currently in the draft
/profiles [page] — every profile with its slug, image count and video count
/bulk <list> — prepare up to 25 profiles at once (nothing is created yet)
  separate entries with commas or newlines; "A & B" takes images from A and
  videos from B; a single URL gives both. Then /bulknext prepares the rest
/previewall — full write-ups + every image/video URL for the prepared batch
  /preview <n> for one of them
/confirm — create every prepared profile · /confirm 1,3 to pick some
/skip <n> — drop a prepared profile · /bulkcancel — abandon the batch
/edit <slug> — load an existing profile to change its images and videos
  then: send photos/videos or links (they are added), or use
  /removeimage <n>, /replaceimage <n> <url>, /removevideo <n>,
  /replacevideo <n> <url>, /clearvideos, and /save to apply
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

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

/** Parse a 1-based list index ("2", "#2") — null when it is not a number. */
function parseIndex(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.trim().match(/^#?(\d+)$/);
  if (!match) return null;
  const index = parseInt(match[1], 10);
  return Number.isFinite(index) && index > 0 ? index : null;
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
    imageCandidates:
      (existing.imageCandidates ?? 0) + (incoming.imageCandidates ?? 0),
    imagesRejected:
      (existing.imagesRejected ?? 0) + (incoming.imagesRejected ?? 0),
    detailPagesScanned:
      (existing.detailPagesScanned ?? 0) + (incoming.detailPagesScanned ?? 0),
    blocked: incoming.blocked ?? existing.blocked,
  };
}

// ---------------------------------------------------------------------------
// Numbered working lists (add / remove / replace operate on these)
// ---------------------------------------------------------------------------
interface WorkingVideo {
  url: string;
  title: string;
  videoId?: string;
  messageId?: number;
}

/**
 * Ordered image URLs of the draft: Telegram photos first, then pasted
 * links, then scraped images — the same order /confirm and /save use, so
 * index 1 is the profile picture and index 2 the cover.
 */
function workingImages(env: Env, origin: string, draft: Draft): string[] {
  const out: string[] = [];
  const push = (url: string | null | undefined) => {
    if (url && !out.includes(url)) out.push(url);
  };
  for (const media of draft.media.filter((m) => m.kind === "photo")) {
    push(buildPublicMediaUrl(env, origin, media.fileId));
  }
  for (const link of draft.imageLinks) push(link);
  if (draft.scraped) for (const link of draft.scraped.images) push(link);
  return out;
}

/** Writes an edited image list back into the draft. */
function setWorkingImages(draft: Draft, images: string[]): void {
  draft.media = draft.media.filter((m) => m.kind !== "photo");
  draft.imageLinks = [...images];
  if (draft.scraped) draft.scraped.images = [];
  draft.generated = null;
}

/** Ordered video entries of the draft, keeping their DB row ids in edit mode. */
function workingVideos(env: Env, origin: string, draft: Draft): WorkingVideo[] {
  const out: WorkingVideo[] = [];
  const push = (video: WorkingVideo) => {
    if (!video.url || out.some((v) => v.url === video.url)) return;
    out.push(video);
  };
  draft.media
    .filter((m) => m.kind === "video")
    .forEach((m, i) =>
      push({
        url: buildPublicMediaUrl(env, origin, m.fileId),
        title: `Clip ${i + 1}`,
        messageId: m.messageId,
      })
    );
  draft.videoLinks.forEach((v, i) =>
    push({
      url: v.url,
      title: v.title || `Video ${i + 1}`,
      videoId: v.videoId,
      messageId: v.messageId,
    })
  );
  draft.scraped?.videos.forEach((url, i) =>
    push({ url, title: `Scraped video ${i + 1}` })
  );
  return out;
}

/** Writes an edited video list back into the draft (ids are preserved). */
function setWorkingVideos(draft: Draft, videos: WorkingVideo[]): void {
  const byUrl = new Map(draft.videoLinks.map((v) => [v.url, v]));
  draft.media = draft.media.filter((m) => m.kind !== "video");
  draft.videoLinks = videos.map((video) => {
    const existing = byUrl.get(video.url);
    return {
      kind: "url" as const,
      url: video.url,
      title: video.title,
      messageId: existing?.messageId ?? video.messageId ?? 0,
      videoId: video.videoId,
    };
  });
  if (draft.scraped) draft.scraped.videos = [];
  draft.generated = null;
}

/** What the user should do next, depending on create vs edit mode. */
function nextStep(draft: Draft): string {
  return draft.edit
    ? `Send more material or run /save to apply the changes.`
    : `Send more material or run /preview.`;
}

function statusLine(env: Env, origin: string, draft: Draft): string {
  const images = workingImages(env, origin, draft);
  const videos = workingVideos(env, origin, draft);
  const lines = [
    draft.edit
      ? `Editing profile: ${draft.edit.name} (/${draft.edit.slug})`
      : `Draft status:`,
    `• Images: ${images.length} (1st = profile, 2nd = cover, ${MAX_IMAGES} max)`,
    `• Videos: ${videos.length} (${MAX_VIDEOS} max)`,
    `• Write-up: ${draft.writeUp ? draft.writeUp.length + " chars" : "empty"}`,
    draft.scraped
      ? `• Scraped: ${draft.scraped.pagesScanned ?? 0} page(s), ${
          draft.scraped.images.length
        } images, ${draft.scraped.videos.length} videos (run /links to list them)`
      : null,
    draft.scraped ? `• Scraped source: ${draft.scraped.sourceUrl}` : null,
    draft.edit
      ? `• Run /save to apply, or /cancel to discard the changes`
      : draft.generated
        ? `• Preview: ready (${draft.generated.name} / ${draft.generated.slug})`
        : "• Preview: not generated yet",
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
      // Starting a single-profile draft abandons any bulk preview, so /confirm
      // cannot create the wrong thing.
      const pendingReview = await getBulkReview(env, chatId);
      await clearBulkReview(env, chatId);
      const draft = await ensureDraft(env, chatId);
      draft.writeUp = "";
      draft.media = [];
      draft.videoLinks = [];
      draft.imageLinks = [];
      draft.scraped = null;
      draft.generated = null;
      draft.edit = null;
      draft.bulkAwaiting = false;
      draft.nameOverride = null;
      draft.slugOverride = null;
      await saveDraft(env, draft);
      await sendMessage(
        env,
        chatId,
        "New draft started. Send photos, videos/URLs, and your write-up, then /preview." +
          (pendingReview && pendingReview.entries.length > 0
            ? `\n\n(${pendingReview.entries.length} bulk preview(s) were discarded, nothing was created.)`
            : "")
      );
      return;
    }

    case "/cancel": {
      const draft = await getDraft(env, chatId);
      await deleteDraft(env, chatId);
      await sendMessage(
        env,
        chatId,
        draft?.edit
          ? `Edit discarded — "${draft.edit.slug}" was not changed.`
          : "Draft discarded."
      );
      return;
    }

    case "/status": {
      const review = await getBulkReview(env, chatId);
      const queue = await getBulkQueue(env, chatId);
      const bulkBits: string[] = [];
      if (review && review.entries.length > 0) {
        bulkBits.push(`${review.entries.length} profile(s) prepared and waiting`);
      }
      if (review && review.failed.length > 0) {
        bulkBits.push(`${review.failed.length} entry(ies) failed`);
      }
      if (queue && queue.entries.length > 0) {
        bulkBits.push(`${queue.entries.length} entry(ies) still to prepare`);
      }
      const draft = await getDraft(env, chatId);
      if (bulkBits.length > 0) {
        await sendMessage(
          env,
          chatId,
          `Bulk status:\n${bulkBits.map((bit) => `• ${bit}`).join("\n")}\n\n` +
            (review && review.entries.length > 0
              ? `${formatReviewSummary(review)}\n\n${confirmHint(review)}`
              : "Send /bulknext to prepare the queue, or /bulk to start over.")
        );
        if (!draft) return;
      }
      if (!draft) {
        await sendMessage(env, chatId, "No active draft. Send /newprofile to start one.");
        return;
      }
      await sendMessage(env, chatId, statusLine(env, origin, draft));
      return;
    }

    case "/scrape": {
      if (!arg) {
        await sendMessage(
          env,
          chatId,
          `Usage: /scrape https://example.com/profile [videos] [pages] [post pages]\n` +
            `e.g. /scrape https://example.com/p 10 5 4 ` +
            `(videos max ${MAX_VIDEO_LIMIT}, pages default ${DEFAULT_MAX_PAGES}/max ${HARD_MAX_PAGES}, ` +
            `post pages default ${DEFAULT_DETAIL_PAGES}/max ${HARD_MAX_DETAIL_PAGES})`
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
      // Third number: how many individual post pages to open for main images.
      const detailPages = clampNumber(
        numbers.length > 2 ? numbers[2] : DEFAULT_DETAIL_PAGES,
        0,
        HARD_MAX_DETAIL_PAGES
      );

      const draft = await ensureDraft(env, chatId);
      await sendMessage(
        env,
        chatId,
        `Scraping that page for up to ${requested} video(s) across up to ` +
          `${maxPages} page(s), opening up to ${detailPages} post page(s) for hidden images…\n` +
          `(Change it with /scrape <url> <videos> <pages> <post pages>.)`
      );
      try {
        const scraped = await scrapeProfile(targetUrl, {
          videoLimit: requested,
          maxPages,
          detailPages,
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
            `• ${scraped.images.length} JPEG image(s)` +
            ((scraped.detailPagesScanned ?? 0) > 0
              ? ` (opened ${scraped.detailPagesScanned} post page(s))`
              : "") +
            `\n` +
            (scraped.images.length === 0 && (scraped.imagesRejected ?? 0) > 0
              ? `  ↳ ${scraped.imagesRejected} image URL(s) were rejected — they are ` +
                `WebP/PNG/GIF or not served as image/jpeg. This site does not offer JPEG photos.\n`
              : scraped.images.length === 0 && (scraped.imageCandidates ?? 0) > 0
                ? `  ↳ ${scraped.imageCandidates} image URL(s) found but none returned image/jpeg\n`
                : "") +
            `• Videos: ${videoLine}\n` +
            (scraped.description ? `• ${scraped.description.slice(0, 200)}\n` : "") +
            `\n` +
            (formatUrlList("Images it will use", merged.images) ||
              "Images it will use: none") +
            `\n\n` +
            (formatUrlList("Videos it will use", merged.videos.map(videoLabel)) ||
              "Videos it will use: none") +
            `\n\n${nextStep(draft)}`
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
      const images = workingImages(env, origin, draft);
      const videos = workingVideos(env, origin, draft).map((v) =>
        videoLabel(v.url)
      );
      await sendMessage(
        env,
        chatId,
        `${draft.edit ? `Editing ${draft.edit.name} (/${draft.edit.slug})\n\n` : ""}` +
          `${formatUrlList("Images (JPEG)", images) || "Images (JPEG): none"}\n\n` +
          `${formatUrlList("Videos", videos) || "Videos: none"}\n\n` +
          `Use /replaceimage <n> <url>, /replacevideo <n> <url>, ` +
          `/removeimage <n>, /removevideo <n>.\n` +
          nextStep(draft)
      );
      return;
    }

    case "/profiles": {
      let profiles;
      try {
        profiles = await listProfileSummaries(env);
      } catch (err) {
        await sendMessage(env, chatId, (err as Error).message);
        return;
      }
      if (profiles.length === 0) {
        await sendMessage(env, chatId, "No profiles yet. Create one with /newprofile.");
        return;
      }

      const perPage = 20;
      const pages = Math.ceil(profiles.length / perPage);
      const requestedPage = parseIndex(arg) ?? 1;
      const page = Math.min(Math.max(requestedPage, 1), pages);
      const start = (page - 1) * perPage;
      const slice = profiles.slice(start, start + perPage);

      const totalImages = profiles.reduce((sum, p) => sum + p.imageCount, 0);
      const totalVideos = profiles.reduce((sum, p) => sum + p.videoCount, 0);

      const lines = [
        `Profiles (${profiles.length}) — ${totalImages} images · ${totalVideos} videos`,
        ``,
        ...slice.map((profile, index) => {
          const number = start + index + 1;
          const status = profile.active ? "" : " (inactive)";
          return (
            `${number}. ${profile.name} — slug: ${profile.slug}${status}\n` +
            `   ${profile.imageCount} image(s) · ${profile.videoCount} video(s)`
          );
        }),
      ];
      if (pages > 1) {
        lines.push(
          ``,
          `Page ${page}/${pages}` +
            (page < pages ? ` — send /profiles ${page + 1} for the next page` : "")
        );
      }
      lines.push(
        ``,
        `Edit any of them with /edit <slug> · test playback with /checkvideos <slug>`
      );
      await sendMessage(env, chatId, lines.join("\n"));
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

    case "/bulk": {
      if (!arg) {
        const draft = await ensureDraft(env, chatId);
        draft.bulkAwaiting = true;
        await saveDraft(env, draft);
        await sendMessage(
          env,
          chatId,
          `Bulk generation\n` +
            `Send your list in the next message, one entry per line or separated by commas.\n\n` +
            `• https://site.com/profile            → images and videos from that page\n` +
            `• https://site.com/p & https://site.com/videos → images from the first, videos from the second\n` +
            `• images: https://…  videos: https://…        → same thing with labels\n\n` +
            `Up to ${MAX_BULK_ENTRIES} entries. Each entry becomes its own profile.\n` +
            `Links to your own site (/dreamgirl/<slug>) are read from the database.\n\n` +
            `Every batch stops at a preview — nothing is created until you send\n` +
            `/confirm (all) or /confirm 1,3 (some). /previewall shows the write-ups.\n` +
            `Cancel with /bulkcancel.`
        );
        return;
      }
      await startBulk(env, origin, chatId, arg);
      return;
    }

    case "/bulknext": {
      const queue = await getBulkQueue(env, chatId);
      if (!queue || queue.entries.length === 0) {
        await clearBulkQueue(env, chatId);
        await sendMessage(
          env,
          chatId,
          "No queued bulk entries left. Send /bulk to start a new batch."
        );
        return;
      }
      await prepareBulk(env, origin, chatId);
      return;
    }

    case "/bulkpreview":
    case "/previewall": {
      const shown = await previewBulk(env, chatId, arg || "all");
      if (!shown) {
        await sendMessage(
          env,
          chatId,
          "Nothing prepared to preview. Send /bulk with your list first."
        );
      }
      return;
    }

    case "/confirmall": {
      await confirmBulk(env, origin, chatId, arg || "");
      return;
    }

    case "/skip": {
      await skipBulk(env, chatId, arg || "");
      return;
    }

    case "/bulkcancel": {
      const queue = await getBulkQueue(env, chatId);
      const review = await getBulkReview(env, chatId);
      await clearBulkQueue(env, chatId);
      await clearBulkReview(env, chatId);
      const pending = await getDraft(env, chatId);
      if (pending?.bulkAwaiting) {
        pending.bulkAwaiting = false;
        await saveDraft(env, pending);
      }
      const queued = queue?.entries.length || 0;
      const waiting = review?.entries.length || 0;
      await sendMessage(
        env,
        chatId,
        queued > 0 || waiting > 0
          ? `Bulk batch cancelled — ${[queued > 0 ? `${queued} not prepared` : "", waiting > 0 ? `${waiting} previewed but not created` : ""]
              .filter(Boolean)
              .join(", ")}. Nothing was created.`
          : "No bulk batch to cancel."
      );
      return;
    }

    case "/edit": {
      if (!arg) {
        await sendMessage(
          env,
          chatId,
          "Usage: /edit <profile slug>\n" +
            "Loads an existing profile so you can add, replace or delete its images and videos."
        );
        return;
      }
      // Accept a bare slug, "@slug" or a full profile URL.
      let slug = arg.trim().replace(/^@/, "").replace(/^\/+/, "");
      if (/^https?:\/\//i.test(slug)) {
        try {
          const segments = new URL(slug).pathname.split("/").filter(Boolean);
          slug = segments[segments.length - 1] || slug;
        } catch {
          // keep the raw value; the lookup below will fail cleanly
        }
      }
      let profile;
      try {
        profile = await loadProfileForEdit(env, slug);
      } catch (err) {
        await sendMessage(env, chatId, (err as Error).message);
        return;
      }
      if (!profile) {
        await sendMessage(env, chatId, `No active profile with slug "${slug}".`);
        return;
      }

      let videoRows;
      try {
        videoRows = await loadProfileVideos(env, profile.id);
      } catch (err) {
        await sendMessage(env, chatId, (err as Error).message);
        return;
      }

      const gallery = (profile.gallery || "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);

      const draft = await ensureDraft(env, chatId);
      const hadMaterial =
        Boolean(draft.edit) ||
        draft.media.length > 0 ||
        draft.imageLinks.length > 0 ||
        draft.videoLinks.length > 0 ||
        Boolean(draft.writeUp.trim());
      draft.writeUp = "";
      draft.media = [];
      draft.scraped = null;
      draft.generated = null;
      draft.nameOverride = null;
      draft.slugOverride = null;
      draft.imageLinks = [
        profile.profileImage,
        profile.coverImage,
        ...gallery,
      ].filter((url): url is string => Boolean(url));
      draft.videoLinks = videoRows.map((row, index) => ({
        kind: "url" as const,
        url: row.url,
        title: row.title || `Video ${index + 1}`,
        messageId: 0,
        videoId: row.id,
      }));
      draft.edit = {
        personaId: profile.id,
        slug: profile.slug,
        name: profile.name,
        originalVideos: videoRows.map((row) => ({
          id: row.id,
          url: row.url,
          title: row.title,
        })),
      };
      await saveDraft(env, draft);

      await sendMessage(
        env,
        chatId,
        `Editing profile: ${profile.name} (/${profile.slug})\n\n` +
          (formatUrlList("Images", draft.imageLinks) || "Images: none") +
          `\n\n` +
          (formatUrlList(
            "Videos",
            draft.videoLinks.map((v) => videoLabel(v.url))
          ) || "Videos: none") +
          `\n\nAdd more: send photos/videos or paste links (JPEG images only).` +
          `\nChange: /replaceimage <n> <url>, /replacevideo <n> <url>` +
          `\nDelete: /removeimage <n>, /removevideo <n>, /clearvideos` +
          `\nApply with /save, or /cancel to discard.` +
          (hadMaterial ? `\n\n(The previous draft was replaced.)` : "")
      );
      return;
    }

    case "/save": {
      await runSave(env, origin, chatId);
      return;
    }

    case "/removeimage": {
      const draft = await getExistingDraft(env, chatId);
      if (!draft) return;
      const images = workingImages(env, origin, draft);
      const index = parseIndex(arg);
      if (index === null || index > images.length) {
        await sendMessage(
          env,
          chatId,
          `Usage: /removeimage <number 1-${images.length || 0}>\n` +
            (formatUrlList("Current images", images) || "No images in the draft yet.")
        );
        return;
      }
      const [removed] = images.splice(index - 1, 1);
      setWorkingImages(draft, images);
      await saveDraft(env, draft);
      await sendMessage(
        env,
        chatId,
        `Removed image #${index}:\n${removed}\n\n` +
          (formatUrlList("Images left", images) || "No images left.") +
          `\n\n${nextStep(draft)}`
      );
      return;
    }

    case "/replaceimage": {
      const draft = await getExistingDraft(env, chatId);
      if (!draft) return;
      const images = workingImages(env, origin, draft);
      const parts = arg.split(/\s+/).filter(Boolean);
      const index = parseIndex(parts[0]);
      const url = (parts[1] || "").trim();
      if (index === null || index > images.length || !url) {
        await sendMessage(
          env,
          chatId,
          `Usage: /replaceimage <number> <jpeg url>\n` +
            (formatUrlList("Current images", images) || "No images in the draft yet.")
        );
        return;
      }
      if (!IMAGE_URL_RE.test(url)) {
        await sendMessage(
          env,
          chatId,
          "Only JPEG images are accepted (.jpg/.jpeg). Convert the image to JPEG and try again."
        );
        return;
      }
      const previous = images[index - 1];
      images[index - 1] = url;
      setWorkingImages(draft, images);
      await saveDraft(env, draft);
      await sendMessage(
        env,
        chatId,
        `Replaced image #${index}:\n${previous}\n-> ${url}\n\n` +
          (formatUrlList("Images now", images) || "No images left.") +
          `\n\n${nextStep(draft)}`
      );
      return;
    }

    case "/removevideo": {
      const draft = await getExistingDraft(env, chatId);
      if (!draft) return;
      const videos = workingVideos(env, origin, draft);
      const index = parseIndex(arg);
      if (index === null || index > videos.length) {
        await sendMessage(
          env,
          chatId,
          `Usage: /removevideo <number 1-${videos.length || 0}>\n` +
            (formatUrlList(
              "Current videos",
              videos.map((v) => videoLabel(v.url))
            ) || "No videos in the draft yet.")
        );
        return;
      }
      const [removed] = videos.splice(index - 1, 1);
      setWorkingVideos(
        draft,
        videos.map((v, i) => ({ ...v, title: v.title || `Video ${i + 1}` }))
      );
      await saveDraft(env, draft);
      await sendMessage(
        env,
        chatId,
        `Removed video #${index}:\n${removed.url}\n\n` +
          (formatUrlList(
            "Videos left",
            videos.map((v) => videoLabel(v.url))
          ) || "No videos left.") +
          `\n\n${nextStep(draft)}`
      );
      return;
    }

    case "/replacevideo": {
      const draft = await getExistingDraft(env, chatId);
      if (!draft) return;
      const videos = workingVideos(env, origin, draft);
      const parts = arg.split(/\s+/).filter(Boolean);
      const index = parseIndex(parts[0]);
      const url = (parts[1] || "").trim();
      if (index === null || index > videos.length || !url) {
        await sendMessage(
          env,
          chatId,
          `Usage: /replacevideo <number> <video url>\n` +
            (formatUrlList(
              "Current videos",
              videos.map((v) => videoLabel(v.url))
            ) || "No videos in the draft yet.")
        );
        return;
      }
      if (classifyUrl(url) !== "video" && !isPlayableVideoUrl(url)) {
        await sendMessage(
          env,
          chatId,
          `That does not look like a video link. Use a direct file (.mp4/.webm/.m3u8) or a player/embed URL.`
        );
        return;
      }
      const previous = videos[index - 1];
      videos[index - 1] = {
        ...previous,
        url,
        title: previous.title || `Video ${index}`,
      };
      setWorkingVideos(draft, videos);
      await saveDraft(env, draft);
      await sendMessage(
        env,
        chatId,
        `Replaced video #${index}:\n${previous.url}\n-> ${videoLabel(url)}\n\n` +
          (formatUrlList(
            "Videos now",
            videos.map((v) => videoLabel(v.url))
          ) || "No videos left.") +
          `\n\n${nextStep(draft)}`
      );
      return;
    }

    case "/clearvideos": {
      const draft = await getExistingDraft(env, chatId);
      if (!draft) return;
      const videos = workingVideos(env, origin, draft);
      if (videos.length === 0) {
        await sendMessage(env, chatId, "There are no videos in this draft.");
        return;
      }
      setWorkingVideos(draft, []);
      await saveDraft(env, draft);
      await sendMessage(
        env,
        chatId,
        `Removed all ${videos.length} video(s) from the draft.\n` +
          (draft.edit
            ? `Run /save to delete them from the profile (the change is not applied yet).`
            : `Run /confirm to create the profile without videos.`)
      );
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

    case "/preview": {
      // With a bulk review waiting, /preview <n> shows that prepared profile
      // instead of generating a new single draft.
      if (arg && /^\s*(?:all|\d[\d,\s]*)$/i.test(arg)) {
        const shown = await previewBulk(env, chatId, arg);
        if (shown) return;
      }
      await runPreview(env, origin, chatId);
      return;
    }

    case "/confirm": {
      const active = await getDraft(env, chatId);
      if (active?.edit) {
        // In edit mode "confirm" means "apply the changes".
        await runSave(env, origin, chatId);
        return;
      }
      // A bulk preview is waiting: /confirm creates the prepared profiles.
      const review = await getBulkReview(env, chatId);
      if (review && (review.entries.length > 0 || review.failed.length > 0)) {
        await confirmBulk(env, origin, chatId, arg || "");
        return;
      }
      await runConfirm(env, origin, chatId);
      return;
    }

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

// ---------------------------------------------------------------------------
// Bulk generation
//
// Two stages, so nothing is ever created by accident:
//   1. prepare — scrape + AI for up to MAX_BULK_PER_CALL entries, stored in a
//      review set in KV. This is the preview.
//   2. commit — /confirm writes the prepared profiles to the database.
// ---------------------------------------------------------------------------
/** Rough subrequest ceiling per webhook call (Workers limit is 50). */
const BULK_SUBREQUEST_BUDGET = 40;
/** Profiles written per /confirm call (each is a DB insert + video rows). */
const MAX_BULK_COMMIT_PER_CALL = 6;

function progressBits(entry: PreparedBulkEntry): string {
  const bits = [
    `${entry.images.length} image(s)`,
    `${entry.videos.length} video(s)`,
  ];
  if (entry.skippedVideos) bits.push(`${entry.skippedVideos} video(s) skipped`);
  if (entry.usedFallbackText) bits.push("text fallback");
  return bits.join(" · ");
}

/** Renumber entries so /confirm and /preview always match what was shown. */
function renumber(review: BulkReview): void {
  review.entries.forEach((entry, index) => {
    entry.id = index + 1;
  });
}

/** One summary line per prepared entry. */
function formatReviewSummary(review: BulkReview): string {
  const ready = review.entries.length;
  const failed = review.failed.length;
  if (ready === 0 && failed === 0) return "Nothing has been prepared yet.";

  const lines = [`Bulk preview (${ready} ready${failed ? `, ${failed} failed` : ""})`, ""];
  for (const [index, entry] of review.entries.entries()) {
    lines.push(
      `${index + 1}. ${entry.name} — slug: ${entry.slug}\n   ${progressBits(entry)}`
    );
  }
  if (failed > 0) {
    lines.push("");
    for (const [index, failure] of review.failed.entries()) {
      lines.push(`${ready + index + 1}. ✗ ${failure.raw}\n   ${failure.error}`);
    }
  }
  return lines.join("\n");
}

/** Full write-up + every URL, for /previewall and /preview <n>. */
function formatPreparedFull(entry: PreparedBulkEntry, position: number): string {
  const draft = entry.draft;
  const location =
    [draft.city, draft.country].filter(Boolean).join(", ") || "unknown";
  const images =
    formatUrlList("Images", entry.images) || "Images: none";
  const videos =
    formatUrlList("Videos", entry.videos) || "Videos: none";
  return (
    `${position}. ${draft.name} — slug: ${entry.slug}\n` +
    `   ${progressBits(entry)}\n` +
    `   Source: ${entry.imageSource}` +
    (entry.videoSource !== entry.imageSource
      ? `\n   Videos from: ${entry.videoSource}`
      : "") +
    `\n\n` +
    `   Description: ${draft.description}\n` +
    `   Age/Location: ${draft.age ?? "?"} / ${location}\n` +
    `   Occupation: ${draft.occupation || "unknown"}\n` +
    `   Personality: ${draft.personality}\n` +
    `   Speaking: ${draft.speakingStyle}\n` +
    `   Flirt level: ${draft.flirtLevel}/4 · Emojis: ${draft.emojiFrequency || "n/a"}\n\n` +
    `   ${images.split("\n").join("\n   ")}\n` +
    `   ${videos.split("\n").join("\n   ")}`
  );
}

function formatCommitResults(results: BulkResult[]): string {
  return results
    .map((result, index) => {
      const number = index + 1;
      if (!result.ok) {
        return `${number}. ✗ ${result.raw}\n   ${result.error || "failed"}`;
      }
      const bits = [
        `${result.images ?? 0} image(s)`,
        `${result.videos ?? 0} video(s)`,
      ];
      if (result.skippedVideos) bits.push(`${result.skippedVideos} video(s) skipped`);
      if (result.usedFallbackText) bits.push("text fallback");
      return (
        `${number}. ✓ ${result.name} — slug: ${result.slug}\n` +
        `   ${bits.join(" · ")}\n` +
        `   ${result.link}`
      );
    })
    .join("\n\n");
}

function confirmHint(review: BulkReview): string {
  if (review.entries.length === 0) {
    return review.failed.length > 0
      ? "Nothing to confirm — every entry failed. Send /bulk with new links."
      : "Nothing waiting to be confirmed.";
  }
  return (
    `Send /confirm to create all ${review.entries.length}, ` +
    `/confirm 1,3 to pick, /previewall for full write-ups and URLs, ` +
    `/skip <n> to drop one, /cancelbulk to discard.`
  );
}

async function showReview(
  env: Env,
  chatId: number,
  review: BulkReview,
  notes: string[]
): Promise<void> {
  const body = formatReviewSummary(review);
  const footer = confirmHint(review);
  await sendMessage(
    env,
    chatId,
    body + (notes.length > 0 ? `\n\n${notes.join("\n")}` : "") + `\n\n${footer}`
  );
}

async function startBulk(
  env: Env,
  origin: string,
  chatId: number,
  input: string
): Promise<void> {
  const { entries, skipped, overflow } = parseBulkList(input);
  if (entries.length === 0) {
    await sendMessage(
      env,
      chatId,
      "I could not find any URLs in that list.\n" +
        "Send it as: https://site/a, https://site/b & https://site/b-videos"
    );
    return;
  }

  // A new batch replaces any unfinished one.
  await clearBulkQueue(env, chatId);
  await clearBulkReview(env, chatId);

  const queue: BulkQueue = {
    entries,
    createdAt: Date.now(),
    done: 0,
    failed: 0,
  };
  await saveBulkQueue(env, chatId, queue);

  const notes: string[] = [];
  if (skipped.length > 0) {
    notes.push(`${skipped.length} line(s) had no usable URL and were skipped.`);
  }
  if (overflow > 0) {
    notes.push(`Only the first ${MAX_BULK_ENTRIES} entries were kept.`);
  }

  await sendMessage(
    env,
    chatId,
    `Bulk: ${entries.length} entr${entries.length === 1 ? "y" : "ies"}. ` +
      `Scraping and writing previews — nothing is created until you confirm.` +
      (notes.length > 0 ? `\n${notes.join("\n")}` : "")
  );

  // Previews are built with the request origin so the links are absolute.
  await prepareBulk(env, origin, chatId, notes);
}

/**
 * Prepare the next chunk of the queue and show the combined preview. Called by
 * /bulk and /bulknext; repeated calls drain the queue.
 */
async function prepareBulk(
  env: Env,
  origin: string,
  chatId: number,
  notes: string[] = []
): Promise<void> {
  const queue = (await getBulkQueue(env, chatId)) || {
    entries: [],
    createdAt: Date.now(),
    done: 0,
    failed: 0,
  };
  const review =
    (await getBulkReview(env, chatId)) || {
      entries: [],
      failed: [],
      createdAt: Date.now(),
    };

  const preparedBefore = review.entries.length;
  let spent = 0;
  let attempted = 0;

  while (
    queue.entries.length > 0 &&
    attempted < MAX_BULK_PER_CALL &&
    (attempted === 0 || spent < BULK_SUBREQUEST_BUDGET)
  ) {
    const entry = queue.entries.shift() as BulkEntry;
    attempted += 1;
    try {
      const prepared = await prepareBulkEntry(
        env,
        origin,
        entry,
        review.entries.length + 1
      );
      spent += prepared.subrequests;
      review.entries.push(prepared);
    } catch (err) {
      spent += 1;
      review.failed.push({ raw: entry.raw, error: (err as Error).message });
    }
  }

  renumber(review);
  if (queue.entries.length > 0) await saveBulkQueue(env, chatId, queue);
  else await clearBulkQueue(env, chatId);

  const added = review.entries.length + review.failed.length - preparedBefore;
  if (added === 0 && review.entries.length === 0) {
    await clearBulkReview(env, chatId);
    await sendMessage(
      env,
      chatId,
      `Nothing could be prepared from that list.\n\n` +
        (review.failed
          .map((failure) => `✗ ${failure.raw}\n   ${failure.error}`)
          .join("\n\n") || "No entries were queued.")
    );
    return;
  }

  if (review.entries.length > 0) await saveBulkReview(env, chatId, review);
  else await clearBulkReview(env, chatId);

  if (queue.entries.length > 0) {
    notes.push(
      `${queue.entries.length} entr${queue.entries.length === 1 ? "y" : "ies"} still queued — /bulknext prepares the rest.`
    );
  }
  await showReview(env, chatId, review, notes);
}

/** Parse "1,3 5" into 1-based positions, clamped to the review size. */
function parsePositions(arg: string, size: number): number[] {
  const positions: number[] = [];
  for (const match of arg.match(/\d+/g) || []) {
    const value = Number(match);
    if (Number.isFinite(value) && value >= 1 && value <= size) {
      if (!positions.includes(value)) positions.push(value);
    }
  }
  return positions;
}

async function confirmBulk(
  env: Env,
  origin: string,
  chatId: number,
  arg: string
): Promise<void> {
  const review = await getBulkReview(env, chatId);
  if (!review || review.entries.length === 0) {
    await clearBulkReview(env, chatId);
    await sendMessage(
      env,
      chatId,
      review && review.failed.length > 0
        ? `Nothing can be confirmed — all ${review.failed.length} entr${
            review.failed.length === 1 ? "y" : "ies"
          } failed:\n\n` +
            review.failed
              .map((failure) => `✗ ${failure.raw}\n   ${failure.error}`)
              .join("\n\n") +
            "\n\nSend /bulk with new links."
        : "Nothing waiting to be confirmed. Start a batch with /bulk."
    );
    return;
  }

  renumber(review);
  const wanted = arg.trim();
  const positions = wanted ? parsePositions(wanted, review.entries.length) : [];
  if (wanted && positions.length === 0) {
    await sendMessage(
      env,
      chatId,
      `I could not read "${wanted}". Use /confirm, /confirm 1,3 or /previewall.`
    );
    return;
  }

  const selected = positions.length > 0 ? positions : review.entries.map((e) => e.id);
  // Resolve positions to entries *before* committing: removing entries while
  // iterating stale positions used to skip profiles, because the remaining
  // entries are renumbered after every commit.
  const capped: PreparedBulkEntry[] = [];
  let budget = 0;
  for (const position of selected) {
    if (capped.length >= MAX_BULK_COMMIT_PER_CALL) break;
    const entry = review.entries.find((candidate) => candidate.id === position);
    if (!entry || capped.includes(entry)) continue;
    // Each profile is one insert plus one insert per video; keep the webhook
    // inside the Workers subrequest budget.
    const cost = 2 + entry.videos.length;
    if (capped.length > 0 && budget + cost > BULK_SUBREQUEST_BUDGET) break;
    budget += cost;
    capped.push(entry);
  }

  await sendMessage(env, chatId, `Creating ${capped.length} profile(s)…`);

  const results: BulkResult[] = [];
  for (const entry of capped) {
    const result = await commitBulkEntry(env, origin, entry);
    results.push(result);
    if (result.ok) {
      review.entries = review.entries.filter((candidate) => candidate !== entry);
    }
  }
  renumber(review);

  const header = `Bulk confirm (${results.filter((r) => r.ok).length}/${results.length} created)`;
  const remaining = review.entries.length;
  const notAttempted = Math.max(0, selected.length - capped.length);
  const footerParts: string[] = [];
  if (notAttempted > 0) {
    footerParts.push(
      `${notAttempted} more still waiting — send /confirm again for the next batch.`
    );
  }
  const queue = await getBulkQueue(env, chatId);
  const queued = queue?.entries.length || 0;
  if (remaining > 0) {
    footerParts.push(
      `${remaining} profile(s) still pending — /confirm to create them, /previewall to review.`
    );
  } else if (queued > 0) {
    footerParts.push(
      `${queued} entr${queued === 1 ? "y" : "ies"} still queued — /bulknext prepares them for preview.`
    );
  } else if (review.failed.length > 0) {
    footerParts.push(
      `${review.failed.length} entr${review.failed.length === 1 ? "y" : "ies"} failed and cannot be created.`
    );
  } else {
    footerParts.push("Queue finished. /profiles lists everything; /edit <slug> changes images or videos.");
  }

  if (review.entries.length > 0 || review.failed.length > 0) {
    await saveBulkReview(env, chatId, review);
  } else {
    await clearBulkReview(env, chatId);
  }

  await sendMessage(
    env,
    chatId,
    `${header}\n\n${formatCommitResults(results)}\n\n${footerParts.join("\n")}`
  );
}

async function previewBulk(
  env: Env,
  chatId: number,
  arg: string
): Promise<boolean> {
  const review = await getBulkReview(env, chatId);
  if (!review || review.entries.length === 0) return false;

  renumber(review);
  const wanted = arg.trim().toLowerCase();
  const positions =
    !wanted || wanted === "all"
      ? review.entries.map((entry) => entry.id)
      : parsePositions(wanted, review.entries.length);

  if (positions.length === 0) {
    await sendMessage(
      env,
      chatId,
      `Use /previewall, /preview 1 or /preview 1,3 (you have ${review.entries.length} ready).`
    );
    return true;
  }

  const blocks = positions.map((position) => {
    const entry = review.entries.find((candidate) => candidate.id === position);
    return entry ? formatPreparedFull(entry, position) : "";
  });
  const header =
    positions.length === review.entries.length
      ? `Full preview (${positions.length})`
      : `Preview (${positions.join(", ")})`;
  await sendMessage(
    env,
    chatId,
    `${header}\n\n${blocks.filter(Boolean).join("\n\n")}\n\n${confirmHint(review)}`
  );
  return true;
}

async function skipBulk(
  env: Env,
  chatId: number,
  arg: string
): Promise<void> {
  const review = await getBulkReview(env, chatId);
  if (!review || review.entries.length === 0) {
    await sendMessage(env, chatId, "Nothing waiting to be skipped. Start a batch with /bulk.");
    return;
  }
  renumber(review);
  const wanted = arg.trim().toLowerCase();
  const positions =
    wanted === "all"
      ? review.entries.map((entry) => entry.id)
      : parsePositions(wanted, review.entries.length);

  if (positions.length === 0) {
    await sendMessage(
      env,
      chatId,
      `Usage: /skip <n> — you have ${review.entries.length} prepared. /skip all clears them.`
    );
    return;
  }

  const removed = review.entries.filter((entry) => positions.includes(entry.id));
  review.entries = review.entries.filter((entry) => !positions.includes(entry.id));
  renumber(review);

  if (review.entries.length > 0 || review.failed.length > 0) {
    await saveBulkReview(env, chatId, review);
  } else {
    await clearBulkReview(env, chatId);
  }

  await sendMessage(
    env,
    chatId,
    `Skipped ${removed.length} profile(s):\n` +
      removed.map((entry) => `• ${entry.name} (${entry.slug})`).join("\n") +
      (review.entries.length > 0
        ? `\n\n${review.entries.length} still ready — ${confirmHint(review)}`
        : "\n\nNothing left to confirm.")
  );
}

/**
 * Edit mode: apply the draft's images and videos to the profile loaded with
 * /edit. Images rewrite the profile/cover/gallery columns; video rows are
 * updated in place, missing ones deleted, and new entries inserted.
 */
async function runSave(env: Env, origin: string, chatId: number): Promise<void> {
  const draft = await getExistingDraft(env, chatId);
  if (!draft) return;

  if (!draft.edit) {
    await sendMessage(
      env,
      chatId,
      "Nothing to save — no profile is loaded for editing.\n" +
        "Use /edit <slug> to change an existing profile, or /confirm to create a new one."
    );
    return;
  }

  const edit = draft.edit;
  const images = workingImages(env, origin, draft).slice(0, MAX_IMAGES);
  if (images.length === 0) {
    await sendMessage(
      env,
      chatId,
      `"${edit.slug}" needs at least one image. Send a JPEG photo or /replaceimage 1 <jpeg url>.`
    );
    return;
  }

  const requested = workingVideos(env, origin, draft);
  const videos: WorkingVideo[] = [];
  let unresolved = 0;
  const budget = newPlaybackBudget(8);
  for (const video of requested) {
    const url = await toPlayableVideoUrl(video.url, budget);
    if (url) videos.push({ ...video, url });
    else unresolved += 1;
  }
  const cappedVideos = videos.slice(0, MAX_VIDEOS);

  try {
    await saveProfileMedia(env, edit.personaId, {
      profileImage: images[0] ?? null,
      coverImage: images[1] ?? null,
      gallery: images.slice(2, 2 + MAX_GALLERY),
    });
  } catch (err) {
    await sendMessage(env, chatId, (err as Error).message);
    return;
  }

  const keptIds = new Set(
    cappedVideos.map((v) => v.videoId).filter((id): id is string => Boolean(id))
  );

  let removed = 0;
  for (const original of edit.originalVideos) {
    if (keptIds.has(original.id)) continue;
    if (await removeProfileVideo(env, edit.personaId, original.id)) removed += 1;
  }

  let updated = 0;
  let added = 0;
  for (const [index, video] of cappedVideos.entries()) {
    if (video.videoId) {
      const original = edit.originalVideos.find((v) => v.id === video.videoId);
      if (original && original.url !== video.url) {
        if (
          await updateProfileVideo(env, edit.personaId, video.videoId, {
            url: video.url,
            title: video.title || original.title,
          })
        ) {
          updated += 1;
        }
      }
      continue;
    }
    if (
      await addVideo(env, edit.personaId, {
        url: video.url,
        title: video.title || `Video ${index + 1}`,
      })
    ) {
      added += 1;
    }
  }

  const galleryCount = Math.max(0, Math.min(images.length - 2, MAX_GALLERY));
  await sendMessage(
    env,
    chatId,
    `Profile updated: ${edit.name}\n` +
      `Link: ${profileLink(env, origin, edit.slug)}\n` +
      `Images: ${images.length} (profile + cover + ${galleryCount} gallery)\n` +
      `Videos: ${cappedVideos.length} total · ${added} added · ${updated} replaced · ${removed} deleted` +
      (unresolved > 0
        ? ` · ${unresolved} skipped (no playable stream)`
        : "") +
      `\n\n` +
      (formatUrlList("Images used", images) || "Images used: none") +
      `\n\n` +
      (formatUrlList(
        "Video URLs used",
        cappedVideos.map((v) => videoLabel(v.url))
      ) || "Video URLs used: none") +
      `\n\nThe draft is cleared. Use /edit ${edit.slug} again for more changes.`
  );
  await deleteDraft(env, chatId);
}

async function runPreview(
  env: Env,
  origin: string,
  chatId: number
): Promise<void> {
  const draft = await getExistingDraft(env, chatId);
  if (!draft) return;

  // Edit mode only changes media — show what /save would write.
  if (draft.edit) {
    const images = workingImages(env, origin, draft);
    const videos = workingVideos(env, origin, draft);
    await sendMessage(
      env,
      chatId,
      `Editing ${draft.edit.name} (/${draft.edit.slug}) — no text changes in edit mode.\n\n` +
        `${formatUrlList("Images it will save", images) || "Images it will save: none"}\n\n` +
        `${formatUrlList("Videos it will save", videos.map((v) => videoLabel(v.url))) || "Videos it will save: none"}\n\n` +
        `Run /save to apply, or /cancel to discard.`
    );
    return;
  }

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
        `${statusLine(env, origin, draft)}\n\n` +
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
  // Uploaded photos live on our own media proxy (/api/media/<fileId>, served
  // as image/jpeg); pasted and scraped images must be real JPEGs.
  for (const link of draft.imageLinks) {
    if (IMAGE_URL_RE.test(link) || isLocalMediaUrl(link)) urls.push(link);
  }
  if (draft.scraped) {
    for (const link of draft.scraped.images) {
      if (IMAGE_URL_RE.test(link) || isLocalMediaUrl(link)) urls.push(link);
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
  const budget = newPlaybackBudget(8);

  for (const candidate of candidates) {
    // Bound the extra network work inside one webhook call.
    const url = await toPlayableVideoUrl(candidate.url, budget);
    if (url) {
      if (!playable.some((video) => video.url === url)) {
        playable.push({ ...candidate, url });
      }
      continue;
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
  await sendMessage(
    env,
    chatId,
    `Profile created: ${generated.name}\n` +
      `Link: ${profileLink(env, origin, slug)}\n` +
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
  origin: string,
  msg: TelegramMessage,
  text: string
): Promise<void> {
  const chatId = msg.chat.id;
  const draft = await ensureDraft(env, chatId);
  const replies: string[] = [];

  // 1) Media attached to the message (photos / videos / documents).
  //    Uploads are appended to the ordered working lists so the numbering in
  //    /links stays stable and new material never silently becomes the
  //    profile picture in edit mode.
  const media = extractMedia(msg);
  for (const item of media) {
    const url = buildPublicMediaUrl(env, origin, item.fileId);

    if (item.kind === "photo") {
      const images = workingImages(env, origin, draft);
      if (images.length >= MAX_IMAGES) {
        replies.push(`Image limit is ${MAX_IMAGES} total — extra photo ignored.`);
        continue;
      }
      await registerMedia(env, item.fileId, item.kind, item.mime);
      setWorkingImages(draft, [...images, url]);
      const count = images.length + 1;
      replies.push(
        `Added to the draft: photo #${count}` +
          (count === 1
            ? " (profile picture)"
            : count === 2
              ? " (cover)"
              : " (gallery)") +
          " (JPEG)."
      );
      continue;
    }

    const videos = workingVideos(env, origin, draft);
    if (videos.length >= MAX_VIDEOS) {
      replies.push(`Video limit is ${MAX_VIDEOS} — extra video ignored.`);
      continue;
    }
    await registerMedia(env, item.fileId, item.kind, item.mime);
    setWorkingVideos(draft, [
      ...videos,
      {
        url,
        title: `Clip ${videos.length + 1}`,
        messageId: msg.message_id,
      },
    ]);
    replies.push(
      `Added to the draft: video (${videos.length + 1} so far). ` +
        `Files over ${TELEGRAM_DOWNLOAD_LIMIT_MB}MB cannot be downloaded by bots — send a URL instead.`
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
      const videos = workingVideos(env, origin, draft);
      if (videos.length >= MAX_VIDEOS) {
        replies.push(`Video limit is ${MAX_VIDEOS} — ${url} ignored.`);
        continue;
      }
      if (!videos.some((v) => v.url === url)) {
        setWorkingVideos(draft, [
          ...videos,
          { url, title: `Video ${videos.length + 1}`, messageId: msg.message_id },
        ]);
      }
      replies.push(
        isPlayableVideoUrl(url)
          ? `Added to the draft as a video:\n${url}`
          : `Added to the draft as a video embed (the real stream is resolved when you /confirm):\n${url}`
      );
      continue;
    }

    if (kind === "image") {
      const images = workingImages(env, origin, draft);
      if (images.length >= MAX_IMAGES) {
        replies.push(`Image limit is ${MAX_IMAGES} — ${url} ignored.`);
        continue;
      }
      if (!images.includes(url)) setWorkingImages(draft, [...images, url]);
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
    replies.push(
      draft.edit
        ? "Got it. Use /status to review the changes or /save to apply them."
        : "Got it. Use /status to review the draft or /preview to generate."
    );
  }
  if (draft.edit && !replies.some((r) => r.includes("/save"))) {
    replies.push("Run /save to apply these changes to the profile.");
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

  const chatId = msg.chat.id;
  const text = (msg.text || msg.caption || "").trim();
  if (text.startsWith("/")) {
    await handleCommand(env, requestOrigin, msg, text);
    return;
  }

  // A /bulk with no list waits for the next message to be the list.
  const draft = await getDraft(env, chatId);
  if (draft?.bulkAwaiting && /https?:\/\//i.test(text)) {
    draft.bulkAwaiting = false;
    await saveDraft(env, draft);
    await startBulk(env, requestOrigin, chatId, text);
    return;
  }
  if (draft?.bulkAwaiting) {
    draft.bulkAwaiting = false;
    await saveDraft(env, draft);
    await sendMessage(
      env,
      chatId,
      "That did not contain any links. Nothing was generated — send /bulk again when you have your list."
    );
    return;
  }

  await handleIntake(env, requestOrigin, msg, text);
}
