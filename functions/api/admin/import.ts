import type { Env } from "../../../src/lib/bot/types";
import { requireAdmin } from "../../../src/lib/admin/auth";
import { fail, handle, json, readJson } from "../../../src/lib/admin/http";
import {
  commitImportEntry,
  prepareImportEntry,
} from "../../../src/lib/admin/service";

/**
 * Two-step import, mirroring /scrape → /preview → /confirm:
 *
 *   { action: "prepare", raw: "<one url>" }   scrape + write the profile text
 *   { action: "commit", prepared: {...} }     create the profile
 *
 * Nothing is written during prepare, so the owner can review the images,
 * videos and generated copy first.
 */
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
    const body = await readJson<{
      action?: string;
      raw?: string;
      prepared?: unknown;
    }>(request);
    if (!body) return fail("Missing body.");
    const origin = new URL(request.url).origin;

    if (body.action === "prepare") {
      const result = await prepareImportEntry(env, origin, String(body.raw || ""));
      return json(result);
    }
    if (body.action === "commit") {
      const result = await commitImportEntry(env, origin, body.prepared);
      return json({ result });
    }
    return fail("Unknown action.");
  });
}
