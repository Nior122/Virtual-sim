-- Dream Babe schema for Neon PostgreSQL.
-- Table/column names match prisma/schema.prisma exactly (quoted, camelCase),
-- so Prisma and the Cloudflare Pages Functions read and write the same tables.
--
-- How to run (beginner):
--   1. Open your Neon project -> SQL editor
--   2. Paste this whole file and click Run
-- The statements are idempotent: safe to run more than once.

CREATE TABLE IF NOT EXISTS "Persona" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "profileImage" TEXT,
    "coverImage" TEXT,
    "gallery" TEXT,
    "isAdult" BOOLEAN NOT NULL DEFAULT true,
    "age" INTEGER,
    "city" TEXT,
    "country" TEXT,
    "occupation" TEXT,
    "languages" TEXT,
    "shortBio" TEXT,
    "longBio" TEXT,
    "bodyType" TEXT,
    "bustSize" TEXT,
    "height" TEXT,
    "eyeColor" TEXT,
    "hairColor" TEXT,
    "tattoosAndPiercings" TEXT,
    "turnOns" TEXT,
    "turnOffs" TEXT,
    "fantasies" TEXT,
    "intimacyStyle" TEXT,
    "preferredVibe" TEXT,
    "kinksAndFetishes" TEXT,
    "favoriteLingerie" TEXT,
    "eroticInterests" TEXT,
    "personality" TEXT NOT NULL,
    "interests" TEXT NOT NULL,
    "hobbies" TEXT,
    "likes" TEXT,
    "dislikes" TEXT,
    "background" TEXT NOT NULL,
    "speakingStyle" TEXT NOT NULL,
    "communicationTone" TEXT,
    "flirtLevel" INTEGER NOT NULL DEFAULT 0,
    "emojiFrequency" TEXT,
    "systemPrompt" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Persona_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PersonaVideo" (
    "id" TEXT NOT NULL,
    "personaId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PersonaVideo_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Persona_slug_key" ON "Persona"("slug");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'PersonaVideo_personaId_fkey'
    ) THEN
        ALTER TABLE "PersonaVideo"
            ADD CONSTRAINT "PersonaVideo_personaId_fkey"
            FOREIGN KEY ("personaId") REFERENCES "Persona"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
