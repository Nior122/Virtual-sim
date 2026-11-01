// ---------------------------------------------------------------------------
// Advert settings — KV read/write with owner-facing validation.
//
// Reads never throw: an empty namespace, a missing key or a corrupt record all
// return the defaults, because the public site must render no matter what.
//
// Writes do throw, with a message written for the person in the admin panel
// ("The click-through URL must start with http:// or https://").
// ---------------------------------------------------------------------------
import type { Env } from "../bot/types";
import {
  AD_SETTINGS_KEY,
  CLICK_MODES,
  MAX_SNIPPET_CHARS,
  defaultAdSettings,
  normaliseAdSettings,
  isHttpUrl,
  type AdSettings,
} from "./config";

/** An error the admin API turns into a 400 with its message shown verbatim. */
export class AdSettingsError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = "AdSettingsError";
  }
}

function kv(env: Env): KVNamespace | null {
  const binding = (env as unknown as { BOT_KV?: KVNamespace }).BOT_KV;
  return binding ?? null;
}

export async function readAdSettings(env: Env): Promise<AdSettings> {
  const store = kv(env);
  if (!store) return defaultAdSettings();
  try {
    const raw = await store.get<unknown>(AD_SETTINGS_KEY, "json");
    if (!raw) return defaultAdSettings();
    return normaliseAdSettings(raw);
  } catch {
    return defaultAdSettings();
  }
}

type Bag = Record<string, unknown>;

function bag(value: unknown): Bag {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Bag)
    : {};
}

/** Reject snippets that are obviously the wrong paste, before they ship. */
function assertSnippet(label: string, value: unknown): void {
  if (value === undefined) return;
  if (typeof value !== "string") {
    throw new AdSettingsError(`${label} must be pasted as text.`);
  }
  if (value.length > MAX_SNIPPET_CHARS) {
    throw new AdSettingsError(
      `${label} is too long (${value.length.toLocaleString()} characters). ` +
        `Paste one network snippet, up to ${MAX_SNIPPET_CHARS.toLocaleString()}.`
    );
  }
  if (value.trim() && !/<(script|ins|iframe|div|a)\b/i.test(value)) {
    throw new AdSettingsError(
      `${label} does not look like advert code. Paste the whole snippet, ` +
        `including its <script> tag.`
    );
  }
}

/**
 * Merge a patch over what is already stored and save it.
 *
 * Validation runs before anything is written, so a rejected save leaves the
 * live configuration exactly as it was.
 */
export async function writeAdSettings(
  env: Env,
  patch: unknown
): Promise<AdSettings> {
  const store = kv(env);
  if (!store) {
    throw new AdSettingsError(
      "BOT_KV is not bound to this deployment, so advert settings cannot be saved. " +
        "Add the KV binding named BOT_KV, then redeploy."
    );
  }

  const body = bag(patch);
  const current = await readAdSettings(env);

  // --- validation ---------------------------------------------------------
  if (body.click !== undefined) {
    const click = bag(body.click);
    if (click.url !== undefined && click.url !== null) {
      const url = String(click.url).trim();
      if (url && !isHttpUrl(url)) {
        throw new AdSettingsError(
          "The click-through URL must start with http:// or https://"
        );
      }
    }
    if (
      click.mode !== undefined &&
      !(CLICK_MODES as readonly string[]).includes(String(click.mode))
    ) {
      throw new AdSettingsError(
        `Click mode must be one of ${CLICK_MODES.join(", ")}.`
      );
    }
  }
  if (body.popunder !== undefined) {
    assertSnippet("The pop-under code", bag(body.popunder).code);
  }
  if (body.socialBar !== undefined) {
    assertSnippet("The social bar code", bag(body.socialBar).code);
  }
  if (body.native !== undefined) {
    assertSnippet("The native banner code", bag(body.native).code);
  }

  // --- merge + save -------------------------------------------------------
  const next = normaliseAdSettings(body, current);
  next.updatedAt = Date.now();

  // One file per network, one master off-switch: refuse to store the same
  // snippet in two slots, because double-firing the same campaign is what gets
  // accounts suspended.
  const filled = [
    ["pop-under", next.popunder.enabled ? next.popunder.code.trim() : ""],
    ["social bar", next.socialBar.enabled ? next.socialBar.code.trim() : ""],
    ["native banner", next.native.enabled ? next.native.code.trim() : ""],
  ].filter(([, code]) => code) as Array<[string, string]>;
  for (let i = 0; i < filled.length; i += 1) {
    for (let j = i + 1; j < filled.length; j += 1) {
      if (filled[i][1] === filled[j][1]) {
        throw new AdSettingsError(
          `The same code is in the ${filled[i][0]} and the ${filled[j][0]} slots. ` +
            `Use a different snippet for each format — running one twice gets networks to suspend accounts.`
        );
      }
    }
  }

  try {
    await store.put(AD_SETTINGS_KEY, JSON.stringify(next));
  } catch (err) {
    throw new AdSettingsError(
      `Could not save the advert settings: ${(err as Error).message}`
    );
  }

  return next;
}

/** Turn the settings off without losing the pasted code. */
export async function setAdsEnabled(
  env: Env,
  enabled: boolean
): Promise<AdSettings> {
  return writeAdSettings(env, { enabled });
}
