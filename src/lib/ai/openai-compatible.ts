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

    const apiKey = firstEnv(env, names.key);
    const model = firstEnv(env, names.model);
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
              "X-Title": "Dream Babe",
            }
          : undefined,
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
      return `• ${provider.label} — ${provider.model} (${role})`;
    }),
    ...skipped.map((entry) => `• ${entry.label} skipped: ${entry.reason}`),
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
        `${provider.label} error ${response.status}: ${errorText.slice(0, 200)}`
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
