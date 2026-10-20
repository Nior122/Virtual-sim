// ---------------------------------------------------------------------------
// Profile repository used by the bot.
// Writes go directly to Neon PostgreSQL via the shared serverless data layer
// — no Express/admin API is involved.
// ---------------------------------------------------------------------------
import type { Env, PersonaDraft } from "./types";
import {
  createPersonaRecord,
  createVideoRecord,
  deletePersonaVideo,
  getPersonaMediaForEdit,
  listPersonaVideos,
  personaSlugExists,
  updatePersonaMediaColumns,
  updatePersonaVideo,
  type CreatePersonaRecordInput,
  type PersonaMediaForEdit,
  type PersonaVideoRow,
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

// ---------------------------------------------------------------------------
// Editing an already-published profile (media only)
// ---------------------------------------------------------------------------
export type EditableProfile = PersonaMediaForEdit;

/** Loads an existing profile (by slug) so the draft can edit its media. */
export async function loadProfileForEdit(
  env: Env,
  slug: string
): Promise<EditableProfile | null> {
  try {
    return await getPersonaMediaForEdit(env, slug);
  } catch (err) {
    throw new Error(`Could not load that profile: ${(err as Error).message}`);
  }
}

/** Reads the persona's current video rows. */
export async function loadProfileVideos(
  env: Env,
  personaId: string
): Promise<PersonaVideoRow[]> {
  try {
    return await listPersonaVideos(env, personaId);
  } catch (err) {
    throw new Error(`Could not load that profile's videos: ${(err as Error).message}`);
  }
}

/** Writes the profile/cover/gallery columns of an existing persona. */
export async function saveProfileMedia(
  env: Env,
  personaId: string,
  media: {
    profileImage: string | null;
    coverImage: string | null;
    gallery: string[];
  }
): Promise<void> {
  try {
    await updatePersonaMediaColumns(env, personaId, media);
  } catch (err) {
    throw new Error(`Database rejected the image changes: ${(err as Error).message}`);
  }
}

/** Removes one video row from an existing persona. */
export async function removeProfileVideo(
  env: Env,
  personaId: string,
  videoId: string
): Promise<boolean> {
  try {
    return await deletePersonaVideo(env, personaId, videoId);
  } catch (err) {
    console.error("removeProfileVideo failed:", err);
    return false;
  }
}

/** Repoints one video row at a new URL/title. */
export async function updateProfileVideo(
  env: Env,
  personaId: string,
  videoId: string,
  input: { url: string; title: string }
): Promise<boolean> {
  try {
    return await updatePersonaVideo(env, personaId, videoId, input);
  } catch (err) {
    console.error("updateProfileVideo failed:", err);
    return false;
  }
}
