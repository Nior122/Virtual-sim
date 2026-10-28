/**
 * OpenAI-compatible chat providers, resolved entirely from environment
 * variables.
 *
 * There are deliberately **no model IDs in this file**. The model for every
 * provider must come from the environment (`GROQ_MODEL`, `OPENROUTER_MODEL`,
 * `OPENAI_MODEL`/`AI_MODEL`); if a provider's model is not configured that
 * provider is skipped and the reason is reported instead of silently falling
 * back to a hardcoded name that the provider may have retired.
 *
 * Only the endpoints are defaulted (`GROQ_BASE_URL`, `OPENROUTER_BASE_URL`,
 * `OPENAI_BASE_URL`/`AI_BASE_URL` override them), because any OpenAI-compatible
 * gateway can be pointed at with the same request shape.
 */

export interface ResolvedProvider {
  /** Stable id used in `AI_PROVIDER_ORDER`: groq | openrouter | openai */
  id: string;
  /** Human label shown to the bot user / in logs */
  label: string;
  /** Base URL without a trailing slash, e.g. https://api.groq.com/openai/v1 */
  baseUrl: string;
  apiKey: string;
  /** From the environment only — never defaulted in code */
  model: string;
  extraHeaders?: Record<string, string>;
  /** Non-secret note about how the key had to be cleaned (paste artifacts) */
  keyNote?: string;
}

export interface SkippedProvider {
  id: string;
  label: string;
  /** Why this provider is not usable, e.g. "GROQ_MODEL is not set" */
  reason: string;
}

export interface ProviderRegistry {
  providers: ResolvedProvider[];
  skipped: SkippedProvider[];
}

/** Default attempt order; override with AI_PROVIDER_ORDER=openrouter,groq */
const DEFAULT_ORDER = ["groq", "openrouter", "openai"];

/** Endpoints only (no model IDs). Each is overridable from the environment. */
const ENDPOINTS: Record<string, string> = {
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  openai: "https://api.openai.com/v1",
};

/** Where the owner creates a replacement key (shown in error hints). */
const KEY_URLS: Record<string, string> = {
  groq: "console.groq.com/keys",
  openrouter: "openrouter.ai/keys",
  openai: "platform.openai.com/api-keys",
};

const LABELS: Record<string, string> = {
  groq: "Groq",
  openrouter: "OpenRouter",
  openai: "OpenAI-compatible",
};

export type EnvLike = Record<string, any> | undefined;

/** Read a variable from the Worker env, falling back to process.env in dev. */
export function readEnv(env: EnvLike, key: string): string | undefined {
  const fromEnv = env?.[key];
  if (typeof fromEnv === "string" && fromEnv.trim()) return fromEnv.trim();
  if (fromEnv !== undefined && fromEnv !== null && typeof fromEnv !== "string") {
    return String(fromEnv);
  }
  if (typeof process !== "undefined" && process.env && process.env[key]) {
    return String(process.env[key]).trim();
  }
  return undefined;
}

function firstEnv(env: EnvLike, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = readEnv(env, key);
    if (value) return value;
  }
  return undefined;
}

function normaliseBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

/**
 * Clean an API key the way a human probably pasted it.
 *
 * Keys are printable ASCII with no spaces, so every character outside that
 * range is a paste artifact: a trailing newline from a text editor, a
 * zero-width space from a web page, a smart quote from a chat app. Wrapping
 * quotes and a duplicated `Bearer ` / `Authorization:` prefix come from
 * copying a header or a `curl` line. All of them end up inside the header
 * value and make the provider reject the request exactly like a missing
 * header ("401 Missing Authentication header"), which is impossible to spot in
 * the Cloudflare dashboard.
 */
export function sanitizeSecret(raw: string | undefined | null): string | undefined {
  if (typeof raw !== "string") return undefined;
  let value = raw.trim();
  for (let pass = 0; pass < 3; pass += 1) {
    const before = value;
    value = value
      .replace(/^["'`“”‘’]+/, "")
      .replace(/["'`“”‘’]+$/, "")
      .replace(/^authorization\s*:\s*/i, "")
      .replace(/^bearer\s+/i, "")
      .trim();
    if (value === before) break;
  }
  // Nothing a key can legitimately contain: whitespace (including zero-width
  // and BOM characters) and anything outside printable ASCII.
  value = value.replace(/[\s\u00a0\u200b-\u200f\u2028\u2029\ufeff]/g, "");
  value = value.replace(/[^\x21-\x7e]/g, "");

  // Last resort: the variable holds more than the key (a whole `curl` line, a
  // JSON snippet, "my key is …"). Pull the key itself out of it.
  const shapes = [
    /sk-or-v[0-9]+-[A-Za-z0-9_-]{16,}/,
    /gsk_[A-Za-z0-9_-]{20,}/,
    /sk-[A-Za-z0-9_-]{20,}/,
  ];
  if (value && !shapes.some((shape) => new RegExp(`^${shape.source}$`).test(value))) {
    for (const shape of shapes) {
      const found = value.match(shape);
      if (found) {
        value = found[0];
        break;
      }
    }
  }
  return value || undefined;
}

/**
 * Short, non-secret description of a key: enough to tell two keys apart in a
 * screenshot, useless to anyone who reads it.
 */
export function fingerprintSecret(secret: string | undefined): string {
  if (!secret) return "not set";
  // A real key is long and made of base64url-ish characters. Anything else is
  // a mistake in the variable, so do not echo most of it back: a 15-character
  // value would be shown almost in full, and the report is pasted into chats.
  const keyish = /^[A-Za-z0-9_-]{20,}$/.test(secret);
  if (!keyish) {
    return `"${secret.slice(0, 12)}${secret.length > 12 ? "…" : ""}" (${secret.length} chars — not a key)`;
  }
  const head = secret.slice(0, secret.startsWith("sk-or-") ? 13 : 8);
  const tail = secret.length > head.length + 4 ? secret.slice(-4) : "";
  return `${head}${tail ? `…${tail}` : ""} (${secret.length} chars)`;
}

/** Keys from one provider pasted into another one's variable. */
export function looksLikeOtherProviderKey(id: string, secret: string): string | null {
  const foreign = id === "openrouter" ? /^gsk_/ : /^sk-or-/;
  if (!foreign.test(secret)) return null;
  return id === "openrouter"
    ? "this looks like a Groq key (gsk_…), not an OpenRouter key (sk-or-…)"
    : "this looks like an OpenRouter key (sk-or-…), not a key for this provider";
}

/** What a real key from each provider starts with (none = any format). */
const KEY_PREFIX: Record<string, { prefix: string; sample: string; alias: string }> = {
  groq: { prefix: "gsk_", sample: "gsk_…", alias: "Groq" },
  openrouter: { prefix: "sk-or-", sample: "sk-or-v1-…", alias: "OpenRouter" },
};

/**
 * Catch a value that cannot possibly be a key before spending a request on it.
 *
 * The common mistake is pasting the wrong thing into the key field — most often
 * the model name (`openrouter/free`), a URL, or the whole `Bearer …` line. Those
 * all produce the same unhelpful "401 Missing Authentication header", so they
 * are detected here and reported as a configuration error instead.
 */
export function keyShapeProblem(
  id: string,
  apiKey: string,
  model?: string
): string | null {
  const expected = KEY_PREFIX[id];
  const what = expected ? `${expected.alias} keys` : "API keys";
  if (model && apiKey === model) {
    return `it holds the model name (“${apiKey}”), not an API key — ${what} start with ${expected?.sample ?? "a long token"}`;
  }
  if (/^https?:\/\//i.test(apiKey)) {
    return "it holds a URL, not an API key";
  }
  if (expected && !apiKey.startsWith(expected.prefix)) {
    return `${expected.alias} keys start with ${expected.sample}, so “${apiKey}” cannot be one`;
  }
  return null;
}

/** Env variable names per provider, including the generic aliases. */
const KEY_NAMES: Record<string, { key: string[]; model: string[]; base: string[] }> = {
  groq: {
    key: ["GROQ_API_KEY"],
    model: ["GROQ_MODEL"],
    base: ["GROQ_BASE_URL"],
  },
  openrouter: {
    key: ["OPENROUTER_API_KEY"],
    model: ["OPENROUTER_MODEL"],
    base: ["OPENROUTER_BASE_URL"],
  },
  openai: {
    key: ["OPENAI_API_KEY", "AI_API_KEY"],
    model: ["OPENAI_MODEL", "AI_MODEL"],
    base: ["OPENAI_BASE_URL", "AI_BASE_URL"],
  },
};

/**
 * Build the provider list from the environment.
 *
 * A provider is used only when **both** its API key and its model are set; the
 * reason for skipping is kept so `/chatcheck` can say exactly which variable is
 * missing.
 */
export function resolveProviders(env: EnvLike): ProviderRegistry {
  const orderRaw = readEnv(env, "AI_PROVIDER_ORDER");
  const order = (orderRaw ? orderRaw.split(/[,\s]+/) : DEFAULT_ORDER)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  const providers: ResolvedProvider[] = [];
  const skipped: SkippedProvider[] = [];
  const seen = new Set<string>();

  for (const id of order) {
    if (seen.has(id)) continue;
    const names = KEY_NAMES[id];
    if (!names) {
      skipped.push({ id, label: id, reason: "unknown provider in AI_PROVIDER_ORDER" });
      continue;
    }
    seen.add(id);

    const rawKey = firstEnv(env, names.key);
    const apiKey = sanitizeSecret(rawKey);
    const model = firstEnv(env, names.model)?.trim();
    const baseRaw = firstEnv(env, names.base);

    if (!apiKey) {
      skipped.push({ id, label: LABELS[id], reason: `${names.key[0]} is not set` });
      continue;
    }
    if (!model) {
      skipped.push({
        id,
        label: LABELS[id],
        reason: `${names.model[0]} is not set (model IDs come from the environment only)`,
      });
      continue;
    }

    // A value that cannot be a key would only ever fail with a generic 401.
    // Report it as the configuration mistake it is, and do not send it.
    const shapeProblem = keyShapeProblem(id, apiKey, model);
    if (shapeProblem) {
      skipped.push({ id, label: LABELS[id], reason: `${names.key[0]} is wrong: ${shapeProblem}` });
      continue;
    }

    providers.push({
      id,
      label: LABELS[id],
      baseUrl: normaliseBaseUrl(baseRaw || ENDPOINTS[id]),
      apiKey,
      model,
      extraHeaders:
        id === "openrouter"
          ? {
              "HTTP-Referer": "https://dreambabe.pages.dev",
              "X-OpenRouter-Title": "Dream Babe",
              "X-Title": "Dream Babe",
            }
          : undefined,
      keyNote: rawKey && rawKey !== apiKey ? "quotes/spaces/newlines stripped" : undefined,
    });
  }

  return { providers, skipped };
}

/** `Provider (model)` for logs; never includes the key. */
export function describeProvider(provider: ResolvedProvider): string {
  return `${provider.label} (${provider.model})`;
}

/** Multi-line status for /chatcheck and logs, no secrets included. */
export function providerStatus(env: EnvLike): string[] {
  const { providers, skipped } = resolveProviders(env);
  if (providers.length === 0) {
    return [
      "No AI provider is configured.",
      ...skipped.map((entry) => `• ${entry.label} skipped: ${entry.reason}`),
      "Set the API key and model variables in Pages → Settings → Environment variables.",
    ];
  }
  return [
    ...providers.map((provider, index) => {
      const role = index === 0 ? "primary" : "fallback";
      const key = `key ${fingerprintSecret(provider.apiKey)}${
        provider.keyNote ? ` — ${provider.keyNote}` : ""
      }`;
      const wrong = looksLikeOtherProviderKey(provider.id, provider.apiKey);
      return (
        `• ${provider.label} — ${provider.model} (${role})\n` +
        `  ${key}${wrong ? `\n  ⚠ ${wrong}` : ""}`
      );
    }),
    ...skipped.map((entry) => `• ${entry.label} skipped: ${entry.reason}`),
  ];
}

/**
 * Turn a provider's HTTP error into the sentence that tells the owner what to
 * change. The raw body is kept (it is what the provider said) but on its own
 * "401 Missing Authentication header" does not say which variable to fix, and
 * that exact string is what OpenRouter returns when the key never arrives as a
 * bearer token — quotes, a pasted `Bearer ` prefix or an invisible character in
 * the Cloudflare variable produce it just as reliably as a deleted key.
 */
export function authHint(options: {
  id: string;
  label: string;
  status?: number;
  body: string;
  apiKey?: string;
  model?: string;
}): string | null {
  const { id, label, status, body, apiKey, model } = options;
  const said = body.toLowerCase();
  const env = KEY_NAMES[id]?.key[0] || "the API key";
  const modelVar = KEY_NAMES[id]?.model[0] || "the model variable";
  const keyUrl = KEY_URLS[id] || "the provider dashboard";
  const keyInfo = apiKey ? `Key in use: ${fingerprintSecret(apiKey)}.` : "";
  const wrongKey = apiKey ? looksLikeOtherProviderKey(id, apiKey) : null;

  if (wrongKey) {
    return `→ ${env} holds ${wrongKey}. Put the ${label} key in ${env}.`;
  }

  if (status === 401 || status === 403) {
    if (/missing authentication|no auth credentials|invalid.*(authentication|authorization)/.test(said)) {
      return (
        `→ ${label} did not receive a usable "Authorization: Bearer …" header, which ` +
        `almost always means ${env} was saved with quotes, spaces, a newline or a ` +
        `pasted "Bearer " in front. ${keyInfo} Delete the variable in Cloudflare, ` +
        `paste the key again and redeploy.`
      );
    }
    if (/user not found|no such user|invalid api key|incorrect api key|unauthorized|key.*(revoked|disabled|expired)/.test(said)) {
      return (
        `→ ${label} rejected the key itself: it is unknown, expired or was revoked. ` +
        `${keyInfo} Create a new key at ${keyUrl}, replace ${env} and redeploy — ` +
        `or configure a different provider as the primary.`
      );
    }
    return (
      `→ ${label} refused the credentials. ${keyInfo} Re-copy the key from the ` +
      `${label} dashboard into ${env}, then redeploy.`
    );
  }
  if (status === 402) {
    return `→ ${label} says the account is out of credits. Top up, or use a free model via ${modelVar}.`;
  }
  if (status === 404) {
    return `→ The model "${model || "(unset)"}" was not found at ${label}. Check ${modelVar} — it must be an exact model ID from the provider's list.`;
  }
  if (status === 429) {
    return `→ ${label} is rate-limiting the account. Wait a moment, or point AI_PROVIDER_ORDER at another provider that has a key.`;
  }
  if (status === 400 && /model|max_tokens|response_format/i.test(said)) {
    return `→ ${label} rejected the request for model "${model || "(unset)"}". The model may be retired or not support this call — check ${modelVar}.`;
  }
  return null;
}

/** `${message} — ${hint}` when the error is actionable, otherwise `message`. */
export function withHint(message: string, hint: string | null): string {
  return hint ? `${message}\n${hint}` : message;
}

export interface ProviderProbe {
  id: string;
  label: string;
  model: string;
  baseUrl: string;
  /** Present only when the provider was skipped (missing key or model) */
  skipped?: string;
  key?: string;
  keyNote?: string;
  /** undefined = not probed (skipped provider) */
  ok?: boolean;
  status?: number;
  detail?: string;
  hint?: string | null;
}

/**
 * Ask the provider whether the stored key is actually accepted, without
 * spending a completion. OpenRouter exposes GET /key for exactly this; the
 * OpenAI-compatible gateways answer GET /models to an authenticated caller.
 */
export async function probeProvider(
  provider: ResolvedProvider,
  timeoutMs = 8000
): Promise<Omit<ProviderProbe, "id" | "label" | "model" | "baseUrl" | "key" | "keyNote">> {
  const path = provider.id === "openrouter" ? "/key" : "/models";
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${provider.baseUrl}${path}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        ...(provider.extraHeaders || {}),
      },
      signal: controller.signal,
    });
    const text = await response.text().catch(() => "");
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        detail: text.slice(0, 200) || response.statusText,
        hint: authHint({
          id: provider.id,
          label: provider.label,
          status: response.status,
          body: text,
          apiKey: provider.apiKey,
          model: provider.model,
        }),
      };
    }
    return { ok: true, status: response.status, detail: "key accepted" };
  } catch (err) {
    return {
      ok: false,
      detail: `could not reach ${provider.baseUrl}: ${(err as Error).message}`,
      hint: `→ The bot cannot reach ${provider.label}. If OPENROUTER_BASE_URL/${provider.id.toUpperCase()}_BASE_URL is set, check the host.`,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Every configured provider with a live key check — the `/aicheck` report. */
export async function probeProviders(env: EnvLike): Promise<ProviderProbe[]> {
  const { providers, skipped } = resolveProviders(env);
  const probed = await Promise.all(
    providers.map(async (provider) => ({
      id: provider.id,
      label: provider.label,
      model: provider.model,
      baseUrl: provider.baseUrl,
      key: fingerprintSecret(provider.apiKey),
      keyNote: provider.keyNote,
      ...(await probeProvider(provider)),
    }))
  );
  return [
    ...probed,
    ...skipped.map((entry) => ({
      id: entry.id,
      label: entry.label,
      model: "(not set)",
      baseUrl: "",
      skipped: entry.reason,
    })),
  ];
}

/** POST /chat/completions on one provider. */
export async function requestChatCompletion(
  provider: ResolvedProvider,
  body: Record<string, unknown>,
  timeoutMs = 12000
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // The model always comes from the provider config (environment): a body
    // field can never override it.
    const { model: _ignoredModel, ...rest } = body as Record<string, unknown>;
    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json",
        ...(provider.extraHeaders || {}),
      },
      body: JSON.stringify({ ...rest, model: provider.model }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        withHint(
          `${provider.label} error ${response.status}: ${errorText.slice(0, 200)}`,
          authHint({
            id: provider.id,
            label: provider.label,
            status: response.status,
            body: errorText,
            apiKey: provider.apiKey,
            model: provider.model,
          })
        )
      );
    }

    const data = (await response.json()) as any;
    const content = data?.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string" || !content.trim()) {
      throw new Error(`${provider.label} returned an empty completion`);
    }
    return content.trim();
  } finally {
    clearTimeout(timeoutId);
  }
}
