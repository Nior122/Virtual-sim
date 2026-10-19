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
      console.error(`Telegram ${method} failed:`, data.description);
      return null;
    }
    return data.result as T;
  } catch (err) {
    console.error(`Telegram ${method} exception:`, err);
    return null;
  }
}

export function sendMessage(
  env: Env,
  chatId: number,
  text: string
): Promise<unknown> {
  return callTelegram(env, "sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
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
