import type { Env, PersonaDraft, ScrapedProfile } from "./types";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "llama-3.3-70b-versatile";

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

/**
 * Generates the full persona field set from the owner's write-up and/or
 * scraped profile data using Groq's OpenAI-compatible JSON mode.
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

  const model = env.GROQ_MODEL || DEFAULT_MODEL;
  const body = {
    model,
    temperature: 0.8,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a profile writer for an AI companion entertainment app. " +
          "You produce structured JSON persona profiles. Output pure JSON only, never prose.",
      },
      { role: "system", content: FIELD_INSTRUCTIONS },
      { role: "user", content: buildUserPrompt(writeUp, scraped) },
    ],
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    let res: Response;
    try {
      res = await fetch(GROQ_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw new Error(
        `Could not reach Groq (${(err as Error).message}). Check GROQ_API_KEY and network access.`
      );
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Groq error ${res.status}: ${detail.slice(0, 200)}`);
    }

    const data = (await res.json()) as any;
    const raw: string = data?.choices?.[0]?.message?.content ?? "";
    const parsed = tryParseJson(raw);
    if (parsed) return parsed;

    // One stricter retry if the model returned malformed JSON.
    const retry = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...body,
        messages: [
          ...body.messages,
          { role: "assistant", content: raw.slice(0, 2000) },
          {
            role: "user",
            content:
              "That response was not valid JSON matching the schema. Reply with the JSON object only.",
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!retry.ok) throw new Error(`Groq retry failed with ${retry.status}`);
    const retryData = (await retry.json()) as any;
    const retryParsed = tryParseJson(
      retryData?.choices?.[0]?.message?.content ?? ""
    );
    if (!retryParsed) {
      throw new Error("Groq returned content that could not be parsed as a profile.");
    }
    return retryParsed;
  } finally {
    clearTimeout(timeout);
  }
}
