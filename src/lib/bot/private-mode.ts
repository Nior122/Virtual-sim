// ---------------------------------------------------------------------------
// Private mode commands for the Telegram bot.
//
// Everything here is owner-only: these controls decide who can see the site,
// so they must not be reachable by anyone who happens to find the bot. The
// owner chat id comes from OWNER_CHAT_ID; without it the commands stay locked.
//
// Commands
//   /private               status + ON/OFF buttons
//   /private on|off        same, without the buttons
//   /link <slug> [6h|2d]   create a temporary share link
//   /sharelinks            list active links
//   /revoke <token|slug|all>
//   /adlink [url|off]      where expired links redirect
//   /id                    your chat id (for setting OWNER_CHAT_ID)
// ---------------------------------------------------------------------------
import type { Env, TelegramCallbackQuery } from "./types";
import {
  answerCallbackQuery,
  editMessageText,
  sendMessage,
  sendMessageWithKeyboard,
  type InlineKeyboard,
} from "./telegram";
import { publicBaseUrl } from "./public-url";
import { getPublicPersonaBySlug } from "../db/neon";
import {
  MAX_LINK_TTL_SECONDS,
  createAccessLink,
  formatDuration,
  formatExpiry,
  formatRemaining,
  listAccessLinks,
  parseDuration,
  readAdUrl,
  readPrivateMode,
  revokeAccessLinks,
  shareUrl,
  writeAdUrl,
  writePrivateMode,
  type AccessLink,
  type PrivateModeState,
} from "../access/mode";

/** Lifetimes offered as buttons when no duration is typed. */
const DURATION_CHOICES: Array<{ label: string; seconds: number }> = [
  { label: "2 hours", seconds: 2 * 60 * 60 },
  { label: "6 hours", seconds: 6 * 60 * 60 },
  { label: "12 hours", seconds: 12 * 60 * 60 },
  { label: "24 hours", seconds: 24 * 60 * 60 },
  { label: "3 days", seconds: 3 * 24 * 60 * 60 },
  { label: "7 days", seconds: 7 * 24 * 60 * 60 },
];

const SLUG_RE = /^[a-z0-9][a-z0-9_.-]{0,63}$/i;

function ownerId(env: Env): string {
  return (env.OWNER_CHAT_ID || "").trim();
}

export function isOwner(env: Env, chatId: number): boolean {
  const owner = ownerId(env);
  return owner.length > 0 && String(chatId) === owner;
}

/** Message explaining why the command is refused, or null when allowed. */
function ownerRequired(env: Env, chatId: number): string | null {
  if (isOwner(env, chatId)) return null;
  if (!ownerId(env)) {
    return (
      "🔒 Site controls are locked because OWNER_CHAT_ID is not set.\n\n" +
      "Add OWNER_CHAT_ID to Pages → Settings → Environment variables with your " +
      `Telegram chat id, then try again. Your chat id is ${chatId} (also shown by /id).`
    );
  }
  return "Only the site owner can use that command.";
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function modeKeyboard(mode: PrivateModeState): InlineKeyboard {
  return [
    [
      {
        text: mode.enabled ? "🔒 Private mode: ON" : "Turn ON private mode",
        callback_data: "priv:on",
      },
      {
        text: mode.enabled ? "Turn OFF private mode" : "🌐 Private mode: OFF",
        callback_data: "priv:off",
      },
    ],
  ];
}

function linkList(links: AccessLink[], base: string, limit = 5): string {
  if (links.length === 0) return "No active share links.";
  const shown = links.slice(0, limit);
  const lines = shown.map((link, index) => {
    const uses = link.uses === 1 ? "1 open" : `${link.uses} opens`;
    return (
      `${index + 1}. ${link.slug} — ${formatRemaining(link.expiresAt)} · ${uses}\n` +
      `   ${shareUrl(base, link.token)}\n` +
      `   expires ${formatExpiry(link.expiresAt)}`
    );
  });
  if (links.length > shown.length) {
    lines.push(`…and ${links.length - shown.length} more (/sharelinks).`);
  }
  return lines.join("\n");
}

function statusText(
  mode: PrivateModeState,
  links: AccessLink[],
  adUrl: string | null,
  base: string
): string {
  return [
    mode.enabled ? "🔒 Private mode is ON" : "🌐 Private mode is OFF",
    "",
    mode.enabled
      ? "Only a visitor with an active share link can open that profile " +
        "(photos, videos and chat all work). The home page, the browse grid and " +
        "every other profile answer 404, and /sitemap.xml is not served."
      : "The site is public: home page, browse grid and every profile are visible.",
    "",
    `Active share links: ${links.length}`,
    linkList(links, base),
    "",
    adUrl
      ? `Expired links redirect to: ${adUrl}`
      : "Expired links show a neutral page (set an ad link with /adlink <url>).",
  ].join("\n");
}

function usageText(): string {
  return [
    "Private mode makes the site link-only.",
    "",
    "/private — status, with ON/OFF buttons",
    "/link <slug> [duration] — temporary link, e.g. /link ava 6h or /link ava 3d",
    "/sharelinks — active links with time left",
    "/revoke <token|slug|all> — kill links early",
    "/adlink <url> — where expired links redirect (/adlink off to clear)",
    "",
    "While ON, a visitor can only open the profile in their link; everything",
    "else on the site answers 404. Turning it OFF makes every profile public again.",
  ].join("\n");
}

function shareText(
  base: string,
  link: AccessLink,
  name: string,
  mode: PrivateModeState
): string {
  return [
    `Temporary link for ${name} (/${link.slug})`,
    "",
    shareUrl(base, link.token),
    "",
    `Valid for ${formatDuration((link.expiresAt - link.createdAt) / 1000)} — expires ${formatExpiry(
      link.expiresAt
    )} (${formatRemaining(link.expiresAt)}).`,
    "",
    "Whoever opens it sees that profile only: photos, videos and chat. " +
      "Nothing else on the site is reachable from it.",
    "",
    mode.enabled
      ? "Private mode is ON, so the rest of the site is hidden right now."
      : "⚠ Private mode is OFF right now, so the whole site is still public. " +
        "Send /private and tap ON to hide everything else.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// /private
// ---------------------------------------------------------------------------
async function applyMode(
  env: Env,
  origin: string,
  chatId: number,
  enabled: boolean,
  messageId?: number
): Promise<void> {
  const mode = await writePrivateMode(env, enabled);
  const links = await listAccessLinks(env);
  const adUrl = await readAdUrl(env);
  const text = statusText(mode, links, adUrl, publicBaseUrl(env, origin));

  if (messageId) {
    const edited = await editMessageText(env, chatId, messageId, text, modeKeyboard(mode));
    if (edited) return;
  }
  await sendMessageWithKeyboard(env, chatId, text, modeKeyboard(mode));
}

export async function privateCommand(
  env: Env,
  origin: string,
  chatId: number,
  arg: string
): Promise<void> {
  const blocked = ownerRequired(env, chatId);
  if (blocked) {
    await sendMessage(env, chatId, blocked);
    return;
  }

  const choice = arg.trim().toLowerCase();
  if (choice === "on" || choice === "off") {
    await applyMode(env, origin, chatId, choice === "on");
    return;
  }
  if (choice === "help") {
    await sendMessage(env, chatId, usageText());
    return;
  }

  const mode = await readPrivateMode(env);
  const links = await listAccessLinks(env);
  const adUrl = await readAdUrl(env);
  await sendMessageWithKeyboard(
    env,
    chatId,
    statusText(mode, links, adUrl, publicBaseUrl(env, origin)),
    modeKeyboard(mode)
  );
}

// ---------------------------------------------------------------------------
// /link
// ---------------------------------------------------------------------------
async function issueLink(
  env: Env,
  origin: string,
  chatId: number,
  slug: string,
  seconds: number
): Promise<void> {
  // Check the slug first: a link to a typo is worse than no link, because the
  // customer gets a 404 after the owner thinks the share worked.
  let name = slug;
  let missing = false;
  try {
    const row = await getPublicPersonaBySlug(env, slug);
    if (row && typeof row.name === "string") name = row.name;
    missing = !row;
  } catch {
    // DB unreachable — do not block the share, the link still works later.
  }

  if (missing) {
    await sendMessage(
      env,
      chatId,
      `No active profile has the slug "${slug}", so nothing was created.\n` +
        "Use /profiles to see the exact slugs."
    );
    return;
  }

  const link = await createAccessLink(env, slug, seconds);
  const mode = await readPrivateMode(env);
  const base = publicBaseUrl(env, origin);
  await sendMessage(env, chatId, shareText(base, link, name, mode));
}

export async function linkCommand(
  env: Env,
  origin: string,
  chatId: number,
  arg: string
): Promise<void> {
  const blocked = ownerRequired(env, chatId);
  if (blocked) {
    await sendMessage(env, chatId, blocked);
    return;
  }

  const parts = arg.trim().split(/\s+/).filter(Boolean);
  const slug = (parts[0] || "").replace(/^@+/, "").toLowerCase();
  if (!slug) {
    await sendMessage(
      env,
      chatId,
      "Usage: /link <slug> [duration]\n" +
        "e.g. /link ava 6h · /link ava 3d · /link ava (then pick a duration)"
    );
    return;
  }
  if (!SLUG_RE.test(slug)) {
    await sendMessage(env, chatId, `"${slug}" is not a valid slug. Use /profiles to see the exact slugs.`);
    return;
  }

  const durationArg = parts[1];
  if (!durationArg) {
    const keyboard: InlineKeyboard = [];
    for (let i = 0; i < DURATION_CHOICES.length; i += 3) {
      keyboard.push(
        DURATION_CHOICES.slice(i, i + 3).map((choice) => ({
          text: choice.label,
          callback_data: `link:${slug}:${choice.seconds}`,
        }))
      );
    }
    await sendMessageWithKeyboard(
      env,
      chatId,
      `How long should the link for /${slug} last?\n` +
        `(Longest allowed: ${formatDuration(MAX_LINK_TTL_SECONDS)}.)`,
      keyboard
    );
    return;
  }

  const seconds = parseDuration(durationArg);
  if (!seconds) {
    await sendMessage(
      env,
      chatId,
      `"${durationArg}" is not a duration. Use hours or days: 6h, 12h, 24h, 3d, 7d.`
    );
    return;
  }
  await issueLink(env, origin, chatId, slug, seconds);
}

// ---------------------------------------------------------------------------
// /sharelinks
// ---------------------------------------------------------------------------
export async function shareLinksCommand(
  env: Env,
  origin: string,
  chatId: number
): Promise<void> {
  const blocked = ownerRequired(env, chatId);
  if (blocked) {
    await sendMessage(env, chatId, blocked);
    return;
  }

  const links = await listAccessLinks(env);
  const mode = await readPrivateMode(env);
  const base = publicBaseUrl(env, origin);
  if (links.length === 0) {
    await sendMessage(
      env,
      chatId,
      "No active share links.\nCreate one with /link <slug> — e.g. /link ava 6h."
    );
    return;
  }

  const header = `Active share links (${links.length}) — private mode is ${
    mode.enabled ? "ON 🔒" : "OFF 🌐"
  }\n`;
  const body = links
    .map((link, index) => {
      const uses = link.uses === 1 ? "1 open" : `${link.uses} opens`;
      return (
        `${index + 1}. ${link.slug} — ${formatRemaining(link.expiresAt)} · ${uses}\n` +
        `   ${shareUrl(base, link.token)}\n` +
        `   token ${link.token}`
      );
    })
    .join("\n");
  await sendMessage(
    env,
    chatId,
    `${header}\n${body}\n\nKill one with /revoke <token|slug>, or /revoke all.`
  );
}

// ---------------------------------------------------------------------------
// /revoke
// ---------------------------------------------------------------------------
export async function revokeCommand(
  env: Env,
  chatId: number,
  arg: string
): Promise<void> {
  const blocked = ownerRequired(env, chatId);
  if (blocked) {
    await sendMessage(env, chatId, blocked);
    return;
  }

  const selector = arg.trim();
  if (!selector) {
    await sendMessage(
      env,
      chatId,
      "Usage: /revoke <token|slug|all>\nSee /sharelinks for the tokens."
    );
    return;
  }
  if (selector !== "all" && !SLUG_RE.test(selector) && selector.length < 16) {
    await sendMessage(env, chatId, `"${selector}" does not look like a slug or token.`);
    return;
  }

  const removed = await revokeAccessLinks(env, selector);
  await sendMessage(
    env,
    chatId,
    removed === 0
      ? `No active link matched "${selector}".`
      : `Revoked ${removed} link${removed === 1 ? "" : "s"}. ` +
          (selector === "all" ? "Nobody has a link now." : "That URL no longer opens anything.")
  );
}

// ---------------------------------------------------------------------------
// /adlink
// ---------------------------------------------------------------------------
export async function adLinkCommand(
  env: Env,
  chatId: number,
  arg: string
): Promise<void> {
  const blocked = ownerRequired(env, chatId);
  if (blocked) {
    await sendMessage(env, chatId, blocked);
    return;
  }

  const value = arg.trim();
  if (!value) {
    const adUrl = await readAdUrl(env);
    await sendMessage(
      env,
      chatId,
      adUrl
        ? `Expired share links redirect to:\n${adUrl}\n\nChange it with /adlink <url>, or /adlink off.`
        : "No ad link set. Expired share links show a neutral page.\n" +
            "Set one with /adlink https://example.com/offer"
    );
    return;
  }
  if (/^(off|none|clear)$/i.test(value)) {
    await writeAdUrl(env, null);
    await sendMessage(env, chatId, "Ad link cleared. Expired links now show a neutral page.");
    return;
  }
  try {
    const saved = await writeAdUrl(env, value);
    await sendMessage(
      env,
      chatId,
      `Expired share links will now redirect to:\n${saved}\n\n` +
        "Known links keep working until they expire; this only affects expired ones."
    );
  } catch (err) {
    await sendMessage(env, chatId, (err as Error).message);
  }
}

// ---------------------------------------------------------------------------
// /id
// ---------------------------------------------------------------------------
export async function idCommand(env: Env, chatId: number): Promise<void> {
  await sendMessage(
    env,
    chatId,
    `Chat id: ${chatId}\n` +
      (isOwner(env, chatId)
        ? "This chat IS the owner chat — private mode controls are unlocked."
        : ownerId(env)
          ? "This chat is not the owner chat, so site controls are locked."
          : `Set OWNER_CHAT_ID=${chatId} in the Pages environment variables to unlock the site controls.`)
  );
}

// ---------------------------------------------------------------------------
// Inline button taps
// ---------------------------------------------------------------------------
export async function handlePrivateCallback(
  env: Env,
  origin: string,
  callback: TelegramCallbackQuery
): Promise<void> {
  const data = callback.data || "";
  const chatId = callback.message?.chat?.id;
  const messageId = callback.message?.message_id;

  const blocked = chatId ? ownerRequired(env, chatId) : "Only the site owner can use that button.";
  if (blocked) {
    await answerCallbackQuery(env, callback.id, blocked);
    if (chatId) await sendMessage(env, chatId, blocked);
    return;
  }

  if (data === "priv:on" || data === "priv:off") {
    const enabled = data === "priv:on";
    await answerCallbackQuery(env, callback.id, enabled ? "Private mode ON" : "Site is public");
    await applyMode(env, origin, chatId!, enabled, messageId);
    return;
  }

  const linkTap = data.match(/^link:([a-z0-9][a-z0-9_.-]{0,63}):(\d{2,9})$/i);
  if (linkTap) {
    const slug = linkTap[1].toLowerCase();
    const seconds = parseInt(linkTap[2], 10);
    await answerCallbackQuery(env, callback.id, `Creating ${formatDuration(seconds)} link…`);
    await issueLink(env, origin, chatId!, slug, seconds);
    return;
  }

  await answerCallbackQuery(env, callback.id, "Unknown action");
}
