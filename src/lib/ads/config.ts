// ---------------------------------------------------------------------------
// Advert settings — the stored shape, the defaults and the sanitiser.
//
// This module is pure: no KV, no fetch, no DOM. The admin API, the admin panel
// and the browser injector all normalise through the same function, so a
// half-written or hand-edited KV record can never break the site.
//
// Three things live here because they are decided by the owner, not by code:
//   • click  — the link the chat's send button opens before a message is sent
//   • slots  — raw network snippets: pop-under, social bar, native banner
//   • limits — how often a pop-under may interrupt the same visitor
// ---------------------------------------------------------------------------

/** KV key holding the whole advert configuration. */
export const AD_SETTINGS_KEY = "site:adverts";

/** A single network snippet is capped so a paste cannot bloat the KV value. */
export const MAX_SNIPPET_CHARS = 20_000;

/**
 * Where the send button takes a visitor on the first click.
 *
 * This is the network the owner is paid by; it is also the fallback when KV is
 * unreachable, so the send-button advert keeps working during an outage.
 */
export const DEFAULT_CLICK_URL =
  "https://downconvenientmagnetic.com/gnzgnq4tuu?key=65f2307646f602430f34834500ac67c9";

/**
 * first — the first send click opens the advert and does NOT send the message;
 *         the next click sends (the long-standing behaviour of this site).
 * every — every send click opens the advert *and* sends the message.
 * off   — the send button only sends.
 */
export const CLICK_MODES = ["first", "every", "off"] as const;
export type ClickMode = (typeof CLICK_MODES)[number];

export const BANNER_POSITIONS = ["inline", "fixed-bottom", "fixed-top"] as const;
export type BannerPosition = (typeof BANNER_POSITIONS)[number];

/** Which part of the site a route belongs to, for placement rules. */
export type AdPlacement = "home" | "profiles" | "other";

export interface AdSlot {
  enabled: boolean;
  code: string;
}

export interface AdSettings {
  /** Master switch: false silences every slot, including the send button. */
  enabled: boolean;
  updatedAt: number;
  click: { url: string; mode: ClickMode };
  placements: { home: boolean; profiles: boolean };
  popunder: AdSlot;
  socialBar: AdSlot;
  native: AdSlot & { position: BannerPosition };
  limits: {
    /** How many pop-unders one visitor may get per browser session. */
    popunderPerSession: number;
    /** Minimum gap between two pop-unders for one visitor, in seconds. */
    popunderCooldownSeconds: number;
  };
}

export const POPUNDER_MAX_PER_SESSION = 10;
export const POPUNDER_MAX_COOLDOWN_SECONDS = 600;

export function defaultAdSettings(): AdSettings {
  return {
    enabled: true,
    updatedAt: 0,
    click: { url: DEFAULT_CLICK_URL, mode: "first" },
    placements: { home: true, profiles: true },
    popunder: { enabled: false, code: "" },
    socialBar: { enabled: false, code: "" },
    native: { enabled: false, code: "", position: "inline" },
    limits: { popunderPerSession: 3, popunderCooldownSeconds: 60 },
  };
}

// ---------------------------------------------------------------------------
// Small coercion helpers
// ---------------------------------------------------------------------------
type Bag = Record<string, unknown>;

function bag(value: unknown): Bag {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Bag)
    : {};
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function clampInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

/** Strip NULs (KV rejects them) and cap the length. */
export function cleanSnippet(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\u0000/g, "").slice(0, MAX_SNIPPET_CHARS);
}

/** True when the string is an absolute http(s) URL. */
export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!/^https?:\/\/\S+$/i.test(trimmed)) return false;
  try {
    new URL(trimmed);
    return true;
  } catch {
    return false;
  }
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T
): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function normaliseSlot(value: unknown, fallback: AdSlot): AdSlot {
  const source = bag(value);
  return {
    enabled: bool(source.enabled, fallback.enabled),
    code:
      source.code === undefined ? fallback.code : cleanSnippet(source.code),
  };
}

// ---------------------------------------------------------------------------
// The one sanitiser
// ---------------------------------------------------------------------------
/**
 * Merge `input` over `base` (defaults, or the record already in KV).
 *
 * Every field is optional, so a partial PATCH-style save works: unknown keys
 * are dropped, numbers are clamped, and an unusable URL falls back instead of
 * being written into an `href`.
 */
export function normaliseAdSettings(
  input: unknown,
  base: AdSettings = defaultAdSettings()
): AdSettings {
  const source = bag(input);

  const click = bag(source.click);
  const clickUrl =
    click.url === undefined
      ? base.click.url
      : typeof click.url === "string"
        ? click.url.trim().slice(0, 2000)
        : base.click.url;
  const clickMode = oneOf(click.mode, CLICK_MODES, base.click.mode);

  const placements = bag(source.placements);
  const native = bag(source.native);
  const limits = bag(source.limits);

  return {
    enabled: bool(source.enabled, base.enabled),
    updatedAt:
      typeof source.updatedAt === "number" && Number.isFinite(source.updatedAt)
        ? source.updatedAt
        : base.updatedAt,
    click: {
      // A blank string is a deliberate "no link"; junk falls back to `base`.
      url: clickUrl === "" || isHttpUrl(clickUrl) ? clickUrl : base.click.url,
      mode: clickMode,
    },
    placements: {
      home: bool(placements.home, base.placements.home),
      profiles: bool(placements.profiles, base.placements.profiles),
    },
    popunder: normaliseSlot(source.popunder, base.popunder),
    socialBar: normaliseSlot(source.socialBar, base.socialBar),
    native: {
      enabled: bool(native.enabled, base.native.enabled),
      code:
        native.code === undefined
          ? base.native.code
          : cleanSnippet(native.code),
      position: oneOf(native.position, BANNER_POSITIONS, base.native.position),
    },
    limits: {
      popunderPerSession: clampInt(
        limits.popunderPerSession,
        base.limits.popunderPerSession,
        0,
        POPUNDER_MAX_PER_SESSION
      ),
      popunderCooldownSeconds: clampInt(
        limits.popunderCooldownSeconds,
        base.limits.popunderCooldownSeconds,
        0,
        POPUNDER_MAX_COOLDOWN_SECONDS
      ),
    },
  };
}

// ---------------------------------------------------------------------------
// Inspection helpers (admin panel only — they never touch the DOM)
// ---------------------------------------------------------------------------
export interface SnippetReport {
  chars: number;
  /** `<script>` tags in the snippet. */
  scripts: number;
  /** …of which load a file; the rest run inline. */
  external: number;
  inline: number;
  /** `document.write` wipes the page when run after load — handled in an iframe. */
  usesDocumentWrite: boolean;
  /** Hosts the snippet will call, so the owner can spot a mismatched paste. */
  hosts: string[];
}

const HOST_RE = /https?:\/\/([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,})/gi;

export function snippetReport(code: string): SnippetReport {
  const empty: SnippetReport = {
    chars: 0,
    scripts: 0,
    external: 0,
    inline: 0,
    usesDocumentWrite: false,
    hosts: [],
  };
  if (!code || !code.trim()) return empty;

  const scripts = (code.match(/<script\b/gi) || []).length;
  const external = (code.match(/<script\b[^>]*\bsrc\s*=/gi) || []).length;
  const hosts = new Set<string>();
  for (const match of code.matchAll(HOST_RE)) {
    const host = match[1].toLowerCase().replace(/^www\./, "");
    if (host) hosts.add(host);
  }

  return {
    chars: code.length,
    scripts,
    external,
    inline: Math.max(0, scripts - external),
    usesDocumentWrite: /document\s*\.\s*write\s*\(/i.test(code),
    hosts: Array.from(hosts).slice(0, 4),
  };
}

// ---------------------------------------------------------------------------
// Send-button decision (kept pure so the behaviour is testable)
// ---------------------------------------------------------------------------
export interface SendClickPlan {
  /** Open the advertiser in a new tab. */
  open: boolean;
  /** Deliver the message on this same click. */
  send: boolean;
  /** Value the component stores for "the advert click already happened". */
  nextPending: boolean;
}

/**
 * Decide what one press of the send arrow does.
 *
 * `pending` means "the previous press opened the advert and did not send".
 *
 *   off / blank link / master off → send only
 *   first  → press 1: open, do not send.  press 2: send, reset.
 *   every  → open and send on every press.
 */
export function planSendClick(
  settings: AdSettings,
  pending: boolean
): SendClickPlan {
  const click = settings.enabled ? settings.click : null;
  if (!click || click.mode === "off" || !click.url) {
    return { open: false, send: true, nextPending: false };
  }
  if (click.mode === "every") {
    return { open: true, send: true, nextPending: false };
  }
  if (pending) {
    return { open: false, send: true, nextPending: false };
  }
  return { open: true, send: false, nextPending: true };
}

/** Which part of the site this path belongs to. */
export function placementFor(pathname: string): AdPlacement {
  if (/^\/(?:dreamgirl|persona|call)\//.test(pathname)) return "profiles";
  if (pathname === "/" || /^\/(?:dreamgirls|personas|explore)\/?$/i.test(pathname)) {
    return "home";
  }
  return "other";
}

/** Does the owner allow adverts on this part of the site? */
export function placementAllowed(
  settings: AdSettings,
  placement: AdPlacement
): boolean {
  if (!settings.enabled) return false;
  if (placement === "home") return settings.placements.home;
  if (placement === "profiles") return settings.placements.profiles;
  return false;
}

/** Human label for a placement, used by the admin summary. */
export function placementLabel(placement: AdPlacement): string {
  if (placement === "home") return "home page";
  if (placement === "profiles") return "profile + chat pages";
  return "other pages";
}
