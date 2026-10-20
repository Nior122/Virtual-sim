import type { Env, PersonaDraft, ScrapedProfile } from "./types";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_DEFAULT_MODEL = "llama-3.3-70b-versatile";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_DEFAULT_MODEL = "meta-llama/llama-3.3-70b-instruct";

const FIELD_INSTRUCTIONS = `Return ONE JSON object with EXACTLY these keys (use null when information is unknown):
- name: string, display name of the persona
- slug: string, lowercase kebab-case identifier derived from the name (letters, numbers, hyphens only)
- description: string, ONE sentence under 160 characters, the teaser shown on profile cards
- age: number or null
- city: string or null
- country: string or null
- occupation: string or null
- languages: string or null, comma separated
- shortBio: string or null, one playful line
- longBio: string or null, 2-4 sentences written in the persona's own voice
- personality: string, comma-separated core traits
- background: string, 1-3 sentence fictional backstory
- interests: string, comma-separated list
- hobbies: string or null, comma-separated list
- likes: string or null, comma-separated list
- dislikes: string or null, comma-separated list
- speakingStyle: string, how she texts (cadence, slang, vocabulary)
- communicationTone: string or null, e.g. "Playful, teasing, and alluring"
- flirtLevel: number from 0 to 4
- emojiFrequency: one of "Low", "Medium", "High" or null
- bodyType, height, eyeColor, hairColor: string or null, physical descriptors
- turnOns, turnOffs, fantasies, intimacyStyle, preferredVibe, kinksAndFetishes, eroticInterests: string or null, keep these flirty and tasteful, never explicit
- systemPrompt: string, a short instruction block (under 60 words) telling the chat model how to stay in character, keep replies short and human`;

function buildUserPrompt(writeUp: string, scraped?: ScrapedProfile | null): string {
  const parts: string[] = [];
  if (writeUp.trim()) {
    parts.push(`OWNER WRITE-UP (primary source of truth):\n${writeUp.trim()}`);
  }
  if (scraped) {
    parts.push(
      `SCRAPED REFERENCE DATA from ${scraped.sourceUrl} (use for names, bios, location, interests; do not invent facts beyond this):` +
        `\nTitle: ${scraped.title || "n/a"}` +
        `\nDescription: ${scraped.description || "n/a"}` +
        `\nPage text excerpt: ${scraped.textSnippet || "n/a"}`
    );
  }
  parts.push(
    "Rules: write in English. The persona is a fictional AI companion for an entertainment chat app. " +
      "Keep all content flirty and tasteful, never pornographic. Fill every string field; use null only where genuinely unknown."
  );
  return parts.join("\n\n");
}

function tryParseJson(raw: string): PersonaDraft | null {
  let text = raw.trim();
  // Strip markdown code fences if the model adds them.
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  }
  try {
    const parsed = JSON.parse(text);
    if (
      parsed &&
      typeof parsed.name === "string" &&
      typeof parsed.slug === "string" &&
      typeof parsed.description === "string" &&
      typeof parsed.personality === "string" &&
      typeof parsed.background === "string" &&
      typeof parsed.interests === "string" &&
      typeof parsed.speakingStyle === "string"
    ) {
      // Normalize flirt level into the 0-4 integer range the schema expects.
      const level = Number(parsed.flirtLevel);
      parsed.flirtLevel = Number.isFinite(level)
        ? Math.max(0, Math.min(4, Math.round(level)))
        : 3;
      parsed.slug = parsed.slug
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60);
      return parsed as PersonaDraft;
    }
  } catch {
    // fall through to retry
  }
  return null;
}

// ---------------------------------------------------------------------------
// Provider chain: Groq first, OpenRouter as the fallback.
// ---------------------------------------------------------------------------
interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface Provider {
  name: string;
  url: string;
  apiKey: string;
  model: string;
  extraHeaders?: Record<string, string>;
}

class ProviderError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
  }
}

/** Configured providers, in attempt order. */
function getProviders(env: Env): Provider[] {
  const providers: Provider[] = [];
  if (env.GROQ_API_KEY) {
    providers.push({
      name: "Groq",
      url: GROQ_URL,
      apiKey: env.GROQ_API_KEY,
      model: env.GROQ_MODEL || GROQ_DEFAULT_MODEL,
    });
  }
  if (env.OPENROUTER_API_KEY) {
    providers.push({
      name: "OpenRouter",
      url: OPENROUTER_URL,
      apiKey: env.OPENROUTER_API_KEY,
      model: env.OPENROUTER_MODEL || OPENROUTER_DEFAULT_MODEL,
      extraHeaders: {
        "HTTP-Referer": "https://dreambabe.pages.dev",
        "X-Title": "Dream Babe Profile Bot",
      },
    });
  }
  return providers;
}

/** POST one chat completion. Attaches the HTTP status to thrown errors. */
async function requestCompletion(
  provider: Provider,
  messages: ChatMessage[],
  jsonMode: boolean,
  signal: AbortSignal
): Promise<string> {
  const body: Record<string, unknown> = {
    model: provider.model,
    temperature: 0.8,
    messages,
  };
  if (jsonMode) body.response_format = { type: "json_object" };

  let res: Response;
  try {
    res = await fetch(provider.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json",
        ...(provider.extraHeaders || {}),
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    throw new ProviderError(
      `Could not reach ${provider.name} (${(err as Error).message}).`
    );
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ProviderError(
      `${provider.name} error ${res.status}: ${detail.slice(0, 200)}`,
      res.status
    );
  }

  const data = (await res.json()) as any;
  return String(data?.choices?.[0]?.message?.content ?? "");
}

/** A 400 caused by response_format means the model can't do JSON mode. */
function isJsonModeError(err: unknown): boolean {
  const candidate = err as { status?: number; message?: string };
  return (
    candidate?.status === 400 &&
    /response_format|json|parameter/i.test(String(candidate?.message ?? ""))
  );
}

/** One request with its own timeout, falling back when JSON mode is rejected. */
async function complete(
  provider: Provider,
  messages: ChatMessage[],
  jsonMode: boolean
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    try {
      return await requestCompletion(
        provider,
        messages,
        jsonMode,
        controller.signal
      );
    } catch (err) {
      if (!jsonMode || !isJsonModeError(err)) throw err;
      // Retry the same provider without response_format.
      return await requestCompletion(
        provider,
        messages,
        false,
        controller.signal
      );
    }
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Generates the full persona field set from the owner's write-up and/or
 * scraped profile data. Tries Groq first and falls back to OpenRouter when
 * Groq is not configured or fails.
 */
export async function generatePersonaDraft(
  env: Env,
  writeUp: string,
  scraped?: ScrapedProfile | null
): Promise<PersonaDraft> {
  if (!writeUp.trim() && !scraped) {
    throw new Error(
      "Nothing to generate from — send a write-up or use /scrape <url> first."
    );
  }

  const providers = getProviders(env);
  if (providers.length === 0) {
    throw new Error(
      "No AI provider configured. Set GROQ_API_KEY or OPENROUTER_API_KEY in the Pages environment variables."
    );
  }

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You are a profile writer for an AI companion entertainment app. " +
        "You produce structured JSON persona profiles. Output pure JSON only, never prose.",
    },
    { role: "system", content: FIELD_INSTRUCTIONS },
    { role: "user", content: buildUserPrompt(writeUp, scraped) },
  ];

  let lastError: Error | null = null;
  for (const provider of providers) {
    try {
      const raw = await complete(provider, messages, true);
      const parsed = tryParseJson(raw);
      if (parsed) return parsed;

      // One stricter retry if the model returned malformed JSON.
      const retry = await complete(
        provider,
        [
          ...messages,
          { role: "assistant", content: raw.slice(0, 2000) },
          {
            role: "user",
            content:
              "That response was not valid JSON matching the schema. Reply with the JSON object only.",
          },
        ],
        true
      );
      const retryParsed = tryParseJson(retry);
      if (retryParsed) return retryParsed;

      throw new Error(
        `${provider.name} returned content that could not be parsed as a profile.`
      );
    } catch (err) {
      lastError = err as Error;
      console.warn(`${provider.name} profile generation failed:`, lastError.message);
    }
  }

  throw new Error(
    `All AI providers failed. Last error: ${
      lastError?.message || "unknown error"
    }`
  );
}
