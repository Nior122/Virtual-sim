import type {
  BulkEntry,
  Draft,
  Env,
  MediaKind,
  PreparedBulkEntry,
  StoredMedia,
} from "./types";
import { DRAFT_TTL_SECONDS } from "./types";

const draftKey = (chatId: number) => `draft:${chatId}`;
const mediaKey = (fileId: string) => `media:${fileId}`;
const bulkKey = (chatId: number) => `bulk:${chatId}`;
const reviewKey = (chatId: number) => `bulkreview:${chatId}`;

export async function getDraft(env: Env, chatId: number): Promise<Draft | null> {
  return env.BOT_KV.get<Draft>(draftKey(chatId), "json");
}

/** Load the draft or create an empty one. */
export async function ensureDraft(env: Env, chatId: number): Promise<Draft> {
  const existing = await getDraft(env, chatId);
  if (existing) return existing;
  const now = Date.now();
  return {
    chatId,
    writeUp: "",
    media: [],
    videoLinks: [],
    imageLinks: [],
    scraped: null,
    generated: null,
    edit: null,
    nameOverride: null,
    slugOverride: null,
    createdAt: now,
    updatedAt: now,
  };
}

export async function saveDraft(env: Env, draft: Draft): Promise<void> {
  draft.updatedAt = Date.now();
  await env.BOT_KV.put(draftKey(draft.chatId), JSON.stringify(draft), {
    expirationTtl: DRAFT_TTL_SECONDS,
  });
}

export async function deleteDraft(env: Env, chatId: number): Promise<void> {
  await env.BOT_KV.delete(draftKey(chatId));
}

/**
 * Register a Telegram file_id on the media proxy allowlist.
 * Entries are permanent: persona records reference these IDs indefinitely.
 */
export async function registerMedia(
  env: Env,
  fileId: string,
  kind: MediaKind,
  mime?: string
): Promise<void> {
  const record: StoredMedia = { kind, fileId, mime, messageId: 0 };
  await env.BOT_KV.put(mediaKey(fileId), JSON.stringify(record));
}

export async function lookupMedia(
  env: Env,
  fileId: string
): Promise<StoredMedia | null> {
  return env.BOT_KV.get<StoredMedia>(mediaKey(fileId), "json");
}

/** Append media to a draft while preserving Telegram message ordering. */
export function appendMedia(draft: Draft, item: StoredMedia): void {
  draft.media.push(item);
  draft.media.sort((a, b) => a.messageId - b.messageId);
  // Regenerating after new material invalidates the old preview.
  draft.generated = null;
}

// ---------------------------------------------------------------------------
// Bulk generation queue (entries still waiting to be processed)
// ---------------------------------------------------------------------------
export interface BulkQueue {
  entries: BulkEntry[];
  createdAt: number;
  /** Results already reported, so /bulknext can summarise the whole batch */
  done: number;
  failed: number;
}

export async function getBulkQueue(
  env: Env,
  chatId: number
): Promise<BulkQueue | null> {
  return env.BOT_KV.get<BulkQueue>(bulkKey(chatId), "json");
}

export async function saveBulkQueue(
  env: Env,
  chatId: number,
  queue: BulkQueue
): Promise<void> {
  await env.BOT_KV.put(bulkKey(chatId), JSON.stringify(queue), {
    expirationTtl: DRAFT_TTL_SECONDS,
  });
}

export async function clearBulkQueue(
  env: Env,
  chatId: number
): Promise<void> {
  await env.BOT_KV.delete(bulkKey(chatId));
}

// ---------------------------------------------------------------------------
// Bulk review set — prepared profiles waiting for /confirm
// ---------------------------------------------------------------------------
export interface BulkReview {
  /** Entries ready to be created, in the order they were prepared. */
  entries: PreparedBulkEntry[];
  /** Entries that could not be prepared (shown in the preview). */
  failed: Array<{ raw: string; error: string }>;
  createdAt: number;
}

export async function getBulkReview(
  env: Env,
  chatId: number
): Promise<BulkReview | null> {
  const review = await env.BOT_KV.get<BulkReview>(reviewKey(chatId), "json");
  if (!review) return null;
  return { entries: review.entries || [], failed: review.failed || [], createdAt: review.createdAt || Date.now() };
}

export async function saveBulkReview(
  env: Env,
  chatId: number,
  review: BulkReview
): Promise<void> {
  await env.BOT_KV.put(reviewKey(chatId), JSON.stringify(review), {
    expirationTtl: DRAFT_TTL_SECONDS,
  });
}

export async function clearBulkReview(
  env: Env,
  chatId: number
): Promise<void> {
  await env.BOT_KV.delete(reviewKey(chatId));
}
