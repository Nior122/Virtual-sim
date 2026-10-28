// ---------------------------------------------------------------------------
// Call regulator — storage side.
//
// Each visitor gets a random, HttpOnly cookie (`dg_client`) that names a KV
// record holding their connected calls inside the rolling window. The cookie
// is not a secret and carries no personal data; it exists so the limit follows
// the device instead of the tab, and so clearing localStorage (or opening a
// second tab) does not hand out a fresh allowance.
//
// What this module refuses to do:
//   • lie when KV is missing — the limit fails OPEN (calls keep working) rather
//     than locking every visitor out of the whole product;
//   • trust a malformed record — anything unreadable is treated as "no calls".
//
// Keep this Workers-compatible: `crypto.getRandomValues` and the Web Crypto
// API only, no node: imports (the Pages Functions import it directly).
// ---------------------------------------------------------------------------
import type { Env } from "../bot/types";
import { readCookie } from "../access/mode";
import {
  CALL_RULES,
  evaluateCalls,
  publicLimits,
  recordCall,
  type CallAllowance,
  type CallEntry,
  type CallRecord,
} from "./limits";

/** Cookie that identifies this browser to the call regulator. */
export const CLIENT_COOKIE = "dg_client";
/** One year — the id is stable for as long as the browser keeps it. */
const CLIENT_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;
/** Records only matter for the length of the window; keep a little slack. */
const RECORD_TTL_SECONDS = Math.ceil(CALL_RULES.windowMs / 1000) + 3600;

const CLIENT_ID_RE = /^[0-9a-f]{32}$/;

function kv(env: Env): KVNamespace | null {
  const binding = (env as unknown as { BOT_KV?: KVNamespace }).BOT_KV;
  return binding ?? null;
}

function recordKey(clientId: string): string {
  return `calls:${clientId}`;
}

/** 16 random bytes as hex — 32 chars, no personal information inside. */
export function newClientId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

export function readClientId(request: Request): string | null {
  const value = readCookie(request, CLIENT_COOKIE);
  if (!value) return null;
  const clean = value.trim().toLowerCase();
  return CLIENT_ID_RE.test(clean) ? clean : null;
}

export function clientCookie(clientId: string, secure: boolean): string {
  const parts = [
    `${CLIENT_COOKIE}=${clientId}`,
    "Path=/",
    `Max-Age=${CLIENT_COOKIE_MAX_AGE}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------
function normaliseRecord(value: unknown): CallRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { calls?: unknown; updatedAt?: unknown };
  if (!Array.isArray(raw.calls)) return null;
  const calls: CallEntry[] = [];
  for (const item of raw.calls) {
    if (!item || typeof item !== "object") continue;
    const entry = item as { slug?: unknown; at?: unknown };
    const slug = typeof entry.slug === "string" ? entry.slug.trim().toLowerCase() : "";
    const at = Number(entry.at);
    if (!slug || !Number.isFinite(at) || at <= 0) continue;
    calls.push({ slug: slug.slice(0, 80), at });
  }
  return { calls, updatedAt: Number(raw.updatedAt) || 0 };
}

export async function readCallRecord(
  env: Env,
  clientId: string
): Promise<CallRecord | null> {
  const store = kv(env);
  if (!store) return null;
  try {
    const value = await store.get<unknown>(recordKey(clientId), "json");
    return normaliseRecord(value);
  } catch {
    return null;
  }
}

export async function writeCallRecord(
  env: Env,
  clientId: string,
  record: CallRecord
): Promise<boolean> {
  const store = kv(env);
  if (!store) return false;
  try {
    await store.put(recordKey(clientId), JSON.stringify(record), {
      expirationTtl: RECORD_TTL_SECONDS,
    });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

/** What the API returns: the decision plus the numbers the UI needs. */
export interface CallAccessResponse extends CallAllowance {
  profile: string;
  /** Server time, so a wrong device clock cannot skew the countdown. */
  now: number;
  limits: ReturnType<typeof publicLimits>;
  /** False when KV is unbound and the limit is therefore not enforced. */
  enforced: boolean;
}

/** Read-only check — never consumes a call. */
export async function checkCallAccess(
  env: Env,
  clientId: string,
  slug: string,
  now: number = Date.now()
): Promise<CallAccessResponse> {
  const record = await readCallRecord(env, clientId);
  const allowance = evaluateCalls(record, slug, now);
  return {
    ...allowance,
    profile: slug,
    now,
    limits: publicLimits(),
    enforced: kv(env) !== null,
  };
}

/**
 * Consume one call for `slug` and return the state *after* it.
 *
 * Refuses (and records nothing) when the visitor is already blocked, so a
 * blocked call never eats a slot. Callers must check `allowance.allowed`
 * before treating the response as "the call may proceed".
 */
export async function registerCall(
  env: Env,
  clientId: string,
  slug: string,
  now: number = Date.now()
): Promise<CallAccessResponse> {
  const record = await readCallRecord(env, clientId);
  const before = evaluateCalls(record, slug, now);
  if (!before.allowed) {
    return {
      ...before,
      profile: slug,
      now,
      limits: publicLimits(),
      enforced: kv(env) !== null,
    };
  }

  const next = recordCall(record, slug, now);
  const stored = await writeCallRecord(env, clientId, next);
  // A failed write must not break the call that is already ringing — but it
  // also must not be counted as enforced, so the UI does not promise a limit
  // that is not being recorded.
  const after = stored ? evaluateCalls(next, slug, now) : before;
  return {
    // The call that just started is allowed by definition; the *reason* for a
    // block only describes the next attempt.
    allowed: true,
    reason: "none",
    retryAt: 0,
    used: after.used,
    remaining: after.remaining,
    windowResetAt: after.windowResetAt,
    profileLastAt: after.profileLastAt,
    profile: slug,
    now,
    limits: publicLimits(),
    enforced: stored,
  };
}
