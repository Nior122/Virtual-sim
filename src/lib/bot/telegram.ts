import type { Env, TelegramMessage } from "./types";

const API_BASE = "https://api.telegram.org";

/** Call any Telegram Bot API method (JSON body). */
export async function callTelegram<T = any>(
  env: Env,
  method: string,
  payload: Record<string, unknown>
): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as any;
    if (!data.ok) {
      // Log the full payload: "message is too long" / "chat not found" are
      // the usual causes and were previously invisible.
      console.error(
        `Telegram ${method} failed: ${data.description} | payload ${JSON.stringify(
          payload
        ).slice(0, 400)}`
      );
      return null;
    }
    return data.result as T;
  } catch (err) {
    console.error(`Telegram ${method} exception:`, err);
    return null;
  }
}

/**
 * Telegram rejects anything over 4096 characters with "message is too long"
 * and the message is silently lost, so long replies are split on paragraph /
 * line boundaries before sending. Splitting lives here so every reply in the
 * bot is safe, wherever it was built.
 */
export const TELEGRAM_TEXT_LIMIT = 3800;

export function splitForTelegram(
  text: string,
  limit = TELEGRAM_TEXT_LIMIT
): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > 0) {
    if (rest.length <= limit) {
      chunks.push(rest);
      break;
    }
    // Prefer a paragraph break, then a line break, then a hard cut.
    let cut = rest.lastIndexOf("\n\n", limit);
    if (cut <= 0) cut = rest.lastIndexOf("\n", limit);
    if (cut <= 0) cut = limit;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, "");
  }
  return chunks;
}

/** Sends a message, splitting it if needed. True when every chunk arrived. */
export async function sendMessage(
  env: Env,
  chatId: number,
  text: string
): Promise<boolean> {
  let ok = true;
  for (const chunk of splitForTelegram(text)) {
    const result = await callTelegram(env, "sendMessage", {
      chat_id: chatId,
      text: chunk,
      disable_web_page_preview: true,
    });
    if (!result) ok = false;
  }
  return ok;
}

/** Alias kept for readability at call sites that build very long replies. */
export const sendLongMessage = sendMessage;

// ---------------------------------------------------------------------------
// Inline keyboards (the private-mode toggle and link durations)
// ---------------------------------------------------------------------------
export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export type InlineKeyboard = InlineKeyboardButton[][];

/**
 * Message with inline buttons. Long text is still split, but the keyboard is
 * only attached to the last chunk so a tap always maps to one message.
 */
export async function sendMessageWithKeyboard(
  env: Env,
  chatId: number,
  text: string,
  keyboard: InlineKeyboard
): Promise<boolean> {
  const chunks = splitForTelegram(text);
  let ok = true;
  for (let i = 0; i < chunks.length; i += 1) {
    const isLast = i === chunks.length - 1;
    const result = await callTelegram(env, "sendMessage", {
      chat_id: chatId,
      text: chunks[i],
      disable_web_page_preview: true,
      ...(isLast ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    });
    if (!result) ok = false;
  }
  return ok;
}

/** Replace the text (and keyboard) of a message the bot sent earlier. */
export async function editMessageText(
  env: Env,
  chatId: number,
  messageId: number,
  text: string,
  keyboard?: InlineKeyboard
): Promise<boolean> {
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
    text,
    disable_web_page_preview: true,
  };
  if (keyboard) payload.reply_markup = { inline_keyboard: keyboard };
  const result = await callTelegram(env, "editMessageText", payload);
  return !!result;
}

/** Acknowledge a button tap so Telegram stops showing the spinner. */
export async function answerCallbackQuery(
  env: Env,
  callbackQueryId: string,
  text?: string
): Promise<void> {
  await callTelegram(env, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text, show_alert: false } : {}),
  });
}

export interface TelegramFileInfo {
  file_id: string;
  file_path?: string;
}

/** Resolve a file_id to its server-side file_path via getFile. */
export async function getFilePath(
  env: Env,
  fileId: string
): Promise<string | null> {
  const result = await callTelegram<TelegramFileInfo>(env, "getFile", {
    file_id: fileId,
  });
  return result?.file_path ?? null;
}

/** Build the authenticated download URL for a resolved file_path. */
export function buildFileDownloadUrl(env: Env, filePath: string): string {
  return `${API_BASE}/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`;
}

/**
 * Extract usable text from a message (commands excluded by the caller).
 * Captions on media are treated the same as ordinary write-up text.
 */
export function extractText(msg: TelegramMessage): string {
  return (msg.text || msg.caption || "").trim();
}
