import { Persona, ChatMessage } from "../../types";
import { buildPersonaContext } from "./persona-context";
import {
  describeProvider,
  probeProviders,
  providerStatus,
  requestChatCompletion,
  resolveProviders,
  type EnvLike,
  type ProviderProbe,
} from "./openai-compatible";

interface GenerateParams {
  persona: Persona;
  messages: Pick<ChatMessage, "role" | "content">[];
  envOverride?: Record<string, any>;
}

/** Re-exported so the bot can explain what is (not) configured. */
export { providerStatus, resolveProviders, probeProviders };
export type { ProviderProbe };

/** Name reported when no AI provider answered. */
export const OFFLINE_ENGINE = "Dreamgirl Engine";

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
 * Clean chat history for the model: blank attachment turns are dropped
 * (the model used to answer the previous message instead), same-role turns
 * merged, and the conversation always ends on the user's real message.
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
}: GenerateParams): Promise<{ content: string; provider: string; errors: string[] }> {
  const systemPrompt = buildPersonaContext(persona);

  const recentMessages = prepareHistory(messages);

  const formattedMessages = [
    { role: "system", content: systemPrompt },
    ...recentMessages,
  ];

  const lastUserMsg =
    [...recentMessages].reverse().find((m) => m.role === "user")?.content || "";

  // Providers come from the environment: endpoint + API key + model. No model
  // ID is hardcoded, so a retired model is a config error instead of silent
  // fallback behaviour, and any OpenAI-compatible gateway can be used.
  const { providers, skipped } = resolveProviders(envOverride as EnvLike);
  const errors: string[] = [];

  if (providers.length === 0) {
    console.warn(
      `No AI provider configured for chat — ${skipped
        .map((entry) => `${entry.label}: ${entry.reason}`)
        .join("; ")}`
    );
  }

  for (const provider of providers) {
    try {
      const content = await requestChatCompletion(provider, {
        messages: formattedMessages,
        temperature: 0.85,
        max_tokens: 160,
      });
      return {
        content: sanitizeOutput(content),
        provider: describeProvider(provider),
        errors,
      };
    } catch (err: any) {
      const message = String(err?.message || err);
      const [head, ...rest] = message.split("\n");
      // Keep the hint line: it is the part that says which variable to fix.
      errors.push(
        [head.slice(0, 300), rest.join(" ").trim().slice(0, 300)]
          .filter(Boolean)
          .join("\n   ")
      );
      console.warn(
        `${provider.label} request failed, trying the next provider:`,
        err?.message || err
      );
    }
  }

  // Last resort: answer from the persona record (canned but on-topic).
  console.info("Using persona dynamic fallback (no active provider or all calls failed)");
  for (const entry of skipped) errors.push(`${entry.label}: ${entry.reason}`);
  return {
    content: getLocalFallbackResponse(persona, lastUserMsg),
    provider: OFFLINE_ENGINE,
    errors,
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

/**
 * `/aicheck` — one message that answers "why is the AI not writing?".
 *
 * It lists every provider the environment resolves to, what its key looks like
 * (fingerprint only, never the secret), and then makes a real authenticated
 * call to the provider so a bad key is separated from a bad model, an empty
 * balance or an unreachable host.
 */
export async function aiReport(env: EnvLike): Promise<string> {
  const probes = await probeProviders(env);
  if (probes.length === 0) {
    return (
      "No AI provider is configured.\n" +
      "Set an API key and a model variable in Pages → Settings → Environment variables:\n" +
      "  GROQ_API_KEY + GROQ_MODEL\n" +
      "  OPENROUTER_API_KEY + OPENROUTER_MODEL\n" +
      "  OPENAI_API_KEY + OPENAI_MODEL"
    );
  }

  const lines: string[] = ["AI providers (read from the environment only)", ""];
  probes.forEach((probe, index) => {
    if (probe.skipped) {
      lines.push(`${index + 1}. ${probe.label} — not configured`, `   ${probe.skipped}`, "");
      return;
    }
    const role = probes.filter((entry) => !entry.skipped)[0] === probe ? "primary" : "fallback";
    const verdict = probe.ok ? `✅ working (${probe.status})` : `❌ ${probe.status ?? "failed"}`;
    lines.push(
      `${index + 1}. ${probe.label} — ${role} ${verdict}`,
      `   model: ${probe.model}`,
      `   host:  ${probe.baseUrl}`,
      `   key:   ${probe.key}${probe.keyNote ? ` — ${probe.keyNote}` : ""}`
    );
    if (!probe.ok && probe.detail) {
      lines.push(`   said:  ${probe.detail}`);
    }
    if (probe.hint) {
      lines.push(`   ${probe.hint}`);
    }
    lines.push("");
  });

  const working = probes.filter((probe) => probe.ok);
  lines.push(
    working.length > 0
      ? "The first working provider is the one that writes your profiles."
      : "None of the providers accepted the request — /preview will fail until one does."
  );
  return lines.join("\n").trim();
}
