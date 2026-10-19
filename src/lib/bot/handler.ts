import type {
  Draft,
  Env,
  PersonaDraft,
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
import { scrapeProfile } from "./scrape";
import {
  addVideo,
  buildPersonaPayload,
  createPersona,
  uniqueSlug,
} from "./repo";
import { buildPublicMediaUrl } from "./media";

const IMAGE_URL_RE = /\.(jpe?g|png|webp|gif)(\?|#|$)/i;
const VIDEO_URL_RE = /\.(mp4|webm|mov|m4v|m3u8)(\?|#|$)/i;
const EMBED_URL_RE = /(embed|rubyvidhub|\.html|m3u8)/i;
const URL_RE = /https?:\/\/[^\s]+/gi;
const MAX_VIDEOS = 20;

const HELP_TEXT = `Dream Babe profile bot

/newprofile — start a fresh profile draft
Then send, in any order:
 • Photos (1st = profile picture, 2nd = cover, next up to ${MAX_GALLERY} go to the gallery, ${MAX_IMAGES} total)
 • Videos as files (under ${TELEGRAM_DOWNLOAD_LIMIT_MB}MB) or paste direct video/embed URLs
 • Any write-up text — bios, traits, background. Multiple messages are combined
/scrape <url> — pull images, videos and text from a public profile page
/preview — Groq writes the full profile from your material
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

function statusLine(draft: Draft): string {
  const photos = photoCount(draft);
  const videos = tgVideoCount(draft) + draft.videoLinks.length +
    (draft.scraped?.videos.length || 0);
  const lines = [
    `Draft status:`,
    `• Photos: ${photos} Telegram + ${draft.imageLinks.length} links + ${draft.scraped?.images.length || 0} scraped`,
    `• Videos: ${videos}`,
    `• Write-up: ${draft.writeUp ? draft.writeUp.length + " chars" : "empty"}`,
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
        await sendMessage(env, chatId, "Usage: /scrape https://example.com/profile");
        return;
      }
      const draft = await ensureDraft(env, chatId);
      await sendMessage(env, chatId, "Scraping that page, one moment…");
      try {
        const scraped = await scrapeProfile(arg);
        draft.scraped = scraped;
        draft.generated = null;
        await saveDraft(env, draft);
        await sendMessage(
          env,
          chatId,
          `Scraped: ${scraped.title || "untitled"}\n` +
            `• ${scraped.images.length} images, ${scraped.videos.length} videos\n` +
            (scraped.description ? `• ${scraped.description.slice(0, 200)}\n` : "") +
            `Send more material or run /preview.`
        );
      } catch (err) {
        await sendMessage(env, chatId, `Scrape failed: ${(err as Error).message}`);
      }
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
      await runPreview(env, chatId);
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

async function runPreview(env: Env, chatId: number): Promise<void> {
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

  await sendMessage(env, chatId, "Groq is writing the profile…");
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
  for (const media of draft.media.filter((m) => m.kind === "photo")) {
    urls.push(buildPublicMediaUrl(env, origin, media.fileId));
  }
  for (const link of draft.imageLinks) urls.push(link);
  if (draft.scraped) for (const link of draft.scraped.images) urls.push(link);
  return [...new Set(urls)].slice(0, MAX_IMAGES);
}

interface ResolvedVideo {
  url: string;
  title: string;
}

function resolveVideos(env: Env, origin: string, draft: Draft): ResolvedVideo[] {
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

  const videos = resolveVideos(env, origin, draft);
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
      `Videos attached: ${attached}/${videos.length}\n\n` +
      `The draft is cleared. Start another with /newprofile.`
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
        ? `Photo #${photoCount(draft)} saved${photoCount(draft) === 1 ? " (profile picture)" : photoCount(draft) === 2 ? " (cover)" : " (gallery)"}.`
        : `Video saved (${tgVideoCount(draft)} so far). Files over ${TELEGRAM_DOWNLOAD_LIMIT_MB}MB cannot be downloaded by bots — send a URL instead.`
    );
  }

  // 2) URLs inside text/caption: classify as video links, image links, or scrape hint.
  const urls = text.match(URL_RE) || [];
  const prose = text.replace(URL_RE, " ").trim();
  for (const raw of urls) {
    const url = raw.replace(/[).,]+$/, "");
    if (VIDEO_URL_RE.test(url) || EMBED_URL_RE.test(url)) {
      if (draft.videoLinks.length + tgVideoCount(draft) >= MAX_VIDEOS) {
        replies.push(`Video limit is ${MAX_VIDEOS} — ${url} ignored.`);
        continue;
      }
      draft.videoLinks.push({ kind: "url", url, messageId: msg.message_id });
      draft.generated = null;
      replies.push("Video URL added to the call section.");
    } else if (IMAGE_URL_RE.test(url)) {
      if (draft.imageLinks.length + photoCount(draft) >= MAX_IMAGES) {
        replies.push(`Image limit is ${MAX_IMAGES} — ${url} ignored.`);
        continue;
      }
      draft.imageLinks.push(url);
      draft.generated = null;
      replies.push("Image URL added.");
    } else {
      replies.push(
        `Link saved as context: ${url} (use /scrape <url> to extract a full profile).`
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
