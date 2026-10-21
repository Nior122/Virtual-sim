import { Persona, ChatMessage } from "../../types";
import { buildPersonaContext } from "./persona-context";

interface GenerateParams {
  persona: Persona;
  messages: Pick<ChatMessage, "role" | "content">[];
  envOverride?: Record<string, any>;
}

function getEnvValue(envOverride: Record<string, any> | undefined, key: string): string | undefined {
  if (envOverride && envOverride[key]) return envOverride[key];
  if (typeof process !== 'undefined' && process.env && process.env[key]) return process.env[key];
  return undefined;
}

export async function callOpenAICompatible(
  url: string,
  apiKey: string,
  model: string,
  messages: any[],
  maxTokens: number = 80,
  timeoutMs: number = 9000,
  extraHeaders: Record<string, string> = {}
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...extraHeaders,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.85,
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`Provider API Error (${response.status}): ${errorText.slice(0, 120)}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content || typeof content !== "string" || content.trim().length === 0) {
      throw new Error("Empty response from AI provider");
    }

    return content.trim();
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Offline answer used only when every AI provider is unavailable.
 *
 * It used to return one of five random greetings no matter what was asked —
 * which reads as "I asked a question and she answered something else". This
 * version answers the actual question from the persona's own fields and falls
 * back to a reply that at least references what the user said.
 */
function getLocalFallbackResponse(persona: Persona, lastUserMessage: string): string {
  const text = (lastUserMessage || "").toLowerCase().trim();
  const name = persona.name || "me";
  const location = [persona.city, persona.country].filter(Boolean).join(", ");

  // Socials / Manager / Dates (kept exactly as before)
  if (
    /social|instagram|ig|snap|snapchat|telegram|whatsapp|phone|number|digits|date|meet|meetup|dinner|drinks/i.test(
      text
    )
  ) {
    return `Mmm you'll have to reach out to my manager on Telegram for that: t.me/Dreamgirlteam 😉✨`;
  }

  // Are you a bot / Prove it / Call (kept exactly as before)
  if (/bot|real|fake|ai|robot|prove/i.test(text)) {
    return `Haha excuse me?! 😂 I'm 100% real babe. Let me call you right now! 📞`;
  }

  // Direct questions about the persona are answerable from the record.
  if (/\b(your|ur)\s+(name|full name)\b|\bwhat('| i)?s your name\b|\bwho are you\b/.test(text)) {
    return `It's ${name} 😊 What should I call you?`;
  }
  if (/\bhow old\b|\byour age\b|\bage\b.*\?/.test(text) && persona.age) {
    return `I'm ${persona.age} 😉 Does that matter to you?`;
  }
  if (/\bwhere (are you|do you live|r u)\b|\bwhere'?s? (home|from)\b|\byour city\b/.test(text)) {
    return location
      ? `I'm in ${location} 🌸 Where are you texting me from?`
      : `Somewhere warm and quiet right now 😏 Where are you?`;
  }
  if (/\bwhat do you do\b|\byour job\b|\bwork\b|\boccupation\b/.test(text)) {
    return persona.occupation
      ? `I'm a ${persona.occupation.toLowerCase()} — keeps me busy 😌 What about you?`
      : `A bit of everything, honestly 😅 What do you do?`;
  }
  if (/\bhow are you\b|\bhow('| i)?s your day\b|\bhow you doing\b|\bwyd\b|\bwhat are you doing\b/.test(text)) {
    return `Just chilling and thinking about you 😏 What are you up to?`;
  }
  if (/\b(hi|hey|hello|yo|sup)\b/.test(text)) {
    return `Hey you 😊 I was hoping you'd message. How's your day going?`;
  }
  if (/\bthank(s| you)\b/.test(text)) {
    return `Anytime babe 😘 Tell me something about your day.`;
  }
  if (/\b(bye|goodnight|good night|talk later|gtg)\b/.test(text)) {
    return `Don't stay away too long 😉 Goodnight.`;
  }

  // Nothing matched: still respond to what they said instead of a random line.
  const topic = lastUserMessage.replace(/\s+/g, " ").trim().slice(0, 60);
  if (lastUserMessage.includes("?")) {
    return `Mmm good question 😏 ${topic.replace(/\?+$/, "")} — tell me what you think first.`;
  }
  return `Mmm I like that 😊 Tell me more about "${topic}".`;
}

/**
 * Build a clean chat history for the model.
 *
 * Two things used to confuse the reply: attachment-only turns arrive with an
 * empty `content` (the model sees a blank turn and answers the previous
 * message), and the client can send several assistant rows in a row. Empty
 * turns are dropped and consecutive same-role turns merged, keeping the most
 * recent user message intact at the end.
 */
export function prepareHistory(
  messages: Pick<ChatMessage, "role" | "content">[],
  limit = 12
): Array<{ role: "user" | "assistant"; content: string }> {
  const cleaned: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const message of messages) {
    const content = String(message.content || "").trim();
    if (!content) continue;
    const role = message.role === "assistant" ? "assistant" : "user";
    const previous = cleaned[cleaned.length - 1];
    if (previous && previous.role === role) {
      previous.content = `${previous.content}\n${content}`.slice(-2000);
      continue;
    }
    cleaned.push({ role, content });
  }
  // Always end on the user's turn — that is the message being answered.
  while (cleaned.length > 1 && cleaned[cleaned.length - 1].role !== "user") {
    cleaned.pop();
  }
  return cleaned.length > limit ? cleaned.slice(-limit) : cleaned;
}

export async function generatePersonaResponse({
  persona,
  messages,
  envOverride,
}: GenerateParams): Promise<{ content: string; provider: string }> {
  const systemPrompt = buildPersonaContext(persona);

  const recentMessages = prepareHistory(messages);

  const formattedMessages = [
    { role: "system", content: systemPrompt },
    ...recentMessages,
  ];

  const lastUserMsg =
    [...recentMessages].reverse().find((m) => m.role === "user")?.content || "";

  // 1. PRIMARY: Groq (ultra-fast OpenAI-compatible API)
  const groqApiKey = getEnvValue(envOverride, 'GROQ_API_KEY');
  if (groqApiKey) {
    try {
      const model = getEnvValue(envOverride, 'GROQ_MODEL') || "llama-3.3-70b-versatile";
      const content = await callOpenAICompatible(
        "https://api.groq.com/openai/v1/chat/completions",
        groqApiKey,
        model,
        formattedMessages,
        160,
        12000
      );
      return { content: sanitizeOutput(content), provider: `Groq (${model})` };
    } catch (err: any) {
      console.warn("Groq request failed, switching to fallback provider:", err?.message || err);
    }
  }

  // 2. FALLBACK: OpenRouter (OpenRouter API)
  const openRouterApiKey = getEnvValue(envOverride, 'OPENROUTER_API_KEY');
  if (openRouterApiKey) {
    try {
      const model = getEnvValue(envOverride, 'OPENROUTER_MODEL') || "meta-llama/llama-3.3-70b-instruct";
      const content = await callOpenAICompatible(
        "https://openrouter.ai/api/v1/chat/completions",
        openRouterApiKey,
        model,
        formattedMessages,
        160,
        12000,
        {
          "HTTP-Referer": "https://dreamgirl.app",
          "X-Title": "Dreamgirl AI",
        }
      );
      return { content: sanitizeOutput(content), provider: `OpenRouter (${model})` };
    } catch (err: any) {
      console.warn("OpenRouter fallback request failed:", err?.message || err);
    }
  }

  // 3. OPTIONAL SECONDARY FALLBACK: Standard OpenAI API or OpenAI Proxy
  const openAiApiKey = getEnvValue(envOverride, 'OPENAI_API_KEY');
  if (openAiApiKey) {
    try {
      const baseUrl = (getEnvValue(envOverride, 'OPENAI_BASE_URL') || "https://api.openai.com/v1").replace(/\/+$/, "");
      const model = getEnvValue(envOverride, 'OPENAI_MODEL') || "gpt-4o-mini";
      const content = await callOpenAICompatible(
        `${baseUrl}/chat/completions`,
        openAiApiKey,
        model,
        formattedMessages,
        160,
        12000
      );
      return { content: sanitizeOutput(content), provider: `OpenAI (${model})` };
    } catch (err: any) {
      console.warn("OpenAI fallback request failed:", err?.message || err);
    }
  }

  // 4. FINAL SAFEGUARD: Native Persona Response Engine (Zero-Downtime Guarantee)
  console.info("Using persona dynamic fallback (no active API key or all network calls timed out)");
  return {
    content: getLocalFallbackResponse(persona, lastUserMsg),
    provider: "Dreamgirl Engine",
  };
}

function sanitizeOutput(raw: string): string {
  let content = raw.trim();

  // Strip wrapping quotes if LLM added them
  if (
    (content.startsWith('"') && content.endsWith('"')) ||
    (content.startsWith("'") && content.endsWith("'"))
  ) {
    content = content.slice(1, -1).trim();
  }

  // Enforce human length constraint (max ~24 words unless contains link)
  const containsLink = /t\.me\//i.test(content) || /https?:\/\//i.test(content);
  const MAX_WORDS = 24;
  const words = content.split(/\s+/).filter(Boolean);

  if (!containsLink && words.length > MAX_WORDS) {
    const sentences = content.match(/[^.!?]+[.!?]+/g);
    if (sentences && sentences.length > 0) {
      let trimmed = "";
      for (const s of sentences) {
        if ((trimmed + " " + s).trim().split(/\s+/).filter(Boolean).length <= MAX_WORDS) {
          trimmed = (trimmed + " " + s).trim();
        } else {
          break;
        }
      }
      content = trimmed || words.slice(0, 18).join(" ") + "...";
    } else {
      content = words.slice(0, 18).join(" ") + "...";
    }
  }

  return content;
}
