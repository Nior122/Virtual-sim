import type { Env } from "../../../src/lib/bot/types";
import { requireAdmin } from "../../../src/lib/admin/auth";
import { fail, handle, json, readJson } from "../../../src/lib/admin/http";
import { checkVideoUrls, diagnose } from "../../../src/lib/admin/service";

/** Diagnostics: inspect a page, or probe a list of video URLs. */
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
      url?: string;
      urls?: unknown;
    }>(request);
    if (!body) return fail("Missing body.");

    if (body.action === "diag") {
      return json({ diagnostics: await diagnose(String(body.url || "")) });
    }
    if (body.action === "check-videos") {
      const urls = Array.isArray(body.urls) ? (body.urls as string[]) : [];
      if (urls.length === 0) return fail("No video URLs to check.");
      return json({ checks: await checkVideoUrls(urls) });
    }
    return fail("Unknown action.");
  });
}
