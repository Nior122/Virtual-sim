// ---------------------------------------------------------------------------
// Profile repository used by the bot.
// Writes go directly to Neon PostgreSQL via the shared serverless data layer
// — no Express/admin API is involved.
// ---------------------------------------------------------------------------
import type { Env, PersonaDraft } from "./types";
import {
  createPersonaRecord,
  createVideoRecord,
  personaSlugExists,
  type CreatePersonaRecordInput,
} from "../db/neon";

/** Returns a slug not already used by another persona. */
export async function uniqueSlug(env: Env, wanted: string): Promise<string> {
  const base = wanted || "dreamgirl";
  let candidate = base;
  let suffix = 1;
  while (await personaSlugExists(env, candidate)) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
  return candidate;
}

export interface CreatedPersona {
  id: string;
  slug: string;
  name: string;
}

/** Creates the persona row directly in Neon. */
export async function createPersona(
  env: Env,
  payload: CreatePersonaRecordInput
): Promise<CreatedPersona> {
  try {
    return await createPersonaRecord(env, payload);
  } catch (err) {
    throw new Error(
      `Database rejected the persona: ${(err as Error).message}`
    );
  }
}

export interface VideoInput {
  url: string;
  title: string;
}

/** Attaches one video row to a persona (these power the call screen). */
export async function addVideo(
  env: Env,
  personaId: string,
  video: VideoInput
): Promise<boolean> {
  try {
    await createVideoRecord(env, {
      personaId,
      url: video.url,
      title: video.title,
    });
    return true;
  } catch (err) {
    console.error("addVideo failed:", err);
    return false;
  }
}

/**
 * Assembles the full record, mapping generated text + media URLs onto the
 * Persona columns consumed by the rest of the application.
 */
export function buildPersonaPayload(
  draft: PersonaDraft,
  slug: string,
  mediaUrls: {
    profileImage: string | null;
    coverImage: string | null;
    gallery: string[];
  }
): CreatePersonaRecordInput {
  return {
    name: draft.name,
    slug,
    description: draft.description,
    profileImage: mediaUrls.profileImage,
    coverImage: mediaUrls.coverImage,
    gallery: mediaUrls.gallery.join(","),
    isAdult: true,
    age: draft.age ?? null,
    city: draft.city ?? null,
    country: draft.country ?? null,
    occupation: draft.occupation ?? null,
    languages: draft.languages ?? null,
    shortBio: draft.shortBio ?? null,
    longBio: draft.longBio ?? null,
    bodyType: draft.bodyType ?? null,
    bustSize: null,
    height: draft.height ?? null,
    eyeColor: draft.eyeColor ?? null,
    hairColor: draft.hairColor ?? null,
    tattoosAndPiercings: null,
    turnOns: draft.turnOns ?? null,
    turnOffs: draft.turnOffs ?? null,
    fantasies: draft.fantasies ?? null,
    intimacyStyle: draft.intimacyStyle ?? null,
    preferredVibe: draft.preferredVibe ?? null,
    kinksAndFetishes: draft.kinksAndFetishes ?? null,
    favoriteLingerie: null,
    eroticInterests: draft.eroticInterests ?? null,
    personality: draft.personality,
    interests: draft.interests,
    hobbies: draft.hobbies ?? null,
    likes: draft.likes ?? null,
    dislikes: draft.dislikes ?? null,
    background: draft.background,
    speakingStyle: draft.speakingStyle,
    communicationTone: draft.communicationTone ?? null,
    flirtLevel: draft.flirtLevel,
    emojiFrequency: draft.emojiFrequency ?? null,
    systemPrompt: draft.systemPrompt ?? null,
    active: true,
  };
}
