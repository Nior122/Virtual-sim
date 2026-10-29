/**
 * The manager's Telegram handle — the one place it is written down.
 *
 * Guests reach the "manager" through this link, and it shows up in four
 * different shapes: the chat's CTA card, the auto-linked `t.me/…` inside a
 * reply, the canned "talk to my manager" messages, and the instructions the
 * model itself follows. Copying the handle into each of those strings is how it
 * ended up in 80+ places, so changing it meant sweeping the whole codebase.
 * Every site now imports from here instead:
 *
 *   managerLinkText()    -> "t.me/KasiQueenbot"          (what a reply shows)
 *   managerLinkUrl()     -> "https://t.me/KasiQueenbot"  (what anchors link to)
 *   managerMention()     -> "@KasiQueenbot"              (button label)
 *   hasManagerLink(m)    -> does this reply already carry our link?
 *
 * To change the handle, edit `DEFAULT_MANAGER_HANDLE`. To change it without a
 * rebuild, set the `MANAGER_TELEGRAM` variable on the Pages project (accepts
 * `KasiQueenbot`, `@KasiQueenbot` or a full `https://t.me/…` URL): the chat
 * API and the bot call `configureManagerTelegram(env)` on entry.
 *
 * Canned replies keep a `{link}` token instead of the link itself, so they stay
 * one-line strings and are filled by `fillManagerLink()` when one is picked.
 * That is what lets the env override reach messages declared as module
 * constants.
 *
 * Workers-safe: pure functions, no `node:` imports, no I/O.
 */

/** The handle used when `MANAGER_TELEGRAM` is not set. Change it here. */
export const DEFAULT_MANAGER_HANDLE = "KasiQueenbot";

/** Placeholder inside canned replies; replaced by `fillManagerLink()`. */
export const MANAGER_LINK_TOKEN = "{link}";

/**
 * What the chat shows instead of the link.
 *
 * Guests never see the bot's handle: the anchor reads `@manager` and points at
 * the internal `/manager` redirect, so neither the visible text nor the URL in
 * the status bar / long-press / "copy link" reveals it.
 */
export const MANAGER_MASK_LABEL = "@manager";

/** Internal path that redirects to the manager's Telegram chat. */
export const MANAGER_REDIRECT_PATH = "/manager";

/** Anything that can carry the deployment variable (Pages env, process.env). */
export type ManagerEnvLike = { MANAGER_TELEGRAM?: string | null } | null | undefined;

/** Set by `configureManagerTelegram()`; null means "use the default". */
let overrideHandle: string | null = null;

/**
 * Accepts `KasiQueenbot`, `@KasiQueenbot`, `t.me/KasiQueenbot` or a full URL,
 * and returns a bare handle Telegram would accept. Anything invalid returns
 * null so a typo in the env falls back to the default instead of producing
 * broken links.
 */
export function normalizeManagerHandle(raw?: string | null): string | null {
  if (!raw) return null;
  const cleaned = String(raw)
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^(?:www\.)?(?:t|telegram)\.me\//i, "")
    .replace(/^@/, "")
    .replace(/[/?#].*$/, "");
  return /^[A-Za-z0-9_]{4,64}$/.test(cleaned) ? cleaned : null;
}

/**
 * Applies a handle at runtime (used by the browser when the chat API reports
 * the deployment's handle). Returns the handle now in effect.
 */
export function setManagerTelegram(raw?: string | null): string {
  overrideHandle = normalizeManagerHandle(raw);
  return managerHandle();
}

/** Reads `MANAGER_TELEGRAM` from a deployment env; call once per request. */
export function configureManagerTelegram(env?: ManagerEnvLike): string {
  const normalized = normalizeManagerHandle(env?.MANAGER_TELEGRAM);
  if (normalized) overrideHandle = normalized;
  return managerHandle();
}

/** Only for tests: forget any override and go back to the default. */
export function resetManagerTelegram(): void {
  overrideHandle = null;
}

/** The handle currently in use, without `@`. */
export function managerHandle(): string {
  return overrideHandle || DEFAULT_MANAGER_HANDLE;
}

/** `t.me/KasiQueenbot` — how the link appears inside a message. */
export function managerLinkText(): string {
  return `t.me/${managerHandle()}`;
}

/** `https://t.me/KasiQueenbot` — where an anchor points. */
export function managerLinkUrl(): string {
  return `https://t.me/${managerHandle()}`;
}

/** `@KasiQueenbot` — the button label. */
export function managerMention(): string {
  return `@${managerHandle()}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Every shape the handle leaks in: a `t.me/…` link (any handle, so old messages
 * still mask) or the current `@handle` mention, which the model sometimes writes
 * instead of the URL.
 */
function linkSplitSource(): string {
  return `(?:(?:https?:\\/\\/)?t\\.me\\/[A-Za-z0-9_]{4,64}|@${escapeRegExp(managerHandle())}(?![A-Za-z0-9_]))`;
}

/**
 * True when the text already links to the manager. Used as a guard before
 * appending the link to an AI reply, so a reply is never given the link twice.
 * Matches the handle currently in use only — a reply pointing at some other
 * handle does not count.
 */
export function hasManagerLink(text?: string | null): boolean {
  if (!text) return false;
  // Handles are [A-Za-z0-9_] only, so no escaping is needed here.
  return new RegExp(`t\\.me/${managerHandle()}(?![A-Za-z0-9_])`, "i").test(text);
}

export interface ManagerLink {
  /** The matched text exactly as it appears in the message. */
  text: string;
  handle: string;
  url: string;
}

const LINK_SOURCE = "(?:https?:\\/\\/)?t\\.me\\/([A-Za-z0-9_]{4,64})";
/*
 * The split pattern has no capture group of its own: `String.split` keeps every
 * capture group in its output, so an inner one would repeat the handle as its
 * own segment and the chat would render the link twice. That is why the pattern
 * is built by `linkSplitSource()` and wrapped in a single group by the caller.
 */

/**
 * First `t.me/…` link in the text, whatever the handle. The chat renders the
 * link the reply actually contains, so an old message still links somewhere
 * useful after the handle changes.
 */
export function findManagerLink(text?: string | null): ManagerLink | null {
  if (!text) return null;
  const match = new RegExp(LINK_SOURCE, "i").exec(text);
  if (match) {
    return { text: match[0], handle: match[1], url: `https://t.me/${match[1]}` };
  }
  // The model sometimes writes "@Handle" instead of the link.
  const mention = new RegExp(`@${escapeRegExp(managerHandle())}(?![A-Za-z0-9_])`, "i").exec(text);
  if (mention) {
    return { text: mention[0], handle: managerHandle(), url: `https://t.me/${managerHandle()}` };
  }
  return null;
}

export interface ManagerLinkSegment {
  /** The original text (the link is still here, guards need it). */
  text: string;
  /** Set when this segment is a link; null for ordinary text. */
  link: ManagerLink | null;
  /** What the chat renders: the masked label for a link, the text otherwise. */
  display: string;
}

/**
 * Splits a message into plain and link segments so the chat can render the
 * `t.me/…` part as an anchor without re-parsing it in JSX.
 */
export function splitManagerLinks(text: string): ManagerLinkSegment[] {
  if (!text) return [];
  const source = linkSplitSource();
  const parts = text.split(new RegExp(`(${source})`, "gi"));
  return parts
    .filter((part) => part !== "")
    .map((part) => {
      const link = new RegExp(`^${source}$`, "i").test(part) ? findManagerLink(part) : null;
      return { text: part, link, display: link ? MANAGER_MASK_LABEL : part };
    });
}

/**
 * The message as a guest reads it: every manager link (URL or `@handle`)
 * replaced by the masked label. Pure, so it can be checked without a browser.
 */
export function maskManagerLinks(text: string): string {
  return splitManagerLinks(text)
    .map((segment) => segment.display)
    .join("");
}

/**
 * Fills the `{link}` token in a canned reply with the current link. Applying it
 * twice is harmless, which is why the getters can call it on every path.
 */
export function fillManagerLink(text: string): string {
  if (!text || text.indexOf(MANAGER_LINK_TOKEN) === -1) return text;
  return text.split(MANAGER_LINK_TOKEN).join(managerLinkText());
}
