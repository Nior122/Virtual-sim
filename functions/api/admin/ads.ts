/**
 * Advert settings, owner side.
 *
 * GET  → the whole configuration, including every pasted snippet.
 * POST → a partial update (`{ enabled }`, `{ click: { url } }`,
 *        `{ popunder: { enabled, code } }`, …). Anything omitted keeps its
 *        current value, so the panel can save one card at a time.
 *
 * Validation (bad URL, oversized paste, the same snippet in two slots) is
 * rejected with a 400 and a sentence meant for the owner, and nothing is
 * written — the live site keeps the configuration it already had.
 */
import type { Env } from "../../../src/lib/bot/types";
import { requireAdmin } from "../../../src/lib/admin/auth";
import { handle, json, readJson } from "../../../src/lib/admin/http";
import { readAdSettings, writeAdSettings } from "../../../src/lib/ads/store";

export async function onRequestGet({
  request,
  env,
}: {
  request: Request;
  env: Env;
}): Promise<Response> {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  return handle(async () => json(await readAdSettings(env)));
}

export async function onRequestPost({
  request,
  env,
}: {
  request: Request;
  env: Env;
}): Promise<Response> {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  return handle(async () => {
    const body = await readJson<Record<string, unknown>>(request);
    if (!body) return json({ error: "Missing body." }, 400);
    return json(await writeAdSettings(env, body));
  });
}
