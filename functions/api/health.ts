/**
 * Deployment check.
 *
 * Open `https://<your-site>/api/health` in a browser after a deploy: the
 * `features` list is the fastest way to tell whether the *production* site is
 * actually running the latest code (a project whose Production branch is not
 * `main` keeps serving old Functions while GitHub shows the merge as done).
 */
const FEATURES = [
  "bulk-preview-confirm",
  "jpeg-magic-byte-probe",
  "jpeg-variant-recovery",
  "inline-json-images",
  "chat-persona-lookup",
  "chat-answer-anchor",
  "telegram-message-splitting",
  "public-base-url-normalisation",
  "diag-command",
  "chatcheck-command",
  "env-model-providers",
  "archive-api-scrape",
  "verified-image-urls",
  "private-mode",
  "share-links",
  "admin-backend",
];

export async function onRequestGet(): Promise<Response> {
  return new Response(
    JSON.stringify(
      {
        ok: true,
        service: "telegram-bot",
        features: FEATURES,
        deployedAt: new Date().toISOString(),
      },
      null,
      2
    ),
    {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    }
  );
}
