// ---------------------------------------------------------------------------
// Everything the web backend does, without a request/response in sight.
//
// The Pages Functions in `functions/api/admin/*` are thin wrappers around these
// functions, and the scratch test exercises them directly. All write paths go
// through the same repository helpers the Telegram bot uses, so a profile
// created here is identical to one created with /confirm.
// ---------------------------------------------------------------------------
import type { Env, PersonaDraft, PreparedBulkEntry } from "../bot/types";
import { MAX_GALLERY, MAX_IMAGES } from "../bot/types";
import {
  addVideo,
  buildPersonaPayload,
  createPersona,
  uniqueSlug,
} from "../bot/repo";
import {
  commitBulkEntry,
  parseBulkList,
  prepareBulkEntry,
  type BulkResult,
} from "../bot/bulk";
import { isJpegResponse, inspectPage, type PageDiagnostics } from "../bot/scrape";
import { newPlaybackBudget, prepareVideoUrls } from "../bot/videos";
import { publicBaseUrl } from "../bot/public-url";
import { generatePersonaResponse, providerStatus } from "../ai/provider";
import {
  countVideosByPersona,
  createVideoRecord,
  deletePersonaRecord,
  deletePersonaVideo,
  getPersonaForAdmin,
  getPersonaForChat,
  listAdminPersonaRows,
  listPersonaVideosForAdmin,
  personaSlugExists,
  updatePersonaRecord,
  type AdminPersonaRow,
} from "../db/neon";
import {
  MAX_LINK_TTL_SECONDS,
  clampTtl,
  createAccessLink,
  formatRemaining,
  listAccessLinks,
  readAdUrl,
  readPrivateMode,
  revokeAccessLinks,
  shareUrl,
  writeAdUrl,
  writePrivateMode,
  type AccessLink,
} from "../access/mode";
import { verifyPassword } from "./auth";

/** A problem the admin can fix. Status is passed straight to the client. */
export class AdminError extends Error {
  status: number;
  details?: unknown;
  constructor(message: string, status = 400, details?: unknown) {
    super(message);
    this.name = "AdminError";
    this.status = status;
    this.details = details;
  }
}

// ---------------------------------------------------------------------------
// Site state: private mode, ad URL, share links
// ---------------------------------------------------------------------------
export interface LinkView {
  token: string;
  slug: string;
  url: string;
  createdAt: number;
  expiresAt: number;
  remaining: string;
  uses: number;
}

function linkView(link: AccessLink, base: string): LinkView {
  return {
    token: link.token,
    slug: link.slug,
    url: shareUrl(base, link.token),
    createdAt: link.createdAt,
    expiresAt: link.expiresAt,
    remaining: formatRemaining(link.expiresAt),
    uses: link.uses,
  };
}

export async function siteState(env: Env, origin: string) {
  const [mode, adUrl, links] = await Promise.all([
    readPrivateMode(env),
    readAdUrl(env),
    listAccessLinks(env),
  ]);
  const base = publicBaseUrl(env, origin);
  return {
    private: mode.enabled,
    updatedAt: mode.updatedAt,
    adUrl,
    links: links.map((link) => linkView(link, base)),
    base,
    maxLinkSeconds: MAX_LINK_TTL_SECONDS,
  };
}

export async function setPrivateMode(env: Env, enabled: boolean) {
  const mode = await writePrivateMode(env, enabled);
  return mode;
}

export async function setAdUrl(env: Env, url: string | null) {
  try {
    return await writeAdUrl(env, url);
  } catch (err) {
    throw new AdminError((err as Error).message, 400);
  }
}

const SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

export async function createShareLink(
  env: Env,
  origin: string,
  slugInput: string,
  secondsInput: number
): Promise<LinkView> {
  const slug = String(slugInput || "").trim().toLowerCase();
  if (!SLUG_RE.test(slug)) {
    throw new AdminError("That is not a valid slug.");
  }
  const row = await getPersonaForAdmin(env, slug);
  if (!row || row.active === false) {
    throw new AdminError(`No active profile has the slug "${slug}".`, 404);
  }
  const seconds = Number(secondsInput);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new AdminError("Choose a lifetime between 5 minutes and 30 days.");
  }
  const link = await createAccessLink(env, slug, clampTtl(seconds));
  return linkView(link, publicBaseUrl(env, origin));
}

export async function revokeLinks(env: Env, selector: string): Promise<number> {
  const wanted = String(selector || "").trim();
  if (!wanted) throw new AdminError("Say which link to revoke (token, slug or all).");
  return revokeAccessLinks(env, wanted);
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------
export interface ProfileSummaryView {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  images: number;
  videos: number;
  profileImage: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

function splitGallery(value: unknown): string[] {
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.filter((entry): entry is string => typeof entry === "string");
      }
    } catch {
      // fall through to the comma form
    }
  }
  return trimmed
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** The ordered image slots of a profile: profile, cover, then gallery. */
function imagesOf(row: Record<string, unknown>): string[] {
  const images: string[] = [];
  if (typeof row.profileImage === "string" && row.profileImage) {
    images.push(row.profileImage);
  }
  if (typeof row.coverImage === "string" && row.coverImage) {
    images.push(row.coverImage);
  }
  for (const url of splitGallery(row.gallery)) {
    if (!images.includes(url)) images.push(url);
  }
  return images;
}

export async function listProfiles(env: Env): Promise<ProfileSummaryView[]> {
  let rows: AdminPersonaRow[];
  let counts: Array<{ personaId: string; count: number | string }> = [];
  try {
    rows = await listAdminPersonaRows(env);
  } catch (err) {
    throw new AdminError(`Could not read the database: ${(err as Error).message}`, 502);
  }
  try {
    counts = await countVideosByPersona(env);
  } catch {
    counts = [];
  }
  const videos = new Map<string, number>();
  for (const row of counts) videos.set(row.personaId, Number(row.count) || 0);

  return rows.map((row) => {
    const gallery = splitGallery(row.gallery);
    const images =
      (row.profileImage ? 1 : 0) + (row.coverImage ? 1 : 0) + gallery.length;
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      active: row.active !== false,
      images,
      videos: videos.get(row.id) ?? 0,
      profileImage: row.profileImage,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  });
}

export interface ProfileVideoView {
  id?: string;
  url: string;
  title: string;
  active?: boolean;
}

export async function getProfile(
  env: Env,
  idOrSlug: string
): Promise<(Record<string, unknown> & { images: string[]; videos: ProfileVideoView[] }) | null> {
  let row: Record<string, unknown> | null = null;
  try {
    row = await getPersonaForAdmin(env, idOrSlug);
  } catch (err) {
    throw new AdminError(`Could not read the database: ${(err as Error).message}`, 502);
  }
  if (!row) return null;
  const videos = await listPersonaVideosForAdmin(env, String(row.id));
  return {
    ...row,
    images: imagesOf(row),
    videos: videos.map((video) => ({
      id: video.id,
      url: video.url,
      title: video.title,
      active: video.active !== false,
    })),
  };
}

/** Text columns the admin editor can change, with their validation. */
const TEXT_FIELDS = [
  "name", "description", "age", "city", "country", "occupation", "languages",
  "shortBio", "longBio", "bodyType", "bustSize", "height", "eyeColor",
  "hairColor", "tattoosAndPiercings", "turnOns", "turnOffs", "fantasies",
  "intimacyStyle", "preferredVibe", "kinksAndFetishes", "favoriteLingerie",
  "eroticInterests", "personality", "interests", "hobbies", "likes",
  "dislikes", "background", "speakingStyle", "communicationTone",
  "emojiFrequency", "systemPrompt",
] as const;

/** Columns the database declares NOT NULL. */
const REQUIRED_TEXT = [
  "name",
  "description",
  "personality",
  "interests",
  "background",
  "speakingStyle",
] as const;

function cleanField(key: string, value: unknown): unknown {
  if (key === "age") {
    if (value === null || value === "") return null;
    const age = Number(value);
    if (!Number.isFinite(age) || age < 18 || age > 99) {
      throw new AdminError("Age must be a number between 18 and 99.");
    }
    return Math.round(age);
  }
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value;
  return String(value).trim().slice(0, 8000) || null;
}

/** Collect the editable text fields from a request body. */
function readFields(input: Record<string, unknown>): Record<string, unknown> {
  const source =
    input.fields && typeof input.fields === "object"
      ? (input.fields as Record<string, unknown>)
      : input;
  const out: Record<string, unknown> = {};
  for (const key of TEXT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      out[key] = cleanField(key, source[key]);
    }
  }
  if (Object.prototype.hasOwnProperty.call(source, "active")) {
    out.active = Boolean(source.active);
  }
  for (const key of REQUIRED_TEXT) {
    if (key in out && out[key] === null) {
      throw new AdminError(`${key} cannot be empty.`);
    }
  }
  if ("flirtLevel" in source) {
    const level = Number(source.flirtLevel);
    if (!Number.isFinite(level) || level < 0 || level > 4) {
      throw new AdminError("Flirt level must be between 0 and 4.");
    }
    out.flirtLevel = Math.round(level);
  }
  return out;
}

interface ImageCheck {
  ok: string[];
  rejected: Array<{ url: string; reason: string }>;
}

/**
 * Verify every image the admin wants to store.
 * Only real image/jpeg responses are kept — a broken or WebP URL would show a
 * blank card on the public site, and the bot already refuses those.
 */
async function verifyImages(
  urls: string[],
  referer: string
): Promise<ImageCheck> {
  const unique: string[] = [];
  for (const url of urls) {
    if (typeof url !== "string") continue;
    const trimmed = url.trim();
    if (!/^https?:\/\//i.test(trimmed)) continue;
    if (!unique.includes(trimmed)) unique.push(trimmed);
  }
  const results = await Promise.all(
    unique.map(async (url) => {
      try {
        const ok = await isJpegResponse(url, referer);
        return { url, ok };
      } catch (err) {
        return { url, ok: false, reason: (err as Error).message };
      }
    })
  );
  return {
    ok: results.filter((entry) => entry.ok).map((entry) => entry.url),
    rejected: results
      .filter((entry) => !entry.ok)
      .map((entry) => ({
        url: entry.url,
        reason: entry.reason || "not served as image/jpeg",
      })),
  };
}

function readVideoList(input: unknown): Array<{ url: string; title: string }> {
  if (!Array.isArray(input)) return [];
  const out: Array<{ url: string; title: string }> = [];
  for (const entry of input) {
    const url =
      typeof entry === "string"
        ? entry.trim()
        : typeof entry === "object" && entry
          ? String((entry as { url?: unknown }).url || "").trim()
          : "";
    if (!/^https?:\/\//i.test(url)) continue;
    if (out.some((video) => video.url === url)) continue;
    const title =
      typeof entry === "object" && entry && typeof (entry as { title?: unknown }).title === "string"
        ? String((entry as { title?: string }).title).trim().slice(0, 200)
        : "";
    out.push({ url, title });
  }
  return out;
}

/**
 * Resolve videos to playable URLs and rewrite the persona's rows.
 * `skipped` counts embeds with no usable stream (the bot drops those too).
 */
async function writeVideos(
  env: Env,
  personaId: string,
  wanted: Array<{ url: string; title: string }>
): Promise<{ saved: number; skipped: number; existing: number; removed: number; added: number }> {
  const budget = newPlaybackBudget(8);
  const prepared = await prepareVideoUrls(
    wanted.map((video) => video.url),
    budget
  );
  const resolved = new Set(prepared.urls);

  const current = await listPersonaVideosForAdmin(env, personaId);
  let removed = 0;
  for (const row of current) {
    if (!resolved.has(row.url)) {
      if (await deletePersonaVideo(env, personaId, row.id)) removed += 1;
    }
  }
  const kept = new Set(current.filter((row) => resolved.has(row.url)).map((row) => row.url));

  let added = 0;
  for (const url of prepared.urls) {
    if (kept.has(url)) continue;
    const source = wanted.find((video) => video.url === url);
    const title = source?.title || `Video ${kept.size + added + 1}`;
    try {
      await createVideoRecord(env, { personaId, url, title });
      added += 1;
    } catch (err) {
      console.error("admin: could not attach video", err);
    }
  }

  return {
    saved: prepared.urls.length,
    skipped: prepared.unresolved,
    existing: kept.size,
    removed,
    added,
  };
}

export interface SaveProfileInput {
  fields?: Record<string, unknown>;
  images?: unknown;
  videos?: unknown;
  [key: string]: unknown;
}

export async function saveProfile(
  env: Env,
  idOrSlug: string,
  input: SaveProfileInput,
  origin: string
) {
  const row = await getPersonaForAdmin(env, idOrSlug).catch((err) => {
    throw new AdminError(`Could not read the database: ${(err as Error).message}`, 502);
  });
  if (!row) throw new AdminError("Profile not found.", 404);

  const updates: Record<string, unknown> = readFields(input as Record<string, unknown>);

  // Slug changes need a uniqueness check; the bot does the same on create.
  const wantedSlug =
    typeof (input.fields as Record<string, unknown>)?.slug === "string"
      ? String((input.fields as Record<string, unknown>).slug).trim().toLowerCase()
      : typeof input.slug === "string"
        ? String(input.slug).trim().toLowerCase()
        : "";
  if (wantedSlug && wantedSlug !== String(row.slug).toLowerCase()) {
    if (!SLUG_RE.test(wantedSlug)) {
      throw new AdminError("Slug may only contain letters, numbers, dots, dashes and underscores.");
    }
    if (await personaSlugExists(env, wantedSlug)) {
      throw new AdminError(`The slug "${wantedSlug}" is already in use.`, 409);
    }
    updates.slug = wantedSlug;
  }

  let images: string[] | null = null;
  if (Array.isArray(input.images)) {
    const requested = (input.images as unknown[])
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean)
      .slice(0, MAX_IMAGES);
    if (requested.length === 0) {
      throw new AdminError("A profile needs at least one image.");
    }
    const check = await verifyImages(requested, publicBaseUrl(env, origin));
    if (check.rejected.length > 0) {
      throw new AdminError(
        `${check.rejected.length} image URL(s) are not served as JPEG. Fix or remove them, then save again.`,
        422,
        { rejected: check.rejected }
      );
    }
    images = check.ok.slice(0, MAX_IMAGES);
    updates.profileImage = images[0] ?? null;
    updates.coverImage = images[1] ?? null;
    updates.gallery = images.slice(2, 2 + MAX_GALLERY).join(",");
  }

  if (Object.keys(updates).length > 0) {
    const saved = await updatePersonaRecord(env, String(row.id), updates).catch(
      (err) => {
        throw new AdminError(`The database rejected the change: ${(err as Error).message}`, 502);
      }
    );
    if (!saved) throw new AdminError("Nothing was updated.");
  }

  let videoResult: Awaited<ReturnType<typeof writeVideos>> | null = null;
  if (Array.isArray(input.videos)) {
    videoResult = await writeVideos(env, String(row.id), readVideoList(input.videos));
  }

  const profile = await getProfile(env, String(row.id));
  return { profile, videoResult };
}

export async function createProfileRecord(
  env: Env,
  input: SaveProfileInput,
  origin: string
) {
  const fields = readFields(input as Record<string, unknown>);
  const name = String(fields.name || "").trim();
  if (!name) throw new AdminError("A profile needs a name.");
  for (const key of REQUIRED_TEXT) {
    if (key !== "name" && !fields[key]) {
      throw new AdminError(`"${key}" cannot be empty.`);
    }
  }

  const slugFromFields =
    typeof (input.fields as Record<string, unknown>)?.slug === "string"
      ? String((input.fields as Record<string, unknown>).slug).trim()
      : "";
  const requestedSlug = (
    slugFromFields ||
    (typeof input.slug === "string" ? input.slug.trim() : "") ||
    name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  ).toLowerCase();
  if (!SLUG_RE.test(requestedSlug)) {
    throw new AdminError("Slug may only contain letters, numbers, dots, dashes and underscores.");
  }
  const slug = await uniqueSlug(env, requestedSlug);

  if (!Array.isArray(input.images) || input.images.length === 0) {
    throw new AdminError("A profile needs at least one image.");
  }
  const requested = (input.images as unknown[])
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean)
    .slice(0, MAX_IMAGES);
  const check = await verifyImages(requested, publicBaseUrl(env, origin));
  if (check.rejected.length > 0) {
    throw new AdminError(
      `${check.rejected.length} image URL(s) are not served as JPEG.`,
      422,
      { rejected: check.rejected }
    );
  }
  const images = check.ok;
  if (images.length === 0) {
    throw new AdminError("A profile needs at least one image.", 422);
  }

  const draft: PersonaDraft = {
    name,
    slug,
    description: String(fields.description || ""),
    personality: String(fields.personality || ""),
    interests: String(fields.interests || ""),
    background: String(fields.background || ""),
    speakingStyle: String(fields.speakingStyle || ""),
    flirtLevel: Number(fields.flirtLevel ?? 2),
    age: fields.age == null ? null : Number(fields.age),
    city: (fields.city as string) ?? null,
    country: (fields.country as string) ?? null,
    occupation: (fields.occupation as string) ?? null,
    languages: (fields.languages as string) ?? null,
    shortBio: (fields.shortBio as string) ?? null,
    longBio: (fields.longBio as string) ?? null,
    bodyType: (fields.bodyType as string) ?? null,
    height: (fields.height as string) ?? null,
    eyeColor: (fields.eyeColor as string) ?? null,
    hairColor: (fields.hairColor as string) ?? null,
    turnOns: (fields.turnOns as string) ?? null,
    turnOffs: (fields.turnOffs as string) ?? null,
    fantasies: (fields.fantasies as string) ?? null,
    intimacyStyle: (fields.intimacyStyle as string) ?? null,
    preferredVibe: (fields.preferredVibe as string) ?? null,
    kinksAndFetishes: (fields.kinksAndFetishes as string) ?? null,
    eroticInterests: (fields.eroticInterests as string) ?? null,
    hobbies: (fields.hobbies as string) ?? null,
    likes: (fields.likes as string) ?? null,
    dislikes: (fields.dislikes as string) ?? null,
    communicationTone: (fields.communicationTone as string) ?? null,
    emojiFrequency: (fields.emojiFrequency as string) ?? null,
    systemPrompt: (fields.systemPrompt as string) ?? null,
  };

  const payload = buildPersonaPayload(draft, slug, {
    profileImage: images[0] ?? null,
    coverImage: images[1] ?? null,
    gallery: images.slice(2, 2 + MAX_GALLERY),
  });

  let created: { id: string; slug: string; name: string };
  try {
    created = await createPersona(env, payload);
  } catch (err) {
    throw new AdminError((err as Error).message, 502);
  }

  let videos = { saved: 0, skipped: 0, existing: 0, removed: 0, added: 0 };
  if (Array.isArray(input.videos)) {
    videos = await writeVideos(env, created.id, readVideoList(input.videos));
  }

  return {
    id: created.id,
    slug: created.slug,
    name: created.name,
    images: images.length,
    videos,
  };
}

export async function deleteProfile(env: Env, idOrSlug: string): Promise<void> {
  const row = await getPersonaForAdmin(env, idOrSlug).catch((err) => {
    throw new AdminError(`Could not read the database: ${(err as Error).message}`, 502);
  });
  if (!row) throw new AdminError("Profile not found.", 404);
  const removed = await deletePersonaRecord(env, String(row.id)).catch((err) => {
    throw new AdminError(`The database rejected the delete: ${(err as Error).message}`, 502);
  });
  if (!removed) throw new AdminError("The profile was not deleted.", 502);
}

// ---------------------------------------------------------------------------
// Import: scrape a page, preview it, then commit it
// ---------------------------------------------------------------------------
export interface PreparedImport {
  ok: boolean;
  error?: string;
  prepared?: PreparedBulkEntry;
}

export async function prepareImportEntry(
  env: Env,
  origin: string,
  raw: string
): Promise<PreparedImport> {
  const parsed = parseBulkList(String(raw || ""));
  if (parsed.entries.length === 0) {
    return { ok: false, error: "No URL found in that line." };
  }
  try {
    const prepared = await prepareBulkEntry(env, origin, parsed.entries[0], 1);
    return { ok: true, prepared };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Validate the preview the browser sends back before writing anything. */
function readPrepared(value: unknown): PreparedBulkEntry {
  if (!value || typeof value !== "object") {
    throw new AdminError("Missing prepared entry.");
  }
  const entry = value as Record<string, unknown>;
  const draft = entry.draft as Record<string, unknown> | undefined;
  if (!draft || typeof draft !== "object") {
    throw new AdminError("Missing generated profile text.");
  }
  const name = String(draft.name || "").trim();
  if (!name) throw new AdminError("The prepared profile has no name.");
  const images = Array.isArray(entry.images)
    ? (entry.images as unknown[]).filter(
        (url): url is string => typeof url === "string" && /^https?:\/\//i.test(url)
      )
    : [];
  if (images.length === 0) throw new AdminError("The prepared profile has no images.");
  if (images.length > MAX_IMAGES) {
    throw new AdminError(`At most ${MAX_IMAGES} images can be stored.`);
  }
  const videos = Array.isArray(entry.videos)
    ? (entry.videos as unknown[]).filter(
        (url): url is string => typeof url === "string" && /^https?:\/\//i.test(url)
      )
    : [];

  return {
    id: Number(entry.id) || 1,
    raw: String(entry.raw || ""),
    imageSource: String(entry.imageSource || ""),
    videoSource: String(entry.videoSource || ""),
    slug: String(entry.slug || name),
    name,
    draft: draft as unknown as PersonaDraft,
    images,
    videos,
    skippedVideos: Number(entry.skippedVideos) || 0,
    usedFallbackText: Boolean(entry.usedFallbackText),
    subrequests: 0,
  };
}

export async function commitImportEntry(
  env: Env,
  origin: string,
  value: unknown
): Promise<BulkResult> {
  const prepared = readPrepared(value);
  return commitBulkEntry(env, origin, prepared);
}

// ---------------------------------------------------------------------------
// Chat test
// ---------------------------------------------------------------------------
export async function testChat(
  env: Env,
  slug: string,
  message: string
): Promise<{ reply: string; provider: string; name: string; engine: string }> {
  const persona = await getPersonaForChat(env, slug).catch((err) => {
    throw new AdminError(`Could not read the database: ${(err as Error).message}`, 502);
  });
  if (!persona) throw new AdminError("No active profile has that slug.", 404);
  const text = String(message || "").trim();
  if (!text) throw new AdminError("Type a question first.");

  const { content, provider } = await generatePersonaResponse({
    // The DB row carries every field the prompt builder reads.
    persona: persona as never,
    messages: [{ role: "user", content: text }],
    envOverride: env as unknown as Record<string, any>,
  });
  return {
    reply: content,
    provider,
    name: String(persona.name || slug),
    engine: provider,
  };
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------
export async function diagnose(url: string): Promise<PageDiagnostics> {
  if (!/^https?:\/\//i.test(String(url || ""))) {
    throw new AdminError("Paste a full http(s) URL.");
  }
  return inspectPage(String(url), 6);
}

export interface VideoCheck {
  url: string;
  ok: boolean;
  status: number;
  contentType: string;
  error?: string;
}

/** HEAD each video URL and report whether it looks playable. */
export async function checkVideoUrls(urls: string[]): Promise<VideoCheck[]> {
  const list = urls
    .filter((url): url is string => typeof url === "string" && /^https?:\/\//i.test(url))
    .slice(0, 20);
  const results: VideoCheck[] = [];

  for (const url of list) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      let response = await fetch(url, {
        method: "HEAD",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
          Accept: "*/*",
        },
      });
      // Some CDNs reject HEAD; fall back to a one-byte GET.
      if (response.status === 405 || response.status === 501) {
        response = await fetch(url, {
          redirect: "follow",
          signal: controller.signal,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
            Range: "bytes=0-0",
          },
        });
      }
      results.push({
        url,
        ok: response.ok || response.status === 206,
        status: response.status,
        contentType: response.headers.get("content-type") || "",
      });
    } catch (err) {
      results.push({
        url,
        ok: false,
        status: 0,
        contentType: "",
        error: (err as Error).message,
      });
    } finally {
      clearTimeout(timer);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------
export async function overview(env: Env, origin: string) {
  const site = await siteState(env, origin);
  let profileCount: number | null = null;
  let activeCount: number | null = null;
  let databaseError: string | null = null;
  try {
    const rows = await listAdminPersonaRows(env);
    profileCount = rows.length;
    activeCount = rows.filter((row) => row.active !== false).length;
  } catch (err) {
    databaseError = (err as Error).message;
  }

  return {
    site,
    profiles: { total: profileCount, active: activeCount },
    databaseError,
    configured: {
      password: true,
      kv: Boolean((env as unknown as { BOT_KV?: KVNamespace }).BOT_KV),
      database: Boolean(env.DATABASE_URL),
      telegram: Boolean(env.TELEGRAM_BOT_TOKEN),
      ownerChat: Boolean(env.OWNER_CHAT_ID),
    },
    ai: providerStatus(env as unknown as Record<string, any>),
  };
}

/** Login helper used by the session endpoint. */
export async function checkPassword(env: Env, typed: string): Promise<boolean> {
  return verifyPassword(env, typed);
}
