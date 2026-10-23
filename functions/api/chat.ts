import { generatePersonaResponse } from "../../src/lib/ai/provider";
import { getPersonaForChat } from "../../src/lib/db/neon";

/**
 * Last-resort persona when the row cannot be loaded (missing DB binding, an
 * unknown id, or a transient Neon error). Every real profile is read from the
 * database so its own name, personality, speaking style and systemPrompt are
 * used — previously this generic object was used for *every* request, which is
 * why every profile chatted the same way.
 */
function genericPersona(personaId: string) {
  return {
    id: personaId || "unknown",
    name: "Dream Babe",
    slug: "dream-babe",
    systemPrompt:
      "You are a friendly, flirty persona named Dream Babe. You respond naturally, like a human, and keep answers short (1-2 sentences maximum, never generate essays).",
    profileImage: "",
    headerImage: "",
    description: "A fun, flirty companion",
    isLive: true,
    age: 21,
    occupations: [],
    hobbies: [],
    personalityTraits: [],
    profileGallery: [],
  };
}

/** Fill in the few fields the prompt builder assumes are present. */
function normalizePersona(row: Record<string, any>) {
  const text = (value: any, fallback = "") =>
    typeof value === "string" && value.trim() ? value : fallback;
  return {
    ...row,
    name: text(row.name, "Dream Babe"),
    description: text(row.description),
    personality: text(row.personality, "warm, playful"),
    speakingStyle: text(row.speakingStyle, "short, casual messages"),
    communicationTone: row.communicationTone ?? null,
    flirtLevel: typeof row.flirtLevel === "number" ? row.flirtLevel : 3,
    systemPrompt: row.systemPrompt ?? null,
  };
}

export async function onRequestPost({ request, env }: any) {
  try {
    const body = await request.json();
    const { message, history, personaId, persona } = body;

    if (!message) {
      return new Response(
        JSON.stringify({ error: "Missing required message field" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Map history to the format expected by provider
    const formattedMessages = Array.isArray(history) ? history : [];
    formattedMessages.push({ role: "user", content: message });

    // The call screen sends only personaId, so load the real profile (by id or
    // slug) and hand the full row to the prompt builder. `systemPrompt` is
    // selected here but never returned to the browser.
    let resolved: Record<string, any> | null = null;
    if (personaId) {
      try {
        resolved = await getPersonaForChat(env, String(personaId));
      } catch (err) {
        console.error("Persona lookup failed, using fallback:", err);
      }
    }

    // Database row wins (it is the source of truth); a client-supplied persona
    // is only used if the lookup found nothing.
    const personaForPrompt = resolved
      ? normalizePersona(resolved)
      : persona || genericPersona(personaId);

    const { content, provider } = await generatePersonaResponse({
      // @ts-ignore: DB row maps onto the Persona shape the prompt reads
      persona: personaForPrompt,
      messages: formattedMessages,
      envOverride: env,
    });

    // Logging which engine answered makes "she says random things" debuggable:
    // "Dreamgirl Engine" in the logs means every AI provider failed and the
    // reply came from the offline fallback.
    console.log(
      `chat persona=${personaForPrompt.name} provider=${provider} reply="${String(
        content
      ).slice(0, 120)}"`
    );

    // Note: CallSession.tsx expects the response text in `data.message`
    return new Response(JSON.stringify({ message: content, provider }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("AI Generation Error:", error?.message || error);
    return new Response(
      JSON.stringify({ error: error.message || "Failed to generate AI response" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
