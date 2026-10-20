// ---------------------------------------------------------------------------
// Neon serverless data layer.
// Runs inside Cloudflare Pages Functions using @neondatabase/serverless over
// HTTPS — no connection pool and no Node runtime required.
// Table and column names match prisma/schema.prisma exactly.
// ---------------------------------------------------------------------------
import { neon } from "@neondatabase/serverless";
import type { Env } from "../bot/types";

/** Structural type of the Neon tagged-template query function. */
export interface Sql {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<any[]>;
  query(text: string, params?: unknown[]): Promise<any[]>;
}

// Reuse one client per connection string across warm invocations.
const clients = new Map<string, Sql>();

export function sqlFor(env: Env): Sql {
  // Test hook: lets the smoke test inject an in-memory fake.
  const injected = (env as unknown as { __sql?: Sql }).__sql;
  if (injected) return injected;

  const url = env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured.");
  let client = clients.get(url);
  if (!client) {
    client = neon(url) as unknown as Sql;
    clients.set(url, client);
  }
  return client;
}

// Every Persona column except "systemPrompt", which must never be sent to
// browsers (mirrors the public select list in server.ts).
export const PUBLIC_PERSONA_COLUMNS = [
  "id", "name", "slug", "description", "profileImage", "coverImage", "gallery",
  "isAdult", "age", "city", "country", "occupation", "languages",
  "shortBio", "longBio", "bodyType", "bustSize", "height", "eyeColor",
  "hairColor", "tattoosAndPiercings", "turnOns", "turnOffs", "fantasies",
  "intimacyStyle", "preferredVibe", "kinksAndFetishes", "favoriteLingerie",
  "eroticInterests", "personality", "interests", "hobbies", "likes",
  "dislikes", "background", "speakingStyle", "communicationTone",
  "flirtLevel", "emojiFrequency", "active", "createdAt", "updatedAt",
] as const;

const PUBLIC_SELECT = PUBLIC_PERSONA_COLUMNS.map((c) => `"${c}"`).join(", ");

// Full column list for inserts (adds the hidden systemPrompt).
const INSERT_COLUMNS = [...PUBLIC_PERSONA_COLUMNS, "systemPrompt"] as const;

export async function personaSlugExists(
  env: Env,
  slug: string
): Promise<boolean> {
  const sql = sqlFor(env);
  const rows = await sql.query(
    `SELECT 1 FROM "Persona" WHERE lower("slug") = lower($1) LIMIT 1`,
    [slug]
  );
  return rows.length > 0;
}

export interface CreatePersonaRecordInput {
  name: string;
  slug: string;
  description: string;
  profileImage: string | null;
  coverImage: string | null;
  gallery: string | null;
  isAdult: boolean;
  age: number | null;
  city: string | null;
  country: string | null;
  occupation: string | null;
  languages: string | null;
  shortBio: string | null;
  longBio: string | null;
  bodyType: string | null;
  bustSize: string | null;
  height: string | null;
  eyeColor: string | null;
  hairColor: string | null;
  tattoosAndPiercings: string | null;
  turnOns: string | null;
  turnOffs: string | null;
  fantasies: string | null;
  intimacyStyle: string | null;
  preferredVibe: string | null;
  kinksAndFetishes: string | null;
  favoriteLingerie: string | null;
  eroticInterests: string | null;
  personality: string;
  interests: string;
  hobbies: string | null;
  likes: string | null;
  dislikes: string | null;
  background: string;
  speakingStyle: string;
  communicationTone: string | null;
  flirtLevel: number;
  emojiFrequency: string | null;
  systemPrompt: string | null;
  active: boolean;
}

/**
 * Inserts a persona with an explicit UUID and timestamps. Prisma's uuid() and
 * @updatedAt defaults are application-side, so raw SQL must supply them.
 */
export async function createPersonaRecord(
  env: Env,
  input: CreatePersonaRecordInput
): Promise<{ id: string; slug: string; name: string }> {
  const sql = sqlFor(env);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  // Order must match INSERT_COLUMNS exactly.
  const values: unknown[] = [
    id,
    input.name,
    input.slug,
    input.description,
    input.profileImage,
    input.coverImage,
    input.gallery,
    input.isAdult,
    input.age,
    input.city,
    input.country,
    input.occupation,
    input.languages,
    input.shortBio,
    input.longBio,
    input.bodyType,
    input.bustSize,
    input.height,
    input.eyeColor,
    input.hairColor,
    input.tattoosAndPiercings,
    input.turnOns,
    input.turnOffs,
    input.fantasies,
    input.intimacyStyle,
    input.preferredVibe,
    input.kinksAndFetishes,
    input.favoriteLingerie,
    input.eroticInterests,
    input.personality,
    input.interests,
    input.hobbies,
    input.likes,
    input.dislikes,
    input.background,
    input.speakingStyle,
    input.communicationTone,
    input.flirtLevel,
    input.emojiFrequency,
    input.active,
    now,
    now,
    input.systemPrompt,
  ];

  if (values.length !== INSERT_COLUMNS.length) {
    throw new Error(
      `Persona insert mismatch: ${values.length} values for ${INSERT_COLUMNS.length} columns`
    );
  }

  const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");
  // PUBLIC/INSERT column names are a compile-time allowlist — no user input.
  const rows = await sql.query(
    `INSERT INTO "Persona" (${INSERT_COLUMNS.map((c) => `"${c}"`).join(", ")})
     VALUES (${placeholders})
     RETURNING "id", "slug", "name"`,
    values
  );
  return rows[0] as { id: string; slug: string; name: string };
}

export async function createVideoRecord(
  env: Env,
  input: { personaId: string; url: string; title: string }
): Promise<{ id: string }> {
  const sql = sqlFor(env);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const rows = await sql.query(
    `INSERT INTO "PersonaVideo"
       ("id", "personaId", "url", "title", "active", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, true, $5, $5)
     RETURNING "id"`,
    [id, input.personaId, input.url, input.title, now]
  );
  return rows[0] as { id: string };
}

// --- Edits to an existing profile (media only) -----------------------------

export interface PersonaMediaForEdit {
  id: string;
  slug: string;
  name: string;
  profileImage: string | null;
  coverImage: string | null;
  gallery: string | null;
}

/** Loads the media columns of an active persona for the bot's edit mode. */
export async function getPersonaMediaForEdit(
  env: Env,
  slug: string
): Promise<PersonaMediaForEdit | null> {
  const sql = sqlFor(env);
  const rows = await sql.query(
    `SELECT "id", "slug", "name", "profileImage", "coverImage", "gallery"
       FROM "Persona"
      WHERE lower("slug") = lower($1) AND "active" = true
      LIMIT 1`,
    [slug]
  );
  return (rows[0] as PersonaMediaForEdit) || null;
}

/** Replaces the three image columns of an existing persona. */
export async function updatePersonaMediaColumns(
  env: Env,
  personaId: string,
  media: {
    profileImage: string | null;
    coverImage: string | null;
    gallery: string[];
  }
): Promise<{ id: string }> {
  const sql = sqlFor(env);
  const now = new Date().toISOString();
  const rows = await sql.query(
    `UPDATE "Persona"
        SET "profileImage" = $2, "coverImage" = $3, "gallery" = $4, "updatedAt" = $5
      WHERE "id" = $1
      RETURNING "id"`,
    [
      personaId,
      media.profileImage,
      media.coverImage,
      media.gallery.join(","),
      now,
    ]
  );
  return rows[0] as { id: string };
}

export interface PersonaVideoRow {
  id: string;
  url: string;
  title: string;
}

/** Every active video row of a persona, in creation order. */
export async function listPersonaVideos(
  env: Env,
  personaId: string
): Promise<PersonaVideoRow[]> {
  const sql = sqlFor(env);
  return (await sql.query(
    `SELECT "id", "url", "title"
       FROM "PersonaVideo"
      WHERE "personaId" = $1 AND "active" = true
      ORDER BY "createdAt" ASC`,
    [personaId]
  )) as PersonaVideoRow[];
}

/** Deletes one video row, scoped to the persona that owns it. */
export async function deletePersonaVideo(
  env: Env,
  personaId: string,
  videoId: string
): Promise<boolean> {
  const sql = sqlFor(env);
  const rows = await sql.query(
    `DELETE FROM "PersonaVideo"
      WHERE "id" = $1 AND "personaId" = $2
      RETURNING "id"`,
    [videoId, personaId]
  );
  return rows.length > 0;
}

/** Points an existing video row at a new URL/title. */
export async function updatePersonaVideo(
  env: Env,
  personaId: string,
  videoId: string,
  input: { url: string; title: string }
): Promise<boolean> {
  const sql = sqlFor(env);
  const now = new Date().toISOString();
  const rows = await sql.query(
    `UPDATE "PersonaVideo"
        SET "url" = $3, "title" = $4, "updatedAt" = $5
      WHERE "id" = $1 AND "personaId" = $2
      RETURNING "id"`,
    [videoId, personaId, input.url, input.title, now]
  );
  return rows.length > 0;
}

// --- Reads used by the public Pages Functions ------------------------------

export async function listPublicPersonas(env: Env): Promise<any[]> {
  const sql = sqlFor(env);
  return sql.query(
    `SELECT ${PUBLIC_SELECT} FROM "Persona"
     WHERE "active" = true
     ORDER BY "createdAt" DESC`
  );
}

export async function getPublicPersonaBySlug(
  env: Env,
  slug: string
): Promise<Record<string, unknown> | null> {
  const sql = sqlFor(env);
  const rows = await sql.query(
    `SELECT ${PUBLIC_SELECT} FROM "Persona"
     WHERE lower("slug") = lower($1) AND "active" = true
     LIMIT 1`,
    [slug]
  );
  if (rows.length === 0) return null;
  const persona = rows[0] as Record<string, unknown>;

  const videos = await sql.query(
    `SELECT "id", "personaId", "url", "title", "active", "createdAt", "updatedAt"
     FROM "PersonaVideo"
     WHERE "personaId" = $1 AND "active" = true
     ORDER BY "createdAt" ASC`,
    [persona.id]
  );

  // Match server.ts: embed-style URLs are routed through the HLS proxy.
  persona.videos = videos.map((v: { url: string }) => {
    let streamUrl: string = v.url;
    if (
      v.url.includes("rubyvidhub") ||
      v.url.includes("embed") ||
      v.url.includes(".html")
    ) {
      streamUrl = `/api/hls-proxy?embedUrl=${encodeURIComponent(v.url)}`;
    }
    return { ...v, streamUrl };
  });

  return persona;
}
