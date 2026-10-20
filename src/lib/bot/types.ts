// ---------------------------------------------------------------------------
// Environment bindings & secrets (configured in the Cloudflare Pages project)
// ---------------------------------------------------------------------------
export interface Env {
  /** KV namespace storing per-chat draft profiles and the media allowlist */
  BOT_KV: KVNamespace;
  /** Bot token from @BotFather */
  TELEGRAM_BOT_TOKEN: string;
  /** Shared secret sent by Telegram as X-Telegram-Bot-Api-Secret-Token */
  TELEGRAM_WEBHOOK_SECRET: string;
  /** Groq OpenAI-compatible API key (optional when OpenRouter is set) */
  GROQ_API_KEY?: string;
  /** Optional Groq model override (defaults to llama-3.3-70b-versatile) */
  GROQ_MODEL?: string;
  /** OpenRouter API key — fallback writer when Groq is missing or fails */
  OPENROUTER_API_KEY?: string;
  /** Optional OpenRouter model override
   *  (defaults to meta-llama/llama-3.3-70b-instruct) */
  OPENROUTER_MODEL?: string;
  /** Neon PostgreSQL connection string (serverless driver, HTTPS) */
  DATABASE_URL: string;
  /** Public base URL of THIS Pages project (media + profile links).
   *  Falls back to the incoming request origin at runtime. */
  PUBLIC_BASE_URL?: string;
}

// ---------------------------------------------------------------------------
// Minimal Telegram Bot API types (only what the bot consumes)
// ---------------------------------------------------------------------------
export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramVideo {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  duration: number;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  mime_type?: string;
  file_name?: string;
  file_size?: number;
}

export interface TelegramMessage {
  message_id: number;
  date: number;
  chat: { id: number; type?: string; first_name?: string };
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  video?: TelegramVideo;
  video_note?: TelegramVideo;
  document?: TelegramDocument;
  media_group_id?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

// ---------------------------------------------------------------------------
// Draft profile state (persisted in KV, one per chat)
// ---------------------------------------------------------------------------
export type MediaKind = "photo" | "video";

export interface StoredMedia {
  kind: MediaKind;
  fileId: string;
  mime?: string;
  messageId: number;
}

export interface VideoLink {
  kind: "url";
  url: string;
  title?: string;
  messageId: number;
  /** Existing PersonaVideo row this link came from (edit mode only) */
  videoId?: string;
}

/**
 * State for editing an already-published profile. While a draft has `edit`
 * set, /save writes the draft's media back to that persona instead of
 * creating a new one.
 */
export interface DraftEditState {
  personaId: string;
  slug: string;
  name: string;
  /** Video rows that existed when the edit started (missing ones are deleted) */
  originalVideos: Array<{ id: string; url: string; title: string }>;
}

export type DraftVideo = StoredMedia | VideoLink;

export interface ScrapedProfile {
  sourceUrl: string;
  title?: string;
  description?: string;
  images: string[];
  videos: string[];
  textSnippet?: string;
  blocked?: boolean;
  /** How many paginated pages were fetched for this scrape */
  pagesScanned: number;
  /** Every page URL actually scanned, in order */
  sourceUrls: string[];
  /** Image URLs seen on the pages (before JPEG verification) */
  imageCandidates?: number;
  /** Candidates dropped because they were not served as image/jpeg */
  imagesRejected?: number;
  /** Individual post pages opened to reach hidden main images/videos */
  detailPagesScanned?: number;
  /** Content-type probes spent verifying extensionless image URLs */
  imageChecks?: number;
}

/**
 * One line of a bulk generation list: a profile page, or an image source and
 * a separate video source separated by "&" / labels.
 */
export interface BulkEntry {
  /** The entry exactly as the user typed it */
  raw: string;
  /** Where images come from (equal to videoSource when only one URL was given) */
  imageSource: string;
  /** Where videos come from */
  videoSource: string;
}

export interface PersonaDraft {
  name: string;
  slug: string;
  description: string;
  age?: number | null;
  city?: string | null;
  country?: string | null;
  occupation?: string | null;
  languages?: string | null;
  shortBio?: string | null;
  longBio?: string | null;
  personality: string;
  background: string;
  interests: string;
  hobbies?: string | null;
  likes?: string | null;
  dislikes?: string | null;
  speakingStyle: string;
  communicationTone?: string | null;
  flirtLevel: number;
  emojiFrequency?: string | null;
  bodyType?: string | null;
  height?: string | null;
  eyeColor?: string | null;
  hairColor?: string | null;
  turnOns?: string | null;
  turnOffs?: string | null;
  fantasies?: string | null;
  intimacyStyle?: string | null;
  preferredVibe?: string | null;
  kinksAndFetishes?: string | null;
  eroticInterests?: string | null;
  systemPrompt?: string | null;
}

export interface Draft {
  chatId: number;
  writeUp: string;
  /** Photos + Telegram videos, ordered by Telegram message_id on confirm */
  media: StoredMedia[];
  videoLinks: VideoLink[];
  /** Direct image URLs pasted into chat (used after Telegram photos) */
  imageLinks: string[];
  scraped?: ScrapedProfile | null;
  generated?: PersonaDraft | null;
  /** Set when this draft edits an existing profile instead of creating one */
  edit?: DraftEditState | null;
  /** True right after /bulk with no list: the next message is the bulk list */
  bulkAwaiting?: boolean;
  /** Manual overrides applied on top of Groq output */
  nameOverride?: string | null;
  slugOverride?: string | null;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Limits & constants
// ---------------------------------------------------------------------------
/** Total images accepted: 1 profile + 1 cover + up to 5 gallery */
export const MAX_IMAGES = 7;
export const MAX_GALLERY = 5;
/** Telegram Bot API getFile hard limit */
export const TELEGRAM_DOWNLOAD_LIMIT_MB = 20;
export const DRAFT_TTL_SECONDS = 60 * 60 * 24; // 24 hours
