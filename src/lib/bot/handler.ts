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
  isLocalMediaUrl,
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
/scrape <url> [video count] [max pages] — pull JPEG images and videos across paginated profile pages; no count = all (max 50), pages default 5 (e.g. /scrape https://x.com/p 30 5)
Any link you paste is scraped and merged into your draft automatically
/image <url> and /video <url> — force-add a direct JPEG or video link
/links — list every image and video URL currently in the draft
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
      const draft = await ensureDraft(env, chatId);
      draft.writeUp = "";
      draft.media = [];
      draft.videoLinks = [];
      draft.imageLinks = [];
      draft.scraped = null;
      draft.generated = null;
      draft.edit = null;
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
      const draft = await getExistingDraft(env, chatId);
      if (!draft) return;
      await sendMessage(env, chatId, statusLine(env, origin, draft));
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

    case "/preview":
      await runPreview(env, origin, chatId);
      return;

    case "/confirm": {
      const active = await getDraft(env, chatId);
      if (active?.edit) {
        // In edit mode "confirm" means "apply the changes".
        await runSave(env, origin, chatId);
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
  let embedAttempts = 0;
  for (const video of requested) {
    if (isPlayableVideoUrl(video.url)) {
      videos.push(video);
      continue;
    }
    if (isEmbedUrl(video.url) && embedAttempts < 8) {
      embedAttempts += 1;
      const resolved = await resolveStreamUrl(video.url, 6000);
      if (resolved && (isPlayableVideoUrl(resolved) || isDirectVideoUrl(resolved))) {
        videos.push({ ...video, url: resolved });
        continue;
      }
    }
    unresolved += 1;
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
  const siteBase = (env.PUBLIC_BASE_URL || origin).replace(/\/+$/, "");
  await sendMessage(
    env,
    chatId,
    `Profile updated: ${edit.name}\n` +
      `Link: ${siteBase}/dreamgirl/${edit.slug}\n` +
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

  const text = (msg.text || msg.caption || "").trim();
  if (text.startsWith("/")) {
    await handleCommand(env, requestOrigin, msg, text);
    return;
  }
  await handleIntake(env, requestOrigin, msg, text);
}
