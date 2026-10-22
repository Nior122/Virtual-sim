// ---------------------------------------------------------------------------
// Login for the web backend at /admin.
//
// One password, set in the Pages environment (`ADMIN_PASSWORD`). A correct
// password returns an HMAC-signed, HttpOnly cookie — there is no session table
// to leak and no user database to maintain. The signing key is derived from
// the password itself (plus `ADMIN_SESSION_SECRET` when set), so changing the
// password invalidates every existing session immediately.
//
// Short passwords are rejected as "not configured" on purpose: a backend that
// controls the whole site deserves more than a four-character password.
// ---------------------------------------------------------------------------
import type { Env } from "../bot/types";
import { readCookie } from "../access/mode";
import { fail } from "./http";

export const ADMIN_COOKIE = "dg_admin";

export const MIN_PASSWORD_LENGTH = 6;
const DEFAULT_SESSION_HOURS = 12;
const MAX_SESSION_HOURS = 24 * 7;
const MAX_FAILURES = 8;
const FAILURE_WINDOW_SECONDS = 15 * 60;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
export function adminPassword(env: Env): string {
  return String((env as unknown as { ADMIN_PASSWORD?: string }).ADMIN_PASSWORD || "").trim();
}

export function adminConfigured(env: Env): boolean {
  return adminPassword(env).length >= MIN_PASSWORD_LENGTH;
}

/** Session lifetime in hours, clamped to something sane. */
export function sessionHours(env: Env): number {
  const raw = Number(
    (env as unknown as { ADMIN_SESSION_HOURS?: string }).ADMIN_SESSION_HOURS
  );
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_SESSION_HOURS;
  return Math.min(MAX_SESSION_HOURS, Math.max(1, Math.round(raw)));
}

// ---------------------------------------------------------------------------
// Crypto
// ---------------------------------------------------------------------------
function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomToken(bytes = 12): string {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return toBase64Url(data);
}

async function hmacKey(env: Env): Promise<CryptoKey> {
  const extra = String(
    (env as unknown as { ADMIN_SESSION_SECRET?: string }).ADMIN_SESSION_SECRET || ""
  ).trim();
  const material = `dg-admin-session-v1:${adminPassword(env)}:${extra}`;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(material)
  );
  return crypto.subtle.importKey(
    "raw",
    digest,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

async function sign(env: Env, payload: string): Promise<string> {
  const key = await hmacKey(env);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload)
  );
  return toBase64Url(new Uint8Array(signature));
}

/** Length-independent comparison for two short strings. */
function timingSafeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  const size = Math.max(left.length, right.length);
  for (let i = 0; i < size; i += 1) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

/** Compare the typed password with the configured one in constant time. */
export async function verifyPassword(env: Env, typed: string): Promise<boolean> {
  if (!adminConfigured(env)) return false;
  const encode = (value: string) => new TextEncoder().encode(value);
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encode(typed)),
    crypto.subtle.digest("SHA-256", encode(adminPassword(env))),
  ]);
  return timingSafeEqual(toBase64Url(new Uint8Array(a)), toBase64Url(new Uint8Array(b)));
}

// ---------------------------------------------------------------------------
// Session cookie
// ---------------------------------------------------------------------------
export interface AdminSession {
  value: string;
  maxAge: number;
  expiresAt: number;
}

export async function createSession(
  env: Env,
  now = Date.now()
): Promise<AdminSession> {
  const maxAge = sessionHours(env) * 3600;
  const expiresAt = Math.floor(now / 1000) + maxAge;
  const payload = `v1.${expiresAt}.${randomToken(9)}`;
  const value = `${payload}.${await sign(env, payload)}`;
  return { value, maxAge, expiresAt: expiresAt * 1000 };
}

export async function verifySession(
  env: Env,
  cookieValue: string | null,
  now = Date.now()
): Promise<{ expiresAt: number } | null> {
  if (!cookieValue || !adminConfigured(env)) return null;
  const parts = cookieValue.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  const expiresAt = Number(parts[1]);
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 <= now) return null;
  const payload = parts.slice(0, 3).join(".");
  const expected = await sign(env, payload);
  if (!timingSafeEqual(expected, parts[3])) return null;
  return { expiresAt: expiresAt * 1000 };
}

export function adminCookie(
  value: string,
  maxAgeSeconds: number,
  secure: boolean
): string {
  const parts = [
    `${ADMIN_COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
    "HttpOnly",
    // The panel is same-site only; Strict also blocks it from link previews.
    "SameSite=Strict",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearAdminCookie(secure: boolean): string {
  return adminCookie("", 0, secure);
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------
export interface AdminIdentity {
  expiresAt: number;
}

export async function currentAdmin(
  request: Request,
  env: Env
): Promise<AdminIdentity | null> {
  const cookie = readCookie(request, ADMIN_COOKIE);
  return verifySession(env, cookie);
}

/**
 * Guard for every /api/admin route except login itself.
 * Returns the 401 response to send, or null when the caller may continue.
 */
export async function requireAdmin(
  request: Request,
  env: Env
): Promise<Response | null> {
  if (!adminConfigured(env)) {
    return fail(
      "The backend is disabled. Set ADMIN_PASSWORD (at least 6 characters) in the Pages environment variables.",
      503
    );
  }
  const identity = await currentAdmin(request, env);
  if (!identity) return fail("Unauthorized", 401);
  return null;
}

// ---------------------------------------------------------------------------
// Brute-force throttle
// ---------------------------------------------------------------------------
interface FailureRecord {
  count: number;
  firstAt: number;
}

function clientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

function kv(env: Env): KVNamespace | null {
  return ((env as unknown as { BOT_KV?: KVNamespace }).BOT_KV) || null;
}

function failureKey(request: Request): string {
  return `admin:login:${clientIp(request)}`;
}

export async function loginAllowed(
  request: Request,
  env: Env
): Promise<{ allowed: boolean; retryAfter: number }> {
  const store = kv(env);
  if (!store) return { allowed: true, retryAfter: 0 };
  try {
    const record = await store.get<FailureRecord>(failureKey(request), "json");
    if (!record || typeof record.count !== "number") {
      return { allowed: true, retryAfter: 0 };
    }
    if (record.count < MAX_FAILURES) return { allowed: true, retryAfter: 0 };
    const elapsed = Math.max(0, Date.now() - (record.firstAt || 0)) / 1000;
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil(FAILURE_WINDOW_SECONDS - elapsed)),
    };
  } catch {
    return { allowed: true, retryAfter: 0 };
  }
}

export async function noteLoginFailure(
  request: Request,
  env: Env
): Promise<void> {
  const store = kv(env);
  if (!store) return;
  try {
    const key = failureKey(request);
    const existing = await store.get<FailureRecord>(key, "json");
    const record: FailureRecord = existing
      ? { count: (existing.count || 0) + 1, firstAt: existing.firstAt || Date.now() }
      : { count: 1, firstAt: Date.now() };
    await store.put(key, JSON.stringify(record), {
      expirationTtl: FAILURE_WINDOW_SECONDS,
    });
  } catch {
    // Throttling is best-effort; never block a legitimate login on KV errors.
  }
}

export async function clearLoginFailures(
  request: Request,
  env: Env
): Promise<void> {
  const store = kv(env);
  if (!store) return;
  try {
    await store.delete(failureKey(request));
  } catch {
    // ignore
  }
}
