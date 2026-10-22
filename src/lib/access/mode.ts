// ---------------------------------------------------------------------------
// Private mode + expiring share links.
//
// Private mode turns the public site into "link only": the home page, the
// browse grid and every profile except the one in the visitor's share link are
// hidden. The state lives in KV so the Telegram bot can flip it and the Pages
// Functions see the change on the next request.
//
// A share link is `https://<site>/s/<token>`:
//   * valid   → sets a short-lived access cookie and redirects to the profile
//   * expired → redirects to the owner's ad URL (if one is configured)
//   * unknown → the neutral 404 page
//
// No secrets live in this module: the token itself is the credential, and it is
// 18 random bytes of base64url, so links cannot be guessed or enumerated.
// ---------------------------------------------------------------------------
import type { Env } from "../bot/types";

/** Cookie that carries a redeemed share token. */
export const ACCESS_COOKIE = "dg_access";
/** KV key holding `{ enabled, updatedAt }`. */
export const MODE_KEY = "site:private-mode";
/** KV key holding `{ url, updatedAt }` — where expired links send visitors. */
export const AD_KEY = "site:ad-url";
/** KV key holding the list of token strings (KV has no prefix scan here). */
export const ACCESS_INDEX_KEY = "access:index";

/** A share link can never live longer than 30 days. */
export const MAX_LINK_TTL_SECONDS = 30 * 24 * 60 * 60;
/** …or shorter than 5 minutes. */
export const MIN_LINK_TTL_SECONDS = 5 * 60;
/**
 * Expired records are kept for a week so the ad redirect still works after the
 * KV expiry (an aged link keeps paying instead of turning into a 404).
 */
export const EXPIRED_RETENTION_SECONDS = 7 * 24 * 60 * 60;

export interface PrivateModeState {
  enabled: boolean;
  updatedAt: number;
}

export interface AccessLink {
  token: string;
  slug: string;
  createdAt: number;
  expiresAt: number;
  /** Incremented on every successful redemption, for the /links report. */
  uses: number;
}

export interface RequestAccess {
  mode: PrivateModeState;
  token: string | null;
  /** Set only when the cookie holds a token that has not expired. */
  link: AccessLink | null;
  /** True when a cookie was presented but its link had expired. */
  expired: boolean;
}

const OFF: PrivateModeState = { enabled: false, updatedAt: 0 };

function kv(env: Env): KVNamespace | null {
  const binding = (env as unknown as { BOT_KV?: KVNamespace }).BOT_KV;
  return binding ?? null;
}

// ---------------------------------------------------------------------------
// Private mode flag
// ---------------------------------------------------------------------------
export async function readPrivateMode(env: Env): Promise<PrivateModeState> {
  const store = kv(env);
  if (!store) return OFF;
  try {
    const value = await store.get<PrivateModeState>(MODE_KEY, "json");
    if (!value || typeof value.enabled !== "boolean") return OFF;
    return { enabled: value.enabled, updatedAt: Number(value.updatedAt) || 0 };
  } catch {
    // Privacy first: if the flag cannot be read, behave as if private mode is
    // ON. The site answers neutral 404s for a moment during a KV hiccup, which
    // is far better than briefly publishing profiles the owner hid.
    return { enabled: true, updatedAt: 0 };
  }
}

export async function writePrivateMode(
  env: Env,
  enabled: boolean
): Promise<PrivateModeState> {
  const state: PrivateModeState = { enabled, updatedAt: Date.now() };
  const store = kv(env);
  if (store) await store.put(MODE_KEY, JSON.stringify(state));
  return state;
}

// ---------------------------------------------------------------------------
// Ad URL (expiry redirect)
// ---------------------------------------------------------------------------
export async function readAdUrl(env: Env): Promise<string | null> {
  const store = kv(env);
  if (!store) return null;
  try {
    const value = await store.get<{ url?: string }>(AD_KEY, "json");
    const url = typeof value?.url === "string" ? value.url.trim() : "";
    return /^https?:\/\/\S+$/i.test(url) ? url : null;
  } catch {
    return null;
  }
}

/** Pass null (or "off") to clear the ad URL. */
export async function writeAdUrl(
  env: Env,
  url: string | null
): Promise<string | null> {
  const store = kv(env);
  if (!url) {
    if (store) await store.delete(AD_KEY);
    return null;
  }
  const clean = url.trim();
  if (!/^https?:\/\/\S+$/i.test(clean)) {
    throw new Error("The ad link must start with http:// or https://");
  }
  if (store) {
    await store.put(AD_KEY, JSON.stringify({ url: clean, updatedAt: Date.now() }));
  }
  return clean;
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** 18 random bytes as base64url (24 chars) — unguessable, URL-safe. */
export function newToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function isToken(value: string): boolean {
  return TOKEN_RE.test(value);
}

function accessKey(token: string): string {
  return `access:${token}`;
}

/** Clamp a requested lifetime into the allowed range. */
export function clampTtl(seconds: number): number {
  if (!Number.isFinite(seconds)) return 24 * 60 * 60;
  return Math.max(
    MIN_LINK_TTL_SECONDS,
    Math.min(MAX_LINK_TTL_SECONDS, Math.round(seconds))
  );
}

async function readIndex(env: Env): Promise<string[]> {
  const store = kv(env);
  if (!store) return [];
  try {
    const value = await store.get<string[]>(ACCESS_INDEX_KEY, "json");
    return Array.isArray(value) ? value.filter((t) => typeof t === "string") : [];
  } catch {
    return [];
  }
}

async function writeIndex(env: Env, tokens: string[]): Promise<void> {
  const store = kv(env);
  if (!store) return;
  await store.put(ACCESS_INDEX_KEY, JSON.stringify(tokens.slice(-500)));
}

/** Create a share link for one profile slug. */
export async function createAccessLink(
  env: Env,
  slug: string,
  ttlSeconds: number
): Promise<AccessLink> {
  const store = kv(env);
  if (!store) throw new Error("BOT_KV is not configured on this deployment.");

  const ttl = clampTtl(ttlSeconds);
  const now = Date.now();
  const link: AccessLink = {
    token: newToken(),
    slug: slug.toLowerCase(),
    createdAt: now,
    expiresAt: now + ttl * 1000,
    uses: 0,
  };

  await store.put(accessKey(link.token), JSON.stringify(link), {
    // Keep the record a week past expiry so the ad redirect still resolves.
    expirationTtl: ttl + EXPIRED_RETENTION_SECONDS,
  });

  const index = await readIndex(env);
  index.push(link.token);
  await writeIndex(env, index);
  return link;
}

export async function readAccessLink(
  env: Env,
  token: string
): Promise<AccessLink | null> {
  if (!isToken(token)) return null;
  const store = kv(env);
  if (!store) return null;
  try {
    const value = await store.get<AccessLink>(accessKey(token), "json");
    if (!value || typeof value.expiresAt !== "number" || !value.slug) return null;
    return {
      token,
      slug: String(value.slug).toLowerCase(),
      createdAt: Number(value.createdAt) || 0,
      expiresAt: Number(value.expiresAt) || 0,
      uses: Number(value.uses) || 0,
    };
  } catch {
    return null;
  }
}

export async function touchAccessLink(env: Env, link: AccessLink): Promise<void> {
  const store = kv(env);
  if (!store) return;
  const next: AccessLink = { ...link, uses: link.uses + 1 };
  const remaining = Math.max(
    60,
    Math.ceil((link.expiresAt - Date.now()) / 1000) + EXPIRED_RETENTION_SECONDS
  );
  await store.put(accessKey(link.token), JSON.stringify(next), {
    expirationTtl: remaining,
  });
}

/** Active (unexpired) links, newest first. */
export async function listAccessLinks(env: Env): Promise<AccessLink[]> {
  const index = await readIndex(env);
  if (index.length === 0) return [];
  const now = Date.now();
  const links = await Promise.all(index.map((token) => readAccessLink(env, token)));
  const alive = links.filter(
    (link): link is AccessLink => !!link && link.expiresAt > now
  );
  // Prune dead tokens from the index while we are here.
  const aliveTokens = new Set(alive.map((link) => link.token));
  const kept = index.filter((token) => aliveTokens.has(token));
  if (kept.length !== index.length) await writeIndex(env, kept);
  return alive.sort((a, b) => b.createdAt - a.createdAt);
}

/** Delete one link by token, every link for a slug, or everything. */
export async function revokeAccessLinks(
  env: Env,
  selector: string
): Promise<number> {
  const store = kv(env);
  if (!store) return 0;
  const index = await readIndex(env);
  const all = await Promise.all(index.map((token) => readAccessLink(env, token)));
  const wanted = selector.trim().toLowerCase();

  let removed = 0;
  const kept: string[] = [];
  for (let i = 0; i < index.length; i += 1) {
    const link = all[i];
    const match =
      wanted === "all" ||
      (link && (link.token === selector.trim() || link.slug === wanted)) ||
      index[i] === selector.trim();
    if (match) {
      await store.delete(accessKey(index[i]));
      removed += 1;
    } else {
      kept.push(index[i]);
    }
  }
  await writeIndex(env, kept);
  return removed;
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    if (key !== name) continue;
    const raw = part.slice(index + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      // A malformed cookie must not 500 the whole request; treat it as absent.
      return raw;
    }
  }
  return null;
}

export function accessCookie(
  token: string,
  maxAgeSeconds: number,
  secure: boolean
): string {
  const parts = [
    `${ACCESS_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearAccessCookie(secure: boolean): string {
  return accessCookie("", 0, secure);
}

// ---------------------------------------------------------------------------
// Request resolution
// ---------------------------------------------------------------------------
/**
 * Read the mode and the visitor's access cookie in one go.
 * The cookie is only trusted while the link it names is unexpired.
 */
export async function resolveRequestAccess(
  env: Env,
  request: Request,
  knownMode?: PrivateModeState
): Promise<RequestAccess> {
  const mode = knownMode ?? (await readPrivateMode(env));
  const token = readCookie(request, ACCESS_COOKIE);
  if (!token) return { mode, token: null, link: null, expired: false };

  const link = await readAccessLink(env, token);
  if (!link) return { mode, token, link: null, expired: false };
  if (link.expiresAt <= Date.now()) {
    return { mode, token, link: null, expired: true };
  }
  return { mode, token, link, expired: false };
}

// ---------------------------------------------------------------------------
// Formatting / parsing (bot messages)
// ---------------------------------------------------------------------------
/**
 * Parse a lifetime typed in Telegram: `6h`, `12 hours`, `3d`, `90m`.
 * A bare number is hours, which is how people usually write it.
 */
export function parseDuration(input: string): number | null {
  const match = (input || "").trim().toLowerCase().match(/^(\d+)\s*([a-z]*)$/);
  if (!match) return null;
  const amount = parseInt(match[1], 10);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = match[2];
  if (!unit || unit.startsWith("h")) return amount * 3600;
  if (unit.startsWith("m")) return amount * 60;
  if (unit.startsWith("d")) return amount * 86400;
  if (unit.startsWith("w")) return amount * 7 * 86400;
  return null;
}

export function formatDuration(seconds: number): string {
  const value = Math.max(0, Math.round(seconds));
  if (value % 86400 === 0) {
    const days = value / 86400;
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  if (value % 3600 === 0) {
    const hours = value / 3600;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  const minutes = Math.round(value / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

export function formatRemaining(expiresAt: number, now = Date.now()): string {
  const ms = expiresAt - now;
  if (ms <= 0) return "expired";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${Math.max(1, minutes)}m left`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    const rest = minutes % 60;
    return rest > 0 ? `${hours}h ${rest}m left` : `${hours}h left`;
  }
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest > 0 ? `${days}d ${rest}h left` : `${days}d left`;
}

/** "22 Oct 2026, 18:04 UTC" — stable regardless of the viewer's clock. */
export function formatExpiry(expiresAt: number): string {
  const date = new Date(expiresAt);
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${pad(date.getUTCDate())} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}, ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`
  );
}

/** Share URL for a token. */
export function shareUrl(base: string, token: string): string {
  return `${base.replace(/\/+$/, "")}/s/${token}`;
}
